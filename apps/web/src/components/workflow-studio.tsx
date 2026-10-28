"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {GitBranch,LoaderCircle,RefreshCw} from "lucide-react";
import type {WorkflowTemplate} from "@studio/core";
import {api,Button,type Dashboard} from "./ui";
import {WorkflowLibrary,type WorkflowLibraryData} from "./workflow-library";
import {WorkflowEditor} from "./workflow-editor";
import {WorkflowRunView,type WorkflowRunData} from "./workflow-run";
import "./workflow-studio.css";
type Props={data:Dashboard;workflowId:string;runId:string;search:string;busy:boolean;operate:(fn:()=>Promise<void>)=>Promise<void>;refresh:()=>Promise<void>;onDirty:(dirty:boolean)=>void;openTemplate:(id:string,channel?:string)=>void;openRun:(id:string,channel?:string)=>void;home:()=>void;openTools:(id:string)=>void;connections:()=>void;models:()=>void};
export function WorkflowStudio({data,workflowId,runId,search,busy,operate,refresh,onDirty,openTemplate,openRun,home,openTools,connections,models}:Props){
  const [library,setLibrary]=useState<WorkflowLibraryData|null>(null),[template,setTemplate]=useState<WorkflowTemplate|null>(null),[production,setProduction]=useState<WorkflowRunData|null>(null),[error,setError]=useState("");
  const key=`${workflowId}:${runId}`,current=useRef(key);current.current=key;
  const load=useCallback(async()=>{const requested=current.current;if(runId){const result=await api<WorkflowRunData>(`workflow-runs/${runId}`);if(current.current===requested&&result.run.id===runId)setProduction(previous=>previous&&previous.run.id===result.run.id&&previous.run.revision>result.run.revision?previous:result);}else if(workflowId){const result=await api<WorkflowTemplate>(`workflows/${encodeURIComponent(workflowId)}`);if(current.current===requested&&result.id===workflowId)setTemplate(result);}else{const result=await api<WorkflowLibraryData>("workflows");if(current.current===requested)setLibrary(result);}},[runId,workflowId]);
  useEffect(()=>{let active=true;setTemplate(null);setProduction(null);setError("");void load().catch(cause=>{if(active)setError((cause as Error).message);});return()=>{active=false;};},[load]);
  useEffect(()=>{if(!runId)return;let active=true;const tick=setInterval(()=>{if(active&&document.visibilityState==="visible"&&!busy)void load().catch(()=>{});},5000);return()=>{active=false;clearInterval(tick);};},[runId,load,busy]);
  function accept(next:WorkflowRunData){if(current.current===`:${next.run.id}`)setProduction(next);}
  async function start(selected:WorkflowTemplate,title:string,brief:string){const result=await api<WorkflowRunData>("workflow-runs",{template:selected.id,title,brief});await refresh();openRun(result.run.id,result.run.channel);}
  if(error)return <div className="wf-load-error"><GitBranch size={30}/><h1>The workflow could not be opened</h1><p>{error}</p><div className="button-row"><Button onClick={()=>void operate(async()=>{setError("");try{await load();}catch(cause){setError((cause as Error).message);}})}><RefreshCw size={14}/>Try again</Button><Button onClick={home}>Workflow library</Button></div></div>;
  if(runId&&production?.run.id===runId)return <WorkflowRunView key={runId} value={production} data={data} busy={busy} operate={operate} accept={accept} reload={load} back={home} openTools={openTools} connections={connections} models={models} onDirty={onDirty}/>;
  if(workflowId&&template?.id===workflowId)return <WorkflowEditor key={workflowId} template={template} data={data} busy={busy} operate={operate} onDirty={onDirty} saved={setTemplate} back={home} start={start} models={models}/>;
  if(!runId&&!workflowId&&library)return <WorkflowLibrary value={library} data={data} search={search} busy={busy} operate={operate} openTemplate={openTemplate} openRun={openRun} created={created=>{setLibrary(previous=>previous?{...previous,templates:[...previous.templates,created]}:null);openTemplate(created.id,created.channel);}}/>;
  return <div className="wf-loading"><LoaderCircle size={20} className="spin"/><span>Opening workflow studio…</span></div>;
}
