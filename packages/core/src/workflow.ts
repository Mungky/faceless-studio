import { z } from "zod";
export const workflowKinds = ["brief", "research", "script", "storyboard", "voiceover", "media", "render", "review", "upload_pack", "custom", "reference"] as const;
// Reference nodes are inputs, not steps: they are never executed and feed their content to the stages they connect to.
export const referenceTypes = ["link", "video", "image", "markdown", "file"] as const;
export interface WorkflowReference { type:typeof referenceTypes[number]; name:string; url:string; content:string; }
export type WorkflowNodeKind = typeof workflowKinds[number];
export interface WorkflowNode { id:string; kind:WorkflowNodeKind; title:string; instructions:string; position:{x:number;y:number}; review:boolean; provider?:"manual"|"flow"|"webhook"; media_kind?:"image"|"video"; reference?:WorkflowReference; }
export interface WorkflowGraph { nodes:WorkflowNode[]; edges:{id:string;source:string;target:string}[]; viewport?:{x:number;y:number;zoom:number}; }
export interface WorkflowTemplate { id:string;name:string;description:string;channel:string;playbook_path:string;playbook_content?:string;instructions:string;graph:WorkflowGraph;version:string;updated:string;builtin:boolean;
  // Edits made while this project still has open tasks wait here and apply once every task is finished.
  draft?:{graph:WorkflowGraph;instructions:string;saved_at:string}|null;
  history?:{version:string;graph:WorkflowGraph;instructions:string;saved_at:string}[]; }
