import "server-only";
import {stat} from "node:fs/promises";
import {z,segment,type Channel} from "@studio/core";
import {db} from "./pocketbase";
import {safeVaultPath} from "./vault";

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
  return db.create<Channel>("channels",{...value,handle:"",youtube_channel_id:"",oauth_ref:""});
}
