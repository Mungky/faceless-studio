import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });
const core = async () => import("../packages/core/src/workflow").catch(() => ({} as any));
test("workflow graph enforces a single brief root, DAG and bounded connected nodes", async () => {
  const api = await core(); assert.equal(typeof api.validateWorkflowGraph, "function", "Graph validation is implemented");
  const graph = api.defaultWorkflowGraph(); assert.ok(api.validateWorkflowGraph(graph));
  const bad = (edit: (g: any) => void) => { const value = structuredClone(graph); edit(value); assert.throws(() => api.validateWorkflowGraph(value)); };
  bad(g => g.edges.push({ id:"cycle",source:g.nodes.at(-1).id,target:g.nodes[0].id }));
  bad(g => g.nodes.push({...g.nodes[0], id:"another-root"}));
  bad(g => g.edges.push({...g.edges[0],id:"duplicate"}));
  bad(g => g.edges[0].source="missing");
  bad(g => g.nodes[0].position.x=Infinity);
  bad(g => g.nodes[0].id="__proto__");
  bad(g => g.nodes.push({...g.nodes.at(-1),id:"orphan"}));
  bad(g => g.edges=[]);
});
test("ready nodes follow dependencies even when canvas coordinates change", async () => {
  const api = await core(); assert.equal(typeof api.readyWorkflowNodes,"function");
  const graph = api.defaultWorkflowGraph(); graph.nodes.reverse();
  assert.deepEqual(api.readyWorkflowNodes(graph,{}).map((n:any)=>n.kind),["brief"]);
  assert.deepEqual(api.readyWorkflowNodes(graph,{brief:{status:"completed"}}).map((n:any)=>n.kind),["research"]);
  assert.deepEqual(api.readyWorkflowNodes(graph,{brief:{status:"completed"},research:{status:"waiting_review"}}).map((n:any)=>n.kind),[]);
});

