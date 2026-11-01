import "server-only";
import {randomUUID} from "node:crypto";
import {z,agentReplySchema,overallScore,parseJsonOutput,stepsToGraph,studioScope,workflowKinds,workflowNodeInfo,type Channel,type ModelRoute,type StudioAction,type StudioMessage,type StudioThread,type VideoAnalysis} from "@studio/core";
import type {ChatMessage} from "@studio/connectors";
import {db,DatabaseError} from "./pocketbase";
import {routerConnector} from "./provider-credentials";
import {saveWorkspace,workspaceRecord,workspaceRows,createProduction} from "./workspace";
import {workflowLibrary,workflowTemplate,createWorkflowTemplate,saveWorkflowTemplate,workflowRunData,actWorkflowRun,messageWorkflowRun} from "./workflows";
import {channelPreferences} from "./workspace";
import {analyzeReference,addReference} from "./foryou";

const threadKey=(id:string)=>"studio-thread:"+id;
const now=()=>new Date().toISOString();
async function load(id:string){z.string().uuid().parse(id);const row=await workspaceRecord<StudioThread>(threadKey(id));if(!row)throw new DatabaseError(404,"Percakapan tidak ditemukan.");return row.data;}
async function store(thread:StudioThread,expected?:number){const next={...thread,revision:thread.revision+1,updated:now()};await saveWorkspace(threadKey(thread.id),"studio-thread",studioScope,next,expected);return next;}

export async function studioThreads(){return (await workspaceRows<StudioThread>(studioScope,"studio-thread")).map(r=>r.data).sort((a,b)=>b.updated.localeCompare(a.updated)).map(t=>({id:t.id,title:t.title,updated:t.updated,messages:t.messages.length,attachments:t.attachments}));}
export async function studioThread(id:string){return load(id);}
// Each project has exactly one conversation. It is created on first open and never replaced.
export async function projectThread(channel:string){
  const project=await db.get<Channel>("channels",channel);
  const existing=(await workspaceRows<StudioThread>(studioScope,"studio-thread")).map(r=>r.data).filter(t=>t.attachments.project===project.id).sort((a,b)=>a.created.localeCompare(b.created))[0];
  if(existing)return existing;
  const thread:StudioThread={id:randomUUID(),title:project.name,messages:[],attachments:{analyses:[],project:project.id},created:now(),updated:now(),revision:0};
  await saveWorkspace(threadKey(thread.id),"studio-thread",studioScope,thread,undefined,true);return thread;
}

export async function createStudioThread(input:unknown){
  const value=z.object({title:z.string().trim().max(120).default(""),analyses:z.array(z.string().uuid()).max(20).default([]),template:z.string().max(80).optional()}).strict().parse(input);
  const thread:StudioThread={id:randomUUID(),title:value.title||"Percakapan baru",messages:[],attachments:{analyses:value.analyses,...(value.template?{template:value.template}:{})},created:now(),updated:now(),revision:0};
  await saveWorkspace(threadKey(thread.id),"studio-thread",studioScope,thread,undefined,true);return thread;
}

export async function chatModel(){
  const routes=await db.list<ModelRoute>("model_routes");const route=["chat","script","research"].map(task=>routes.find(r=>r.task===task)).find(Boolean);
  if(!route)throw new Error("Pilih model untuk Chat Studio di Pengaturan → Model AI.");
  if(route.billing!=="free")throw new Error("Chat Studio memakai model gratis. Ubah rute Chat Studio menjadi gratis di Pengaturan → Model AI.");
  return route;
}

