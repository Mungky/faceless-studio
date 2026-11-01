"use client";
import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {Check,FileText,GitBranch,LoaderCircle,Pencil,Play,RefreshCw,RotateCcw,Save,Sparkles,Square,Trash2,X} from "lucide-react";
import {workflowNodeInfo,type WorkflowNode,type WorkflowRun} from "@studio/core";
import {api,Button,Status,money,type Detail,type DocName} from "./ui";
import {WorkflowCanvas} from "./workflow-canvas";
import {Markdown} from "./markdown";
import type {Perform} from "./workspace-types";

type Production={run:WorkflowRun;detail:Detail;advancing?:boolean;thinking?:boolean};
const docOf:Partial<Record<WorkflowNode["kind"],DocName>>={research:"riset.md",script:"script.md",storyboard:"storyboard.md",upload_pack:"upload-pack.md"};
const statusText:Record<string,string>={idle:"Belum mulai",ready:"Siap dijalankan",running:"Sedang berjalan",waiting_approval:"Menunggu persetujuan biaya",waiting_review:"Menunggu review-mu",completed:"Selesai",failed:"Gagal",blocked:"Terhenti"};
const attention=(run:WorkflowRun)=>run.graph.nodes.find(n=>["waiting_review","waiting_approval","blocked","failed"].includes(run.states[n.id]?.status||""));

