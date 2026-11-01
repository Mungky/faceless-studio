"use client";
import {useMemo,useRef,useState} from "react";
import {ArrowUp,AudioLines,ChevronDown,ChevronRight,Film,FolderPlus,Image as ImageIcon,Layers,LayoutGrid,Music,Pause,Play,RotateCcw,Search,Tag,Trash2,Upload,Waves,X} from "lucide-react";
import {assetCategories,assetTitle,filterAssets,type LibraryAsset} from "@studio/core";
import {api,Button,Empty,Modal,date,type Dashboard} from "./ui";
import type {Perform} from "./workspace-types";

const kindLabel:Record<string,string>={image:"Gambar",video:"Video",vo:"VO",sfx:"SFX",bgm:"BGM",music:"Musik",render:"Render",thumb:"Thumbnail"};
const kindIcon=(kind:string,size=16)=>kind==="image"||kind==="thumb"?<ImageIcon size={size}/>:kind==="video"||kind==="render"?<Film size={size}/>:kind==="vo"?<AudioLines size={size}/>:kind==="sfx"?<Waves size={size}/>:kind==="bgm"||kind==="music"?<Music size={size}/>:<Layers size={size}/>;
const categoryIcon:Record<string,typeof ImageIcon>={image:ImageIcon,video:Film,vo:AudioLines,music:Music,sfx:Waves};
const media=(path:string)=>/\.(jpe?g|png|webp)$/i.test(path)?"image":/\.(mp4|webm)$/i.test(path)?"video":/\.(mp3|wav|m4a|flac)$/i.test(path)?"audio":"";
const splitTags=(value:string)=>value.split(",").map(tag=>tag.trim()).filter(Boolean);
const preview=(id:string)=>"/api/assets/"+id+"/preview";
const noProject="Tanpa project";

type Scope={category:string;project?:string;group?:string;trash?:boolean};

