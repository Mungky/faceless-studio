import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {YouTubeConnector} from "@studio/connectors";
registerHooks({resolve(specifier,context,nextResolve){return specifier==="server-only"?{url:new URL("./server-only-fixture.cjs",import.meta.url).href,shortCircuit:true}:nextResolve(specifier,context);}});

test("new channel names are safe directory names and duplicate projects are rejected",async t=>{
  const {createChannelSchema,createChannel}=await import("../apps/web/src/server/channels");
  for(const name of ["..","../escape","foo/bar","foo\\bar","CON","nul.txt","name:","trailing.","bad?name"]) assert.equal(createChannelSchema.safeParse({name}).success,false,name);
  assert.equal(createChannelSchema.parse({name:"New Channel"}).name,"New Channel");
  const {db}=await import("../apps/web/src/server/pocketbase");let writes=0;
  mock.method(db,"list",async()=>[{name:"Arthur"}]);mock.method(db,"create",async()=>{writes++;return {id:"fixture"};});t.after(()=>mock.restoreAll());
  await assert.rejects(createChannel({name:"arthur"}),/already exists/i);assert.equal(writes,0);
  await assert.rejects(createChannel({name:"Other",playbook_path:"../private.md"}));assert.equal(writes,0);
});
test("a new disconnected channel does not write vault files or borrow credentials",async t=>{
  const {createChannel}=await import("../apps/web/src/server/channels");const {db}=await import("../apps/web/src/server/pocketbase");
  mock.method(db,"list",async()=>[]);let saved:any;
  mock.method(db,"create",async(collection:string,input:any)=>{assert.equal(collection,"channels");saved=input;return {id:"newchannel00001",...input};});t.after(()=>mock.restoreAll());
  const result=await createChannel({name:"New Channel"});assert.equal(result.name,"New Channel");assert.equal(saved.oauth_ref,"");assert.equal(saved.youtube_channel_id,"");assert.equal(saved.playbook_path,"");
});
test("every selected-video report is filtered and invalid identifiers fail before Google",async t=>{
  const youtube=new YouTubeConnector({refresh_token:"fixture",access_token:"fixture",expires_at:Date.now()+3600000});const queries:Record<string,string>[]=[];
  mock.method(youtube,"request",async(base:string,query:Record<string,string>)=>{if(base.includes("/channels"))return {items:[{id:"UCfixture",snippet:{title:"Fixture"},contentDetails:{relatedPlaylists:{uploads:"UUfixture"}}}]};queries.push(query);return {rows:[]};});t.after(()=>mock.restoreAll());
  await youtube.channelAnalytics("UCfixture","2026-01-01","2026-01-07","abcdefghijk");assert.ok(queries.length>5);assert.ok(queries.every(query=>query.filters==="video==abcdefghijk"));
  const before=queries.length;for(const id of ["bad",""])await assert.rejects(youtube.channelAnalytics("UCfixture","2026-01-01","2026-01-07",id));assert.equal(queries.length,before);
});

async function videoFixture(t:import("node:test").TestContext){
  const previous=process.env.OAUTH_ENCRYPTION_KEY;process.env.OAUTH_ENCRYPTION_KEY="1".repeat(64);
  const {encrypt}=await import("../apps/web/src/server/auth"),{db}=await import("../apps/web/src/server/pocketbase");
  const channel={id:"arthur000000001",name:"Arthur",handle:"@arthur",color:"#fff",playbook_path:"",youtube_channel_id:"UCfixture",oauth_ref:"auth00000000001"};
  const records=new Map<string,any[]>(),writes:string[]=[];
  mock.method(db,"get",async(collection:string)=>{if(collection==="channels")return channel;if(collection==="oauth_credentials")return {ciphertext:encrypt({refresh_token:"fixture"})};throw new Error("Unexpected read");});
  mock.method(db,"list",async(collection:string,filter:string)=>{if(collection==="video_reports")assert.ok(filter.includes('channel="arthur000000001"')&&filter.includes('youtube_channel_id="UCfixture"')&&filter.includes('video_id="abcdefghijk"'));return records.get(collection)||[];});
  mock.method(db,"create",async(collection:string,input:any)=>{writes.push(collection);const result={id:"savedrecord0001",...input};records.set(collection,[result]);return result;});
  mock.method(db,"update",async(collection:string,id:string,input:any)=>{writes.push(collection);const result={id,...input};records.set(collection,[result]);return result;});
  mock.method(globalThis,"fetch",async()=>{throw new Error("Unexpected provider request");});
  t.after(()=>{mock.restoreAll();if(previous===undefined)delete process.env.OAUTH_ENCRYPTION_KEY;else process.env.OAUTH_ENCRYPTION_KEY=previous;});
  return {channel,records,writes};
}
const fixtureMetrics=()=>({title:"Fixture video",duration_seconds:6,views:8,avg_view_duration:2,average_view_percentage:30,retention:[{elapsed_ratio:0,retention:1}],ctr:null,viewed_vs_swiped:null,traffic_sources:[],unavailable:[],start_date:"2026-01-01",end_date:"2026-01-07"});

