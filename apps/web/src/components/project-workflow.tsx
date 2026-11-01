"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {AlertTriangle,Archive,ArchiveRestore,Check,ChevronDown,ChevronRight,CloudOff,Cpu,FileText,History,Info,ListChecks,LoaderCircle,Lock,Play,Repeat,RotateCcw,Settings2,Sparkles,Upload,X} from "lucide-react";
import {referenceTypes,validateWorkflowGraph,workflowNodeInfo,type ChannelPreferences,type WorkflowGraph,type WorkflowNode,type WorkflowRun,type WorkflowTemplate} from "@studio/core";
import {api,ApiError,Button,Modal,date} from "./ui";
import {WorkflowCanvas} from "./workflow-canvas";
import {RunStudio,useProduction} from "./run-studio";
import {ProjectBar,type ProjectProps} from "./project-studio";
import {ProjectChat} from "./project-chat";
import {TaskChat} from "./task-chat";
import {isChannelLink} from "./project-initiate";
import {nodeWarnings,projectPrefs,projectTasks,taskCounts,taskStage,taskStatus,taskStatusLabel} from "./project-model";
import "./workflow-studio.css";

type Doc={graph:WorkflowGraph;instructions:string;name:string;description:string};
// What the canvas edits: a waiting draft when there is one, otherwise the active workflow.
const editable=(t:WorkflowTemplate):Doc=>({graph:{...(t.draft?.graph||t.graph),viewport:undefined},instructions:t.draft?.instructions??t.instructions,name:t.name,description:t.description});
const same=(a:Doc,b:Doc)=>JSON.stringify(a)===JSON.stringify(b);
const refLabel:Record<string,string>={link:"Link",video:"Video",image:"Gambar",markdown:"Markdown",file:"File teks"};

