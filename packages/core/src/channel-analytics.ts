export interface ChannelProfile {
  title: string; description: string; avatar_url: string; banner_url: string; handle?: string;
  subscribers: number | null; total_views: number | null; total_videos: number | null; synced_at: string;
}
export interface ChannelVideo {
  id: string; title: string; thumbnail_url: string; published_at: string; duration_seconds: number;
  views: number | null; likes: number | null; comments: number | null; visibility?: "public" | "unlisted" | "private" | null;
}
export interface ChannelTotals {
  views: number; watch_minutes: number; average_view_duration: number | null;
  average_view_percentage: number | null; likes: number; dislikes: number; comments: number;
  shares: number; subscribers_gained: number; subscribers_lost: number;
}
export interface ChannelDay { day: string; views: number; watch_minutes: number; subscribers_gained: number; subscribers_lost: number; }
export interface ChannelTopVideo { video_id: string; views: number; watch_minutes: number; average_view_duration: number | null; likes: number; comments: number; shares: number; }
export interface ChannelBreakdown { key: string; views: number; }
export interface ChannelReport {
  start_date: string; end_date: string; synced_at: string; available_through: string | null;
  summary: ChannelTotals | null; daily: ChannelDay[]; top_videos: ChannelTopVideo[];
  countries: ChannelBreakdown[]; traffic_sources: ChannelBreakdown[]; devices: ChannelBreakdown[];
  subscription: ChannelBreakdown[];
  demographics: { age_group: string; gender: string; percentage: number }[];
  unavailable: { section: string; message: string }[];
}
export interface ProjectData {
  channel: { id: string; name: string; handle: string; color: string; youtube_channel_id: string; oauth_ref: string; profile?: ChannelProfile };
  report: ChannelReport | null; videos: ChannelVideo[];
  catalog: { synced_at: string | null; complete: boolean; error?: string };
}
export interface VideoAnalyticsData {
  channel: ProjectData["channel"];
  video: ChannelVideo | null;
  report: ChannelReport | null;
  metrics: import("./index").AnalyticsMetrics | null;
  snapshot: import("./index").Snapshot | null;
}

export function publicationDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid publication date");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function reportRange(days = 28, now = new Date()): { start: string; end: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const end = new Date(today + "T00:00:00Z"); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
export function validateReportRange(start: string, end: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end || Date.parse(end) - Date.parse(start) > 364 * 86_400_000 || end > reportRange(1).end) throw new Error("Choose a valid reporting range of up to 365 days, ending before today in Pacific time.");
}
