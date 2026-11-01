import "server-only";
import { recordId, videoId as youtubeVideoId, reportRange, validateReportRange, type Channel, type ChannelReport, type ChannelVideo, type ProjectData, type VideoAnalyticsData, type AnalyticsMetrics, type Snapshot, type Episode, type Asset } from "@studio/core";
import { db, filterValue } from "./pocketbase";
import { youtubeFor } from "./service";
import { DriveConnector, type DriveFile } from "@studio/connectors";
import { channelPreferences } from "./workspace";
import { ensureProjectWorkspace } from "./project-workspace";
import path from "node:path";
import { existsSync } from "node:fs";

interface ReportCache { id: string; report: ChannelReport; }
interface CatalogCache { id: string; videos: ChannelVideo[]; catalog: ProjectData["catalog"]; }
const scope = (channel: Channel) => `channel=${filterValue(channel.id)} && youtube_channel_id=${filterValue(channel.youtube_channel_id)}`;
const rangeScope = (channel: Channel, start: string, end: string) => `${scope(channel)} && start_date=${filterValue(start)} && end_date=${filterValue(end)}`;
const identity = (channel: Channel): ProjectData["channel"] => ({ id: channel.id, name: channel.name, handle: channel.handle, color: channel.color, youtube_channel_id: channel.youtube_channel_id, oauth_ref: channel.oauth_ref, ...(channel.profile ? { profile: channel.profile } : {}) });
const syncs = new Map<string, Promise<unknown>>();
async function serialize<T>(channel: string, action: () => Promise<T>): Promise<T> {
  const previous = syncs.get(channel);
  const current = (previous || Promise.resolve()).catch(() => undefined).then(action);
  syncs.set(channel, current);
  try { return await current; } finally { if (syncs.get(channel) === current) syncs.delete(channel); }
}

export async function projectData(id: string, start: string, end: string): Promise<ProjectData> {
  recordId.parse(id); validateReportRange(start, end);
  const channel = await db.get<Channel>("channels", id);
  await ensureProjectWorkspace(channel).catch(() => undefined);
  const [[report], [catalog]] = await Promise.all([
    db.list<ReportCache>("channel_reports", rangeScope(channel, start, end), "-updated", 1),
    db.list<CatalogCache>("channel_catalogs", scope(channel), "-updated", 1)
  ]);
  return { channel: identity(channel), report: report?.report || null, videos: catalog?.videos || [], catalog: catalog?.catalog || { synced_at: null, complete: false } };
}

export async function syncProject(id: string, start: string, end: string): Promise<ProjectData> {
  recordId.parse(id); validateReportRange(start, end);
  return serialize(id, async () => {
    const channel = await db.get<Channel>("channels", id);
    const youtube = await youtubeFor(channel);
    // Profile lookup verifies the token's channel before any data can be stored.
    const profile = await youtube.channelProfile(channel.youtube_channel_id);
    const report = await youtube.channelAnalytics(channel.youtube_channel_id, start, end);
    const fetched = await youtube.channelVideos(channel.youtube_channel_id);
    const [[existingReport], [existingCatalog]] = await Promise.all([
      db.list<ReportCache>("channel_reports", rangeScope(channel, start, end), "-updated", 1),
      db.list<CatalogCache>("channel_catalogs", scope(channel), "-updated", 1)
    ]);
    // Merge successfully refreshed uploads so an unavailable old video cannot freeze new history.
    const retainHistory = !fetched.complete && Boolean(existingCatalog?.videos?.length);
    const videos = retainHistory ? [...new Map([...existingCatalog!.videos, ...fetched.videos].map(video => [video.id, video])).values()] : fetched.videos;
    const catalog: ProjectData["catalog"] = retainHistory && !fetched.videos.length
      ? { ...existingCatalog!.catalog, complete: false, error: `${fetched.error || "Upload refresh was incomplete."} Showing the previous cached catalog.` }
      : { synced_at: fetched.synced_at, complete: fetched.complete, ...(fetched.error || retainHistory ? { error: `${fetched.error || "Upload refresh was incomplete."}${retainHistory ? ` Unavailable uploads retain older cached metadata from ${existingCatalog!.catalog.synced_at || "the previous sync"}.` : ""}` } : {}) };
    const reportInput = { channel: id, youtube_channel_id: channel.youtube_channel_id, start_date: start, end_date: end, report };
    const catalogInput = { channel: id, youtube_channel_id: channel.youtube_channel_id, videos, catalog };
    await (existingReport ? db.update("channel_reports", existingReport.id, reportInput) : db.create("channel_reports", reportInput));
    await (existingCatalog ? db.update("channel_catalogs", existingCatalog.id, catalogInput) : db.create("channel_catalogs", catalogInput));
    await db.update("channels", id, { profile });
    return { channel: identity({ ...channel, profile }), report, videos, catalog };
  });
}