async function fixture(t:TestContext) {
  await mkdir(path.resolve(".runtime"),{recursive:true}); const directory=await mkdtemp(path.resolve(".runtime/studio-workflow-"));
  const previous={VAULT_ROOT:process.env.VAULT_ROOT,NINEROUTER_URL:process.env.NINEROUTER_URL};process.env.VAULT_ROOT=directory;delete process.env.NINEROUTER_URL;
  await mkdir(path.join(directory,"Arthur"),{recursive:true});await writeFile(path.join(directory,"Arthur","Arthur.md"),"Existing Arthur playbook. Stop for research, script and visual-plan approval.");
  const {db}=await import("../apps/web/src/server/pocketbase");
  const records=new Map<string,Map<string,any>>();let sequence=0;let calls=0;
  const table=(name:string)=>{if(!records.has(name))records.set(name,new Map());return records.get(name)!;};
  table("settings").set("spending0000001",{id:"spending0000001",key:"spending",value:{daily_usd:0,daily_credits:0}});
  table("channels").set("arthur000000001",{id:"arthur000000001",name:"Arthur",playbook_path:"Arthur/Arthur.md"});
  mock.method(db,"get",async (name:string,id:string)=>{const data=table(name).get(id);if(!data)throw Object.assign(new Error("Not found"),{status:404});return structuredClone(data);});
  mock.method(db,"list",async(name:string,filter="")=>{
    let values=[...table(name).values()];
    for(const field of ["key","episode","quote","task"]){const match=new RegExp(`(?:^|\\s)${field}=(\"[^\"]*\")`).exec(filter);if(match) values=values.filter(v=>v[field]===JSON.parse(match[1]));}
    return structuredClone(values);
  });
  mock.method(db,"create",async(name:string,body:any)=>{const value={...structuredClone(body),id:String(++sequence).padStart(15,"0"),created:new Date().toISOString(),updated:new Date().toISOString()};table(name).set(value.id,value);return structuredClone(value);});
  mock.method(db,"update",async(name:string,id:string,body:any)=>{const old=table(name).get(id);assert.ok(old,`${name}/${id} exists`);const value={...old,...structuredClone(body),updated:new Date().toISOString()};table(name).set(id,value);return structuredClone(value);});
  mock.method(db,"custom",async()=>{calls++;throw new Error("No provider reservations allowed in this fixture");});
  t.after(async()=>{mock.restoreAll();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(directory,{recursive:true,force:true});});
  const api=await import("../apps/web/src/server/workflows").catch(()=>({} as any));
  return {api,table,directory,get calls(){return calls;}};
}
const owner="owner0000000001";
test("editing an approved manual script returns the saved text to exact review without a provider",async t=>{
  const f=await fixture(t);let p=await f.api.createWorkflowRun({template:"arthur",title:"Manual revision",brief:"Own script",entry_mode:"script",content:"Original manual text."},owner);
  p=await f.api.actWorkflowRun(p.run.id,{action:"review",node_id:"script",document_revision:p.detail.revisions["script.md"],expected_revision:p.run.revision},owner);
  await writeFile(path.join(f.directory,p.detail.episode.vault_path,"script.md"),"Edited manual text.");
  p=await f.api.actWorkflowRun(p.run.id,{action:"sync",node_id:"script",expected_revision:p.run.revision},owner);
  assert.equal(p.run.states.script.status,"waiting_review");assert.equal(p.run.states.script.output,"Edited manual text.");assert.equal(f.calls,0);
  p=await f.api.actWorkflowRun(p.run.id,{action:"review",node_id:"script",document_revision:p.detail.revisions["script.md"],expected_revision:p.run.revision},owner);assert.equal(p.detail.episode.script_approved,true);
});
test("durable scheduled creation keys reconcile one production after repeated triggers",async t=>{
  const f=await fixture(t),input={template:"arthur",title:"Scheduled fixture",brief:"A bounded research direction",request_key:"production:arthur000000001:2026-10-31:1900"};
  const first=await f.api.createWorkflowRun(input,owner),again=await f.api.createWorkflowRun(input,owner);assert.equal(again.run.id,first.run.id);assert.equal(f.table("episodes").size,1);
});
test("scheduled creation recovers the original episode when run persistence was interrupted",async t=>{
  const f=await fixture(t),{db}=await import("../apps/web/src/server/pocketbase"),create=db.create.bind(db);let fail=true;
  const wrapped=mock.method(db,"create",async(name:string,body:any)=>{if(name==="workflow_runs"&&fail){fail=false;throw new Error("Simulated persistence interruption");}return create(name,body);});
  const input={template:"arthur",title:"Interrupted creation",brief:"Keep this formula",request_key:"production:arthur000000001:2026-10-31:0600"};await assert.rejects(f.api.createWorkflowRun(input,owner),/could not be saved/);assert.equal(f.table("episodes").size,1);const recovered=await f.api.createWorkflowRun(input,owner);assert.equal(f.table("episodes").size,1);assert.equal(recovered.run.request_key,input.request_key);assert.match(recovered.run.playbook_snapshot,/Existing Arthur/);
  wrapped.mock.restore();
});
test("edited template content is stored separately from the original vault and frozen for new runs",async t=>{
  const f=await fixture(t);const original=await f.api.workflowTemplate("arthur");
  const saved=await f.api.saveWorkflowTemplate("arthur",{...original,playbook_content:"A new template without editing the original file.",expected_version:original.version});
  const run=await f.api.createWorkflowRun({template:saved.id,title:"Edited content",brief:"Test content"},owner);
  assert.equal(run.run.playbook_snapshot,"A new template without editing the original file.");
  assert.equal(await (await import("node:fs/promises")).readFile(path.join(f.directory,"Arthur","Arthur.md"),"utf8"),"Existing Arthur playbook. Stop for research, script and visual-plan approval.");
});

test("manual episode entry preserves exact text and freezes template and playbook version",async t=>{
  const f=await fixture(t);
  const manual="PRESENTER\nBriking Nius!  Jangan ubah   spasi.\n\nWOKWI\nItu punchline saya.";
  const template=await f.api.workflowTemplate("arthur");
  const created=await f.api.createWorkflowRun({template:"arthur",channel:"arthur000000001",title:"Manual entry",brief:"Review only",entry_mode:"script",content:manual},owner);
  assert.equal(created.detail.documents["script.md"],manual);
  assert.equal(created.run.states.script.status,"waiting_review");
  assert.equal(created.run.states.research.provided_by_user,true);
  assert.equal(created.run.template_version,template.version);
  assert.match(created.run.playbook_snapshot,/Existing Arthur/);
  await writeFile(path.join(f.directory,"Arthur","Arthur.md"),"A later playbook that must not change this episode.");
  const read=await f.api.workflowRunData(created.run.id);
  assert.match(read.run.playbook_snapshot,/Existing Arthur/);
  assert.equal(read.detail.episode.script_meta.workflow_context.playbook_snapshot,created.run.playbook_snapshot);
  assert.equal(f.calls,0);
});