// Google Flow-style library: media types and projects on the left, a resizable media grid on the right.
export function AssetsLibrary({data,busy,perform,refresh,create}:{data:Dashboard;busy:boolean;perform:Perform;refresh:()=>Promise<void>;create?:(prompt:string)=>void}){
  const [scope,setScope]=useState<Scope>({category:"all"}),[search,setSearch]=useState(""),[size,setSize]=useState(()=>{try{return Number(localStorage.getItem("faceless:asset-size"))||240;}catch{return 240;}});
  const [picked,setPicked]=useState<string[]>([]),[open,setOpen]=useState(""),[expanded,setExpanded]=useState<string[]>([]),[extraProjects,setExtraProjects]=useState<string[]>([]),[prompt,setPrompt]=useState(""),[moving,setMoving]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const channels=useMemo(()=>new Map(data.channels.map(c=>[c.id,c])),[data.channels]),episodes=useMemo(()=>new Map(data.episodes.map(e=>[e.id,e])),[data.episodes]);
  // Episode assets start in their channel's project; the owner can move them anywhere.
  const all=useMemo<LibraryAsset[]>(()=>data.assets.map(a=>{const channel=episodes.get(a.episode)?.channel||"";return {id:a.id,kind:a.kind,episode:a.episode,channel,drive_path:a.drive_path,asset_group:a.asset_group||"",tags:a.tags||[],created:a.created,project:a.project||channels.get(channel)?.name||noProject,title:a.title,deleted:!!a.deleted};}),[data.assets,episodes,channels]);
  const live=useMemo(()=>all.filter(a=>!a.deleted),[all]);
  const projects=useMemo(()=>[...new Set([...live.map(a=>a.project!),...extraProjects])].sort((a,b)=>(a===noProject?1:0)-(b===noProject?1:0)||a.localeCompare(b)),[live,extraProjects]);
  const groupsOf=(project:string)=>[...new Set(live.filter(a=>a.project===project&&a.asset_group).map(a=>a.asset_group))].sort();
  const kinds=assetCategories.find(c=>c.id===scope.category)?.kinds;
  const visible=useMemo(()=>filterAssets(all,{search,kinds,project:scope.project,group:scope.group,trash:!!scope.trash}).sort((a,b)=>b.created.localeCompare(a.created)),[all,search,kinds,scope]);
  const byId=useMemo(()=>new Map(data.assets.map(a=>[a.id,a])),[data.assets]),current=open?byId.get(open):undefined;
  const toggle=(id:string)=>setPicked(list=>list.includes(id)?list.filter(x=>x!==id):[...list,id]);
  const organize=(body:Record<string,unknown>)=>perform(async()=>{await api("assets/organize",{ids:picked,...body});await refresh();setPicked([]);setMoving(false);});
  const pick=(next:Scope)=>{setScope(next);setPicked([]);};
  const resize=(value:number)=>{setSize(value);try{localStorage.setItem("faceless:asset-size",String(value));}catch{}};
  const upload=(files:FileList)=>void perform(async()=>{for(const file of Array.from(files)){const type=media(file.name);if(!type)throw new Error(file.name+": format belum didukung.");const kind=type==="image"?"image":type==="video"?"video":["vo","music","sfx"].includes(scope.category)?scope.category:"music";const form=new FormData();form.set("file",file);form.set("kind",kind);if(scope.project&&scope.project!==noProject)form.set("project",scope.project);await api("assets/upload",form);}await refresh();});
  const heading=scope.trash?"Sampah":scope.group?scope.group:scope.project||assetCategories.find(c=>c.id===scope.category)?.label||"Semua media";
  const projectTiles=scope.category==="all"&&!scope.project&&!scope.trash&&!search;
  return <div className="flow-assets" style={{"--tile":size+"px"} as React.CSSProperties}>
    <aside className="flow-side" aria-label="Pustaka asset">
      <nav>
        <button className="flow-side-link" aria-current={scope.category==="all"&&!scope.project&&!scope.trash?"page":undefined} onClick={()=>pick({category:"all"})}><LayoutGrid size={17}/>Semua media</button>
        {assetCategories.map(c=>{const Icon=categoryIcon[c.id];return <button key={c.id} className="flow-side-link" aria-current={scope.category===c.id&&!scope.project&&!scope.trash?"page":undefined} onClick={()=>pick({category:c.id})}><Icon size={17}/>{c.label}<small>{live.filter(a=>(c.kinds as readonly string[]).includes(a.kind)).length||""}</small></button>;})}
        <button className="flow-side-link" onClick={()=>fileRef.current?.click()}><Upload size={17}/>Upload</button>
        <input ref={fileRef} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mp3,.wav,.m4a,.flac" onChange={e=>{if(e.target.files?.length)upload(e.target.files);e.target.value="";}}/>
      </nav>
      <div className="flow-side-section"><span>Koleksi</span><button className="icon-button" aria-label="Project baru" title="Project baru" onClick={()=>{const name=window.prompt("Nama project baru")?.trim().slice(0,120);if(name){setExtraProjects(list=>[...new Set([...list,name])]);pick({category:"all",project:name});}}}><FolderPlus size={15}/></button></div>
      <div className="flow-projects">{projects.map(project=>{const groups=groupsOf(project),isOpen=expanded.includes(project),cover=live.find(a=>a.project===project&&media(a.drive_path)==="image");return <div key={project}>
        <div className="flow-project-row"><button className="flow-side-link" aria-current={scope.project===project&&!scope.group?"page":undefined} onClick={()=>pick({category:"all",project})}><span className="flow-project-cover">{cover?<img src={preview(cover.id)} alt="" loading="lazy"/>:project.slice(0,1)}</span><span className="flow-project-name">{project}</span></button>{groups.length>0&&<button className="icon-button" aria-label={(isOpen?"Tutup ":"Buka ")+"grup "+project} onClick={()=>setExpanded(list=>isOpen?list.filter(x=>x!==project):[...list,project])}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}</div>
        {isOpen&&groups.map(group=><button key={group} className="flow-side-link flow-group-link" aria-current={scope.project===project&&scope.group===group?"page":undefined} onClick={()=>pick({category:"all",project,group})}>{group}</button>)}
      </div>;})}{!projects.length&&<p className="muted flow-side-empty">Project muncul setelah asset dibuat atau diunggah.</p>}</div>
      <button className="flow-side-link flow-trash" aria-current={scope.trash?"page":undefined} onClick={()=>pick({category:"all",trash:true})}><Trash2 size={17}/>Sampah<small>{all.length-live.length||""}</small></button>
    </aside>
    <section className="flow-main">
      <header className="flow-top"><div><h1>{heading}</h1><span className="muted">{visible.length} asset</span></div>
        <label className="flow-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari judul, grup, atau tag" aria-label="Cari asset"/></label>
        <label className="flow-size" title="Ukuran grid"><LayoutGrid size={14}/><input type="range" min={150} max={420} step={10} value={size} onChange={e=>resize(Number(e.target.value))} aria-label="Ukuran grid"/></label>
        <Button className="primary" onClick={()=>fileRef.current?.click()} busy={busy}><Upload size={14}/>Upload</Button>
      </header>
      {picked.length>0&&<div className="flow-bulk" role="region" aria-label="Aksi untuk asset terpilih"><strong>{picked.length} dipilih</strong>
        {scope.trash?<Button onClick={()=>void organize({deleted:false})} busy={busy}><RotateCcw size={14}/>Pulihkan</Button>:<><Button onClick={()=>setMoving(true)}><FolderPlus size={14}/>Pindahkan</Button><BulkTag busy={busy} apply={add=>void organize({add_tags:add})}/><Button onClick={()=>void organize({deleted:true})} busy={busy}><Trash2 size={14}/>Buang</Button></>}
        <button className="icon-button" aria-label="Batal pilih" onClick={()=>setPicked([])}><X size={15}/></button></div>}
      {projectTiles&&projects.length>0&&<div className="flow-grid flow-collections">{projects.map(project=>{const items=live.filter(a=>a.project===project),cover=items.find(a=>media(a.drive_path)==="image");return <button key={project} className="flow-card flow-collection" onClick={()=>pick({category:"all",project})}>{cover?<img src={preview(cover.id)} alt="" loading="lazy"/>:<span className="flow-card-blank"><Layers size={26}/></span>}<span className="flow-card-label"><strong>{project}</strong><small><ImageIcon size={12}/>{items.filter(a=>["image","thumb"].includes(a.kind)).length} <Film size={12}/>{items.filter(a=>["video","render"].includes(a.kind)).length} <Music size={12}/>{items.filter(a=>["vo","music","bgm","sfx"].includes(a.kind)).length}</small></span></button>;})}</div>}
      {all.length===0?<Empty title="Belum ada asset" icon={<Layers size={27}/>} action={<Button className="primary" onClick={()=>fileRef.current?.click()}><Upload size={14}/>Upload media</Button>}>Gambar, video, VO, musik, dan SFX dari produksi akan muncul di sini. Kamu juga bisa mengunggah sendiri.</Empty>
        :visible.length===0?<Empty title={scope.trash?"Sampah kosong":"Tidak ada asset di sini"} icon={<Search size={27}/>}>{scope.trash?"Asset yang dibuang bisa dipulihkan dari sini.":"Ubah pencarian atau pilih koleksi lain."}</Empty>
        :<ul className="flow-grid">{visible.map(asset=><AssetCard key={asset.id} asset={asset} picked={picked.includes(asset.id)} selecting={picked.length>0} toggle={()=>toggle(asset.id)} open={()=>setOpen(asset.id)}/>)}</ul>}
      {create&&<form className="flow-prompt" onSubmit={e=>{e.preventDefault();if(prompt.trim()){create(prompt.trim());setPrompt("");}}}><input value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Apa yang ingin kamu buat?" aria-label="Minta Studio membuat sesuatu" maxLength={4000}/><button className="flow-prompt-send" aria-label="Kirim ke Studio" disabled={!prompt.trim()}><ArrowUp size={16}/></button></form>}
    </section>
    {moving&&<MoveDialog projects={projects.filter(p=>p!==noProject)} groupsOf={groupsOf} busy={busy} close={()=>setMoving(false)} apply={(project,group)=>void organize({project,asset_group:group})}/>}
    {current&&<AssetDetail key={current.id} asset={current} project={all.find(a=>a.id===current.id)?.project||noProject} episode={episodes.get(current.episode)?.title||""} busy={busy} perform={perform} refresh={refresh} close={()=>setOpen("")}/>}
  </div>;
}

function AssetCard({asset,picked,selecting,toggle,open}:{asset:LibraryAsset;picked:boolean;selecting:boolean;toggle:()=>void;open:()=>void}){
  const type=media(asset.drive_path),video=useRef<HTMLVideoElement>(null),audio=useRef<HTMLAudioElement>(null),[playing,setPlaying]=useState(false),title=assetTitle(asset);
  return <li className={"flow-card"+(picked?" picked":"")+(type==="audio"?" flow-card-audio":"")} onMouseEnter={()=>{void video.current?.play().catch(()=>undefined);}} onMouseLeave={()=>{video.current?.pause();}}>
    <button className="flow-card-open" onClick={selecting?toggle:open} aria-label={(selecting?"Pilih ":"Buka ")+title}>
      {type==="image"?<img src={preview(asset.id)} alt="" loading="lazy"/>:type==="video"?<video ref={video} src={preview(asset.id)} muted loop playsInline preload="none"/>:<span className="flow-card-blank">{kindIcon(asset.kind,30)}</span>}
    </button>
    {type==="audio"&&<><audio ref={audio} src={preview(asset.id)} preload="none" onEnded={()=>setPlaying(false)}/><button className="flow-card-play" aria-label={(playing?"Jeda ":"Putar ")+title} onClick={()=>{const el=audio.current;if(!el)return;if(playing){el.pause();setPlaying(false);}else{void el.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false));}}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button></>}
    <label className="flow-card-check"><input type="checkbox" checked={picked} onChange={toggle} aria-label={"Pilih "+title}/></label>
    <span className="flow-card-label">{kindIcon(asset.kind,13)}<strong title={title}>{title}</strong></span>
  </li>;
}