// Workflow: the project's one canvas, shared by all of its tasks. Edits save themselves; while
// tasks are open they wait as a draft. Selecting a task paints its progress onto the canvas.
export function ProjectWorkflow(props:ProjectProps&{workflow:WorkflowTemplate;run:string}){
  const {project,data,workspace,busy,perform,refresh,navigate,workflow,run}=props;
  const [template,setTemplate]=useState(workflow),[doc,setDoc]=useState(()=>editable(workflow)),[save,setSave]=useState<{kind:"saved"|"saving"|"invalid"|"error";message?:string}>({kind:"saved"});
  const [selected,setSelected]=useState(""),[settings,setSettings]=useState(false),[chatOpen,setChatOpen]=useState(true),[dockOpen,setDockOpen]=useState(!!run),[newTask,setNewTask]=useState(false),[routine,setRoutine]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[nodeOpen,setNodeOpen]=useState("");
  const savedRef=useRef(editable(workflow)),templateRef=useRef(workflow),docRef=useRef(doc),queue=useRef<Promise<void>>(Promise.resolve());
  templateRef.current=template;docRef.current=doc;
  const tasks=projectTasks(workspace,project),open=tasks.filter(t=>!t.closed&&t.status!=="completed").length,prefs=projectPrefs(workspace,project);
  const production=useProduction(run,refresh);
  const taskTitle=useCallback((r:WorkflowRun)=>data.episodes.find(e=>e.id===r.episode)?.title||r.template_name,[data.episodes]);

  // Changes made elsewhere (the agent, another tab) replace the canvas only when it has nothing unsaved.
  useEffect(()=>{if(workflow.version===templateRef.current.version)return;const clean=same(docRef.current,savedRef.current);setTemplate(workflow);templateRef.current=workflow;if(clean){const next=editable(workflow);setDoc(next);savedRef.current=next;}},[workflow]);
  const persist=useCallback(async(next:Doc,applyNow=false)=>{
    try{validateWorkflowGraph(next.graph);}catch(error){setSave({kind:"invalid",message:(error as Error).message});return;}
    if(!applyNow&&same(next,savedRef.current)){setSave({kind:"saved"});return;}
    setSave({kind:"saving"});const current=templateRef.current;
    try{
      const result=await api<WorkflowTemplate>("workflows/"+encodeURIComponent(current.id),{name:next.name,description:next.description,channel:current.channel,playbook_path:current.playbook_path,instructions:next.instructions,graph:next.graph,expected_version:current.version,...(applyNow?{apply_now:true}:{})},"PUT");
      templateRef.current=result;setTemplate(result);savedRef.current=next;setSave({kind:"saved"});void refresh().catch(()=>undefined);
    }catch(error){
      if(error instanceof ApiError&&error.status===409){const fresh=await api<WorkflowTemplate>("workflows/"+encodeURIComponent(current.id));templateRef.current=fresh;setTemplate(fresh);const reset=editable(fresh);savedRef.current=reset;setDoc(reset);setSave({kind:"error",message:"Workflow berubah di tempat lain. Versi terbaru dimuat."});}
      else setSave({kind:"error",message:(error as Error).message});
    }
  },[refresh]);
  const enqueue=useCallback((applyNow=false)=>{queue.current=queue.current.then(()=>persist(docRef.current,applyNow));return queue.current;},[persist]);
  useEffect(()=>{if(same(doc,savedRef.current))return;setSave(s=>s.kind==="saving"?s:{kind:"saving"});const timer=setTimeout(()=>void enqueue(),900);return ()=>clearTimeout(timer);},[doc,enqueue]);
  useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(!same(docRef.current,savedRef.current)){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",leave);return ()=>window.removeEventListener("beforeunload",leave);},[]);
  // An opened card needs the room the expanded task list takes.
  useEffect(()=>{if(nodeOpen)setDockOpen(false);},[nodeOpen]);
  // Keep the task list honest while something runs.
  const live=tasks.some(t=>taskStatus(t)==="running")||data.jobs.some(j=>["queued","running"].includes(j.status));
  useEffect(()=>{if(!live)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh().catch(()=>undefined);},8000);return ()=>clearInterval(timer);},[live,refresh]);

  const node=doc.graph.nodes.find(n=>n.id===selected);
  const updateNodeById=(id:string,values:Partial<WorkflowNode>)=>setDoc(d=>({...d,graph:{...d.graph,nodes:d.graph.nodes.map(n=>n.id===id?{...n,...values}:n)}}));
  const updateNode=(values:Partial<WorkflowNode>)=>updateNodeById(selected,values);
  const warnings=useMemo(()=>nodeWarnings(doc.graph,data),[doc.graph,data]);
  // In a task, a card's Settings tab edits the same card of the project workflow (for later tasks).
  const runSettings=(runNode:WorkflowNode)=>{const own=doc.graph.nodes.find(n=>n.id===runNode.id);
    return own?<><p className="wf-config-note">Mengubah kartu ini di workflow project. Berlaku untuk task berikutnya; task ini tetap memakai salinannya.</p><NodeSettings node={own} update={v=>updateNodeById(own.id,v)} data={data} playbook={!!template.playbook_path}/></>:<p className="wf-config-note">Kartu ini sudah tidak ada di workflow project terbaru.</p>;};
  const selectTask=(id:string)=>{setNodeOpen("");navigate("workflow",id);};

  return <div className={"studio-stage pj-stage"+(chatOpen?" has-chat":"")+(run?" is-task":"")}>
    <ProjectBar props={props} tab="workflow">
      <SaveBadge save={save} draft={!!template.draft} open={open} applyNow={()=>void perform(async()=>{if(!window.confirm("Terapkan perubahan sekarang? Task yang sedang berjalan tetap memakai versi lama."))return;await enqueue(true);})}/>
      <div className="pj-bar-actions">
        <div className="pj-history"><button className="icon-button" aria-label="Riwayat versi" title="Riwayat versi" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(v=>!v)}><History size={15}/></button>
          {historyOpen&&<div className="pj-menu" role="menu"><strong>Riwayat versi</strong>{template.history?.length?template.history.map(h=><button key={h.version+h.saved_at} role="menuitem" onClick={()=>{setDoc(d=>({...d,graph:{...h.graph,viewport:undefined},instructions:h.instructions}));setHistoryOpen(false);}}><RotateCcw size={13}/><span>Sebelum {date(h.saved_at)}</span><small>{h.graph.nodes.filter(n=>n.kind!=="reference").length} tahap</small></button>):<p className="muted">Belum ada versi sebelumnya.</p>}</div>}
        </div>
        <button className="icon-button" aria-label="Pengaturan workflow" title="Pengaturan workflow" aria-pressed={settings} onClick={()=>{setSettings(v=>!v);setSelected("");}}><Settings2 size={15}/></button>
        <Button onClick={()=>setRoutine(true)} className={prefs.research_enabled?"pj-routine-on":""}><Repeat size={14}/>Routine{prefs.research_enabled&&<i className="pj-live-dot"/>}</Button>
        <Button className="primary" onClick={()=>setNewTask(true)}><Play size={14}/>Run</Button>
      </div>
    </ProjectBar>

    <div className="studio-canvas-layer">
      {run?<RunStudio key={run} production={production} open={nodeOpen} setOpen={setNodeOpen} busy={busy} perform={perform} back={()=>selectTask("")} settings={runSettings} warnings={warnings}/>
        :<WorkflowCanvas key={template.id} graph={doc.graph} warnings={warnings} onChange={graph=>setDoc(d=>({...d,graph:{...graph,viewport:undefined}}))} selected={selected} onSelect={id=>{setSelected(id);if(id)setSettings(false);}} onOpen={id=>{setSelected(id);setSettings(false);}}/>}
    </div>

    {!run&&(node||settings)&&<aside className="wf-inspector pj-inspector" aria-label="Pengaturan">
      <div className="pj-inspector-head"><strong>{settings?"Workflow":workflowNodeInfo[node!.kind].label}</strong><button className="icon-button" aria-label="Tutup pengaturan" onClick={()=>{setSelected("");setSettings(false);}}><X size={15}/></button></div>
      {!settings&&node&&warnings[node.id]&&<p className="node-panel-warning pj-inspector-warning">{warnings[node.id]}</p>}
      <div className="wf-inspector-content">{settings?<WorkflowSettings doc={doc} setDoc={setDoc} template={template}/>:<NodeSettings node={node!} update={updateNode} data={data} playbook={!!template.playbook_path}/>}</div>
      <div className="wf-inspector-footer"><Check size={12}/><span>Tersimpan otomatis. Perubahan berlaku untuk semua task project ini.</span></div>
    </aside>}

    {chatOpen?(run?<TaskChat key={run} production={production} busy={busy} perform={perform} openNode={setNodeOpen} minimize={()=>setChatOpen(false)}/>
      :<ProjectChat project={project} workflow={template} tasks={tasks} taskTitle={taskTitle} selectedRun="" clearRun={()=>undefined} busy={busy} perform={perform} refresh={refresh} openTask={id=>{setDockOpen(true);selectTask(id);}} minimize={()=>setChatOpen(false)}/>)
      :<button className="studio-pill pj-chat-pill" onClick={()=>setChatOpen(true)}><Sparkles size={15}/>Percakapan</button>}

    <TaskDock tasks={tasks} title={taskTitle} selected={run} open={dockOpen} toggle={()=>setDockOpen(v=>!v)} select={id=>selectTask(id===run?"":id)} create={()=>setNewTask(true)} busy={busy}
      close={(task,closed)=>void perform(async()=>{await api("workflow-runs/"+task.id+"/close",{closed,expected_revision:task.revision});await refresh();})}
      archive={(task,archived)=>void perform(async()=>{await api("workflow-runs/"+task.id+"/archive",{archived,expected_revision:task.revision});if(archived&&task.id===run)selectTask("");await refresh();})}/>

    {newTask&&<NewTask project={project} template={template} data={data} busy={busy} perform={perform} draftPending={!!template.draft} close={()=>setNewTask(false)} created={async id=>{await refresh();setNewTask(false);setDockOpen(true);selectTask(id);}}/>}
    {routine&&<RoutineSettings prefs={prefs} busy={busy} perform={perform} refresh={refresh} close={()=>setRoutine(false)}/>}
  </div>;
}