test("template override keeps the selected destination channel",async t=>{
  const f=await fixture(t);
  f.table("channels").set("notyet000000001",{id:"notyet000000001",name:"Not Yet",playbook_path:""});
  const created=await f.api.createWorkflowRun({template:"arthur",channel:"notyet000000001",title:"Explicit alternate template",brief:"Use the selected template on my destination channel"},owner);
  assert.equal(created.run.channel,"notyet000000001");
  assert.equal(created.detail.episode.channel,"notyet000000001");
  assert.equal(created.run.template_id,"arthur");
});
test("workflow GET is read-only and library never imports legacy episodes as runs",async t=>{
  const f=await fixture(t);assert.equal(typeof f.api.workflowLibrary,"function","Workflow server exists");
  f.table("episodes").set("legacy000000001",{youtube_video_id:"abcdefghijk"});
  const library=await f.api.workflowLibrary();assert.equal(library.templates.length,2);assert.deepEqual(library.runs,[]);assert.equal(f.table("workflow_templates").size,0);assert.equal(f.table("episodes").size,1);
});
test("template versions conflict and running graphs retain saved snapshots",async t=>{
  const f=await fixture(t);assert.equal(typeof f.api.createWorkflowRun,"function");
  const builtin=await f.api.workflowTemplate("arthur");
  const created=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"An honest brief"},owner);
  const input={...builtin,name:"Updated template",expected_version:builtin.version};input.graph.nodes[1].instructions="New research direction";
  const saved=await f.api.saveWorkflowTemplate("arthur",input);assert.notEqual(saved.version,builtin.version);
  await assert.rejects(f.api.saveWorkflowTemplate("arthur",input),/changed|version|conflict/i);
  const current=await f.api.workflowRunData(created.run.id);assert.notEqual(current.run.graph.nodes[1].instructions,"New research direction");assert.equal(current.detail.episode.youtube_video_id,"");
});
test("messages persist with revision protection and missing providers create honest blocked states",async t=>{
  const f=await fixture(t);assert.equal(typeof f.api.messageWorkflowRun,"function");
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const messaged=await f.api.messageWorkflowRun(run.id,{content:"Use these supplied sources",expected_revision:run.revision},owner);assert.ok(messaged.run.messages.some((m:any)=>m.role==="user"&&m.content==="Use these supplied sources"));
  await assert.rejects(f.api.messageWorkflowRun(run.id,{content:"stale",expected_revision:run.revision},owner),/changed|revision|conflict/i);
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",expected_revision:messaged.run.revision},owner);
  assert.equal(prepared.run.states.brief.status,"completed");assert.equal(prepared.run.states.research.status,"blocked");assert.match(prepared.run.states.research.error,/9Router|connect/i);assert.equal(f.calls,0);
});
test("cross-run quote approvals and stale reviews reject before reservation",async t=>{
  const f=await fixture(t);assert.equal(typeof f.api.actWorkflowRun,"function");
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"approve",node_id:"research",quote_id:"other0000000001",expected_revision:run.revision},owner),/quote|approval/i);assert.equal(f.calls,0);
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.research={status:"waiting_review",document:"riset.md",output_revision:"a".repeat(64)};
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"review",node_id:"research",document_revision:"a".repeat(64),expected_revision:run.revision},owner),/changed|revision|stale/i);assert.equal(f.calls,0);
});



