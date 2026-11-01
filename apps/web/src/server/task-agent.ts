import "server-only";
import {z,parseJsonOutput,workflowNodeInfo,type WorkflowRun} from "@studio/core";
import type {ChatMessage} from "@studio/connectors";
import {routerConnector} from "./provider-credentials";
import {episodeDetails} from "./service";
import {chatModel} from "./studio-chat";
import {workflowRunData,advanceWorkflowRun,actWorkflowRun,appendRunMessage,thinking} from "./workflows";

// Each task is its own conversation with an agent, like a session in a chat harness. The agent
// runs the task's stages, reads what stopped them, retries once on its own, and asks the owner
// only for real decisions. The canvas shows the same task's progress.
const actionSchema=z.object({type:z.enum(["run","approve","revise","note"]),node_id:z.string().max(80).optional(),direction:z.string().max(4000).optional()});
const replySchema=z.object({reply:z.string().max(8000).default(""),actions:z.array(actionSchema).max(4).default([])});
type Trigger="user"|"stopped";

function snapshot(run:WorkflowRun,documents:Record<string,string>){
  const docOf:Record<string,string>={research:"riset.md",script:"script.md",storyboard:"storyboard.md",upload_pack:"upload-pack.md"};
  return run.graph.nodes.filter(n=>n.kind!=="reference").map(n=>{const s=run.states[n.id]||{status:"idle"};
    const text=(docOf[n.kind]&&documents[docOf[n.kind]])||s.output||"";const long=s.status==="waiting_review"?4000:500;
    return `- ${n.id} (${workflowNodeInfo[n.kind].label} · "${n.title}") status=${s.status}${s.error?` error="${s.error.slice(0,400)}"`:""}${s.quote?` biaya=${s.quote.currency==="USD"?"$"+s.quote.est_cost:s.quote.units+" kredit"} (${s.quote.provider})`:""}${text.trim()?`\n  hasil: ${text.slice(0,long).replace(/\s+/g," ")}`:""}`;}).join("\n");
}

export async function taskAgentTurn(id:string,owner:string,trigger:Trigger){
  if(thinking.has(id))return;thinking.add(id);
  try{
    const {run}=await workflowRunData(id) as {run:WorkflowRun};const detail=await episodeDetails(run.episode);
    const references=run.graph.nodes.filter(n=>n.kind==="reference").map(n=>`- ${n.reference?.name||n.title}: ${n.reference?.url||""} ${n.reference?.content?.slice(0,300)||""}`).join("\n");
    const autoRetried=new Set(run.messages.filter(m=>m.role==="system"&&m.content.startsWith("Agent mengulang")).map(m=>m.node_id));
    const system=`Kamu agent produksi untuk satu task (satu video) di Faceless Studio. Judul: "${detail.episode.title}". Brief: ${run.brief.slice(0,1500)}
Instruksi workflow: ${run.instructions.slice(0,1500)}
${references?"Referensi:\n"+references:""}
Tahap task sekarang:
${snapshot(run,detail.documents)}

Kamu yang menjalankan task. Balas HANYA JSON: {"reply":"teks untuk pemilik (markdown, Bahasa Indonesia, ringkas)","actions":[...]}.
Aksi yang langsung kamu kerjakan:
- {"type":"run","node_id"?} jalankan tahap berikutnya (atau tahap tertentu). Task lalu maju sendiri sampai butuh keputusan.
- {"type":"approve","node_id"} setujui hasil yang menunggu review — HANYA jika pemilik jelas menyetujui di pesan terakhirnya.
- {"type":"revise","node_id","direction"} ulangi tahap dengan arahan baru (koreksi pemilik, atau perbaikan error dari model).
- {"type":"note","node_id"?,"direction"} simpan arahan untuk tahap yang belum jalan.
Aturan: biaya berbayar tidak pernah kamu setujui; minta pemilik menekan tombol persetujuan. Jika tahap terhenti karena layanan belum diatur (ElevenLabs, Drive, PC render, model), jelaskan cara mengaturnya, jangan diulang. Jangan mengarang hasil. Perubahan resep workflow dilakukan di chat project, bukan di sini.
${trigger==="stopped"?`Task baru saja berhenti sendiri. Laporkan singkat apa yang selesai dan apa yang dibutuhkan sekarang. Untuk hasil yang menunggu review, ringkas isinya dan tanyakan persetujuan. Jika ada tahap gagal karena output model (format, narasi tidak utuh) dan belum pernah kamu ulang${autoRetried.size?` (sudah diulang: ${[...autoRetried].join(", ")})`:""}, ulangi sekali dengan arahan perbaikan.`:"Tanggapi pesan terakhir pemilik."}`;
    const history:ChatMessage[]=[{role:"system",content:system},...run.messages.filter(m=>m.role!=="system").slice(-16).map(m=>({role:m.role==="user"?"user" as const:"assistant" as const,content:m.content.slice(0,3000)}))];
    if(history.length===1||history.at(-1)!.role!=="user")history.push({role:"user",content:trigger==="stopped"?"(Task berhenti. Laporkan statusnya.)":"(Lanjutkan.)"});
    const route=await chatModel();
    const result=await (await routerConnector()).chat(route.model,history,Math.min(route.max_output_tokens||4000,6000));
    let parsed:z.infer<typeof replySchema>;try{parsed=replySchema.parse(parseJsonOutput(result.text));}catch{parsed={reply:result.text,actions:[]};}
    if(parsed.reply.trim())await appendRunMessage(id,"assistant",parsed.reply);
    for(const action of parsed.actions)await perform(id,owner,action,trigger,autoRetried);
  }catch(error){await appendRunMessage(id,"system","Agent belum bisa menjawab: "+(error as Error).message).catch(()=>undefined);}
  finally{thinking.delete(id);}
}

