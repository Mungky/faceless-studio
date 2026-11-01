"use client";
import {useCallback,useEffect,useState} from "react";
import {ExternalLink,LoaderCircle,RefreshCw,Workflow} from "lucide-react";
import {api,Button} from "./ui";
import type {Perform} from "./workspace-types";

type N8nState={configured:boolean;editor:string;url:string;linked:string;workflows:{id:string;name:string;active:boolean;nodes:number;updated:string}[]};

// The n8n editor inside Studio's Workflow page. n8n runs the workflow; Studio keeps the projects,
// task chats, approvals and outputs. The editor is served by scripts/n8n-proxy.mjs with Studio's skin.
export function N8nPane({project,busy,perform,reload}:{project:string;busy:boolean;perform:Perform;reload:number}){
  const [state,setState]=useState<N8nState|null>(null),[error,setError]=useState(""),[open,setOpen]=useState(""),[frame,setFrame]=useState(0);
  const load=useCallback(async()=>{setError("");try{const next=await api<N8nState>("n8n/projects/"+project);setState(next);setOpen(o=>o||next.linked||next.workflows[0]?.id||"");}catch(e){setError((e as Error).message);}},[project]);
  useEffect(()=>{void load();setFrame(f=>f+1);},[load,reload]);
  if(error)return <div className="n8n-empty"><Workflow size={26}/><strong>n8n belum bisa dibuka</strong><p className="danger-text">{error}</p><Button onClick={()=>void load()}><RefreshCw size={13}/>Coba lagi</Button></div>;
  if(!state)return <div className="n8n-empty"><LoaderCircle className="spin" size={20}/><p>Menghubungi n8n…</p></div>;
  if(!state.configured)return <div className="n8n-empty"><Workflow size={26}/><strong>Hubungkan n8n</strong><p>Isi <code>N8N_URL</code> dan <code>N8N_API_KEY</code> di <code>.env</code>, lalu jalankan <code>npm run n8n:proxy</code>.</p></div>;
  if(!open)return <div className="n8n-empty"><Workflow size={26}/><strong>Belum ada workflow n8n untuk project ini</strong><p>Bangun dari resep Studio sekarang, atau minta assistant di chat: "bangun workflow n8n".</p>
    <Button className="primary" busy={busy} onClick={()=>void perform(async()=>{const built=await api<{id:string}>("n8n/projects/"+project+"/build",{});setOpen(built.id);await load();})}><Workflow size={14}/>Bangun dari resep Studio</Button></div>;
  // A loopback editor address only works on the machine that runs the proxy; on a server it must be the proxy's public https domain.
  const loopback=/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(state.editor),remote=!["127.0.0.1","localhost","[::1]"].includes(window.location.hostname);
  if(loopback&&remote)return <div className="n8n-empty"><Workflow size={26}/><strong>Alamat editor n8n belum diatur untuk server</strong><p>Isi <code>N8N_EDITOR_URL</code> di server dengan alamat https dari layanan <code>n8n-proxy</code> (domain di Coolify, port 5679), lalu deploy ulang.</p></div>;
  return <div className="n8n-pane">
    <div className="n8n-switch">{state.workflows.length>1&&<select aria-label="Workflow n8n" value={open} onChange={e=>setOpen(e.target.value)}>{state.workflows.map(w=><option key={w.id} value={w.id}>{w.name}{w.active?" · aktif":""}</option>)}</select>}
      <button className="icon-button" disabled={busy} title="Bangun ulang dari resep Studio (ID, webhook dan credential tetap)" aria-label="Bangun ulang workflow n8n dari resep Studio" onClick={()=>void perform(async()=>{await api("n8n/projects/"+project+"/build",{});setFrame(f=>f+1);})}><RefreshCw size={14}/></button>
      <a className="icon-button" href={state.editor+"/workflow/"+open} target="_blank" rel="noreferrer" title="Buka di tab baru" aria-label="Buka editor n8n di tab baru"><ExternalLink size={14}/></a></div>
    <iframe key={open+frame}className="n8n-frame" src={state.editor+"/workflow/"+open} title="Editor n8n" allow="clipboard-read; clipboard-write"/>
  </div>;
}