test("reviewed documents remain approved on sync and script approval stores the exact hash",async t=>{
  const f=await fixture(t);const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const {documentRevision}=await import("../apps/web/src/server/service");const text="Complete script.";await writeFile(path.join(f.directory,detail.episode.vault_path,"script.md"),text);
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.script={status:"waiting_review",document:"script.md",output:text,output_revision:documentRevision(text)};
  const reviewed=await f.api.actWorkflowRun(run.id,{action:"review",node_id:"script",document_revision:documentRevision(text),expected_revision:run.revision},owner);
  assert.equal(reviewed.detail.episode.script_meta.approved_revision,documentRevision(text));assert.equal(reviewed.run.states.script.status,"completed");
  const synced=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"script",expected_revision:reviewed.run.revision},owner);assert.equal(synced.run.states.script.status,"completed");
});
test("manual sync cannot bypass dependencies and consumed quotes cannot silently prepare a retry",async t=>{
  const f=await fixture(t);const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.media={status:"blocked",error:"Missing assets"};
  f.table("assets").set("asset0000000001",{id:"asset0000000001",episode:run.episode,kind:"image",selected:true,drive_path:"fixture.png",meta:{beat:1}});
  const synced=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"media",expected_revision:run.revision},owner);assert.notEqual(synced.run.states.media.status,"completed");
  const currentStored=f.table("workflow_runs").get(run.id); currentStored.data.states.research={status:"blocked",quote:{id:"quote0000000001",operation:"research",provider:"ninerouter",units:1,est_cost:0,currency:"USD",expires:new Date(Date.now()+10000).toISOString(),note:""}};
  currentStored.data.states.brief={status:"completed"};
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"research",expected_revision:currentStored.data.revision},owner),/revise|quote|outcome/i);
});
test("revision rejects active production jobs and preserves existing documents",async t=>{
  const f=await fixture(t);const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  f.table("jobs").set("job000000000001",{id:"job000000000001",episode:run.episode,status:"running",type:"render"});
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"revise",node_id:"research",expected_revision:run.revision},owner),/active job/i);
  f.table("jobs").clear();const {writeDocument,readDocument}=await import("../apps/web/src/server/vault");await writeDocument(detail.episode.vault_path,"script.md","Keep this draft");
  const revised=await f.api.actWorkflowRun(run.id,{action:"revise",node_id:"research",expected_revision:run.revision},owner);assert.equal(revised.run.states.script.status,"idle");assert.equal(await readDocument(detail.episode.vault_path,"script.md"),"Keep this draft");
});


test("builtin templates retain playbook approval stages and cannot bypass the visual plan",async t=>{
  const f=await fixture(t);const template=await f.api.workflowTemplate("arthur");
  const graph=structuredClone(template.graph);graph.nodes=graph.nodes.filter((n:any)=>n.kind!=="script");graph.edges=graph.edges.filter((e:any)=>e.source!=="script"&&e.target!=="script");graph.edges.push({id:"bypass",source:"research",target:"storyboard"});
  await assert.rejects(f.api.saveWorkflowTemplate("arthur",{...template,graph,expected_version:template.version}),/playbook|script|approval/i);
});
test("current-output hashes reject external edits before dependent execution",async t=>{
  const f=await fixture(t);const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const {documentRevision}=await import("../apps/web/src/server/service");const old="Reviewed research";
  await writeFile(path.join(f.directory,detail.episode.vault_path,"riset.md"),"User changed the evidence");
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.brief={status:"completed"};stored.data.states.research={status:"completed",document:"riset.md",output_revision:documentRevision(old)};
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"script",expected_revision:run.revision},owner),/changed|revision|review/i);assert.equal(f.calls,0);
});

test("native workflow collections keep templates, snapshots and chat private",{skip:process.env.STUDIO_INTEGRATION_TESTS!=="1"},async t=>{
  const base=process.env.STUDIO_TEST_PB_URL!;const priorVault=process.env.VAULT_ROOT;
  await mkdir(path.resolve(".runtime"),{recursive:true});const directory=await mkdtemp(path.resolve(".runtime/native-workflow-"));process.env.VAULT_ROOT=directory;
  await mkdir(path.join(directory,"Arthur"),{recursive:true});await writeFile(path.join(directory,"Arthur/Arthur.md"),"Native fixture playbook");
  const {StudioDatabase,db}=await import("../apps/web/src/server/pocketbase");const native=new StudioDatabase(base);mock.restoreAll();for(const key of ["get","list","create","update","custom"])if(Object.hasOwn(db,key))delete (db as any)[key];mock.method(db,"request",native.request.bind(native));
  t.after(async()=>{mock.restoreAll();if(priorVault===undefined)delete process.env.VAULT_ROOT;else process.env.VAULT_ROOT=priorVault;await rm(directory,{recursive:true,force:true});});
  const api=await import("../apps/web/src/server/workflows");
  for(const name of ["workflow_templates","workflow_runs"]){const response=await fetch(`${base}/api/collections/${name}/records`);assert.equal(response.status,403);}
  const [user]=await native.list<{id:string}>("studio_users","","",1);const template=await api.workflowTemplate("arthur");
  const saved=await api.saveWorkflowTemplate("arthur",{...template,expected_version:template.version});assert.notEqual(saved.version,template.version);
  const created=await api.createWorkflowRun({template:"arthur",title:"Disposable native workflow fixture",brief:"Source-aware direction"},user.id);
  assert.equal(created.detail.episode.youtube_video_id,"");assert.equal(created.run.template_id,"arthur");
  const messaged=await api.messageWorkflowRun(created.run.id,{content:"Persistent native chat",expected_revision:created.run.revision},user.id);
  const reloaded=await api.workflowRunData(created.run.id);assert.equal(reloaded.run.revision,messaged.run.revision);assert.ok(reloaded.run.messages.some(m=>m.content==="Persistent native chat"));
});


