"use client";

import { useState } from "react";
import { ArrowRight, RefreshCw, Plus } from "lucide-react";
import type { Channel } from "@studio/core";
import { api, Button, Modal, Status, date, number, workerOnline, type Dashboard } from "./ui";

type ProjectsProps = {
  data: Dashboard;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  openProject: (id: string) => void;
  openSettings: () => void;
};

export function Projects({ data, busy, run, refresh, openProject, openSettings }: ProjectsProps) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [adding,setAdding]=useState(false),[createError,setCreateError]=useState("");
  const order = (channel: Channel) => {
    const name = channel.name.toLowerCase().replace(/[^a-z]/g, "");
    return name.includes("arthur") ? 0 : name.includes("notyet") ? 1 : name.includes("exhibit") ? 2 : 3;
  };
  const channels = [...data.channels].sort((a, b) => order(a) - order(b));

  async function syncProfiles() {
    await run(async () => {
      setSyncing(true);
      setError("");
      try {
        const result = await api<{ results?: { channel?: string; error?: string }[] }>("projects/sync", {});
        await refresh();
        const errors = result.results?.flatMap(item => item.error ? [`${item.channel ? `${item.channel}: ` : ""}${item.error}`] : []) || [];
        if (errors.length) setError(errors.join(" · "));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Channel profiles could not be refreshed. Try again.");
      } finally {
        setSyncing(false);
      }
    });
  }

  return <div className="projects-page">
    <div className="page-heading">
      <div><span className="eyebrow">WORKSPACE</span><h1>Channel</h1><p>Semua channel. Setiap cerita, hasil, dan langkah berikutnya.</p></div>
      <div className="heading-actions"><Button busy={syncing} disabled={busy} onClick={() => void syncProfiles()}><RefreshCw size={14} />{syncing ? "Refreshing profiles…" : "Refresh profiles"}</Button></div>
    </div>
    {error && <div className="project-notice project-notice-error" role="alert"><p>{error}</p><span>Saved channel details remain available. Refresh profiles to try again.</span></div>}
    <Readiness data={data} open={openSettings} />
    <div className="project-cards">
      {channels.map(channel => <ProjectCard key={channel.id} channel={channel} open={() => openProject(channel.id)} />)}
      <button type="button" className="project-card project-add-card" onClick={()=>{setCreateError("");setAdding(true);}}><Plus size={30} strokeWidth={1.3}/><h2>Add channel</h2><p>Create a project and connect your YouTube channel.</p></button>
    </div>
    {!channels.length && <p className="project-empty-copy">No channel projects are configured in this workspace.</p>}
    <p className="projects-footnote">Profiles come from YouTube. Open a project for channel analytics and its upload calendar.</p>
    {adding&&<Modal title="Add channel" close={()=>{if(!busy)setAdding(false);}}><p className="muted">Create a channel project, then connect its YouTube account. Existing channel connections stay with their projects.</p><form className="stack-form" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);void run(async()=>{setCreateError("");try{const created=await api<Channel>("channels",{name:values.get("name"),playbook_path:values.get("playbook")||""});await refresh();setAdding(false);openProject(created.id);}catch(cause){setCreateError(cause instanceof Error?cause.message:"The project could not be created. Try again.");}});}}><label>Channel name<input name="name" autoFocus required maxLength={80} placeholder="Your channel name" disabled={busy}/></label><details className="project-playbook-option"><summary>Use an existing channel playbook</summary><label>Playbook path<input name="playbook" placeholder="My Channel/My Channel.md" disabled={busy}/><span className="muted">Optional Markdown file inside your vault. Leave blank to use the production brief.</span></label></details>{createError&&<p className="danger-text" role="alert">{createError}</p>}<div className="modal-actions"><Button type="button" disabled={busy} onClick={()=>setAdding(false)}>Cancel</Button><Button type="submit" className="primary" busy={busy}>Create project<ArrowRight size={14}/></Button></div></form></Modal>}
  </div>;
}

// Production silently stalls without these; surface them before anyone presses "Lanjut".
function Readiness({ data, open }: { data: Dashboard; open: () => void }) {
  const routed = (task: string) => data.routes.some(route => route.task === task);
  const items = [
    { label: "Model riset & naskah", ok: routed("research") && routed("script"), hint: "Pilih model di Pengaturan" },
    { label: "PC render", ok: data.workers.some(workerOnline), hint: "Jalankan npm run worker di PC" },
    { label: "Voice-over", ok: data.configuration.elevenlabs, hint: "Isi ELEVENLABS_API_KEY" },
    { label: "Penyimpanan Drive", ok: data.configuration.drive, hint: "Atur rclone remote" },
  ];
  const missing = items.filter(item => !item.ok);
  if (!missing.length) return null;
  return <section className="readiness" aria-label="Kesiapan produksi">
    <div><strong>{missing.length} dari {items.length} bagian produksi belum siap</strong><span>Episode bisa dibuat, tapi tahap ini akan berhenti sampai diatur.</span></div>
    <ul>{items.map(item => <li key={item.label} className={item.ok ? "is-ok" : ""}><i />{item.label}{!item.ok && <small>{item.hint}</small>}</li>)}</ul>
    <Button className="primary" onClick={open}>Atur sekarang<ArrowRight size={14} /></Button>
  </section>;
}

function ProjectCard({ channel, open }: { channel: Channel; open: () => void }) {
  const profile = channel.profile;
  return <button type="button" className="project-card" onClick={open} aria-label={`Open ${channel.name} project`}>
    <div className={`project-card-banner ${profile?.banner_url ? "" : "project-banner-missing"}`}>
      {profile?.banner_url ? <img src={profile.banner_url} alt="" loading="lazy" /> : <span>Channel banner unavailable</span>}
    </div>
    <div className="project-card-body">
      <div className="project-card-identity">
        <ChannelAvatar channel={channel} />
        <div><h2>{profile?.title || channel.name}</h2><span>{profile?.handle || channel.handle || "Handle unavailable"}</span></div>
        <ArrowRight className="project-card-arrow" size={17} />
      </div>
      <p className="project-card-description">{profile?.description || "The channel description will appear after its profile is synced."}</p>
      <div className="project-card-counts">
        <span><strong>{number(profile?.subscribers)}</strong> subscribers</span>
        <span><strong>{number(profile?.total_views)}</strong> total views</span>
      </div>
      <div className="project-card-footer"><Status value={channel.oauth_ref ? "connected" : "not_connected"} /><span>{profile?.synced_at ? `Synced ${date(profile.synced_at)}` : "Profile not synced"}</span></div>
    </div>
  </button>;
}

export function ChannelAvatar({ channel, large = false }: { channel: Pick<Channel, "name" | "profile">; large?: boolean }) {
  return <span className={`project-avatar ${large ? "project-avatar-large" : ""}`}>
    {channel.profile?.avatar_url ? <img src={channel.profile.avatar_url} alt="" /> : <span aria-hidden="true">{channel.name.slice(0, 1)}</span>}
  </span>;
}
