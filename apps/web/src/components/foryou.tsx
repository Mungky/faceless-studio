"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {ArrowUpRight,Bookmark,Check,Link2,LoaderCircle,Microscope,Plus,Search,Send,Sparkles,Users,X} from "lucide-react";
import {analysisCriteria,overallScore,platforms,referenceThumbnail,type ForYouCompetitor,type ForYouReference,type PlatformId,type VideoAnalysis} from "@studio/core";
import {api,Button,Empty,Modal,date} from "./ui";
import type {Perform,WorkspaceData} from "./workspace-types";

type Data={references:ForYouReference[];competitors:ForYouCompetitor[];analyses:VideoAnalysis[]};
const badge:Record<string,string>={youtube:"YT",tiktok:"TT",instagram:"IG",x:"X",threads:"TH",web:"WEB"};
const platformLabel=(id:PlatformId)=>platforms.find(p=>p.id===id)?.label||"Web";
const filters=[{id:"all",label:"Semua"},{id:"saved",label:"Disimpan"},{id:"analyzed",label:"Sudah dianalisis"}] as const;

// For You: workspace-wide references from any platform, scored and handed to Studio.
export function ForYou({workspace,busy,perform,toStudio}:{workspace:WorkspaceData;busy:boolean;perform:Perform;toStudio:(analyses:string[],prompt:string)=>void}){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[link,setLink]=useState(""),[query,setQuery]=useState(""),[chosen,setChosen]=useState<PlatformId[]>(["tiktok","youtube","instagram"]),[viaCompetitors,setViaCompetitors]=useState(false);
  const [filter,setFilter]=useState<typeof filters[number]["id"]>("all"),[picked,setPicked]=useState<string[]>([]),[open,setOpen]=useState<VideoAnalysis|null>(null),[adding,setAdding]=useState(false),[running,setRunning]=useState("");
  const load=useCallback(async()=>{try{setData(await api<Data>("foryou"));setError("");}catch(e){setError(e instanceof Error?e.message:"For You belum dapat dimuat.");}},[]);
  useEffect(()=>{void load();},[load]);
  const queued=data?.analyses.some(a=>a.status==="queued");
  useEffect(()=>{if(!queued)return;const timer=setInterval(()=>void load(),5000);return ()=>clearInterval(timer);},[queued,load]);
  const analyses=useMemo(()=>new Map((data?.analyses||[]).map(a=>[a.id,a])),[data]);
  const rows=(data?.references||[]).filter(r=>filter==="all"||(filter==="saved"?r.saved:!!r.analysis_id)).sort((a,b)=>Number(!!b.analysis_id)-Number(!!a.analysis_id)||b.observed_at.localeCompare(a.observed_at));
  const analyze=(reference:ForYouReference,depth:"quick"|"deep")=>void perform(async()=>{setRunning(reference.id);try{const result=await api<VideoAnalysis>("foryou/references/"+reference.id+"/analyze",{depth});await load();if(result.status==="done")setOpen(result);}finally{setRunning("");}});
  const pickedAnalyses=picked.map(id=>data?.references.find(r=>r.id===id)?.analysis_id).filter((id):id is string=>!!id&&analyses.get(id)?.status==="done");
  return <div className="foryou-page">
    <header className="page-heading"><div><span className="eyebrow">DISCOVER</span><h1>For You</h1><p>Kumpulkan referensi dari YouTube, TikTok, Instagram, X, dan Threads. Analisis, lalu jadikan template di Studio.</p></div></header>
    <form className="foryou-link" onSubmit={e=>{e.preventDefault();if(link.trim())void perform(async()=>{await api("foryou/references",{url:link.trim()});setLink("");await load();});}}><Link2 size={18}/><input value={link} onChange={e=>setLink(e.target.value)} placeholder="Tempel link video atau postingan (TikTok, Reels, YouTube, X, Threads)" aria-label="Link referensi" maxLength={2000}/><Button className="primary" type="submit" busy={busy} disabled={!link.trim()}>Tambah</Button></form>
    <div className="foryou-tools">
      <div className="foryou-platforms" role="group" aria-label="Platform">{platforms.map(p=><button key={p.id} type="button" className="chip" aria-pressed={chosen.includes(p.id)} onClick={()=>setChosen(list=>list.includes(p.id)?list.filter(x=>x!==p.id):[...list,p.id])}><b>{badge[p.id]}</b>{p.label}</button>)}</div>
      <form className="foryou-search" onSubmit={e=>{e.preventDefault();void perform(async()=>{await api("foryou/search",{query,platforms:chosen,competitors:viaCompetitors});await load();});}}><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={viaCompetitors?"Kata kunci tambahan (opsional)":"Topik atau niche, mis. kisah hidup anak kos"} aria-label="Cari referensi" maxLength={500}/><label className="checkbox-label"><input type="checkbox" checked={viaCompetitors} onChange={e=>setViaCompetitors(e.target.checked)}/>Dari kompetitor</label><Button type="submit" busy={busy} disabled={!chosen.length||!workspace.connections.searxng||(!viaCompetitors&&!query.trim())}>Cari</Button></form>
    </div>
    {!workspace.connections.searxng&&<p className="quiet-panel">SearXNG belum terhubung, jadi pencarian belum bisa dipakai. Menempel link tetap bisa.</p>}
    <div className="foryou-competitors"><Users size={15}/><span>Kompetitor</span>{data?.competitors.map(c=><a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="chip"><b>{badge[c.platform]}</b>{c.name}<ArrowUpRight size={11}/></a>)}<button className="chip" onClick={()=>setAdding(true)}><Plus size={12}/>Tambah</button></div>
    {error&&<p className="danger-text" role="alert">{error}</p>}
    <div className="section-toolbar"><nav className="composer-modes" aria-label="Saring referensi">{filters.map(f=><button key={f.id} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label}</button>)}</nav><span className="muted">{rows.length} referensi</span></div>
    {!data?<p className="muted">Memuat…</p>:!rows.length?<Empty title="Belum ada referensi" icon={<Sparkles size={27}/>}>Tempel link video yang menarik, atau cari berdasarkan topik di platform pilihanmu.</Empty>:
    <ul className="foryou-grid">{rows.map(r=>{const analysis=r.analysis_id?analyses.get(r.analysis_id):undefined,thumb=referenceThumbnail(r),isPicked=picked.includes(r.id);return <li key={r.id} className={"foryou-card"+(isPicked?" picked":"")}>
      <button className="foryou-cover" onClick={()=>analysis?.status==="done"?setOpen(analysis):window.open(r.url,"_blank","noopener")} aria-label={analysis?.status==="done"?"Lihat analisis "+r.title:"Buka "+r.title}>{thumb?<img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="foryou-blank">{platformLabel(r.platform)}</span>}</button>
      <span className={"foryou-platform p-"+r.platform}>{badge[r.platform]}</span>
      {analysis&&<span className={"foryou-score"+(analysis.status!=="done"?" is-pending":"")}>{analysis.status==="done"?overallScore(analysis):analysis.status==="queued"?<LoaderCircle className="spin" size={13}/>:"!"}</span>}
      <label className="foryou-check"><input type="checkbox" checked={isPicked} onChange={()=>setPicked(list=>isPicked?list.filter(x=>x!==r.id):[...list,r.id])} aria-label={"Pilih "+r.title}/></label>
      <div className="foryou-body"><h3 title={r.title}>{r.title}</h3><p>{r.author||new URL(r.url).hostname}{r.views!=null?" · "+r.views.toLocaleString("id-ID")+" views":""}</p>
        {analysis?.status==="failed"&&<p className="danger-text">{analysis.error}</p>}
        <div className="foryou-actions"><Button busy={running===r.id} onClick={()=>analyze(r,"quick")}><Microscope size={13}/>{analysis?"Analisis ulang":"Analisis"}</Button><Button onClick={()=>analyze(r,"deep")} title="Unduh video di PC worker, ambil frame dan transkrip">Mendalam</Button><button className="icon-button" aria-label={r.saved?"Hapus dari simpanan":"Simpan"} aria-pressed={r.saved} onClick={()=>void perform(async()=>{await api("foryou/references/"+r.id,{saved:!r.saved},"PUT");await load();})}>{r.saved?<Check size={15}/>:<Bookmark size={15}/>}</button></div></div>
    </li>;})}</ul>}
    {picked.length>0&&<div className="foryou-tray" role="region" aria-label="Referensi terpilih"><strong>{picked.length} dipilih</strong><span className="muted">{pickedAnalyses.length} sudah dianalisis</span><Button className="primary" disabled={!pickedAnalyses.length} onClick={()=>toStudio(pickedAnalyses,`Gabungkan ${pickedAnalyses.length} analisis video ini menjadi satu template produksi dan niche baru. Jelaskan formula yang sama di antara video-video ini, lalu usulkan langkah template-nya.`)}><Send size={14}/>Kirim ke Studio</Button><button className="icon-button" aria-label="Batal pilih" onClick={()=>setPicked([])}><X size={15}/></button></div>}
    {open&&<AnalysisModal analysis={open} close={()=>setOpen(null)} toStudio={()=>toStudio([open.id],"Jadikan analisis video ini template produksi baru, lengkap dengan niche dan langkah-langkahnya.")}/>}
    {adding&&<Modal title="Tambah kompetitor" close={()=>setAdding(false)}><form className="stack-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(async()=>{await api("foryou/competitors",{name:f.get("name"),url:f.get("url")});await load();setAdding(false);});}}><label>Nama akun<input name="name" required maxLength={200} placeholder="Mis. RickClips"/></label><label>Link profil<input name="url" type="url" required placeholder="https://www.tiktok.com/@akun"/></label><p className="muted">Platform dikenali otomatis dari link.</p><div className="modal-actions"><Button type="submit" className="primary" busy={busy}>Tambah kompetitor</Button></div></form></Modal>}
  </div>;
}

