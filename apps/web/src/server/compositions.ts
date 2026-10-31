import "server-only";
import {z,recordId,validateComposition,compositionDigest,validateNarrationTake,type CompositionRevision,type Asset,type Job,type WorkspaceRecord} from "@studio/core";
import {db,filterValue} from "./pocketbase";
import {episodeDetails,documentRevision} from "./service";
export async function compositionData(episode:string){recordId.parse(episode);const detail=await episodeDetails(episode);const hash=String(detail.episode.script_meta.composition_hash||"");const [row]=hash?await db.list<WorkspaceRecord<CompositionRevision>>("workspace_records","key="+filterValue("composition:"+episode+":"+hash)):[];return {composition:row?.data||null,stills:detail.assets.filter(a=>a.kind==="image"&&a.meta.composition_hash===hash),jobs:detail.jobs.filter(j=>j.payload.composition_hash===hash)};}
export async function saveComposition(episode:string,input:unknown,expectedScript?:string,expectedStoryboard?:string){
  const source=validateComposition(input),detail=await episodeDetails(episode);if(!detail.episode.script_approved||detail.script_approval_stale)throw new Error("Approve the current script before building its composition.");
  if(expectedScript&&expectedScript!==detail.revisions["script.md"]||expectedStoryboard&&expectedStoryboard!==detail.revisions["storyboard.md"])throw new Error("Composition source changed during generation. Existing code was preserved.");
  const hash=documentRevision(compositionDigest(source)),key="composition:"+episode+":"+hash;const data:CompositionRevision={source,hash,script_revision:detail.revisions["script.md"],storyboard_revision:detail.revisions["storyboard.md"],created:new Date().toISOString(),approved_hash:""};
  await db.custom("workspace-save",{key,kind:"composition",channel:detail.channel.id,data});await db.update("episodes",episode,{script_meta:{...detail.episode.script_meta,composition_hash:hash}});return data;
}
async function currentComposition(episode:string){const detail=await episodeDetails(episode),{composition}=await compositionData(episode);if(!composition)throw new Error("Buat komposisi kode terlebih dahulu.");if(!detail.episode.script_approved||detail.script_approval_stale||composition.script_revision!==detail.revisions["script.md"]||composition.storyboard_revision!==detail.revisions["storyboard.md"])throw new Error("Naskah atau storyboard berubah. Perbarui komposisi sebelum membuat frame atau render.");return {detail,composition};}
export async function reviewComposition(episode:string,input:unknown){
  const value=z.object({hash:z.string().length(64)}).strict().parse(input),{detail,composition}=await currentComposition(episode);if(value.hash!==composition.hash)throw new Error("Komposisi berubah sejak frame ditampilkan.");
  if(!detail.beats.length||detail.beats.some(b=>!detail.assets.some(a=>a.kind==="image"&&a.meta.composition_hash===composition.hash&&Number(a.meta.beat)===b.index)))throw new Error("Tunggu frame asli dari setiap beat sebelum menyetujui storyboard.");
  const data={...composition,approved_hash:composition.hash};await db.custom("workspace-save",{key:"composition:"+episode+":"+composition.hash,kind:"composition",channel:detail.channel.id,data});return data;
}
export async function queueComposition(episode:string,mode:"storyboard"|"render"){
  const {detail,composition}=await currentComposition(episode);if(!process.env.RCLONE_REMOTE)throw new Error("Hubungkan Drive untuk menyimpan hasil worker.");
  if(mode==="render"&&composition.approved_hash!==composition.hash)throw new Error("Review frame storyboard dari komposisi ini sebelum render.");
  if(mode==="render")validateNarrationTake(detail.assets,composition.source.duration);
  if(mode==="storyboard"&&!detail.beats.length)throw new Error("Siapkan beat storyboard dari naskah lengkap terlebih dahulu.");
  let elapsed=0;const targets=mode==="render"?[{beat:0,time:0}]:detail.beats.map(b=>{const time=elapsed+Math.min(.3,b.seconds/2);elapsed+=b.seconds;return {beat:b.index,time};});const jobs:Job[]=[];
  if(elapsed>composition.source.duration+.1)throw new Error("Durasi komposisi lebih pendek dari storyboard.");
  const context=await (await import("./service")).episodeContext(episode);
  for(const target of targets){const existing=detail.jobs.find(j=>j.payload.composition_hash===composition.hash&&j.payload.composition_mode===mode&&j.payload.script_revision===composition.script_revision&&j.payload.storyboard_revision===composition.storyboard_revision&&Number(j.payload.beat||0)===target.beat&&["queued","running"].includes(j.status));if(existing){jobs.push(existing);continue;}jobs.push(await db.create<Job>("jobs",{episode,type:"render",status:"queued",attempts:0,payload:{title:detail.episode.title,format:detail.episode.format,drive_base:context.driveBase,composition:composition.source,composition_hash:composition.hash,script_revision:composition.script_revision,storyboard_revision:composition.storyboard_revision,composition_approved_hash:composition.approved_hash,composition_mode:mode,beat:target.beat,time:target.time,assets:detail.assets.filter(a=>a.selected&&["vo","bgm","music","sfx"].includes(a.kind)).map(a=>({id:a.id,kind:a.kind,drive_path:a.drive_path,meta:a.meta}))}}));}
  return jobs;
}
export async function compositionJobCurrent(job:Job){if(!job.payload.composition_hash)return true;try{const {detail,composition}=await currentComposition(job.episode);return composition.hash===job.payload.composition_hash&&composition.script_revision===job.payload.script_revision&&composition.storyboard_revision===job.payload.storyboard_revision&&(job.payload.composition_mode!=="render"||composition.approved_hash===job.payload.composition_approved_hash&&composition.approved_hash===composition.hash);}catch{return false;}}