test("workflow mutations reject manually redirected episode context",async t=>{
  const f=await fixture(t);const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const episode=f.table("episodes").get(run.episode);episode.vault_path="Arthur/different-production";
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"prepare",expected_revision:run.revision},owner),/context|vault|production/i);assert.equal(f.calls,0);
});
test("provider quotes use saved playbook directions and replay never calls a second provider",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("research0000001",{id:"research0000001",task:"research",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const {db}=await import("../apps/web/src/server/pocketbase");let providerCalls=0;let reservations=0;let captured="";
  mock.method(db,"custom",async(_route:string,input:any)=>{
    reservations++;const quote=f.table("spend_quotes").get(input.quote_id);assert.equal(quote.consumed,false);quote.consumed=true;
    const spend={id:"spend0000000001",quote:quote.id,status:"reserved"};f.table("spend_log").set(spend.id,spend);return {spend,reused:false};
  });
  mock.method(globalThis,"fetch",async(url:string|URL|Request,init?:RequestInit)=>{assert.equal(String(url),"http://workflow.fixture.invalid/v1/chat/completions");providerCalls++;captured=String(init?.body);return new Response(JSON.stringify({choices:[{message:{content:"# Research leads\n\nSupplied evidence still needs verification."}}]}),{headers:{"Content-Type":"application/json"}});});
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"Specific supplied direction"},owner);
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",expected_revision:run.revision},owner);const quote=prepared.run.states.research.quote!;assert.equal(providerCalls,0);
  const approved=await f.api.actWorkflowRun(run.id,{action:"approve",node_id:"research",quote_id:quote.id,expected_revision:prepared.run.revision},owner);
  assert.equal(approved.run.states.research.status,"waiting_review");assert.match(approved.detail.documents["riset.md"],/Supplied evidence/);assert.ok(approved.run.messages.some((m:any)=>m.role==="assistant"&&m.node_id==="research"));assert.match(captured,/Existing Arthur playbook/);assert.match(captured,/Specific supplied direction/);
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"approve",node_id:"research",quote_id:quote.id,expected_revision:approved.run.revision},owner),/quote|approval/i);assert.equal(providerCalls,1);assert.equal(reservations,1);
  const reviewed=await f.api.actWorkflowRun(run.id,{action:"review",node_id:"research",document_revision:approved.run.states.research.output_revision,expected_revision:approved.run.revision},owner);
  const synced=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"research",expected_revision:reviewed.run.revision},owner);assert.equal(synced.run.states.research.status,"completed");assert.equal(providerCalls,1);
});

test("research topic choices remain in downstream script quote input",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("script000000001",{id:"script000000001",task:"script",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const messaged=await f.api.messageWorkflowRun(run.id,{content:"Choose topic three: the clock",node_id:"research",expected_revision:run.revision},owner);
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.brief={status:"completed"};stored.data.states.research={status:"completed"};
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"script",expected_revision:messaged.run.revision},owner);
  const quote=f.table("spend_quotes").get(prepared.run.states.script.quote!.id);assert.match(quote.payload.input,/Choose topic three: the clock/);assert.equal(f.calls,0);
});

