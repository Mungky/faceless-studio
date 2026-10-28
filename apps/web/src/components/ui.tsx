"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, ArrowUpRight, CircleDashed } from "lucide-react";
import type { Asset, Beat, Channel, Diagnosis, Episode, Job, ModelRoute, Snapshot, SpendLog, Worker } from "@studio/core";

export type { View } from "./navigation";
export interface Spending { daily_usd: number | null; daily_credits: number | null; flow_image_credits: number | null; flow_video_credits: number | null; elevenlabs_usd_per_1k_chars: number | null; webhook_image_usd: number | null; webhook_video_usd: number | null; }
export interface Dashboard { channels: Channel[]; episodes: Episode[]; assets: Asset[]; jobs: Job[]; workers: Worker[]; snapshots: Snapshot[]; diagnoses: Diagnosis[]; spendLog: SpendLog[]; routes: ModelRoute[]; spending: Spending; configuration: { drive: boolean; ninerouter: boolean; elevenlabs: boolean; google: boolean; webhook: boolean; vault: string; app_url: string }; }
export interface Detail { episode: Episode; channel: Channel; driveBase: string; documents: Record<DocName, string>; revisions: Record<DocName, string>; beats: Beat[]; assets: Asset[]; jobs: Job[]; snapshots: Snapshot[]; storyboard_error?: string; script_approval_stale?: boolean; }
export type DocName = "riset.md" | "script.md" | "storyboard.md" | "upload-pack.md";
export interface Quote { id: string; operation: string; provider: string; units: number; est_cost: number; currency: string; expires: string; note: string; }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T = Record<string, unknown>>(route: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch("/api/" + route, { method: body === undefined ? "GET" : method, headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), cache: "no-store" });
  const data = await response.json(); if (!response.ok) throw new ApiError(data.error || "The request could not be completed.", response.status); return data as T;
}
export const number = (value: number | null | undefined, suffix = "") => value == null ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value) + suffix;
export const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 0.01 && value > 0 ? 6 : 2 }).format(value);
export const date = (value?: string) => value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(value)) : "—";
export const workerOnline = (worker: Worker) => Date.now() - new Date(worker.heartbeat).getTime() < 60_000;
export function Status({ value }: { value: string }) { return <span className={`status status-${value}`}><span className="status-dot" />{value.replaceAll("_", " ")}</span>; }
export function Button({ children, busy, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) { return <button {...props} disabled={props.disabled || busy} className={`button ${className}`}>{busy && <LoaderCircle className="spin" size={14} />}{children}</button>; }
export function Empty({ title, children, action, icon }: { title: string; children: ReactNode; action?: ReactNode; icon?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon || <CircleDashed size={27} strokeWidth={1.4} />}</div><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === ref.current) close(); }}><div className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={close}><X size={18} /></button></div>{children}</dialog>;
}
export function External({ href, children }: { href: string; children: ReactNode }) { return <a className="text-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} /></a>; }