function SaveBadge({save,draft,open,applyNow}:{save:{kind:string;message?:string};draft:boolean;open:number;applyNow:()=>void}){
  if(save.kind==="saving")return <span className="pj-save"><LoaderCircle size={12} className="spin"/>Menyimpan…</span>;
  if(save.kind==="invalid")return <span className="pj-save is-warn" title={save.message}><AlertTriangle size={12}/>Belum tersimpan: {save.message}</span>;
  if(save.kind==="error")return <span className="pj-save is-error" title={save.message}><CloudOff size={12}/>{save.message}</span>;
  if(draft)return <span className="pj-save is-draft"><Lock size={12}/>Draft · {open} task terbuka<button className="text-button" onClick={applyNow}>Terapkan sekarang</button></span>;
  return <span className="pj-save is-ok"><Check size={12}/>Tersimpan</span>;
}

function NodeSettings({node,update,data,playbook}:{node:WorkflowNode;update:(v:Partial<WorkflowNode>)=>void;data:ProjectProps["data"];playbook:boolean}){
  const route=data.routes.find(r=>r.task===(node.kind==="custom"?"script":node.kind));
  const required=playbook&&["research","script","storyboard","review"].includes(node.kind);
  if(node.kind==="reference"){const ref=node.reference||{type:"link" as const,name:"",url:"",content:""};const set=(v:Partial<typeof ref>)=>update({reference:{...ref,...v}});
    return <>
      <p className="wf-config-note">Referensi adalah input. Hubungkan ke tahap yang harus mengikutinya; isinya dikirim ke tahap itu dan tahap sesudahnya.</p>
      <label>Nama<input value={node.title} maxLength={120} onChange={e=>update({title:e.target.value})}/></label>
      <label>Jenis<select value={ref.type} onChange={e=>set({type:e.target.value as typeof ref.type})}>{referenceTypes.map(t=><option key={t} value={t}>{refLabel[t]}</option>)}</select></label>
      {isChannelLink(ref.url)&&<p className="node-panel-warning">Link channel tidak bisa dibaca isinya. Tempel link satu video, atau tulis gaya yang ingin ditiru di Isi / catatan.</p>}
      {ref.type!=="markdown"&&ref.type!=="file"&&<label>Link<input type="url" value={ref.url} maxLength={2000} placeholder="https://…" onChange={e=>set({url:e.target.value,name:ref.name||e.target.value.replace(/^https?:\/\/(www\.)?/,"").slice(0,80)})}/></label>}
      <label>Isi / catatan<textarea rows={7} value={ref.content} maxLength={50000} placeholder={ref.type==="video"?"Ringkasan, transkrip, atau apa yang perlu ditiru dari video ini…":"Tempel isi markdown, atau unggah file teks."} onChange={e=>set({content:e.target.value})}/></label>
      <label className="button pj-upload"><Upload size={13}/>Unggah .md / .txt<input type="file" hidden accept=".md,.txt,text/plain,text/markdown" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file&&file.size<=50_000)void file.text().then(content=>set({content,name:file.name}));}}/></label>
      <label>Cara memakai<textarea rows={3} value={node.instructions} maxLength={20000} placeholder="Mis. tiru ritme hook dan gaya visualnya." onChange={e=>update({instructions:e.target.value})}/></label>
    </>;}
  return <>
    <div className="wf-config-heading"><span className={`wf-kind-icon wf-kind-${node.kind}`}><FileText size={17}/></span><div><h2>{workflowNodeInfo[node.kind].label}</h2><p>{workflowNodeInfo[node.kind].description}</p></div></div>
    <label>Nama kartu<input value={node.title} maxLength={120} onChange={e=>update({title:e.target.value})}/></label>
    <label>{node.kind==="custom"?"Perintah untuk AI":"Instruksi"}<textarea rows={8} maxLength={20000} value={node.instructions} placeholder={node.kind==="custom"?"Mis. Tulis 10 judul alternatif dari naskah yang disetujui.":"Arahan khusus untuk tahap ini…"} onChange={e=>update({instructions:e.target.value})}/></label>
    {["research","script","storyboard","upload_pack","custom"].includes(node.kind)&&<div className="wf-model-route"><span><Cpu size={11}/> Model</span><strong>{route?.model||"Belum ada model"}</strong><p>{node.kind==="custom"?"Kartu custom memakai model Script. ":""}Atur di Pengaturan → Model AI.</p></div>}
    {node.kind==="voiceover"&&<label>Sumber voiceover<select value={node.provider==="manual"?"manual":"generated"} onChange={e=>update({provider:e.target.value==="manual"?"manual":undefined})}><option value="generated">ElevenLabs · narasi disetujui</option><option value="manual">Impor rekaman</option></select></label>}
    {node.kind==="media"&&<><label>Sumber media<select value={node.provider||"manual"} onChange={e=>update({provider:e.target.value as WorkflowNode["provider"]})}><option value="manual">Impor / renderer playbook</option><option value="flow">Google Flow</option><option value="webhook">Generator webhook</option></select></label><label>Jenis<select value={node.media_kind||"image"} disabled={node.provider==="manual"} onChange={e=>update({media_kind:e.target.value as "image"|"video"})}><option value="image">Gambar</option><option value="video">Klip video</option></select></label></>}
    {node.kind!=="brief"&&<div className="wf-review-policy"><label className="wf-checkbox-label"><input type="checkbox" checked={required||node.review} disabled={required} onChange={e=>update({review:e.target.checked})}/>Berhenti untuk review</label><p>{required?"Wajib menurut playbook project ini.":"Hasilnya menunggu persetujuanmu sebelum tahap berikutnya."}</p></div>}
    <div className="wf-config-footnote"><Info size={14}/><p>Layanan berbayar selalu meminta persetujuan biaya. Urutan dijalankan mengikuti sambungan, bukan posisi kartu.</p></div>
  </>;
}

