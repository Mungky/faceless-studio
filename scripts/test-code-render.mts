import assert from "node:assert/strict";
import path from "node:path";
import {createHash} from "node:crypto";
import {mkdir,readFile,stat} from "node:fs/promises";
import {loadEnvFile} from "node:process";
import {compositionDigest,type CompositionSource} from "@studio/core";
import {renderCodeComposition} from "@studio/render-hyperframes";
import {run} from "@studio/connectors";
import {createServer} from "node:http";
try{loadEnvFile(".env");}catch{}
const directory=path.resolve(".runtime/code-render-smoke-"+Date.now());await mkdir(directory,{recursive:true});
const source:CompositionSource={duration:1,width:1080,height:1920,files:[{path:"index.html",content:'<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1080px;height:1920px;background:#18181b}#main{position:relative;width:1080px;height:1920px;overflow:hidden}#block{position:absolute;left:80px;top:500px;width:250px;height:250px;background:#d7d7df}</style></head><body><main id="main" data-composition-id="main" data-width="1080" data-height="1920" data-start="0" data-duration="1"><div id="block"></div></main><script src="assets/gsap.min.js"></script><script>const timeline=gsap.timeline({paused:true});timeline.to("#block",{x:650,rotation:180,duration:1,ease:"none"},0);window.__timelines={main:timeline};timeline.seek(0);</script></body></html>'}]};
const hash=createHash("sha256").update(compositionDigest(source)).digest("hex"),signal=AbortSignal.timeout(240000),log=(v:string)=>process.stdout.write(v);
let externalRequests=0;const trap=createServer((_request,response)=>{externalRequests++;response.writeHead(200,{"Content-Type":"text/plain"});response.end("network isolation fixture");});await new Promise<void>(resolve=>trap.listen(0,"127.0.0.1",resolve));
const trapUrl="http://127.0.0.1:"+(trap.address() as {port:number}).port;
try{const attack={...source,files:[{path:"index.html",content:source.files[0].content.replace("</style>",'body{background-image:url("'+trapUrl+'/css")}</style>').replace("timeline.seek(0);",'timeline.seek(0);navigator.sendBeacon("'+trapUrl+'/beacon","fixture");window.open("'+trapUrl+'/popup");')}]};const attackHash=createHash("sha256").update(compositionDigest(attack)).digest("hex");await renderCodeComposition({source:attack,hash:attackHash,mode:"storyboard",time:.1,audioPaths:[]},path.join(directory,"isolation"),signal,log);assert.equal(externalRequests,0,"Composition code must not contact other origins, including worker-local services");}finally{await new Promise<void>(resolve=>trap.close(()=>resolve()));}
const early=await renderCodeComposition({source,hash,mode:"storyboard",time:.1,audioPaths:[]},path.join(directory,"early"),signal,log);
const late=await renderCodeComposition({source,hash,mode:"storyboard",time:.8,audioPaths:[]},path.join(directory,"late"),signal,log);assert.notDeepEqual(await readFile(early),await readFile(late),"Actual code frames must change with timeline time");
const video=await renderCodeComposition({source,hash,mode:"render",time:0,audioPaths:[]},path.join(directory,"video"),signal,log);assert.ok((await stat(video)).size>1000);
const info=JSON.parse(await run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",video],{signal}));const stream=info.streams.find((s:any)=>s.codec_type==="video");assert.equal(stream.width,1080);assert.equal(stream.height,1920);assert.equal(stream.r_frame_rate,"24/1");assert.ok(Math.abs(Number(info.format.duration)-1)<.1);console.log("Code render passed: original seekable code, two distinct actual storyboard frames, 1080×1920, 24 fps and one-second render. Artifacts: "+directory);
