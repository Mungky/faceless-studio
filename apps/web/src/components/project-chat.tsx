"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Gauge,
  Hourglass,
  Lightbulb,
  Image as ImageIcon,
  Link as LinkIcon,
  LoaderCircle,
  Minus,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X
} from "lucide-react";

import type { WorkflowTemplate, WorkflowRun } from "@studio/core";
import type { Perform } from "./workspace-types";
import { Markdown } from "./markdown";

interface Attachment {
  name: string;
  type: string;
  url?: string;
  text?: string;
}
interface Act {
  action: string;
  ok: boolean;
  message: string;
  explanation?: string;
  pending?: boolean;
}
// What really changed in the workflow during a turn, as measured by the server.
interface Changes {
  added: string[];
  removed: string[];
  changed: { node: string; fields: string[] }[];
  links: boolean;
  meta: string[];
}
interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  think?: string;
  attachments?: Attachment[];
  actions?: Act[];
  changes?: Changes;
  canUndo?: boolean;
  learned?: { notes: string[]; rules: string[] };
  // Only on the reply being written right now: how much has arrived, and whether it is a long action block (hidden from view).
  progress?: { chars: number; seconds: number; writingActions: boolean };
}
// An action waiting for the owner's button; it runs only when approved.
interface PendingItem {
  id: string;
  reason: string;
  action: { action?: string; name?: string; node_name?: string; nodes?: { name?: string }[]; steps?: { action?: string; name?: string; node_name?: string }[]; execution_id?: string };
}
type Mode = "cepat" | "seimbang" | "dalam";
interface ThreadView {
  id: string;
  title: string;
  status: "idle" | "running";
  messages: Msg[];
  pending?: PendingItem[];
  notice?: string;
  undo: number;
  mode?: Mode;
  context?: { used: number; limit: number };
  build?: string;
}
// What the assistant knows about this project (kept in the vault, so it survives closing the app).
interface MemoryData {
  folder: string;
  rules: string[];
  memory: string[];
  skills: { name: string; description: string; scope: string }[];
}
const MODE_HINT: Record<Mode, string> = {
  cepat: "Jawab langsung dan singkat",
  seimbang: "Bawaan",
  dalam: "Menyusun rencana dulu, lalu mencocokkan hasil nyata dengan rencana"
};
const hasChanged = (c?: Changes) => !!c && !!(c.added.length || c.removed.length || c.changed.length || c.links || c.meta.length);
function describePending(p: PendingItem) {
  const a = p.action;
  if (a.action === "replace_workflow") return `${a.nodes?.length ?? "?"} node: ${(a.nodes || []).map(n => n.name).filter(Boolean).slice(0, 8).join(", ")}${(a.nodes?.length || 0) > 8 ? "…" : ""}`;
  if (a.action === "propose_plan") return (a.steps || []).map((s, i) => `${i + 1}. ${ACTION_LABEL[s.action || ""] || s.action}${s.node_name || s.name ? ": " + (s.node_name || s.name) : ""}`).join("\n");
  if (a.action === "restore_from_execution") return `Dari eksekusi ${a.execution_id ?? "?"}`;
  if (a.action === "add_n8n_node") return `Node baru: ${a.name || "(tanpa nama)"}`;
  return ACTION_LABEL[a.action || ""] || a.action || "";
}
interface ThreadRow {
  id: string;
  title: string;
  status: "idle" | "running";
  count: number;
  pending?: number;
}

const ACTION_LABEL: Record<string, string> = {
  get_workflow: "Membaca workflow",
  replace_workflow: "Mengganti seluruh workflow",
  add_n8n_node: "Menambah node",
  modify_n8n_node: "Mengubah node",
  remove_n8n_node: "Menghapus node",
  connect_nodes: "Menyambung node",
  disconnect_nodes: "Memutus sambungan",
  rename_workflow: "Mengganti nama workflow",
  publish_n8n_workflow: "Mengaktifkan/menonaktifkan workflow",
  execute_n8n_workflow: "Menjalankan workflow",
  list_executions: "Melihat eksekusi",
  get_execution: "Membaca hasil eksekusi",
  stop_execution: "Menghentikan eksekusi",
  list_credentials: "Melihat credential",
  rebuild_from_recipe: "Membangun dari resep Studio",
  set_node_param: "Mengubah satu nilai node",
  propose_plan: "Menerapkan rencana perubahan",
  restore_from_execution: "Memulihkan dari eksekusi",
  list_skills: "Melihat skill",
  read_skill: "Membaca skill",
  save_skill: "Menyimpan skill",
  save_memory: "Menyimpan ke memori",
  rewrite_memory: "Merapikan memori",
  save_rule: "Menyimpan aturan tetap",
  undo_last_change: "Mengurungkan perubahan"
};
// Actions that only look; the n8n editor is reloaded after anything else succeeds.
const READ_ONLY = new Set(["get_workflow", "list_executions", "get_execution", "list_credentials", "save_memory", "rewrite_memory", "save_rule"]);

