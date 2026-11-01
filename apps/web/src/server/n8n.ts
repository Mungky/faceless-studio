import "server-only";
import {randomUUID} from "node:crypto";
import {existsSync,readFileSync} from "node:fs";
import path from "node:path";
import {workflowNodeInfo,type Channel,type ChannelPreferences,type WorkflowNode,type WorkflowRun,type WorkflowTemplate} from "@studio/core";
import {db} from "./pocketbase";
import {documentRevision} from "./service";
import {writeDocument} from "./vault";
import {channelPreferences,saveWorkspace} from "./workspace";
import {ensureProjectWorkspace} from "./project-workspace";
import {workflowLibrary,workflowRunData,updateRun,addMessage} from "./workflows";

// The owner's n8n is the engine behind Studio: workflows, executions, schedules and credentials live
// there. Studio talks to its public API; a Studio project maps to an n8n tag (projects need a paid plan).
type N8nNode={id:string;name:string;type:string;typeVersion:number;position:[number,number];parameters:Record<string,unknown>;webhookId?:string;credentials?:Record<string,{id:string;name:string}>};
type N8nWorkflow={id:string;name:string;active:boolean;nodes:N8nNode[];connections:Record<string,unknown>;tags?:{id:string;name:string}[];updatedAt?:string;settings?:Record<string,unknown>};
type NodeRun={error?:{message:string};data?:{main?:({json:Record<string,unknown>}[]|null)[]}};
type Execution={id:string;status:string;data?:{resultData?:{runData?:Record<string,NodeRun[]>;lastNodeExecuted?:string;error?:{message:string}}}};