// Everything the agent may refer to: channels, templates and their steps, attached analyses, live runs.
// A project conversation sees only its own project, its workflow (with node ids) and its tasks.
async function context(thread:StudioThread){
  const [channels,library,analyses]=await Promise.all([db.list<Channel>("channels"),workflowLibrary(),workspaceRows<VideoAnalysis>("foryou000000000","fy-analysis")]);
  const project=thread.attachments.project;
  if(project){
    const prefs=await channelPreferences(project);const name=prefs.project_name||channels.find(c=>c.id===project)?.name||project;
    const workflow=library.templates.find(t=>t.id===prefs.default_template_id)||library.templates.find(t=>t.channel===project);
    const graph=workflow?.draft?.graph||workflow?.graph;
    const tasks=library.runs.filter(r=>r.channel===project).slice(0,12).map(r=>`- task ${r.id} · ${r.closed?"ditutup":r.status} · ${r.graph.nodes.filter(n=>n.kind!=="reference").map(n=>n.id+":"+(r.states[n.id]?.status||"idle")).join(", ")}`).join("\n");
    const selected=thread.attachments.run?library.runs.find(r=>r.id===thread.attachments.run):undefined;
    const focus=selected?`\nTask yang sedang dipilih pemilik: ${selected.id}. Arahan terakhirnya:\n${selected.messages.filter(m=>m.role==="user").slice(-5).map(m=>"- "+m.content.slice(0,300)).join("\n")}`:"";
    const attached=analyses.map(r=>r.data).filter(a=>thread.attachments.analyses.includes(a.id)).map(a=>`### ${a.title} (${a.platform}, skor ${overallScore(a)}/10)\n${a.summary}\nFormula: ${a.formula.join("; ")}`).join("\n\n");
    return `Kamu adalah agent produksi untuk project "${name}" (id ${project}) di Faceless Studio. Kamu membantu pemilik menjalankan task (satu task = satu video), mengubah workflow project, menambah referensi, dan menjawab pertanyaan. Jawab dalam Bahasa Indonesia, ringkas dan konkret.
Balas HANYA JSON: {"reply":"teks untuk pemilik (boleh markdown)","action":null atau satu aksi}.
Aksi hanya usulan; pemilik menekan Terapkan. Perubahan workflow berlaku untuk semua task project ini, jadi jelaskan dampaknya di reply. Aksi:
- {"type":"edit_template","template_id":"${workflow?.id||""}","instructions"?,"steps"?:[{"kind","title","instructions","review"}]}
- {"type":"add_reference","template_id":"${workflow?.id||""}","name","ref_type":"link|video|image|markdown|file","url","content","instructions","target":"<node id yang memakai referensi>"}
- {"type":"start_episode","channel":"${project}","template_id":"${workflow?.id||""}","entry_mode":"research|idea|script","title","content"}
- {"type":"direct_task","run_id","node_id"?,"content"} — simpan arahan ke task
- {"type":"run_step","run_id","node_id"?}
- {"type":"analyze_reference","url"}
Jenis langkah: ${workflowKinds.filter(k=>k!=="reference").map(k=>k+" = "+workflowNodeInfo[k].description).join("; ")}. Workflow wajib diawali brief; setiap kind sekali kecuali review dan custom.
Workflow project${workflow?.draft?" (draft menunggu semua task selesai)":""}: ${graph?graph.nodes.map(n=>n.id+"["+n.kind+(n.kind==="reference"?":"+(n.reference?.name||n.title):"")+"]").join(", ")+" | alur: "+graph.edges.map(e=>e.source+"→"+e.target).join(", "):"belum ada"}
Instruksi workflow: ${(workflow?.instructions||"").slice(0,2000)}
Task:
${tasks||"- belum ada"}${focus}
${attached?"Analisis video terlampir:\n"+attached:""}`;
  }
  const attached=analyses.map(r=>r.data).filter(a=>thread.attachments.analyses.includes(a.id));
  const templates=library.templates.map(t=>`- ${t.id} · ${t.name} (channel ${t.channel}): ${t.description.slice(0,200)} | langkah: ${t.graph.nodes.map(n=>n.kind+(n.title!==workflowNodeInfo[n.kind].label?"「"+n.title+"」":"")).join(" → ")}`).join("\n");
  const runs=library.runs.slice(0,8).map(r=>`- run ${r.id} · ${r.template_name} · episode ${r.episode} · ${r.status} · ${r.graph.nodes.map(n=>n.id+":"+(r.states[n.id]?.status||"idle")).join(", ")}`).join("\n");
  const research=attached.map(a=>`### ${a.title} (${a.platform}, skor ${overallScore(a)}/10)\n${a.summary}\nNiche: ${a.niche}\nFormula: ${a.formula.join("; ")}\nSkor: ${Object.entries(a.scores).map(([k,s])=>k+" "+s.score).join(", ")}`).join("\n\n");
  return `Kamu adalah agent produksi di Faceless Studio. Kamu membantu pemilik membuat video faceless, merancang template produksi, dan membedah video orang lain. Jawab dalam Bahasa Indonesia, ringkas dan konkret.
Balas HANYA JSON: {"reply":"teks untuk pemilik (boleh markdown)","action":null atau satu aksi}.
Aksi hanya usulan; pemilik yang menekan Terapkan. Aksi yang tersedia:
- {"type":"create_template","name","description","niche","instructions","channel":"<id channel>","steps":[{"kind","title","instructions","review"}]}
- {"type":"edit_template","template_id","instructions"?,"steps"?}
- {"type":"start_episode","channel","template_id","entry_mode":"research|idea|script","title","content"}
- {"type":"analyze_reference","url"}
- {"type":"run_step","run_id","node_id"?}
Jenis langkah (kind): ${workflowKinds.map(k=>k+" = "+workflowNodeInfo[k].description).join("; ")}. Satu template wajib diawali brief, dan setiap kind hanya sekali (kecuali review; media boleh sekali untuk image dan sekali untuk video).
Channel: ${channels.map(c=>c.id+" · "+c.name).join(", ")}
Template:
${templates||"- belum ada"}
Run aktif:
${runs||"- belum ada"}
${research?"Analisis video terlampir:\n"+research:""}`;
}