async function perform(id:string,owner:string,action:z.infer<typeof actionSchema>,trigger:Trigger,autoRetried:Set<string|undefined>){
  const {run}=await workflowRunData(id) as {run:WorkflowRun};const node=run.graph.nodes.find(n=>n.id===action.node_id);
  const report=()=>taskAgentTurn(id,owner,"stopped");
  if(action.type==="run"){await advanceWorkflowRun(id,node?{node_id:node.id}:{},owner,report);return;}
  if(!node)return;
  if(action.type==="note"&&action.direction){await appendRunMessage(id,"user",action.direction,node.id);return;}
  if(action.type==="approve"&&trigger==="user"&&run.states[node.id]?.status==="waiting_review"){
    await actWorkflowRun(id,{action:"review",node_id:node.id,document_revision:run.states[node.id].output_revision,expected_revision:run.revision},owner);
    await advanceWorkflowRun(id,{},owner,report);return;
  }
  if(action.type==="revise"){
    // One automatic retry per stage; anything further waits for the owner.
    if(trigger==="stopped"){if(autoRetried.has(node.id))return;await appendRunMessage(id,"system","Agent mengulang "+node.title+" sekali untuk memperbaiki hasilnya.",node.id);}
    if(action.direction)await appendRunMessage(id,"user",action.direction,node.id);
    const fresh=(await workflowRunData(id) as {run:WorkflowRun}).run;
    await actWorkflowRun(id,{action:"revise",node_id:node.id,expected_revision:fresh.revision},owner);
    await advanceWorkflowRun(id,{node_id:node.id},owner,report);
  }
}

// The owner writes in the task chat: store it, then let the agent answer and act in the background.
export async function sendTaskMessage(id:string,input:unknown,owner:string){
  const value=z.object({content:z.string().trim().min(1).max(20_000)}).strict().parse(input);
  await appendRunMessage(id,"user",value.content);
  void taskAgentTurn(id,owner,"user");
  return {...await workflowRunData(id),thinking:true};
}
// Run / Jalankan from the UI: advance, and have the agent report when the task stops.
export async function runTask(id:string,input:unknown,owner:string){
  return advanceWorkflowRun(id,input,owner,()=>taskAgentTurn(id,owner,"stopped"));
}