// The server may have started before the owner added the n8n lines to .env; read the file then.
function fromEnvFile(name:string){
  for(const file of [path.resolve(process.cwd(),".env"),path.resolve(process.cwd(),"../../.env")]){
    if(!existsSync(file))continue;const line=readFileSync(file,"utf8").split(/\r?\n/).find(l=>l.startsWith(name+"="));
    if(line)return line.slice(name.length+1).trim().replace(/^"|"$/g,"");
  }
  return "";
}
function config(){
  const env=(name:string)=>process.env[name]||fromEnvFile(name);
  const url=env("N8N_URL").replace(/\/+$/,""),key=env("N8N_API_KEY");
  return {url,key,editor:(env("N8N_EDITOR_URL")||"http://127.0.0.1:5679").replace(/\/+$/,""),configured:!!url&&!!key};
}
async function n8n<T>(route:string,init:RequestInit={}):Promise<T>{
  const {url,key,configured}=config();if(!configured)throw new Error("Hubungkan n8n dulu: isi N8N_URL dan N8N_API_KEY di .env.");
  const response=await fetch(url+"/api/v1"+route,{...init,headers:{"X-N8N-API-KEY":key,"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(30_000),cache:"no-store"});
  const text=await response.text();
  if(!response.ok)throw new Error("n8n menolak permintaan ("+response.status+"): "+text.slice(0,300));
  return (text?JSON.parse(text):undefined) as T;
}
async function projectTag(name:string){
  const tags=await n8n<{data:{id:string;name:string}[]}>("/tags?limit=250");
  return tags.data.find(t=>t.name===name)||n8n<{id:string;name:string}>("/tags",{method:"POST",body:JSON.stringify({name})});
}
async function projectContext(channel:string){
  const [project,prefs,library]=await Promise.all([db.get<Channel>("channels",channel),channelPreferences(channel),workflowLibrary()]);
  const workflow=library.templates.find(t=>t.id===prefs.default_template_id)||library.templates.find(t=>t.channel===channel);
  return {project,prefs,workflow,name:prefs.project_name||project.name};
}

export async function n8nProject(channel:string){
  const {url,editor,configured}=config();const {prefs,name}=await projectContext(channel);
  if(!configured)return {configured,editor,url:"",workflows:[],linked:""};
  const all=await n8n<{data:N8nWorkflow[]}>("/workflows?limit=250");
  const workflows=all.data.filter(w=>w.tags?.some(t=>t.name===name)||w.id===prefs.n8n_workflow_id).map(w=>({id:w.id,name:w.name,active:w.active,nodes:w.nodes.length,updated:w.updatedAt||""}));
  return {configured,editor,url,workflows,linked:prefs.n8n_workflow_id};
}

// A Studio stage and its n8n nodes share one name, so a task's progress maps back onto its canvas.
const stageName=(node:WorkflowNode)=>node.title.replace(/[^\p{L}\p{N} &+,.()-]/gu,"").slice(0,60)||workflowNodeInfo[node.kind].label;
const reviewReady=(name:string)=>"Review siap · "+name,reviewWait=(name:string)=>"Review · "+name,reviewDecision=(name:string)=>"Disetujui? · "+name;

// Turns the project's Studio recipe into an n8n workflow. Studio starts it with a webhook that answers
// with the execution id; each stage is an LLM chain on the 9Router model; a review stage records its
// draft and resume link, waits for the owner, and loops back with the owner's feedback until approved.
export function recipeToN8n(name:string,recipe:WorkflowTemplate,options:{model?:string;path?:string;credential?:{id:string;name:string}}={}){
  const graph=recipe.draft?.graph||recipe.graph,instructions=recipe.draft?.instructions??recipe.instructions,model=options.model||"faceless-creation";
  const references=graph.nodes.filter(n=>n.kind==="reference"&&n.reference).map(n=>`### ${n.title}\n${n.reference!.url}\n${n.reference!.content.slice(0,8000)}\n${n.instructions?"Cara pakai: "+n.instructions:""}`).join("\n\n");
  const order:string[]=[];const visit=(id:string)=>{if(order.includes(id))return;graph.edges.filter(e=>e.target===id).forEach(e=>visit(e.source));order.push(id);};graph.nodes.forEach(n=>visit(n.id));
  const stages=order.map(id=>graph.nodes.find(n=>n.id===id)!).filter(n=>n.kind!=="reference"&&n.kind!=="brief");
  const nodes:N8nNode[]=[],connections:Record<string,Record<string,unknown[][]>>={};
  const link=(from:string,to:string,type="main",output=0)=>{const outputs=((connections[from]??={})[type]??=[]);while(outputs.length<=output)outputs.push([]);outputs[output].push({node:to,type,index:0});};
  let x=0;const at=(y=0):[number,number]=>[(x+=260)-260,y];
  nodes.push({id:randomUUID(),name:"Mulai dari Studio",type:"n8n-nodes-base.webhook",typeVersion:2,position:at(),webhookId:randomUUID(),parameters:{httpMethod:"POST",path:options.path||"studio-"+randomUUID().slice(0,8),responseMode:"responseNode",options:{}}});
  nodes.push({id:randomUUID(),name:"Balas ke Studio",type:"n8n-nodes-base.respondToWebhook",typeVersion:1.1,position:at(),parameters:{respondWith:"json",responseBody:"={{ JSON.stringify({ execution_id: $execution.id }) }}",options:{}}});
  nodes.push({id:randomUUID(),name:"Resep Studio",type:"n8n-nodes-base.set",typeVersion:3.4,position:at(),parameters:{assignments:{assignments:[
    {id:randomUUID(),name:"instructions",value:instructions,type:"string"},
    {id:randomUUID(),name:"references",value:references,type:"string"},
    {id:randomUUID(),name:"brief",value:"={{ $('Mulai dari Studio').first().json.body.brief || '' }}",type:"string"}]},options:{}}});
  link("Mulai dari Studio","Balas ke Studio");link("Balas ke Studio","Resep Studio");
  let previous="Resep Studio",previousOutput=0,lastStage="";
  const usedTitles=new Map<string,number>();
  for(const stage of stages){
    const baseTitle=stageName(stage);
    const count=(usedTitles.get(baseTitle)||0)+1;usedTitles.set(baseTitle,count);
    const title=count>1?`${baseTitle} (${count})`:baseTitle;
    const revision=stage.review?[`Masukan pemilik untuk revisi (kosong jika belum ada): {{ $('${reviewWait(title)}').isExecuted ? $('${reviewWait(title)}').last().json.body.feedback : '' }}`,
      `Draf sebelumnya yang perlu direvisi (kosong jika belum ada):\n{{ $('${reviewReady(title)}').isExecuted ? $('${reviewReady(title)}').last().json.draft : '' }}`]:[];
    const prompt=["=Kamu menjalankan satu tahap produksi.","Instruksi workflow:\n{{ $('Resep Studio').first().json.instructions }}","Referensi:\n{{ $('Resep Studio').first().json.references }}","Brief: {{ $('Resep Studio').first().json.brief }}",
      lastStage?`Hasil tahap sebelumnya:\n{{ $('${lastStage}').last().json.text }}`:"",`Tahap: ${title}\n${stage.instructions||workflowNodeInfo[stage.kind].description}`,...revision].filter(Boolean).join("\n\n");
    nodes.push({id:randomUUID(),name:title,type:"@n8n/n8n-nodes-langchain.chainLlm",typeVersion:1.5,position:at(),parameters:{promptType:"define",text:prompt}});
    const chatModel="Model · "+title;
    nodes.push({id:randomUUID(),name:chatModel,type:"@n8n/n8n-nodes-langchain.lmChatOpenAi",typeVersion:1.2,position:[x-260,220],parameters:{model:{__rl:true,mode:"id",value:model},options:{}},...(options.credential?{credentials:{openAiApi:options.credential}}:{})});
    link(chatModel,title,"ai_languageModel");link(previous,title,"main",previousOutput);previous=title;previousOutput=0;lastStage=title;
    if(stage.review){
      nodes.push({id:randomUUID(),name:reviewReady(title),type:"n8n-nodes-base.set",typeVersion:3.4,position:at(),parameters:{assignments:{assignments:[
        {id:randomUUID(),name:"draft",value:`={{ $('${title}').last().json.text }}`,type:"string"},
        {id:randomUUID(),name:"resume_url",value:"={{ $execution.resumeUrl }}",type:"string"}]},options:{}}});
      nodes.push({id:randomUUID(),name:reviewWait(title),type:"n8n-nodes-base.wait",typeVersion:1.1,position:at(),webhookId:randomUUID(),parameters:{resume:"webhook",httpMethod:"POST",options:{}}});
      nodes.push({id:randomUUID(),name:reviewDecision(title),type:"n8n-nodes-base.if",typeVersion:2.2,position:at(),parameters:{conditions:{options:{caseSensitive:true,leftValue:"",typeValidation:"loose",version:2},
        conditions:[{id:randomUUID(),leftValue:"={{ $json.body.approved }}",rightValue:true,operator:{type:"boolean",operation:"true",singleValue:true}}],combinator:"and"},looseTypeValidation:true,options:{}}});
      link(title,reviewReady(title));link(reviewReady(title),reviewWait(title));link(reviewWait(title),reviewDecision(title));
      link(reviewDecision(title),title,"main",1);previous=reviewDecision(title);previousOutput=0;
    }
  }
  return {name,nodes,connections,settings:{executionOrder:"v1"}};
}

// Rebuilding keeps the workflow's id, webhook path and the 9Router credential the owner chose.
export async function buildN8nWorkflow(channel:string,input:{name?:string}={}){
  const {project,prefs,workflow,name}=await projectContext(channel);if(!workflow)throw new Error("Project ini belum punya workflow Studio untuk diterjemahkan.");
  const current=prefs.n8n_workflow_id?await n8n<N8nWorkflow>("/workflows/"+prefs.n8n_workflow_id).catch(()=>undefined):undefined;
  const credential=current?.nodes.map(n=>n.credentials?.openAiApi).find(Boolean)||(await n8n<{data:N8nWorkflow[]}>("/workflows?limit=250")).data.flatMap(w=>w.nodes).map(n=>n.credentials?.openAiApi).find(Boolean);
  const hookPath=current?.nodes.find(n=>n.type==="n8n-nodes-base.webhook")?.parameters.path as string|undefined;
  const body=recipeToN8n(input.name||current?.name||name+" · Studio",workflow,{path:hookPath,credential});
  const saved=current?await n8n<N8nWorkflow>("/workflows/"+current.id,{method:"PUT",body:JSON.stringify(body)}):await n8n<N8nWorkflow>("/workflows",{method:"POST",body:JSON.stringify(body)});
  const tag=await projectTag(name);await n8n("/workflows/"+saved.id+"/tags",{method:"PUT",body:JSON.stringify([{id:tag.id}])});
  if(!current){const next:ChannelPreferences={...prefs,n8n_workflow_id:saved.id};await saveWorkspace("preferences:"+channel,"preferences",channel,{...next,revision:prefs.revision+1},prefs.revision);}
  await ensureProjectWorkspace(project).catch(()=>undefined);
  return {id:saved.id,name:saved.name,nodes:saved.nodes.length,credential:!!credential,editor:config().editor+"/workflow/"+saved.id};
}

export async function getN8nWorkflow(id:string){return n8n<N8nWorkflow>("/workflows/"+id);}
export async function updateN8nWorkflow(id:string,body:Partial<N8nWorkflow>){return n8n<N8nWorkflow>("/workflows/"+id,{method:"PUT",body:JSON.stringify(body)});}
export async function listN8nCredentials(){return n8n<{data:{id:string;name:string;type:string}[]}>("/credentials?limit=100").catch(()=>({data:[]}));}
export async function createN8nCredential(body:{name:string;type:string;data:Record<string,unknown>}){return n8n<{id:string;name:string;type:string}>("/credentials",{method:"POST",body:JSON.stringify(body)});}
export async function activateN8nWorkflow(id:string){return n8n<N8nWorkflow>("/workflows/"+id+"/activate",{method:"POST"});}
export async function deactivateN8nWorkflow(id:string){return n8n<N8nWorkflow>("/workflows/"+id+"/deactivate",{method:"POST"});}
export async function triggerN8nWorkflow(id:string,payload:{brief?:string;title?:string}={}){
  const wf=await getN8nWorkflow(id);
  const hook=wf.nodes.find(n=>n.type==="n8n-nodes-base.webhook");
  if(!hook)throw new Error("Workflow n8n belum memiliki node webhook untuk dipicu.");
  if(!wf.active)await activateN8nWorkflow(id);
  const path=hook.parameters.path as string;
  const res=await fetch(config().url+"/webhook/"+path,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({brief:payload.brief||"",title:payload.title||"Manual Run",task:"test-run-"+randomUUID().slice(0,8)}),
    signal:AbortSignal.timeout(30_000),
    cache:"no-store"
  });
  const data=await res.json().catch(()=>({})) as {execution_id?:string|number};
  return {execution_id:data.execution_id?String(data.execution_id):"triggered",status:res.status};
}

// ---- Running a Studio task on n8n ----
const docOf:Partial<Record<WorkflowNode["kind"],"riset.md"|"script.md"|"storyboard.md"|"upload-pack.md">>={research:"riset.md",script:"script.md",storyboard:"storyboard.md",upload_pack:"upload-pack.md"};
const firstJson=(run?:NodeRun,output=0)=>run?.data?.main?.[output]?.[0]?.json;
const stages=(run:WorkflowRun)=>run.graph.nodes.filter(n=>n.kind!=="reference"&&n.kind!=="brief");
async function execution(id:string){return n8n<Execution>("/executions/"+id+"?includeData=true");}
async function taskRun(id:string){const {run,detail}=await workflowRunData(id);if(!run.n8n)throw new Error("Task ini tidak berjalan di n8n.");return {run,detail,n8nRun:run.n8n};}

async function startExecution(id:string){
  const {run,detail,n8nRun}=await taskRun(id);
  const workflow=await n8n<N8nWorkflow>("/workflows/"+n8nRun.workflow_id);
  const hook=workflow.nodes.find(n=>n.type==="n8n-nodes-base.webhook");
  if(!hook||hook.parameters.responseMode!=="responseNode")throw new Error("Workflow n8n ini belum disiapkan untuk Studio. Bangun ulang dari resep Studio.");
  if(!workflow.active)await n8n("/workflows/"+workflow.id+"/activate",{method:"POST"});
  const response=await fetch(config().url+"/webhook/"+hook.parameters.path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:id,title:detail.episode.title,brief:run.brief}),signal:AbortSignal.timeout(30_000),cache:"no-store"});
  const reply=await response.json().catch(()=>({})) as {execution_id?:string|number};
  if(!response.ok||!reply.execution_id)throw new Error("n8n tidak memulai task ("+response.status+").");
  await updateRun(id,r=>{r.n8n={workflow_id:n8nRun.workflow_id,execution_id:String(reply.execution_id)};
    for(const node of stages(r))r.states[node.id]={status:"idle"};addMessage(r,"system","Task dijalankan di n8n (eksekusi #"+reply.execution_id+").");});
}