export async function sendStudioMessage(id:string,input:unknown){
  const value=z.object({content:z.string().trim().min(1).max(20_000),expected_revision:z.number().int().min(0),run:z.string().regex(/^[a-zA-Z0-9]{15}$/).nullish(),analyses:z.array(z.string().uuid()).max(20).optional()}).strict().parse(input);
  let thread=await load(id);if(thread.revision!==value.expected_revision)throw new DatabaseError(409,"Percakapan berubah. Muat ulang.");
  if(value.run!==undefined)thread.attachments={...thread.attachments,run:value.run||undefined};
  if(value.analyses?.length)thread.attachments={...thread.attachments,analyses:[...new Set([...thread.attachments.analyses,...value.analyses])]};
  const route=await chatModel();
  const user:StudioMessage={id:randomUUID(),role:"user",content:value.content,created:now()};
  thread=await store({...thread,title:thread.messages.length?thread.title:value.content.slice(0,80),messages:[...thread.messages,user]},thread.revision);
  thread=condense(thread);
  const history:ChatMessage[]=[{role:"system",content:await context(thread)+(thread.memory?"\n\nRingkasan percakapan sebelumnya:\n"+thread.memory.replace(/^<!--\d+-->\n?/,""):"")},...thread.messages.slice(-window).map(m=>({role:m.role,content:m.role==="assistant"&&m.action?m.content+"\n[aksi diusulkan: "+m.action.type+" · "+m.action.status+"]":m.content}))];
  let reply:StudioMessage;
  try{
    const result=await (await routerConnector()).chat(route.model,history,Math.min(route.max_output_tokens||4000,8000));
    let parsed:z.infer<typeof agentReplySchema>;try{parsed=agentReplySchema.parse(parseJsonOutput(result.text));}catch{parsed={reply:result.text,action:null};}
    reply={id:randomUUID(),role:"assistant",content:parsed.reply||"(Tidak ada teks.)",created:now(),...(parsed.action?{action:{...parsed.action,status:"proposed" as const}}:{})};
  }catch(error){reply={id:randomUUID(),role:"assistant",content:"Agent belum bisa menjawab: "+(error as Error).message,created:now()};}
  return store({...thread,messages:[...thread.messages,reply]},thread.revision);
}

