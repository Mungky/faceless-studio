import "server-only";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {existsSync,readFileSync} from "node:fs";
import {recordId,type Channel} from "@studio/core";
import {db} from "./pocketbase";
import {channelPreferences,saveWorkspace,workspaceRecord,workspaceRows} from "./workspace";
import {routerAuth} from "./provider-credentials";
import {extractUrls,fetchUrlContext} from "./url-context";
import {runTool,describeWorkflow,hasChanges,mergeChanges,NODE_ADD_LIMIT,type Changes,type Snapshot,type ToolContext} from "./assistant-tools";
import {getN8nWorkflow,updateN8nWorkflow} from "./n8n";
import {readNotes} from "./assistant-memory";

// The project assistant. Each chat is a record in the database and runs on the server, so a refresh
// or a closed tab changes nothing and several chats can work at the same time.
export type Attachment={name:string;type:string;url?:string;text?:string};
export type ActionResult={action:string;ok:boolean;message:string;explanation?:string;data?:string;pending?:boolean};
// changes: what really changed in the workflow during a turn, measured by the server (not claimed by the
// model). restore: the workflow as it was before that turn, kept for the latest few so "Urungkan giliran ini" works.
// forModel: a system note the model must also see (approvals, real changes), shown to it as a "[Sistem]" message.
export type ChatMessage={id:string;role:"user"|"assistant"|"system";forModel?:boolean;content:string;think?:string;attachments?:Attachment[];actions?:ActionResult[];changes?:Changes;restore?:Snapshot["workflow"];created_at:string};
// An action that waits for the owner's button. It runs exactly as stored, and only when approved.
export type Pending={id:string;action:Record<string,any>;reason:string;created_at:string};
// summary folds the first `summarized` messages of a long chat into a few lines the model still sees.
export type Thread={id:string;channel:string;title:string;status:"idle"|"running";messages:ChatMessage[];snapshots:Snapshot[];pending?:Pending[];notice?:string;summary?:string;summarized?:number;created:string;updated:string};

const MAX_ROUNDS=8,MAX_CONCURRENT=6,DEFAULT_TITLE="Chat baru",MAX_OUTPUT_TOKENS=16_000,MAX_ATTACHED_TEXT=30_000;
type Live={ctl:AbortController;partial?:{content:string;think:string}};
// Kept on globalThis so a dev-server reload does not forget which chats are running.
const shared=globalThis as unknown as {__assistantLive?:Map<string,Live>;__assistantLocks?:Map<string,Promise<unknown>>};
const live=(shared.__assistantLive??=new Map<string,Live>());
const locks=(shared.__assistantLocks??=new Map<string,Promise<unknown>>());
async function serial<T>(key:string,fn:()=>Promise<T>):Promise<T>{
  const prior=locks.get(key)||Promise.resolve(),next=prior.catch(()=>undefined).then(fn);locks.set(key,next);
  try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}
}

const keyOf=(channel:string,id:string)=>`assistant:${channel}:${id}`;
const threadId=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new Error("Chat tidak valid.");return id;};
const now=()=>new Date().toISOString();
// A chat saved as "running" while no run is alive here was cut off by a restart.
function settle(thread:Thread){if(thread.status==="running"&&!live.has(thread.id)){thread.status="idle";thread.notice="Proses terputus karena server dimulai ulang. Kirim pesan untuk melanjutkan.";}return thread;}
async function read(channel:string,id:string){const row=await workspaceRecord<Thread>(keyOf(channel,threadId(id)));if(!row)throw new Error("Chat tidak ditemukan.");return settle(row.data);}
async function write(thread:Thread){thread.updated=now();await saveWorkspace(keyOf(thread.channel,thread.id),"assistant",thread.channel,thread);}
const patch=(channel:string,id:string,change:(thread:Thread)=>void)=>serial(keyOf(channel,id),async()=>{const thread=await read(channel,id);change(thread);await write(thread);return thread;});

