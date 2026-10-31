"use client";
import {useMemo,useState} from "react";
import {AudioLines,Film,Image as ImageIcon,Layers,Music,Search,Tag,X} from "lucide-react";
import {filterAssets,groupAssets,noGroup,type AssetGrouping,type LibraryAsset} from "@studio/core";
import {api,Button,Empty,Modal,date,type Dashboard} from "./ui";
import type {Perform} from "./workspace-types";

const kindLabel:Record<string,string>={image:"Gambar",video:"Video",vo:"VO",sfx:"SFX",bgm:"BGM",music:"Musik",render:"Render",thumb:"Thumbnail"};
const kindIcon=(kind:string,size=16)=>kind==="image"||kind==="thumb"?<ImageIcon size={size}/>:kind==="video"||kind==="render"?<Film size={size}/>:kind==="vo"?<AudioLines size={size}/>:kind==="sfx"||kind==="bgm"||kind==="music"?<Music size={size}/>:<Layers size={size}/>;
const groupings:Array<{id:AssetGrouping;label:string}>=[{id:"group",label:"Grup"},{id:"channel",label:"Channel"},{id:"episode",label:"Episode"},{id:"kind",label:"Jenis"},{id:"none",label:"Tanpa"}];
const baseName=(path:string)=>path.split("/").pop()||path;
const previewable=(path:string)=>/\.(jpe?g|png|webp|mp4|webm|mp3|wav|m4a|flac)$/i.test(path);
const splitTags=(value:string)=>value.split(",").map(tag=>tag.trim()).filter(Boolean);

