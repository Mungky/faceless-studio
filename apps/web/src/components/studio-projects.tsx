"use client";
import {useState} from "react";
import {AlertTriangle,Archive,ArchiveRestore,Check,Clock,FolderPlus,LoaderCircle,Pencil,Repeat,X} from "lucide-react";
import type {Channel,ChannelPreferences} from "@studio/core";
import {api,Button,Modal,date,type Dashboard} from "./ui";
import {ChannelAvatar} from "./projects";
import {projectName,projectPrefs,projectTasks,projectWorkflow,taskCounts} from "./project-model";
import type {Perform,WorkspaceData} from "./workspace-types";
import "./project-studio.css";

// Studio's first screen: one card per project (a niche), with its Routine and what needs the owner.
export function StudioProjects({data,workspace,busy,perform,refresh,open}:{data:Dashboard;workspace:WorkspaceData;busy:boolean;perform:Perform;refresh:()=>Promise<void>;open:(id:string)=>void}){
  const [adding,setAdding]=useState(false),[error,setError]=useState(""),[showArchived,setShowArchived]=useState(false);
  const archivedCount=data.channels.filter(c=>projectPrefs(workspace,c.id).archived).length;
  const projects=data.channels.filter(c=>!!projectPrefs(workspace,c.id).archived===showArchived).sort((a,b)=>(projectTasks(workspace,b.id)[0]?.updated||"").localeCompare(projectTasks(workspace,a.id)[0]?.updated||""));
  return <div className="sp-page">
    <header className="sp-head"><div><span className="eyebrow">STUDIO</span><h1>Project</h1><p>Satu project untuk satu niche. Di dalamnya ada workflow, task, dan hasil produksi.</p></div><div className="button-row">{(archivedCount>0||showArchived)&&<Button aria-pressed={showArchived} onClick={()=>setShowArchived(v=>!v)}><Archive size={14}/>{showArchived?"Kembali ke project aktif":"Arsip ("+archivedCount+")"}</Button>}<Button className="primary" onClick={()=>{setError("");setAdding(true);}}><FolderPlus size={15}/>Project baru</Button></div></header>
    {showArchived&&<p className="sp-archive-note">Project yang diarsipkan tidak tampil di daftar dan Routine-nya berhenti. Workflow, task, chat, dan semua hasilnya tetap tersimpan.</p>}
    <div className="sp-grid">
      {projects.map(channel=><ProjectCard key={channel.id} channel={channel} workspace={workspace} busy={busy} perform={perform} refresh={refresh} open={()=>open(channel.id)}/>)}
      {!showArchived&&<button type="button" className="sp-card sp-card-add" onClick={()=>{setError("");setAdding(true);}}><FolderPlus size={28} strokeWidth={1.4}/><strong>Project baru</strong><span>Mulai dari template atau minta agent menyusun workflow.</span></button>}
      {showArchived&&!projects.length&&<p className="muted">Belum ada project yang diarsipkan.</p>}
    </div>
    {adding&&<Modal title="Project baru" close={()=>{if(!busy)setAdding(false);}}><form className="stack-form" onSubmit={e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get("name")||"");void perform(async()=>{setError("");try{const created=await api<Channel>("channels",{name});await refresh();setAdding(false);open(created.id);}catch(cause){setError((cause as Error).message);}});}}>
      <label>Nama project<input name="name" autoFocus required maxLength={80} placeholder="Mis. Sejarah Singkat" disabled={busy}/></label>
      <p className="muted">Nama ini juga dipakai sebagai folder di vault. Nama tampilan bisa diubah kapan saja.</p>
      {error&&<p className="danger-text" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" disabled={busy} onClick={()=>setAdding(false)}>Batal</Button><Button type="submit" className="primary" busy={busy}>Buat project</Button></div>
    </form></Modal>}
  </div>;
}

