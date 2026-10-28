import { z } from "zod";
import type { ChannelProfile } from "./channel-analytics";
export { z };

export const episodeStatuses = ["idea", "script", "storyboard", "audio", "footage", "render", "review", "published"] as const;
export const jobTypes = ["render", "music", "ffmpeg", "vo", "image", "video"] as const;
export const assetKinds = ["image", "video", "vo", "sfx", "bgm", "music", "render", "thumb"] as const;
export const operations = ["research", "script", "hook", "diagnosis", "storyboard", "upload_pack", "vo", "image", "video"] as const;
export const recordId = z.string().regex(/^[a-zA-Z0-9]{15}$/, "Invalid record ID");
export const videoId = z.string().regex(/^[a-zA-Z0-9_-]{11}$/, "Enter a valid YouTube video ID");
export const segment = z.string().min(1).max(120).refine(v => !/[\\/:\x00-\x1f]/.test(v) && v !== "." && v !== ".." && !/[. ]$/.test(v), "Invalid path segment");
export const beatSchema = z.object({
  index: z.number().int().min(1).max(500),
  text: z.string().max(10_000),
  prompt: z.string().max(10_000),
  seconds: z.number().min(0.1).max(600),
  image: z.string().default(""),
  video: z.string().default("")
});
export type Beat = z.infer<typeof beatSchema>;
export const createEpisodeSchema = z.object({ channel: recordId, title: z.string().trim().min(1).max(200), format: z.enum(["short", "long"]), youtube_video_id: videoId.or(z.literal("")).default("") });
export const updateEpisodeSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), status: z.enum(episodeStatuses).optional(), youtube_video_id: videoId.or(z.literal("")).optional(), script_approved: z.boolean().optional(), script_revision: z.string().regex(/^[a-f0-9]{64}$/).optional(), published_at: z.iso.datetime().or(z.literal("")).refine(value => !value || Date.parse(value) <= Date.now(), "Publication time cannot be in the future").optional() });
export const quoteRequestSchema = z.object({ operation: z.enum(operations), episode: recordId, provider: z.enum(["ninerouter", "elevenlabs", "flow", "webhook"]).optional(), input: z.string().max(100_000).default(""), beat: z.number().int().min(1).max(500).optional(), model: z.string().max(150).optional(), seconds: z.number().min(1).max(600).optional() });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export const localJobSchema = z.object({ episode: recordId, type: z.enum(["render", "music", "ffmpeg"]), prompt: z.string().max(10_000).default(""), lyrics: z.string().max(10_000).default(""), seconds: z.number().min(1).max(600).default(30), seed: z.number().int().min(0).max(2_147_483_647).default(42) });
export const modelRouteSchema = z.object({ task: z.enum(["research", "script", "hook", "diagnosis", "storyboard", "upload_pack"]), model: z.string().trim().min(1).max(150), billing: z.enum(["free", "paid"]), usd_per_1k_chars: z.number().min(0).max(1000), max_output_tokens: z.number().int().min(256).max(32000).default(4000) }).refine(r => r.billing !== "paid" || r.usd_per_1k_chars > 0, "Paid routes require a positive price estimate");
export interface Channel { id: string; name: string; handle: string; playbook_path: string; color: string; youtube_channel_id: string; oauth_ref: string; profile?: ChannelProfile; }
export interface Episode { id: string; channel: string; title: string; slug: string; status: typeof episodeStatuses[number]; format: "short" | "long"; vault_path: string; drive_folder_id: string; youtube_video_id: string; script_approved: boolean; script_meta: Record<string, unknown>; published_at?: string; created: string; updated: string; }
export interface Asset { id: string; episode: string; kind: typeof assetKinds[number]; drive_file_id: string; drive_path: string; source: string; selected: boolean; meta: Record<string, unknown>; created: string; }
export interface Job { id: string; type: typeof jobTypes[number]; episode: string; payload: Record<string, unknown>; status: "queued" | "running" | "done" | "failed" | "cancelled"; worker_id: string; progress: number; log: string; result_asset: string; attempts: number; started: string; finished: string; created: string; updated: string; }
export interface Worker { id: string; worker_key: string; hostname: string; capabilities: string[]; gpu: string; heartbeat: string; }
export interface RetentionPoint { elapsed_ratio: number; retention: number; }
export interface AnalyticsMetrics { title: string; duration_seconds: number; views: number; avg_view_duration: number | null; average_view_percentage: number | null; retention: RetentionPoint[]; ctr: number | null; viewed_vs_swiped: number | null; traffic_sources: { source: string; views: number }[]; unavailable: string[]; start_date: string; end_date: string; }
export interface Snapshot { id: string; video_id: string; episode: string; date: string; metrics: AnalyticsMetrics; source: string; }
export interface Diagnosis { id: string; video_id: string; snapshot: string; findings_md: string; model_used: string; created: string; }
export interface SpendQuote { id: string; operation: QuoteRequest["operation"]; episode: string; provider: string; units: number; est_cost: number; currency: string; request: QuoteRequest; expires: string; consumed: boolean; created: string; }
export interface SpendLog { id: string; quote: string; provider: string; units: number; est_cost: number; currency: string; approved_by: string; status: "reserved" | "done" | "failed" | "void"; job: string; error: string; created: string; }
export interface ModelRoute { id: string; task: string; model: string; billing: "free" | "paid"; usd_per_1k_chars: number; max_output_tokens: number; }

