"use client";
import {useEffect,useState} from "react";
import {Check,RefreshCw} from "lucide-react";
import type {ModelRoute} from "@studio/core";
import {api,Button,type Dashboard} from "./ui";
import type {Perform} from "./workspace-types";

type Provider="ninerouter"|"searxng"|"obscura";
type Connection={url:string;url_source:"app"|"server"|"none";has_key:boolean};
type Check={connected:boolean;message:string;models?:string[]};
const services:{id:Provider;name:string;note:string;placeholder:string;keyLabel:string}[]=[
  {id:"ninerouter",name:"9Router",note:"Model untuk riset, naskah, dan evaluasi.",placeholder:"http://alamat-server/v1",keyLabel:"API key"},
  {id:"searxng",name:"SearXNG",note:"Pencarian sumber untuk riset dan FYP.",placeholder:"http://alamat-server:8080",keyLabel:"API key (jika perlu)"},
  {id:"obscura",name:"Obscura",note:"Membaca halaman sumber lewat browser.",placeholder:"http://alamat-server/mcp",keyLabel:"API key (jika perlu)"}];

export function ConnectionSettings({data,busy,perform,refresh}:{data:Dashboard;busy:boolean;perform:Perform;refresh:()=>Promise<void>}){
  const [state,setState]=useState<Record<string,Connection>>();const [error,setError]=useState("");
  const load=()=>api<Record<string,Connection>>("settings/connections",undefined,"GET").then(setState).catch(e=>setError(e instanceof Error?e.message:"Koneksi belum dapat dimuat."));
  useEffect(()=>{void load();},[]);
  const [models,setModels]=useState<string[]>([]);
  useEffect(()=>{if(!state?.ninerouter?.url||!state.ninerouter.has_key)return;let live=true;api<Check>("settings/connections/check",{provider:"ninerouter"}).then(r=>{if(live&&r.models?.length)setModels(r.models);}).catch(()=>undefined);return()=>{live=false;};},[state?.ninerouter?.url,state?.ninerouter?.has_key]);
  return <div className="connection-settings">
    <p className="muted">Dipakai bersama oleh semua channel. Key disimpan terenkripsi di server dan tidak ditampilkan lagi.</p>
    {error&&<p role="alert" className="project-notice project-notice-error">{error}</p>}
    {!state?<p className="muted">Memuat…</p>:services.map(s=><ServiceForm key={s.id} service={s} current={state[s.id]} busy={busy} perform={perform} saved={next=>setState(next)} found={list=>{if(list.length)setModels(list);}}/>)}
    <ModelRoutes data={data} models={models} busy={busy} perform={perform} refresh={refresh}/>
  </div>;
}
function ServiceForm({service,current,busy,perform,saved,found}:{service:typeof services[number];current:Connection;busy:boolean;perform:Perform;saved:(next:Record<string,Connection>)=>void;found:(models:string[])=>void}){
  const [url,setUrl]=useState(current?.url||""),[key,setKey]=useState(""),[note,setNote]=useState(""),[result,setResult]=useState<Check>();
  const changed=url!==(current?.url||"")||!!key;
  const save=()=>perform(async()=>{const next=await api<Record<string,Connection>>("settings/connections",{provider:service.id,url,...(key?{key}:{})},"PUT");saved(next);setUrl(next[service.id]?.url||"");setKey("");setNote("Tersimpan.");setResult(undefined);});
  const check=()=>perform(async()=>{try{const r=await api<Check>("settings/connections/check",{provider:service.id});setResult(r);if(r.models)found(r.models);}catch(e){setResult({connected:false,message:e instanceof Error?e.message:"Koneksi gagal."});}});
  return <form className="settings-section stack-form" onSubmit={e=>{e.preventDefault();void save();}}>
    <div className="connection-head"><div><h2>{service.name}</h2><p className="muted">{service.note}</p></div><span className={"status status-"+(result?result.connected?"connected":"unreachable":current?.url?"configured":"not_configured")}><span className="status-dot"/>{result?result.connected?"Terhubung":"Tidak terhubung":current?.url?"Tersimpan":"Belum diisi"}</span></div>
    <div className="form-grid"><label>Alamat<input type="url" value={url} placeholder={service.placeholder} onChange={e=>{setUrl(e.target.value);setNote("");}}/></label>
    <label>{service.keyLabel}<input type="password" value={key} autoComplete="off" maxLength={2000} placeholder={current?.has_key?"Tersimpan · kosongkan jika tidak diubah":"Belum diisi"} onChange={e=>{setKey(e.target.value);setNote("");}}/></label></div>
    {current?.url_source==="server"&&!url.trim()||current?.url_source==="server"&&url===current.url?<p className="muted">Alamat ini berasal dari pengaturan server (.env). Isi alamat lain untuk menggantinya.</p>:null}
    {result&&<p role="status" className="muted">{result.message}</p>}
    <div className="form-actions">{note&&<span role="status"><Check size={14}/>{note}</span>}<Button type="button" busy={busy} disabled={changed} onClick={()=>void check()}><RefreshCw size={13}/>Cek koneksi</Button><Button className="primary" type="submit" busy={busy} disabled={!changed}>Simpan</Button></div>
  </form>;
}

