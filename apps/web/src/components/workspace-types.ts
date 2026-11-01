import type {AgentReport,ChannelPreferences,ScheduledTask,TemplateProposal,WorkflowRun,WorkflowTemplate} from "@studio/core";
export interface WorkspaceData {templates:WorkflowTemplate[];runs:WorkflowRun[];preferences:ChannelPreferences[];connections:{searxng:boolean;obscura:boolean};reports:AgentReport[];proposals:TemplateProposal[];tasks:ScheduledTask[];}
export type Perform=(action:()=>Promise<void>)=>Promise<void>;
export type WorkspaceView="channel"|"studio"|"foryou"|"assets"|"settings";
export interface WorkspaceLocation {view:WorkspaceView;channel:string;tab:string;video:string;episode:string;run:string;}
export const initialLocation:WorkspaceLocation={view:"channel",channel:"",tab:"analytics",video:"",episode:"",run:""};
// Studio: no channel = the project list; with a channel the tab is initiate, workflow or output.
// "fyp" and "connections" are kept as aliases so older links still land somewhere sensible.
const views:Record<string,WorkspaceView>={studio:"studio",foryou:"foryou",fyp:"foryou",assets:"assets",settings:"settings",connections:"settings"};
export function readWorkspaceLocation(search:string):WorkspaceLocation{const p=new URLSearchParams(search),view=p.get("view")||"",valid=(v:string|null)=>v&&/^[a-zA-Z0-9]{15}$/.test(v)?v:"";const run=valid(p.get("run"));
  // Episodes that have a workflow run are produced on the Studio canvas; old episode links land there.
  // A task opens inside its project's workflow.
  if(run)return {...initialLocation,view:"studio",channel:valid(p.get("channel")||p.get("project")),tab:"workflow",run};
  const resolved=views[view]||"channel";return {view:resolved,channel:valid(p.get("channel")||p.get("project")),tab:p.get("tab")||(resolved==="settings"?"services":"analytics"),video:/^[a-zA-Z0-9_-]{11}$/.test(p.get("video")||"")?p.get("video")!:"",episode:valid(p.get("episode")),run:valid(p.get("run"))};}
export function workspaceUrl(value:WorkspaceLocation){const p=new URLSearchParams({view:value.view});for(const key of ["channel","tab","video","episode","run"] as const)if(value[key])p.set(key,value[key]);return "/?"+p.toString();}
