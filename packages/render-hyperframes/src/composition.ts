import path from "node:path";
import {createRequire} from "node:module";
import {mkdir,writeFile,copyFile,readFile,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import puppeteer from "puppeteer-core";
import {validateComposition,compositionDigest,type CompositionSource} from "@studio/core";
import {run} from "@studio/connectors";
const require=createRequire(import.meta.url);
export async function stageComposition(source:CompositionSource,hash:string,directory:string){
  const checked=validateComposition(source);if(createHash("sha256").update(compositionDigest(checked)).digest("hex")!==hash)throw new Error("Composition content does not match its approved hash.");
  const root=path.resolve(directory);await mkdir(root,{recursive:true});
  for(const file of checked.files){const target=path.resolve(root,...file.path.split("/"));if(!target.startsWith(root+path.sep))throw new Error("Composition file escapes its job directory.");await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content,{flag:"wx"});}
  await mkdir(path.join(root,"assets"),{recursive:true});await copyFile(require.resolve("gsap/dist/gsap.min.js"),path.join(root,"assets/gsap.min.js"));return root;
}
// The HTTP header cannot be removed by scene code. Interception additionally blocks
// top-level navigation; CSP blocks beacons, sockets, frames, workers and CSS resources.
const csp="sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
async function browserBinary(){for(const candidate of [process.env.PLAYWRIGHT_CHROME,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter((v):v is string=>!!v)){try{await access(candidate);return candidate;}catch{}}throw new Error("Set PLAYWRIGHT_CHROME to the worker's installed Chrome or Chromium browser.");}
export async function renderCodeComposition(input:{source:CompositionSource;hash:string;mode:"storyboard"|"render";time:number;audioPaths:string[]},directory:string,signal:AbortSignal,onLog:(s:string)=>void){
  const root=await stageComposition(input.source,input.hash,directory),allowed=new Set([...input.source.files.map(f=>f.path),"assets/gsap.min.js"]);
  const server=createServer(async(request,response)=>{try{const file=decodeURIComponent(new URL(request.url||"/","http://localhost").pathname).slice(1)||"index.html";if(!["GET","HEAD"].includes(request.method||"")||!allowed.has(file)){response.writeHead(404);response.end();return;}const mime:Record<string,string>={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml"};response.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Content-Security-Policy":csp,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(await readFile(path.join(root,...file.split("/"))));}catch{response.writeHead(404);response.end();}});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const origin="http://127.0.0.1:"+(server.address() as {port:number}).port;
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
  const abort=()=>{void browser?.close();};signal.addEventListener("abort",abort,{once:true});
  try{
    signal.throwIfAborted();browser=await puppeteer.launch({executablePath:await browserBinary(),headless:true,ignoreDefaultArgs:["--disable-popup-blocking"],userDataDir:path.join(root,".browser-profile"),args:["--no-first-run","--disable-default-apps","--disable-extensions","--disable-background-networking"],defaultViewport:{width:input.source.width,height:input.source.height,deviceScaleFactor:1}});
    const page=await browser.newPage();await page.setRequestInterception(true);page.on("request",request=>{const url=new URL(request.url());if(url.origin===origin&&["GET","HEAD"].includes(request.method())||["data:","blob:"].includes(url.protocol))void request.continue();else void request.abort("blockedbyclient");});
    await page.goto(origin+"/index.html",{waitUntil:"networkidle0",timeout:30000});await page.waitForFunction(()=>typeof (window as any).__timelines?.main?.seek==="function",{timeout:15000});await page.evaluate(async()=>{await document.fonts.ready;});
    const frame=async(time:number)=>{signal.throwIfAborted();await page.evaluate((t:number)=>{const timeline=(window as any).__timelines.main;timeline.pause?.();timeline.seek(t,false);},time);return Buffer.from(await page.screenshot({type:"png"}));};
    if(input.mode==="storyboard"){if(!Number.isFinite(input.time)||input.time<0||input.time>=input.source.duration)throw new Error("Storyboard frame time is outside the composition.");const output=path.join(root,"frame.png");await writeFile(output,await frame(input.time));return output;}
    const video=path.join(root,"video.mp4"),fps=24,total=Math.ceil(input.source.duration*fps);const encoder=spawn(process.env.FFMPEG_BIN||"ffmpeg",["-y","-f","image2pipe","-vcodec","png","-framerate",String(fps),"-i","pipe:0","-an","-c:v","libx264","-crf","18","-pix_fmt","yuv420p","-t",String(input.source.duration),"-movflags","+faststart",video],{windowsHide:true,stdio:["pipe","ignore","pipe"]});let logs="";encoder.stderr.on("data",d=>{logs=(logs+d).slice(-5000);});encoder.stdin.on("error",()=>{});const completed=new Promise<void>((resolve,reject)=>{encoder.once("error",reject);encoder.once("exit",code=>code===0?resolve():reject(new Error("Composition encoding failed: "+logs)));});completed.catch(()=>{});const stopEncoder=()=>encoder.kill();signal.addEventListener("abort",stopEncoder,{once:true});
    try{for(let i=0;i<total;i++){const buffer=await frame(i/fps);if(!encoder.stdin.write(buffer))await Promise.race([once(encoder.stdin,"drain"),completed]);if(i%fps===0)onLog("Composition frame "+i+"/"+total+"\n");}encoder.stdin.end();await completed;}finally{signal.removeEventListener("abort",stopEncoder);if(encoder.exitCode===null)encoder.kill();}
    if(!input.audioPaths.length)return video;
    const output=path.join(root,"final.mp4"),args=["-y","-i",video];input.audioPaths.forEach(file=>args.push("-i",file));const filters=input.audioPaths.map((_,i)=>"["+(i+1)+":a]volume="+(i===0?1:.22)+"[a"+i+"]");filters.push(input.audioPaths.map((_,i)=>"[a"+i+"]").join("")+"amix=inputs="+input.audioPaths.length+":duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=0:"+input.source.duration+"[audio]");args.push("-filter_complex",filters.join(";"),"-map","0:v","-map","[audio]","-c:v","copy","-c:a","aac","-t",String(input.source.duration),"-movflags","+faststart",output);await run(process.env.FFMPEG_BIN||"ffmpeg",args,{signal,onLog});return output;
  }finally{signal.removeEventListener("abort",abort);await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
