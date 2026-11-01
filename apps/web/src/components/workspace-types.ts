import type {AgentReport,ChannelPreferences,ScheduledTask,TemplateProposal,WorkflowRun,WorkflowTemplate} from "@studio/core";
export interface WorkspaceData {templates:WorkflowTemplate[];runs:WorkflowRun[];preferences:ChannelPreferences[];connections:{searxng:boolean;obscura:boolean};reports:AgentReport[];proposals:TemplateProposal[];tasks:ScheduledTask[];}
export type Perform=(action:()=>Promise<void>)=>Promise<void>;
export type WorkspaceView="studio"|"assets"|"foryou"|"settings";
export interface WorkspaceLocation {view:WorkspaceView;channel:string;tab:string;video:string;episode:string;run:string;}
export const initialLocation:WorkspaceLocation={view:"studio",channel:"",tab:"workflow",video:"",episode:"",run:""};
// Studio: no channel = the project list; with a channel the tab is workflow, analytics or assets.
const views:Record<string,WorkspaceView>={studio:"studio",foryou:"foryou",fyp:"foryou",assets:"assets",library:"assets",settings:"settings",connections:"settings",channel:"studio"};
export function readWorkspaceLocation(search:string):WorkspaceLocation{const p=new URLSearchParams(search),view=p.get("view")||"",valid=(v:string|null)=>v&&/^[a-zA-Z0-9]{15}$/.test(v)?v:"";const run=valid(p.get("run"));
  if(run)return {...initialLocation,view:"studio",channel:valid(p.get("channel")||p.get("project")),tab:"workflow",run};
  const resolved=views[view]||"studio";return {view:resolved,channel:valid(p.get("channel")||p.get("project")),tab:p.get("tab")||(resolved==="settings"?"models":"workflow"),video:/^[a-zA-Z0-9_-]{11}$/.test(p.get("video")||"")?p.get("video")!:"",episode:valid(p.get("episode")),run:valid(p.get("run"))};}
export function workspaceUrl(value:WorkspaceLocation){const p=new URLSearchParams({view:value.view});for(const key of ["channel","tab","video","episode","run"] as const)if(value[key])p.set(key,value[key]);return "/?"+p.toString();}
