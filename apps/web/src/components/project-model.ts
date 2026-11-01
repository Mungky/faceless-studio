import {defaultChannelPreferences,type Channel,type ChannelPreferences,type WorkflowGraph,type WorkflowRun,type WorkflowTemplate} from "@studio/core";
import {workerOnline,type Dashboard} from "./ui";
import type {WorkspaceData} from "./workspace-types";

// A Studio project is a channel record: its Routine and display name live in its preferences,
// its one workflow is the template it points at (or the template it owns), and its tasks are runs.
export function projectPrefs(workspace:WorkspaceData,project:string):ChannelPreferences{return workspace.preferences.find(p=>p.channel===project)||defaultChannelPreferences(project);}
export function projectName(channel:Channel,prefs:ChannelPreferences){return prefs.project_name||channel.name;}
export function projectWorkflow(workspace:WorkspaceData,project:string):WorkflowTemplate|undefined{
  const prefs=projectPrefs(workspace,project);
  // Older projects never chose one: their built-in template, or the template their tasks already use.
  // A template merely saved under this project (from Initiate) is not its workflow until chosen.
  return workspace.templates.find(t=>t.id===prefs.default_template_id)||workspace.templates.find(t=>t.channel===project&&(t.builtin||workspace.runs.some(r=>r.template_id===t.id)));
}
export function projectTasks(workspace:WorkspaceData,project:string){return workspace.runs.filter(r=>r.channel===project).sort((a,b)=>b.updated.localeCompare(a.updated));}

export type TaskStatus="running"|"approval"|"error"|"done"|"idle";
export const taskStatusLabel:Record<TaskStatus,string>={running:"Berjalan",approval:"Butuh approval",error:"Error",done:"Selesai",idle:"Siap"};
export function taskStatus(run:WorkflowRun):TaskStatus{
  const states=run.graph.nodes.filter(n=>n.kind!=="reference").map(n=>run.states[n.id]?.status||"idle");
  if(run.closed||run.status==="completed")return "done";
  if(states.includes("running"))return "running";
  if(states.some(s=>s==="failed"||s==="blocked")||run.status==="failed")return "error";
  if(states.some(s=>s==="waiting_review"||s==="waiting_approval"))return "approval";
  return "idle";
}
export function taskCounts(runs:WorkflowRun[]){
  const counts:Record<TaskStatus,number>={running:0,approval:0,error:0,done:0,idle:0};
  for(const run of runs)if(!run.archived)counts[taskStatus(run)]++;
  return counts;
}
// The stage a task is on right now, for one-line summaries.
export function taskStage(run:WorkflowRun){
  const order=["running","waiting_approval","waiting_review","failed","blocked","ready"];
  for(const status of order){const node=run.graph.nodes.find(n=>run.states[n.id]?.status===status);if(node)return node.title;}
  return run.status==="completed"?"Semua tahap selesai":"Belum mulai";
}

// Cards that cannot run yet in this workspace, and why, so the canvas says so before anyone tries.
export function nodeWarnings(graph:WorkflowGraph,data:Dashboard):Record<string,string>{
  const route=(task:string)=>data.routes.some(r=>r.task===task),worker=data.workers.some(workerOnline),{configuration:c}=data,out:Record<string,string>={};
  for(const node of graph.nodes){
    const missing:string[]=[];
    if(["research","script","storyboard","upload_pack","custom"].includes(node.kind)){const task=node.kind==="custom"?"script":node.kind;if(!route(task))missing.push("pilih model "+task+" di Pengaturan → Model AI");}
    if(node.kind==="voiceover"&&node.provider!=="manual"){if(!c.elevenlabs)missing.push("hubungkan ElevenLabs");if(!c.drive)missing.push("atur penyimpanan Drive");}
    if(node.kind==="media"&&node.provider==="webhook"&&!c.webhook)missing.push("atur generator webhook");
    if(node.kind==="media"&&node.provider==="flow"&&!worker)missing.push("nyalakan PC render untuk Google Flow");
    if(node.kind==="render"){if(!worker)missing.push("nyalakan PC render (npm run worker)");if(!c.drive)missing.push("atur penyimpanan Drive");}
    if(missing.length)out[node.id]="Belum siap: "+missing.join(", ")+".";
  }
  return out;
}