test("current quote scope and source snapshots reject before provider reservation",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("research0000001",{id:"research0000001",task:"research",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const created=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const prepared=await f.api.actWorkflowRun(created.run.id,{action:"prepare",expected_revision:created.run.revision},owner);const quote=prepared.run.states.research.quote!;
  const internal=f.table("spend_quotes").get(quote.id);internal.episode="other0000000001";
  const approve=()=>f.api.actWorkflowRun(created.run.id,{action:"approve",node_id:"research",quote_id:quote.id,expected_revision:prepared.run.revision},owner);
  await assert.rejects(approve(),/different production/i);assert.equal(f.calls,0);
  internal.episode=created.run.episode;await writeFile(path.join(f.directory,created.detail.episode.vault_path,"riset.md"),"Changed source evidence");
  await assert.rejects(approve(),/source document changed/i);assert.equal(f.calls,0);
});
test("sync follows the bound render job and requires its actual episode asset",async t=>{
  const f=await fixture(t);const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const stored=f.table("workflow_runs").get(run.id);stored.data.states.render={status:"running",job_id:"job000000000001"};
  f.table("jobs").set("job000000000001",{id:"job000000000001",episode:run.episode,type:"render",status:"queued",progress:0,result_asset:""});
  const queued=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"render",expected_revision:run.revision},owner);assert.equal(queued.run.states.render.status,"running");assert.match(queued.run.states.render.output,/queued/i);assert.equal(f.calls,0);
  const job=f.table("jobs").get("job000000000001");job.status="done";job.result_asset="asset0000000001";
  const missing=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"render",expected_revision:queued.run.revision},owner);assert.equal(missing.run.states.render.status,"blocked");
  f.table("assets").set("asset0000000001",{id:"asset0000000001",episode:run.episode,kind:"render",selected:true,drive_path:"fixture/render.mp4",meta:{}});
  const complete=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"render",expected_revision:missing.run.revision},owner);assert.equal(complete.run.states.render.status,"completed");assert.equal(f.calls,0);
});
test("concurrent messages accept only one writer of the same run revision",async t=>{
  const f=await fixture(t);const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const results=await Promise.allSettled(["First writer","Second writer"].map(content=>f.api.messageWorkflowRun(run.id,{content,expected_revision:run.revision},owner)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  const reloaded=await f.api.workflowRunData(run.id);assert.equal(reloaded.run.messages.filter((m:any)=>/writer/.test(m.content)).length,1);
});

test("simultaneous same-title productions receive distinct vault folders",async t=>{
  const f=await fixture(t);const {createEpisode}=await import("../apps/web/src/server/service");
  mock.method(Date,"now",()=>1793232000000);
  const episodes=[]; for(const attempt of [1,2])episodes.push(await createEpisode({channel:"arthur000000001",title:"Same title",format:"short",youtube_video_id:""}));
  assert.notEqual(episodes[0].vault_path,episodes[1].vault_path);assert.match(episodes[0].slug,/^same-title-/);
});


test("template save requires an explicit graph instead of replacing it with defaults",async t=>{
  const f=await fixture(t);const template=await f.api.workflowTemplate("arthur");
  const {graph,...withoutGraph}=template;
  await assert.rejects(f.api.saveWorkflowTemplate("arthur",{...withoutGraph,expected_version:template.version}),/graph/i);
});

test("script generation preserves workflow context through exact-script review",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("script000000001",{id:"script000000001",task:"script",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const {db}=await import("../apps/web/src/server/pocketbase");
  mock.method(db,"custom",async(_route:string,input:any)=>{const quote=f.table("spend_quotes").get(input.quote_id);quote.consumed=true;const spend={id:"spend0000000001",quote:quote.id,status:"reserved"};f.table("spend_log").set(spend.id,spend);return {spend,reused:false};});
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({script:"[0:00] Complete narration.",hook_score:75,virality_score:70,duration_seconds:10})}}]})));
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner),record=f.table("workflow_runs").get(run.id);
  record.data.states.brief={status:"completed"};record.data.states.research={status:"completed"};
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"script",expected_revision:run.revision},owner);
  const generated=await f.api.actWorkflowRun(run.id,{action:"approve",node_id:"script",quote_id:prepared.run.states.script.quote!.id,expected_revision:prepared.run.revision},owner);
  assert.equal(generated.run.states.script.status,"waiting_review");assert.ok(generated.detail.episode.script_meta.workflow_context);
  const reviewed=await f.api.actWorkflowRun(run.id,{action:"review",node_id:"script",document_revision:generated.run.states.script.output_revision,expected_revision:generated.run.revision},owner);assert.equal(reviewed.run.states.script.status,"completed");assert.equal(reviewed.detail.episode.script_approved,true);
});