// The agent reads the last turns in full; older ones fold into a short running memory instead of
// being dropped, so one conversation can serve a project indefinitely.
const window=24;
function condense(thread:StudioThread):StudioThread{
  const folded=Number((thread.memory||"").match(/^<!--(\d+)-->/)?.[1]||0),until=thread.messages.length-window;
  if(until<=folded)return thread;
  const lines=thread.messages.slice(folded,until).map(m=>m.role==="user"?"- Pemilik: "+m.content.replace(/\s+/g," ").slice(0,220):m.action?"- Agent mengusulkan "+m.action.type+" ("+m.action.status+(m.action.result?": "+m.action.result.slice(0,120):"")+")":"- Agent: "+m.content.replace(/\s+/g," ").slice(0,160));
  const previous=(thread.memory||"").replace(/^<!--\d+-->\n?/,"").split("\n").filter(Boolean);
  return {...thread,memory:"<!--"+until+"-->\n"+[...previous,...lines].slice(-80).join("\n")};
}

async function apply(action:StudioAction,owner:string,thread:StudioThread):Promise<{result:string;link?:{view:string;id:string};template?:string;run?:string}>{
  if(action.type==="create_template"){
    const channels=await db.list<Channel>("channels");const channel=channels.find(c=>c.id===action.channel)?.id||channels[0]?.id;if(!channel)throw new Error("Buat channel terlebih dahulu.");
    const instructions=[action.niche?"Niche: "+action.niche:"",action.instructions].filter(Boolean).join("\n\n");
    const created=await createWorkflowTemplate({name:action.name,description:action.description,channel,instructions,graph:stepsToGraph(action.steps)}) as {id:string};
    return {result:"Template "+action.name+" dibuat.",template:created.id,link:{view:"template",id:created.id}};
  }
  if(action.type==="edit_template"){
    const current=await workflowTemplate(action.template_id),base=current.draft?.graph||current.graph;
    const saved=await saveWorkflowTemplate(current.id,{name:current.name,description:current.description,channel:current.channel,playbook_path:current.playbook_path,instructions:action.instructions??current.draft?.instructions??current.instructions,graph:action.steps?keepReferences(base,stepsToGraph(action.steps)):base,expected_version:current.version});
    return {result:saved.draft?"Perubahan workflow disimpan sebagai draft dan berlaku setelah semua task selesai.":"Workflow "+current.name+" diperbarui.",template:current.id};
  }
  if(action.type==="add_reference"){
    const current=await workflowTemplate(action.template_id),graph=structuredClone(current.draft?.graph||current.graph);
    const target=graph.nodes.find(n=>n.id===action.target&&n.kind!=="reference"&&n.kind!=="brief")||graph.nodes.find(n=>n.kind==="research")||graph.nodes.find(n=>n.kind!=="brief"&&n.kind!=="reference");
    if(!target)throw new Error("Workflow belum punya tahap untuk referensi ini.");
    const id="reference-"+randomUUID().slice(0,8);
    graph.nodes.push({id,kind:"reference",title:action.name.slice(0,120),instructions:action.instructions,position:{x:target.position.x-40,y:target.position.y-190},review:false,reference:{type:action.ref_type,name:action.name,url:action.url,content:action.content}});
    graph.edges.push({id:"edge-"+randomUUID(),source:id,target:target.id});
    const saved=await saveWorkflowTemplate(current.id,{name:current.name,description:current.description,channel:current.channel,playbook_path:current.playbook_path,instructions:current.draft?.instructions??current.instructions,graph,expected_version:current.version});
    return {result:"Referensi "+action.name+" ditambahkan ke "+target.title+(saved.draft?" (draft, berlaku setelah semua task selesai).":"."),template:current.id};
  }
  if(action.type==="direct_task"){
    const {run}=await workflowRunData(action.run_id) as {run:{id:string;revision:number}};
    await messageWorkflowRun(run.id,{content:action.content,...(action.node_id?{node_id:action.node_id}:{}),expected_revision:run.revision},owner);
    return {result:"Arahan disimpan ke task dan dipakai saat tahap disiapkan atau direvisi.",run:run.id};
  }
  if(action.type==="start_episode"){
    const created=await createProduction({channel:thread.attachments.project||action.channel,template:action.template_id,entry_mode:action.entry_mode,title:action.title,content:action.content},owner) as {run:{id:string;episode:string}};
    return {result:"Episode dibuat dan masuk antrean produksi.",run:created.run.id,link:{view:"episode",id:created.run.episode}};
  }
  if(action.type==="analyze_reference"){
    // A channel page has no single video to watch; the analysis would only read the page chrome.
    if(/youtube\.com\/(@[^/]+|channel\/|c\/|user\/)[^?]*$|tiktok\.com\/@[^/]+\/?$/i.test(action.url)&&!/\/shorts\/[\w-]{6,}|watch\?v=|\/video\/\d/.test(action.url))throw new Error("Ini link channel, bukan video. Kirim link satu video (mis. youtube.com/shorts/…) supaya isinya bisa dianalisis.");
    const reference=await addReference({url:action.url});const analysis=await analyzeReference(reference.id,{depth:"quick"});
    if(analysis.status==="done")thread.attachments.analyses=[...new Set([...thread.attachments.analyses,analysis.id])];
    return {result:analysis.status==="done"?"Analisis selesai (skor "+overallScore(analysis)+"/10) dan dilampirkan ke percakapan ini.":"Analisis masuk antrean."};
  }
  const {run}=await workflowRunData(action.run_id) as {run:{id:string;revision:number}};
  await actWorkflowRun(run.id,{action:"prepare",...(action.node_id?{node_id:action.node_id}:{}),expected_revision:run.revision},owner);
  return {result:"Langkah disiapkan. Periksa biaya atau hasilnya di Running tasks.",run:run.id};
}