export function ProjectChat({
  project,
  projectName,
  minimize,
  ...rest
}: {
  project: string;
  projectName?: string;
  workflow?: WorkflowTemplate;
  tasks?: WorkflowRun[];
  taskTitle?: (run: WorkflowRun) => string;
  selectedRun?: string;
  clearRun?: () => void;
  busy?: boolean;
  perform?: Perform;
  refresh?: () => Promise<void>;
  openTask?: (id: string) => void;
  minimize: () => void;
}) {
  const name = projectName || project;
  const storeKey = "faceless:assistant:" + project;
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [active, setActive] = useState("");
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [expandedThinks, setExpandedThinks] = useState<Record<string, boolean>>({});
  const [acting, setActing] = useState(false);
  const [panel, setPanel] = useState(false);
  const [stale, setStale] = useState(false);
  const buildRef = useRef("");
  const [memory, setMemory] = useState<MemoryData | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef("");
  const seen = useRef<Set<string>>(new Set());
  const refreshRef = useRef(rest.refresh);
  refreshRef.current = rest.refresh;

  const call = useCallback(
    async <T,>(body: Record<string, unknown>): Promise<T> => {
      const res = await fetch("/api/assistant/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: project, ...body }),
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      return data as T;
    },
    [project]
  );

  const select = useCallback((id: string) => {
    activeRef.current = id;
    setActive(id);
    setThread(null);
    try {
      localStorage.setItem(storeKey, id);
    } catch {
      /* storage unavailable: the choice is simply not remembered */
    }
  }, [storeKey]);

  // The chats live on the server. Opening the panel (or refreshing the page) picks up where it was.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { threads: rows } = await call<{ threads: ThreadRow[] }>({ op: "list" });
        if (cancelled) return;
        let remembered = "";
        try {
          remembered = localStorage.getItem(storeKey) || "";
        } catch {
          /* ignore */
        }
        if (rows.length) {
          setThreads(rows);
          select(rows.some(r => r.id === remembered) ? remembered : rows[0].id);
        } else {
          const created = await call<ThreadView>({ op: "create" });
          if (cancelled) return;
          setThreads([{ id: created.id, title: created.title, status: "idle", count: 0 }]);
          select(created.id);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, select, storeKey]);

  const anyRunning = threads.some(t => t.status === "running") || thread?.status === "running";

  // Poll quickly while something runs, slowly otherwise (another tab may have changed things).
  useEffect(() => {
    if (!active) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const [list, current] = await Promise.all([
          call<{ threads: ThreadRow[] }>({ op: "list" }),
          call<ThreadView>({ op: "get", threadId: active })
        ]);
        setThreads(list.threads);
        if (activeRef.current === active) setThread(current);
        // The server restarts on every deploy; a page opened before that is running old code and may lack newer buttons.
        if (current.build) {
          if (buildRef.current && buildRef.current !== current.build) setStale(true);
          buildRef.current = current.build;
        }
        setError("");
      } catch (e) {
        if (activeRef.current === active) setError((e as Error).message);
      }
    };
    void tick();
    const timer = setInterval(tick, anyRunning ? 1500 : 6000);
    return () => clearInterval(timer);
  }, [active, anyRunning, call]);

  // When the assistant changed the workflow, reload the n8n editor next to it (once per message).
  useEffect(() => {
    if (!thread) return;
    for (const m of thread.messages) {
      if (m.id === "live" || seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (m.actions?.some(a => a.ok && !a.pending && !READ_ONLY.has(a.action)) || hasChanged(m.changes)) void refreshRef.current?.();
    }
  }, [thread]);

  const lastId = thread?.messages.at(-1)?.id;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastId, thread?.messages.at(-1)?.content, thread?.status]);

  const running = thread?.status === "running";

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      if (file.type.startsWith("image/")) {
        reader.onload = () => setAttachments(prev => [...prev, { name: file.name, type: file.type, url: reader.result as string }]);
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => setAttachments(prev => [...prev, { name: file.name, type: file.type || "text/plain", text: (reader.result as string) || "" }]);
        reader.readAsText(file);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || !active || running) return;
    setError("");
    try {
      const next = await call<ThreadView>({ op: "send", threadId: active, content: text, attachments });
      setInput("");
      setAttachments([]);
      setThread(next);
      setThreads(prev => prev.map(t => (t.id === next.id ? { ...t, title: next.title, status: "running" } : t)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changeMode = async (mode: Mode) => {
    if (!active) return;
    try {
      setThread(await call<ThreadView>({ op: "set_mode", threadId: active, mode }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // "Rapikan konteks": fold the older messages into the summary right now.
  const compact = async () => {
    if (!active) return;
    setActing(true);
    setError("");
    try {
      setThread(await call<ThreadView>({ op: "compact", threadId: active }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(false);
    }
  };
  const loadMemory = async () => {
    try {
      setMemory(await call<MemoryData>({ op: "memory" }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toggleMemory = async () => {
    const next = !panel;
    setPanel(next);
    if (next) await loadMemory();
  };
  const forget = async (kind: "rules" | "memory", line: string) => {
    if (!window.confirm("Lupakan catatan ini?\n\n" + line)) return;
    try {
      await call({ op: "forget", kind, text: line.replace(/^- (\d{4}-\d{2}-\d{2}: )?/, "") });
      await loadMemory();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const forgetSkill = async (name: string, scope: string) => {
    if (!window.confirm(`Hapus skill "${name}"?`)) return;
    try {
      await call({ op: "forget_skill", name, scope });
      await loadMemory();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleStop = async () => {
    if (!active) return;
    try {
      setThread(await call<ThreadView>({ op: "stop", threadId: active }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The owner's decision on an action that was held back (the only way such an action ever runs).
  const decide = async (op: "approve" | "reject", pendingId: string) => {
    if (!active) return;
    setActing(true);
    setError("");
    try {
      setThread(await call<ThreadView>({ op, threadId: active, pendingId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(false);
    }
  };
  const undoTurn = async (messageId: string) => {
    if (!active || !window.confirm("Kembalikan workflow ke keadaan sebelum giliran ini? Perubahan lain yang terjadi sesudahnya (termasuk dari chat lain) ikut hilang.")) return;
    setActing(true);
    setError("");
    try {
      setThread(await call<ThreadView>({ op: "undo_turn", threadId: active, messageId }));
      void refreshRef.current?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(false);
    }
  };

  const newChat = async () => {
    try {
      const created = await call<ThreadView>({ op: "create" });
      setThreads(prev => [{ id: created.id, title: created.title, status: "idle", count: 0 }, ...prev]);
      select(created.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeChat = async () => {
    if (!active || !window.confirm("Hapus chat ini? Riwayatnya hilang; perubahan yang sudah diterapkan ke workflow tetap ada.")) return;
    try {
      await call({ op: "delete", threadId: active });
      const left = threads.filter(t => t.id !== active);
      setThreads(left);
      if (left.length) select(left[0].id);
      else await newChat();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const hasLinkInInput = /https?:\/\/[^\s]+/.test(input);
  const messages = thread?.messages || [];
  const liveMessage = messages.at(-1)?.id === "live";

  return (
    <section className="studio-float studio-panel pj-chat-native" aria-label="AI Assistant Project">
      <header className="pj-native-header">
        <div className="pj-native-title-block">
          <div className="pj-native-badge-row">
            <span className="pj-badge-pill">
              <Brain size={12} className="pj-pulse-icon" /> BRAIN
            </span>
            <span className="pj-project-tag">
              <span className="pj-live-dot" /> {name}
            </span>
          </div>
          <h2 className="pj-native-name">Studio AI Copilot</h2>
        </div>
        <button className={"pj-icon-btn" + (panel ? " is-on" : "")} aria-label="Memori dan skill" title="Memori, aturan, dan skill assistant" onClick={() => void toggleMemory()}>
          <BookOpen size={15} />
        </button>
        <button className="pj-icon-btn" aria-label="Hapus chat ini" title="Hapus chat ini" onClick={() => void removeChat()} disabled={!active}>
          <Trash2 size={15} />
        </button>
        <button className="pj-icon-btn" aria-label="Kecilkan chat" title="Kecilkan chat" onClick={minimize}>
          <Minus size={16} />
        </button>
      </header>

      {/* Each chat works on its own, in the background; several can run at once. */}
      <div className="pj-threads" role="tablist" aria-label="Chat assistant">
        {threads.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={"pj-thread-tab" + (t.id === active ? " is-active" : "")}
            title={t.title}
            onClick={() => select(t.id)}
          >
            {t.status === "running" && <LoaderCircle className="spin" size={11} />}
            {!!t.pending && <span className="pj-thread-wait" title="Ada aksi yang menunggu izinmu">⏳</span>}
            <span>{t.title}</span>
          </button>
        ))}
        <button type="button" className="pj-thread-add" title="Chat baru (bisa jalan bersamaan)" aria-label="Chat baru" onClick={() => void newChat()}>
          <Plus size={14} />
        </button>
      </div>

      {/* How full the model's context is, how hard it thinks, and a button to fold old messages into the summary. */}
      {stale && (
        <div className="pj-stale">
          Studio baru saja diperbarui. Muat ulang halaman (Ctrl+Shift+R) supaya tombol dan fitur terbaru muncul.
          <button type="button" className="pj-undo-btn" onClick={() => window.location.reload()}>Muat ulang</button>
        </div>
      )}
      {(thread?.pending?.length || 0) > 0 && (
        <div className="pj-stale is-wait">⏳ {thread!.pending!.length} aksi menunggu izinmu. Tombol Izinkan ada di bagian bawah percakapan.</div>
      )}
      <div className="pj-context">
        <span className="pj-context-meter" title={`Perkiraan isi konteks: ${(thread?.context?.used ?? 0).toLocaleString("id-ID")} dari ${(thread?.context?.limit ?? 0).toLocaleString("id-ID")} token. Dipadatkan otomatis di atas 70%.`}>
          <Gauge size={12} /> Konteks {thread?.context ? Math.min(100, Math.round((thread.context.used / thread.context.limit) * 100)) : 0}%
          <i style={{ ["--p" as string]: (thread?.context ? Math.min(100, (thread.context.used / thread.context.limit) * 100) : 0) + "%" }} />
        </span>
        <button type="button" className="pj-undo-btn" disabled={acting || running || !thread} onClick={() => void compact()} title="Lipat pesan lama menjadi ringkasan sekarang">
          Rapikan konteks
        </button>
        <label className="pj-mode" title={MODE_HINT[thread?.mode || "seimbang"]}>
          Berpikir
          <select value={thread?.mode || "seimbang"} disabled={!thread || running} onChange={e => void changeMode(e.target.value as Mode)}>
            <option value="cepat">Cepat</option>
            <option value="seimbang">Seimbang</option>
            <option value="dalam">Dalam</option>
          </select>
        </label>
      </div>

      <div className="pj-messages-container">
        {panel ? (
          <div className="pj-memory">
            <p className="pj-memory-intro">
              Yang diingat assistant untuk project ini. Disimpan di vault{memory ? <> (folder <code>{memory.folder}</code>)</> : null}, jadi tidak hilang saat aplikasi ditutup atau di-deploy ulang, dan bisa diedit di Obsidian.
            </p>
            {!memory && (
              <p className="pj-system-note">
                <LoaderCircle className="spin" size={13} /> Memuat…
              </p>
            )}
            {memory && (
              <>
                <h4>Aturan tetap ({memory.rules.length})</h4>
                {memory.rules.length === 0 && <p className="pj-memory-empty">Belum ada. Ucapkan "jangan pernah…" atau "selalu…" di chat.</p>}
                {memory.rules.map(l => (
                  <div key={l} className="pj-memory-row">
                    <span>{l.replace(/^- /, "")}</span>
                    <button type="button" className="pj-reject-btn" onClick={() => void forget("rules", l)}>Lupakan</button>
                  </div>
                ))}
                <h4>Memori ({memory.memory.length})</h4>
                {memory.memory.length === 0 && <p className="pj-memory-empty">Belum ada. Assistant mencatatnya sendiri dari percakapan.</p>}
                {memory.memory.map(l => (
                  <div key={l} className="pj-memory-row">
                    <span>{l.replace(/^- /, "")}</span>
                    <button type="button" className="pj-reject-btn" onClick={() => void forget("memory", l)}>Lupakan</button>
                  </div>
                ))}
                <h4>Skill ({memory.skills.length})</h4>
                {memory.skills.map(s => (
                  <div key={s.scope + s.name} className="pj-memory-row">
                    <span>
                      <strong>{s.name}</strong> <small>({s.scope})</small>
                      <br />
                      {s.description}
                    </span>
                    {s.scope !== "bawaan" && (
                      <button type="button" className="pj-reject-btn" onClick={() => void forgetSkill(s.name, s.scope)}>Hapus</button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <>
        {error && (
          <p className="pj-system-note is-error">
            <AlertCircle size={13} /> {error}
          </p>
        )}
        {!thread && !error && (
          <p className="pj-system-note">
            <LoaderCircle className="spin" size={13} /> Memuat chat…
          </p>
        )}
        {thread && messages.length === 0 && (
          <div className="pj-message-row pj-row-assistant">
            <div className="pj-avatar-bubble">
              <Brain size={15} />
            </div>
            <div className="pj-bubble pj-bubble-assistant">
              <div className="pj-markdown-body">
                <Markdown
                  text={`Halo! Saya asisten project **${name}** dengan akses penuh ke workflow n8n-nya.\n\n- Membaca, mengubah, dan menjalankan workflow langsung dari sini.\n- Melihat hasil eksekusi dan memperbaiki error.\n- Membaca dokumen, gambar, dan link yang Anda kirim.\n\nChat ini berjalan di server: boleh di-refresh atau ditinggal, dan Anda bisa membuka chat lain untuk pekerjaan paralel.`}
                />
              </div>
            </div>
          </div>
        )}
        {messages.map(msg =>
          msg.role === "system" ? (
            msg.learned ? (
              <div key={msg.id} className="pj-learned">
                <Lightbulb size={13} />
                <div>
                  <strong>{msg.content}</strong>
                  <ul>
                    {msg.learned.rules.map(r => <li key={"r" + r}>Aturan: {r}</li>)}
                    {msg.learned.notes.map(n => <li key={"n" + n}>{n}</li>)}
                  </ul>
                  <small>Bisa dihapus lewat tombol buku (Memori).</small>
                </div>
              </div>
            ) : hasChanged(msg.changes) ? (
              <div key={msg.id} className="pj-changes">
                <strong>{msg.content}</strong>
                <ul>
                  {msg.changes!.added.map(n => <li key={"a" + n} className="is-added">+ {n}</li>)}
                  {msg.changes!.removed.map(n => <li key={"r" + n} className="is-removed">− {n}</li>)}
                  {msg.changes!.changed.map(c => <li key={"c" + c.node}>✎ {c.node} <small>({c.fields.join(", ")})</small></li>)}
                  {msg.changes!.links && <li>↔ sambungan antar node berubah</li>}
                  {msg.changes!.meta.map(m => <li key={m}>• {m}</li>)}
                </ul>
                {msg.canUndo && (
                  <button type="button" className="pj-undo-btn" disabled={acting || running} onClick={() => void undoTurn(msg.id)}>
                    <Undo2 size={13} /> Urungkan giliran ini
                  </button>
                )}
              </div>
            ) : (
              <p key={msg.id} className={"pj-system-note" + (msg.content.startsWith("⚠") ? " is-error" : "")}>
                {msg.content}
              </p>
            )
          ) : (
            <div key={msg.id} className={`pj-message-row ${msg.role === "user" ? "pj-row-user" : "pj-row-assistant"}`}>
              {msg.role === "assistant" && (
                <div className="pj-avatar-bubble">
                  <Brain size={15} />
                </div>
              )}
              <div className={`pj-bubble ${msg.role === "user" ? "pj-bubble-user" : "pj-bubble-assistant"}`}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="pj-bubble-attachments">
                    {msg.attachments.map((att, i) => (
                      <div key={i} className="pj-attachment-chip">
                        {att.type.startsWith("image/") ? (
                          att.url ? <img src={att.url} alt={att.name} className="pj-attachment-img-preview" /> : <ImageIcon size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                        <span className="pj-attachment-name">{att.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.think && (
                  <div className="pj-think-block">
                    <button type="button" className="pj-think-toggle" onClick={() => setExpandedThinks(prev => ({ ...prev, [msg.id]: !(prev[msg.id] ?? msg.id === "live") }))}>
                      <div className="pj-think-toggle-left">
                        <Sparkles size={13} className="pj-think-sparkle" />
                        <span>Proses Berpikir</span>
                        {msg.id === "live" && !msg.content && <span className="pj-think-live-dot" />}
                      </div>
                      {(expandedThinks[msg.id] ?? msg.id === "live") ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    {(expandedThinks[msg.id] ?? msg.id === "live") && (
                      <div className="pj-think-content">
                        <pre className="pj-think-text">{msg.think}</pre>
                      </div>
                    )}
                  </div>
                )}

                {msg.content && (
                  <div className="pj-markdown-body">{msg.role === "assistant" ? <Markdown text={msg.content} /> : <p className="pj-paragraph">{msg.content}</p>}</div>
                )}

                {msg.progress && (
                  <p className="pj-progress">
                    <LoaderCircle className="spin" size={11} /> Menulis… {msg.progress.chars.toLocaleString("id-ID")} karakter · {msg.progress.seconds} dtk
                    {msg.progress.writingActions ? " · sedang menyusun aksi (perubahan besar bisa beberapa menit)" : ""}
                  </p>
                )}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="pj-action-log">
                    {msg.actions.map((a, i) => (
                      <div key={i} className={"pj-action-row " + (a.pending ? "is-wait" : a.ok ? "is-ok" : "is-fail")}>
                        {a.pending ? <Hourglass size={13} /> : a.ok ? <Check size={13} /> : <AlertCircle size={13} />}
                        <div>
                          <strong>{ACTION_LABEL[a.action] || a.action}</strong>
                          <span>{a.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {(thread?.pending || []).map(p => (
          <div key={p.id} className="pj-approval">
            <div className="pj-approval-head">
              <ShieldAlert size={15} /> <strong>Perlu izinmu</strong>
            </div>
            <p>{p.reason}</p>
            <p className="pj-approval-detail">{describePending(p)}</p>
            <div className="pj-approval-actions">
              <button type="button" className="pj-action-btn" disabled={acting || running} onClick={() => void decide("approve", p.id)}>
                Izinkan
              </button>
              <button type="button" className="pj-reject-btn" disabled={acting} onClick={() => void decide("reject", p.id)}>
                Tolak
              </button>
            </div>
          </div>
        ))}
        {running && !liveMessage && (
          <p className="pj-system-note">
            <LoaderCircle className="spin" size={13} /> Assistant bekerja di server… Anda boleh refresh atau membuka chat lain.
          </p>
        )}
        {thread?.notice && <p className="pj-system-note">{thread.notice}</p>}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {attachments.length > 0 && (
        <div className="pj-staging-area">
          {attachments.map((att, idx) => (
            <div key={idx} className="pj-staging-chip">
              {att.type.startsWith("image/") ? <ImageIcon size={13} /> : <FileText size={13} />}
              <span className="pj-staging-name">{att.name}</span>
              <button type="button" className="pj-staging-remove" onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {hasLinkInInput && (
        <div className="pj-link-hint">
          <LinkIcon size={12} />
          <span>Link terdeteksi — judul & konten akan dianalisis otomatis</span>
        </div>
      )}

      <footer className="pj-native-input-box">
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple accept="image/*,.pdf,.txt,.md,.csv,.json" style={{ display: "none" }} />
        <button type="button" className="pj-attach-btn" title="Lampirkan Gambar atau Dokumen (PDF, TXT, MD, CSV)" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={18} />
        </button>

        <textarea
          className="pj-native-textarea"
          placeholder={running ? "Assistant sedang bekerja… tekan Stop atau buka chat baru (+)" : "Instruksikan asisten atau tempel link video/web..."}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />

        {running ? (
          <button type="button" className="pj-send-btn pj-btn-stop" title="Hentikan assistant" onClick={() => void handleStop()}>
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="pj-send-btn" title="Kirim (Enter)" disabled={!active || (!input.trim() && attachments.length === 0)} onClick={() => void handleSend()}>
            <Send size={16} />
          </button>
        )}
      </footer>
    </section>
  );
}
