import "server-only";
import {stat} from "node:fs/promises";
import {z,segment,recordId,type Channel} from "@studio/core";
import {db,filterValue} from "./pocketbase";
import {stopWorkflowRun} from "./workflows";
import {safeVaultPath} from "./vault";
import {ensureProjectWorkspace,removeProjectWorkspace} from "./project-workspace";

export const createChannelSchema=z.object({
  name:z.string().trim().min(1).max(80).refine(value=>segment.safeParse(value).success&&!/[<>:"/\\|?*\x00-\x1f]/.test(value)&&!/[. ]$/.test(value)&&!/^\.{1,2}$/.test(value)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value),"Use a channel name without path separators, reserved names or special filename characters."),
  playbook_path:z.string().trim().max(1000).default("").refine(value=>!value||(value.endsWith(".md")&&value.split("/").every(part=>segment.safeParse(part).success)),"Choose a Markdown playbook inside the vault."),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#758A68")
});
export async function createChannel(input:unknown):Promise<Channel>{
  const value=createChannelSchema.parse(input);
  const channels=await db.list<Channel>("channels");
  if(channels.some(channel=>channel.name.toLowerCase()===value.name.toLowerCase()))throw new Error("A channel project with this name already exists.");
  if(value.playbook_path&&!(await stat(await safeVaultPath(value.playbook_path))).isFile())throw new Error("Choose an existing Markdown playbook inside the vault.");
  const created=await db.create<Channel>("channels",{...value,handle:"",youtube_channel_id:"",oauth_ref:""});
  await ensureProjectWorkspace(created).catch(()=>undefined);
  return created;
}

// Deletes a project and everything Studio keeps for it: tasks (stopped first), its recipe, episodes,
// settings and chats, reports and the YouTube link. Vault files, the asset library, spend history and
// any n8n workflow stay where they are. The owner confirms by typing the project's name.
export async function deleteChannel(id:string,input:unknown){
  recordId.parse(id);const {confirm}=z.object({confirm:z.string().max(120)}).strict().parse(input);
  const channel=await db.get<Channel>("channels",id);
  const prefs=(await db.list<{id:string;data:{project_name?:string}}>("workspace_records",`key=${filterValue("preferences:"+id)}`,"-created",1))[0];
  const names=[channel.name,prefs?.data?.project_name].filter(Boolean).map(n=>n!.trim().toLowerCase());
  if(!names.includes(confirm.trim().toLowerCase()))throw new Error("Ketik nama project persis untuk menghapusnya.");
  type Row={id:string;data?:{channel?:string}};
  const [runs,templates]=await Promise.all([db.list<Row>("workflow_runs","","-created",100_000),db.list<Row>("workflow_templates","","-created",100_000)]);
  const own=runs.filter(r=>r.data?.channel===id);
  for(const run of own)await stopWorkflowRun(run.id).catch(()=>undefined);
  const scoped=async(collection:string)=>(await db.list<Row>(collection,`channel=${filterValue(id)}`,"-created",100_000)).map(r=>r.id);
  const doomed:[string,string[]][]=[["workflow_runs",own.map(r=>r.id)],["workflow_templates",templates.filter(t=>t.data?.channel===id).map(t=>t.id)],
    ["episodes",await scoped("episodes")],["workspace_records",await scoped("workspace_records")],["video_reports",await scoped("video_reports")],["oauth_credentials",await scoped("oauth_credentials")]];
  let removed=0;
  for(const [collection,ids] of doomed)for(const record of ids){await db.delete(collection,record);removed++;}
  await db.delete("channels",id);
  await removeProjectWorkspace(channel.name);
  if(prefs?.data?.project_name&&prefs.data.project_name!==channel.name){
    await removeProjectWorkspace(prefs.data.project_name);
  }
  return {deleted:id,records:removed+1};
}