// A step list from the agent replaces the stages; owner references stay wired to the same stage
// (or the first stage after the brief when that stage was removed).
function keepReferences(previous:ReturnType<typeof stepsToGraph>,next:ReturnType<typeof stepsToGraph>){
  const refs=previous.nodes.filter(n=>n.kind==="reference");if(!refs.length)return next;
  const fallback=next.nodes.find(n=>n.kind!=="brief")?.id||next.nodes[0].id,ids=new Set(next.nodes.map(n=>n.id));
  const edges=previous.edges.filter(e=>refs.some(r=>r.id===e.source)).map(e=>({...e,target:ids.has(e.target)?e.target:fallback}));
  const unique=edges.filter((e,i)=>edges.findIndex(o=>o.source===e.source&&o.target===e.target)===i);
  return {...next,nodes:[...next.nodes,...refs],edges:[...next.edges,...unique]};
}

export async function applyStudioAction(id:string,input:unknown,owner:string){
  const value=z.object({message_id:z.string().uuid(),decision:z.enum(["apply","dismiss"]).default("apply")}).strict().parse(input);
  const thread=await load(id),message=thread.messages.find(m=>m.id===value.message_id);
  if(!message?.action)throw new DatabaseError(404,"Aksi tidak ditemukan.");if(message.action.status!=="proposed")throw new DatabaseError(409,"Aksi ini sudah diproses.");
  if(value.decision==="dismiss"){message.action={...message.action,status:"dismissed"};return store(thread,thread.revision);}
  try{const outcome=await apply(message.action,owner,thread);message.action={...message.action,status:"applied",result:outcome.result,...(outcome.link?{link:outcome.link}:{})};if(outcome.template)thread.attachments.template=outcome.template;if(outcome.run)thread.attachments.run=outcome.run;}
  catch(error){message.action={...message.action,status:"failed",result:(error as Error).message};}
  return store(thread,thread.revision);
}
