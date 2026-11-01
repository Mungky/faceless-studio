import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z,analysisPrompt,analysisResultSchema,detectPlatform,forYouScope,oembedEndpoint,parseJsonOutput,platformIds,platforms,referenceThumbnail,type ForYouCompetitor,type ForYouReference,type ModelRoute,type VideoAnalysis} from "@studio/core";
import {publicSourceUrl,type ChatPart} from "@studio/connectors";
import {db,DatabaseError} from "./pocketbase";
import {browserConnector,routerConnector,searchConnector} from "./provider-credentials";
import {saveWorkspace,workspaceRecord,workspaceRows} from "./workspace";

const refKey=(url:string)=>"fy-ref:"+createHash("sha256").update(url).digest("hex").slice(0,32);
const rows=<T,>(kind:string)=>workspaceRows<T>(forYouScope,kind);

export async function forYouData(){
  const [references,competitors,analyses]=await Promise.all([rows<ForYouReference>("fy-reference"),rows<ForYouCompetitor>("fy-competitor"),rows<VideoAnalysis>("fy-analysis")]);
  return {references:references.map(r=>r.data),competitors:competitors.map(r=>r.data),analyses:analyses.map(r=>r.data)};
}

async function oembed(url:string){
  const endpoint=oembedEndpoint(url);if(!endpoint)return null;
  try{const response=await fetch(endpoint,{signal:AbortSignal.timeout(10_000),redirect:"follow"});if(!response.ok)return null;const data=await response.json() as {title?:string;author_name?:string;thumbnail_url?:string};return {title:String(data.title||"").slice(0,300),author:String(data.author_name||"").slice(0,200),thumbnail:String(data.thumbnail_url||"").slice(0,2000)};}catch{return null;}
}
async function storeReference(input:Omit<ForYouReference,"id"|"saved"|"observed_at"|"thumbnail">&{thumbnail?:string;saved?:boolean}){
  const key=refKey(input.url),old=await workspaceRecord<ForYouReference>(key);
  const data:ForYouReference={...old?.data,...input,id:old?.data.id||randomUUID(),thumbnail:input.thumbnail||old?.data.thumbnail||referenceThumbnail({url:input.url}),saved:input.saved??old?.data.saved??false,observed_at:new Date().toISOString(),...(old?.data.analysis_id?{analysis_id:old.data.analysis_id}:{})};
  return (await saveWorkspace(key,"fy-reference",forYouScope,data)).data;
}

// Paste any public post or video link; oEmbed fills title and thumbnail where the platform offers it.
export async function addReference(input:unknown){
  const {url:raw}=z.object({url:z.string().trim().min(8).max(2000)}).strict().parse(input);const url=publicSourceUrl(raw).href,platform=detectPlatform(url),meta=await oembed(url);
  return storeReference({url,platform,title:meta?.title||url,author:meta?.author||"",thumbnail:meta?.thumbnail||"",caption:"",views:null,source:meta?"oEmbed":"Tautan",saved:true});
}

export async function searchReferences(input:unknown){
  const value=z.object({query:z.string().trim().max(500).default(""),platforms:z.array(z.enum(platformIds)).min(1).max(5),competitors:z.boolean().default(false)}).strict().parse(input);
  const competitors=value.competitors?(await rows<ForYouCompetitor>("fy-competitor")).map(r=>r.data).filter(c=>value.platforms.includes(c.platform)):[];
  const sites=platforms.filter(p=>value.platforms.includes(p.id));
  const queries=value.competitors?competitors.map(c=>`site:${platforms.find(p=>p.id===c.platform)?.site||""} "${c.name}" ${value.query}`.trim()):sites.map(p=>`site:${p.site} ${value.query}`);
  if(value.competitors&&!competitors.length)throw new Error("Tambahkan kompetitor untuk platform yang dipilih terlebih dahulu.");
  if(!value.competitors&&!value.query)throw new Error("Isi topik atau niche yang ingin dicari.");
  const search=await searchConnector(),results=(await Promise.all(queries.slice(0,8).map(q=>search.search(q).catch(()=>[])))).flat();
  const saved:ForYouReference[]=[];const seen=new Set<string>();
  for(const row of results){if(seen.has(row.url))continue;seen.add(row.url);saved.push(await storeReference({url:row.url,platform:detectPlatform(row.url),title:row.title,author:"",thumbnail:row.thumbnail,caption:row.summary,views:null,source:row.source}));}
  return saved;
}

export async function saveForYouReference(id:string,input:unknown){
  const row=(await rows<ForYouReference>("fy-reference")).find(r=>r.data.id===id);if(!row)throw new DatabaseError(404,"Referensi tidak ditemukan.");
  const {saved}=z.object({saved:z.boolean()}).strict().parse(input);return (await saveWorkspace(row.key,row.kind,forYouScope,{...row.data,saved})).data;
}

