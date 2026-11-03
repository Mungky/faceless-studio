"use client";

import { useState, useRef, useEffect } from "react";
import {
  Minus,
  Paperclip,
  Send,
  Square,
  ChevronDown,
  ChevronRight,
  Brain,
  FileText,
  Image as ImageIcon,
  Check,
  Play,
  X,
  Sparkles,
  Link as LinkIcon
} from "lucide-react";

import type { WorkflowTemplate, WorkflowRun } from "@studio/core";
import type { Perform } from "./workspace-types";

interface Attachment {
  name: string;
  type: string;
  url?: string;
  text?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  think?: string;
  attachments?: Attachment[];
  action?: any;
  actionApplied?: boolean;
}

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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "intro",
      role: "assistant",
      content: `Halo! Saya Hermes Agent untuk project **${name}**.\n\nSaya siap membantu Anda:\n- Berdiskusi dan menganalisis ide konten video, riset, atau naskah.\n- Merancang dan memodifikasi alur kerja **n8n** project ini secara presisi.\n- Menjalankan uji coba alur automasi n8n langsung dari sini.\n\nApa yang ingin kita buat atau evaluasi?`
    }
  ]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedThinks, setExpandedThinks] = useState<Record<string, boolean>>({});
  const [applyingAction, setApplyingAction] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const toggleThink = (id: string) => {
    setExpandedThinks(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev => [
            ...prev,
            { name: file.name, type: file.type, url: reader.result as string }
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev => [
            ...prev,
            { name: file.name, type: file.type || "text/plain", text: (reader.result as string) || "" }
          ]);
        };
        reader.readAsText(file);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isStreaming) return;

    const userMsg: Message = {
      id: "usr-" + Date.now(),
      role: "user",
      content: text,
      attachments: [...attachments]
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setAttachments([]);
    setIsStreaming(true);

    const assistantMsgId = "ast-" + Date.now();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      think: ""
    };

    setMessages([...nextHistory, assistantMsg]);
    setExpandedThinks(prev => ({ ...prev, [assistantMsgId]: true }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: project,
          messages: nextHistory.map(m => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments
          }))
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.type === "think") {
              setMessages(prev =>
                prev.map(m => (m.id === assistantMsgId ? { ...m, think: (m.think || "") + data.text } : m))
              );
            } else if (data.type === "content") {
              setMessages(prev =>
                prev.map(m => (m.id === assistantMsgId ? { ...m, content: (m.content || "") + data.text } : m))
              );
            } else if (data.type === "action") {
              setMessages(prev =>
                prev.map(m => (m.id === assistantMsgId ? { ...m, action: data.action } : m))
              );
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: (m.content ? m.content + "\n\n" : "") + `⚠️ Gagal merespons: ${err.message}` }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  const applyAction = async (msgId: string, action: any) => {
    setApplyingAction(msgId);
    try {
      const res = await fetch("/api/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: project, action })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessages(prev =>
          prev.map(m => (m.id === msgId ? { ...m, actionApplied: true } : m))
        );
        if (typeof rest.refresh === "function") {
          await rest.refresh();
        }
      } else {
        alert("Gagal menerapkan aksi: " + (data.error || "Kesalahan server"));
      }
    } catch (e: any) {
      alert("Gagal memanggil aksi: " + e.message);
    } finally {
      setApplyingAction(null);
    }
  };

  const hasLinkInInput = /https?:\/\/[^\s]+/.test(input);

  return (
    <section className="studio-float studio-panel pj-chat-native" aria-label="Hermes Agent Project">
      {/* Header */}
      <header className="pj-native-header">
        <div className="pj-native-title-block">
          <div className="pj-native-badge-row">
            <span className="pj-badge-pill">
              <Brain size={12} className="pj-pulse-icon" /> HERMES
            </span>
            <span className="pj-project-tag">
              <span className="pj-live-dot" /> {name}
            </span>
          </div>
          <h2 className="pj-native-name">Hermes Copilot</h2>
        </div>
        <button
          className="pj-icon-btn"
          aria-label="Kecilkan chat"
          title="Kecilkan chat"
          onClick={minimize}
        >
          <Minus size={16} />
        </button>
      </header>

      {/* Messages Scroll Area */}
      <div className="pj-messages-container">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`pj-message-row ${msg.role === "user" ? "pj-row-user" : "pj-row-assistant"}`}
          >
            {msg.role === "assistant" && (
              <div className="pj-avatar-bubble">
                <Brain size={15} />
              </div>
            )}

            <div className={`pj-bubble ${msg.role === "user" ? "pj-bubble-user" : "pj-bubble-assistant"}`}>
              {/* Attachments preview if user sent them */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="pj-bubble-attachments">
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="pj-attachment-chip">
                      {att.type.startsWith("image/") ? (
                        att.url ? (
                          <img src={att.url} alt={att.name} className="pj-attachment-img-preview" />
                        ) : (
                          <ImageIcon size={14} />
                        )
                      ) : (
                        <FileText size={14} />
                      )}
                      <span className="pj-attachment-name">{att.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsible Thinking Process */}
              {msg.think && (
                <div className="pj-think-block">
                  <button
                    type="button"
                    className="pj-think-toggle"
                    onClick={() => toggleThink(msg.id)}
                  >
                    <div className="pj-think-toggle-left">
                      <Sparkles size={13} className="pj-think-sparkle" />
                      <span>Proses Berpikir</span>
                      {isStreaming && msg.id === messages[messages.length - 1]?.id && !msg.content && (
                        <span className="pj-think-live-dot" />
                      )}
                    </div>
                    {expandedThinks[msg.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {expandedThinks[msg.id] && (
                    <div className="pj-think-content">
                      <pre className="pj-think-text">{msg.think}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Main Content */}
              {msg.content && (
                <div className="pj-markdown-body">
                  {msg.content.split("\n\n").map((para, idx) => {
                    if (para.startsWith("```json") && para.includes('"action"')) {
                      return null;
                    }
                    return (
                      <p key={idx} className="pj-paragraph">
                        {para}
                      </p>
                    );
                  })}
                </div>
              )}

              {/* Action Proposal Card */}
              {msg.action && (
                <div className="pj-action-card">
                  <div className="pj-action-head">
                    <div className="pj-action-icon">
                      <Play size={14} />
                    </div>
                    <div>
                      <strong>Aksi n8n Diusulkan:</strong>
                      <span className="pj-action-kind"> {msg.action.action || msg.action.type}</span>
                    </div>
                  </div>
                  {msg.action.explanation && (
                    <p className="pj-action-desc">{msg.action.explanation}</p>
                  )}
                  {msg.action.node_name && (
                    <p className="pj-action-sub">Target Node: <code>{msg.action.node_name}</code></p>
                  )}
                  {msg.action.name && (
                    <p className="pj-action-sub">Nama Node Baru: <code>{msg.action.name}</code></p>
                  )}
                  <div className="pj-action-footer">
                    {msg.actionApplied ? (
                      <span className="pj-action-success">
                        <Check size={14} /> Sudah Diterapkan ke n8n
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="pj-action-btn"
                        disabled={applyingAction === msg.id}
                        onClick={() => applyAction(msg.id, msg.action)}
                      >
                        {applyingAction === msg.id ? (
                          "Menerapkan..."
                        ) : (
                          <>
                            <Play size={13} fill="currentColor" /> Terapkan ke Workflow n8n
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment Staging Area */}
      {attachments.length > 0 && (
        <div className="pj-staging-area">
          {attachments.map((att, idx) => (
            <div key={idx} className="pj-staging-chip">
              {att.type.startsWith("image/") ? <ImageIcon size={13} /> : <FileText size={13} />}
              <span className="pj-staging-name">{att.name}</span>
              <button
                type="button"
                className="pj-staging-remove"
                onClick={() => removeAttachment(idx)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Link Detection Helper */}
      {hasLinkInInput && (
        <div className="pj-link-hint">
          <LinkIcon size={12} />
          <span>Link terdeteksi — judul & konten akan dianalisis otomatis</span>
        </div>
      )}

      {/* Input Box */}
      <footer className="pj-native-input-box">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json"
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="pj-attach-btn"
          title="Lampirkan Gambar atau Dokumen (PDF, TXT, MD, CSV)"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={18} />
        </button>

        <textarea
          className="pj-native-textarea"
          placeholder={`Instruksikan Hermes Agent atau tempel link...`}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />

        {isStreaming ? (
          <button
            type="button"
            className="pj-send-btn pj-btn-stop"
            title="Hentikan respons"
            onClick={handleStop}
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="pj-send-btn"
            title="Kirim (Enter)"
            disabled={!input.trim() && attachments.length === 0}
            onClick={handleSend}
          >
            <Send size={16} />
          </button>
        )}
      </footer>
    </section>
  );
}