export async function syncProjectProfiles() {
  const channels = await db.list<Channel>("channels", "", "name");
  const results: { channel: string; error?: string }[] = [];
  for (const channel of channels) {
    if (!channel.oauth_ref) { results.push({ channel: channel.name, error: "Channel is not connected to YouTube." }); continue; }
    try {
      await serialize(channel.id, async () => {
        const youtube = await youtubeFor(channel); const profile = await youtube.channelProfile(channel.youtube_channel_id);
        await db.update("channels", channel.id, { profile });
      });
      results.push({ channel: channel.name });
    } catch (error) { results.push({ channel: channel.name, error: error instanceof Error ? error.message : "Channel profile refresh failed." }); }
  }
  return { results };
}

export async function syncDefaultProject(id: string) { const range = reportRange(28); return syncProject(id, range.start, range.end); }

interface VideoCache {id:string;video:ChannelVideo;report:ChannelReport;metrics:AnalyticsMetrics;}
const videoScope=(channel:Channel,videoId:string,start:string,end:string)=>`${rangeScope(channel,start,end)} && video_id=${filterValue(videoId)}`;
async function matchingSnapshot(channel:Channel,videoId:string,start:string,end:string){
  const [episode]=await db.list<Episode>("episodes",`channel=${filterValue(channel.id)} && youtube_video_id=${filterValue(videoId)}`);
  if(!episode)return null;
  // Diagnosis and CSV import operate on the production's latest snapshot. Older
  // range caches remain readable, but must not target a different saved report.
  const [latest]=await db.list<Snapshot>("analytics_snapshots",`episode=${filterValue(episode.id)} && video_id=${filterValue(videoId)}`,"-created",1);
  return latest?.metrics.start_date===start&&latest.metrics.end_date===end?latest:null;
}
export async function videoAnalyticsData(id:string,videoId:string,start:string,end:string):Promise<VideoAnalyticsData>{
  recordId.parse(id);youtubeVideoId.parse(videoId);validateReportRange(start,end);
  const channel=await db.get<Channel>("channels",id);
  const [[cached],[catalog],snapshot]=await Promise.all([db.list<VideoCache>("video_reports",videoScope(channel,videoId,start,end),"-updated",1),db.list<CatalogCache>("channel_catalogs",scope(channel),"-updated",1),matchingSnapshot(channel,videoId,start,end)]);
  const metrics=cached?.metrics?{...cached.metrics,...(snapshot?{ctr:snapshot.metrics.ctr,viewed_vs_swiped:snapshot.metrics.viewed_vs_swiped}:{})}:null;
  const sameReport=cached&&snapshot&&(["duration_seconds","views","avg_view_duration","average_view_percentage","retention"] as const).every(key=>JSON.stringify(cached.metrics[key])===JSON.stringify(snapshot.metrics[key]));
  return {channel:identity(channel),video:cached?.video||catalog?.videos.find(video=>video.id===videoId)||null,report:cached?.report||null,metrics,snapshot:sameReport?snapshot:null};
}
export async function syncVideoAnalytics(id:string,videoId:string,start:string,end:string):Promise<VideoAnalyticsData>{
  recordId.parse(id);youtubeVideoId.parse(videoId);validateReportRange(start,end);
  return serialize(id,async()=>{
    const channel=await db.get<Channel>("channels",id),youtube=await youtubeFor(channel);
    const video=await youtube.videoMetadata(channel.youtube_channel_id,videoId);
    const [report,metrics]=await Promise.all([youtube.channelAnalytics(channel.youtube_channel_id,start,end,videoId),youtube.analytics(videoId,channel.youtube_channel_id,start,end)]);
    if(report.summary){metrics.views=report.summary.views;metrics.avg_view_duration=report.summary.average_view_duration;metrics.average_view_percentage=report.summary.average_view_percentage;}
    const [[existing],oldSnapshot,[episode]]=await Promise.all([db.list<VideoCache>("video_reports",videoScope(channel,videoId,start,end),"-updated",1),matchingSnapshot(channel,videoId,start,end),db.list<Episode>("episodes",`channel=${filterValue(id)} && youtube_video_id=${filterValue(videoId)}`)]);
    const supplement=oldSnapshot?.metrics||existing?.metrics;
    if(supplement){metrics.ctr=supplement.ctr;metrics.viewed_vs_swiped=supplement.viewed_vs_swiped;}
    const input={channel:id,youtube_channel_id:channel.youtube_channel_id,video_id:videoId,start_date:start,end_date:end,video,report,metrics};
    await(existing?db.update("video_reports",existing.id,input):db.create("video_reports",input));
    let snapshot:Snapshot|null=null;
    if(episode){
      const day=new Date().toISOString().slice(0,10);
      const [sameDay]=await db.list<Snapshot>("analytics_snapshots",`video_id=${filterValue(videoId)} && date=${filterValue(day)}`);
      const saved={video_id:videoId,episode:episode.id,date:day,metrics,source:metrics.ctr!==null||metrics.viewed_vs_swiped!==null?"youtube-api+studio-csv":"youtube-api"};
      snapshot=sameDay?await db.update<Snapshot>("analytics_snapshots",sameDay.id,saved):await db.create<Snapshot>("analytics_snapshots",saved);
    }
    return {channel:identity(channel),video,report,metrics,snapshot};
  });
}

