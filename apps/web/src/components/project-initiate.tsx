"use client";
import {useState} from "react";
import {ArrowRight,FilePlus2,FileText,GitBranch,Link2,Plus,Sparkles,Trash2,Upload,X} from "lucide-react";
import {defaultWorkflowGraph,workflowNodeInfo,type ChannelPreferences,type WorkflowGraph,type WorkflowRun,type WorkflowTemplate} from "@studio/core";
import {api,Button,Modal} from "./ui";
import {projectName,projectPrefs} from "./project-model";
import type {ProjectProps} from "./project-studio";

const blank="blank";
// "Mulai kosong" really is short: brief, script and visual plan. Everything else is added later
// from the canvas (Add node) or by asking the agent.
function blankGraph():WorkflowGraph{
  const kinds=["brief","script","storyboard"] as const;
  return {nodes:kinds.map((kind,i)=>({id:kind,kind,title:workflowNodeInfo[kind].label,instructions:"",position:{x:i*290,y:0},review:kind!=="brief"})),edges:[{id:"brief-script",source:"brief",target:"script"},{id:"script-storyboard",source:"script",target:"storyboard"}]};
}
// A channel or profile page has no single video to study; the analysis needs a video link.
export const isChannelLink=(url:string)=>/youtube\.com\/(@[^/]+|channel\/|c\/|user\/)[^?]*$|youtube\.com\/@[^/]+\/(shorts|videos)\/?$|tiktok\.com\/@[^/]+\/?$|instagram\.com\/[^/]+\/?$/i.test(url.trim());
// Picks a reference type from its link so the agent knows whether to watch, read or look at it.
function referenceType(url:string){if(/youtu\.?be|tiktok|instagram\.com\/reel|vimeo|\.mp4($|\?)/i.test(url))return "video" as const;if(/\.(png|jpe?g|webp|gif)($|\?)/i.test(url))return "image" as const;return "link" as const;}
// The node the owner's first reference feeds: research, else the script, else the first stage.
function withReference(graph:WorkflowGraph,url:string):WorkflowGraph{
  const target=graph.nodes.find(n=>n.kind==="research")||graph.nodes.find(n=>n.kind==="script")||graph.nodes.find(n=>n.kind!=="brief");if(!target)return graph;
  const id="reference-"+crypto.randomUUID().slice(0,8),name=url.replace(/^https?:\/\/(www\.)?/,"").slice(0,80);
  return {...graph,nodes:[...graph.nodes,{id,kind:"reference",title:"Referensi",instructions:"Tiru gaya, struktur dan ritme referensi ini, bukan isinya.",position:{x:target.position.x-40,y:target.position.y-200},review:false,reference:{type:referenceType(url),name,url,content:""}}],edges:[...graph.edges,{id:"edge-"+crypto.randomUUID(),source:id,target:target.id}]};
}