function AnalysisModal({analysis,close,toStudio}:{analysis:VideoAnalysis;close:()=>void;toStudio:()=>void}){
  const total=overallScore(analysis);
  return <Modal title={analysis.title} close={close} wide><div className="analysis-view">
    <div className="analysis-head"><div className="analysis-total"><strong>{total}</strong><span>/10</span></div><div><p>{analysis.summary||"Belum ada ringkasan."}</p><p className="muted">{platformLabel(analysis.platform)} · {analysis.depth==="deep"?"Analisis mendalam":"Analisis cepat"} · {analysis.model} · {date(analysis.created)}</p></div></div>
    <ul className="analysis-scores">{analysisCriteria.map(c=>{const s=analysis.scores[c.id];return <li key={c.id}><div><strong>{c.label}</strong><span>{s.score}</span></div><i style={{"--score":s.score*10+"%"} as React.CSSProperties}/><p>{s.reason}</p></li>;})}</ul>
    {analysis.beats.length>0&&<section><h3>Alur video</h3><ol className="analysis-beats">{analysis.beats.map((b,i)=><li key={i}><span>{b.time||"–"}</span>{b.description}</li>)}</ol></section>}
    {analysis.formula.length>0&&<section><h3>Formula yang bisa ditiru</h3><ul className="analysis-formula">{analysis.formula.map((f,i)=><li key={i}>{f}</li>)}</ul></section>}
    {analysis.niche&&<p><strong>Niche:</strong> {analysis.niche}</p>}
    {analysis.limitations.length>0&&<p className="muted">Batasan: {analysis.limitations.join(" · ")}</p>}
    <div className="modal-actions"><a className="button" href={analysis.url} target="_blank" rel="noreferrer">Buka sumber<ArrowUpRight size={13}/></a><Button className="primary" onClick={toStudio}><Send size={14}/>Jadikan template di Studio</Button></div>
  </div></Modal>;
}