// Scans Google Drive and local project directories for media outputs
export async function projectDriveOutputs(channelId: string) {
  recordId.parse(channelId);
  const channel = await db.get<Channel>("channels", channelId);
  const prefs = await channelPreferences(channelId).catch(() => ({ project_name: "" }));
  const name = (prefs.project_name || channel.name).trim();
  const folder = `Faceless/${name}`;
  const connector = new DriveConnector();

  const [initialFiles, assets] = await Promise.all([
    connector.listFiles(folder).catch(() => [] as DriveFile[]),
    db.list<Asset>("assets", `project=${filterValue(name)} || project=${filterValue(channel.name)}`, "-created", 500).catch(() => [])
  ]);
  const files: DriveFile[] = [...initialFiles];

  // Also discover files in local project directory (projects/<name>/assets or projects/<name>)
  const localProjectDir = path.resolve(process.cwd(), "projects", name);
  const localDirs = [path.join(localProjectDir, "assets"), localProjectDir];
  const mediaExts = new Set([".mp4", ".webm", ".mkv", ".mov", ".mp3", ".wav", ".m4a", ".aac", ".flac", ".jpg", ".jpeg", ".png", ".webp"]);
  const seenPaths = new Set(files.map(f => f.path.toLowerCase()));

  for (const d of localDirs) {
    if (existsSync(d)) {
      try {
        const { readdirSync, statSync } = await import("node:fs");
        const dirEntries = readdirSync(d, { withFileTypes: true });
        for (const e of dirEntries) {
          if (e.isFile() && mediaExts.has(path.extname(e.name).toLowerCase())) {
            const relPath = `${folder}/${e.name}`;
            if (!seenPaths.has(relPath.toLowerCase())) {
              seenPaths.add(relPath.toLowerCase());
              const fullPath = path.join(d, e.name);
              const sz = statSync(fullPath).size;
              files.push({ id: `local:${relPath}`, path: relPath, size: sz });
            }
          }
        }
      } catch {}
    }
  }

  return { project: name, folder, files, assets };
}

// Imports any newly found files from Google Drive / local into Studio's assets library.
export async function syncProjectDriveOutputs(channelId: string) {
  recordId.parse(channelId);
  const channel = await db.get<Channel>("channels", channelId);
  const prefs = await channelPreferences(channelId).catch(() => ({ project_name: "" }));
  const name = (prefs.project_name || channel.name).trim();
  const folder = `Faceless/${name}`;
  const connector = new DriveConnector();
  const initialFiles = await connector.listFiles(folder).catch(() => [] as DriveFile[]);
  const files: DriveFile[] = [...initialFiles];

  // Also include local project files
  const localProjectDir = path.resolve(process.cwd(), "projects", name);
  const localDirs = [path.join(localProjectDir, "assets"), localProjectDir];
  const mediaExts = new Set([".mp4", ".webm", ".mkv", ".mov", ".mp3", ".wav", ".m4a", ".aac", ".flac", ".jpg", ".jpeg", ".png", ".webp"]);
  const seenPaths = new Set(files.map(f => f.path.toLowerCase()));

  for (const d of localDirs) {
    if (existsSync(d)) {
      try {
        const { readdirSync, statSync } = await import("node:fs");
        const dirEntries = readdirSync(d, { withFileTypes: true });
        for (const e of dirEntries) {
          if (e.isFile() && mediaExts.has(path.extname(e.name).toLowerCase())) {
            const relPath = `${folder}/${e.name}`;
            if (!seenPaths.has(relPath.toLowerCase())) {
              seenPaths.add(relPath.toLowerCase());
              const fullPath = path.join(d, e.name);
              const sz = statSync(fullPath).size;
              files.push({ id: `local:${relPath}`, path: relPath, size: sz });
            }
          }
        }
      } catch {}
    }
  }

  const existing = await db.list<Asset>("assets", `project=${filterValue(name)} || project=${filterValue(channel.name)}`, "-created", 1000).catch(() => []);
  const known = new Set(existing.map(a => a.drive_path));
  let created = 0;
  for (const f of files) {
    if (known.has(f.path)) continue;
    const ext = path.extname(f.path).toLowerCase();
    const kind = [".mp4", ".webm", ".mkv", ".mov"].includes(ext) ? "render"
      : [".mp3", ".wav", ".m4a", ".aac", ".flac"].includes(ext) ? "vo"
      : [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? "image"
      : "render";
    const filename = path.basename(f.path);
    await db.create<Asset>("assets", {
      episode: "",
      project: name,
      title: filename.slice(0, 200),
      kind,
      drive_file_id: f.id,
      drive_path: f.path,
      source: "n8n",
      selected: true,
      meta: { filename, size: f.size }
    });
    created++;
  }
  return { project: name, synced: created, total: files.length };
}
