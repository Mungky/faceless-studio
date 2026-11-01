"use client";
import {useEffect,useState} from "react";
import {Clapperboard,Compass,Images,LayoutGrid,LogOut,Menu,PanelLeftClose,PanelLeftOpen,RefreshCw,Settings,Sparkles,X} from "lucide-react";
import type {WorkspaceView} from "./workspace-types";

const items:{id:WorkspaceView;label:string;icon:typeof LayoutGrid}[]=[
  {id:"studio",label:"Studio",icon:Clapperboard},
  {id:"assets",label:"Library",icon:Images},
  {id:"foryou",label:"For You",icon:Compass}];

export function AppSidebar({view,go,workerOnline,busy,email,refresh,logout}:{view:WorkspaceView;go:(view:WorkspaceView)=>void;workerOnline:boolean;busy:boolean;email:string;refresh:()=>void;logout:()=>void}){
  const [collapsed,setCollapsed]=useState(false),[open,setOpen]=useState(false);
  useEffect(()=>{try{setCollapsed(localStorage.getItem("faceless:sidebar")==="collapsed");}catch{}},[]);
  const toggle=()=>{const next=!collapsed;setCollapsed(next);try{localStorage.setItem("faceless:sidebar",next?"collapsed":"open");}catch{}};
  const pick=(next:WorkspaceView)=>{setOpen(false);go(next);};
  const link=(id:WorkspaceView,label:string,Icon:typeof LayoutGrid)=><button key={id} className="sidebar-link" aria-current={view===id?"page":undefined} title={collapsed?label:undefined} onClick={()=>pick(id)}><Icon size={18}/><span>{label}</span></button>;
  return <>
    <header className="mobile-bar"><button className="icon-button" aria-label="Buka menu" onClick={()=>setOpen(true)}><Menu size={18}/></button><span className="sidebar-brand-text"><img src="/logo.svg" alt="" width={20} height={20}/>Restard Studio</span></header>
    {open&&<button className="sidebar-scrim" aria-label="Tutup menu" onClick={()=>setOpen(false)}/>}
    <aside className={"app-sidebar"+(collapsed?" is-collapsed":"")+(open?" is-open":"")}>
      <div className="sidebar-head"><button className="sidebar-brand" onClick={()=>pick("studio")}><img src="/logo.svg" alt="" width={22} height={22}/><span>Restard Studio</span></button><button className="icon-button sidebar-close" aria-label="Tutup menu" onClick={()=>setOpen(false)}><X size={16}/></button></div>
      <nav aria-label="Navigasi utama">{items.map(i=>link(i.id,i.label,i.icon))}</nav>
      <div className="sidebar-foot">
        {link("settings","Pengaturan",Settings)}
        <span className="worker-indicator" title={workerOnline?"PC render online":"PC render offline"}><i className={workerOnline?"online":""}/><span>{workerOnline?"PC render online":"PC render offline"}</span></span>
        <div className="sidebar-actions"><button className="icon-button" aria-label="Muat ulang data" title="Muat ulang data" disabled={busy} onClick={refresh}><RefreshCw size={15}/></button><button className="icon-button" aria-label="Keluar" title={"Keluar · "+email} disabled={busy} onClick={logout}><LogOut size={15}/></button><button className="icon-button sidebar-collapse" aria-label={collapsed?"Lebarkan menu":"Ciutkan menu"} title={collapsed?"Lebarkan menu":"Ciutkan menu"} onClick={toggle}>{collapsed?<PanelLeftOpen size={15}/>:<PanelLeftClose size={15}/>}</button></div>
      </div>
    </aside>
  </>;
}
