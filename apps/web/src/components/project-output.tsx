"use client";
import {useState} from "react";
import {Download,FileText,Film,Image as ImageIcon,Mic,PackageOpen} from "lucide-react";
import type {Asset,WorkflowRun,WorkflowTemplate} from "@studio/core";
import {Modal,date} from "./ui";
import {ProjectBar,type ProjectProps} from "./project-studio";
import {projectTasks,taskStatus,taskStatusLabel} from "./project-model";

// Which kind of card produces each asset kind, so a file can name the card it came from.
const stageOf:Record<string,string[]>={vo:["voiceover"],image:["media"],video:["media"],render:["render","review"],thumb:["media"]};
const kindIcon=(kind:string)=>kind==="vo"?Mic:kind==="render"||kind==="video"?Film:ImageIcon;
type TextOutput={node:string;card:string;text:string};

// Output: everything this project produced, grouped by task and labelled with its card.
export function ProjectOutput(props:ProjectProps&{workflow:WorkflowTemplate}){
  const {project,data,workspace}=props;
  const tasks=projectTasks(workspace,project),[filter,setFilter]=useState<"all"|"text"|"media">("all"),[preview,setPreview]=useState<{title:string;text?:string;asset?:Asset}|null>(null);
  const assetsOf=(run:WorkflowRun)=>data.assets.filter(a=>a.episode===run.episode&&!a.deleted);
  const cardOf=(run:WorkflowRun,asset:Asset)=>run.graph.nodes.find(n=>stageOf[asset.kind]?.includes(n.kind)&&(n.kind!=="media"||(n.media_kind||"image")===(asset.kind==="video"?"video":"image")))?.title||asset.kind;
  const textsOf=(run:WorkflowRun):TextOutput[]=>run.graph.nodes.filter(n=>n.kind!=="reference"&&n.kind!=="brief"&&["completed","waiting_review"].includes(run.states[n.id]?.status||"")&&run.states[n.id]?.output&&!(run.states[n.id]?.provided_by_user&&!run.states[n.id]?.document&&n.kind==="research")&&!["voiceover","media","render","review"].includes(n.kind)).map(n=>({node:n.id,card:n.title,text:run.states[n.id]!.output!}));
  const rows=tasks.map(run=>({run,texts:filter==="media"?[]:textsOf(run),assets:filter==="text"?[]:assetsOf(run)})).filter(r=>r.texts.length||r.assets.length);
  const title=(run:WorkflowRun)=>data.episodes.find(e=>e.id===run.episode)?.title||run.template_name;
  return <div className="pj-page">
    <ProjectBar props={props} tab="output"/>
    <div className="po-body">
      <header className="po-head"><div><span className="eyebrow">OUTPUT</span><h1>Hasil project</h1><p>Semua file dan dokumen yang dihasilkan task di project ini. File media juga muncul di halaman Asset.</p></div>
        <div className="pj-tabs" role="tablist" aria-label="Jenis output">{(["all","text","media"] as const).map(f=><button key={f} role="tab" aria-selected={filter===f} onClick={()=>setFilter(f)}>{f==="all"?"Semua":f==="text"?"Dokumen":"Media"}</button>)}</div></header>
      {!rows.length?<div className="po-empty"><PackageOpen size={30} strokeWidth={1.3}/><strong>Belum ada output</strong><p>Hasil tiap kartu muncul di sini begitu sebuah task menyelesaikannya.</p></div>
        :rows.map(({run,texts,assets})=><section key={run.id} className="po-task">
          <header><button className="po-task-title" onClick={()=>props.navigate("workflow",run.id)}><strong>{title(run)}</strong><small>Task · {taskStatusLabel[taskStatus(run)]} · {date(run.updated)}</small></button></header>
          <div className="po-grid">
            {texts.map(t=><button key={t.node} className="po-item is-text" onClick={()=>setPreview({title:t.card+" · "+title(run),text:t.text})}><span className="po-thumb"><FileText size={22}/></span><span className="po-meta"><b>{t.card}</b><small>{t.text.replace(/\s+/g," ").slice(0,110)}</small></span></button>)}
            {assets.map(a=>{const Icon=kindIcon(a.kind);return <button key={a.id} className="po-item" onClick={()=>setPreview({title:cardOf(run,a)+" · "+title(run),asset:a})}><span className="po-thumb">{["image","thumb"].includes(a.kind)?<img src={"/api/assets/"+a.id+"/preview"} alt="" loading="lazy"/>:<Icon size={22}/>}</span><span className="po-meta"><b>{cardOf(run,a)}</b><small>{a.title||a.drive_path.split("/").pop()}</small></span></button>;})}
          </div>
        </section>)}
    </div>
    {preview&&<Modal title={preview.title} wide close={()=>setPreview(null)}>{preview.text!==undefined?<pre className="po-text">{preview.text}</pre>:preview.asset&&<div className="media-player">{["image","thumb"].includes(preview.asset.kind)?<img alt="" src={"/api/assets/"+preview.asset.id+"/preview"}/>:preview.asset.kind==="vo"?<audio controls src={"/api/assets/"+preview.asset.id+"/preview"}/>:<video controls src={"/api/assets/"+preview.asset.id+"/preview"}/>}<a className="button" href={"/api/assets/"+preview.asset.id+"/preview"} download><Download size={13}/>Unduh</a></div>}</Modal>}
  </div>;
}