export type WorkflowNodeStatus = "idle"|"ready"|"running"|"waiting_approval"|"waiting_review"|"completed"|"failed"|"blocked";
export interface WorkflowNodeState { status:WorkflowNodeStatus;quote?:{id:string;operation:string;provider:string;units:number;est_cost:number;currency:string;expires:string;note:string};job_id?:string;document?:"riset.md"|"script.md"|"storyboard.md"|"upload-pack.md";output?:string;error?:string;output_revision?:string;beat?:number;provided_by_user?:boolean; }
export interface WorkflowMessage { id:string;role:"user"|"assistant"|"system";content:string;node_id?:string;created_at:string; }
export interface WorkflowRun {id:string;request_key?:string;template_id:string;template_name:string;template_version?:string;playbook_snapshot?:string;channel:string;episode:string;graph:WorkflowGraph;playbook_path:string;instructions:string;brief:string;status:"idle"|"running"|"waiting"|"completed"|"failed";states:Record<string,WorkflowNodeState>;messages:WorkflowMessage[];revision:number;created:string;updated:string;closed?:boolean;archived?:boolean;n8n?:{workflow_id:string;execution_id?:string};}
export const workflowNodeInfo:Record<WorkflowNodeKind,{label:string;description:string}> = {
  brief:{label:"Brief",description:"Set the direction for this production."},
  research:{label:"Research",description:"Collect source-aware leads and verify evidence before writing."},
  script:{label:"Script",description:"Write the complete narration for human approval."},
  storyboard:{label:"Visual plan",description:"Plan every beat from the complete approved script."},
  voiceover:{label:"Voiceover",description:"Record or generate narration after script approval."},
  media:{label:"Media",description:"Import or generate assets for each approved visual beat."},
  render:{label:"Render",description:"Queue the existing renderer using selected production assets."},
  review:{label:"Final review",description:"Inspect the actual render before preparing delivery."},
  upload_pack:{label:"Upload pack",description:"Prepare metadata for manual publication."},
  custom:{label:"Custom step",description:"Run your own instruction with the AI model and keep its Markdown result."},
  reference:{label:"Reference",description:"An image, video, link or note the connected stages must follow."}
};
export function defaultWorkflowGraph():WorkflowGraph {
  const kinds:WorkflowNodeKind[]=["brief","research","script","storyboard","voiceover","media","render","review","upload_pack"];
  return {nodes:kinds.map((kind,i)=>({id:kind,kind,title:workflowNodeInfo[kind].label,instructions:"",position:{x:(Math.floor(i/3)%2===0?i%3:2-i%3)*290,y:Math.floor(i/3)*175},review:["research","script","storyboard","review"].includes(kind),...(kind==="media"?{provider:"manual" as const,media_kind:"image" as const}:{})})),edges:kinds.slice(1).map((kind,i)=>({id:`${kinds[i]}-${kind}`,source:kinds[i],target:kind}))};
}
const key=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/).refine(v=>!["__proto__","prototype","constructor"].includes(v),"Reserved graph identifier");
const coordinate=z.number().finite().min(-100_000).max(100_000);
const referenceSchema=z.object({type:z.enum(referenceTypes),name:z.string().max(200),url:z.string().max(2000),content:z.string().max(50_000)}).strict();
const graphSchema=z.object({nodes:z.array(z.object({id:key,kind:z.enum(workflowKinds),title:z.string().trim().min(1).max(120),instructions:z.string().max(20_000),position:z.object({x:coordinate,y:coordinate}),review:z.boolean(),provider:z.enum(["manual","flow","webhook"]).optional(),media_kind:z.enum(["image","video"]).optional(),reference:referenceSchema.optional()}).strict()).min(2).max(60),edges:z.array(z.object({id:key,source:key,target:key}).strict()).min(1).max(100),viewport:z.object({x:coordinate,y:coordinate,zoom:z.number().finite().min(0.05).max(4)}).optional()}).strict();
export function validateWorkflowGraph(value:unknown):WorkflowGraph {
  const graph=graphSchema.parse(value); const ids=new Set(graph.nodes.map(n=>n.id));
  if(ids.size!==graph.nodes.length) throw new Error("Node identifiers must be unique");
  const briefs=graph.nodes.filter(n=>n.kind==="brief"); if(briefs.length!==1) throw new Error("Exactly one brief root is required");
  // Multi-stage pipelines (e.g. Riset YouTube + Riset Instagram) are supported with unique node identifiers.
  const incoming=new Map(graph.nodes.map(n=>[n.id,0])); const outgoing=new Map(graph.nodes.map(n=>[n.id,[] as string[]]));
  const edgeIds=new Set<string>(),pairs=new Set<string>();
  for(const edge of graph.edges) {
    const pair=`${edge.source}:${edge.target}`;
    if(edgeIds.has(edge.id)||pairs.has(pair)||edge.source===edge.target||!ids.has(edge.source)||!ids.has(edge.target)) throw new Error("Edges must be unique and connect distinct existing nodes");
    edgeIds.add(edge.id);pairs.add(pair);incoming.set(edge.target,incoming.get(edge.target)!+1);outgoing.get(edge.source)!.push(edge.target);
  }
  const references=graph.nodes.filter(n=>n.kind==="reference");
  if(references.some(n=>incoming.get(n.id)))throw new Error("A reference is an input. Connect it into a stage, not from one.");
  if(references.some(n=>!outgoing.get(n.id)!.length))throw new Error("Connect every reference to the stage that should use it.");
  const roots=graph.nodes.filter(n=>n.kind!=="reference"&&incoming.get(n.id)===0);
  if(roots.length!==1||roots[0].id!==briefs[0].id) throw new Error("The brief must be the only graph root; connect every node");
  if(!graph.nodes.some(n=>!outgoing.get(n.id)!.length)) throw new Error("The graph needs a final leaf");
  const queue=[briefs[0].id,...references.map(n=>n.id)];let visited=0;
  while(queue.length){const id=queue.shift()!;visited++;for(const target of outgoing.get(id)!){incoming.set(target,incoming.get(target)!-1);if(!incoming.get(target))queue.push(target);}}
  if(visited!==graph.nodes.length) throw new Error("Workflow must be a reachable acyclic graph");
  return graph;
}
export function readyWorkflowNodes(graph:WorkflowGraph,states:Record<string,WorkflowNodeState>):WorkflowNode[] {
  return graph.nodes.filter(node=>node.kind!=="reference"&&(!states[node.id]||["idle","ready","blocked","failed"].includes(states[node.id].status))&&graph.edges.filter(e=>e.target===node.id).every(e=>states[e.source]?.status==="completed"||graph.nodes.find(n=>n.id===e.source)?.kind==="reference"));
}