// Initiate: the one-time setup of a project. Pick a template (or start blank), describe what you
// want to the agent, optionally add a reference video or your own script, then continue.
export function ProjectInitiate(props:ProjectProps){
  const {project,data,workspace,busy,perform,refresh,navigate}=props;
  const channel=data.channels.find(c=>c.id===project)!,prefs=projectPrefs(workspace,project),name=projectName(channel,prefs);
  const owners=new Map(workspace.preferences.filter(p=>p.default_template_id).map(p=>[p.default_template_id,p.channel]));
  const ownerName=(t:WorkflowTemplate)=>{const id=owners.get(t.id)||(t.builtin?t.channel:"");const c=data.channels.find(c=>c.id===id);return c?projectName(c,projectPrefs(workspace,c.id)):"";};
  const [selected,setSelected]=useState(blank),[text,setText]=useState(""),[reference,setReference]=useState(""),[refOpen,setRefOpen]=useState(false),[script,setScript]=useState<{name:string;content:string}|null>(null),[creating,setCreating]=useState(false),[error,setError]=useState("");
  const templates=[...workspace.templates].sort((a,b)=>Number(!!ownerName(a))-Number(!!ownerName(b))||a.name.localeCompare(b.name));
  const removable=(t:WorkflowTemplate)=>!t.builtin&&!owners.has(t.id)&&!workspace.runs.some(r=>r.template_id===t.id&&!r.closed&&r.status!=="completed");

  const start=()=>void perform(async()=>{
    setError("");
    const source=workspace.templates.find(t=>t.id===selected);
    let graph=source?structuredClone(source.graph):blankGraph();
    if(reference.trim())graph=withReference(graph,reference.trim());
    const created=await api<WorkflowTemplate>("workflows",{name,channel:project,description:source?"Dari template "+source.name:"Workflow "+name,playbook_path:source?.playbook_path||"",instructions:source?.instructions||text.trim()||"",graph:{...graph,viewport:undefined}});
    await api<ChannelPreferences>("workspace/channels/"+project,{...prefs,default_template_id:created.id},"PUT");
    if(script)await api<{run:WorkflowRun}>("workspace/episodes",{channel:project,template:created.id,entry_mode:"script",title:script.name.replace(/\.(md|txt)$/i,"").slice(0,120),content:script.content});
    await refresh();navigate("workflow");
  });

  return <div className="pi-page">
    <div className="pi-glow" aria-hidden="true"/>
    <section className="pi-hero">
      <span className="pi-badge"><Sparkles size={13}/>Initiate · {name}</span>
      <h1>Siapkan workflow<br/>project ini</h1>
      <p>Pilih template, atau mulai kosong. Tambahkan referensi video atau naskah untuk memulai automasi.</p>
      <div className="pi-templates" role="radiogroup" aria-label="Template">
        <button type="button" role="radio" aria-checked={selected===blank} className={"pi-template is-blank"+(selected===blank?" is-selected":"")} onClick={()=>setSelected(blank)}><FilePlus2 size={20}/><strong>Mulai kosong</strong><small>Brief → naskah → visual plan. Tambah langkah lain langsung lewat canvas n8n.</small></button>
        {templates.map(t=>{const owner=ownerName(t);return <div key={t.id} className={"pi-template"+(selected===t.id?" is-selected":"")}>
          <button type="button" role="radio" aria-checked={selected===t.id} className="pi-template-pick" onClick={()=>setSelected(t.id)}><GitBranch size={18}/><strong>{t.name}</strong><small>{t.graph.nodes.filter(n=>n.kind!=="reference").length} tahap{owner?" · workflow project "+owner:t.builtin?" · bawaan":""}</small></button>
          {removable(t)&&<button type="button" className="pi-template-remove icon-button" aria-label={"Hapus template "+t.name} title="Hapus template" onClick={()=>void perform(async()=>{if(!window.confirm("Hapus template "+t.name+"?"))return;await api("workflows/"+encodeURIComponent(t.id),{},"DELETE");if(selected===t.id)setSelected(blank);await refresh();})}><Trash2 size={13}/></button>}
        </div>;})}
        <button type="button" className="pi-template is-add" onClick={()=>{setError("");setCreating(true);}}><Plus size={20}/><strong>Template baru</strong><small>Simpan susunan langkah untuk dipakai project lain.</small></button>
      </div>
      <form className="pi-box" onSubmit={e=>{e.preventDefault();start();}}>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={3} maxLength={20000} placeholder="Catatan instruksi project: niche, gaya, acuan visual, atau arahan konten…" aria-label="Instruksi project" onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();start();}}}/>
        <div className="pi-box-row">
          <div className="pi-chips">
            {refOpen||reference?<span className="pi-chip is-input"><Link2 size={13}/><input autoFocus={refOpen} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Tempel link video / gambar referensi" aria-label="Link referensi" type="url"/><button type="button" aria-label="Hapus referensi" onClick={()=>{setReference("");setRefOpen(false);}}><X size={12}/></button></span>
              :<button type="button" className="pi-chip" onClick={()=>setRefOpen(true)}><Link2 size={13}/>Reference</button>}
            {script?<span className="pi-chip is-file"><FileText size={13}/>{script.name}<button type="button" aria-label="Hapus naskah" onClick={()=>setScript(null)}><X size={12}/></button></span>
              :<label className="pi-chip"><Upload size={13}/>Upload script<input type="file" hidden accept=".txt,.md,text/plain,text/markdown" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.size>100_000){setError("Naskah maksimal 100 KB.");return;}void file.text().then(content=>setScript({name:file.name,content}));}}/></label>}
          </div>
          <Button type="submit" className="primary pi-next" busy={busy}>Lanjut<ArrowRight size={15}/></Button>
        </div>
      </form>
      {isChannelLink(reference)&&<p className="pi-warn">Ini link channel. Untuk dianalisis di workflow, tempel link satu video (mis. youtube.com/shorts/…). Link channel tetap disimpan sebagai referensi.</p>}
      {error&&<p className="danger-text" role="alert">{error}</p>}
      <p className="pi-note">Initiate hanya sekali. Setelah ini workflow dapat langsung dirancang dan dikelola di canvas n8n.</p>
    </section>
    {creating&&<Modal title="Template baru" close={()=>{if(!busy)setCreating(false);}}><form className="stack-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(async()=>{setError("");try{const created=await api<WorkflowTemplate>("workflows",{name:String(f.get("name")),channel:project,description:String(f.get("description")||""),playbook_path:"",instructions:String(f.get("instructions")||""),graph:defaultWorkflowGraph()});await refresh();setSelected(created.id);setCreating(false);}catch(cause){setError((cause as Error).message);}});}}>
      <label>Nama template<input name="name" required maxLength={120} autoFocus disabled={busy}/></label>
      <label>Deskripsi<input name="description" maxLength={500} disabled={busy}/></label>
      <label>Instruksi bersama<textarea name="instructions" rows={4} maxLength={20000} placeholder="Gaya bahasa, durasi, aturan visual…" disabled={busy}/></label>
      <p className="muted">Template dimulai dari susunan standar. Langkahnya bisa diubah di canvas setelah dipakai.</p>
      {error&&<p className="danger-text" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" disabled={busy} onClick={()=>setCreating(false)}>Batal</Button><Button type="submit" className="primary" busy={busy}>Simpan template</Button></div>
    </form></Modal>}
  </div>;
}