test("selected-video sync rejects mismatched ownership before writing any records",async t=>{
  const f=await videoFixture(t);mock.method(YouTubeConnector.prototype,"ownChannel",async()=>({id:"UCanother"}));
  const {syncVideoAnalytics}=await import("../apps/web/src/server/projects");
  await assert.rejects(syncVideoAnalytics(f.channel.id,"abcdefghijk","2026-01-01","2026-01-07"),/different channel/);assert.deepEqual(f.writes,[]);
});

test("an upload without a production saves only its scoped report, never an episode or snapshot",async t=>{
  const f=await videoFixture(t),metrics=fixtureMetrics();
  mock.method(YouTubeConnector.prototype,"videoMetadata",async()=>({id:"abcdefghijk",title:"Fixture video"}));
  mock.method(YouTubeConnector.prototype,"channelAnalytics",async(_channel:string,_start:string,_end:string,id:string)=>{assert.equal(id,"abcdefghijk");return {summary:{views:12,average_view_duration:3,average_view_percentage:50},start_date:_start,end_date:_end};});
  mock.method(YouTubeConnector.prototype,"analytics",async()=>metrics);
  const {syncVideoAnalytics}=await import("../apps/web/src/server/projects"),result=await syncVideoAnalytics(f.channel.id,"abcdefghijk","2026-01-01","2026-01-07");
  assert.deepEqual(f.writes,["video_reports"]);assert.equal(result.snapshot,null);assert.equal(result.metrics?.views,12);assert.equal(result.metrics?.avg_view_duration,3);
  const saved=f.records.get("video_reports")![0];assert.equal(saved.channel,f.channel.id);assert.equal(saved.youtube_channel_id,"UCfixture");assert.equal(saved.video_id,"abcdefghijk");
});

test("cached video reports expose snapshot actions only for the latest matching production report",async t=>{
  const f=await videoFixture(t),metrics=fixtureMetrics();f.records.set("episodes",[{id:"production00001"}]);
  f.records.set("video_reports",[{id:"cached",video:{id:"abcdefghijk"},report:{},metrics}]);
  const matching={id:"snapshotmatch01",episode:"production00001",video_id:"abcdefghijk",metrics:{...metrics,ctr:5}};
  const {videoAnalyticsData}=await import("../apps/web/src/server/projects");
  f.records.set("analytics_snapshots",[matching]);let result=await videoAnalyticsData(f.channel.id,"abcdefghijk","2026-01-01","2026-01-07");assert.equal(result.snapshot?.id,matching.id);assert.equal(result.metrics?.ctr,5);
  f.records.set("analytics_snapshots",[{...matching,metrics:{...metrics,views:999}}]);result=await videoAnalyticsData(f.channel.id,"abcdefghijk","2026-01-01","2026-01-07");assert.equal(result.snapshot,null);assert.equal(result.metrics?.views,8);
  f.records.set("analytics_snapshots",[{...matching,id:"latest",metrics:{...metrics,start_date:"2026-01-02"}},matching]);result=await videoAnalyticsData(f.channel.id,"abcdefghijk","2026-01-01","2026-01-07");assert.equal(result.snapshot,null);assert.deepEqual(f.writes,[]);
});
test("video analytics cached reads isolate video and range without fetching Google",async t=>{
  const {db}=await import("../apps/web/src/server/pocketbase");const channel={id:"arthur000000001",name:"Arthur",handle:"@arthur",color:"#fff",youtube_channel_id:"UCfixture",oauth_ref:"auth00000000001"};
  mock.method(db,"get",async()=>channel);const filters:string[]=[];
  mock.method(db,"list",async(collection:string,filter:string)=>{filters.push(filter);if(collection==="channel_catalogs")return [{videos:[{id:"abcdefghijk",title:"Real video"}]}];return [];});mock.method(globalThis,"fetch",async()=>{throw new Error("Cached reads must not query providers");});t.after(()=>mock.restoreAll());
  const {videoAnalyticsData}=await import("../apps/web/src/server/projects");const result=await videoAnalyticsData(channel.id,"abcdefghijk","2026-01-01","2026-01-07");
  assert.equal(result.video?.id,"abcdefghijk");assert.equal(result.report,null);assert.equal(result.snapshot,null);assert.ok(filters.some(filter=>filter.includes('video_id="abcdefghijk"')&&filter.includes('start_date="2026-01-01"')&&filter.includes('end_date="2026-01-07"')&&filter.includes('youtube_channel_id="UCfixture"')));
});
