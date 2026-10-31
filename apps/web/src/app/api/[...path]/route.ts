import {routerConnector,saveProviderKey,serviceConnections,saveServiceConnection,checkService} from "../../../server/provider-credentials";
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { z, recordId, videoId, createEpisodeSchema, updateEpisodeSchema, quoteRequestSchema, localJobSchema, modelRouteSchema, assetKinds, type Channel, type Episode, type Asset, type Job, type Worker, type ModelRoute } from "@studio/core";
import { DriveConnector, ElevenLabsConnector, NineRouterConnector, YouTubeConnector, type YouTubeTokens } from "@studio/connectors";
import { db, DatabaseError, filterValue } from "../../../server/pocketbase";
import { authenticate, checkOrigin, sessionCookie, secretMatches, encrypt } from "../../../server/auth";
import { dashboard, configuration, episodeContext, episodeDetails, createEpisode, makeQuote, approveQuote, queueLocalJob, syncEpisode, syncAll, importSupplement, spending, spendingSchema, documentRevision } from "../../../server/service";
import { readDocument, readBeats, writeDocument, writeBeats, documentNames, readPlaybook,documentHistory,historicalDocument } from "../../../server/vault";
import { projectData, syncProject, syncProjectProfiles, videoAnalyticsData, syncVideoAnalytics } from "../../../server/projects";
import { createChannel } from "../../../server/channels";
import {workflowLibrary,workflowTemplate,createWorkflowTemplate,saveWorkflowTemplate,createWorkflowRun,workflowRunData,messageWorkflowRun,actWorkflowRun} from "../../../server/workflows";
import {workspaceData,channelPreferences,saveChannelPreferences,createProduction,discoveryData,addCompetitor,discover,saveReference,inspectReference,generateVideoReport,proposeTemplate,decideProposal,recoverTask} from "../../../server/workspace";
import {automationTick} from "../../../server/scheduler";
import {compositionData,saveComposition,queueComposition,reviewComposition,compositionJobCurrent} from "../../../server/compositions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const loginAttempts = new Map<string, { count: number; start: number }>();
async function body(request: NextRequest): Promise<unknown> {
  if (!request.body) return {};
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error("Request exceeds 2 MB"); } chunks.push(next.value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const parts = (await context.params).path; const route = parts.join("/"); const method = request.method;
  try {
    if (method !== "GET") checkOrigin(request);
    if (route === "status" && method === "GET") {
      try { const response = await fetch(db.url + "/api/health", { signal: AbortSignal.timeout(3000), cache: "no-store" }); return reply({ database: response.ok }); }
      catch { return reply({ database: false }); }
    }
    if (route === "login" && method === "POST") {
      const input = z.object({ email: z.email(), password: z.string().min(1).max(500) }).parse(await body(request));
      const key = request.headers.get("x-forwarded-for") || "local";
      let attempts = loginAttempts.get(key); if (!attempts || Date.now() - attempts.start > 60_000) { attempts = { count: 0, start: Date.now() }; loginAttempts.set(key, attempts); }
      if (++attempts.count > 8) return reply({ error: "Too many sign-in attempts. Wait one minute and try again." }, 429);
      const response = await fetch(db.url + "/api/collections/studio_users/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: input.email, password: input.password }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return reply({ error: "Email or password is incorrect." }, 401);
      const auth = await response.json() as { token: string; record: { id: string; email: string } }; loginAttempts.delete(key);
      const result = reply({ user: { id: auth.record.id, email: auth.record.email } });
      result.cookies.set(sessionCookie, auth.token, { httpOnly: true, secure: new URL(process.env.APP_URL || request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 86400 }); return result;
    }
    if (route.startsWith("worker/")) return handleWorker(request, parts.slice(1));
    if(route==="automation/tick"&&method==="POST"){
      if(!secretMatches(request.headers.get("authorization")?.replace(/^Bearer /,"")||"",process.env.AUTOMATION_TOKEN))return reply({error:"Unauthorized"},401);
      return reply(await automationTick());
    }
    if (route === "automation/sync" && method === "POST") {
      if (!secretMatches(request.headers.get("authorization")?.replace(/^Bearer /, "") || "", process.env.AUTOMATION_TOKEN)) return reply({ error: "Unauthorized" }, 401);
      return reply(await syncAll());
    }
    const user = await authenticate(request);
    if (!user) return reply({ error: "Sign in to Faceless Studio." }, 401);
    if (route === "me" && method === "GET") return reply({ user });
    if (route === "logout" && method === "POST") { const response = reply({ ok: true }); response.cookies.delete(sessionCookie); return response; }
    if(route==="settings/connections"&&method==="GET")return reply(await serviceConnections());
    if(route==="settings/connections"&&method==="PUT")return reply(await saveServiceConnection(await body(request)));
    if(route==="settings/connections/check"&&method==="POST")return reply(await checkService(z.object({provider:z.enum(["ninerouter","searxng","obscura"])}).parse(await body(request)).provider));
    if(route==="settings/keys"&&method==="POST")return reply(await saveProviderKey(await body(request)));
    if (route === "dashboard" && method === "GET") return reply(await dashboard());
    if(route==="workspace"&&method==="GET")return reply(await workspaceData());
    if(route==="workspace/episodes"&&method==="POST")return reply(await createProduction(await body(request),user.id),201);
    if(parts[0]==="workspace"&&parts[1]==="channels"&&parts[2]){
      const channel=recordId.parse(parts[2]);
      if(parts.length===3&&method==="GET")return reply(await channelPreferences(channel));
      if(parts.length===3&&method==="PUT")return reply(await saveChannelPreferences(channel,await body(request)));
      if(parts[3]==="discovery"&&method==="GET")return reply(await discoveryData(channel));
      if(parts[3]==="discovery"&&method==="POST")return reply(await discover(channel,await body(request)));
      if(parts[3]==="competitors"&&method==="POST")return reply(await addCompetitor(channel,await body(request)),201);
      if(parts[3]==="references"&&parts[4]&&method==="PUT")return reply(await saveReference(channel,parts[4],await body(request)));
      if(parts[3]==="references"&&parts[4]&&parts[5]==="inspect"&&method==="POST")return reply(await inspectReference(channel,parts[4]));
      if(parts[3]==="reports"&&parts[4]&&method==="POST"){const range=z.object({start:z.string(),end:z.string()}).strict().parse(await body(request));return reply(await generateVideoReport(channel,parts[4],range));}
      if(parts[3]==="tasks"&&parts[4]&&method==="POST")return reply(await recoverTask(channel,parts[4],await body(request)));
      if(parts[3]==="proposals"&&parts.length===4&&method==="POST")return reply(await proposeTemplate(channel,await body(request)),201);
      if(parts[3]==="proposals"&&parts[4]&&method==="POST")return reply(await decideProposal(channel,parts[4],await body(request)));
    }
    if(route==="workflows"&&method==="GET")return reply(await workflowLibrary());
    if(route==="workflows"&&method==="POST")return reply(await createWorkflowTemplate(await body(request)),201);
    if(parts[0]==="workflows"&&parts[1]){
      if(parts.length===2&&method==="GET")return reply(await workflowTemplate(parts[1]));
      if(parts.length===2&&method==="PUT")return reply(await saveWorkflowTemplate(parts[1],await body(request)));
      if(parts.length===3&&parts[2]==="playbook"&&method==="GET"){const template=await workflowTemplate(parts[1]);return reply({content:template.playbook_content??(template.playbook_path?await readPlaybook(template.playbook_path):template.instructions)});}
    }
    if(route==="workflow-runs"&&method==="POST")return reply(await createWorkflowRun(await body(request),user.id),201);
    if(parts[0]==="workflow-runs"&&parts[1]){
      const id=recordId.parse(parts[1]);
      if(parts.length===2&&method==="GET")return reply(await workflowRunData(id));
      if(parts.length===3&&parts[2]==="messages"&&method==="POST")return reply(await messageWorkflowRun(id,await body(request),user.id));
      if(parts.length===3&&parts[2]==="actions"&&method==="POST")return reply(await actWorkflowRun(id,await body(request),user.id));
    }
    if (route === "channels" && method === "POST") return reply(await createChannel(await body(request)),201);
    if (route === "projects/sync" && method === "POST") return reply(await syncProjectProfiles());
    if (parts[0] === "projects" && parts[1]) {
      if(parts[2]==="videos"&&parts[3]){
        const channelId=recordId.parse(parts[1]),selectedVideo=videoId.parse(parts[3]);
        if(parts.length===4&&method==="GET")return reply(await videoAnalyticsData(channelId,selectedVideo,request.nextUrl.searchParams.get("start")||"",request.nextUrl.searchParams.get("end")||""));
        if(parts.length===5&&parts[4]==="sync"&&method==="POST"){const range=z.object({start:z.string(),end:z.string()}).parse(await body(request));return reply(await syncVideoAnalytics(channelId,selectedVideo,range.start,range.end));}
      }
      const id = recordId.parse(parts[1]);
      if (parts.length === 2 && method === "GET") return reply(await projectData(id, request.nextUrl.searchParams.get("start") || "", request.nextUrl.searchParams.get("end") || ""));
      if (parts.length === 3 && parts[2] === "sync" && method === "POST") {
        const input = z.object({ start: z.string(), end: z.string() }).strict().parse(await body(request));
        return reply(await syncProject(id, input.start, input.end));
      }
    }
    if (route === "episodes" && method === "POST") return reply(await createEpisode(createEpisodeSchema.parse(await body(request))), 201);
    if (parts[0] === "episodes" && parts[1]) {
      const id = recordId.parse(parts[1]);
      if(parts[2]==="composition"){
        if(parts.length===3&&method==="GET")return reply(await compositionData(id));
        if(parts.length===3&&method==="PUT")return reply(await saveComposition(id,await body(request)));
        if(parts[3]==="queue"&&method==="POST"){const input=z.object({mode:z.enum(["storyboard","render"])}).strict().parse(await body(request));return reply(await queueComposition(id,input.mode));}
        if(parts[3]==="review"&&method==="POST")return reply(await reviewComposition(id,await body(request)));
      }
      if(parts[2]==="history"&&method==="GET"){const {episode}=await episodeContext(id);const name=z.enum(documentNames).parse(request.nextUrl.searchParams.get("name"));const revision=request.nextUrl.searchParams.get("revision");return reply(revision?{content:await historicalDocument(episode.vault_path,name,revision)}:await documentHistory(episode.vault_path,name));}
      if (parts.length === 2 && method === "GET") return reply(await episodeDetails(id));
      if (parts.length === 2 && method === "PATCH") {
        const { script_revision, ...update } = updateEpisodeSchema.parse(await body(request));
        if (update.status !== undefined || update.published_at !== undefined) {
          const previous = await db.get<Episode>("episodes", id);
          if (update.published_at && (update.status || previous.status) !== "published") throw new Error("Mark the episode published after your manual upload before recording its publication time.");
          if (update.status && (update.status !== "published" || (previous.status !== "published" && update.published_at === undefined))) update.published_at = "";
        }
        let script_meta: Record<string, unknown> | undefined;
        if (update.script_approved !== undefined) {
          const ctx = await episodeContext(id); const script = await readDocument(ctx.episode.vault_path, "script.md");
          if (update.script_approved && !script.trim()) throw new Error("Save a complete script before approving it.");
          if (update.script_approved && script_revision !== documentRevision(script)) return reply({ error: "The script changed since you opened it. Reopen and review the current complete script before approving." }, 409);
          script_meta = { ...ctx.episode.script_meta };
          if (update.script_approved) script_meta.approved_revision = documentRevision(script); else delete script_meta.approved_revision;
        }
        return reply(await db.update("episodes", id, { ...update, ...(script_meta ? { script_meta } : {}) }));
      }
      if (parts[2] === "documents" && method === "PUT") {
        const input = z.object({ name: z.enum(documentNames), content: z.string().max(1_000_000), revision: z.string().length(64) }).parse(await body(request));
        const { episode } = await episodeContext(id); const current = await readDocument(episode.vault_path, input.name);
        if (createHash("sha256").update(current).digest("hex") !== input.revision) return reply({ error: "This document changed in another session. Reopen the episode before saving; your editor text is preserved." }, 409);
        await writeDocument(episode.vault_path, input.name, input.content);
        const latest=await db.get<Episode>("episodes",id);const script_meta={...latest.script_meta,document_revisions:{...(latest.script_meta.document_revisions as Record<string,string>||{}),[input.name]:documentRevision(input.content)}};
        await db.update("episodes",id,{script_meta,...(input.name==="script.md"?{script_approved:false,status:"script"}:{})});
        return reply({ revision: createHash("sha256").update(input.content).digest("hex"), message: "Saved to the vault. Previous text is retained in .studio-history." });
      }
    }
    if (route === "quotes" && method === "POST") return reply(await makeQuote(quoteRequestSchema.parse(await body(request)), user.id), 201);
    if (parts[0] === "quotes" && parts[2] === "approve" && method === "POST") return reply(await approveQuote(recordId.parse(parts[1]), user.id));
    if (route === "jobs" && method === "POST") return reply(await queueLocalJob(localJobSchema.parse(await body(request))), 201);
    if (parts[0] === "jobs" && parts[2] === "cancel" && method === "POST") {
      return reply(await db.custom("cancel", { job_id: recordId.parse(parts[1]) }));
    }
    if (parts[0] === "assets" && parts[1] && parts[1] !== "upload") {
      const id = recordId.parse(parts[1]);
      if (method === "PATCH") return reply(await db.update("assets", id, z.object({ selected: z.boolean() }).parse(await body(request))));
      if (method === "GET" && parts[2] === "preview") return previewAsset(request, await db.get<Asset>("assets", id));
    }
    if (route === "assets/upload" && method === "POST") {
      const length = Number(request.headers.get("content-length") || 0); if (length > 101_000_000) throw new Error("Upload exceeds 100 MB. Use the worker for larger files.");
      const form = await request.formData(); const episodeId = recordId.parse(form.get("episode")); const kind = z.enum(assetKinds).parse(form.get("kind")); const file = form.get("file");
      if (!(file instanceof File) || file.size > 100_000_000 || file.size === 0) throw new Error("Choose a non-empty media file under 100 MB.");
      const extension = path.extname(file.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mp3", ".wav", ".m4a", ".flac"].includes(extension)) throw new Error("Unsupported media format");
      const { driveBase } = await episodeContext(episodeId); const directory = path.resolve(process.env.STUDIO_CACHE_ROOT || ".cache", "uploads"); await mkdir(directory, { recursive: true });
      const filename = `01_upload-${randomBytes(6).toString("hex")}_v1${extension}`; const local = path.join(directory, filename); await writeFile(local, Buffer.from(await file.arrayBuffer()));
      const folder = { image: "stills", video: "clips", vo: "vo", sfx: "sfx", bgm: "bgm", music: "music", render: "renders", thumb: "thumb" }[kind];
      const saved = await new DriveConnector().upload(local, `${driveBase}/${folder}/${filename}`);
      return reply(await db.create<Asset>("assets", { episode: episodeId, kind, drive_file_id: saved.id, drive_path: saved.path, source: "upload", selected: true, meta: { filename: file.name, size: saved.size } }), 201);
    }
    if (route === "analytics/sync" && method === "POST") {
      const input = z.object({ episode: recordId.optional(), days: z.number().int().min(1).max(365).default(28) }).parse(await body(request));
      return reply(input.episode ? await syncEpisode(input.episode, input.days) : await syncAll());
    }
    if (route === "analytics/import" && method === "POST") { const input = z.object({ episode: recordId, csv: z.string().min(1).max(1_000_000) }).parse(await body(request)); return reply(await importSupplement(input.episode, input.csv)); }
    if (route === "settings/spending" && method === "PUT") { const setting = await spending(); return reply(await db.update("settings", setting.id, { value: spendingSchema.parse(await body(request)) })); }
    if (route === "settings/models" && method === "PUT") {
      const input = modelRouteSchema.parse(await body(request)); const [existing] = await db.list<ModelRoute>("model_routes", `task=${filterValue(input.task)}`);
      return reply(existing ? await db.update("model_routes", existing.id, input) : await db.create("model_routes", input));
    }
    if (route === "connections/check" && method === "POST") {
      const input = z.object({ provider: z.enum(["drive", "ninerouter", "elevenlabs"]) }).parse(await body(request));
      if (input.provider === "drive") return reply(await new DriveConnector().check());
      if (input.provider === "elevenlabs") return reply(await new ElevenLabsConnector().check());
      return reply({ connected: true, models: await (await routerConnector()).models(), message: "9Router connection verified." });
    }
    if (route === "oauth/start" && method === "GET") {
      const channelId = recordId.parse(request.nextUrl.searchParams.get("channel")); await db.get<Channel>("channels", channelId);
      if (!configuration().google) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment first.");
      const state = randomBytes(24).toString("hex"); const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL}/api/oauth/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly", access_type: "offline", prompt: "consent", state }).toString();
      const response = NextResponse.redirect(url); response.cookies.set("studio_oauth", encrypt({ state, channel: channelId, owner: user.id }), { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/api/oauth", maxAge: 600 }); return response;
    }
    if (route === "oauth/callback" && method === "GET") {
      const { decrypt } = await import("../../../server/auth");
      const saved = request.cookies.get("studio_oauth")?.value; if (!saved) throw new Error("OAuth state expired. Start the connection again.");
      const pending = decrypt<{ state: string; channel: string; owner: string }>(saved);
      if (pending.owner !== user.id || !secretMatches(request.nextUrl.searchParams.get("state") || "", pending.state)) throw new Error("OAuth state did not match. Start again.");
      const code = request.nextUrl.searchParams.get("code"); if (!code) throw new Error("Google authorization was not completed.");
      const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL}/api/oauth/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Google token exchange failed. Reconnect this channel.");
      const tokens = await response.json() as YouTubeTokens & { expires_in: number };
      if (!tokens.refresh_token) throw new Error("Google did not return offline authorization. Revoke the previous grant and reconnect.");
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
      const ownChannel = await new YouTubeConnector(tokens).ownChannel(); const channel = await db.get<Channel>("channels", pending.channel);
      if (channel.youtube_channel_id && ownChannel.id !== channel.youtube_channel_id) throw new Error("The authorized account belongs to another channel.");
      const duplicate=await db.list<Channel>("channels",`youtube_channel_id=${filterValue(ownChannel.id)}`);
      if(duplicate.some(item=>item.id!==channel.id))throw new Error("This YouTube channel is already connected to another project. Open that project instead.");
      const credentials = channel.oauth_ref ? await db.update<{ id: string }>("oauth_credentials", channel.oauth_ref, { ciphertext: encrypt(tokens) }) : await db.create<{ id: string }>("oauth_credentials", { channel: channel.id, ciphertext: encrypt(tokens) });
      await db.update("channels", channel.id, { youtube_channel_id: ownChannel.id, oauth_ref: credentials.id });
      const done = NextResponse.redirect(new URL("/?view=channel&channel="+pending.channel+"&tab=settings&connected=youtube", process.env.APP_URL || request.url)); done.cookies.delete("studio_oauth"); return done;
    }
    return reply({ error: "API route not found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return reply({ error: error.issues.map(issue => issue.message).join("; ") }, 400);
    if (error instanceof DatabaseError) return reply({ error: error.message }, error.status >= 400 && error.status < 500 ? error.status : 503);
    const message = error instanceof Error ? error.message : "Unexpected request failure";
    return reply({ error: message.includes("fetch failed") ? "A service is unreachable. Check Connections and the server logs." : message }, 400);
  }
}

async function handleWorker(request: NextRequest, parts: string[]) {
  if (!secretMatches(request.headers.get("authorization")?.replace(/^Bearer /, "") || "", process.env.WORKER_TOKEN)) return reply({ error: "Unauthorized worker" }, 401);
  const route = parts.join("/");
  if (route === "heartbeat" && request.method === "POST") {
    const input = z.object({ worker_key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), hostname: z.string().min(1).max(120), capabilities: z.array(z.enum(["render", "music", "ffmpeg", "image", "video"])).max(5), gpu: z.string().max(300).default("") }).parse(await body(request));
    const [existing] = await db.list<Worker>("workers", `worker_key=${filterValue(input.worker_key)}`); const data = { ...input, heartbeat: new Date().toISOString() };
    return reply(existing ? await db.update("workers", existing.id, data) : await db.create("workers", data));
  }
  if (route === "claim" && request.method === "POST") { const input = z.object({ worker_id: recordId }).parse(await body(request)); return reply(await db.custom("claim", input)); }
  if (parts[0] === "jobs" && parts[1]) {
    const job = await db.get<Job & { cancel_requested: boolean }>("jobs", recordId.parse(parts[1]));
    if(parts[2]==="validate"&&request.method==="POST"){const input=z.object({worker_id:recordId}).parse(await body(request));if(job.worker_id!==input.worker_id||job.status!=="running")throw new Error("Worker no longer owns this job");return await compositionJobCurrent(job)?reply({valid:true}):reply({error:"The queued composition source changed. This job will not execute."},409);}
    if (request.method === "GET") return reply(job);
    const input = z.object({ worker_id: recordId, progress: z.number().min(0).max(100), log: z.string().max(100_000) }).parse(await body(request));
    if (job.worker_id !== input.worker_id || job.status !== "running") throw new Error("Worker no longer owns this job");
    return reply(await db.custom("progress", { job_id: job.id, ...input }));
  }
  if (route === "complete" && request.method === "POST") {
    const input = z.object({ worker_id: recordId, job_id: recordId, error: z.string().max(20_000).optional(), asset: z.object({ drive_file_id: z.string().max(500), drive_path: z.string().max(1000), kind: z.enum(assetKinds), source: z.enum(["flow", "acestep", "render", "ffmpeg"]), meta: z.record(z.string(), z.unknown()) }).optional() }).parse(await body(request));
    const job=await db.get<Job>("jobs",input.job_id);const obsolete=job.payload.composition_hash?!await compositionJobCurrent(job):false;
    const completed = await db.custom<{ job: Job; asset?: Asset }>("complete", {...input,obsolete});
    if (completed.asset && !completed.job.payload.composition_hash && ["image", "video"].includes(completed.asset.kind)) {
      const { episode } = await episodeContext(completed.job.episode); const beatIndex = Number(completed.job.payload.beat);
      if (beatIndex) { const beats = await readBeats(episode.vault_path); const beat = beats.find(item => item.index === beatIndex); if (beat) { if (completed.asset.kind === "image") beat.image = completed.asset.id; else beat.video = completed.asset.id; await writeBeats(episode.vault_path, beats); } }
    }
    return reply(completed);
  }
  return reply({ error: "Worker route not found" }, 404);
}

async function previewAsset(request: NextRequest, asset: Asset) {
  const extension = path.extname(asset.drive_path).toLowerCase(); const root = path.resolve(process.env.STUDIO_CACHE_ROOT || ".cache", "previews"); await mkdir(root, { recursive: true }); const local = path.join(root, asset.id + extension);
  try { await stat(local); } catch { await new DriveConnector().download(asset.drive_path, local); }
  const size = (await stat(local)).size; const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac" };
  const headers: Record<string, string> = { "Content-Type": types[extension] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" };
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
    if (start >= size || end < start) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`; headers["Content-Length"] = String(end - start + 1);
    return new NextResponse(Readable.toWeb(createReadStream(local, { start, end })) as ReadableStream<Uint8Array>, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new NextResponse(Readable.toWeb(createReadStream(local)) as ReadableStream<Uint8Array>, { headers });
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