function ProjectCard({channel,workspace,busy,perform,refresh,open}:{channel:Channel;workspace:WorkspaceData;busy:boolean;perform:Perform;refresh:()=>Promise<void>;open:()=>void}){
  const prefs=projectPrefs(workspace,channel.id),name=projectName(channel,prefs),tasks=projectTasks(workspace,channel.id),counts=taskCounts(tasks),workflow=projectWorkflow(workspace,channel.id);
  const [editing,setEditing]=useState(false),[value,setValue]=useState(name);
  const rename=()=>void perform(async()=>{const next=value.trim();if(next&&next!==name)await api<ChannelPreferences>("workspace/channels/"+channel.id,{...prefs,project_name:next===channel.name?"":next},"PUT");setEditing(false);await refresh();});
  const routine=prefs.research_enabled&&!prefs.archived;
  const archive=()=>void perform(async()=>{if(!prefs.archived&&!window.confirm("Arsipkan project "+name+"? Routine-nya berhenti, semua hasil tetap tersimpan."))return;await api<ChannelPreferences>("workspace/channels/"+channel.id,{...prefs,archived:!prefs.archived},"PUT");await refresh();});
  return <article className="sp-card">
    <button type="button" className="sp-card-open" onClick={open} aria-label={"Buka project "+name}/>
    <div className="sp-card-top"><ChannelAvatar channel={channel}/>{routine?<span className="sp-routine is-on" title={"Routine "+(prefs.routine_mode==="auto"?"Auto":"Approval")+" · "+prefs.slots.join(", ")}><Repeat size={12}/><i/>Routine · {prefs.routine_mode==="auto"?"Auto":"Approval"}</span>:<span className="sp-routine"><Repeat size={12}/>Routine mati</span>}</div>
    {editing?<form className="sp-rename" onSubmit={e=>{e.preventDefault();rename();}}><input autoFocus value={value} maxLength={80} onChange={e=>setValue(e.target.value)} aria-label="Nama project" onKeyDown={e=>{if(e.key==="Escape"){setEditing(false);setValue(name);}}}/><button className="icon-button" aria-label="Simpan nama" disabled={busy}><Check size={14}/></button><button type="button" className="icon-button" aria-label="Batal" onClick={()=>{setEditing(false);setValue(name);}}><X size={14}/></button></form>
      :<div className="sp-name"><h2>{name}</h2><button type="button" className="icon-button" aria-label="Ubah nama project" title="Ubah nama" onClick={()=>{setValue(name);setEditing(true);}}><Pencil size={13}/></button><button type="button" className="icon-button sp-archive" disabled={busy} aria-label={prefs.archived?"Pulihkan project":"Arsipkan project"} title={prefs.archived?"Pulihkan dari arsip":"Arsipkan project"} onClick={archive}>{prefs.archived?<ArchiveRestore size={13}/>:<Archive size={13}/>}</button></div>}
    <p className="sp-sub">{workflow?(workflow.draft?"Workflow · draft menunggu task selesai":"Workflow · "+workflow.graph.nodes.filter(n=>n.kind!=="reference").length+" tahap"):"Belum ada workflow · mulai di Initiate"}</p>
    <div className="sp-counts">
      {counts.running>0&&<span className="sp-count is-running"><LoaderCircle size={12} className="spin"/>{counts.running} berjalan</span>}
      {counts.approval>0&&<span className="sp-count is-approval"><i/>{counts.approval} butuh approval</span>}
      {counts.error>0&&<span className="sp-count is-error"><AlertTriangle size={12}/>{counts.error} error</span>}
      {!counts.running&&!counts.approval&&!counts.error&&<span className="sp-count">{tasks.length?tasks.length+" task":"Belum ada task"}</span>}
    </div>
    <footer className="sp-foot"><Clock size={12}/>{tasks[0]?"Aktivitas "+date(tasks[0].updated):"Belum ada aktivitas"}</footer>
  </article>;
}