// Reads the execution and writes each stage's state, output and review status onto the task.
async function syncExecution(id:string){
  const {n8nRun}=await taskRun(id);if(!n8nRun.execution_id)return undefined;
  const exec=await execution(n8nRun.execution_id),result=exec.data?.resultData,runData=result?.runData||{};
  await updateRun(id,async(run,vault)=>{
    for(const node of stages(run)){
      const name=stageName(node),runs=runData[name]||[],last=runs.at(-1),before=run.states[node.id];
      if(!last){run.states[node.id]={status:"idle"};continue;}
      if(last.error){run.states[node.id]={status:"failed",error:last.error.message};continue;}
      const text=String(firstJson(last)?.text||""),revision=documentRevision(text);let status:"completed"|"waiting_review"|"running"="completed";
      if(node.review){
        const ready=runData[reviewReady(name)]?.length||0,decided=runData[reviewDecision(name)]||[];
        status=decided.length>=runs.length&&(decided.at(-1)?.data?.main?.[0]?.length||0)>0?"completed":ready>=runs.length&&exec.status==="waiting"?"waiting_review":"running";
      }
      const doc=docOf[node.kind];
      run.states[node.id]={status,output:text,output_revision:revision,...(doc?{document:doc}:{})};
      if(before?.output_revision!==revision&&text.trim()){if(doc&&vault)await writeDocument(vault,doc,text);addMessage(run,"assistant",text,node.id);}
    }
    // The stage n8n is working on now: the first one whose inputs are done but has no result yet.
    if(exec.status==="running"&&!stages(run).some(n=>run.states[n.id].status==="running")){
      const next=stages(run).find(n=>run.states[n.id].status==="idle"&&run.graph.edges.filter(e=>e.target===n.id).every(e=>run.states[e.source]?.status==="completed"));
      if(next)run.states[next.id]={status:"running"};
    }
    if(["error","crashed"].includes(exec.status)){
      const failed=stages(run).find(n=>[stageName(n),"Model · "+stageName(n)].includes(result?.lastNodeExecuted||""))||stages(run).find(n=>["running","idle"].includes(run.states[n.id].status));
      const message=result?.error?.message||"Eksekusi n8n gagal.";
      if(failed&&run.states[failed.id].status!=="failed"){run.states[failed.id]={status:"failed",error:message};addMessage(run,"system","n8n berhenti: "+message,failed.id);}
    }
  });
  return exec.status;
}

