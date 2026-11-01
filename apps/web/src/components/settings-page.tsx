"use client";
import {useState} from "react";
import {ModelSettings,ServiceSettings} from "./connection-settings";
import {ServiceStatus,SpendingPanel,StorageInfo,YoutubeConnections} from "./settings";
import type {Dashboard} from "./ui";
import type {Perform} from "./workspace-types";

const tabs=[{id:"services",label:"Layanan"},{id:"models",label:"Model AI"},{id:"accounts",label:"Akun YouTube"},{id:"spending",label:"Biaya"},{id:"storage",label:"Penyimpanan"}] as const;
type Tab=typeof tabs[number]["id"];

// The one place for workspace-wide settings; per-channel options stay in the channel's own tab.
export function SettingsPage({data,busy,perform,refresh,tab}:{data:Dashboard;busy:boolean;perform:Perform;refresh:()=>Promise<void>;tab?:string}){
  const [active,setActive]=useState<Tab>(tabs.some(t=>t.id===tab)?tab as Tab:"services");
  return <div className="settings-page">
    <header className="page-heading"><div><span className="eyebrow">WORKSPACE</span><h1>Pengaturan</h1><p>Koneksi, model, dan biaya yang dipakai semua channel.</p></div></header>
    <nav className="channel-tabs" aria-label="Bagian pengaturan">{tabs.map(t=><button key={t.id} aria-current={active===t.id?"page":undefined} onClick={()=>setActive(t.id)}>{t.label}</button>)}</nav>
    <div className="settings-body">
      {active==="services"&&<><ServiceSettings busy={busy} perform={perform}/><ServiceStatus data={data} busy={busy} run={perform}/></>}
      {active==="models"&&<ModelSettings data={data} busy={busy} perform={perform} refresh={refresh}/>}
      {active==="accounts"&&<YoutubeConnections channels={data.channels} data={data}/>}
      {active==="spending"&&<SpendingPanel data={data} busy={busy} run={perform} refresh={refresh}/>}
      {active==="storage"&&<StorageInfo data={data}/>}
    </div>
  </div>;
}
