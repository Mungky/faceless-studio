import assert from "node:assert/strict";
import {spawn,type ChildProcess} from "node:child_process";
import {mkdir,writeFile,access} from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import puppeteer from "puppeteer-core";

const root=path.resolve(import.meta.dirname,".."),directory=path.join(root,".runtime","assets-browser-"+Date.now());await mkdir(directory,{recursive:true});
const vault=path.join(directory,"vault");for(const name of ["Arthur","Not Yet","Exhibit Pop"]){await mkdir(path.join(vault,name),{recursive:true});await writeFile(path.join(vault,name,name+".md"),"Asset browser fixture for "+name+".");}
const password=randomBytes(24).toString("hex"),port=26000+Math.floor(Math.random()*4000),webPort=process.env.TEST_WEB_PORT||"3180",base="http://127.0.0.1:"+webPort,pb="http://127.0.0.1:"+port;
const env={...process.env,STUDIO_AUTOMATION_DISABLED:"1",POCKETBASE_URL:pb,PB_ADMIN_EMAIL:"ui-admin@studio.local",PB_ADMIN_PASSWORD:password,STUDIO_OWNER_EMAIL:"ui-owner@studio.local",STUDIO_OWNER_PASSWORD:password,VAULT_ROOT:vault,APP_URL:base,NINEROUTER_URL:"",RCLONE_REMOTE:"",ELEVENLABS_API_KEY:"",GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:"",SEARXNG_URL:"",OBSCURA_MCP_URL:""};
const children:ChildProcess[]=[];let logs="";
function start(command:string,args:string[]){const child=spawn(command,args,{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});child.stdout?.on("data",d=>{logs+=d;});child.stderr?.on("data",d=>{logs+=d;});children.push(child);return child;}
async function ready(url:string){for(let i=0;i<120;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await delay(250);}throw new Error("Test server did not start. "+logs.slice(-1500));}
async function pbApi<T>(route:string,body?:unknown,token?:string):Promise<T>{const response=await fetch(pb+route,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:token}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(route+" "+response.status+" "+await response.text());return response.json() as Promise<T>;}
let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
try{
  start(path.join(root,".runtime/pocketbase.exe"),["serve","--http=127.0.0.1:"+port,"--dir="+path.join(directory,"db"),"--migrationsDir="+path.join(root,"infra/pocketbase/pb_migrations"),"--hooksDir="+path.join(root,"infra/pocketbase/pb_hooks"),"--automigrate=false"]);await ready(pb+"/api/health");
  const {token}=await pbApi<{token:string}>("/api/collections/_superusers/auth-with-password",{identity:env.PB_ADMIN_EMAIL,password});
  const channels=(await pbApi<{items:Array<{id:string;name:string}>}>("/api/collections/channels/records?perPage=50",undefined,token)).items,arthur=channels.find(c=>c.name==="Arthur")!,notYet=channels.find(c=>c.name==="Not Yet")!;
  const episode=(channel:string,title:string,slug:string)=>pbApi<{id:string}>("/api/collections/episodes/records",{channel,title,slug,status:"idea",format:"short",vault_path:"fixture/"+slug},token);
  const [epArthur,epNotYet]=[await episode(arthur.id,"Episode Arthur","arthur-fixture"),await episode(notYet.id,"Episode Not Yet","notyet-fixture")];
  const asset=(ep:string,kind:string,file:string,extra:Record<string,unknown>={})=>pbApi("/api/collections/assets/records",{episode:ep,kind,drive_path:"Faceless/fixture/"+file,source:"fixture",selected:true,...extra},token);
  await asset(epArthur.id,"image","frame-1.png");await asset(epArthur.id,"image","frame-2.png",{asset_group:"Intro",tags:["hero"]});await asset(epArthur.id,"vo","narration.mp3");await asset(epNotYet.id,"video","clip-1.mp4");await asset(epNotYet.id,"render","final.mp4",{asset_group:"Final",tags:["hero","cut"]});
  start(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"dev",path.join(root,"apps/web"),"--hostname","127.0.0.1","--port",webPort]);await ready(base);
  const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";await access(chrome);browser=await puppeteer.launch({executablePath:chrome,headless:true,userDataDir:path.join(directory,"browser-profile"),args:["--no-first-run","--disable-default-apps"],defaultViewport:{width:1440,height:1000}});
  const page=await browser.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto(base,{waitUntil:"networkidle0"});await page.type('input[name="email"]',env.STUDIO_OWNER_EMAIL);await page.type('input[name="password"]',password);await page.click('button[type="submit"]');await page.waitForSelector(".project-cards .project-card");
  assert.equal(await page.$$eval(".workspace-topbar>nav>button",b=>b.map(x=>x.textContent).join(",")),"Channel,Studio,FYP,Asset");
  await page.click(".workspace-topbar>nav>button:nth-child(4)");await page.waitForSelector(".alib-grid");
  const count=()=>page.$$eval(".alib-card",cards=>cards.length);
  const expectCount=async(n:number)=>{await page.waitForFunction(expected=>document.querySelectorAll(".alib-card").length===expected,{timeout:10000},n);assert.equal(await count(),n);};
  await expectCount(5);
  assert.deepEqual(await page.$$eval(".alib-section h2",h=>h.map(x=>x.textContent)),["Final","Intro","Tanpa grup"]);
  await page.screenshot({path:path.join(directory,"assets-desktop.png")});
  await page.select('[aria-label="Pemilik channel"]',arthur.id);await expectCount(3);
  await page.select('[aria-label="Pemilik channel"]',"");
  await page.select('[aria-label="Tag"]',"hero");await expectCount(2);
  await page.select('[aria-label="Tag"]',"");
  await page.type('[aria-label="Cari asset"]',"narration");await expectCount(1);
  await page.evaluate(()=>{(([...document.querySelectorAll(".alib-toolbar button")].find(b=>b.textContent==="Reset"))as HTMLButtonElement|undefined)?.click();});await expectCount(5);
  const ungrouped=await page.$$(".alib-section:last-of-type .alib-check input");await ungrouped[0]?.click();await ungrouped[1]?.click();
  await page.waitForSelector(".alib-bulk");
  await page.type('.alib-bulk [aria-label="Nama grup"]',"B-roll");await page.click(".alib-bulk form:nth-of-type(1) button");
  await page.waitForFunction(()=>[...document.querySelectorAll(".alib-section h2")].some(h=>h.textContent==="B-roll"),{timeout:15000});
  await page.click(".alib-card:nth-child(1) .alib-open");await page.waitForSelector(".alib-detail");
  await page.type('.alib-detail [aria-label="Tag baru"]',"Selesai, Final-Cut");await page.click(".alib-tag-add button");
  assert.deepEqual(await page.$$eval(".alib-detail .alib-tags .chip",c=>c.map(x=>x.textContent)).then(list=>list.slice(-2)),["selesai","final-cut"]);
  await page.click('.alib-detail button[type="submit"]');await page.waitForFunction(()=>!document.querySelector(".alib-detail"),{timeout:15000});
  const stored=await pbApi<{items:Array<{asset_group:string;tags:string[]|null}>}>("/api/collections/assets/records?perPage=50",undefined,token);
  assert.ok(stored.items.some(a=>a.asset_group==="B-roll"),"bulk group persisted");
  assert.ok(stored.items.some(a=>Array.isArray(a.tags)&&a.tags.includes("final-cut")),"detail tags persisted");
  await page.reload({waitUntil:"networkidle0"});await page.waitForSelector(".alib-grid");await expectCount(5);
  await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(directory,"assets-mobile.png")});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,"no horizontal overflow on phone");
  assert.deepEqual(errors,[]);
}catch(error){await writeFile(path.join(directory,"server.log"),logs);throw error;}
finally{await browser?.close();for(const child of children.reverse())child.kill();await Promise.all(children.map(child=>Promise.race([new Promise(resolve=>child.once("exit",resolve)),delay(3000)])));console.log("Assets browser test artifacts: "+directory);}
