"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowUp,Check,ExternalLink,ListChecks,LoaderCircle,Minus,Paperclip,Sparkles,Wand2,X} from "lucide-react";
import {workflowNodeInfo,type StudioMessage,type StudioThread,type WorkflowRun,type WorkflowTemplate} from "@studio/core";
import {api,Button} from "./ui";
import {Markdown} from "./markdown";
import type {Perform} from "./workspace-types";

const actionLabel:Record<string,string>={create_template:"Buat template",edit_template:"Ubah workflow",start_episode:"Buat task",analyze_reference:"Analisis video",run_step:"Jalankan langkah",add_reference:"Tambah referensi",direct_task:"Arahan untuk task"};

// The project's single conversation with its agent. It never forks: a selected task is passed as
// context with each message instead, and long histories are condensed on the server.
export function ProjectChat({project,workflow,tasks,taskTitle,selectedRun,clearRun,busy,perform,refresh,openTask,minimize}:{project:string;workflow:WorkflowTemplate;tasks:WorkflowRun[];taskTitle:(run:WorkflowRun)=>string;selectedRun:string;clearRun:()=>void;busy:boolean;perform:Perform;refresh:()=>Promise<void>;openTask:(id:string)=>void;minimize:()=>void}){
  const [thread,setThread]=useState<StudioThread|null>(null),[draft,setDraft]=useState(""),[sending,setSending]=useState(false),[error,setError]=useState("");
  const end=useRef<HTMLDivElement>(null),autosent=useRef(false);
  const selected=tasks.find(t=>t.id===selectedRun);
  const send=useCallback(async(text:string,current:StudioThread,analyses:string[]=[])=>{
    if(!text.trim())return;setSending(true);setError("");
    setThread({...current,messages:[...current.messages,{id:"pending",role:"user",content:text,created:new Date().toISOString()}]});setDraft("");
    try{setThread(await api<StudioThread>("studio/threads/"+current.id+"/messages",{content:text,expected_revision:current.revision,run:selectedRun||null,...(analyses.length?{analyses}:{})}));}
    catch(e){setError((e as Error).message);setDraft(text);setThread(current);}finally{setSending(false);}
  },[selectedRun]);
  useEffect(()=>{let live=true;api<StudioThread>("studio/projects/"+project+"/thread").then(t=>{if(!live)return;setThread(t);
    // Hand-offs: Initiate's first brief is sent once; Asset and For You leave a prompt and analyses.
    if(autosent.current)return;autosent.current=true;let first="",prompt="",attach:string[]=[];
    try{first=sessionStorage.getItem("faceless:project-autosend:"+project)||"";prompt=sessionStorage.getItem("faceless:studio-prompt")||"";attach=JSON.parse(sessionStorage.getItem("faceless:studio-attach")||"[]");for(const key of ["faceless:project-autosend:"+project,"faceless:studio-prompt","faceless:studio-attach"])sessionStorage.removeItem(key);}catch{}
    if(first)void send(first,t);else if(attach.length)void send(prompt||"Pelajari video referensi terlampir untuk project ini.",t,attach);else if(prompt)setDraft(prompt);
  }).catch(e=>{if(live)setError((e as Error).message);});return ()=>{live=false;};},[project,send]);
  useEffect(()=>{end.current?.scrollIntoView({block:"end"});},[thread?.messages.length,sending]);
  // The way in: an idea typed here becomes a task that starts running straight away.
  const createTask=()=>void perform(async()=>{const text=draft.trim();const title=text.split(String.fromCharCode(10)).find(Boolean)?.replace(/^#+\s*/,"").slice(0,120)||"";
    const created=await api<{run:WorkflowRun}>("workspace/episodes",{channel:project,template:workflow.id,entry_mode:text?"idea":"research",title,content:text});
    await api("workflow-runs/"+created.run.id+"/advance",{});setDraft("");await refresh();openTask(created.run.id);});
  const decide=(message:StudioMessage,decision:"apply"|"dismiss")=>void perform(async()=>{if(!thread)return;const next=await api<StudioThread>("studio/threads/"+thread.id+"/apply",{message_id:message.id,decision});setThread(next);await refresh();
    const applied=next.messages.find(m=>m.id===message.id)?.action;if(applied?.status==="applied"&&next.attachments.run&&["start_episode","run_step","direct_task"].includes(applied.type))openTask(next.attachments.run);
    // After a reference is studied the agent continues on its own with what it learned.
    if(applied?.status==="applied"&&applied.type==="analyze_reference")await send("Analisis sudah selesai. Lanjutkan berdasarkan hasilnya.",next);});

  return <section className="studio-float studio-panel pj-chat" aria-label="Chat project">
    <header className="studio-panel-head"><div className="pj-chat-title"><small className="switch-kind">Asisten project</small><strong>Percakapan</strong></div><button className="icon-button" aria-label="Kecilkan chat" title="Kecilkan chat" onClick={minimize}><Minus size={16}/></button></header>
    <div className="studio-messages">
      {!thread?<p className="muted"><LoaderCircle className="spin" size={14}/> Memuat percakapan…</p>
        :!thread.messages.length&&!sending?<div className="studio-hint"><Sparkles size={18}/><p>Tulis ide video lalu tekan <strong>Jadikan task</strong>: agent langsung mengerjakannya di chat task-nya sendiri. Kirim pesan biasa untuk ngobrol soal resep project: ubah workflow, tambah referensi, analisis video.</p>{!!thread.attachments.analyses.length&&<p className="studio-attach"><Paperclip size={13}/>{thread.attachments.analyses.length} analisis video terlampir</p>}</div>
        :thread.messages.map(m=><Message key={m.id} message={m} workflow={workflow} busy={busy} decide={decide} openTask={()=>{if(thread.attachments.run)openTask(thread.attachments.run);}}/>)}
      {sending&&<div className="studio-msg is-assistant"><div className="studio-bubble"><LoaderCircle className="spin" size={15}/> Agent sedang berpikir…</div></div>}
      <div ref={end}/>
    </div>
    {error&&<p className="danger-text studio-error" role="alert">{error}<button className="icon-button" aria-label="Tutup" onClick={()=>setError("")}><X size={13}/></button></p>}
    <form className="studio-composer" onSubmit={e=>{e.preventDefault();if(thread&&!sending)void send(draft,thread);}}>
      {selected&&<span className="pj-chat-chip"><ListChecks size={13}/>Task · {taskTitle(selected)}<button type="button" aria-label="Lepas task dari pesan" onClick={clearRun}><X size={12}/></button></span>}
      <textarea value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder="Tulis ide video untuk dijadikan task, atau ngobrol soal resep project…" rows={2} maxLength={20000} aria-label="Pesan untuk agent"/>
      <div className="studio-composer-actions"><Button type="button" className="primary pj-make-task" busy={busy} disabled={sending} onClick={createTask} title="Jadikan ide ini satu task (video). Kosong = riset otomatis."><Sparkles size={13}/>{draft.trim()?"Jadikan task":"Task riset otomatis"}</Button><span className="muted">atau kirim untuk ngobrol soal resep</span><button className="studio-send" aria-label="Kirim ke agent" disabled={!draft.trim()||sending||!thread}><ArrowUp size={17}/></button></div>
    </form>
  </section>;
}

function Message({message,workflow,busy,decide,openTask}:{message:StudioMessage;workflow:WorkflowTemplate;busy:boolean;decide:(m:StudioMessage,d:"apply"|"dismiss")=>void;openTask:()=>void}){
  const action=message.action;
  return <div className={"studio-msg is-"+message.role}><div className="studio-bubble">{message.role==="assistant"?<Markdown text={message.content}/>:message.content.split("\n").map((line,k)=><p key={k}>{line||"\u00a0"}</p>)}</div>
    {action&&<div className={"studio-action is-"+action.status}><div className="studio-action-head"><Wand2 size={15}/><strong>{actionLabel[action.type]||action.type}</strong><span>{action.status==="proposed"?"Menunggu persetujuan":action.status==="applied"?"Diterapkan":action.status==="dismissed"?"Diabaikan":"Gagal"}</span></div>
      <ActionDetail action={action} workflow={workflow}/>{action.result&&<p className="muted">{action.result}</p>}
      <div className="button-row">{action.status==="proposed"&&<><Button className="primary" busy={busy} onClick={()=>decide(message,"apply")}><Check size={14}/>Terapkan</Button><Button disabled={busy} onClick={()=>decide(message,"dismiss")}>Abaikan</Button></>}{action.status==="applied"&&["start_episode","run_step","direct_task"].includes(action.type)&&<Button onClick={openTask}><ExternalLink size={13}/>Buka task</Button>}</div></div>}
  </div>;
}
// Workflow changes affect every task, so a proposal shows what it adds and removes before applying.
function ActionDetail({action,workflow}:{action:NonNullable<StudioMessage["action"]>;workflow:WorkflowTemplate}){
  if(action.type==="edit_template"){
    const current=(workflow.draft?.graph||workflow.graph).nodes.filter(n=>n.kind!=="reference");
    if(!action.steps)return <div className="studio-action-body"><p>Instruksi workflow diganti.</p></div>;
    const label=(kind:string,title?:string)=>title||workflowNodeInfo[kind as keyof typeof workflowNodeInfo]?.label||kind;
    // Compare by card type: a renamed card is a rename, not a removal plus an addition.
    const steps=action.steps.filter(s=>s.kind!=="brief"),before=current.filter(n=>n.kind!=="brief"),changes:{key:string;cls:string;text:string}[]=[];
    for(const step of steps){const old=before.find(n=>n.kind===step.kind);const title=label(step.kind,step.title);
      if(!old)changes.push({key:"+"+step.kind+title,cls:"is-add",text:"+ "+title});else if(old.title!==title)changes.push({key:"~"+step.kind,cls:"is-rename",text:old.title+" → "+title});
      else if(old.instructions!==(step.instructions||""))changes.push({key:"i"+step.kind,cls:"is-edit",text:"✎ "+title});}
    for(const old of before)if(!steps.some(s=>s.kind===old.kind))changes.push({key:"-"+old.id,cls:"is-remove",text:"− "+old.title});
    return <div className="studio-action-body"><ol className="studio-steps">{action.steps.map((s,i)=><li key={i}><span>{s.kind}</span>{label(s.kind,s.title)}</li>)}</ol>
      {changes.length>0&&<p className="pj-diff">{changes.map(c=><b key={c.key} className={c.cls}>{c.text}</b>)}</p>}
      <p className="muted">Berlaku untuk semua task. Kalau masih ada task terbuka, perubahan disimpan sebagai draft.</p></div>;
  }
  if(action.type==="add_reference")return <div className="studio-action-body"><p><strong>{action.name}</strong> · {action.ref_type}{action.target?" → "+action.target:""}</p>{action.url&&<p className="studio-url">{action.url}</p>}</div>;
  if(action.type==="direct_task")return <div className="studio-action-body"><p>{action.content.slice(0,300)}</p></div>;
  if(action.type==="create_template")return <div className="studio-action-body"><p><strong>{action.name}</strong></p><ol className="studio-steps">{action.steps.map((s,i)=><li key={i}><span>{s.kind}</span>{s.title||""}</li>)}</ol></div>;
  if(action.type==="start_episode")return <div className="studio-action-body"><p>{action.title||"Judul dibuat otomatis"} · {action.entry_mode==="research"?"Riset otomatis":action.entry_mode==="idea"?"Dari ide":"Naskah sendiri"}</p></div>;
  if(action.type==="analyze_reference")return <div className="studio-action-body"><p className="studio-url">{action.url}</p></div>;
  return <div className="studio-action-body"><p>Task {action.run_id}{action.node_id?" · langkah "+action.node_id:""}</p></div>;
}
