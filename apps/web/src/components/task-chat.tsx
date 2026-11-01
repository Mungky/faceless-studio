"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowUp,Check,FileText,LoaderCircle,Minus,Sparkles,Square} from "lucide-react";
import type {WorkflowRun} from "@studio/core";
import {api,Button,money,type Detail} from "./ui";
import {Markdown} from "./markdown";
import {isLive,type ProductionState} from "./run-studio";
import type {Perform} from "./workspace-types";

// A task's own conversation, like one session in a chat harness: the owner talks, the agent runs
// the stages and reports back. Decisions that need the owner appear as cards at the bottom.
export function TaskChat({production,busy,perform,openNode,minimize}:{production:ProductionState;busy:boolean;perform:Perform;openNode:(id:string)=>void;minimize:()=>void}){
  const {value,update,advance,send}=production,[draft,setDraft]=useState(""),end=useRef<HTMLDivElement>(null);
  const count=value?.run.messages.length||0;
  useEffect(()=>{end.current?.scrollIntoView({block:"end"});},[count,value?.thinking,value?.advancing]);
  if(!value)return <section className="studio-float studio-panel pj-chat"><div className="studio-messages"><p className="muted"><LoaderCircle className="spin" size={14}/> Memuat percakapan task…</p></div></section>;
  const {run}=value,stage=(id?:string)=>run.graph.nodes.find(n=>n.id===id)?.title;
  const waiting=run.graph.nodes.filter(n=>["waiting_review","waiting_approval"].includes(run.states[n.id]?.status||""));
  const working=run.graph.nodes.find(n=>run.states[n.id]?.status==="running");
  const act=(action:string,node:string,extra:Record<string,unknown>)=>perform(async()=>{await update(await api<{run:WorkflowRun;detail:Detail}>("workflow-runs/"+run.id+"/actions",{action,node_id:node,expected_revision:run.revision,...extra}));await advance();});
  const submit=(text:string)=>{if(!text.trim())return;setDraft("");void perform(()=>send(text));};
  return <section className="studio-float studio-panel pj-chat" aria-label="Chat task">
    <header className="studio-panel-head"><div className="pj-chat-title"><small className="switch-kind">Chat task</small><strong title={value.detail.episode.title}>{value.detail.episode.title}</strong></div><button className="icon-button" aria-label="Kecilkan chat" title="Kecilkan chat" onClick={minimize}><Minus size={16}/></button></header>
    <div className="studio-messages">
      {run.messages.map(m=>m.role==="system"?<p key={m.id} className="tc-event">{m.node_id&&<b>{stage(m.node_id)}</b>}{m.content.slice(0,300)}</p>
        // Directions filed against one stage (by the agent or a card) read as notes, not chat turns.
        :m.role==="user"&&m.node_id?<div key={m.id} className="tc-direction"><b>Arahan → {stage(m.node_id)}</b><span>{m.content.slice(0,600)}</span></div>
        // A stage's full output lives on its card; the chat keeps a short preview of it.
        :m.role==="assistant"&&m.node_id?<button key={m.id} className="tc-direction tc-output" onClick={()=>openNode(m.node_id!)}><b>Hasil {stage(m.node_id)}</b><span>{m.content.replace(/[#*|`>-]+/g," ").replace(/\s+/g," ").slice(0,220)}…</span><em>Buka kartu {stage(m.node_id)}</em></button>
        :<div key={m.id} className={"studio-msg is-"+(m.role==="user"?"user":"assistant")}><div className="studio-bubble">{m.role==="assistant"?<Markdown text={m.content.length>6000?m.content.slice(0,6000)+"…":m.content}/>:<p>{m.content}</p>}{m.node_id&&m.role==="assistant"&&<button className="text-button" onClick={()=>openNode(m.node_id!)}>Buka kartu {stage(m.node_id)}</button>}</div></div>)}
      {value.advancing&&<p className="tc-live"><LoaderCircle className="spin" size={13}/>{working?working.title+" sedang dikerjakan…":"Task berjalan…"}</p>}
      {isLive(value)&&<button type="button" className="tc-stop" disabled={busy} onClick={()=>void perform(production.stop)}><Square size={11}/>Stop task</button>}
      {value.thinking&&<div className="studio-msg is-assistant"><div className="studio-bubble"><LoaderCircle className="spin" size={15}/> Agent sedang menulis…</div></div>}
      {!value.advancing&&waiting.map(n=>{const s=run.states[n.id];return <div key={n.id} className="episode-card is-waiting"><i/><div><strong>{s.status==="waiting_approval"?"Setujui biaya: "+n.title:n.title+" menunggu review"}</strong><span>{s.status==="waiting_approval"&&s.quote?s.quote.provider+" · "+(s.quote.currency==="USD"?money(s.quote.est_cost):s.quote.units+" kredit"):"Baca hasilnya, minta perubahan lewat chat, atau setujui."}</span>
        <div className="button-row"><Button onClick={()=>openNode(n.id)}><FileText size={13}/>Lihat</Button>{s.status==="waiting_approval"&&s.quote?<Button className="primary" busy={busy} onClick={()=>void act("approve",n.id,{quote_id:s.quote!.id})}><Sparkles size={13}/>Setujui biaya & lanjut</Button>:<Button className="primary" busy={busy} onClick={()=>void act("review",n.id,{document_revision:s.output_revision})}><Check size={13}/>Setujui & lanjut</Button>}</div></div></div>;})}
      <div ref={end}/>
    </div>
    <form className="studio-composer" onSubmit={e=>{e.preventDefault();submit(draft);}}>
      {!value.advancing&&!value.thinking&&waiting.some(n=>run.states[n.id]?.status==="waiting_review")&&<div className="tc-quick"><button type="button" onClick={()=>submit("Oke, setuju. Lanjut.")}>Oke, lanjut</button><button type="button" onClick={()=>submit("Ringkas hasilnya dan beri saran perbaikan.")}>Beri saran</button></div>}
      <textarea value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} rows={2} maxLength={20000} placeholder="Minta perubahan, tanya hasil, atau bilang lanjut…" aria-label="Pesan untuk agent task"/>
      <div className="studio-composer-actions"><span className="muted">Agent menjalankan task ini untukmu.</span><button className="studio-send" aria-label="Kirim" disabled={!draft.trim()||busy}><ArrowUp size={17}/></button></div>
    </form>
  </section>;
}
