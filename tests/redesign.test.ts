import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {analysisResultSchema,detectPlatform,oembedEndpoint,overallScore,referenceThumbnail,youtubeId} from "../packages/core/src/foryou";
import {agentReplySchema,stepsToGraph,studioActionSchema} from "../packages/core/src/studio-chat";
import {validateWorkflowGraph} from "../packages/core/src/workflow";
import {assetOrganizeSchema,assetTitle,filterAssets,type LibraryAsset} from "../packages/core/src/assets";
import {DriveConnector} from "../packages/connectors/src/drive";
import {parseJsonOutput} from "../packages/core/src/index";

test("For You recognises each platform from its link",()=>{
  assert.equal(detectPlatform("https://www.tiktok.com/@a/video/1"),"tiktok");
  assert.equal(detectPlatform("https://vt.tiktok.com/ZS123/"),"tiktok");
  assert.equal(detectPlatform("https://www.instagram.com/reel/abc/"),"instagram");
  assert.equal(detectPlatform("https://twitter.com/a/status/1"),"x");
  assert.equal(detectPlatform("https://www.threads.net/@a/post/1"),"threads");
  assert.equal(detectPlatform("https://youtu.be/dQw4w9WgXcQ"),"youtube");
  assert.equal(detectPlatform("https://example.com/a"),"web");
  assert.equal(detectPlatform("not a url"),"web");
});
test("YouTube ids, thumbnails and oEmbed endpoints come from public URLs only",()=>{
  assert.equal(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),"dQw4w9WgXcQ");
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"),"dQw4w9WgXcQ");
  assert.equal(referenceThumbnail({url:"https://youtu.be/dQw4w9WgXcQ"}),"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(referenceThumbnail({url:"https://www.tiktok.com/@a/video/1",thumbnail:"https://cdn/x.jpg"}),"https://cdn/x.jpg");
  assert.match(oembedEndpoint("https://www.tiktok.com/@a/video/1"),/^https:\/\/www\.tiktok\.com\/oembed\?url=/);
  assert.equal(oembedEndpoint("https://www.instagram.com/reel/abc/"),"");
});
test("analysis output is bounded and fills missing criteria instead of failing",()=>{
  const parsed=analysisResultSchema.parse(parseJsonOutput('```json\n{"summary":"ok","scores":{"hook":{"score":"8","reason":"cepat"},"visual":{"score":6}},"formula":["a"]}\n```'));
  assert.equal(parsed.scores.hook.score,8);
  assert.equal(parsed.scores.cta.score,0);
  assert.equal(overallScore({scores:{...parsed.scores}}),Math.round((8+6)/8*10)/10);
  assert.throws(()=>analysisResultSchema.parse({scores:{hook:{score:11}}}));
});
test("agent step lists become valid template graphs with a single brief root",()=>{
  const graph=stepsToGraph([{kind:"research",instructions:"cari"},{kind:"script",instructions:""},{kind:"review",instructions:""},{kind:"review",instructions:""}]);
  assert.equal(graph.nodes[0].kind,"brief");
  assert.deepEqual(graph.nodes.map(n=>n.id),["brief","research","script","review","review_2"]);
  assert.doesNotThrow(()=>validateWorkflowGraph(graph));
  assert.equal(stepsToGraph([{kind:"brief",instructions:""},{kind:"script",instructions:""}]).nodes.length,2);
});
test("agent replies accept one known action and reject unknown ones",()=>{
  assert.equal(agentReplySchema.parse({reply:"hai"}).action,undefined);
  assert.equal(studioActionSchema.parse({type:"analyze_reference",url:"https://www.tiktok.com/@a/video/1"}).type,"analyze_reference");
  assert.throws(()=>studioActionSchema.parse({type:"publish_video"}));
  assert.throws(()=>studioActionSchema.parse({type:"create_template",name:"x",steps:[{kind:"brief"}]}));
});
const asset=(id:string,patch:Partial<LibraryAsset>={}):LibraryAsset=>({id,kind:"image",episode:"",channel:"",drive_path:"Faceless/_library/x/stills/"+id+".png",asset_group:"",tags:[],created:"2026-10-31T00:00:00Z",...patch});
test("asset library filters by project, media type and trash",()=>{
  const list=[asset("a",{project:"Arthur"}),asset("b",{project:"Arthur",kind:"music"}),asset("c",{project:"Lain",deleted:true}),asset("d",{kind:"bgm"})];
  assert.deepEqual(filterAssets(list,{project:"Arthur"}).map(a=>a.id),["a","b"]);
  assert.deepEqual(filterAssets(list,{kinds:["music","bgm"]}).map(a=>a.id),["b","d"]);
  assert.deepEqual(filterAssets(list,{trash:true}).map(a=>a.id),["c"]);
  assert.equal(assetTitle(asset("e",{title:"  Intro  "})),"Intro");
  assert.equal(assetTitle(asset("f")),"f");
  assert.equal(assetOrganizeSchema.parse({ids:["abcdefghijklmno"],deleted:true}).deleted,true);
});
test("without RCLONE_REMOTE, media are stored and read back from the local folder",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"media-")),source=path.join(root,"in.txt"),back=path.join(root,"out.txt");await writeFile(source,"hello");
  const drive=new DriveConnector({binary:"rclone",remote:"",config:"",localRoot:path.join(root,"store")});
  const saved=await drive.upload(source,"Faceless/_library/uji/stills/a.txt");
  assert.deepEqual(saved,{id:"local",path:"Faceless/_library/uji/stills/a.txt",size:5});
  await drive.download(saved.path,back);assert.equal(await readFile(back,"utf8"),"hello");
  await assert.rejects(drive.upload(source,"Faceless/../escape.txt"),/Invalid Drive path/);
});
test("agent step lists cannot contain references and project actions are typed",()=>{
  assert.throws(()=>studioActionSchema.parse({type:"edit_template",template_id:"a",steps:[{kind:"brief"},{kind:"reference"}]}));
  const reference=studioActionSchema.parse({type:"add_reference",template_id:"a",name:"Acuan",url:"https://youtu.be/x"});assert.equal(reference.type==="add_reference"&&reference.ref_type,"link");
  assert.equal(studioActionSchema.parse({type:"direct_task",run_id:"abc",content:"Hook lebih tajam"}).type,"direct_task");
});