function BulkTag({busy,apply}:{busy:boolean;apply:(tags:string[])=>void}){
  const [value,setValue]=useState("");
  return <form onSubmit={e=>{e.preventDefault();const tags=splitTags(value);if(tags.length){apply(tags);setValue("");}}}><input value={value} onChange={e=>setValue(e.target.value)} placeholder="tag, tag" aria-label="Tambah tag"/><Button type="submit" busy={busy} disabled={!value.trim()}><Tag size={13}/>Tag</Button></form>;
}

function MoveDialog({projects,groupsOf,busy,close,apply}:{projects:string[];groupsOf:(project:string)=>string[];busy:boolean;close:()=>void;apply:(project:string,group:string)=>void}){
  const [project,setProject]=useState(projects[0]||""),[group,setGroup]=useState("");
  return <Modal title="Pindahkan asset" close={close}><form className="stack-form" onSubmit={e=>{e.preventDefault();if(project.trim())apply(project.trim(),group.trim());}}>
    <label>Project<input list="flow-projects" value={project} onChange={e=>setProject(e.target.value)} maxLength={120} required placeholder="Nama project"/></label><datalist id="flow-projects">{projects.map(p=><option key={p} value={p}/>)}</datalist>
    <label>Grup (opsional)<input list="flow-groups" value={group} onChange={e=>setGroup(e.target.value)} maxLength={80} placeholder="Mis. Intro, B-roll, Final"/></label><datalist id="flow-groups">{groupsOf(project).map(g=><option key={g} value={g}/>)}</datalist>
    <div className="modal-actions"><Button type="button" onClick={close}>Batal</Button><Button type="submit" className="primary" busy={busy}>Pindahkan</Button></div></form></Modal>;
}