export function AssetsLibrary({data,busy,perform,refresh}:{data:Dashboard;busy:boolean;perform:Perform;refresh:()=>Promise<void>}){
  const [search,setSearch]=useState(""),[channel,setChannel]=useState(""),[kind,setKind]=useState(""),[group,setGroup]=useState(""),[tag,setTag]=useState(""),[by,setBy]=useState<AssetGrouping>("group"),[picked,setPicked]=useState<string[]>([]),[open,setOpen]=useState(""),[bulkGroup,setBulkGroup]=useState(""),[bulkTag,setBulkTag]=useState("");
  const channels=useMemo(()=>new Map(data.channels.map(c=>[c.id,c])),[data.channels]),episodes=useMemo(()=>new Map(data.episodes.map(e=>[e.id,e])),[data.episodes]);
  const all=useMemo<LibraryAsset[]>(()=>data.assets.map(a=>({id:a.id,kind:a.kind,episode:a.episode,channel:episodes.get(a.episode)?.channel||"",drive_path:a.drive_path,asset_group:a.asset_group||"",tags:a.tags||[],created:a.created})),[data.assets,episodes]);
  const groups=useMemo(()=>[...new Set(all.map(a=>a.asset_group).filter(Boolean))].sort(),[all]),tags=useMemo(()=>[...new Set(all.flatMap(a=>a.tags))].sort(),[all]);
  const visible=useMemo(()=>filterAssets(all,{search,channel,kind,group,tag}),[all,search,channel,kind,group,tag]);
  const label=(mode:AssetGrouping,key:string)=>mode==="channel"?channels.get(key)?.name||"Tanpa channel":mode==="episode"?episodes.get(key)?.title||"Episode tidak ditemukan":mode==="kind"?kindLabel[key]||key:key;
  const buckets=useMemo(()=>groupAssets(visible,by,label),[visible,by,channels,episodes]);
  const byId=useMemo(()=>new Map(data.assets.map(a=>[a.id,a])),[data.assets]),current=open?byId.get(open):undefined;
  const toggle=(id:string)=>setPicked(list=>list.includes(id)?list.filter(x=>x!==id):[...list,id]);
  const organize=(body:Record<string,unknown>)=>perform(async()=>{await api("assets/organize",{ids:picked,...body});await refresh();setBulkGroup("");setBulkTag("");});
  const filtering=Boolean(search||channel||kind||group||tag);
  return <div className="alib-page">
    <header className="page-heading"><div><span className="eyebrow">LIBRARY</span><h1>Asset</h1><p>Gambar, VO, dan video yang dibuat. Kelompokkan dan beri tag supaya rapi.</p></div><span className="muted">{visible.length} dari {all.length} asset</span></header>
    {all.length===0?<Empty title="Belum ada asset" icon={<Layers size={27}/>}>Asset muncul di sini setelah produksi membuat gambar, VO, atau video.</Empty>:<>
      <div className="alib-toolbar">
        <div className="alib-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama file, grup, atau tag" aria-label="Cari asset"/></div>
        <select value={channel} onChange={e=>setChannel(e.target.value)} aria-label="Pemilik channel"><option value="">Semua channel</option>{data.channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={kind} onChange={e=>setKind(e.target.value)} aria-label="Jenis"><option value="">Semua jenis</option>{Object.entries(kindLabel).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
        <select value={group} onChange={e=>setGroup(e.target.value)} aria-label="Grup"><option value="">Semua grup</option><option value={noGroup}>Tanpa grup</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select>
        <select value={tag} onChange={e=>setTag(e.target.value)} aria-label="Tag"><option value="">Semua tag</option>{tags.map(t=><option key={t} value={t}>{t}</option>)}</select>
        {filtering&&<button className="button" onClick={()=>{setSearch("");setChannel("");setKind("");setGroup("");setTag("");}}>Reset</button>}
      </div>
      <div className="alib-grouping" role="group" aria-label="Kelompokkan berdasarkan"><span className="muted">Kelompokkan</span>{groupings.map(g=><button key={g.id} className="chip" aria-pressed={by===g.id} onClick={()=>setBy(g.id)}>{g.label}</button>)}</div>
      {picked.length>0&&<div className="alib-bulk" role="region" aria-label="Aksi untuk asset terpilih"><strong>{picked.length} dipilih</strong>
        <form onSubmit={e=>{e.preventDefault();void organize({asset_group:bulkGroup});}}><input list="alib-groups" value={bulkGroup} onChange={e=>setBulkGroup(e.target.value)} placeholder="Nama grup" maxLength={80} aria-label="Nama grup"/><Button type="submit" busy={busy}>Pindah ke grup</Button></form>
        <form onSubmit={e=>{e.preventDefault();const add=splitTags(bulkTag);if(add.length)void organize({add_tags:add});}}><input value={bulkTag} onChange={e=>setBulkTag(e.target.value)} placeholder="tag, tag" aria-label="Tag baru"/><Button type="submit" busy={busy}>Tambah tag</Button></form>
        <button className="button" onClick={()=>setPicked([])}>Batal pilih</button></div>}
      <datalist id="alib-groups">{groups.map(g=><option key={g} value={g}/>)}</datalist>
      {visible.length===0?<Empty title="Tidak ada asset yang cocok" icon={<Search size={27}/>}>Ubah filter atau kata pencarian.</Empty>:buckets.map(bucket=><section key={bucket.key||"empty"} className="alib-section"><header><h2>{bucket.label}</h2><span className="muted">{bucket.items.length}</span><button className="link-button" onClick={()=>setPicked(list=>[...new Set([...list,...bucket.items.map(a=>a.id)])])}>Pilih semua</button></header>
        <ul className="alib-grid">{bucket.items.map(asset=>{const owner=channels.get(asset.channel),episode=episodes.get(asset.episode);return <li key={asset.id} className={"alib-card"+(picked.includes(asset.id)?" picked":"")}>
          <label className="alib-check"><input type="checkbox" checked={picked.includes(asset.id)} onChange={()=>toggle(asset.id)} aria-label={"Pilih "+baseName(asset.drive_path)}/></label>
          <button className="alib-open" onClick={()=>setOpen(asset.id)}><span className="alib-kind">{kindIcon(asset.kind,20)}<span>{kindLabel[asset.kind]||asset.kind}</span></span><strong title={asset.drive_path}>{baseName(asset.drive_path)}</strong>
            <span className="alib-owner"><i style={{background:owner?.color||"#555"}}/>{owner?.name||"Tanpa channel"}{episode?<em> · {episode.title}</em>:null}</span>
            <span className="alib-tags">{asset.asset_group&&<span className="chip alib-group">{asset.asset_group}</span>}{asset.tags.map(t=><span key={t} className="chip"><Tag size={10}/>{t}</span>)}</span></button></li>;})}</ul></section>)}
    </>}
    {current&&<AssetDetail key={current.id} asset={current} owner={channels.get(episodes.get(current.episode)?.channel||"")?.name||"Tanpa channel"} episode={episodes.get(current.episode)?.title||""} groups={groups} busy={busy} perform={perform} refresh={refresh} close={()=>setOpen("")}/>}
  </div>;
}

function AssetDetail({asset,owner,episode,groups,busy,perform,refresh,close}:{asset:Dashboard["assets"][number];owner:string;episode:string;groups:string[];busy:boolean;perform:Perform;refresh:()=>Promise<void>;close:()=>void}){
  const [group,setGroup]=useState(asset.asset_group||""),[tags,setTags]=useState<string[]>(asset.tags||[]),[draft,setDraft]=useState(""),[preview,setPreview]=useState(false);
  const url="/api/assets/"+asset.id+"/preview",addDraft=()=>{const next=splitTags(draft);if(next.length){setTags(list=>[...new Set([...list,...next.map(t=>t.toLowerCase())])].slice(0,12));setDraft("");}};
  const name=baseName(asset.drive_path),isImage=/\.(jpe?g|png|webp)$/i.test(name),isVideo=/\.(mp4|webm)$/i.test(name),isAudio=/\.(mp3|wav|m4a|flac)$/i.test(name);
  return <Modal title={name} close={close} wide><div className="alib-detail">
    <div className="alib-preview">{preview?isImage?<img src={url} alt={name}/>:isVideo?<video src={url} controls preload="metadata"/>:isAudio?<audio src={url} controls preload="metadata"/>:null:<div className="alib-preview-empty">{kindIcon(asset.kind,28)}<p className="muted">{previewable(asset.drive_path)?"Pratinjau diambil dari Drive hanya saat diminta.":"Jenis file ini tidak punya pratinjau."}</p>{previewable(asset.drive_path)&&<Button onClick={()=>setPreview(true)}>Muat pratinjau</Button>}</div>}</div>
    <dl className="alib-meta"><div><dt>Pemilik</dt><dd>{owner}</dd></div>{episode&&<div><dt>Episode</dt><dd>{episode}</dd></div>}<div><dt>Jenis</dt><dd>{kindLabel[asset.kind]||asset.kind}</dd></div><div><dt>Sumber</dt><dd>{asset.source}</dd></div><div><dt>Dibuat</dt><dd>{date(asset.created)}</dd></div><div><dt>Lokasi Drive</dt><dd className="alib-path">{asset.drive_path}</dd></div></dl>
    <form className="stack-form" onSubmit={e=>{e.preventDefault();void perform(async()=>{await api("assets/"+asset.id,{asset_group:group,tags},"PATCH");await refresh();close();});}}>
      <label>Grup<input list="alib-groups" value={group} onChange={e=>setGroup(e.target.value)} maxLength={80} placeholder="Mis. Intro, B-roll, Final"/></label>
      <datalist id="alib-groups">{groups.map(g=><option key={g} value={g}/>)}</datalist>
      <div className="alib-tag-edit"><span>Tag</span><div className="alib-tags">{tags.map(t=><button type="button" key={t} className="chip" onClick={()=>setTags(list=>list.filter(x=>x!==t))} aria-label={"Hapus tag "+t}>{t}<X size={10}/></button>)}</div>
        <div className="alib-tag-add"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addDraft();}}} placeholder="Tambah tag, pisahkan dengan koma" maxLength={200} aria-label="Tag baru"/><Button type="button" onClick={addDraft}>Tambah</Button></div></div>
      <div className="modal-actions"><Button type="button" onClick={close}>Batal</Button><Button type="submit" className="primary" busy={busy}>Simpan</Button></div></form></div></Modal>;
}
