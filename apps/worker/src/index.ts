import os from "node:os";
import path from "node:path";
import { mkdir, copyFile, realpath, readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { type Job, type Worker, type Beat, type Asset, type CompositionSource, recordId } from "@studio/core";
import { DriveConnector, ACEStepConnector, FlowConnector, run, requireCappedFlow } from "@studio/connectors";
import { HyperFramesEngine,renderCodeComposition } from "@studio/render-hyperframes";

const server = (process.env.WORKER_SERVER_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const token = process.env.WORKER_TOKEN;
if (!token) throw new Error("Set WORKER_TOKEN before starting the worker.");
const cacheRoot = path.resolve(process.env.WORKER_CACHE_ROOT || "D:/StudioCache");
const baseCapabilities = (process.env.WORKER_CAPABILITIES || "render,music,ffmpeg,image,video").split(",").filter(type => ["render", "music", "ffmpeg", "image", "video", "analyze"].includes(type));
let capabilities = baseCapabilities.filter(type => !["image", "video"].includes(type));
let worker: Worker | undefined, active: { job: Job; controller: AbortController; log: string; progress: number } | undefined, stopped = false;
const drive = new DriveConnector(), flow = new FlowConnector();
async function api<T>(route: string, payload?: unknown): Promise<T> {
  const response = await fetch(`${server}/api/worker/${route}`, { method: payload === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`); return data as T;
}
async function heartbeat() {
  worker = await api<Worker>("heartbeat", { worker_key: process.env.WORKER_ID || os.hostname().replace(/[^a-zA-Z0-9_-]/g, "-"), hostname: os.hostname(), capabilities: process.env.RCLONE_REMOTE ? capabilities : capabilities.filter(type => type === "analyze"), gpu: process.env.WORKER_GPU || "" });
  if (active) {
    const remote = await api<Job & { cancel_requested: boolean }>(`jobs/${active.job.id}`);
    if (remote.cancel_requested || remote.status !== "running" || remote.worker_id !== worker.id) active.controller.abort(new Error("Job cancelled or worker lease lost"));
    else await api(`jobs/${active.job.id}`, { worker_id: worker.id, progress: active.progress, log: active.log.slice(-90_000) });
  }
}
async function refreshFlow() {
  try {
    const status = await flow.status();
    requireCappedFlow(status);
    const ready = status.extensionConnected === true && status.grokVisible === true && status.loggedIn === true && !status.duplicateInstalls;
    capabilities = baseCapabilities.filter(type => ready || !["image", "video"].includes(type));
  } catch { capabilities = baseCapabilities.filter(type => !["image", "video"].includes(type)); }
}
async function execute(job: Job) {
  recordId.parse(job.id);
  const directory = path.join(cacheRoot, job.id); await mkdir(directory, { recursive: true });
  const controller = new AbortController(); active = { job, controller, log: "Started. One local job at a time.\n", progress: 1 };
  const state = active; const log = (value: string) => { state.log = (state.log + value).slice(-90_000); console.log(value.trim()); };
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(7_200_000)]);
  try {
    if (job.type === "analyze") { await analyze(job, directory, signal, log); console.log(`Analyzed ${job.id}.`); return; }
    const payload = job.payload; const driveBase = String(payload.drive_base || "");
    if(payload.composition)await api("jobs/"+job.id+"/validate",{worker_id:worker!.id});
    if (!driveBase.startsWith("Faceless/") || driveBase.includes("..")) throw new Error("Invalid episode Drive folder");
    let output: string, kind: Asset["kind"], source: string;
    if (job.type === "music") {
      kind = "music"; source = "acestep";
      output = await new ACEStepConnector().music({ prompt: String(payload.prompt || ""), lyrics: String(payload.lyrics || ""), seconds: Number(payload.seconds || 30), seed: Number(payload.seed || 42) }, path.join(directory, "music.wav"), signal, log);
    } else if (job.type === "image" || job.type === "video") {
      if (!payload.spend_id) throw new Error("Generation job is missing its approved spending reservation");
      kind = job.type; source = "flow";
      let reference: string | undefined;
      if (payload.reference) {
        const image = payload.reference as { id: string; drive_path: string }; recordId.parse(image.id);
        reference = await drive.download(image.drive_path, path.join(directory, "reference" + path.extname(image.drive_path)), signal);
      }
      const generated = await flow.generate({ kind, prompt: String(payload.input || ""), model: String(payload.model || ""), aspectRatio: payload.format === "long" ? "16:9" : "9:16", jobId: job.id, reference }, signal);
      output = path.join(directory, "output" + path.extname(generated)); await copyFile(generated, output);
    } else {
      const assets = payload.assets as Pick<Asset, "id" | "kind" | "drive_path" | "meta">[];
      if (!Array.isArray(assets)) throw new Error("Render job has no asset manifest");
      const paths: Record<string, string> = {}, audio: string[] = [];
      const ordered = [...assets].sort((a, b) => (a.kind === "vo" ? -1 : 1) - (b.kind === "vo" ? -1 : 1));
      for (const [index, asset] of ordered.entries()) {
        recordId.parse(asset.id); const local = path.join(directory, "source", asset.id + path.extname(asset.drive_path));
        await drive.download(asset.drive_path, local, signal);
        if (["image", "video"].includes(asset.kind)) paths[asset.id] = local;
        if (["vo", "bgm", "music", "sfx"].includes(asset.kind)) audio.push(local);
        state.progress = 5 + Math.round((index + 1) / Math.max(1, ordered.length) * 20);
      }
      kind = "render"; source = job.type === "ffmpeg" ? "ffmpeg" : "render";
      if (job.type === "render") {
        if(payload.composition){
          const mode=payload.composition_mode==="storyboard"?"storyboard":"render";
          if(mode==="render"){
            const takes=assets.filter(a=>a.kind==="vo");if(takes.length!==1)throw new Error("Composition render requires one narration take.");
            const probe=JSON.parse(await run("ffprobe",["-v","error","-show_format","-of","json",audio[0]],{signal}));if(!Number.isFinite(Number(probe.format?.duration))||Number(probe.format.duration)>(payload.composition as CompositionSource).duration+.05)throw new Error("Narration would be truncated by this composition. Extend the animation and review it again.");
          }
          output=await renderCodeComposition({source:payload.composition as CompositionSource,hash:String(payload.composition_hash),mode,time:Number(payload.time||0),audioPaths:audio},path.join(directory,"composition-"+Date.now()),signal,log);
          if(mode==="storyboard")kind="image";
        }else{
        output = await new HyperFramesEngine().render({ title: String(payload.title || "Episode"), beats: payload.beats as Beat[], width: payload.format === "long" ? 1920 : 1080, height: payload.format === "long" ? 1080 : 1920, fps: 24, assetPaths: paths, audioPaths: audio }, path.join(directory, "composition"), signal, log);
        }
      } else {
        const video = assets.find(asset => asset.kind === "render"); if (!video) throw new Error("Select a render to transcode");
        const sourceFile = path.join(directory, "source", video.id + path.extname(video.drive_path));
        await drive.download(video.drive_path, sourceFile, signal); output = path.join(directory, "delivery.mp4");
        await run(process.env.FFMPEG_BIN || "ffmpeg", ["-y", "-i", sourceFile, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output], { signal, onLog: log });
      }
    }
    if (signal.aborted) throw new Error("Job cancelled before upload");
    state.progress = 90;
    const folder = { image: "stills", video: "clips", music: "music", render: "renders" }[kind as "image" | "video" | "music" | "render"];
    const name = `${String(Number(job.payload.beat) || 1).padStart(2, "0")}_${kind}-${job.id}_v1${path.extname(output)}`;
    const saved = await drive.upload(output, `${driveBase}/${folder}/${name}`, signal);
    await api("complete", { worker_id: worker!.id, job_id: job.id, asset: { drive_file_id: saved.id, drive_path: saved.path, kind, source, meta: { size: saved.size, beat: payload.beat, engine: job.type === "render" ? "hyperframes@0.8.209" : undefined, composition_hash:payload.composition_hash,composition_mode:payload.composition_mode,cache: output } } });
    console.log(`Completed ${job.id}; master uploaded to Drive.`);
  } catch (error) {
    const message = (error as Error).message; console.error(`Job ${job.id}: ${message}`);
    try { await api("complete", { worker_id: worker!.id, job_id: job.id, error: message + `\nRecovery cache retained: ${directory}` }); } catch (reportError) { console.error(`Could not report completion: ${(reportError as Error).message}. No job was resubmitted.`); }
  } finally { active = undefined; }
}

// For You deep analysis: yt-dlp download, ffmpeg frames, optional Whisper transcript.
// Scoring happens on the server; failures are reported there so the analysis never stays queued.
async function analyze(job: Job, directory: string, signal: AbortSignal, log: (value: string) => void) {
  const analysis_id = String(job.payload.analysis_id || ""), url = String(job.payload.url || "");
  try {
    if (!/^https?:\/\//.test(url)) throw new Error("Invalid analysis URL");
    const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg", source = path.join(directory, "video.mp4");
    log("Downloading video with yt-dlp.\n");
    try { await run(process.env.YTDLP_BIN || "yt-dlp", ["--no-playlist", "--max-filesize", "300M", "-f", "mp4/best[height<=720]/best", "--merge-output-format", "mp4", "-o", source, url], { signal, onLog: log }); }
    catch (error) { throw new Error("yt-dlp gagal atau belum terpasang di PC (atur YTDLP_BIN). " + (error as Error).message.slice(0, 300)); }
    await run(ffmpeg, ["-y", "-i", source, "-vf", "fps=1/2,scale=512:-2", "-frames:v", "12", "-q:v", "5", path.join(directory, "frame-%02d.jpg")], { signal, onLog: log });
    const frames = (await readdir(directory)).filter(name => /^frame-\d+\.jpg$/.test(name)).sort();
    let transcript = "";
    if (process.env.WHISPER_BIN) {
      log("Transcribing audio.\n"); const wav = path.join(directory, "audio.wav");
      await run(ffmpeg, ["-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", wav], { signal, onLog: log });
      await run(process.env.WHISPER_BIN, [wav, "--model", process.env.WHISPER_MODEL || "small", "--output_format", "txt", "--output_dir", directory], { signal, onLog: log });
      transcript = (await readFile(path.join(directory, "audio.txt"), "utf8").catch(() => "")).slice(0, 60_000);
    }
    await api("analysis", { worker_id: worker!.id, job_id: job.id, analysis_id, transcript, frames: await Promise.all(frames.map(async name => (await readFile(path.join(directory, name))).toString("base64"))) });
  } catch (error) { await api("analysis", { worker_id: worker!.id, job_id: job.id, analysis_id, error: (error as Error).message }); }
}

let lastHeartbeat = 0;
const heartbeatTimer = setInterval(() => { void heartbeat().then(() => { lastHeartbeat = Date.now(); }).catch(error => { console.error((error as Error).message); if (active && Date.now() - lastHeartbeat > 60_000) active.controller.abort(new Error("Server heartbeat lost")); }); }, 15_000);
const flowTimer = setInterval(() => { if (!active) void refreshFlow(); }, 60_000);
for (const name of ["SIGINT", "SIGTERM"] as const) process.on(name, () => { stopped = true; active?.controller.abort(); clearInterval(heartbeatTimer); clearInterval(flowTimer); });
console.log(`Faceless Studio worker connecting to ${server}. Cache: ${cacheRoot}`);
void refreshFlow();
while (!stopped) {
  try {
    await heartbeat(); lastHeartbeat = Date.now();
    const result = await api<{ job: Job | null }>("claim", { worker_id: worker!.id });
    if (result.job) await execute(result.job); else await delay(5000);
  } catch (error) { console.error((error as Error).message); await delay(5000); }
}