const taskLabels:Record<string,string>={research:"Riset",script:"Naskah",hook:"Hook",diagnosis:"Evaluasi performa",storyboard:"Storyboard",composition:"Komposisi",upload_pack:"Paket unggah"};
function ModelRoutes({data,models,busy,perform,refresh}:{data:Dashboard;models:string[];busy:boolean;perform:Perform;refresh:()=>Promise<void>}){
  return <section className="settings-section model-routes"><div><h2>Model per tugas</h2><p className="muted">Pilih model dari 9Router untuk tiap tugas.{models.length?" "+models.length+" model tersedia.":" Hubungkan 9Router agar daftar model muncul; mengetik ID manual tetap bisa."} Tandai gratis hanya jika penyedia aslinya memang gratis.</p></div>
    <datalist id="route-models">{models.map(m=><option key={m} value={m}/>)}</datalist>
    <div className="route-list">{Object.keys(taskLabels).map(task=><RouteRow key={task+(data.routes.find(r=>r.task===task)?.id||"")} task={task} route={data.routes.find(r=>r.task===task)} busy={busy} perform={perform} refresh={refresh}/>)}</div></section>;
}
function RouteRow({task,route,busy,perform,refresh}:{task:string;route?:ModelRoute;busy:boolean;perform:Perform;refresh:()=>Promise<void>}){
  const [model,setModel]=useState(route?.model||""),[billing,setBilling]=useState<"free"|"paid">(route?.billing||"free"),[price,setPrice]=useState(String(route?.usd_per_1k_chars??0)),[tokens,setTokens]=useState(String(route?.max_output_tokens??4000)),[note,setNote]=useState("");
  const changed=model!==(route?.model||"")||billing!==(route?.billing||"free")||Number(price)!==(route?.usd_per_1k_chars??0)||Number(tokens)!==(route?.max_output_tokens??4000);
  const touch=<T,>(set:(v:T)=>void)=>(v:T)=>{set(v);setNote("");};
  return <form className="route-row" onSubmit={e=>{e.preventDefault();void perform(async()=>{await api("settings/models",{task,model:model.trim(),billing,usd_per_1k_chars:billing==="paid"?Number(price):0,max_output_tokens:Number(tokens)},"PUT");await refresh();setNote("Tersimpan.");});}}>
    <div className="route-task"><strong>{taskLabels[task]}</strong><span className={"route-state "+(route?"is-set":"")}>{route?(route.billing==="free"?"Gratis":"Berbayar"):"Belum dipilih"}</span></div>
    <input aria-label={"Model untuk "+taskLabels[task]} list="route-models" required maxLength={150} value={model} placeholder="Pilih atau ketik ID model" onChange={e=>touch(setModel)(e.target.value)}/>
    <select aria-label={"Biaya "+taskLabels[task]} value={billing} onChange={e=>touch(setBilling)(e.target.value as "free"|"paid")}><option value="free">Gratis</option><option value="paid">Berbayar</option></select>
    {billing==="paid"&&<label className="route-price">USD / 1.000 karakter<input type="number" min="0.000001" step="0.000001" required value={price} onChange={e=>touch(setPrice)(e.target.value)}/></label>}
    <label className="route-price">Token maks<input type="number" min="256" max="32000" required value={tokens} onChange={e=>touch(setTokens)(e.target.value)}/></label>
    <div className="route-actions">{note&&<span role="status"><Check size={13}/>{note}</span>}<Button className="primary" type="submit" busy={busy} disabled={!changed||!model.trim()}>Simpan</Button></div>
  </form>;
}
