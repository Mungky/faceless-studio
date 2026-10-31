import {z} from "zod";
export const compositionSchema=z.object({files:z.array(z.object({path:z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:html|css|js|json|svg)$/),content:z.string().max(500000)}).strict()).min(1).max(40),duration:z.number().positive().max(7200),width:z.number().int().min(240).max(3840),height:z.number().int().min(240).max(3840)}).strict();
export type CompositionSource=z.infer<typeof compositionSchema>;
export interface CompositionRevision {source:CompositionSource;hash:string;script_revision:string;storyboard_revision:string;created:string;approved_hash:string;}
export function validateComposition(value:unknown):CompositionSource{
  const parsed=compositionSchema.parse(value);if(new Set(parsed.files.map(f=>f.path.toLowerCase())).size!==parsed.files.length)throw new Error("Composition filenames must be unique.");
  if(parsed.files.reduce((n,f)=>n+f.content.length,0)>1_000_000)throw new Error("Composition exceeds 1 MB.");
  const html=parsed.files.find(f=>f.path==="index.html")?.content||"",all=parsed.files.map(f=>f.content).join("\n");
  if(!/data-composition-id\s*=\s*["']main["']/.test(html)||!all.includes("__timelines"))throw new Error("Use a main HyperFrames composition and a seekable timeline.");
  if(/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/|file:)|(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(|import\s*\(\s*["'](?:https?:|file:)/i.test(all))throw new Error("Composition must use bundled local assets and libraries.");
  return parsed;
}
export function compositionDigest(source:CompositionSource){return JSON.stringify({duration:source.duration,width:source.width,height:source.height,files:[...source.files].sort((a,b)=>a.path.localeCompare(b.path)).map(f=>({path:f.path,content:f.content}))});}
export function validateNarrationTake<T extends {id:string;kind:string;selected:boolean;meta:Record<string,unknown>}>(assets:T[],duration:number):T{const takes=assets.filter(a=>a.kind==="vo"&&a.selected);if(takes.length!==1)throw new Error("Pilih tepat satu take narasi sebelum render.");const seconds=Number(takes[0].meta.duration_seconds||takes[0].meta.duration||0);if(seconds>duration+.05)throw new Error("Durasi komposisi lebih pendek dari narasi. Perpanjang animasi agar ucapan tidak terpotong.");return takes[0];}
