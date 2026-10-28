import { validateReportRange, videoId as youtubeVideoId, type AnalyticsMetrics, type ChannelProfile, type ChannelReport, type ChannelVideo } from "@studio/core";

export interface YouTubeTokens { refresh_token: string; access_token?: string; expires_at?: number; }
interface Report { columnHeaders?: { name: string }[]; rows?: (number | string)[][]; }
interface Video { id: string; snippet: { title: string; channelId: string; publishedAt: string }; contentDetails: { duration: string }; status?: { privacyStatus?: "public" | "unlisted" | "private" }; }
interface Thumbnail { url?: string; }
interface OwnedChannel {
  id: string;
  snippet: { title: string; description?: string; customUrl?: string; thumbnails?: Record<string, Thumbnail> };
  contentDetails: { relatedPlaylists: { uploads: string } };
  brandingSettings?: { image?: { bannerExternalUrl?: string } };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
}
export interface YouTubeCatalog { videos: ChannelVideo[]; synced_at: string; complete: boolean; error?: string; }
const dataApi = "https://www.googleapis.com/youtube/v3/";
const analyticsApi = "https://youtubeanalytics.googleapis.com/v2/reports";
class YouTubeRequestError extends Error {}
function requiredReportError(section: string, error: unknown) {
  return new Error(`YouTube could not provide ${section}. Cached data was retained. ${error instanceof YouTubeRequestError ? error.message : "Check Connections and try Sync again."}`);
}
const thumbnail = (images?: Record<string, Thumbnail>) => images?.maxres?.url || images?.high?.url || images?.medium?.url || images?.default?.url || "";
function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : null;
}
function reportRows(report: Report, names: string[]) {
  const indexes = new Map(report.columnHeaders?.map((header, index) => [header.name, index]));
  if (!report.rows?.length) return [];
  if (names.some(name => !indexes.has(name))) throw new Error("YouTube returned an incomplete report.");
  return report.rows.map(row => ({
    text(name: string) { const value = row[indexes.get(name)!]; if (value === undefined || value === null || value === "") throw new Error("YouTube returned an incomplete report."); return String(value); },
    number(name: string) { const value = optionalNumber(row[indexes.get(name)!]); if (value === null) throw new Error("YouTube returned an incomplete report."); return value; },
    nullable(name: string) { return optionalNumber(row[indexes.get(name)!]); }
  }));
}
function requestError(status: number, payload: unknown, host: string): Error {
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
  const reasons: unknown[] = [];
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    for (const key of ["details", "errors"]) {
      const entries = fields[key];
      if (Array.isArray(entries)) for (const item of entries) if (item && typeof item === "object" && "reason" in item) reasons.push(item.reason);
    }
  }
  const service = host === "youtubeanalytics.googleapis.com" ? "YouTube Analytics API" : "YouTube Data API v3";
  if (status >= 500) return new YouTubeRequestError(`${service} is temporarily unavailable (${status}). Saved data is retained. Try Sync again later.`);
  const messages: Record<string, string> = {
    SERVICE_DISABLED: `${service} is not enabled for the OAuth client's Google Cloud project. Enable it in APIs & Services > Library, then reconnect.`,
    accessNotConfigured: `${service} is not enabled for the OAuth client's Google Cloud project. Enable it in APIs & Services > Library, then reconnect.`,
    ACCESS_TOKEN_SCOPE_INSUFFICIENT: "Reconnect this channel and grant both requested YouTube permissions.",
    insufficientPermissions: "Reconnect this channel and grant both requested YouTube permissions.",
    quotaExceeded: "The Google Cloud project quota has been reached. Check its quota before trying again. No automatic retry was made.",
    dailyLimitExceeded: "The Google Cloud project quota has been reached. Check its quota before trying again. No automatic retry was made.",
    rateLimitExceeded: "The Google Cloud project request quota has been reached. Check its limits before trying again. No automatic retry was made.",
    userRateLimitExceeded: "The Google Cloud project request quota has been reached. Check its limits before trying again. No automatic retry was made.",
    channelForbidden: "The selected Google account cannot access the selected YouTube channel. Reconnect using its owner or an authorized account.",
    forbidden: "Google denied access. Check the selected YouTube channel, authorized account and API permissions.",
    youtubeSignupRequired: "The selected Google account has no linked YouTube channel. Reconnect using the account that owns the channel.",
    authenticatedUserNotChannel: "The selected Google account did not resolve to a YouTube channel. Reconnect using its owner account.",
    authError: "Google authorization is no longer valid. Reconnect this channel."
  };
  const reason = reasons.find((value): value is string => typeof value === "string" && Object.hasOwn(messages, value));
  return new YouTubeRequestError(`YouTube request failed (${status}${reason ? `; ${reason}` : ""}). ${reason ? messages[reason] : "Check the Google Cloud API settings and authorized account; reconnect the channel if necessary."}`);
}
export function isoDurationSeconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) throw new Error("Unsupported YouTube duration");
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}
export class YouTubeConnector {
  private verified?: OwnedChannel;
  constructor(private tokens: YouTubeTokens, private clientId = process.env.GOOGLE_CLIENT_ID || "", private clientSecret = process.env.GOOGLE_CLIENT_SECRET || "") {}
  private async accessToken() {
    if (this.tokens.access_token && (this.tokens.expires_at || 0) > Date.now() + 60_000) return this.tokens.access_token;
    if (!this.tokens.refresh_token || !this.clientId || !this.clientSecret) throw new Error("YouTube is not connected. Authorize this channel in Connections.");
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.tokens.refresh_token }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Google authorization expired or was revoked. Reconnect this channel.");
    const data = await response.json() as { access_token: string; expires_in: number };
    this.tokens.access_token = data.access_token;
    this.tokens.expires_at = Date.now() + data.expires_in * 1000;
    return data.access_token;
  }
  async request<T>(base: string, query: Record<string, string>): Promise<T> {
    const url = new URL(base); url.search = new URLSearchParams(query).toString();
    const headers = { Authorization: `Bearer ${await this.accessToken()}` };
    let response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if ([500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 400));
      response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    }
    if (!response.ok) throw requestError(response.status, await response.json().catch(() => null), url.hostname);
    return await response.json() as T;
  }
  async ownChannel() {
    const result = await this.request<{ items: OwnedChannel[] }>(dataApi + "channels", { part: "snippet,contentDetails,brandingSettings,statistics", mine: "true" });
    if (!result.items?.[0]) throw new Error("This Google account did not return a YouTube channel.");
    return result.items[0];
  }
  private async verifiedChannel(channelId: string) {
    const channel = this.verified || await this.ownChannel();
    if (!channelId || channel.id !== channelId) throw new Error("YouTube authorization belongs to a different channel. Reconnect the correct channel.");
    this.verified = channel; return channel;
  }
  async channelProfile(channelId: string): Promise<ChannelProfile> {
    const channel = await this.verifiedChannel(channelId);
    return { title: channel.snippet.title, description: channel.snippet.description || "", handle: channel.snippet.customUrl || "", avatar_url: thumbnail(channel.snippet.thumbnails), banner_url: channel.brandingSettings?.image?.bannerExternalUrl || "", subscribers: channel.statistics?.hiddenSubscriberCount ? null : optionalNumber(channel.statistics?.subscriberCount), total_views: optionalNumber(channel.statistics?.viewCount), total_videos: optionalNumber(channel.statistics?.videoCount), synced_at: new Date().toISOString() };
  }
  async channelVideos(channelId: string, maxPages = 200): Promise<YouTubeCatalog> {
    const channel = await this.verifiedChannel(channelId);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error("Choose an upload page limit between 1 and 200.");
    const ids = new Set<string>(); const videos: ChannelVideo[] = []; const errors: string[] = [];
    let pageToken: string | undefined; let complete = false;
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return { videos, complete: false, synced_at: new Date().toISOString(), error: "YouTube did not provide this channel's uploads playlist." };
    const seenTokens = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      try {
        const result = await this.request<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(dataApi + "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
        if (!Array.isArray(result.items)) throw new Error("Incomplete uploads response");
        for (const item of result.items) { if (item.contentDetails?.videoId) ids.add(item.contentDetails.videoId); else errors.push("Some uploads could not be identified."); }
        pageToken = result.nextPageToken;
        if (!pageToken) { complete = true; break; }
        if (seenTokens.has(pageToken)) { errors.push("YouTube repeated an uploads page; history coverage is incomplete."); break; }
        seenTokens.add(pageToken);
      } catch { errors.push("YouTube could not retrieve the complete uploads history. Try Sync again."); break; }
    }
    if (pageToken && !errors.length) errors.push(`Uploads history reached the ${maxPages * 50}-video page limit; earlier uploads may be missing.`);
    const allIds = [...ids];
    for (let offset = 0; offset < allIds.length; offset += 50) {
      const batch = allIds.slice(offset, offset + 50);
      let items: (Video & { snippet: Video["snippet"] & { thumbnails?: Record<string, Thumbnail> }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } })[];
      try {
        const result = await this.request<{ items: typeof items }>(dataApi + "videos", { part: "snippet,contentDetails,statistics,status", id: batch.join(","), maxResults: "50" });
        if (!Array.isArray(result.items)) throw new Error("Incomplete video response");
        items = result.items;
      } catch { errors.push("YouTube could not retrieve metadata for some uploads. Try Sync again."); continue; }
      if (items.some(video => video.snippet?.channelId !== channelId)) throw new Error("YouTube returned a video from a different channel. Cached data was retained.");
      if (items.length < batch.length) errors.push("Some uploads are deleted, private or unavailable; history coverage is incomplete.");
      for (const video of items) {
        if (!batch.includes(video.id)) { errors.push("YouTube returned unexpected upload metadata."); continue; }
        try {
          if (!video.snippet.publishedAt || !Number.isFinite(Date.parse(video.snippet.publishedAt))) throw new Error("Missing publication date");
          videos.push({ id: video.id, title: video.snippet.title, thumbnail_url: thumbnail(video.snippet.thumbnails), published_at: video.snippet.publishedAt, duration_seconds: isoDurationSeconds(video.contentDetails.duration), views: optionalNumber(video.statistics?.viewCount), likes: optionalNumber(video.statistics?.likeCount), comments: optionalNumber(video.statistics?.commentCount), visibility: video.status?.privacyStatus || null });
        } catch { errors.push("Some uploads have unavailable publication metadata."); }
      }
    }
    return { videos, synced_at: new Date().toISOString(), complete: complete && !errors.length, ...(errors.length ? { error: [...new Set(errors)].join(" ") } : {}) };
  }
  async videoMetadata(channelId:string,videoId:string):Promise<ChannelVideo>{
    youtubeVideoId.parse(videoId);await this.verifiedChannel(channelId);
    const result=await this.request<{items:(Video&{snippet:Video["snippet"]&{thumbnails?:Record<string,Thumbnail>};statistics?:{viewCount?:string;likeCount?:string;commentCount?:string}})[]}>(dataApi+"videos",{part:"snippet,contentDetails,statistics,status",id:videoId});
    const video=result.items?.find(item=>item.id===videoId);
    if(!video||video.snippet.channelId!==channelId)throw new Error("Video was not found on this connected channel.");
    return {id:video.id,title:video.snippet.title,thumbnail_url:thumbnail(video.snippet.thumbnails),published_at:video.snippet.publishedAt,duration_seconds:isoDurationSeconds(video.contentDetails.duration),views:optionalNumber(video.statistics?.viewCount),likes:optionalNumber(video.statistics?.likeCount),comments:optionalNumber(video.statistics?.commentCount),visibility:video.status?.privacyStatus||null};
  }
  async channelAnalytics(channelId: string, start: string, end: string, videoId?:string): Promise<ChannelReport> {
    validateReportRange(start, end);
    if(videoId!==undefined)youtubeVideoId.parse(videoId);
    await this.verifiedChannel(channelId);
    const base:Record<string,string> = { ids: `channel==${channelId}`, startDate: start, endDate: end };
    if(videoId!==undefined)base.filters=`video==${videoId}`;
    const result: ChannelReport = { start_date: start, end_date: end, synced_at: new Date().toISOString(), available_through: null, summary: null, daily: [], top_videos: [], countries: [], traffic_sources: [], devices: [], subscription: [], demographics: [], unavailable: [] };
    const totalMetrics = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "likes", "dislikes", "comments", "shares", "subscribersGained", "subscribersLost"];
    try {
      const report = await this.request<Report>(analyticsApi, { ...base, metrics: totalMetrics.join(",") });
      const [row] = reportRows(report, totalMetrics);
      if (row) result.summary = { views: row.number("views"), watch_minutes: row.number("estimatedMinutesWatched"), average_view_duration: row.nullable("averageViewDuration"), average_view_percentage: row.nullable("averageViewPercentage"), likes: row.number("likes"), dislikes: row.number("dislikes"), comments: row.number("comments"), shares: row.number("shares"), subscribers_gained: row.number("subscribersGained"), subscribers_lost: row.number("subscribersLost") };
      else result.unavailable.push({ section: "summary", message: "YouTube has no channel summary available for this period yet." });
    } catch (error) { throw requiredReportError("the channel summary", error); }
    try {
      const metrics = ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"];
      // YouTube truncates a report to the latest day available for every metric; use the same set as the summary.
      const report = await this.request<Report>(analyticsApi, { ...base, dimensions: "day", metrics: totalMetrics.join(","), sort: "day", maxResults: "365" });
      result.daily = reportRows(report, ["day", ...metrics]).map(row => ({ day: row.text("day"), views: row.number("views"), watch_minutes: row.number("estimatedMinutesWatched"), subscribers_gained: row.number("subscribersGained"), subscribers_lost: row.number("subscribersLost") }));
      result.available_through = result.daily.length ? result.daily.map(row => row.day).sort().at(-1)! : null;
      if (!result.daily.length) result.unavailable.push({ section: "daily", message: "YouTube has no daily report available for this period yet." });
    } catch (error) { throw requiredReportError("the daily channel report", error); }
    const optional = async (section: string, action: () => Promise<void>) => {
      try { await action(); if (!(result[section as keyof ChannelReport] as unknown[]).length) result.unavailable.push({ section, message: "YouTube has no reportable data for this section and period. Privacy thresholds may apply." }); }
      catch { result.unavailable.push({ section, message: "YouTube could not provide this section for the selected period. Try Sync again later." }); }
    };
    await Promise.all([
      optional("top_videos", async () => {
        const metrics = ["views", "estimatedMinutesWatched", "averageViewDuration", "likes", "comments", "shares"];
        const report = await this.request<Report>(analyticsApi, { ...base, dimensions: "video", metrics: metrics.join(","), sort: "-views", maxResults: "200" });
        result.top_videos = reportRows(report, ["video", ...metrics]).map(row => ({ video_id: row.text("video"), views: row.number("views"), watch_minutes: row.number("estimatedMinutesWatched"), average_view_duration: row.nullable("averageViewDuration"), likes: row.number("likes"), comments: row.number("comments"), shares: row.number("shares") }));
      }),
      ...([ ["countries", "country"], ["traffic_sources", "insightTrafficSourceType"], ["devices", "deviceType"], ["subscription", "subscribedStatus"] ] as const).map(([section, dimension]) => optional(section, async () => {
        const report = await this.request<Report>(analyticsApi, { ...base, dimensions: dimension, metrics: "views", sort: "-views", maxResults: "500" });
        result[section] = reportRows(report, [dimension, "views"]).map(row => ({ key: row.text(dimension), views: row.number("views") }));
      })),
      optional("demographics", async () => {
        const report = await this.request<Report>(analyticsApi, { ...base, dimensions: "ageGroup,gender", metrics: "viewerPercentage" });
        result.demographics = reportRows(report, ["ageGroup", "gender", "viewerPercentage"]).map(row => ({ age_group: row.text("ageGroup"), gender: row.text("gender"), percentage: row.number("viewerPercentage") }));
      })
    ]);
    return result;
  }
  async latestVideos(channelId: string, limit = 10) {
    const channel = await this.ownChannel();
    if (channel.id !== channelId) throw new Error("YouTube authorization belongs to a different channel. Reconnect the correct channel.");
    const result = await this.request<{ items: { contentDetails: { videoId: string } }[] }>("https://www.googleapis.com/youtube/v3/playlistItems", { part: "contentDetails", playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: String(Math.min(50, limit)) });
    return result.items.map(item => item.contentDetails.videoId);
  }
  async analytics(videoId: string, channelId: string, start: string, end: string): Promise<AnalyticsMetrics> {
    const metadata = await this.request<{ items: Video[] }>("https://www.googleapis.com/youtube/v3/videos", { part: "snippet,contentDetails", id: videoId });
    const video = metadata.items?.[0];
    if (!video || video.snippet.channelId !== channelId) throw new Error("Video was not found on this connected channel.");
    const query = { ids: `channel==${channelId}`, startDate: start, endDate: end, filters: `video==${videoId}` };
    const summary = await this.request<Report>("https://youtubeanalytics.googleapis.com/v2/reports", { ...query, metrics: "views,averageViewDuration,averageViewPercentage" });
    const number = (name: string) => { const index = summary.columnHeaders?.findIndex(header => header.name === name) ?? -1; return index >= 0 && summary.rows?.[0] ? Number(summary.rows[0][index]) : null; };
    const unavailable = ["Thumbnail CTR and viewed-versus-swiped are not exposed by the public Analytics API. Import these metrics from YouTube Studio."];
    let retention: AnalyticsMetrics["retention"] = [], traffic: AnalyticsMetrics["traffic_sources"] = [];
    try {
      const report = await this.request<Report>("https://youtubeanalytics.googleapis.com/v2/reports", { ...query, dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio" });
      retention = (report.rows || []).map(row => ({ elapsed_ratio: Number(row[0]), retention: Number(row[1]) }));
      if (!retention.length) unavailable.push("Retention is not available yet for this video and date range.");
    } catch { unavailable.push("YouTube could not provide retention for this video and date range."); }
    try {
      const report = await this.request<Report>("https://youtubeanalytics.googleapis.com/v2/reports", { ...query, dimensions: "insightTrafficSourceType", metrics: "views" });
      traffic = (report.rows || []).map(row => ({ source: String(row[0]), views: Number(row[1]) }));
    } catch { unavailable.push("Traffic source breakdown is not available for this date range."); }
    return { title: video.snippet.title, duration_seconds: isoDurationSeconds(video.contentDetails.duration), views: number("views") ?? 0, avg_view_duration: number("averageViewDuration"), average_view_percentage: number("averageViewPercentage"), retention, ctr: null, viewed_vs_swiped: null, traffic_sources: traffic, unavailable, start_date: start, end_date: end };
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function studioSupplement(csv: string, targetVideoId: string): { ctr: number | null; viewed_vs_swiped: number | null } {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The Studio CSV contains no video rows");
  const headers = rows[0].map(value => value.toLowerCase().trim());
  const idIndex = headers.findIndex(value => ["video id", "content", "video"].includes(value));
  if (idIndex < 0) throw new Error("The CSV must include a Video ID or Content column.");
  const row = rows.slice(1).find(value => value[idIndex] === targetVideoId);
  if (!row) throw new Error("The selected video was not found in this CSV.");
  const value = (names: string[]) => {
    const index = headers.findIndex(header => names.includes(header));
    if (index < 0 || !row[index]?.trim()) return null;
    const number = Number(row[index].replace(/[% ,]/g, ""));
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("Invalid percentage in Studio CSV");
    return number;
  };
  const result = { ctr: value(["impressions click-through rate (%)", "impressions click-through rate", "ctr (%)"]), viewed_vs_swiped: value(["stayed to watch (%)", "viewed (%)", "viewed vs swiped away (%)"]) };
  if (result.ctr === null && result.viewed_vs_swiped === null) throw new Error("No supported CTR or stayed-to-watch columns were found. Export the English Studio table with these metrics.");
  return result;
}