test("workflow-bound quotes cannot be approved through the generic quote service",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("research0000001",{id:"research0000001",task:"research",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const {run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner),prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",expected_revision:run.revision},owner),{approveQuote}=await import("../apps/web/src/server/service");
  await assert.rejects(approveQuote(prepared.run.states.research.quote!.id,owner),/workflow|conversation/i);assert.equal(f.calls,0);
});

test("workflow graphs reject repeated canonical output stages",async()=>{
  const api=await core(),graph=api.defaultWorkflowGraph(),last=graph.nodes.at(-1)!;
  graph.nodes.push({...graph.nodes.find((node:any)=>node.kind==="script"),id:"secondScript"});graph.edges.push({id:"to-second-script",source:last.id,target:"secondScript"});
  assert.throws(()=>api.validateWorkflowGraph(graph),/one|unique|repeat|already/i);
});

test("edits made during workflow generation survive and the generated result is recoverable",async t=>{
  const f=await fixture(t);process.env.NINEROUTER_URL="http://workflow.fixture.invalid/v1";
  f.table("model_routes").set("script000000001",{id:"script000000001",task:"script",model:"fixture",billing:"free",max_output_tokens:256,usd_per_1k_chars:0});
  const {db}=await import("../apps/web/src/server/pocketbase"),{readdir,readFile}=await import("node:fs/promises");
  mock.method(db,"custom",async(_route:string,input:any)=>{const quote=f.table("spend_quotes").get(input.quote_id);quote.consumed=true;const spend={id:"spend0000000001",quote:quote.id,status:"reserved"};f.table("spend_log").set(spend.id,spend);return {spend,reused:false};});
  const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner),record=f.table("workflow_runs").get(run.id),folder=path.join(f.directory,detail.episode.vault_path);
  record.data.states.brief={status:"completed"};record.data.states.research={status:"completed"};
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"script",expected_revision:run.revision},owner);
  mock.method(globalThis,"fetch",async()=>{await writeFile(path.join(folder,"script.md"),"User edit while the provider was running.");return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({script:"Generated result to recover.",hook_score:75,virality_score:70,duration_seconds:10})}}]}));});
  const result=await f.api.actWorkflowRun(run.id,{action:"approve",node_id:"script",quote_id:prepared.run.states.script.quote!.id,expected_revision:prepared.run.revision},owner);
  assert.equal(await readFile(path.join(folder,"script.md"),"utf8"),"User edit while the provider was running.");
  assert.match(result.run.states.script.error,/source changed during generation|recover/i);assert.equal(result.run.states.script.status,"blocked");
  const drafts=await readdir(path.join(folder,".studio-drafts"));assert.equal(drafts.length,1);assert.match(await readFile(path.join(folder,".studio-drafts",drafts[0]),"utf8"),/Generated result to recover/);
  assert.ok(!result.run.messages.some((message:any)=>message.role==="assistant"&&message.node_id==="script"));
});

test("sync presents a manual document edit for exact review without another generation",async t=>{
  const f=await fixture(t);const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const {documentRevision}=await import("../apps/web/src/server/service"),record=f.table("workflow_runs").get(run.id),text="Manually corrected research with supplied sources.";
  record.data.states.brief={status:"completed"};record.data.states.research={status:"waiting_review",document:"riset.md",output:"Old result",output_revision:documentRevision("Old result")};
  await writeFile(path.join(f.directory,detail.episode.vault_path,"riset.md"),text);
  const synced=await f.api.actWorkflowRun(run.id,{action:"sync",node_id:"research",expected_revision:run.revision},owner);
  assert.equal(synced.run.states.research.output,text);assert.equal(synced.run.states.research.output_revision,documentRevision(text));assert.equal(synced.run.states.research.status,"waiting_review");
  assert.ok(synced.run.messages.some((m:any)=>m.role==="system"&&/manual|edited/i.test(m.content)));assert.ok(!synced.run.messages.some((m:any)=>m.role==="assistant"));
  const approved=await f.api.actWorkflowRun(run.id,{action:"review",node_id:"research",document_revision:documentRevision(text),expected_revision:synced.run.revision},owner);assert.equal(approved.run.states.research.status,"completed");assert.equal(f.calls,0);
});

