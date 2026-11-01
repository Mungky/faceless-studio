"use client";
import { useState } from "react";
import { Cable, Cpu, Database, ExternalLink, FileText, Folder, KeyRound, RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";
import type { Channel } from "@studio/core";
import { api, Button, Status, date, money, number, workerOnline, type Dashboard, type Spending } from "./ui";

type Run = (fn: () => Promise<void>) => Promise<void>;
type CheckResult = { connected: boolean; message: string };

export function YoutubeConnections({ channels, data }: { channels: Channel[]; data: Dashboard }) {
  return <section className="settings-section"><h2>Akun YouTube</h2><p className="muted">Hubungkan tiap channel secara terpisah. Akses baca saja sudah cukup; Studio tidak pernah mengunggah video.</p><div className="connection-list">{channels.map(channel => <div className="connection-row" key={channel.id}><span className="channel-avatar" style={{ "--channel-color": channel.color } as React.CSSProperties}>{channel.name[0]}</span><div className="connection-info"><strong>{channel.name}</strong><span>{channel.handle || "Pilih channel yang benar saat otorisasi"}</span></div><Status value={channel.oauth_ref ? "connected" : "not_connected"} />{data.configuration.google ? <a className="button" href={`/api/oauth/start?channel=${channel.id}`}>{channel.oauth_ref ? "Hubungkan ulang" : "Hubungkan"}<ExternalLink size={13} /></a> : <Button disabled title="Isi kredensial Google OAuth di server terlebih dahulu">Hubungkan<ExternalLink size={13} /></Button>}</div>)}</div>{!data.configuration.google && <div className="configuration-note"><KeyRound size={16} /><p>Isi <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, dan redirect URI di environment server.</p></div>}</section>;
}

export function ServiceStatus({ data, busy, run }: { data: Dashboard; busy: boolean; run: Run }) {
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const check = (provider: string) => void run(async () => { const result = await api<CheckResult>("connections/check", { provider }); setChecks(previous => ({ ...previous, [provider]: result })); });
  return <section className="settings-section"><h2>Layanan produksi</h2><p className="muted">Diatur di environment server dan dipakai semua channel.</p><div className="connection-list">
    <Service icon={<Cable size={20} />} title="Google Drive" subtitle="Penyimpanan media besar lewat rclone. Tanpa Drive, asset disimpan di server." configured={data.configuration.drive} result={checks.drive} check={() => check("drive")} busy={busy} />
    <Service icon={<ActivityIcon />} title="ElevenLabs" subtitle="Voice-over. Setiap pembuatan perlu persetujuan." configured={data.configuration.elevenlabs} result={checks.elevenlabs} check={() => check("elevenlabs")} busy={busy} />
    <div className="connection-row"><span className="service-icon"><Cpu size={20} /></span><div className="connection-info"><strong>PC render (Flow, ACE-Step, analisis mendalam)</strong><span>Jalankan <code>npm run worker</code> di PC Windows.</span></div><Status value={data.workers.some(workerOnline) ? "worker_online" : "worker_offline"} /></div>
    <div className="connection-row"><span className="service-icon"><Sparkles size={20} /></span><div className="connection-info"><strong>Penyedia generasi alternatif</strong><span>Webhook HTTP yang bisa diganti; isi URL dan token di server.</span></div><Status value={data.configuration.webhook ? "configured" : "not_configured"} /></div>
  </div></section>;
}

export function StorageInfo({ data }: { data: Dashboard }) {
  return (
    <section className="settings-section">
      <h2>Penyimpanan Data & Asset Project</h2>
      <p className="muted">
        Semua data project Restard Studio tersimpan rapi dan aman di komputer lokal Anda.
      </p>

      <div className="storage-row">
        <Folder size={20} />
        <div>
          <strong>Direktori Project Lokal</strong>
          <code className="path-text">projects/&lt;Nama Project&gt;/</code>
          <p>
            Setiap project memiliki foldernya sendiri. Berisi file <code>system.md</code>, panduan produksi, serta dokumen riset yang dianalisis oleh AI. Folder ini berada langsung di penyimpanan lokal Anda (<code>D:\Faceless Creation\studio - Copy\projects</code>).
          </p>
        </div>
        <Status value="connected" />
      </div>

      <div className="storage-row">
        <Database size={20} />
        <div>
          <strong>Database Internal (PocketBase)</strong>
          <code className="path-text">http://127.0.0.1:8095</code>
          <p>
            Menyimpan data channel, preferensi n8n, dan riwayat chat secara otomatis. Berjalan lokal di latar belakang tanpa memerlukan konfigurasi manual.
          </p>
        </div>
        <Status value="connected" />
      </div>

      <div className="storage-row">
        <Cable size={20} />
        <div>
          <strong>Penyimpanan Media & Cloud (Opsional)</strong>
          <p>
            {data.configuration.drive
              ? "Google Drive terhubung via rclone untuk sinkronisasi cadangan file video besar ke cloud."
              : "Menggunakan penyimpanan lokal. Semua aset video dan gambar disimpan langsung di folder lokal komputer Anda tanpa biaya cloud."}
          </p>
        </div>
        <Status value={data.configuration.drive ? "connected" : "configured"} />
      </div>
    </section>
  );
}

function ActivityIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 8v8M9 4v16M13 7v10M17 2v20M21 9v6" /></svg>; }
function Service({ icon, title, subtitle, configured, result, check, busy }: { icon: React.ReactNode; title: string; subtitle: string; configured: boolean; result?: CheckResult; check: () => void; busy: boolean }) { return <div className="connection-row"><span className="service-icon">{icon}</span><div className="connection-info"><strong>{title}</strong><span>{result?.message || subtitle}</span></div><Status value={result ? result.connected ? "connected" : "unreachable" : configured ? "configured" : "not_configured"} /><Button disabled={!configured || busy} onClick={check}><RefreshCw size={13} />Cek</Button></div>; }

const priceFields: { key: keyof Spending; label: string }[] = [{ key: "elevenlabs_usd_per_1k_chars", label: "ElevenLabs · USD / 1.000 karakter" }, { key: "flow_image_credits", label: "Flow gambar · kredit per percobaan" }, { key: "flow_video_credits", label: "Flow video · kredit per percobaan" }, { key: "webhook_image_usd", label: "Penyedia alternatif gambar · USD / permintaan" }, { key: "webhook_video_usd", label: "Penyedia alternatif video · USD / permintaan" }];
export function SpendingPanel({ data, busy, run, refresh }: { data: Dashboard; busy: boolean; run: Run; refresh: () => Promise<void> }) {
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const today = data.spendLog.filter(log => day(new Date(log.created)) === day(new Date()) && log.status !== "void");
  const usd = today.filter(log => log.currency === "USD").reduce((sum, log) => sum + log.est_cost, 0), credits = today.filter(log => log.currency === "credits").reduce((sum, log) => sum + log.units, 0);
  return <><div className="budget-summary"><div><span>Terpakai hari ini · USD</span><strong>{money(usd)} <small>/ {data.spending.daily_usd == null ? "tanpa batas" : data.spending.daily_usd === 0 ? "berbayar diblokir" : money(data.spending.daily_usd)}</small></strong></div><div><span>Terpakai hari ini · kredit</span><strong>{number(credits)} <small>/ {data.spending.daily_credits == null ? "tanpa batas" : data.spending.daily_credits === 0 ? "berbayar diblokir" : number(data.spending.daily_credits)}</small></strong></div><p><ShieldCheck size={13} /> Batas 0 berarti semua layanan berbayar diblokir; layanan gratis tetap jalan. Isi batas di bawah untuk mengizinkan biaya. Setiap permintaan berbayar tetap perlu persetujuan, dan batas direset tengah malam WIB.</p></div><form className="settings-form" key={JSON.stringify(data.spending)} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(["daily_usd", "daily_credits", ...priceFields.map(item => item.key)].map(key => [key, form.get(key) === "" ? null : Number(form.get(key))])); void run(async () => { await api("settings/spending", values, "PUT"); await refresh(); }); }}><section className="settings-section"><h2>Batas harian</h2><p className="muted">Batas 0 memblokir permintaan berbayar. Kosongkan hanya jika memang tidak ingin ada batas.</p><div className="form-grid"><label>Batas USD harian<input name="daily_usd" type="number" min="0" max="10000" step="0.01" defaultValue={data.spending.daily_usd ?? ""} placeholder="Tanpa batas" /></label><label>Batas kredit harian<input name="daily_credits" type="number" min="0" max="1000000" step="1" defaultValue={data.spending.daily_credits ?? ""} placeholder="Tanpa batas" /></label></div></section><section className="settings-section"><h2>Perkiraan harga</h2><p className="muted">Isi sesuai harga akunmu. Harga kosong memblokir penyedia tersebut.</p><div className="form-grid">{priceFields.map(item => <label key={item.key}>{item.label}<input name={item.key} type="number" min="0" max="1000" step="0.000001" defaultValue={data.spending[item.key] ?? ""} placeholder="Belum diatur" /></label>)}</div><div className="configuration-note"><FileText size={16} /><p>Generasi Flow otomatis menunggu kebijakan retry yang terverifikasi. Hasil Flow bisa diimpor lewat Asset.</p></div><div className="form-actions"><Button className="primary" type="submit" busy={busy}><Save size={14} />Simpan kebijakan biaya</Button></div></section></form><section className="settings-section"><h2>Riwayat persetujuan</h2>{data.spendLog.length ? <div className="table-wrap"><table><thead><tr><th>Penyedia</th><th>Perkiraan</th><th>Status</th><th>Disetujui</th></tr></thead><tbody>{data.spendLog.map(log => <tr key={log.id}><td>{log.provider}</td><td className="tabular">{log.currency === "credits" ? `${number(log.units)} kredit` : money(log.est_cost)}</td><td><Status value={log.status} /></td><td className="muted">{date(log.created)}</td></tr>)}</tbody></table></div> : <p className="quiet-empty">Belum ada biaya yang disetujui.</p>}</section></>;
}