export function slugify(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "episode";
}

const cell = (value: string) => value.replace(/&/g, "&amp;").replace(/\|/g, "&#124;").replace(/\r?\n/g, "<br>");
const uncell = (value: string) => value.replace(/<br>/g, "\n").replace(/&#124;/g, "|").replace(/&amp;/g, "&");
export function serializeStoryboard(beats: Beat[]): string {
  return "# Storyboard\n\n| Beat | Voiceover | Still prompt | Seconds | Image asset | Video asset |\n| --- | --- | --- | --- | --- | --- |\n" + beats.map(b => `| ${b.index} | ${cell(b.text)} | ${cell(b.prompt)} | ${b.seconds} | ${cell(b.image)} | ${cell(b.video)} |`).join("\n") + "\n";
}
export function parseStoryboard(markdown: string): Beat[] {
  const lines = markdown.split(/\r?\n/).map(line => line.trim());
  if (lines.some(line => line && !line.startsWith("|") && !/^#{1,6}\s/.test(line) && !/^<!--.*-->$/.test(line))) throw new Error("Storyboard content must use the beat table format");
  const rows = lines.filter(line => line.startsWith("|"));
  const beats = rows.filter(line => !/^\|\s*Beat\s*\|/i.test(line) && !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)).map(line => {
    if (!/^\|\s*\d+\s*\|/.test(line) || !line.endsWith("|")) throw new Error("Invalid storyboard table row");
    const parts = line.split("|").slice(1, -1).map(p => uncell(p.trim()));
    if (parts.length !== 6) throw new Error("Storyboard rows require six columns");
    return beatSchema.parse({ index: Number(parts[0]), text: parts[1], prompt: parts[2], seconds: Number(parts[3]), image: parts[4] || "", video: parts[5] || "" });
  });
  return validateStoryboard(beats);
}
export function validateStoryboard(value: unknown): Beat[] {
  const beats = z.array(beatSchema).max(500).parse(value);
  if (beats.some((beat, index) => beat.index !== index + 1)) throw new Error("Storyboard beat indices must be unique and ordered consecutively from 1");
  if (beats.reduce((total, beat) => total + beat.seconds, 0) > 7200) throw new Error("Storyboard total duration exceeds the two-hour limit");
  return beats;
}

const normalizeWords = (text: string) => text.replace(/\s+/g, " ").trim();
const cuePattern = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?))?\]?(?:\s*[-:|]\s*|\s+|$)(.*)$/;
function cueSeconds(text: string): number {
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some(value => value >= 60)) throw new Error("Invalid script time cue");
  return parts.reduce((total, value) => total * 60 + value, 0);
}
function scriptLines(script: string) {
  return script.split(/\r?\n/).map(line => {
    const heading = /^\s{0,3}#{1,6}\s+/.test(line);
    const content = line.trim().replace(/^#{1,6}\s+/, "");
    const cue = cuePattern.exec(content);
    return { text: heading ? "" : cue ? cue[3] : line, start: cue ? cueSeconds(cue[1]) : undefined, end: cue?.[2] ? cueSeconds(cue[2]) : undefined };
  });
}
export function spokenScript(script: string): string {
  return normalizeWords(scriptLines(script).map(line => line.text).join("\n"));
}
export function validateStoryboardCoverage(script: string, value: unknown): Beat[] {
  const beats = validateStoryboard(value);
  const narration = spokenScript(script);
  if (!narration || !beats.length || beats.some(beat => !beat.text.trim()) || normalizeWords(beats.map(beat => beat.text).join(" ")) !== narration) throw new Error("Storyboard must preserve the complete approved voiceover once, in its original order");
  return beats;
}

export interface TimedScriptSegment { start: number; end: number; text: string; }
export function diagnosisTiming(script: string, duration: number, beats?: Beat[]): TimedScriptSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("A positive video duration is required for diagnosis timing");
  const lines = scriptLines(script);
  const segments: (TimedScriptSegment & { explicitEnd?: number })[] = [];
  let untimed = "";
  for (const line of lines) {
    if (line.start !== undefined) {
      if (line.start >= duration || (segments.length && line.start <= segments[segments.length - 1].start)) throw new Error("Script time cues must be ordered within the video");
      segments.push({ start: line.start, end: duration, explicitEnd: line.end, text: line.text });
    } else if (segments.length) segments[segments.length - 1].text += "\n" + line.text;
    else untimed += line.text;
  }
  if (segments.length) {
    if (untimed.trim()) throw new Error("Script narration before its first time cue has no established timing");
    return segments.map((segment, index) => {
      const end = segment.explicitEnd ?? segments[index + 1]?.start ?? duration;
      if (end <= segment.start || end > duration || (segments[index + 1] && end > segments[index + 1].start)) throw new Error("Script timing intervals overlap or exceed the video");
      return { start: segment.start, end, text: normalizeWords(segment.text) };
    }).filter(segment => segment.text);
  }
  if (beats?.length) {
    const validated = validateStoryboardCoverage(script, beats);
    let elapsed = 0;
    const timed = validated.map(beat => { const start = elapsed; elapsed += beat.seconds; return { start, end: elapsed, text: normalizeWords(beat.text) }; });
    if (elapsed > duration + 0.001) throw new Error("Storyboard timing exceeds the actual video duration");
    return timed;
  }
  throw new Error("Add verified script time cues or complete storyboard timing before requesting a diagnosis");
}
export function estimateCost(units: number, pricePerUnit: number): number {
  if (!Number.isFinite(units) || !Number.isFinite(pricePerUnit) || units < 0 || pricePerUnit < 0) throw new Error("Invalid cost estimate");
  return Math.ceil(units * pricePerUnit * 1_000_000) / 1_000_000;
}
export function parseJsonOutput(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(clean);
}
export const diagnosisSchema = z.object({ summary: z.string().min(1), findings: z.array(z.object({ timestamp: z.number().min(0), quote: z.string().min(1), observation: z.string().min(1), recommendation: z.string().min(1) })).min(1) });
export function validateDiagnosis(value: unknown, script: string, duration: number, beats?: Beat[]) {
  const parsed = diagnosisSchema.parse(value);
  const timing = diagnosisTiming(script, duration, beats);
  const normalized = spokenScript(script);
  for (const finding of parsed.findings) {
    const quote = normalizeWords(finding.quote);
    if (!quote || !normalized.includes(quote)) throw new Error("Diagnosis quoted text not present in the episode script");
    if (finding.timestamp >= duration) throw new Error("Diagnosis timestamp is outside the video");
    if (!timing.some(segment => finding.timestamp >= segment.start && finding.timestamp < segment.end && segment.text.includes(quote))) throw new Error("Diagnosis timestamp does not fall within the quoted beat's timing interval");
  }
  return parsed;
}
export function timestamp(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export interface RenderInput { title: string; beats: Beat[]; width: number; height: number; fps: number; assetPaths: Record<string, string>; audioPaths: string[]; }
export interface RenderEngine { readonly name: string; render(input: RenderInput, directory: string, signal: AbortSignal, onLog: (text: string) => void): Promise<string>; }
export * from "./channel-analytics";
export * from "./production-timeline";
export * from "./workflow";