export async function addForYouCompetitor(input:unknown){
  const value=z.object({name:z.string().trim().min(1).max(200),url:z.string().trim().max(2000)}).strict().parse(input);const url=publicSourceUrl(value.url).href;
  const data:ForYouCompetitor={id:randomUUID(),name:value.name,url,platform:detectPlatform(url),created:new Date().toISOString()};
  return (await saveWorkspace("fy-competitor:"+data.id,"fy-competitor",forYouScope,data,undefined,true)).data;
}

async function analysisModel(){
  const routes=await db.list<ModelRoute>("model_routes");const route=["analysis","chat","research"].map(task=>routes.find(r=>r.task===task)).find(Boolean);
  if(!route)throw new Error("Pilih model untuk Analisis video di Pengaturan → Model AI.");
  if(route.billing!=="free")throw new Error("Analisis video memakai model gratis. Ubah rute Analisis video menjadi gratis di Pengaturan → Model AI.");
  return route;
}
async function score(route:ModelRoute,reference:ForYouReference,evidence:ChatPart[]){
  const result=await (await routerConnector()).chat(route.model,[{role:"system",content:analysisPrompt},{role:"user",content:[{type:"text",text:`Platform: ${reference.platform}\nURL: ${reference.url}\nJudul: ${reference.title}\nKreator: ${reference.author||"-"}\nCaption/ringkasan: ${reference.caption.slice(0,6000)||"-"}`},...evidence]}],Math.min(route.max_output_tokens||4000,8000));
  return analysisResultSchema.parse(parseJsonOutput(result.text));
}
async function saveAnalysis(analysis:VideoAnalysis){await saveWorkspace("fy-analysis:"+analysis.id,"fy-analysis",forYouScope,analysis);return analysis;}

// Quick analysis reads public text only; deep analysis hands the video to the PC worker
// (yt-dlp + ffmpeg frames + optional speech-to-text) and scores the frames with a vision model.
export async function analyzeReference(id:string,input:unknown){
  const {depth}=z.object({depth:z.enum(["quick","deep"]).default("quick")}).strict().parse(input);
  const row=(await rows<ForYouReference>("fy-reference")).find(r=>r.data.id===id);if(!row)throw new DatabaseError(404,"Referensi tidak ditemukan.");
  const reference=row.data,route=await analysisModel(),base={id:randomUUID(),reference_id:reference.id,url:reference.url,title:reference.title,platform:reference.platform,depth,model:route.model,created:new Date().toISOString()};
  if(depth==="deep"){
    const job=await db.create<{id:string}>("jobs",{type:"analyze",episode:"",payload:{url:reference.url,analysis_id:base.id},status:"queued",worker_id:"",progress:0,log:"Menunggu PC worker dengan kemampuan analyze.\n",result_asset:"",attempts:0});
    const analysis=await saveAnalysis({...base,...analysisResultSchema.parse({}),status:"queued",job_id:job.id});
    await saveWorkspace(row.key,row.kind,forYouScope,{...reference,analysis_id:analysis.id});return analysis;
  }
  let page="";try{page=(await (await browserConnector()).read(reference.url)).content.slice(0,12_000);}catch{/* Obscura is optional for a quick read */}
  const result=await score(route,reference,page?[{type:"text",text:"Isi halaman:\n"+page}]:[]);
  const analysis=await saveAnalysis({...base,...result,status:"done"});
  await saveWorkspace(row.key,row.kind,forYouScope,{...reference,analysis_id:analysis.id});return analysis;
}

export async function completeDeepAnalysis(input:unknown){
  const value=z.object({job_id:z.string(),analysis_id:z.string().uuid(),transcript:z.string().max(60_000).default(""),frames:z.array(z.string().max(400_000)).max(16).default([]),error:z.string().max(4000).optional()}).parse(input);
  const record=await workspaceRecord<VideoAnalysis>("fy-analysis:"+value.analysis_id);if(!record)throw new DatabaseError(404,"Analisis tidak ditemukan.");
  const finish=(status:"done"|"failed",log:string)=>db.update("jobs",value.job_id,{status,progress:100,finished:new Date().toISOString(),log});
  try{
    if(value.error)throw new Error(value.error);
    const reference=(await rows<ForYouReference>("fy-reference")).find(r=>r.data.id===record.data.reference_id)?.data;if(!reference)throw new Error("Referensi sudah dihapus.");
    const evidence:ChatPart[]=[...(value.transcript?[{type:"text" as const,text:"Transkrip:\n"+value.transcript}]:[]),...value.frames.map(frame=>({type:"image_url" as const,image_url:{url:"data:image/jpeg;base64,"+frame}}))];
    const result=await score(await analysisModel(),reference,evidence);
    await saveAnalysis({...record.data,...result,status:"done"});await finish("done","Analisis mendalam selesai.\n");
  }catch(error){await saveAnalysis({...record.data,status:"failed",error:(error as Error).message});await finish("failed",(error as Error).message+"\n");}
  return {ok:true};
}
