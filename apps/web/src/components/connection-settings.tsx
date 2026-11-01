"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw, Sparkles, Workflow } from "lucide-react";
import { api, Button, type Dashboard } from "./ui";
import type { Perform } from "./workspace-types";

type Provider = "ninerouter" | "searxng" | "obscura";
type Connection = { url: string; url_source: "app" | "server" | "none"; has_key: boolean };
type Check = { connected: boolean; message: string; models?: string[] };

const services: { id: Provider; name: string; note: string; placeholder: string; keyLabel: string }[] = [
  {
    id: "ninerouter",
    name: "9Router (LLM Gateway)",
    note: "Menyediakan model Faceless Creation dan DeepSeek untuk Asisten Studio.",
    placeholder: "http://alamat-server/v1",
    keyLabel: "API key"
  },
  {
    id: "searxng",
    name: "SearXNG (Pencarian Web)",
    note: "Mesin pencarian web untuk riset mandiri dan penemuan referensi.",
    placeholder: "http://alamat-server:8080",
    keyLabel: "API key (opsional)"
  },
  {
    id: "obscura",
    name: "Obscura (Inspektor Web/Video)",
    note: "Membaca dan mengekstrak isi konten web/video secara mendalam lewat browser.",
    placeholder: "http://alamat-server/mcp",
    keyLabel: "API key (opsional)"
  }
];

export function ServiceSettings({ busy, perform }: { busy: boolean; perform: Perform }) {
  const [state, setState] = useState<Record<string, Connection>>();
  const [error, setError] = useState("");

  useEffect(() => {
    api<Record<string, Connection>>("settings/connections", undefined, "GET")
      .then(setState)
      .catch(e => setError(e instanceof Error ? e.message : "Koneksi belum dapat dimuat."));
  }, []);

  return (
    <div className="connection-settings">
      {/* n8n Status Card */}
      <section className="settings-section stack-form">
        <div className="connection-head">
          <div>
            <h2>n8n (Workflow Engine)</h2>
            <p className="muted">
              Mesin tunggal penggerak seluruh otomasi riset, skrip, dan produksi konten Restard Studio.
            </p>
          </div>
          <span className="status status-connected">
            <span className="status-dot" /> Terhubung
          </span>
        </div>
        <p className="muted">
          Editor n8n disematkan langsung di setiap halaman <strong>Workflow</strong> project. Kredensial dan integrasi spesifik (YouTube API, TikTok Scraper, dll.) dikelola langsung di dalam n8n.
        </p>
      </section>

      {error && <p role="alert" className="project-notice project-notice-error">{error}</p>}
      {!state ? (
        <p className="muted">Memuat layanan…</p>
      ) : (
        services.map(s => (
          <ServiceForm
            key={s.id}
            service={s}
            current={state[s.id]}
            busy={busy}
            perform={perform}
            saved={next => setState(next)}
          />
        ))
      )}
    </div>
  );
}

