import {z} from "zod";
import {referenceTypes,workflowKinds,workflowNodeInfo,type WorkflowGraph,type WorkflowNodeKind} from "./workflow";

// Studio threads are stored like For You rows: workspace-wide, keyed per thread.
export const studioScope="studiochat00000";

// References are inputs wired on the canvas, so they are never part of an ordered step list.
export const stepKinds=workflowKinds.filter(kind=>kind!=="reference") as Exclude<WorkflowNodeKind,"reference">[];
const stepSchema=z.object({kind:z.enum(stepKinds as [Exclude<WorkflowNodeKind,"reference">,...Exclude<WorkflowNodeKind,"reference">[]]),title:z.string().trim().min(1).max(120).optional(),instructions:z.string().max(20_000).default(""),review:z.boolean().optional(),provider:z.enum(["manual","flow","webhook"]).optional(),media_kind:z.enum(["image","video"]).optional()});
export type StudioStep=z.infer<typeof stepSchema>;
// Every action is only a proposal; the owner applies it from the action card.
export const studioActionSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("create_template"),name:z.string().trim().min(1).max(120),description:z.string().max(2000).default(""),niche:z.string().max(2000).default(""),instructions:z.string().max(20_000).default(""),channel:z.string().default(""),steps:z.array(stepSchema).min(2).max(40)}),
  z.object({type:z.literal("edit_template"),template_id:z.string().min(1).max(80),instructions:z.string().max(20_000).optional(),steps:z.array(stepSchema).min(2).max(40).optional()}),
  z.object({type:z.literal("start_episode"),channel:z.string().min(1),template_id:z.string().min(1).max(80),entry_mode:z.enum(["research","idea","script"]).default("research"),title:z.string().max(200).default(""),content:z.string().max(100_000).default("")}),
  z.object({type:z.literal("analyze_reference"),url:z.string().url().max(2000)}),
  z.object({type:z.literal("run_step"),run_id:z.string().min(1),node_id:z.string().max(80).optional()}),
  z.object({type:z.literal("add_reference"),template_id:z.string().min(1).max(80),name:z.string().trim().min(1).max(200),ref_type:z.enum(referenceTypes).default("link"),url:z.string().max(2000).default(""),content:z.string().max(50_000).default(""),instructions:z.string().max(20_000).default(""),target:z.string().max(80).optional()}),
  z.object({type:z.literal("build_n8n_workflow"),name:z.string().trim().max(120).optional()}),
  z.object({type:z.literal("add_n8n_node"),workflow_id:z.string().optional(),explanation:z.string().max(2000).optional(),node:z.object({name:z.string().trim().min(1).max(120),type:z.string().min(1).max(120),typeVersion:z.number().default(1),parameters:z.record(z.string(),z.any()).default({}),credentials:z.record(z.string(),z.any()).optional(),position:z.tuple([z.number(),z.number()]).optional()}),connect_from:z.string().optional(),connect_to:z.string().optional()}),
  z.object({type:z.literal("modify_n8n_node"),workflow_id:z.string().optional(),node_name:z.string().min(1).max(120),explanation:z.string().max(2000).optional(),parameters:z.record(z.string(),z.any()).optional(),prompt:z.string().max(20_000).optional()}),
  z.object({type:z.literal("remove_n8n_node"),workflow_id:z.string().optional(),node_name:z.string().min(1).max(120),explanation:z.string().max(2000).optional()}),
  z.object({type:z.literal("update_n8n_workflow"),workflow_id:z.string().optional(),explanation:z.string().max(2000).optional(),nodes:z.array(z.record(z.string(),z.any())),connections:z.record(z.string(),z.any())}),
  z.object({type:z.literal("setup_n8n_credential"),name:z.string().trim().min(1).max(120),credential_type:z.string().min(1).max(120),data:z.record(z.string(),z.any())}),
  z.object({type:z.literal("publish_n8n_workflow"),workflow_id:z.string().optional(),active:z.boolean().default(true),explanation:z.string().max(2000).optional()}),
  z.object({type:z.literal("execute_n8n_workflow"),workflow_id:z.string().optional(),brief:z.string().max(2000).default(""),title:z.string().max(200).default(""),explanation:z.string().max(2000).optional()}),
  z.object({type:z.literal("direct_task"),run_id:z.string().min(1),node_id:z.string().max(80).optional(),content:z.string().trim().min(1).max(20_000)})]);
export type StudioAction=z.infer<typeof studioActionSchema>;
export interface StudioMessage {id:string;role:"user"|"assistant";content:string;created:string;action?:StudioAction&{status:"proposed"|"applied"|"dismissed"|"failed";result?:string;link?:{view:string;id:string}};}
export interface StudioThread {id:string;title:string;messages:StudioMessage[];attachments:{analyses:string[];template?:string;run?:string;project?:string};created:string;updated:string;revision:number;
  // Older turns the agent no longer reads in full, condensed so a long project chat keeps its context.
  memory?:string;}
export const agentReplySchema=z.object({reply:z.string().max(20_000).default(""),action:studioActionSchema.nullish()});

// Turns an agent's ordered step list into a valid template graph: one brief root,
// then steps in order, placed in a readable snake layout on the canvas.
export function stepsToGraph(steps:readonly StudioStep[]):WorkflowGraph{
  const ordered=steps[0]?.kind==="brief"?[...steps]:[{kind:"brief",instructions:""} as StudioStep,...steps];
  const used=new Map<string,number>();
  const nodes=ordered.map((step,i)=>{const count=(used.get(step.kind)||0)+1;used.set(step.kind,count);const id=count>1?`${step.kind}_${count}`:step.kind;const row=Math.floor(i/3),col=row%2===0?i%3:2-i%3;
    return {id,kind:step.kind,title:step.title||workflowNodeInfo[step.kind].label,instructions:step.instructions||"",position:{x:col*290,y:row*175},review:step.review??["research","script","storyboard","review"].includes(step.kind),...(step.kind==="media"?{provider:step.provider||"manual",media_kind:step.media_kind||"image"}:step.provider?{provider:step.provider}:{})};});
  return {nodes,edges:nodes.slice(1).map((node,i)=>({id:`${nodes[i].id}-${node.id}`,source:nodes[i].id,target:node.id}))};
}