test("workflow renders bind each beat to its matching selected generated media",async t=>{
  const f=await fixture(t),prior=process.env.RCLONE_REMOTE;process.env.RCLONE_REMOTE="fixture:";t.after(()=>{if(prior===undefined)delete process.env.RCLONE_REMOTE;else process.env.RCLONE_REMOTE=prior;});
  const {run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner),{writeBeats}=await import("../apps/web/src/server/vault"),{queueLocalJob}=await import("../apps/web/src/server/service");
  const beats=[1,2].map(index=>({index,text:`Beat ${index}`,prompt:`Scene ${index}`,seconds:5,image:"",video:""}));await writeBeats(detail.episode.vault_path,beats);
  for(const beat of beats)f.table("assets").set(`asset${String(beat.index).padStart(10,"0")}`,{id:`asset${String(beat.index).padStart(10,"0")}`,episode:run.episode,kind:"image",selected:true,drive_path:`scene-${beat.index}.png`,meta:{beat:beat.index}});
  const job=await queueLocalJob({episode:run.episode,type:"render",prompt:"",lyrics:"",seconds:10,seed:42});assert.deepEqual((job.payload.beats as {image:string}[]).map(b=>b.image),["asset0000000001","asset0000000002"]);
  f.table("assets").delete("asset0000000002");await assert.rejects(queueLocalJob({episode:run.episode,type:"render",prompt:"",lyrics:"",seconds:10,seed:42}),/beat 2|matching|assign/i);
});

test("ambiguous media assignments and multiple voiceover takes require a selection",async t=>{
  const f=await fixture(t),{workflowBeatAsset}=await import("../apps/web/src/server/service"),{run}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner);
  const beat={index:1,text:"Narration",prompt:"Scene",seconds:5,image:"",video:""},assets=[1,2].map(i=>({id:`asset${String(i).padStart(10,"0")}`,episode:run.episode,kind:"image" as const,selected:true,drive_path:`scene-${i}.png`,meta:{beat:1},created:"",drive_file_id:"",source:"fixture"}));
  assert.throws(()=>workflowBeatAsset(beat,"image",assets),/multiple selected/);assert.equal(workflowBeatAsset({...beat,image:assets[1].id},"image",assets)?.id,assets[1].id);assert.throws(()=>workflowBeatAsset({...beat,image:"missing00000001"},"image",assets),/unavailable/);
  const record=f.table("workflow_runs").get(run.id);record.data.states.brief={status:"completed"};record.data.states.research={status:"completed"};record.data.states.script={status:"completed"};record.data.states.storyboard={status:"completed"};record.data.graph.nodes.find((node:any)=>node.kind==="voiceover").provider="manual";
  for(const asset of assets)f.table("assets").set(asset.id,{...asset,kind:"vo"});
  const prepared=await f.api.actWorkflowRun(run.id,{action:"prepare",node_id:"voiceover",expected_revision:run.revision},owner);assert.equal(prepared.run.states.voiceover.status,"blocked");assert.match(prepared.run.states.voiceover.error,/exactly one voiceover/);assert.equal(f.calls,0);
});

test("manual visual-plan sync rejects a valid table that omits approved narration",async t=>{
  const f=await fixture(t),{run,detail}=await f.api.createWorkflowRun({template:"arthur",title:"Owned fixture",brief:"A brief"},owner),{writeBeats}=await import("../apps/web/src/server/vault"),{documentRevision}=await import("../apps/web/src/server/service"),record=f.table("workflow_runs").get(run.id);
  await writeFile(path.join(f.directory,detail.episode.vault_path,"script.md"),"The clock stopped. The town carried on.");
  await writeBeats(detail.episode.vault_path,[{index:1,text:"The clock stopped.",prompt:"A clock",seconds:5,image:"",video:""}]);
  record.data.states.brief={status:"completed"};record.data.states.research={status:"completed"};record.data.states.script={status:"completed"};record.data.states.storyboard={status:"waiting_review",document:"storyboard.md",output:"Previous full plan",output_revision:documentRevision("Previous full plan")};
  await assert.rejects(f.api.actWorkflowRun(run.id,{action:"sync",node_id:"storyboard",expected_revision:run.revision},owner),/narration|script|cover|voiceover/i);assert.equal(f.calls,0);
});