export function ModelSettings({
  data,
  busy,
  perform,
  refresh
}: {
  data: Dashboard;
  busy: boolean;
  perform: Perform;
  refresh: () => Promise<void>;
}) {
  const [models, setModels] = useState<string[]>([]);
  const currentModel = data.routes.find(r => r.task === "chat")?.model || "faceless-creation";
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    api<Check>("settings/connections/check", { provider: "ninerouter" })
      .then(r => {
        if (live && r.models?.length) setModels(r.models);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const handleSave = () => {
    const modelToSave = selectedModel.trim() || "faceless-creation";
    const coreTasks = ["chat", "analysis", "research", "script", "storyboard", "upload_pack", "hook"];

    void perform(async () => {
      for (const task of coreTasks) {
        await api(
          "settings/models",
          {
            task,
            model: modelToSave,
            billing: "free",
            usd_per_1k_chars: 0,
            max_output_tokens: 8000
          },
          "PUT"
        );
      }
      await refresh();
      setNote("Model utama Restard Studio berhasil disimpan.");
    });
  };

  const changed = selectedModel.trim() !== currentModel;

  return (
    <div className="connection-settings">
      <form
        className="settings-section stack-form"
        onSubmit={e => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div className="connection-head">
          <div>
            <h2>Model AI Utama Studio</h2>
            <p className="muted">
              Model yang digunakan untuk Asisten Chat & Copilot cerdas Restard Studio.
            </p>
          </div>
          <span className="status status-connected">
            <span className="status-dot" /> {selectedModel}
          </span>
        </div>

        <div className="form-grid">
          <label>
            Pilihan Model AI
            <input
              list="route-models"
              required
              maxLength={150}
              value={selectedModel}
              placeholder="faceless-creation"
              onChange={e => {
                setSelectedModel(e.target.value);
                setNote("");
              }}
            />
            <datalist id="route-models">
              {models.map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="configuration-note">
          <Sparkles size={16} />
          <div>
            <strong>Model Per Tugas Tidak Diperlukan Lagi di Sini</strong>
            <p>
              Otomasi produksi konten kini 100% dipusatkan di <strong>Workflow n8n</strong>. Anda bebas memasang model AI apa pun (OpenAI, Anthropic, Gemini, DeepSeek, atau model lokal) secara spesifik pada masing-masing node di kanvas workflow n8n tanpa konfigurasi terpisah di Studio.
            </p>
          </div>
        </div>

        <div className="form-actions">
          {note && (
            <span role="status">
              <Check size={14} /> {note}
            </span>
          )}
          <Button className="primary" type="submit" busy={busy} disabled={!changed}>
            Simpan Model
          </Button>
        </div>
      </form>
    </div>
  );
}

function ServiceForm({
  service,
  current,
  busy,
  perform,
  saved
}: {
  service: typeof services[number];
  current: Connection;
  busy: boolean;
  perform: Perform;
  saved: (next: Record<string, Connection>) => void;
}) {
  const [url, setUrl] = useState(current?.url || "");
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Check>();

  const changed = url !== (current?.url || "") || !!key;

  const save = () =>
    perform(async () => {
      const next = await api<Record<string, Connection>>(
        "settings/connections",
        { provider: service.id, url, ...(key ? { key } : {}) },
        "PUT"
      );
      saved(next);
      setUrl(next[service.id]?.url || "");
      setKey("");
      setNote("Tersimpan.");
      setResult(undefined);
    });

  const check = () =>
    perform(async () => {
      try {
        const r = await api<Check>("settings/connections/check", { provider: service.id });
        setResult(r);
      } catch (e) {
        setResult({
          connected: false,
          message: e instanceof Error ? e.message : "Koneksi gagal."
        });
      }
    });

  return (
    <form
      className="settings-section stack-form"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="connection-head">
        <div>
          <h2>{service.name}</h2>
          <p className="muted">{service.note}</p>
        </div>
        <span
          className={
            "status status-" +
            (result
              ? result.connected
                ? "connected"
                : "unreachable"
              : current?.url
              ? "configured"
              : "not_configured")
          }
        >
          <span className="status-dot" />
          {result
            ? result.connected
              ? "Terhubung"
              : "Tidak terhubung"
            : current?.url
            ? "Tersimpan"
            : "Belum diisi"}
        </span>
      </div>
      <div className="form-grid">
        <label>
          Alamat Endpoint
          <input
            type="url"
            value={url}
            placeholder={service.placeholder}
            onChange={e => {
              setUrl(e.target.value);
              setNote("");
            }}
          />
        </label>
        <label>
          {service.keyLabel}
          <input
            type="password"
            value={key}
            autoComplete="off"
            maxLength={2000}
            placeholder={current?.has_key ? "Tersimpan (kosongkan jika tidak diubah)" : "Belum diisi"}
            onChange={e => {
              setKey(e.target.value);
              setNote("");
            }}
          />
        </label>
      </div>
      {current?.url_source === "server" && (!url.trim() || url === current.url) ? (
        <p className="muted">
          Alamat ini otomatis terisi dari konfigurasi server (<code>.env</code>).
        </p>
      ) : null}
      {result && <p role="status" className="muted">{result.message}</p>}
      <div className="form-actions">
        {note && (
          <span role="status">
            <Check size={14} /> {note}
          </span>
        )}
        <Button type="button" busy={busy} disabled={changed} onClick={() => void check()}>
          <RefreshCw size={13} /> Cek koneksi
        </Button>
        <Button className="primary" type="submit" busy={busy} disabled={!changed}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