// ---- Action blocks: ```json {"actions":[...]} ``` at the end of a reply ----
const BLOCK=/```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
function parseActions(json:string){
  try{
    const value=JSON.parse(json);const list=Array.isArray(value.actions)?value.actions:typeof value.action==="string"?[value]:null;
    return list&&list.length&&list.every((a:unknown)=>a&&typeof (a as {action?:unknown}).action==="string")?list as Record<string,any>[]:null;
  }catch{return null;}
}
function extractActions(text:string){
  const actions:Record<string,any>[]=[];
  const visible=text.replace(BLOCK,(whole,json:string)=>{const list=parseActions(json);if(!list)return whole;actions.push(...list);return "";}).trim();
  return {visible,actions:actions.slice(0,12)};
}
// While a reply is still streaming, hide action blocks (finished or half-written).
// Results come from the server, never from the model. A model that imitates the "[Hasil …]" format and
// writes its own results is cut off at that point, so a made-up "berhasil" never reaches the owner.
const FABRICATED=/\[Hasil (?:aksi|sistem)[^\]]*\][\s\S]*$/i;
const strip=(text:string)=>text.replace(FABRICATED,"").replace(BLOCK,(whole,json:string)=>parseActions(json)?"":whole).replace(/```(?:json)?\s*\{[^`]*$/i,"").trim();

const publicActions=(actions?:ActionResult[])=>actions?.map(({data:_data,...rest})=>rest);
function view(thread:Thread){
  const {snapshots,...rest}=thread;
  // Only the newest message that can still be undone offers the button; older restore points stay private.
  const undoable=[...thread.messages].reverse().find(m=>m.restore)?.id;
  const messages=thread.messages.map(({restore:_restore,...m})=>({...m,actions:publicActions(m.actions),...(m.id===undoable?{canUndo:true}:{})})) as (ChatMessage&{canUndo?:boolean})[];
  const partial=live.get(thread.id)?.partial;
  if(partial&&(partial.content||partial.think))messages.push({id:"live",role:"assistant",content:strip(partial.content),think:partial.think,created_at:now()});
  return {...rest,messages,pending:thread.pending||[],undo:snapshots.length};
}

// ---- Public API ----
export async function listThreads(channel:string){
  recordId.parse(channel);
  return (await workspaceRows<Thread>(channel,"assistant")).map(r=>settle(r.data)).sort((a,b)=>b.updated.localeCompare(a.updated)).map(t=>({id:t.id,title:t.title,status:t.status,updated:t.updated,count:t.messages.length}));
}
export async function createThread(channel:string,title?:string){
  recordId.parse(channel);await db.get<Channel>("channels",channel);
  const thread:Thread={id:randomUUID(),channel,title:(title||DEFAULT_TITLE).slice(0,80),status:"idle",messages:[],snapshots:[],created:now(),updated:now()};
  await write(thread);return view(thread);
}
export async function getThread(channel:string,id:string){recordId.parse(channel);return view(await read(channel,id));}
export async function renameThread(channel:string,id:string,title:string){recordId.parse(channel);return view(await patch(channel,id,t=>{t.title=title.trim().slice(0,80)||t.title;}));}
export async function stopThread(channel:string,id:string){
  recordId.parse(channel);threadId(id);live.get(id)?.ctl.abort();
  return view(await read(channel,id));
}
export async function deleteThread(channel:string,id:string){
  recordId.parse(channel);threadId(id);live.get(id)?.ctl.abort();
  const row=await workspaceRecord<Thread>(keyOf(channel,id));if(row)await db.delete("workspace_records",row.id);
  return {deleted:id};
}

export async function sendMessage(channel:string,id:string,input:{content?:string;attachments?:Attachment[]}){
  recordId.parse(channel);threadId(id);
  const content=String(input.content||"").trim().slice(0,20_000),fresh=(input.attachments||[]).slice(0,6);
  if(!content&&!fresh.length)throw new Error("Tulis pesan atau lampirkan berkas.");
  if(live.has(id))throw new Error("Assistant masih bekerja di chat ini. Tunggu selesai, tekan Stop, atau buka chat baru untuk pekerjaan lain.");
  if(live.size>=MAX_CONCURRENT)throw new Error(`Sudah ada ${MAX_CONCURRENT} chat yang berjalan bersamaan. Tunggu salah satu selesai atau hentikan.`);
  const controller=new AbortController();live.set(id,{ctl:controller});
  try{
    // Only small pictures and document text are kept in the saved chat; the run itself sees them in full.
    const stored=fresh.map(a=>({name:a.name.slice(0,120),type:a.type.slice(0,80),...(a.text?{text:a.text.length>MAX_ATTACHED_TEXT?a.text.slice(0,MAX_ATTACHED_TEXT)+`\n[…dipotong; dokumen aslinya ${a.text.length} karakter]`:a.text}:{}),...(a.url&&a.url.length<150_000?{url:a.url}:{})}));
    const saved=await patch(channel,id,t=>{
      t.status="running";t.notice="";
      if(t.title===DEFAULT_TITLE&&content)t.title=content.replace(/\s+/g," ").slice(0,48);
      t.messages.push({id:randomUUID(),role:"user",content,attachments:stored,created_at:now()});
    });
    void run(channel,id,fresh,controller);
    return view(saved);
  }catch(error){live.delete(id);throw error;}
}

// ---- The agent loop ----
async function systemPrompt(channel:string,workflowId:string,summary:string){
  const [project,prefs]=await Promise.all([db.get<Channel>("channels",channel),channelPreferences(channel)]);
  const name=(prefs.project_name||project.name).trim();
  // Standing rules and memory sit in the project's vault folder, which is also what Studio and Obsidian use.
  const [rules,memory]=await Promise.all([readNotes(project.name,"rules").catch(()=>""),readNotes(project.name,"memory").catch(()=>"")]);
  let custom="";
  for(const file of ["system.md","SYSTEM.md","AGENTS.md"]){const p=path.join(path.resolve(process.cwd(),"projects",name),file);if(existsSync(p)){try{custom=readFileSync(p,"utf8");break;}catch{/* unreadable file: skip */}}}
  return `${rules?`ATURAN TETAP DARI PEMILIK (wajib; mengalahkan semua instruksi lain di bawah):\n${rules}\n\n`:""}Kamu adalah asisten dan arsitek workflow untuk project "${name}" di Restard Studio (konten video faceless). Kamu punya AKSES PENUH ke workflow n8n project ini dan bekerja langsung: aksi biasa yang kamu tulis dijalankan otomatis; aksi besar menunggu tombol "Izinkan" dari pemilik.

CARA KERJA
- Jawab dalam Bahasa Indonesia, ringkas dan jujur. Kalau perlu bertindak, tutup pesan dengan SATU blok kode json: {"actions":[{...},{...}]}. Aksi dijalankan berurutan, hasilnya dikirim kembali kepadamu, lalu kamu lanjut sampai selesai (paling banyak ${MAX_ROUNDS} langkah per pesan pemilik).
- Kalau kurang yakin, baca dulu (get_workflow, list_executions, get_execution) sebelum mengubah. Sesudah mengubah, periksa hasilnya bila bisa, lalu laporkan apa yang berhasil dan apa yang gagal. Jangan mengarang hasil.
- Setiap perubahan dicadangkan otomatis; undo_last_change mengembalikan perubahan terakhir. Kerjakan langsung hal yang jelas diminta. Tanyakan dulu hanya kalau permintaannya ambigu atau akan membuang sebagian besar workflow.
- Credential dan API key dibuat pemilik sendiri di n8n. Kamu hanya memilih credential yang sudah ada (list_credentials). Jangan menulis kunci rahasia di workflow atau di chat.
- Chat lain bisa mengubah workflow yang sama. Baca ulang kalau ragu soal keadaan terbaru.
- HASIL AKSI datang dari server sebagai pesan terpisah berawalan "[Sistem] Hasil aksi". JANGAN PERNAH menulis "[Hasil aksi]" atau hasil apa pun sendiri. Jangan bilang sesuatu sudah diubah kecuali aksinya ada di blok json dan server sudah melaporkan "berhasil". Setelah giliranmu, server menunjukkan kepada pemilik apa yang BENAR-BENAR berubah di workflow, jadi klaim yang tidak cocok akan terlihat.
- Aksi besar (rebuild_from_recipe, replace_workflow, mengaktifkan workflow, menambah node di atas batas) TIDAK dijalankan sampai pemilik menekan tombol "Izinkan" di layar; mengetik "iya" di chat tidak cukup. Jangan menawarkan rebuild_from_recipe atau replace_workflow untuk "memulihkan" sesuatu. Untuk mengembalikan perubahan, pakai undo_last_change atau minta pemilik menekan "Urungkan giliran ini".
- Mengubah SATU nilai (misalnya nama file): pakai set_node_param dengan path seperti "options.fileName"; bagian lain node tidak tersentuh. parameters di modify_n8n_node digabung per bagian dan tidak menimpa field lain; set_parameters mengganti seluruh parameter node, jadi pakai hanya kalau memang itu maksudnya.
- UBAH SESEDIKIT MUNGKIN. Kerjakan hanya yang diminta di pesan terakhir pemilik. Jangan menambah, menghapus, atau menyalin node yang tidak diminta, dan jangan mencari-cari pekerjaan tambahan. Dilarang menambah node Wait, If, atau Review kecuali pemilik menyebutnya dengan jelas. Satu pesan pemilik hanya boleh menambah ${NODE_ADD_LIMIT} node baru; lebih dari itu ditolak, jadi berhenti dan tanya pemilik.
- Kalau permintaan sudah terpenuhi, berhenti dan laporkan. Jangan menjalankan aksi tambahan "untuk berjaga-jaga".
- INGATAN: simpan hal yang perlu diingat di chat lain (keputusan, preferensi, fakta project) dengan save_memory, satu kalimat per catatan. Kalau pemilik berkata "jangan pernah", "selalu", atau "jadikan aturan", simpan dengan save_rule. Jangan menyimpan kunci atau kata sandi. Baca memori di bawah sebelum menanyakan ulang hal yang sudah dijawab.

AKSI (isi "action" dengan salah satu nama ini; tambahkan "explanation" singkat bila berguna)
- get_workflow: baca JSON lengkap workflow.
- replace_workflow {name?, nodes:[...], connections:{...}, settings?}: ganti seluruh isi workflow (format JSON n8n).
- add_n8n_node {name, node_type:"n8n-nodes-base.xxx", typeVersion?, parameters?, credentials?, position?, connect_from?, connect_to?, connection_type?:"main"|"ai_languageModel"|...}
- modify_n8n_node {node_name, new_name?, parameters? (digabung), set_parameters? (diganti seluruhnya), prompt? (teks prompt node AI), credentials?, disabled?, position?, typeVersion?}
- set_node_param {node_name, path, value}: ubah satu nilai di parameter node, misalnya path "options.fileName". Paling aman untuk perubahan kecil.
- remove_n8n_node {node_name}
- connect_nodes {from, to, connection_type?, output?, input?} dan disconnect_nodes {from, to, connection_type?}
- rename_workflow {name}
- publish_n8n_workflow {active:true|false}
- execute_n8n_workflow {brief, title}: jalankan lewat webhook; hasilnya eksekusi baru. Beberapa eksekusi boleh berjalan bersamaan.
- list_executions {limit?}, get_execution {execution_id}, stop_execution {execution_id}
- list_credentials
- rebuild_from_recipe {name?}: bangun ulang workflow dari resep Studio (membuatnya bila belum ada). Ini mengganti seluruh isi workflow, jadi hanya jika pemilik memintanya, dan tetap menunggu tombol Izinkan.
- save_memory {note}: catat satu hal untuk diingat di semua chat project ini. rewrite_memory {content}: rapikan seluruh memori (gabung yang kembar, buang yang usang).
- save_rule {rule}: simpan aturan tetap dari pemilik; wajib diikuti di setiap chat.
- undo_last_change

ATURAN WORKFLOW STUDIO (agar task di Studio tetap jalan)
- Task Studio memicu webhook "Mulai dari Studio" (POST, responseMode: responseNode) dan membaca hasil per tahap dari NAMA node. Jangan menghapus atau mengganti nama "Mulai dari Studio", "Balas ke Studio" (Respond to Webhook yang mengirim execution_id) dan "Resep Studio" (Set: instructions, references, brief).
- Satu tahap = node chainLlm bernama tahap itu + node "Model · <tahap>" (lmChatOpenAi, model "faceless-creation", tersambung ke tahap lewat ai_languageModel).
- Tahap dengan review = "Review siap · X" (Set: draft, resume_url) → "Review · X" (Wait, resume webhook) → "Disetujui? · X" (If; cabang salah kembali ke tahap X). Pola ini SUDAH ada di workflow. Jangan menambah, menyalin, atau menghapus node Wait/If/Review kecuali pemilik secara eksplisit memintanya; baru kalau diminta tahap baru dengan review, pakai pola ini.
- Node lain (HTTP Request, Code, dll.) bebas ditambahkan di antara tahap.

${custom?`PANDUAN PROJECT (system.md):\n${custom}\n\n`:""}${memory?`MEMORI PROJECT (diingat antar chat):\n${memory}\n\n`:""}${summary?`RINGKASAN CHAT INI SEBELUMNYA (pesan lama sudah dilipat ke sini):\n${summary}\n\n`:""}KEADAAN WORKFLOW SEKARANG
${await describeWorkflow(workflowId)}`;
}

// What the server did, sent as its own message. The model never sees results inside text it wrote
// itself, so it has nothing to imitate and cannot report an action it did not run.
function resultBlock(actions:ActionResult[],full:boolean){
  return "[Sistem] Hasil aksi dari server (bukan tulisanmu):\n"+actions.map(a=>`- ${a.action}: ${a.pending?"BELUM DIJALANKAN":a.ok?"berhasil":"GAGAL"} — ${a.message}${a.data?`\n  data: ${full?a.data:a.data.slice(0,1500)}`:""}`).join("\n");
}
const FOLLOW_UP="\n\nKalau permintaan terakhir pemilik sudah terpenuhi, berhenti dan laporkan hasilnya. Lanjutkan hanya langkah yang jelas diminta pemilik; jangan menambah atau mengubah hal lain, dan jangan mengulang aksi yang sudah berhasil.";
// Claims of having changed something; checked against the real difference after every turn.
const CLAIMS=/\b(?:sudah|telah|berhasil)\b[^.\n]{0,40}\b(?:diubah|diganti|diperbarui|ditambah(?:kan)?|dihapus|disesuaikan|dipasang|dikerjakan)\b|\b(?:saya|aku)\s+(?:sudah\s+)?(?:ubah|ganti|perbarui|tambah(?:kan)?|hapus)\b/i;
function modelMessages(thread:Thread,fresh:Attachment[],extra:string,tail=""){
  const list=thread.messages.slice(thread.summarized||0).filter(m=>m.role!=="system"||m.forModel).slice(-40),lastUser=[...list].reverse().find(m=>m.role==="user"),out:Record<string,unknown>[]=[];
  list.forEach((m,index)=>{
    if(m.role==="system")out.push({role:"user",content:`[Sistem] ${m.content}${m.changes?`\n${changeText(m.changes)}`:""}`});
    else if(m.role==="user"){
      let text=m.content;for(const a of m.attachments||[])if(a.text)text+=`\n\n--- [Lampiran: ${a.name}] ---\n${a.text}`;
      if(m===lastUser&&extra)text+=extra;
      const images=(m===lastUser&&fresh.length?fresh:m.attachments||[]).filter(a=>a.type?.startsWith("image/")&&a.url);
      out.push(images.length?{role:"user",content:[{type:"text",text},...images.map(a=>({type:"image_url",image_url:{url:a.url}}))]}:{role:"user",content:text});
    // An empty reply with no actions says nothing; showing it back as a placeholder only confuses the model.
    }else if(m.content||m.actions?.length){
      out.push({role:"assistant",content:m.content||"(menjalankan aksi)"});
      if(m.actions?.length)out.push({role:"user",content:resultBlock(m.actions,index>=list.length-2)+(index===list.length-1?FOLLOW_UP:"")});
    }
  });
  if(tail)out.push({role:"user",content:tail});
  return out;
}

async function stream(messages:Record<string,unknown>[],signal:AbortSignal,state:Live){
  const {url,apiKey}=await routerAuth();if(!url)throw new Error("9Router belum dikonfigurasi.");
  // A reasoning model can spend a small default limit on thinking and answer nothing, so ask for room.
  const open=(extra:object)=>fetch(url.replace(/\/+$/,"")+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",...(apiKey?{Authorization:"Bearer "+apiKey}:{})},body:JSON.stringify({model:"faceless-creation",messages,stream:true,...extra}),signal:AbortSignal.any([signal,AbortSignal.timeout(600_000)])});
  let response=await open({max_tokens:MAX_OUTPUT_TOKENS});
  if(response.status===400)response=await open({}); // some models reject an explicit limit
  if(!response.ok)throw new Error(`9Router ${response.status}: ${(await response.text().catch(()=>"")).slice(0,300)}`);
  const reader=response.body?.getReader();if(!reader)throw new Error("9Router tidak mengirim jawaban.");
  const decoder=new TextDecoder(),partial=state.partial={content:"",think:""};let buffer="",thinking=false,finish="";
  const add=(chunk:string)=>{
    let rest=chunk;
    while(rest){
      const tag=thinking?"</think>":"<think>",at=rest.indexOf(tag);
      const part=at===-1?rest:rest.slice(0,at);
      if(part){if(thinking)partial.think+=part;else partial.content+=part;}
      if(at===-1)break;
      thinking=!thinking;rest=rest.slice(at+tag.length);
    }
  };
  for(;;){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n");buffer=lines.pop()||"";
    for(const line of lines){
      const text=line.trim();if(!text.startsWith("data: ")||text==="data: [DONE]")continue;
      try{const choice=JSON.parse(text.slice(6)).choices?.[0];if(choice?.finish_reason)finish=String(choice.finish_reason);const delta=choice?.delta;if(!delta)continue;if(delta.reasoning_content)partial.think+=delta.reasoning_content;if(delta.content)add(delta.content);}catch{/* a half chunk: ignore */}
    }
  }
  return {...partial,finish};
}

async function run(channel:string,id:string,fresh:Attachment[],controller:AbortController){
  const state=live.get(id)!;
  // Declared before the try so the final check (what really changed) runs however the run ends.
  const ctx:ToolContext={channel,workflowId:"",snaps:[],budget:{adds:NODE_ADD_LIMIT}};
  // turn: the sum of what this turn's actions really changed (each read back from n8n); turnBefore: the workflow before the first change.
  let turn:Changes|null=null,turnBefore:Snapshot["workflow"]|null=null,lastVisible="",fabricated=false;
  try{
    const prefs=await channelPreferences(channel),first=await read(channel,id);
    ctx.workflowId=prefs.n8n_workflow_id;ctx.snaps=[...first.snapshots];ctx.folder=(await db.get<Channel>("channels",channel)).name;
    // Links and documents the owner just sent are read once and shown to the model with that message.
    const latest=[...first.messages].reverse().find(m=>m.role==="user");let extra="";
    const urls=extractUrls(latest?.content||"").slice(0,3);
    if(urls.length){const pages=(await Promise.all(urls.map(fetchUrlContext))).filter(Boolean);if(pages.length)extra+="\n\n--- [Isi link yang dikirim pemilik] ---\n"+pages.map(p=>`Link: ${p!.url}\nJudul: ${p!.title}\nKeterangan: ${p!.description||""}\nKonten: ${p!.content||""}`).join("\n\n")+"\n--- [Akhir link] ---";}
    let nudge="",retried=false;
    for(let round=0;round<MAX_ROUNDS&&!controller.signal.aborted;round++){
      const thread=await read(channel,id);
      const out=await stream([{role:"system",content:await systemPrompt(channel,ctx.workflowId,thread.summary||"")},...modelMessages(thread,fresh,extra,nudge)],controller.signal,state);
      nudge="";
      let {visible,actions}=extractActions(out.content);const results:ActionResult[]=[],waiting:{action:Record<string,any>;reason:string}[]=[];
      // A model that writes its own "[Hasil aksi]" is cut off there: only the server reports results.
      if(FABRICATED.test(visible)){fabricated=true;visible=visible.replace(FABRICATED,"").trim();}
      // Some models write their whole answer inside a <think> block they never close; the actions are still there.
      if(!visible&&!actions.length&&out.think)actions=extractActions(out.think).actions;
      if(!visible&&!actions.length&&!controller.signal.aborted){
        // Only reasoning came back. Ask once more for a real answer; never save an empty reply.
        state.partial=undefined;
        if(!retried){retried=true;nudge="[Sistem] Jawabanmu sebelumnya kosong (hanya proses berpikir, tanpa jawaban). Jawab sekarang tanpa berpikir panjang: tulis penjelasan singkat untuk pemilik, lalu blok json aksi bila perlu.";continue;}
        await patch(channel,id,t=>{t.messages.push({id:randomUUID(),role:"system",content:`Model berhenti tanpa jawaban (alasan: ${out.finish||"tidak diketahui"}). Kemungkinan jawabannya habis di proses berpikir atau terpotong batas token. Kirim ulang pesan, perkecil lampiran, atau minta dalam langkah lebih kecil.`,created_at:now()});});
        return;
      }
      for(const action of actions){
        if(controller.signal.aborted)break;
        const outcome=await runTool(ctx,action);
        if(outcome.approval)waiting.push({action,reason:outcome.approval});
        if(outcome.changes&&hasChanges(outcome.changes)){turn=mergeChanges(turn,outcome.changes);turnBefore??=outcome.before||null;}
        results.push({action:String(action.action),ok:outcome.ok,message:outcome.message,...(outcome.approval?{pending:true}:{}),...(action.explanation?{explanation:String(action.explanation).slice(0,300)}:{}),...(typeof outcome.data==="string"?{data:outcome.data.slice(0,40_000)}:outcome.data?{data:JSON.stringify(outcome.data).slice(0,40_000)}:{})});
      }
      await patch(channel,id,t=>{
        t.messages.push({id:randomUUID(),role:"assistant",content:controller.signal.aborted?(visible?visible+"\n\n":"")+"_(dihentikan)_":visible,...(out.think?{think:out.think}:{}),...(results.length?{actions:results}:{}),created_at:now()});
        t.snapshots=ctx.snaps.slice(-10);
        for(const w of waiting)if(!(t.pending||[]).some(p=>JSON.stringify(p.action)===JSON.stringify(w.action)))(t.pending??=[]).push({id:randomUUID(),action:w.action,reason:w.reason,created_at:now()});
        if(t.messages.length>300){const drop=t.messages.length-300;t.messages=t.messages.slice(drop);t.summarized=Math.max(0,(t.summarized||0)-drop);}
      });
      state.partial=undefined;lastVisible=visible||lastVisible;
      if(!actions.length)return;
      if(round===MAX_ROUNDS-1)await patch(channel,id,t=>{t.messages.push({id:randomUUID(),role:"system",content:`Berhenti setelah ${MAX_ROUNDS} langkah. Tulis "lanjut" untuk meneruskan.`,created_at:now()});});
    }
  }catch(error){
    if(!controller.signal.aborted){
      const message=(error as Error).message;
      await patch(channel,id,t=>{t.messages.push({id:randomUUID(),role:"system",content:"Assistant gagal: "+message,created_at:now()});}).catch(()=>undefined);
    }
  }finally{
    // Whatever was half-written when Stop was pressed is kept, then the chat is free again.
    const partial=state.partial;
    // The truth about this turn, read back from n8n: the owner sees it whatever the assistant said.
    const report=buildReport(turn,turnBefore,lastVisible);
    // The chat stays "running" until this last save is done, so nothing reads it half-finished.
    await patch(channel,id,t=>{
      if(controller.signal.aborted&&partial&&(partial.content||partial.think)){const {visible}=extractActions(partial.content);t.messages.push({id:randomUUID(),role:"assistant",content:(visible?visible+"\n\n":"")+"_(dihentikan)_",...(partial.think?{think:partial.think}:{}),created_at:now()});}
      if(fabricated)t.messages.push({id:randomUUID(),role:"system",content:"Assistant sempat menulis \"hasil aksi\" sendiri. Bagian itu dibuang; hanya hasil dari server yang dianggap nyata.",created_at:now()});
      if(report)t.messages.push(report);
      keepRestorePoints(t);
      t.status="idle";t.notice="";
    }).catch(()=>undefined);
    live.delete(id);
    if(!controller.signal.aborted)void condense(channel,id).catch(()=>undefined);
  }
}

// ---- What really happened, and what waits for the owner ----
const changeText=(c:Changes)=>[c.added.length?`ditambah: ${c.added.join(", ")}`:"",c.removed.length?`dihapus: ${c.removed.join(", ")}`:"",...c.changed.map(x=>`diubah: ${x.node} (${x.fields.join(", ")})`),c.links?"sambungan antar node berubah":"",...c.meta].filter(Boolean).join("; ")||"tidak ada perubahan";
// The server's own account of a turn. Only changes read back from n8n count, so an assistant that claims a
// change it never made is flagged instead of believed.
function buildReport(changes:Changes|null,before:Snapshot["workflow"]|null,claimed:string):ChatMessage|null{
  if(changes&&hasChanges(changes))return {id:randomUUID(),role:"system",forModel:true,content:"Perubahan nyata pada workflow di giliran ini",changes,...(before?{restore:before}:{}),created_at:now()};
  if(CLAIMS.test(claimed))return {id:randomUUID(),role:"system",forModel:true,content:"⚠ Assistant menyatakan sudah mengubah sesuatu, tetapi workflow di n8n TIDAK berubah pada giliran ini.",changes:{added:[],removed:[],changed:[],links:false,meta:[]},created_at:now()};
  return null;
}
// Restore points are full copies of the workflow; only the newest few are kept.
function keepRestorePoints(t:Thread){for(const m of t.messages.filter(x=>x.restore).slice(0,-3))delete m.restore;}

// The owner pressed "Izinkan": the stored action runs once, exactly as shown on the card.
export async function approvePending(channel:string,id:string,pendingId:string){
  recordId.parse(channel);threadId(id);
  if(live.has(id))throw new Error("Assistant masih bekerja. Tunggu selesai atau tekan Stop, lalu tekan Izinkan.");
  const thread=await read(channel,id),item=thread.pending?.find(p=>p.id===pendingId);
  if(!item)throw new Error("Permintaan izin ini sudah tidak ada.");
  const [prefs,project]=await Promise.all([channelPreferences(channel),db.get<Channel>("channels",channel)]);
  const ctx:ToolContext={channel,workflowId:prefs.n8n_workflow_id,snaps:[...thread.snapshots],folder:project.name,approved:true};
  const outcome=await runTool(ctx,item.action),report=buildReport(outcome.changes||null,outcome.before||null,"");
  return view(await patch(channel,id,t=>{
    t.pending=(t.pending||[]).filter(p=>p.id!==pendingId);t.snapshots=ctx.snaps.slice(-10);
    t.messages.push({id:randomUUID(),role:"system",forModel:true,content:`Disetujui pemilik dan ${outcome.ok?"dijalankan":"GAGAL"}: ${outcome.message}`,created_at:now()});
    if(report)t.messages.push(report);
    keepRestorePoints(t);
  }));
}
export async function rejectPending(channel:string,id:string,pendingId:string){
  recordId.parse(channel);threadId(id);
  return view(await patch(channel,id,t=>{
    const item=(t.pending||[]).find(p=>p.id===pendingId);if(!item)return;
    t.pending=(t.pending||[]).filter(p=>p.id!==pendingId);
    t.messages.push({id:randomUUID(),role:"system",forModel:true,content:`Ditolak pemilik: ${item.reason} Tidak dijalankan dan jangan diminta lagi kecuali pemilik yang meminta.`,created_at:now()});
  }));
}
// Puts the workflow back as it was before the newest turn that changed it (one click for the whole turn).
export async function undoTurn(channel:string,id:string,messageId:string){
  recordId.parse(channel);threadId(id);
  if(live.has(id))throw new Error("Assistant masih bekerja. Tunggu selesai atau tekan Stop.");
  const thread=await read(channel,id),target=[...thread.messages].reverse().find(m=>m.restore);
  if(!target?.restore||target.id!==messageId)throw new Error("Hanya giliran terakhir yang bisa diurungkan.");
  const workflowId=(await channelPreferences(channel)).n8n_workflow_id;
  if(!workflowId)throw new Error("Project ini belum punya workflow n8n.");
  const current=await getN8nWorkflow(workflowId) as unknown as Record<string,any>,restore=target.restore;
  await updateN8nWorkflow(workflowId,{name:restore.name,nodes:restore.nodes,connections:restore.connections,settings:restore.settings||{executionOrder:"v1"}} as never);
  return view(await patch(channel,id,t=>{
    const message=t.messages.find(m=>m.id===messageId);if(message)delete message.restore;
    t.snapshots=[...t.snapshots,{at:now(),label:"Sebelum giliran diurungkan",workflow:{name:current.name,nodes:current.nodes,connections:current.connections,settings:current.settings}}].slice(-10);
    t.messages.push({id:randomUUID(),role:"system",forModel:true,content:"Giliran diurungkan: workflow dikembalikan ke keadaan sebelum giliran itu.",created_at:now()});
  }));
}

// A plain (non-streaming) model call, for housekeeping such as summarising.
async function complete(messages:Record<string,unknown>[]){
  const {url,apiKey}=await routerAuth();if(!url)throw new Error("9Router belum dikonfigurasi.");
  const response=await fetch(url.replace(/\/+$/,"")+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",...(apiKey?{Authorization:"Bearer "+apiKey}:{})},body:JSON.stringify({model:"faceless-creation",messages,stream:false}),signal:AbortSignal.timeout(120_000)});
  if(!response.ok)throw new Error(`9Router ${response.status}`);
  const data=await response.json() as {choices?:{message?:{content?:string}}[]};
  return String(data.choices?.[0]?.message?.content||"").replace(/<think>[\s\S]*?<\/think>/g,"").trim();
}

// A long chat keeps its latest messages as they are; everything older is folded into a short summary
// (decisions, what changed, what is still open), so the assistant stays continuous without the whole log.
const KEEP_RECENT=14,FOLD_AT=12,SUMMARY_MAX=1800;
async function condense(channel:string,id:string){
  const thread=await read(channel,id);
  const upto=thread.messages.length-KEEP_RECENT,from=thread.summarized||0;
  if(thread.status==="running"||upto-from<FOLD_AT)return;
  const lines=thread.messages.slice(from,upto).filter(m=>m.role!=="system").map(m=>`${m.role==="user"?"Pemilik":"Assistant"}: ${m.content.slice(0,1200)}${m.actions?.length?` [aksi: ${m.actions.map(a=>`${a.action} ${a.ok?"ok":"gagal"} ${a.message}`).join("; ").slice(0,600)}]`:""}`).join("\n");
  const text=await complete([
    {role:"system",content:`Kamu merangkum percakapan antara pemilik dan asisten workflow n8n. Tulis catatan ringkas dalam Bahasa Indonesia (maksimal ${SUMMARY_MAX} karakter, berupa butir-butir): keputusan dan larangan dari pemilik, apa yang sudah diubah di workflow, dan apa yang masih terbuka. Gabungkan dengan ringkasan lama. Jangan mengarang, jangan memasukkan kunci atau kata sandi.`},
    {role:"user",content:`${thread.summary?`Ringkasan lama:\n${thread.summary}\n\n`:""}Percakapan yang dilipat:\n${lines}`}
  ]);
  if(!text)return;
  await patch(channel,id,t=>{if((t.summarized||0)<upto&&t.messages.length>=upto){t.summary=text.slice(0,SUMMARY_MAX);t.summarized=upto;}});
}
