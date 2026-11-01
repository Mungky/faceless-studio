"use client";
import type {ReactNode} from "react";
import {ArrowLeft} from "lucide-react";
import type {Dashboard} from "./ui";
import {projectName,projectPrefs,projectWorkflow} from "./project-model";
import {ProjectInitiate} from "./project-initiate";
import {ProjectWorkflow} from "./project-workflow";
import {ProjectOutput} from "./project-output";
import type {Perform,WorkspaceData} from "./workspace-types";
import "./project-studio.css";

export type ProjectProps={project:string;data:Dashboard;workspace:WorkspaceData;busy:boolean;perform:Perform;refresh:()=>Promise<void>;navigate:(tab:string,run?:string)=>void;back:()=>void};

// Inside a project: Initiate once (until it has a workflow), then the Workflow canvas and its Output.
export function ProjectStudio(props:ProjectProps&{tab:string;run:string}){
  const {project,workspace,tab,run}=props;
  const workflow=projectWorkflow(workspace,project);
  if(!workflow)return <ProjectInitiate {...props}/>;
  if(tab==="output")return <ProjectOutput {...props} workflow={workflow}/>;
  return <ProjectWorkflow key={workflow.id} {...props} workflow={workflow} run={run}/>;
}

// Back to the project list, the project's name and the Workflow / Output switch.
export function ProjectBar({props,tab,children}:{props:ProjectProps;tab:"workflow"|"output";children?:ReactNode}){
  const channel=props.data.channels.find(c=>c.id===props.project)!,name=projectName(channel,projectPrefs(props.workspace,props.project));
  return <div className="pj-bar">
    <button className="icon-button" aria-label="Kembali ke daftar project" title="Kembali ke project" onClick={props.back}><ArrowLeft size={16}/></button>
    <div className="pj-bar-title"><small>Project</small><strong title={name}>{name}</strong></div>
    <div className="pj-tabs" role="tablist" aria-label="Halaman project"><button role="tab" aria-selected={tab==="workflow"} onClick={()=>props.navigate("workflow")}>Workflow</button><button role="tab" aria-selected={tab==="output"} onClick={()=>props.navigate("output")}>Output</button></div>
    {children}
  </div>;
}