function WorkflowSettings({doc,setDoc,template}:{doc:Doc;setDoc:(fn:(d:Doc)=>Doc)=>void;template:WorkflowTemplate}){
  return <>
    <label>Nama workflow<input value={doc.name} maxLength={120} onChange={e=>setDoc(d=>({...d,name:e.target.value}))}/></label>
    <label>Deskripsi<textarea rows={3} value={doc.description} maxLength={2000} onChange={e=>setDoc(d=>({...d,description:e.target.value}))}/></label>
    <label>Instruksi bersama<textarea rows={9} value={doc.instructions} maxLength={20000} placeholder="Gaya bahasa, durasi, aturan visual yang berlaku di semua tahap…" onChange={e=>setDoc(d=>({...d,instructions:e.target.value}))}/></label>
    <p className="wf-config-note">{template.playbook_path?"Playbook: "+template.playbook_path+". Playbook tetap jadi acuan utama.":"Project ini tidak memakai playbook vault."} Setiap task menyimpan salinan workflow saat dimulai.</p>
  </>;
}

const dotClass=(r:WorkflowRun)=>"pj-dot is-"+taskStatus(r);
// Tasks sit at the bottom centre: one row per video, with what each one needs right now.
function TaskDock({tasks,title,selected,open,toggle,select,create,close,archive,busy}:{tasks:WorkflowRun[];title:(r:WorkflowRun)=>string;selected:string;open:boolean;toggle:()=>void;select:(id:string)=>void;create:()=>void;close:(task:WorkflowRun,closed:boolean)=>void;archive:(task:WorkflowRun,archived:boolean)=>void;busy:boolean}){
  const visible=tasks.filter(t=>!t.archived),archived=tasks.filter(t=>t.archived);
  const counts=taskCounts(tasks),active=visible.filter(t=>taskStatus(t)!=="done"),done=visible.filter(t=>taskStatus(t)==="done"),current=tasks.find(t=>t.id===selected);
  const [showDone,setShowDone]=useState(false),[showArchived,setShowArchived]=useState(false);
  // Archived tasks keep their chat, documents and files; they only leave the working list.
  const row=(t:WorkflowRun)=><li key={t.id} className={(t.id===selected?"is-selected":"")+(t.archived?" is-archived":"")}><button className="pj-task" onClick={()=>select(t.id)}><i className={dotClass(t)}/><span><strong>{title(t)}</strong><small>{t.archived?"Diarsipkan · ":""}{taskStatusLabel[taskStatus(t)]} · {taskStage(t)} · {date(t.updated)}</small></span></button>
    {!t.archived&&<button className="icon-button" disabled={busy} aria-label={t.closed?"Buka lagi task":"Tutup task"} title={t.closed?"Buka lagi":"Tandai selesai"} onClick={()=>close(t,!t.closed)}>{t.closed?<RotateCcw size={13}/>:<Check size={13}/>}</button>}
    <button className="icon-button" disabled={busy} aria-label={t.archived?"Pulihkan task":"Arsipkan task"} title={t.archived?"Pulihkan dari arsip":"Arsipkan (hasil tetap tersimpan)"} onClick={()=>archive(t,!t.archived)}>{t.archived?<ArchiveRestore size={13}/>:<Archive size={13}/>}</button></li>;
  return <section className={"studio-float pj-dock"+(open?" is-open":"")} aria-label="Task">
    <div className="pj-dock-head"><button className="pj-dock-toggle" aria-expanded={open} onClick={toggle}><ListChecks size={15}/><strong>Task</strong>{current&&<em>{title(current)}</em>}
      <span className="pj-dock-counts">{counts.running>0&&<b className="is-running">{counts.running} jalan</b>}{counts.approval>0&&<b className="is-approval">{counts.approval} approval</b>}{counts.error>0&&<b className="is-error">{counts.error} error</b>}{!counts.running&&!counts.approval&&!counts.error&&<b>{active.length} aktif</b>}</span><ChevronDown size={14}/></button>
      <Button className="primary pj-dock-new" onClick={create}><Play size={13}/>Task baru</Button></div>
    {open&&<div className="pj-dock-body">{!tasks.length?<p className="muted">Belum ada task. Tekan Run atau Task baru untuk membuat video pertama.</p>:<>
      <ul>{active.map(row)}</ul>{!active.length&&<p className="muted">Semua task sudah selesai.</p>}
      {done.length>0&&<><button className="pj-dock-done" onClick={()=>setShowDone(v=>!v)}>{showDone?<ChevronDown size={13}/>:<ChevronRight size={13}/>}Selesai ({done.length})</button>{showDone&&<ul>{done.map(row)}</ul>}</>}
      {archived.length>0&&<><button className="pj-dock-done" onClick={()=>setShowArchived(v=>!v)}>{showArchived?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<Archive size={12}/>Arsip ({archived.length})</button>{showArchived&&<ul>{archived.map(row)}</ul>}</>}
    </>}</div>}
  </section>;
}

function NewTask({project,template,data,busy,perform,draftPending,close,created}:{project:string;template:WorkflowTemplate;data:ProjectProps["data"];busy:boolean;perform:ProjectProps["perform"];draftPending:boolean;close:()=>void;created:(run:string)=>Promise<void>}){
  const [text,setText]=useState(""),[script,setScript]=useState(false),[model,setModel]=useState(""),[error,setError]=useState("");
  const models=[...new Map(data.routes.map(r=>[r.model,r])).values()],mode=!text.trim()?"research":script?"script":"idea";
  return <Modal title="Task baru" close={()=>{if(!busy)close();}}><form className="stack-form" onSubmit={e=>{e.preventDefault();void perform(async()=>{setError("");try{const title=text.trim().split("\n").find(Boolean)?.replace(/^#+\s*/,"").trim().slice(0,120)||"";const result=await api<{run:WorkflowRun}>("workspace/episodes",{channel:project,template:template.id,entry_mode:mode,title,content:text,...(model?{model}:{})});
      // Run means run: the task moves on its own until it needs a review, a paid approval or setup.
      await api("workflow-runs/"+result.run.id+"/advance",{});await created(result.run.id);}catch(cause){setError((cause as Error).message);}});}}>
    <p className="muted">Satu task = satu video. Task langsung berjalan sendiri dan berhenti saat butuh review, persetujuan biaya, atau pengaturan.</p>
    <textarea value={text} onChange={e=>setText(e.target.value)} rows={script?10:4} maxLength={100000} placeholder="Tulis ide atau brief. Kosongkan untuk riset otomatis." aria-label="Ide atau naskah" autoFocus/>
    <div className="button-row"><label className="button"><Upload size={13}/>Unggah naskah<input type="file" hidden accept=".txt,.md,text/plain,text/markdown" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.size>100_000){setError("Naskah maksimal 100 KB.");return;}void file.text().then(content=>{setText(content);setScript(true);});}}/></label>
      {!!text.trim()&&<label className="wf-checkbox-label"><input type="checkbox" checked={script} onChange={e=>setScript(e.target.checked)}/>Ini naskah lengkap</label>}
      <label className="pj-inline-select"><Cpu size={13}/><select aria-label="Model AI" value={model} onChange={e=>setModel(e.target.value)}><option value="">Model otomatis</option>{models.map(r=><option key={r.model} value={r.model}>{r.model}{r.billing==="free"?" · gratis":" · berbayar"}</option>)}</select></label></div>
    <p className="wf-config-note">{mode==="research"?"Kosong: agent riset topik sendiri.":mode==="script"?"Naskah disimpan utuh lalu menunggu review-mu.":"Baris pertama menjadi judul."}{draftPending?" Task baru memakai workflow aktif; draft diterapkan setelah semua task selesai.":""}</p>
    {error&&<p className="danger-text" role="alert">{error}</p>}
    <div className="modal-actions"><Button type="button" disabled={busy} onClick={close}>Batal</Button><Button type="submit" className="primary" busy={busy}><Play size={14}/>Jalankan</Button></div>
  </form></Modal>;
}

