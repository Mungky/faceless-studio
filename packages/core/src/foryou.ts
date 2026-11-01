import {z} from "zod";

// For You is workspace-wide: rows live in workspace_records under this pseudo channel id.
export const forYouScope="foryou000000000";

export const platforms=[
  {id:"youtube",label:"YouTube",site:"youtube.com",hosts:["youtube.com","youtu.be"]},
  {id:"tiktok",label:"TikTok",site:"tiktok.com",hosts:["tiktok.com"]},
  {id:"instagram",label:"Instagram",site:"instagram.com",hosts:["instagram.com"]},
  {id:"x",label:"X / Twitter",site:"x.com",hosts:["x.com","twitter.com"]},
  {id:"threads",label:"Threads",site:"threads.net",hosts:["threads.net","threads.com"]}] as const;
export type PlatformId=typeof platforms[number]["id"]|"web";
export const platformIds=platforms.map(p=>p.id) as [PlatformId,...PlatformId[]];

export function detectPlatform(value:string):PlatformId{
  try{const host=new URL(value).hostname.toLowerCase().replace(/^(www|m|vm|vt|mobile)\./,"");return platforms.find(p=>p.hosts.some(h=>host===h||host.endsWith("."+h)))?.id||"web";}catch{return "web";}
}
export function youtubeId(value:string){
  try{const url=new URL(value),host=url.hostname.replace(/^(www|m)\./,"");if(host==="youtu.be")return /^\/([\w-]{11})/.exec(url.pathname)?.[1]||"";if(host==="youtube.com")return (url.searchParams.get("v")||/^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url.pathname)?.[1]||"").slice(0,11);}catch{}return "";
}
// Public oEmbed endpoints need no key; other platforms fall back to reading the page.
export function oembedEndpoint(value:string){
  const platform=detectPlatform(value),encoded=encodeURIComponent(value);
  if(platform==="youtube")return "https://www.youtube.com/oembed?format=json&url="+encoded;
  if(platform==="tiktok")return "https://www.tiktok.com/oembed?url="+encoded;
  return "";
}
export function referenceThumbnail(reference:{thumbnail?:string;url:string}){
  if(reference.thumbnail)return reference.thumbnail;const id=youtubeId(reference.url);return id?"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg":"";
}

export interface ForYouReference {id:string;url:string;platform:PlatformId;title:string;author:string;thumbnail:string;caption:string;views:number|null;source:string;saved:boolean;observed_at:string;analysis_id?:string;}
export interface ForYouCompetitor {id:string;name:string;url:string;platform:PlatformId;created:string;}

export const analysisCriteria=[
  {id:"hook",label:"Hook"},{id:"structure",label:"Storyboard & struktur"},{id:"visual",label:"Visual"},{id:"transition",label:"Transisi"},
  {id:"pacing",label:"Pacing"},{id:"audio",label:"Audio & VO"},{id:"caption",label:"Teks & caption"},{id:"cta",label:"CTA & retensi"}] as const;
const score=z.object({score:z.coerce.number().min(0).max(10),reason:z.string().max(1200).default("")});
export const analysisResultSchema=z.object({
  summary:z.string().max(3000).default(""),
  scores:z.object(Object.fromEntries(analysisCriteria.map(c=>[c.id,score.default({score:0,reason:"Tidak cukup bukti."})])) as Record<typeof analysisCriteria[number]["id"],z.ZodDefault<typeof score>>),
  beats:z.array(z.object({time:z.string().max(20).default(""),description:z.string().max(600)})).max(30).default([]),
  formula:z.array(z.string().max(400)).max(12).default([]),
  niche:z.string().max(300).default(""),
  limitations:z.array(z.string().max(400)).max(8).default([])
});
export type AnalysisResult=z.infer<typeof analysisResultSchema>;
export interface VideoAnalysis extends AnalysisResult {id:string;reference_id:string;url:string;title:string;platform:PlatformId;depth:"quick"|"deep";status:"queued"|"done"|"failed";error?:string;job_id?:string;model:string;created:string;}
export const overallScore=(analysis:Pick<AnalysisResult,"scores">)=>{const values=Object.values(analysis.scores).map(s=>s.score);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:0;};

export const analysisPrompt=`Kamu adalah analis video pendek untuk channel faceless. Nilai video berdasarkan bukti yang diberikan saja (metadata, caption, transkrip, frame). Jangan mengarang detail yang tidak terlihat; jika bukti kurang, beri skor rendah dan jelaskan di limitations.
Balas HANYA JSON valid dengan bentuk:
{"summary":"ringkasan 2-3 kalimat","scores":{${analysisCriteria.map(c=>`"${c.id}":{"score":0-10,"reason":"..."}`).join(",")}},"beats":[{"time":"0:00","description":"..."}],"formula":["pola yang bisa ditiru"],"niche":"niche/tema video","limitations":["..."]}
Tulis dalam Bahasa Indonesia.`;
