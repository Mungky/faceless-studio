import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,n){return s==="server-only"?{url:new URL("./server-only-fixture.cjs",import.meta.url).href,shortCircuit:true}:n(s,c);}});
test("blocked pre-provider tasks can be retried through revision-checked persistence",async t=>{
  const {db}=await import("../apps/web/src/server/pocketbase"),task={id:"task-fixture",key:"production:fixture",channel:"arthur000000001",kind:"research",status:"blocked",revision:2,attempts:1},row={key:task.key,kind:"task",channel:task.channel,data:task};let saved:any;
  mock.method(db,"list",async(name:string)=>name==="workspace_records"?[row]:[]);mock.method(db,"custom",async(_route:string,body:any)=>{saved=body;return body;});t.after(()=>mock.restoreAll());const api=await import("../apps/web/src/server/workspace");const result=await api.recoverTask(task.channel,task.id,{action:"retry"});assert.equal(result.status,"queued");assert.equal(saved.expected_revision,2);assert.equal(saved.data.revision,3);
});
test("workspace preferences are fetched independently from unrelated historical volume",async t=>{
  const {db}=await import("../apps/web/src/server/pocketbase");const filters:string[]=[];mock.method(db,"list",async(name:string,filter="",_sort?:string,limit=500)=>{if(name!=="workspace_records")return [];filters.push(filter);if(!filter)return Array.from({length:limit>500?501:500},(_,i)=>({kind:"reference",data:{id:i}}));return filter.includes('"preferences"')?[{kind:"preferences",data:{channel:"arthur000000001",revision:8}}]:[];});t.after(()=>mock.restoreAll());
  const api=await import("../apps/web/src/server/workspace");const result=await api.workspaceData();assert.equal(result.preferences[0]?.revision,8);assert.ok(filters.every(f=>!!f));
});
test("video evaluation selects the requested range before deduplicating previous videos",async t=>{
  const {db}=await import("../apps/web/src/server/pocketbase"),rows:any[]=[];const range={start:"2026-10-01",end:"2026-10-28"};const m={title:"Video",views:20,average_view_percentage:null,viewed_vs_swiped:null,start_date:range.start,end_date:range.end};
  const reports=[{video_id:"abcdefghijk",updated:"2026-10-30",metrics:{...m,start_date:"2026-09-01",views:999}},{video_id:"previous123",updated:"2026-10-30",metrics:{...m,start_date:"2026-09-01",views:9999}},{video_id:"abcdefghijk",updated:"2026-10-29",metrics:m},{video_id:"previous123",updated:"2026-10-29",metrics:{...m,views:40}}];
  mock.method(db,"get",async()=>({id:"arthur000000001",youtube_channel_id:"UCfixture"}));mock.method(db,"list",async(name:string)=>name==="video_reports"?reports:[]);mock.method(db,"custom",async(_route:string,body:any)=>{rows.push(body);return body;});t.after(()=>mock.restoreAll());const api=await import("../apps/web/src/server/workspace");const report=await api.generateVideoReport("arthur000000001","abcdefghijk",range);assert.equal(report.evidence[0].views,20);assert.equal(report.evidence[1].views,40);
});
test("preference reads are read-only and saved defaults require an existing template",async t=>{
  const {db}=await import("../apps/web/src/server/pocketbase");
  const {defaultChannelPreferences}=await import("../packages/core/src/workspace");
  const records:any[]=[];let saves=0;
  mock.method(db,"get",async()=>({id:"arthur000000001",name:"Arthur",playbook_path:""}));
  mock.method(db,"list",async(name:string,filter="")=>name==="channels"?[{id:"arthur000000001",name:"Arthur",playbook_path:""}]:name==="workspace_records"?records.filter(r=>!filter||filter.includes(JSON.stringify(r.key))):[]);
  mock.method(db,"custom",async(_name:string,body:any)=>{saves++;const row={id:"record000000001",...body};records.splice(0,records.length,row);return row;});
  t.after(()=>mock.restoreAll());
  const api=await import("../apps/web/src/server/workspace");
  const initial=await api.channelPreferences("arthur000000001");assert.equal(saves,0);assert.equal(initial.revision,0);
  await assert.rejects(api.saveChannelPreferences("arthur000000001",{...initial,default_template_id:"missing"}),/template/i);assert.equal(saves,0);
  const saved=await api.saveChannelPreferences("arthur000000001",{...defaultChannelPreferences("arthur000000001"),default_template_id:"arthur"});
  assert.equal(saved.revision,1);assert.equal(saved.default_template_id,"arthur");assert.equal(saves,1);
  await assert.rejects(api.saveChannelPreferences("arthur000000001",initial),/changed|reload/i);assert.equal(saves,1);
});
