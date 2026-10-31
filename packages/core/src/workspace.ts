import {z} from "zod";

const channelId=z.string().regex(/^[a-zA-Z0-9]{15}$/,"Invalid channel");
const templateId=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const timezone=z.string().refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value}).format();return true;}catch{return false;}},"Invalid timezone");
export const channelPreferencesSchema=z.object({
  channel:channelId,
  default_template_id:templateId.or(z.literal("")).default(""),
  timezone:timezone.default("Asia/Jakarta"),
  slots:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(12).refine(v=>new Set(v).size===v.length,"Target times must be distinct").default(["19:00"]),
  lead_hours:z.number().int().min(1).max(168).default(24),
  queue_limit:z.number().int().min(1).max(30).default(4),
  research_enabled:z.boolean().default(false),
  analytics_enabled:z.boolean().default(true),
  competitor_enabled:z.boolean().default(false),
  niche:z.string().max(2000).default(""),
  model:z.string().max(150).default(""),
  revision:z.number().int().min(0).default(0)
}).strict();
export type ChannelPreferences=z.infer<typeof channelPreferencesSchema>;
export function defaultChannelPreferences(channel:string):ChannelPreferences{return channelPreferencesSchema.parse({channel});}
export function resolveEpisodeTemplate<T extends {id:string;channel:string}>(channel:string,preferences:ChannelPreferences,templates:T[],override?:string):T{
  const selected=override||preferences.default_template_id;
  if(selected){const found=templates.find(t=>t.id===selected);if(!found)throw new Error("Selected template is unavailable. Choose an existing template.");return found;}
  const own=templates.find(t=>t.channel===channel);
  if(!own)throw new Error("Create a template or choose a default template for this channel.");
  return own;
}
export function scheduledSlotKey(channel:string,day:string,time:string){channelId.parse(channel);z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day);z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(time);return ["production",channel,day,time.replace(":","")].join(":");}
export interface WorkspaceRecord<T=unknown>{id:string;key:string;kind:string;channel:string;data:T;created:string;updated:string;}
export interface Competitor {
  id:string;channel:string;name:string;url:string;external_id:string;source:"manual"|"similar"|"niche";enabled:boolean;created:string;
}
export interface ReferenceVideo {
  id:string;channel:string;title:string;url:string;thumbnail:string;author:string;published_at:string|null;observed_at:string;
  views:number|null;likes:number|null;source:string;summary:string;competitor_id?:string;saved:boolean;
}
export interface AgentEvidence {source:string;video_id:string;title:string;start:string;end:string;views:number|null;average_view_percentage:number|null;viewed_vs_swiped:number|null;}
export interface AgentReport {id:string;channel:string;video_id:string;created:string;source_hash:string;model:string;observations:string[];hypotheses:string[];recommendations:string[];evidence:AgentEvidence[];limitations:string[];}
export interface TemplateProposal {id:string;channel:string;template_id:string;base_version:string;report_id:string;status:"pending"|"approved"|"rejected";instructions:string;reason:string;created:string;decided_at?:string;}
export interface ScheduledTask {id:string;key:string;channel:string;kind:"research"|"analytics"|"evaluation"|"competitors";status:"queued"|"running"|"done"|"blocked"|"failed";target_at:string;created:string;error?:string;run_id?:string;attempts:number;lease_until?:string;revision:number;}

export function comparableEvidence<T extends {start:string;end:string}>(items:T[],target:{start:string;end:string}):T[]{return items.filter(i=>i.start===target.start&&i.end===target.end);}
export function medianValue(values:(number|null|undefined)[]):number|null{const valid=values.filter((n):n is number=>typeof n==="number"&&Number.isFinite(n)).sort((a,b)=>a-b);const m=Math.floor(valid.length/2);return !valid.length?null:valid.length%2?valid[m]:(valid[m-1]+valid[m])/2;}