export type ProductionState={value:Production|null;error:string;update:(next:Production)=>Promise<void>;advance:(node?:string)=>Promise<void>;send:(content:string)=>Promise<void>;stop:()=>Promise<void>};
// Anything still moving on a task: the background loop, the agent, or a stage marked running.
export const isLive=(value:Production|null)=>!!value&&(!!value.advancing||!!value.thinking||Object.values(value.run.states).some(s=>s.status==="running"));
// One task's production, shared by its canvas and its card panel. Polls while work runs or while
// the task is advancing on its own in the background.
export function useProduction(runId:string,refresh:()=>Promise<void>):ProductionState{
  const [value,setValue]=useState<Production|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{const next=await api<Production>("workflow-runs/"+runId);setValue(next);return next;},[runId]);
  useEffect(()=>{setValue(null);setError("");if(runId)void load().catch(e=>setError((e as Error).message));},[load,runId]);
  const live=isLive(value);
  useEffect(()=>{if(!live)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")void load().then(()=>refresh()).catch(()=>undefined);},2500);return ()=>clearInterval(timer);},[live,load,refresh]);
  const update=useCallback(async(next:Production)=>{setValue(next);await refresh();},[refresh]);
  const advance=useCallback(async(node?:string)=>{setValue(await api<Production>("workflow-runs/"+runId+"/advance",node?{node_id:node}:{}));},[runId]);
  const send=useCallback(async(content:string)=>{setValue(await api<Production>("workflow-runs/"+runId+"/chat",{content}));},[runId]);
  const stop=useCallback(async()=>{setValue(await api<Production>("workflow-runs/"+runId+"/stop",{}));},[runId]);
  return {value,error,update,advance,send,stop};
}
export const needsYou=(run:WorkflowRun)=>run.graph.nodes.filter(n=>["waiting_review","waiting_approval"].includes(run.states[n.id]?.status||""));

// The task view: its graph on the canvas. Double-click a card for its result, progress and
// approvals; when the task stops on its own, the card that needs you opens by itself.
export function RunStudio({production,open,setOpen,busy,perform,back,settings,warnings}:{production:ProductionState;open:string;setOpen:(id:string)=>void;busy:boolean;perform:Perform;back:()=>void;settings?:(node:WorkflowNode)=>ReactNode;warnings?:Record<string,string>}){
  // The task chat reports when the task stops; the card that needs the owner is only highlighted.
  const [selected,setSelected]=useState(""),{value,error,update,advance,stop}=production,was=useRef(false);
  useEffect(()=>{if(!value)return;if(was.current&&!value.advancing){const next=attention(value.run);if(next)setSelected(next.id);}was.current=!!value.advancing;},[value]);
  if(error)return <p className="danger-text studio-pane-loading">{error}</p>;
  if(!value)return <p className="muted studio-pane-loading"><LoaderCircle className="spin" size={15}/> Membuka task…</p>;
  const {run}=value,node=run.graph.nodes.find(n=>n.id===open);
  const pending=needsYou(run).length,ready=run.graph.nodes.some(n=>run.states[n.id]?.status==="ready");
  return <div className="studio-run">
    <header className="studio-run-head"><button className="icon-button" aria-label="Kembali ke workflow" title="Kembali ke workflow" onClick={back}><GitBranch size={15}/></button><div><span className="eyebrow">TASK</span><h2>{value.detail.episode.title}</h2></div>
      {value.advancing?<span className="run-pending is-live"><LoaderCircle size={12} className="spin"/>Berjalan otomatis…</span>:pending>0?<span className="run-pending"><i/>{pending} perlu persetujuan</span>:<Status value={run.status}/>}
      {isLive(value)&&<Button className="danger" busy={busy} onClick={()=>void perform(stop)}><Square size={12}/>Stop</Button>}
      {!value.advancing&&ready&&!pending&&<Button className="primary" busy={busy} onClick={()=>void perform(()=>advance())}><Play size={13}/>Lanjutkan</Button>}
      <button className="icon-button" aria-label="Sinkronkan" title="Sinkronkan hasil" disabled={busy} onClick={()=>void perform(async()=>{await update(await api<Production>("workflow-runs/"+run.id+"/actions",{action:"sync",expected_revision:run.revision}));})}><RefreshCw size={15}/></button>
      <button className="icon-button sp-delete" aria-label="Hapus task" title="Hapus task" disabled={busy} onClick={()=>void perform(async()=>{if(!window.confirm(`Hapus task "${value.detail.episode.title}" secara permanen? Data task tidak bisa dikembalikan.`))return;await api("workflow-runs/"+run.id+"/delete",{});back();})}><Trash2 size={14}/></button></header>
    <WorkflowCanvas graph={{...run.graph,viewport:undefined}} states={run.states} warnings={warnings} readOnly selected={selected} onSelect={setSelected} onChange={()=>undefined} onOpen={id=>{setSelected(id);setOpen(id);}}/>
    {node&&<NodePanel key={node.id+run.revision} node={node} value={value} busy={busy} perform={perform} close={()=>setOpen("")} update={update} advance={advance} settings={settings?.(node)} warning={warnings?.[node.id]}/>}
  </div>;
}

function NodePanel({node,value,busy,perform,close,update,advance,settings,warning}:{node:WorkflowNode;value:Production;busy:boolean;perform:Perform;close:()=>void;update:(next:Production)=>Promise<void>;advance:(node?:string)=>Promise<void>;settings?:ReactNode;warning?:string}){
  const {run,detail}=value,state=run.states[node.id]||{status:"idle" as const},doc=docOf[node.kind]||state.document;
  const original=(doc&&detail.documents[doc])||state.output||"",[text,setText]=useState(original),[editing,setEditing]=useState(false),[tab,setTab]=useState<"progress"|"settings">("progress");
  const changed=text!==original,job=state.job_id?detail.jobs.find(j=>j.id===state.job_id):undefined;
  const act=(action:string,extra:Record<string,unknown>={})=>perform(async()=>update(await api<Production>("workflow-runs/"+run.id+"/actions",{action,node_id:node.id,expected_revision:run.revision,...extra})));
  // Approving moves the task on by itself until the next decision.
  const approve=(action:"approve"|"review",extra:Record<string,unknown>)=>perform(async()=>{await update(await api<Production>("workflow-runs/"+run.id+"/actions",{action,node_id:node.id,expected_revision:run.revision,...extra}));await advance();});
  const save=()=>perform(async()=>{if(!doc)return;await api("episodes/"+detail.episode.id+"/documents",{name:doc,content:text,revision:detail.revisions[doc]},"PUT");await update(await api<Production>("workflow-runs/"+run.id+"/actions",{action:"sync",node_id:node.id,expected_revision:run.revision}));setEditing(false);});
  const runnable=["idle","ready","failed","blocked"].includes(state.status)&&node.kind!=="reference";
  return <aside className={"node-panel is-"+state.status} aria-label={node.title}>
    <header><span className="node-panel-icon"><FileText size={16}/></span><div><h3>{node.title}</h3><span>{workflowNodeInfo[node.kind].label}</span></div><button className="icon-button" aria-label="Tutup" onClick={close}><X size={16}/></button></header>
    {settings&&<div className="pj-tabs node-panel-tabs" role="tablist"><button role="tab" aria-selected={tab==="progress"} onClick={()=>setTab("progress")}>Progres</button><button role="tab" aria-selected={tab==="settings"} onClick={()=>setTab("settings")}>Pengaturan</button></div>}
    {tab==="settings"&&settings?<div className="wf-inspector-content node-panel-settings">{settings}</div>:<>
    <div className={"node-panel-status is-"+state.status}>{state.status==="running"||value.advancing&&state.status==="ready"?<LoaderCircle className="spin" size={15}/>:state.status==="completed"?<Check size={15}/>:<i/>}<strong>{statusText[state.status]}</strong>{state.error&&<p className="danger-text">{state.error}</p>}</div>
    {warning&&state.status!=="completed"&&<p className="node-panel-warning">{warning}</p>}
    {job&&<div className="node-panel-job"><span>Job {job.type} · {job.status} · {job.progress||0}%</span><i style={{"--p":(job.progress||0)+"%"} as React.CSSProperties}/>{job.log&&<pre>{job.log.split("\n").slice(-6).join("\n")}</pre>}</div>}
    {state.status==="waiting_approval"&&state.quote&&<div className="node-panel-approval"><div><strong>Persetujuan biaya</strong><span>{state.quote.provider} · {state.quote.currency==="USD"?money(state.quote.est_cost):state.quote.units+" kredit"}</span><small>{state.quote.note}</small></div><Button className="primary" busy={busy} onClick={()=>void approve("approve",{quote_id:state.quote!.id})}><Sparkles size={14}/>Setujui & lanjut</Button></div>}
    {state.status==="waiting_review"&&<div className="node-panel-approval"><div><strong>Perlu review-mu</strong><span>Baca hasilnya. Edit jika perlu, lalu setujui; task lanjut sendiri.</span></div><Button className="primary" busy={busy} disabled={changed} onClick={()=>void approve("review",{document_revision:state.output_revision})}><Check size={14}/>Setujui & lanjut</Button></div>}
    {(doc||original)&&<div className="node-panel-doc"><div className="node-panel-doc-head"><span>{doc||"Hasil"}</span><span className="muted">{text.length.toLocaleString("id-ID")} karakter</span>{doc&&(editing?<Button busy={busy} disabled={!changed} onClick={()=>void save()}><Save size={13}/>Simpan</Button>:<Button disabled={busy} onClick={()=>setEditing(true)}><Pencil size={13}/>Edit</Button>)}</div>
      {editing?<textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Belum ada isi." aria-label={"Isi "+node.title}/>:original.trim()?<Markdown text={original} className="node-panel-md"/>:<p className="muted">Belum ada isi. Jalankan tahap ini untuk membuatnya.</p>}</div>}
    <div className="node-panel-actions">{runnable&&<Button className="primary" busy={busy||!!value.advancing} onClick={()=>void perform(()=>advance(node.id))}><Play size={14}/>{state.status==="idle"||state.status==="ready"?"Jalankan":"Coba lagi"}</Button>}{state.status!=="idle"&&state.status!=="running"&&node.kind!=="reference"&&<Button disabled={busy} onClick={()=>void act("revise")}><RotateCcw size={13}/>Ulangi tahap</Button>}{state.status==="running"&&<span className="muted">Berjalan… hasil diperiksa otomatis.</span>}</div>
    <details className="node-panel-instructions"><summary>Instruksi langkah</summary><p>{node.instructions||workflowNodeInfo[node.kind].description}</p></details>
    </>}
  </aside>;
}