// Run / Jalankan: start an execution when there is none (or "try again" on a failed stage), then
// follow it until n8n waits for a review, finishes or stops. The task chat reports afterwards.
// It never hangs: Stop ends it, n8n being unreachable for about 30 s ends it, and after 30 minutes it
// hands back with the stage still running in n8n (Sinkronkan or Jalankan picks it up again).
export async function n8nAdvance(id:string,node?:string,alive:()=>boolean=()=>true){
  const note=(text:string)=>updateRun(id,r=>addMessage(r,"system",text)).catch(()=>undefined);
  try{
    const {run,n8nRun}=await taskRun(id);
    const status=n8nRun.execution_id?(await execution(n8nRun.execution_id).catch(()=>undefined))?.status:undefined;
    const stopped=Object.values(run.states).some(s=>s.status==="blocked"||s.status==="failed");
    if(!status||["canceled","error","crashed"].includes(status)&&(stopped||!!node))await startExecution(id);
    let failures=0;
    for(let tick=0;tick<600;tick++){
      if(!alive())return;
      const current=await syncExecution(id).then(value=>{failures=0;return value;},error=>{if(++failures>=10)throw error;return "running";});
      if(current&&!["running","new"].includes(current))return;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
    await note("n8n masih mengerjakan task ini setelah 30 menit. Tekan Sinkronkan atau Lanjutkan untuk memantaunya lagi.");
  }catch(error){if(alive())await note("n8n: "+(error as Error).message);}
}
// Asks n8n to stop an execution (running, or waiting at a review).
export async function stopN8nExecution(id:string){await n8n("/executions/"+id+"/stop",{method:"POST"});}

// Approve, revise and sync from the task card or the task agent.
export async function n8nAction(id:string,input:{action:string;node_id?:string;document_revision?:string}){
  const {run,n8nRun}=await taskRun(id);
  if(input.action==="sync"){await syncExecution(id);return workflowRunData(id);}
  const node=stages(run).find(n=>n.id===input.node_id);if(!node)throw new Error("Pilih tahap yang ada di task ini.");
  const state=run.states[node.id];
  if(input.action==="review"||input.action==="revise"){
    if(state?.status!=="waiting_review"){
      if(input.action==="review")throw new Error(node.title+" tidak sedang menunggu review.");
      // A stage n8n already passed cannot be rewound inside the same execution; start the task again.
      await startExecution(id);return workflowRunData(id);
    }
    if(input.action==="review"&&input.document_revision!==state.output_revision)throw new Error("Hasil berubah setelah ditampilkan. Muat ulang sebelum menyetujui.");
    const feedback=input.action==="revise"?[...run.messages].reverse().find(m=>m.role==="user"&&m.node_id===node.id)?.content||[...run.messages].reverse().find(m=>m.role==="user")?.content||"Perbaiki hasil ini.":"";
    const exec=await execution(n8nRun.execution_id!);
    const link=String(firstJson(exec.data?.resultData?.runData?.[reviewReady(stageName(node))]?.at(-1))?.resume_url||"");
    if(!link)throw new Error("Tautan lanjut dari n8n tidak ditemukan untuk "+node.title+".");
    // n8n may know itself by an internal address; send the resume to the address Studio uses.
    const resume=new URL(link),base=new URL(config().url);resume.protocol=base.protocol;resume.host=base.host;
    const response=await fetch(resume,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approved:input.action==="review",feedback}),signal:AbortSignal.timeout(30_000),cache:"no-store"});
    if(!response.ok)throw new Error("n8n menolak lanjut ("+response.status+"): "+(await response.text()).slice(0,200));
    await updateRun(id,r=>{r.states[node.id]={...r.states[node.id],status:"running"};addMessage(r,"system",input.action==="review"?node.title+" disetujui. n8n lanjut.":node.title+" direvisi di n8n dengan arahanmu.",node.id);});
    return workflowRunData(id);
  }
  throw new Error("Di n8n, biaya dan persiapan tahap diatur di workflow n8n-nya.");
}