function AssetDetail({asset,project,episode,busy,perform,refresh,close}:{asset:Dashboard["assets"][number];project:string;episode:string;busy:boolean;perform:Perform;refresh:()=>Promise<void>;close:()=>void}){
  const [title,setTitle]=useState(assetTitle(asset)),[group,setGroup]=useState(asset.asset_group||""),[tags,setTags]=useState<string[]>(asset.tags||[]),[draft,setDraft]=useState("");
  const url=preview(asset.id),type=media(asset.drive_path),addDraft=()=>{const next=splitTags(draft);if(next.length){setTags(list=>[...new Set([...list,...next.map(t=>t.toLowerCase())])].slice(0,12));setDraft("");}};
  return <Modal title={assetTitle(asset)} close={close} wide><div className="alib-detail">
    <div className="alib-preview">{type==="image"?<img src={url} alt={title}/>:type==="video"?<video src={url} controls preload="metadata"/>:type==="audio"?<audio src={url} controls preload="metadata"/>:<div className="alib-preview-empty">{kindIcon(asset.kind,28)}<p className="muted">Jenis file ini tidak punya pratinjau.</p></div>}</div>
    <dl className="alib-meta"><div><dt>Project</dt><dd>{project}</dd></div>{episode&&<div><dt>Task</dt><dd>{episode}</dd></div>}{episode&&<div><dt>Kartu</dt><dd>{asset.kind==="vo"?"Voiceover":asset.kind==="render"?"Render":["image","video","thumb"].includes(asset.kind)?"Media":kindLabel[asset.kind]||asset.kind}</dd></div>}<div><dt>Jenis</dt><dd>{kindLabel[asset.kind]||asset.kind}</dd></div><div><dt>Sumber</dt><dd>{asset.source}</dd></div><div><dt>Dibuat</dt><dd>{date(asset.created)}</dd></div><div><dt>Lokasi</dt><dd className="alib-path">{asset.drive_file_id==="local"?"Server · ":"Drive · "}{asset.drive_path}</dd></div></dl>
    <form className="stack-form" onSubmit={e=>{e.preventDefault();void perform(async()=>{await api("assets/"+asset.id,{title,asset_group:group,tags},"PATCH");await refresh();close();});}}>
      <label>Judul<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={200}/></label>
      <label>Grup<input value={group} onChange={e=>setGroup(e.target.value)} maxLength={80} placeholder="Mis. Intro, B-roll, Final"/></label>
      <div className="alib-tag-edit"><span>Tag</span><div className="alib-tags">{tags.map(t=><button type="button" key={t} className="chip" onClick={()=>setTags(list=>list.filter(x=>x!==t))} aria-label={"Hapus tag "+t}>{t}<X size={10}/></button>)}</div>
        <div className="alib-tag-add"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addDraft();}}} placeholder="Tambah tag, pisahkan dengan koma" maxLength={200} aria-label="Tag baru"/><Button type="button" onClick={addDraft}>Tambah</Button></div></div>
      <div className="modal-actions">{!asset.deleted&&<Button type="button" busy={busy} onClick={()=>void perform(async()=>{await api("assets/"+asset.id,{deleted:true},"PATCH");await refresh();close();})}><Trash2 size={14}/>Buang</Button>}<Button type="button" onClick={close}>Batal</Button><Button type="submit" className="primary" busy={busy}>Simpan</Button></div></form></div></Modal>;
}
