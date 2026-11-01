import "server-only";
import {randomUUID} from "node:crypto";
import {z,agentReplySchema,overallScore,parseJsonOutput,stepsToGraph,studioScope,workflowKinds,workflowNodeInfo,type Channel,type ModelRoute,type StudioAction,type StudioMessage,type StudioThread,type VideoAnalysis} from "@studio/core";
import type {ChatMessage} from "@studio/connectors";
import {db,DatabaseError} from "./pocketbase";
import {routerConnector} from "./provider-credentials";
import {saveWorkspace,workspaceRecord,workspaceRows,createProduction} from "./workspace";
import {workflowLibrary,workflowTemplate,createWorkflowTemplate,saveWorkflowTemplate,workflowRunData,actWorkflowRun,messageWorkflowRun} from "./workflows";
import {channelPreferences} from "./workspace";
import {buildN8nWorkflow,getN8nWorkflow,updateN8nWorkflow,listN8nCredentials,createN8nCredential,activateN8nWorkflow,deactivateN8nWorkflow,triggerN8nWorkflow} from "./n8n";
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
    let n8nLiveSummary="Belum ada workflow n8n terhubung.";
    if(prefs.n8n_workflow_id){
      try{
        const [wf,creds]=await Promise.all([getN8nWorkflow(prefs.n8n_workflow_id),listN8nCredentials()]);
        const nodesDesc=wf.nodes.map(n=>{
          const p=n.parameters;
          const paramInfo=p.url?`url: ${p.url}`:p.text?`prompt: "${String(p.text).slice(0,180).replace(/\s+/g," ")}..."`:"";
          return `- "${n.name}" [tipe: ${n.type}${paramInfo?`, ${paramInfo}`:""}]`;
        }).join("\n");
        const connDesc=Object.entries(wf.connections).flatMap(([from,outs])=>
          Object.entries(outs as Record<string,Array<Array<{node:string}>>>).flatMap(([,list])=>
            list.flatMap(targets=>targets.map(t=>`${from} → ${t.node}`))
          )
        ).slice(0,25).join(", ");
        const credsDesc=creds.data.map(c=>`${c.name} (${c.type})`).join(", ");
        n8nLiveSummary=`Workflow n8n aktif project "${name}" (ID: ${wf.id}, total ${wf.nodes.length} node):
Node yang terpasang:
${nodesDesc}
Alur koneksi: ${connDesc}
Output node "Resep Studio" menyediakan field: brief (ide/judul video), instructions, references.
Kredensial n8n terdaftar: ${credsDesc||"hanya openAiApi"}`;
      }catch(e){n8nLiveSummary=`(Info n8n: ${(e as Error).message})`;}
    }
    return `Kamu adalah asisten arsitek workflow untuk project "${name}" (id ${project}) di Restard Studio.
Kamu memiliki HAK AKSES PENUH untuk merancang, mengaudit, dan memodifikasi alur kerja n8n KHUSUS untuk project ini (workflow ID: ${prefs.n8n_workflow_id||""}).
Canvas utama aplikasi ini adalah editor n8n.
PENTING: Jangan minta pemilik menempel JSON manual atau mengedit manual di n8n jika kamu bisa melakukannya via aksi! Kamu punya aksi presisi yang aman tanpa merusak node lain:
- {"type":"add_n8n_node","explanation"?,"node":{"name","type","parameters":{},"typeVersion"?:1,"credentials"?:{}},"connect_from"?:"nama_node_sumber","connect_to"?:"nama_node_tujuan"} — sisipkan node baru (misal n8n-nodes-base.youTube, n8n-nodes-base.httpRequest) secara aman ke alur n8n TANPA merusak node lain.
- {"type":"modify_n8n_node","node_name":"nama_node","prompt"?:"prompt baru","parameters"?:{}} — ubah prompt atau parameter node yang sudah ada di n8n.
- {"type":"remove_n8n_node","node_name":"nama_node"} — hapus satu node dari n8n.
- {"type":"setup_n8n_credential","name":"Nama","credential_type":"tipe","data":{...}} — daftarkan kredensial baru di n8n via API.
- {"type":"publish_n8n_workflow","active":true|false,"explanation"?} — publikasikan/aktifkan (active) atau nonaktifkan workflow n8n project ini.
- {"type":"execute_n8n_workflow","brief"?:"topik uji coba","title"?:"Judul test","explanation"?} — jalankan uji coba eksekusi (test run/execute) workflow n8n project ini langsung dari chat.
- {"type":"edit_template","template_id":"${workflow?.id||""}","instructions"?,"steps":[{"kind","title","instructions","review"}]} — ubah alur tahap tingkat tinggi (Studio otomatis konversi ke node n8n).
- {"type":"add_reference","template_id":"${workflow?.id||""}","name","ref_type":"link|video|image|markdown|file","url","content","instructions","target":"<node id>"} — sambungkan referensi
- {"type":"build_n8n_workflow","name"?} — bangun ulang workflow di n8n dari resep awal
- {"type":"analyze_reference","url"}
Balas HANYA JSON: {"reply":"penjelasan untuk pemilik (jelaskan apa yang kamu tambahkan/ubah di alur n8n)","action":null atau satu aksi}.
Pilihan jenis tahap (kind):
${workflowKinds.filter(k=>k!=="reference").map(k=>`- ${k}: ${workflowNodeInfo[k].description}`).join("\n")}
Tahap workflow saat ini: ${graph?graph.nodes.map(n=>n.id+" ["+n.kind+": \""+n.title+"\"]").join(", ")+" | alur: "+graph.edges.map(e=>e.source+"→"+e.target).join(", "):"belum ada"}
Instruksi bersama: ${(workflow?.instructions||"").slice(0,2000)}
${n8nLiveSummary}
${attached?"Analisis video terlampir:\n"+attached:""}`;
  }
  const attached=analyses.map(r=>r.data).filter(a=>thread.attachments.analyses.includes(a.id));
  const templates=library.templates.map(t=>`- ${t.id} · ${t.name} (channel ${t.channel}): ${t.description.slice(0,200)} | langkah: ${t.graph.nodes.map(n=>n.kind+(n.title!==workflowNodeInfo[n.kind].label?"「"+n.title+"」":"")).join(" → ")}`).join("\n");
  const runs=library.runs.slice(0,8).map(r=>`- run ${r.id} · ${r.template_name} · episode ${r.episode} · ${r.status} · ${r.graph.nodes.map(n=>n.id+":"+(r.states[n.id]?.status||"idle")).join(", ")}`).join("\n");
  const research=attached.map(a=>`### ${a.title} (${a.platform}, skor ${overallScore(a)}/10)\n${a.summary}\nNiche: ${a.niche}\nFormula: ${a.formula.join("; ")}\nSkor: ${Object.entries(a.scores).map(([k,s])=>k+" "+s.score).join(", ")}`).join("\n\n");
  return `Kamu adalah agent produksi di Restard Studio. Kamu membantu pemilik membuat video faceless, merancang template produksi, dan membedah video orang lain. Jawab dalam Bahasa Indonesia, ringkas dan konkret.
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
  const history:ChatMessage[]=[{role:"system",content:await context(thread)+(thread.memory?"\n\nRingkasan percakapan sebelumnya:\n"+thread.memory.replace(/^<!--\d+-->\n?/,""):"")},...thread.messages.slice(-window).map(m=>({role:m.role,content:m.role==="assistant"&&m.action?m.content+"\n[aksi: "+m.action.type+" · status: "+m.action.status+(m.action.result?" · detail/pesan: "+m.action.result:"")+"]":m.content}))];
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
    const saved=await saveWorkflowTemplate(current.id,{name:current.name,description:current.description,channel:current.channel,playbook_path:current.playbook_path,instructions:action.instructions??current.draft?.instructions??current.instructions,graph:action.steps?keepReferences(base,stepsToGraph(action.steps)):base,expected_version:current.version,apply_now:true});
    const channelId=thread.attachments.project||current.channel;
    let n8nNote="";
    if(channelId){
      try{
        const built=await buildN8nWorkflow(channelId);
        n8nNote=" Workflow n8n \""+built.name+"\" ("+built.nodes+" node) diperbarui dan disinkronkan ke editor.";
      }catch(e){
        n8nNote=" (Catatan n8n: "+(e as Error).message+")";
      }
    }
    return {result:"Workflow "+current.name+" diperbarui."+n8nNote,template:current.id};
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
  if(action.type==="build_n8n_workflow"){
    if(!thread.attachments.project)throw new Error("Buka project dulu untuk membangun workflow n8n-nya.");
    const built=await buildN8nWorkflow(thread.attachments.project,{name:action.name});
    return {result:"Workflow n8n \""+built.name+"\" dibuat ("+built.nodes+" node). Buka di tab n8n pada halaman Workflow; pilih credential OpenAI (9Router) di node Model sebelum dijalankan."};
  }
  if(action.type==="add_n8n_node"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id)throw new Error("Akses dibatasi ke workflow project ini.");
    const current=await getN8nWorkflow(targetId);
    if(current.nodes.some(n=>n.name===action.node.name))throw new Error("Node \""+action.node.name+"\" sudah ada.");
    const fromNode=current.nodes.find(n=>n.name===action.connect_from);
    const toNode=current.nodes.find(n=>n.name===action.connect_to);
    let position=action.node.position;
    if(!position){
      if(fromNode&&toNode)position=[Math.round((fromNode.position[0]+toNode.position[0])/2),fromNode.position[1]-70];
      else if(fromNode)position=[fromNode.position[0]+260,fromNode.position[1]];
      else position=[0,0];
    }
    const newNode:any={
      id:randomUUID(),
      name:action.node.name,
      type:action.node.type,
      typeVersion:action.node.typeVersion||1,
      position,
      parameters:action.node.parameters||{},
      ...(action.node.credentials?{credentials:action.node.credentials}:{})
    };
    current.nodes.push(newNode);
    const conn=current.connections as Record<string,Record<string,Array<Array<{node:string;type:string;index:number}>>>>;
    if(action.connect_from){
      const fromOutputs=(conn[action.connect_from]??={})["main"]??=[[]];
      if(fromOutputs.length===0)fromOutputs.push([]);
      if(action.connect_to){
        let found=false;
        for(const outList of fromOutputs){
          const idx=outList.findIndex(c=>c.node===action.connect_to);
          if(idx!==-1){outList[idx]={node:newNode.name,type:"main",index:0};found=true;break;}
        }
        if(!found)fromOutputs[0].push({node:newNode.name,type:"main",index:0});
      }else{
        fromOutputs[0].push({node:newNode.name,type:"main",index:0});
      }
    }
    if(action.connect_to){
      const newOutputs=(conn[newNode.name]??={})["main"]??=[[]];
      newOutputs[0]=[{node:action.connect_to,type:"main",index:0}];
    }
    const updated=await updateN8nWorkflow(targetId,{name:current.name,nodes:current.nodes,connections:current.connections,settings:current.settings||{executionOrder:"v1"}});
    return {result:"Node \""+newNode.name+"\" ("+newNode.type+") berhasil ditambahkan ke alur n8n ("+updated.nodes.length+" node total)."};
  }
  if(action.type==="modify_n8n_node"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id)throw new Error("Akses dibatasi ke workflow project ini.");
    const current=await getN8nWorkflow(targetId);
    const node=current.nodes.find(n=>n.name===action.node_name);
    if(!node)throw new Error("Node \""+action.node_name+"\" tidak ditemukan di workflow ini.");
    if(action.parameters)node.parameters={...node.parameters,...action.parameters};
    if(action.prompt)node.parameters.text=action.prompt;
    await updateN8nWorkflow(targetId,{name:current.name,nodes:current.nodes,connections:current.connections,settings:current.settings||{executionOrder:"v1"}});
    return {result:"Node \""+node.name+"\" berhasil diperbarui di n8n."};
  }
  if(action.type==="remove_n8n_node"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id)throw new Error("Akses dibatasi ke workflow project ini.");
    const current=await getN8nWorkflow(targetId);
    current.nodes=current.nodes.filter(n=>n.name!==action.node_name);
    delete (current.connections as Record<string,any>)[action.node_name];
    for(const from of Object.keys(current.connections)){
      const outs=(current.connections as Record<string,any>)[from];
      for(const type of Object.keys(outs)){
        outs[type]=outs[type].map((group:any[])=>group.filter((c:any)=>c.node!==action.node_name));
      }
    }
    await updateN8nWorkflow(targetId,{name:current.name,nodes:current.nodes,connections:current.connections,settings:current.settings||{executionOrder:"v1"}});
    return {result:"Node \""+action.node_name+"\" berhasil dihapus dari n8n."};
  }
  if(action.type==="update_n8n_workflow"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id){
      throw new Error("Akses dibatasi: hanya diizinkan memodifikasi workflow project ini.");
    }
    const current=await getN8nWorkflow(targetId);
    const updated=await updateN8nWorkflow(targetId,{
      name:current.name,
      nodes:action.nodes as any,
      connections:action.connections as any,
      settings:current.settings||{executionOrder:"v1"}
    });
    return {result:"Workflow n8n \""+current.name+"\" berhasil dimodifikasi langsung ("+updated.nodes.length+" node)."};
  }
  if(action.type==="setup_n8n_credential"){
    const created=await createN8nCredential({name:action.name,type:action.credential_type,data:action.data});
    return {result:"Kredensial n8n \""+created.name+"\" ("+created.type+") berhasil didaftarkan di n8n."};
  }
  if(action.type==="publish_n8n_workflow"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id)throw new Error("Akses dibatasi ke workflow project ini.");
    if(action.active){
      await activateN8nWorkflow(targetId);
      return {result:"Workflow n8n berhasil diaktifkan (published / active)."};
    }else{
      await deactivateN8nWorkflow(targetId);
      return {result:"Workflow n8n berhasil dinonaktifkan."};
    }
  }
  if(action.type==="execute_n8n_workflow"){
    const channelId=thread.attachments.project;
    if(!channelId)throw new Error("Buka project terlebih dahulu.");
    const prefs=await channelPreferences(channelId);
    const targetId=action.workflow_id||prefs.n8n_workflow_id;
    if(!targetId)throw new Error("Workflow n8n belum dibuat untuk project ini.");
    if(prefs.n8n_workflow_id&&targetId!==prefs.n8n_workflow_id)throw new Error("Akses dibatasi ke workflow project ini.");
    const res=await triggerN8nWorkflow(targetId,{brief:action.brief,title:action.title});
    return {result:"Workflow n8n berhasil dipicu untuk uji coba (Eksekusi ID #"+res.execution_id+")."};
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
