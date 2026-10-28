import "server-only";
import { randomUUID } from "node:crypto";
import { z, recordId, segment, defaultWorkflowGraph, validateWorkflowGraph, readyWorkflowNodes, type Channel, type WorkflowTemplate, type WorkflowRun, type WorkflowNode, type WorkflowNodeState, type WorkflowMessage, type SpendQuote, type SpendLog, type Asset, type Job, type QuoteRequest } from "@studio/core";
import { db, filterValue, DatabaseError } from "./pocketbase";
import { episodeDetails, createEpisode, makeQuote, approveQuote, queueLocalJob, documentRevision, workflowBeatAsset } from "./service";
import { readPlaybook, safeVaultPath } from "./vault";
import { validateStoryboardCoverage } from "@studio/core";

type Detail = Awaited<ReturnType<typeof episodeDetails>>;
type TemplateRecord = {id:string;key:string;data:WorkflowTemplate;created:string;updated:string};
type QuoteGuard = {id:string;revisions:Record<string,string>;assets:string[];jobs:string[]};
type RunMeta = {quotes:Record<string,QuoteGuard>;vault_path?:string};
type RunRecord = {id:string;data:WorkflowRun;meta:RunMeta;created:string;updated:string};
const locks = new Map<string,Promise<unknown>>();
async function serialize<T>(key:string,fn:()=>Promise<T>):Promise<T> {
  const prior=locks.get(key)||Promise.resolve();
  const next=prior.catch(()=>{}).then(fn);locks.set(key,next);
  try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}
}
const conflict=(message:string):never=>{throw new DatabaseError(409,message);};
const idSchema=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const templateInput=z.object({name:z.string().trim().min(1).max(120),description:z.string().max(2000).default(""),channel:recordId,playbook_path:z.string().max(300).optional(),instructions:z.string().max(20_000).default(""),graph:z.unknown().optional()});
const actionInput=z.object({action:z.enum(["prepare","approve","review","sync","revise"]),node_id:idSchema.optional(),quote_id:recordId.optional(),document_revision:z.string().regex(/^[a-f0-9]{64}$/).optional(),expected_revision:z.number().int().min(0)}).strict();
const docs={research:"riset.md",script:"script.md",storyboard:"storyboard.md",upload_pack:"upload-pack.md"} as const;
const builtins=[{id:"arthur",name:"Arthur",channel:"arthur000000001",path:"Arthur/Arthur.md",description:"Arthur Shorts: research, topic choice, complete script, visual plan and production."},{id:"not-yet",name:"Not Yet",channel:"notyet000000001",path:"Not Yet/Not Yet.md",description:"Fable Shorts: source research, five concepts, complete script, visual plan and production."}];
function builtinGraph() {
  const graph=defaultWorkflowGraph();
  graph.nodes.find(n=>n.kind==="research")!.instructions="Follow the existing playbook research stage. Identify five topic leads with a visual mechanism and ending. Cite only supplied, verified evidence; clearly mark links, views and dates that need verification. Pause for the user's topic choice.";
  graph.nodes.find(n=>n.kind==="script")!.instructions="Follow the playbook complete-script stage, including estimated length, hook alternatives, editorial hook and virality scores. Preserve the chosen topic. Pause for approval of the complete script and chosen hook.";
  graph.nodes.find(n=>n.kind==="storyboard")!.instructions="Follow the playbook visual-plan stage: complete tagged narration, every visual beat, sound and music plan. Preserve the entire approved narration. Pause for visual-plan review before any production.";
  graph.nodes.find(n=>n.kind==="review")!.instructions="Inspect the actual rendered file against the existing playbook quality checklist before preparing the upload pack. Publication remains manual.";
  return graph;
}
function publicTemplate(record:TemplateRecord):WorkflowTemplate {
  return {...record.data,id:record.key,graph:validateWorkflowGraph(record.data.graph),updated:record.updated,builtin:builtins.some(b=>b.id===record.key)};
}
async function builtinTemplates() {
  const channels=await db.list<Channel>("channels");
  return builtins.map(item=>{const channel=channels.find(c=>c.id===item.channel)||channels.find(c=>c.name.toLowerCase()===item.name.toLowerCase());
    const value:WorkflowTemplate={id:item.id,name:item.name,description:item.description,channel:channel?.id||item.channel,playbook_path:channel?.playbook_path||item.path,instructions:"Follow the existing playbook in full. Its content language and required approval pauses are authoritative. Never claim live research without verified source evidence. No automatic publishing.",graph:builtinGraph(),version:"builtin-v1",updated:"",builtin:true};
    value.version="builtin-"+documentRevision(JSON.stringify(value)).slice(0,20);return value;});
}
export async function workflowLibrary() {
  const [defaults,overrides,records]=await Promise.all([builtinTemplates(),db.list<TemplateRecord>("workflow_templates"),db.list<RunRecord>("workflow_runs")]);
  const templates=new Map(defaults.map(t=>[t.id,t]));for(const record of overrides)templates.set(record.key,publicTemplate(record));
  return {templates:[...templates.values()],runs:records.map(publicRun)};
}
export async function workflowTemplate(id:string) {
  idSchema.parse(id);const [record]=await db.list<TemplateRecord>("workflow_templates",`key=${filterValue(id)}`);
  if(record)return publicTemplate(record);
  const builtin=(await builtinTemplates()).find(t=>t.id===id);if(!builtin)throw new DatabaseError(404,"Workflow template was not found");return builtin;
}
async function checkedTemplate(input:unknown,base?:WorkflowTemplate) {
  const parsed=templateInput.parse(input);const channel=await db.get<Channel>("channels",parsed.channel);
  const playbook=parsed.playbook_path??(base?.channel===channel.id?base.playbook_path:channel.playbook_path);
  if(playbook){playbook.split("/").forEach(p=>segment.parse(p));await safeVaultPath(playbook);await readPlaybook(playbook);}
  const graph=validateWorkflowGraph(parsed.graph??defaultWorkflowGraph());
  if(base?.builtin)assertPlaybookGraph(graph);
  return {...parsed,playbook_path:playbook||"",graph};
}
function assertPlaybookGraph(graph:WorkflowRun["graph"]) {
  const kinds=["research","script","storyboard","render","review"] as const;
  const stages=kinds.map(kind=>{const nodes=graph.nodes.filter(n=>n.kind===kind);if(nodes.length!==1)throw new Error(`The existing playbook requires one ${kind} approval stage.`);return nodes[0];});
  for(let i=1;i<stages.length;i++)if(!descendants(graph,stages[i-1].id).has(stages[i].id))throw new Error("Keep the playbook research, script, visual-plan, render and final-review stages connected in order.");
  for(const node of graph.nodes)if(["voiceover","media"].includes(node.kind)&&!descendants(graph,stages[2].id).has(node.id))throw new Error("Playbook production must follow the approved visual plan.");
  for(const node of graph.nodes)if(node.kind==="upload_pack"&&!descendants(graph,stages[4].id).has(node.id))throw new Error("The playbook final review must precede the upload pack.");
}
export async function createWorkflowTemplate(input:unknown) {
  const value=await checkedTemplate(input);const id="workflow-"+randomUUID();
  const data:WorkflowTemplate={...value,id,version:randomUUID(),updated:"",builtin:false};
  return publicTemplate(await db.create<TemplateRecord>("workflow_templates",{key:id,data}));
}
export async function saveWorkflowTemplate(id:string,input:unknown) {
  return serialize("template:"+id,async()=>{
    const expected=z.object({expected_version:z.string().min(1),graph:z.unknown()}).parse(input);
    const current=await workflowTemplate(id);if(current.version!==expected.expected_version)conflict("This template changed. Reload the current version before saving.");
    const value=await checkedTemplate(input,current);
    const data:WorkflowTemplate={...value,id,version:randomUUID(),updated:"",builtin:current.builtin};
    const [record]=await db.list<TemplateRecord>("workflow_templates",`key=${filterValue(id)}`);
    return publicTemplate(record?await db.update<TemplateRecord>("workflow_templates",record.id,{data}):await db.create<TemplateRecord>("workflow_templates",{key:id,data}));
  });
}
function publicRun(record:RunRecord):WorkflowRun {
  return {...record.data,id:record.id,graph:validateWorkflowGraph(record.data.graph),created:record.created,updated:record.updated};
}
async function loadRun(id:string){recordId.parse(id);const record=await db.get<RunRecord>("workflow_runs",id);record.data=publicRun(record);record.meta=record.meta||{quotes:{}};record.meta.quotes=record.meta.quotes||{};return record;}
function addMessage(run:WorkflowRun,role:WorkflowMessage["role"],content:string,node_id?:string){run.messages.push({id:randomUUID(),role,content,node_id,created_at:new Date().toISOString()});}
function updateStatus(run:WorkflowRun) {
  const ready=new Set(readyWorkflowNodes(run.graph,run.states).map(n=>n.id));
  for(const node of run.graph.nodes){const state=run.states[node.id]??={status:"idle"};if(["idle","ready"].includes(state.status))state.status=ready.has(node.id)?"ready":"idle";}
  const states=Object.values(run.states);run.status=states.every(s=>s.status==="completed")?"completed":states.some(s=>s.status==="running")?"running":states.some(s=>s.status==="failed")?"failed":states.some(s=>["waiting_approval","waiting_review","blocked"].includes(s.status))?"waiting":"idle";
}
async function persist(record:RunRecord) {
  updateStatus(record.data);record.data.revision++;
  return db.update<RunRecord>("workflow_runs",record.id,{data:record.data,meta:record.meta});
}
async function result(record:RunRecord){return {run:publicRun(record),detail:await episodeDetails(record.data.episode)};}
export async function createWorkflowRun(input:unknown,owner:string) {
  recordId.parse(owner);const parsed=z.object({template:idSchema,title:z.string().trim().min(1).max(200),brief:z.string().trim().min(1).max(30_000)}).strict().parse(input);
  const template=await workflowTemplate(parsed.template);const channel=await db.get<Channel>("channels",template.channel);
  if(template.playbook_path)await readPlaybook(template.playbook_path);
  await safeVaultPath(channel.name,true);
  // Fail before creating a production when persistence is unavailable or not migrated.
  await db.list<RunRecord>("workflow_runs","","-created",1);
  // This is an explicit new production. Imported YouTube catalog records are never reused.
  const episode=await createEpisode({channel:channel.id,title:parsed.title,format:"short",youtube_video_id:""});
  await db.update("episodes",episode.id,{script_meta:{...episode.script_meta,workflow_context:{playbook_path:template.playbook_path,instructions:template.instructions}}});
  const run:WorkflowRun={id:"",template_id:template.id,template_name:template.name,channel:channel.id,episode:episode.id,graph:structuredClone(template.graph),playbook_path:template.playbook_path,instructions:template.instructions,brief:parsed.brief,status:"idle",states:{},messages:[],revision:0,created:"",updated:""};
  addMessage(run,"user",parsed.brief);addMessage(run,"system","Production created from the saved workflow. Prepare a stage to inspect its requirements and spending quote. No provider has been called.");updateStatus(run);
  try{return result(await db.create<RunRecord>("workflow_runs",{data:run,meta:{quotes:{},vault_path:episode.vault_path}}));}
  catch(error){
    // An HTTP failure may follow a successful insert. Reconcile it without duplicating production.
    const records=await db.list<RunRecord>("workflow_runs").catch(()=>[]);
    const saved=records.find(record=>record.data.episode===episode.id);if(saved)return result(saved);
    await db.update("episodes",episode.id,{script_meta:{...episode.script_meta,workflow_context:{playbook_path:template.playbook_path,instructions:template.instructions},workflow_creation_failed:true}}).catch(()=>{});
    throw new Error(`Production ${episode.id} was created, but its workflow conversation could not be saved. Recover this production in Production tools before starting another. ${(error as Error).message}`);
  }
}
export async function workflowRunData(id:string){return result(await loadRun(id));}
function assertRevision(record:RunRecord,expected:number){if(record.data.revision!==expected)conflict("This production changed. Reload the current revision before continuing.");}
function assertRunContext(record:RunRecord,detail:Detail) {
  const run=record.data;
  const context=detail.episode.script_meta?.workflow_context as {playbook_path?:string;instructions?:string}|undefined;
  if(detail.episode.channel!==run.channel||detail.episode.youtube_video_id||!record.meta.vault_path||detail.episode.vault_path!==record.meta.vault_path||context?.playbook_path!==run.playbook_path||context.instructions!==run.instructions)conflict("The production channel, vault or playbook context changed. Reconcile it in Production tools before continuing this workflow.");
}
function nodeFor(run:WorkflowRun,id?:string){const node=run.graph.nodes.find(n=>n.id===id);if(!node)throw new Error("Select an existing workflow stage");return node;}
export async function messageWorkflowRun(id:string,input:unknown,owner:string) {
  recordId.parse(owner);const parsed=z.object({content:z.string().trim().min(1).max(20_000),node_id:idSchema.optional(),expected_revision:z.number().int().min(0)}).strict().parse(input);
  return serialize("run:"+id,async()=>{const record=await loadRun(id);assertRevision(record,parsed.expected_revision);if(parsed.node_id)nodeFor(record.data,parsed.node_id);
    assertRunContext(record,await episodeDetails(record.data.episode));
    if(record.data.messages.length>=1000)throw new Error("This production conversation is full. Start a new workflow run.");
    addMessage(record.data,"user",parsed.content,parsed.node_id);
    for(const [nodeId,state] of Object.entries(record.data.states))if(state.status==="waiting_approval"){record.data.states[nodeId]={status:"idle"};delete record.meta.quotes[nodeId];}
    addMessage(record.data,"system","Direction saved. It will be included when you prepare or revise a stage. Any unapproved quotes were invalidated.",parsed.node_id);
    return result(await persist(record));});
}
function needsReview(run:WorkflowRun,node:WorkflowNode){return node.review||(builtins.some(b=>b.id===run.template_id)&&["research","script","storyboard","review"].includes(node.kind));}
function finishNode(record:RunRecord,node:WorkflowNode,state:WorkflowNodeState) {
  record.data.states[node.id]={...state,status:needsReview(record.data,node)?"waiting_review":"completed",error:undefined};
}
function assetHash(assets:Asset[]){return documentRevision(JSON.stringify(assets.map(a=>({id:a.id,kind:a.kind,drive_path:a.drive_path,meta:a.meta})).sort((a,b)=>a.id.localeCompare(b.id))));}
function actualAssets(node:WorkflowNode,detail:Detail) {
  const kind=node.kind==="voiceover"?"vo":node.kind==="render"||node.kind==="review"?"render":node.media_kind||"image";
  return detail.assets.filter(a=>a.selected&&a.kind===kind&&a.drive_path);
}
function checkManual(node:WorkflowNode,detail:Detail) {
  const assets=actualAssets(node,detail);
  if(!assets.length)throw new Error(node.kind==="review"?"Complete a render and select its output before final review.":`Import and select ${node.kind==="voiceover"?"voiceover":node.kind==="media"?node.media_kind||"image":"render"} assets in Production tools, then sync this stage.`);
  if(node.kind==="voiceover"&&assets.length!==1)throw new Error("Select exactly one voiceover take in Production tools, then sync. Existing takes are preserved.");
  if(node.kind==="media") {
    if(detail.storyboard_error||!detail.beats.length)throw new Error("Save a valid visual plan before selecting footage.");
    if(detail.beats.some(beat=>!workflowBeatAsset(beat,node.media_kind||"image",assets)))throw new Error("Select a matching media asset for every storyboard beat in Production tools, then sync.");
  }
  return {assets,revision:assetHash(assets)};
}
function quoteGuard(detail:Detail,id:string):QuoteGuard{return {id,revisions:{...detail.revisions},assets:detail.assets.map(a=>a.id),jobs:detail.jobs.map(j=>j.id)};}
function assertSources(guard:QuoteGuard,detail:Detail){for(const [name,revision] of Object.entries(guard.revisions))if(detail.revisions[name as keyof typeof detail.revisions]!==revision)conflict("A source document changed after this quote. Revise the stage and prepare a fresh quote.");}
function assertPrecedingOutputs(run:WorkflowRun,node:WorkflowNode,detail:Detail) {
  for(const previous of run.graph.nodes) {
    if(previous.id===node.id||!descendants(run.graph,previous.id).has(node.id))continue;
    const state=run.states[previous.id];if(state?.status!=="completed"||!state.output_revision)continue;
    const current=state.document?detail.revisions[state.document]:["voiceover","media","render","review"].includes(previous.kind)?assetHash(actualAssets(previous,detail)):state.output_revision;
    if(current!==state.output_revision)conflict(`${previous.title} output changed since review. Revise that stage before executing its dependent stages.`);
  }
}
function context(run:WorkflowRun,node:WorkflowNode) {
  const preceding=new Set(run.graph.nodes.filter(previous=>descendants(run.graph,previous.id).has(node.id)).map(previous=>previous.id));
  const direction=run.messages.filter(m=>m.role==="user"&&(!m.node_id||preceding.has(m.node_id))).map(m=>`[${m.node_id?run.graph.nodes.find(stage=>stage.id===m.node_id)?.title||m.node_id:"Production direction"}]\n${m.content}`).join("\n\n");
  const text=`Production brief:\n${run.brief}\n\nWorkflow instructions:\n${run.instructions}\n\nStage: ${node.title}\n${node.instructions}\n\nSaved user direction:\n${direction}`;
  if(text.length>100_000)throw new Error("Production direction exceeds the provider input limit. Start a new production with a shorter brief.");return text;
}
async function prepare(record:RunRecord,node:WorkflowNode,owner:string,detail:Detail) {
  const run=record.data,state=run.states[node.id];
  if(state&&["waiting_approval","waiting_review","running","completed"].includes(state.status))throw new Error("This stage already has an active result. Review, sync or revise it first.");
  if(state?.status==="failed")throw new Error("Review the failed operation, then explicitly revise before preparing a new quote.");
  if(state?.quote)throw new Error("This stage still has a provider quote or outcome. Sync it, then explicitly revise before preparing another quote.");
  if(!readyWorkflowNodes(run.graph,run.states).some(n=>n.id===node.id))throw new Error("Complete and review the connected preceding stages first.");
  assertPrecedingOutputs(run,node,detail);
  try {
    if(node.kind==="brief"){run.states[node.id]={status:"completed",output:run.brief,output_revision:documentRevision(run.brief)};return;}
    if(node.kind==="review"||(["media","voiceover"].includes(node.kind)&&node.provider==="manual")||(node.kind==="media"&&!node.provider)){const actual=checkManual(node,detail);finishNode(record,node,{status:"completed",output:`${actual.assets.length} selected ${node.kind==="review"?"render":node.kind==="voiceover"?"voiceover":"media"} asset(s) ready for inspection in Production tools.`,output_revision:actual.revision});return;}
    if(node.kind==="render") {
      const job=await queueLocalJob({episode:run.episode,type:"render",prompt:context(run,node),lyrics:"",seconds:30,seed:42});
      run.states[node.id]={status:"running",job_id:job.id,output:"Render queued. A connected Windows worker must complete it."};return;
    }
    let operation:QuoteRequest["operation"];
    const input=context(run,node);let beat:number|undefined;
    if(node.kind==="voiceover") {
      if(!detail.episode.script_approved)throw new Error("Approve the current complete script before generating voiceover.");
      operation="vo";
    } else if(node.kind==="media") {
      if(detail.storyboard_error||!detail.beats.length)throw new Error("Save and review a valid visual plan before generating media.");
      const wanted=node.media_kind||"image";const current=actualAssets(node,detail);
      const missing=detail.beats.find(b=>!workflowBeatAsset(b,wanted,current));
      if(!missing){const actual=checkManual(node,detail);finishNode(record,node,{status:"completed",output:"Selected media covers every storyboard beat.",output_revision:actual.revision});return;}
      operation=wanted;beat=missing.index;
    } else operation=node.kind as QuoteRequest["operation"];
    const quote=await makeQuote({episode:run.episode,operation,input:node.kind==="voiceover"?detail.documents["script.md"]:node.kind==="media"?`${input}\n\nBeat ${beat}: ${detail.beats.find(b=>b.index===beat)!.prompt}`:input,...(node.kind==="media"?{provider:node.provider==="webhook"?"webhook" as const:"flow" as const,beat}: {})},owner,run.id);
    record.meta.quotes[node.id]=quoteGuard(detail,quote.id);run.states[node.id]={status:"waiting_approval",quote,beat};
    addMessage(run,"system",`${node.title} quote prepared. Explicit approval is required before a provider operation.`,node.id);
  }catch(error){run.states[node.id]={status:"blocked",error:(error as Error).message};addMessage(run,"system",`${node.title} is blocked: ${(error as Error).message}`,node.id);}
}
async function readOutcome(record:RunRecord,node:WorkflowNode,detail:Detail) {
  const state=record.data.states[node.id];if(!state)return;
  if(state.status==="completed")return;
  if(state.status==="waiting_review"){
    if(state.document&&detail.revisions[state.document]!==state.output_revision){
      assertPrecedingOutputs(record.data,node,detail);const output=detail.documents[state.document];
      if(!output.trim())throw new Error("The edited document is empty. Restore its content in Production tools before review.");
      if(node.kind==="storyboard"&&detail.storyboard_error)throw new Error("Fix the edited visual plan in Production tools before review.");
      if(node.kind==="storyboard")validateStoryboardCoverage(detail.documents["script.md"],detail.beats);
      state.output=output;state.output_revision=detail.revisions[state.document];state.error=undefined;
      addMessage(record.data,"system",`${node.title} was edited manually. The current saved document is ready for a new exact revision review.`,node.id);
    }
    return;
  }
  if(state.job_id) {
    const job=detail.jobs.find(j=>j.id===state.job_id);if(!job)throw new Error("The workflow job was not found in this production");
    if(["queued","running"].includes(job.status)){state.status="running";state.output=job.status==="queued"?"Queued for the Windows worker. No output is ready yet.":`Worker is running (${Math.round(job.progress||0)}%).`;return;}
    if(job.status!=="done"){state.status="failed";state.error=`Job ${job.status}. Inspect its log in Production tools before revising.`;return;}
    const asset=detail.assets.find(a=>a.id===job.result_asset&&a.episode===record.data.episode);
    if(!asset) {state.status="blocked";state.error="The finished job has no matching production asset. Inspect the worker result.";return;}
    if(node.kind==="media"){try{const actual=checkManual(node,detail);finishNode(record,node,{...state,output:"Generated media covers every storyboard beat.",output_revision:actual.revision});}catch{state.status="idle";state.output="Beat generated. Prepare the next missing beat; each generation requires a new approval.";delete state.quote;delete record.meta.quotes[node.id];}return;}
    finishNode(record,node,{...state,output:`${asset.kind} output saved. Inspect the actual asset in Production tools.`,output_revision:assetHash(actualAssets(node,detail))});return;
  }
  if(state.quote) {
    const quote=await db.get<SpendQuote>("spend_quotes",state.quote.id);if(quote.episode!==record.data.episode)throw new Error("Quote does not belong to this production");
    const [spend]=await db.list<SpendLog & {asset?:string}>("spend_log",`quote=${filterValue(quote.id)}`);
    if(spend?.job){state.job_id=spend.job;return readOutcome(record,node,detail);}
    if(!quote.consumed){if(Date.parse(quote.expires)<=Date.now()){state.status="blocked";state.error="This quote expired. Revise the stage and prepare a fresh quote.";}return;}
    if(!spend||spend.status==="reserved"){state.status="blocked";state.error="Provider outcome is unresolved. Inspect Spending before any revision or retry.";return;}
    if(spend.status!=="done"){state.status="failed";state.error="The provider operation failed. Inspect Spending and its outcome before revising; Studio never retries automatically.";return;}
    if(node.kind in docs) {
      const document=docs[node.kind as keyof typeof docs],output=detail.documents[document];
      if(!output.trim()){state.status="blocked";state.error="The provider completed without a readable saved document. Inspect Production tools.";return;}
      finishNode(record,node,{...state,document,output,output_revision:detail.revisions[document]});
      if(!record.data.messages.some(m=>m.role==="assistant"&&m.node_id===node.id&&m.content===output))addMessage(record.data,"assistant",output,node.id);
    } else {
      if(node.kind==="media"){try{const actual=checkManual(node,detail);finishNode(record,node,{...state,output:"Generated media covers every storyboard beat.",output_revision:actual.revision});}catch{state.status="idle";state.output="Beat generated. Prepare the next missing beat; each generation requires a new approval.";delete state.quote;delete record.meta.quotes[node.id];}return;}
      const actual=checkManual(node,detail);finishNode(record,node,{...state,output:"Voiceover saved. Inspect the actual audio in Production tools.",output_revision:actual.revision});
    }
  } else if(["media","voiceover","review"].includes(node.kind)&&["blocked","idle","ready"].includes(state.status)){
    if(!record.data.graph.edges.filter(e=>e.target===node.id).every(e=>record.data.states[e.source]?.status==="completed"))return;
    try {const actual=checkManual(node,detail);finishNode(record,node,{...state,output:"Selected assets are ready for inspection in Production tools.",output_revision:actual.revision});}catch(error){state.status="blocked";state.error=(error as Error).message;}
  }
}
function descendants(graph:WorkflowRun["graph"],id:string){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const edge of graph.edges)if(found.has(edge.source)&&!found.has(edge.target)){found.add(edge.target);changed=true;}}return found;}
async function assertSafeRevision(record:RunRecord,ids:Set<string>,detail:Detail) {
  if(detail.jobs.some(j=>["queued","running"].includes(j.status)))conflict("This production has an active job. Wait for or explicitly cancel it in Production tools before revising.");
  for(const id of ids){const state=record.data.states[id];if(!state?.quote)continue;
    const quote=await db.get<SpendQuote>("spend_quotes",state.quote.id);
    if(quote.episode!==record.data.episode)conflict("Quote scope mismatch; inspect this production before revising.");
    if(quote.consumed){const [spend]=await db.list<SpendLog>("spend_log",`quote=${filterValue(quote.id)}`);if(!spend||spend.status==="reserved"||(spend.status==="failed"&&["vo","image","video"].includes(quote.operation)))conflict("A provider call has an unresolved or ambiguous outcome. Reconcile it in Spending before revising; do not submit another paid request.");}
  }
}
export async function actWorkflowRun(id:string,input:unknown,owner:string) {
  recordId.parse(owner);const parsed=actionInput.parse(input);
  return serialize("run:"+id,async()=>{
    const record=await loadRun(id);assertRevision(record,parsed.expected_revision);const run=record.data;let detail=await episodeDetails(run.episode);
    assertRunContext(record,detail);
    if(parsed.action==="prepare") {
      const brief=run.graph.nodes.find(n=>n.kind==="brief")!;if(run.states[brief.id]?.status!=="completed")await prepare(record,brief,owner,detail);
      const node=parsed.node_id?nodeFor(run,parsed.node_id):readyWorkflowNodes(run.graph,run.states).find(n=>n.kind!=="brief");
      if(node&&node.kind!=="brief")await prepare(record,node,owner,detail);
    } else if(parsed.action==="approve") {
      const node=nodeFor(run,parsed.node_id),state=run.states[node.id],guard=record.meta.quotes[node.id];
      if(!parsed.quote_id||state?.status!=="waiting_approval"||state.quote?.id!==parsed.quote_id||guard?.id!==parsed.quote_id)conflict("This stage has no matching current quote awaiting approval.");
      if(!run.graph.edges.filter(e=>e.target===node.id).every(e=>run.states[e.source]?.status==="completed"))conflict("A preceding stage is no longer approved.");
      const quote=await db.get<SpendQuote>("spend_quotes",parsed.quote_id!);
      if(quote.episode!==run.episode||quote.operation!==state.quote!.operation||quote.provider!==state.quote!.provider)conflict("This quote belongs to a different production or operation.");
      if(quote.consumed)conflict("This quote was already approved. Sync to inspect its result; it cannot be replayed.");
      assertPrecedingOutputs(run,node,detail);
      assertSources(guard,detail);
      // Persist intent before calling a provider. A crashed request cannot look like an untouched quote.
      state.status="running";await db.update("workflow_runs",record.id,{data:run,meta:record.meta});
      try {const approved=await approveQuote(parsed.quote_id!,owner,run.id);if("job" in approved&&approved.job)state.job_id=approved.job.id;detail=await episodeDetails(run.episode);await readOutcome(record,node,detail);}
      catch(error){state.status="blocked";state.error=`Approval outcome requires inspection: ${(error as Error).message}. Sync before considering a retry.`;addMessage(run,"system",state.error,node.id);}
    } else if(parsed.action==="sync") {
      const nodes=parsed.node_id?[nodeFor(run,parsed.node_id)]:run.graph.nodes;
      for(const node of nodes)await readOutcome(record,node,detail);
    } else if(parsed.action==="review") {
      const node=nodeFor(run,parsed.node_id),state=run.states[node.id];
      if(state?.status!=="waiting_review"||!state.output_revision||!parsed.document_revision||state.output_revision!==parsed.document_revision)conflict("Review must match the exact current output revision.");
      const current=state.document?detail.revisions[state.document]:checkManual(node,detail).revision;
      if(current!==parsed.document_revision)conflict("The output changed after it was shown. Sync or revise this stage before reviewing the current revision.");
      if(node.kind==="script")await db.update("episodes",run.episode,{script_approved:true,script_meta:{...detail.episode.script_meta,approved_revision:current}});
      state.status="completed";addMessage(run,"system",`${node.title} reviewed at revision ${current.slice(0,12)}.`,node.id);
    } else {
      const node=nodeFor(run,parsed.node_id);const ids=descendants(run.graph,node.id);await assertSafeRevision(record,ids,detail);
      for(const target of ids){run.states[target]={status:"idle"};delete record.meta.quotes[target];}
      if([...ids].some(target=>run.graph.nodes.find(n=>n.id===target)?.kind==="script"))await db.update("episodes",run.episode,{script_approved:false,script_meta:{...detail.episode.script_meta,approved_revision:""}});
      addMessage(run,"system",`${node.title} and its dependent stages were reset. Existing files remain available in Production tools. Prepare a fresh quote explicitly.`,node.id);
    }
    return result(await persist(record));
  });
}