// Routine: scheduled tasks. Auto runs every stage up to the plan (free models only); Approval
// prepares the first stage and waits.
function RoutineSettings({prefs,busy,perform,refresh,close}:{prefs:ChannelPreferences;busy:boolean;perform:ProjectProps["perform"];refresh:()=>Promise<void>;close:()=>void}){
  const [value,setValue]=useState(prefs),[error,setError]=useState("");
  const set=(v:Partial<ChannelPreferences>)=>setValue(c=>({...c,...v}));
  return <Modal title="Routine" close={()=>{if(!busy)close();}}><form className="stack-form" onSubmit={e=>{e.preventDefault();void perform(async()=>{setError("");try{await api<ChannelPreferences>("workspace/channels/"+prefs.channel,value,"PUT");await refresh();close();}catch(cause){setError((cause as Error).message);}});}}>
    <label className="wf-checkbox-label pj-switch"><input type="checkbox" checked={value.research_enabled} onChange={e=>set({research_enabled:e.target.checked})}/>Jalankan task otomatis sesuai jadwal</label>
    <fieldset className="pj-modes" disabled={!value.research_enabled}><legend>Mode</legend>
      <label className={value.routine_mode==="auto"?"is-on":""}><input type="radio" name="mode" checked={value.routine_mode==="auto"} onChange={()=>set({routine_mode:"auto"})}/><strong>Auto</strong><span>Agent jalan sampai plan siap di-generate dan diedit. Hanya model gratis; generate berbayar tetap menunggu.</span></label>
      <label className={value.routine_mode==="approval"?"is-on":""}><input type="radio" name="mode" checked={value.routine_mode==="approval"} onChange={()=>set({routine_mode:"approval"})}/><strong>Approval</strong><span>Hanya tahap pertama (riset) yang dijalankan, lalu menunggu review-mu.</span></label>
    </fieldset>
    <label>Jam target (pisahkan dengan koma)<input value={value.slots.join(", ")} disabled={!value.research_enabled} placeholder="19:00, 07:00" onChange={e=>set({slots:e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}/></label>
    <div className="form-grid"><label>Zona waktu<input value={value.timezone} onChange={e=>set({timezone:e.target.value})}/></label><label>Dibuat sebelum target (jam)<input type="number" min={1} max={168} value={value.lead_hours} onChange={e=>set({lead_hours:Number(e.target.value)})}/></label><label>Maks. task terbuka<input type="number" min={1} max={30} value={value.queue_limit} onChange={e=>set({queue_limit:Number(e.target.value)})}/></label></div>
    <label>Arah riset<textarea rows={3} maxLength={2000} value={value.niche} placeholder="Niche dan topik yang dicari agent setiap jadwal." onChange={e=>set({niche:e.target.value})}/></label>
    <p className="wf-config-note">Routine berhenti sementara selama ada draft workflow yang menunggu.</p>
    {error&&<p className="danger-text" role="alert">{error}</p>}
    <div className="modal-actions"><Button type="button" disabled={busy} onClick={close}>Batal</Button><Button type="submit" className="primary" busy={busy}>Simpan Routine</Button></div>
  </form></Modal>;
}
