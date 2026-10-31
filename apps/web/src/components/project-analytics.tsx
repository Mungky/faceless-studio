"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Activity, ArrowLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, SquarePlay } from "lucide-react";
import { publicationDay, reportRange, timestamp, validateReportRange, type Channel, type ChannelBreakdown, type ChannelDay, type ChannelReport, type ChannelTopVideo, type ChannelVideo, type ProjectData } from "@studio/core";
import { api, Button, Modal, Status, date, number, type Dashboard, type View } from "./ui";
import { ChannelAvatar } from "./projects";

type Range = { start: string; end: string };
type ProjectProps = { data: Dashboard; channel: Channel; busy: boolean; run: (fn: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; openEpisode: (id: string) => void; navigate: (next: View) => void; openVideoAnalytics:(id:string)=>void };
type CachedProject = { key: string; value: ProjectData };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "The report could not be loaded. Try syncing again.";
const rangeKey = (channel: string, range: Range) => `${channel}:${range.start}:${range.end}`;
const readableDay = (day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const publicationLabel = (value: string) => new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(value));
const videoDateKind = (video?: ChannelVideo) => video?.visibility === "public" ? "Published" : video?.visibility === "private" || video?.visibility === "unlisted" ? "Uploaded" : "Video date";
const duration = (seconds: number | null | undefined) => seconds == null ? "—" : timestamp(seconds);

export function ProjectAnalytics({ data, channel, busy, run, refresh, openEpisode, navigate,openVideoAnalytics }: ProjectProps) {
  const [range, setRange] = useState<Range>(() => reportRange(28));
  const [preset, setPreset] = useState("28");
  const [custom, setCustom] = useState<Range>(() => reportRange(28));
  const [rangeError, setRangeError] = useState("");
  const [loaded, setLoaded] = useState<CachedProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [expandedContent, setExpandedContent] = useState(false);
  const [selection, setSelection] = useState({ channel: channel.id, video: "" });
  const selectedVideo = selection.channel === channel.id ? selection.video : "";
  const setSelectedVideo = (video: string) => setSelection({ channel: channel.id, video });
  const cache = useRef(new Map<string, ProjectData>());
  const autoAttempted = useRef(new Set<string>());
  const sequence = useRef(0);
  const key = rangeKey(channel.id, range);
  useEffect(() => { setExpandedContent(false); }, [key]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const project = loaded?.key === key && loaded.value.channel.id === channel.id ? loaded.value : cache.current.get(key);

  useEffect(() => {
    const ticket = ++sequence.current;
    let active = true;
    setLoading(true);
    setSyncing(false);
    setError("");
    const accept = (value: ProjectData) => {
      if (value.channel.id !== channel.id) throw new Error("YouTube returned a different channel. Check this project's connection before syncing again.");
      if (value.report && (value.report.start_date !== range.start || value.report.end_date !== range.end)) throw new Error("The saved report does not match this period. Sync the selected period again.");
      if (active && ticket === sequence.current && currentKey.current === key) {
        cache.current.set(key, value);
        setLoaded({ key, value });
      }
    };
    void (async () => {
      try {
        const value = await api<ProjectData>(`projects/${channel.id}?start=${range.start}&end=${range.end}`);
        if (!active || ticket !== sequence.current) return;
        accept(value);
        setLoading(false);
        if (!value.report && channel.oauth_ref && !autoAttempted.current.has(key)) {
          autoAttempted.current.add(key);
          setSyncing(true);
          accept(await api<ProjectData>(`projects/${channel.id}/sync`, range));
        }
      } catch (cause) {
        if (active && ticket === sequence.current && currentKey.current === key) setError(message(cause));
      } finally {
        if (active && ticket === sequence.current && currentKey.current === key) { setLoading(false); setSyncing(false); }
      }
    })();
    return () => { active = false; };
  }, [channel.id, channel.oauth_ref, key, range.start, range.end]);

  async function sync() {
    const requestedKey = key;
    const requestedChannel = channel.id;
    const requestedRange = { ...range };
    await run(async () => {
      const ticket = ++sequence.current;
      setError("");
      setSyncing(true);
      try {
        validateReportRange(requestedRange.start, requestedRange.end);
        const value = await api<ProjectData>(`projects/${requestedChannel}/sync`, requestedRange);
        if (value.channel.id !== requestedChannel) throw new Error("The returned channel did not match this project. Check its YouTube connection.");
        if (value.report && (value.report.start_date !== requestedRange.start || value.report.end_date !== requestedRange.end)) throw new Error("The returned report did not match the selected period. Try syncing again.");
        cache.current.set(requestedKey, value);
        if (currentKey.current === requestedKey && ticket === sequence.current) setLoaded({ key: requestedKey, value });
        await refresh();
      } catch (cause) {
        if (currentKey.current === requestedKey && ticket === sequence.current) setError(message(cause));
      } finally {
        if (currentKey.current === requestedKey && ticket === sequence.current) setSyncing(false);
      }
    });
  }

  function applyCustom(event: React.FormEvent) {
    event.preventDefault();
    try { validateReportRange(custom.start, custom.end); setRange({ ...custom }); setRangeError(""); }
    catch (cause) { setRangeError(message(cause)); }
  }

  const report = project?.report || null;
  const profile = project?.channel.profile || channel.profile;
  const identity = { ...channel, profile };
  const totals = report?.summary;
  const activeVideo = project?.videos.find(video => video.id === selectedVideo);
  const periodVideo = report?.top_videos.find(video => video.video_id === selectedVideo);
  const episode = data.episodes.find(item => item.channel === channel.id && item.youtube_video_id === selectedVideo);

  return <div className="project-dashboard">

    <div className="project-range-bar"><div className="segmented project-periods" aria-label="Reporting period">{["7", "28", "90", "custom"].map(value => <button type="button" key={value} aria-pressed={preset === value} onClick={() => { setPreset(value); setRangeError(""); if (value !== "custom") { const next = reportRange(Number(value)); setRange(next); setCustom(next); } }}>{value === "custom" ? "Custom" : `Last ${value} days`}</button>)}</div><Button busy={syncing} disabled={busy || loading || !channel.oauth_ref} onClick={() => void sync()}><RefreshCw size={14} />{syncing ? "Syncing report…" : "Sync"}</Button></div>
    {preset === "custom" && <form className="project-custom-range" onSubmit={applyCustom}><label>Start date<input type="date" required value={custom.start} max={custom.end || reportRange(1).end} onChange={event => setCustom(value => ({ ...value, start: event.target.value }))} /></label><label>End date<input type="date" required value={custom.end} min={custom.start} max={reportRange(1).end} onChange={event => setCustom(value => ({ ...value, end: event.target.value }))} /></label><Button type="submit">Apply period</Button><span>Up to 365 days</span>{rangeError && <p role="alert">{rangeError}</p>}</form>}
    <div className="project-report-meta"><span>{readableDay(range.start)} – {readableDay(range.end)} · Pacific reporting days</span><span aria-live="polite">{syncing ? "Fetching YouTube reports and uploads…" : loading ? "Loading saved report…" : report ? `Synced ${date(report.synced_at)}` : "No saved report for this period"}</span></div>
    {error && <div className="project-notice project-notice-error" role="alert"><p>{error}</p><span>{report ? "Showing the last saved report for this period. Sync to try again." : "Sync to retry this period. Saved uploads remain available."}</span></div>}
    {!channel.oauth_ref && <div className="project-notice"><p>Connect this channel to load its analytics.</p><Button onClick={() => navigate("connections")}>Open connections<ArrowUpRight size={13} /></Button></div>}
    {report?.available_through && report.available_through < range.end && <p className="project-latency-note">YouTube has returned daily data through {readableDay(report.available_through)}. The latest days may still be processing.</p>}

    <div className="metrics-row project-metrics" aria-busy={loading || syncing}><Metric label="Views" value={number(totals?.views)} note="Whole channel · selected period" /><Metric label="Watch time (hours)" value={number(totals ? totals.watch_minutes / 60 : null)} note="Whole channel · selected period" /><Metric label="Subscribers" value={number(totals ? totals.subscribers_gained - totals.subscribers_lost : null)} note={totals ? `${number(totals.subscribers_gained)} gained · ${number(totals.subscribers_lost)} lost` : "Net change · selected period"} /><Metric label="Average view duration" value={duration(totals?.average_view_duration)} note={totals?.average_view_percentage != null ? `${number(totals.average_view_percentage, "%")} average viewed` : "Whole channel · selected period"} /></div>
    {!totals && <p className="project-section-note">{sectionMessage(report, "summary", syncing ? "Loading channel totals from YouTube…" : "Channel totals are unavailable for this period. Sync to request a report.")}</p>}

    <DailyChart key={key} report={report} range={range} loading={loading || syncing} />
    <section className="project-top-content"><div className="section-toolbar"><h2>Popular content</h2><span className="project-section-caption">Selected period · ranked by views</span></div>{report?.top_videos.length ? <div className="table-wrap project-top-table"><table><thead><tr><th scope="col">Video</th><th scope="col">Views</th><th scope="col">Watch hours</th><th scope="col">Avg. duration</th></tr></thead><tbody>{(expandedContent ? report.top_videos : report.top_videos.slice(0, 5)).map((row, index) => { const video = project?.videos.find(item => item.id === row.video_id); return <tr key={row.video_id}><td><button type="button" className="project-video-button" onClick={() => setSelectedVideo(row.video_id)}><span className="project-video-rank">{index + 1}</span><Thumbnail video={video} /><span><strong><span>{video?.title || `Video ${row.video_id}`}</span><VisibilityLabel video={video} /></strong><small>{video?.published_at ? `${videoDateKind(video)} ${publicationLabel(video.published_at)} · Jakarta` : "Upload metadata not in the saved catalog"}</small></span></button></td><td className="tabular">{number(row.views)}</td><td className="tabular">{number(row.watch_minutes / 60)}</td><td className="tabular">{duration(row.average_view_duration)}</td></tr>; })}</tbody></table></div> : <SectionEmpty>{sectionMessage(report, "top_videos", loading || syncing ? "Loading popular content…" : "YouTube returned no ranked videos for this period.")}</SectionEmpty>}{report && report.top_videos.length > 5 && <button type="button" className="text-button project-content-disclosure" aria-expanded={expandedContent} onClick={() => setExpandedContent(value => !value)}>{expandedContent ? "Show top 5" : `Show all ${report.top_videos.length}`}</button>}</section>

    <section className="project-interactions"><div className="section-toolbar"><h2>Interactions</h2><span className="project-section-caption">Whole channel · selected period</span></div><div className="project-interaction-values">{([['Likes', totals?.likes], ['Dislikes', totals?.dislikes], ['Comments', totals?.comments], ['Shares', totals?.shares]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{number(value)}</strong></div>)}</div></section>

    <section className="project-audience"><div className="section-toolbar"><h2>Audience & discovery</h2><span className="project-section-caption">Selected period</span></div><div className="project-breakdowns"><Breakdown title="Geography" rows={report?.countries || []} formatKey={countryName} empty={sectionMessage(report, "countries", "Geography is unavailable for this period.")} /><Breakdown title="Traffic sources" rows={report?.traffic_sources || []} formatKey={friendlyKey} empty={sectionMessage(report, "traffic_sources", "Traffic sources are unavailable for this period.")} /><Breakdown title="Devices" rows={report?.devices || []} formatKey={friendlyKey} empty={sectionMessage(report, "devices", "Device data is unavailable for this period.")} /><Breakdown title="Subscription status" rows={report?.subscription || []} formatKey={friendlyKey} empty={sectionMessage(report, "subscription", "Subscription data is unavailable for this period.")} /><Demographics report={report} /></div></section>

    <UploadCalendar key={channel.id} videos={project?.videos || []} catalog={project?.catalog} loading={loading || syncing} openVideo={setSelectedVideo} />
    <p className="projects-footnote">Channel reports use YouTube's Pacific reporting days and may arrive with a delay. Missing or privacy-limited reports appear as unavailable.</p>

    {selectedVideo && <Modal title="Video details" close={() => setSelectedVideo("")} wide><div className="project-video-detail"><div className="project-video-detail-heading"><Thumbnail video={activeVideo} large /><div><h3>{activeVideo?.title || `Video ${selectedVideo}`}</h3><VisibilityLabel video={activeVideo} /><p>{activeVideo?.published_at ? `${videoDateKind(activeVideo)} ${publicationLabel(activeVideo.published_at)} · Asia/Jakarta` : "Video date unavailable"}</p><p>{activeVideo ? `${duration(activeVideo.duration_seconds)} duration` : "This video is outside the saved upload catalog."}</p></div></div><h3>Lifetime performance</h3><p className="project-section-note">Saved YouTube video totals{project?.catalog.synced_at ? ` · synced ${date(project.catalog.synced_at)}` : ""}. These totals are separate from the video date.</p><div className="project-detail-values"><Metric label="Views" value={number(activeVideo?.views)} /><Metric label="Likes" value={number(activeVideo?.likes)} /><Metric label="Comments" value={number(activeVideo?.comments)} /></div><h3>Selected period</h3><p className="project-section-note">{readableDay(range.start)} – {readableDay(range.end)} · Pacific reporting days</p>{periodVideo ? <PeriodVideoValues video={periodVideo} /> : <SectionEmpty>No per-video values were returned in this period's popular-content report. Lifetime totals above remain separate.</SectionEmpty>}</div><div className="modal-actions"><Button className="primary" onClick={() => { const video = selectedVideo; setSelectedVideo(""); openVideoAnalytics(video); }}>View full analytics<Activity size={14}/></Button>{episode && <Button onClick={() => { setSelectedVideo(""); openEpisode(episode.id); }}>Open in Studio<ArrowUpRight size={13} /></Button>}<a className="button" href={`https://www.youtube.com/watch?v=${encodeURIComponent(selectedVideo)}`} target="_blank" rel="noreferrer">Watch on YouTube<ArrowUpRight size={13} /></a></div></Modal>}
  </div>;
}

export function Metric({ label, value, note }: { label: string; value: string; note?: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function SectionEmpty({ children }: { children: ReactNode }) { return <p className="project-section-empty">{children}</p>; }
function sectionMessage(report: ChannelReport | null, section: string, fallback: string) { return report?.unavailable.find(item => item.section === section)?.message || fallback; }
function Thumbnail({ video, large = false }: { video?: ChannelVideo; large?: boolean }) { return <span className={`project-thumbnail ${large ? "project-thumbnail-large" : ""}`}>{video?.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy" /> : <SquarePlay size={large ? 30 : 20} />}</span>; }
function VisibilityLabel({ video }: { video?: ChannelVideo }) { return video?.visibility === "private" || video?.visibility === "unlisted" ? <span className="project-video-visibility">{video.visibility === "private" ? "Private" : "Unlisted"}</span> : null; }
function PeriodVideoValues({ video }: { video: ChannelTopVideo }) { return <div className="project-detail-values project-period-values"><Metric label="Views" value={number(video.views)} /><Metric label="Watch hours" value={number(video.watch_minutes / 60)} /><Metric label="Avg. duration" value={duration(video.average_view_duration)} /><Metric label="Likes" value={number(video.likes)} /><Metric label="Comments" value={number(video.comments)} /><Metric label="Shares" value={number(video.shares)} /></div>; }

const metrics = { views: { label: "Views", value: (day: ChannelDay) => day.views }, hours: { label: "Watch hours", value: (day: ChannelDay) => day.watch_minutes / 60 }, subscribers: { label: "Subscribers", value: (day: ChannelDay) => day.subscribers_gained - day.subscribers_lost } };
type DailyMetric = keyof typeof metrics;
function DailyChart({ report, range, loading, scope="channel" }: { report: ChannelReport | null; range: Range; loading: boolean;scope?:"channel"|"video" }) {
  const [metric, setMetric] = useState<DailyMetric>("views");
  const [selected, setSelected] = useState(0);
  const id = useId();
  const days = useMemo(() => [...(report?.daily || [])].sort((a, b) => a.day.localeCompare(b.day)), [report]);
  const measure = metrics[metric];
  const index = Math.min(selected, Math.max(0, days.length - 1));
  const point = days[index];
  const values = days.map(measure.value);
  const minimum = Math.min(0, ...values), maximum = Math.max(1, ...values);
  const domain = maximum - minimum;
  const x = (day: string) => 8 + (Date.parse(day) - Date.parse(range.start)) / Math.max(86400000, Date.parse(range.end) - Date.parse(range.start)) * 784;
  const y = (value: number) => 207 - (value - minimum) / domain * 194;
  const path = days.map((day, i) => `${i ? "L" : "M"}${x(day.day)},${y(measure.value(day))}`).join(" ");
  const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

  return <section className="project-trend"><div className="project-panel-heading"><div><h2>Daily performance</h2><p>{metric === "subscribers" ? "Subscribers gained minus subscribers lost each day." : scope === "video" ? "Selected video, across the selected period." : "Whole channel, across the selected period."}</p></div><label className="sr-only" htmlFor={`${id}-metric`}>Daily chart metric</label><select id={`${id}-metric`} value={metric} onChange={event => setMetric(event.target.value as DailyMetric)}>{Object.entries(metrics).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></div>
    {days.length ? <><div className="project-chart"><div className="project-chart-scale" aria-hidden="true">{[maximum, minimum + domain / 2, minimum].map((value, i) => <span key={i}>{compact(value)}</span>)}</div><div className="project-chart-plot"><svg viewBox="0 0 800 220" preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title ${id}-desc`} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const target = Date.parse(range.start) + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (Date.parse(range.end) - Date.parse(range.start)); let nearest = 0; days.forEach((day, i) => { if (Math.abs(Date.parse(day.day) - target) < Math.abs(Date.parse(days[nearest].day) - target)) nearest = i; }); setSelected(nearest); }}><title id={`${id}-title`}>{measure.label} by day</title><desc id={`${id}-desc`}>{`${scope === "video" ? "Video" : "Channel"} ${measure.label.toLowerCase()} from ${range.start} to ${range.end}. Use the day slider or the data table below for exact values. Only dates returned by YouTube are plotted.`}</desc>{[maximum, minimum + domain / 2, minimum].map((value, i) => <line key={i} x1="8" x2="792" y1={y(value)} y2={y(value)} className="project-chart-grid" />)}{minimum < 0 && <line x1="8" x2="792" y1={y(0)} y2={y(0)} className="project-chart-zero" />}<path d={path} className="project-chart-line" vectorEffect="non-scaling-stroke" />{point && <><line x1={x(point.day)} x2={x(point.day)} y1="10" y2="207" className="project-chart-cursor" /><circle cx={x(point.day)} cy={y(measure.value(point))} r="3.5" className="project-chart-point" /></>}</svg><div className="project-chart-dates" aria-hidden="true"><span>{readableDay(range.start, { month: "short", day: "numeric" })}</span><span>{readableDay(range.end, { month: "short", day: "numeric" })}</span></div></div></div><div className="project-chart-inspection"><span>{point ? readableDay(point.day, { month: "short", day: "numeric" }) : ""}</span><input type="range" min="0" max={Math.max(0, days.length - 1)} value={index} disabled={days.length < 2} aria-label="Inspect daily performance" aria-valuetext={point ? `${readableDay(point.day)}: ${number(measure.value(point))} ${measure.label.toLowerCase()}` : "No daily data"} onChange={event => setSelected(Number(event.target.value))} /><strong className="tabular">{point ? number(measure.value(point)) : "—"} <span>{measure.label === "Subscribers" ? "net subscribers" : measure.label.toLowerCase()}</span></strong></div><details className="project-chart-table"><summary>View daily data table</summary><div className="table-wrap"><table><caption className="sr-only">Daily performance, Pacific reporting days</caption><thead><tr><th scope="col">Day (Pacific)</th><th scope="col">Views</th><th scope="col">Watch hours</th><th scope="col">Gained</th><th scope="col">Lost</th></tr></thead><tbody>{days.map(day => <tr key={day.day}><th scope="row">{readableDay(day.day)}</th><td>{number(day.views)}</td><td>{number(day.watch_minutes / 60)}</td><td>{number(day.subscribers_gained)}</td><td>{number(day.subscribers_lost)}</td></tr>)}</tbody></table></div></details></> : <div className="project-chart-empty"><Activity size={25} /><p>{sectionMessage(report, "daily", loading ? "Loading daily performance…" : "No daily rows are available for this period.")}</p><span>Daily values are shown only when YouTube returns them.</span></div>}
  </section>;
}

function friendlyKey(value: string) {
  const names: Record<string, string> = { SUBSCRIBED: "Subscribed", UNSUBSCRIBED: "Not subscribed", YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", SHORTS: "Shorts feed", YT_CHANNEL: "Channel pages", EXT_URL: "External", NO_LINK_OTHER: "Direct or unknown", NO_LINK_EMBEDDED: "Embedded player", BROWSE: "Browse features", ADVERTISING: "YouTube advertising", PLAYLIST: "Playlists", NOTIFICATION: "Notifications", MOBILE: "Mobile", DESKTOP: "Computer", TABLET: "Tablet", TV: "TV", GAME_CONSOLE: "Game console", UNKNOWN_PLATFORM: "Unknown", male: "Male", female: "Female", user_specified: "User specified" };
  return names[value] || value.replace(/^age/, "").replace(/_/g, " ").toLowerCase().replace(/^./, char => char.toUpperCase());
}
function countryName(value: string) { try { return value === "ZZ" ? "Unknown" : new Intl.DisplayNames(["en"], { type: "region" }).of(value) || value; } catch { return value; } }
function Breakdown({ title, rows, formatKey, empty }: { title: string; rows: ChannelBreakdown[]; formatKey: (key: string) => string; empty: string }) {
  const sorted = [...rows].sort((a, b) => b.views - a.views);
  const total = sorted.reduce((sum, row) => sum + row.views, 0);
  const [expanded, setExpanded] = useState(false);
  return <div className="project-breakdown"><h3>{title}</h3>{rows.length ? <><div className="project-breakdown-labels"><span>Share of reported views</span><span>Views</span></div><ul>{(expanded ? sorted : sorted.slice(0, 5)).map(row => <li key={row.key}><div><span>{formatKey(row.key)}</span><span className="tabular">{number(row.views)}<small>{number(total ? row.views / total * 100 : 0, "%")}</small></span></div><span className="project-bar" aria-hidden="true"><i style={{ width: `${total ? row.views / total * 100 : 0}%` }} /></span></li>)}</ul>{sorted.length > 5 && <button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${sorted.length}`}</button>}</> : <SectionEmpty>{empty}</SectionEmpty>}</div>;
}
function Demographics({ report }: { report: ChannelReport | null }) {
  const rows = report?.demographics || [];
  const group = (key: "age_group" | "gender") => {
    const totals = new Map<string, number>(); rows.forEach(row => totals.set(row[key], (totals.get(row[key]) || 0) + row.percentage));
    return Array.from(totals, ([label, percentage]) => ({ label, percentage }));
  };
  return <div className="project-breakdown project-demographics"><h3>Age & gender</h3>{rows.length ? <><p className="project-breakdown-labels">Share of reported viewers · privacy limits apply</p><div className="project-demographic-columns">{([['Age', group("age_group")], ['Gender', group("gender")]] as const).map(([title, groups]) => <div key={title}><h4>{title}</h4><ul>{groups.map(row => <li key={row.label}><span>{friendlyKey(row.label)}</span><strong>{number(row.percentage, "%")}</strong></li>)}</ul></div>)}</div></> : <SectionEmpty>{sectionMessage(report, "demographics", "YouTube has not returned demographic data for this period. Privacy thresholds can limit these reports.")}</SectionEmpty>}</div>;
}

function monthShift(month: string, amount: number) { const result = new Date(month + "-01T12:00:00Z"); result.setUTCMonth(result.getUTCMonth() + amount); return result.toISOString().slice(0, 7); }
function dayShift(day: string, amount: number) { const result = new Date(day + "T12:00:00Z"); result.setUTCDate(result.getUTCDate() + amount); return result.toISOString().slice(0, 10); }
function UploadCalendar({ videos, catalog, loading, openVideo }: { videos: ChannelVideo[]; catalog?: ProjectData["catalog"]; loading: boolean; openVideo: (id: string) => void }) {
  const today = publicationDay(new Date().toISOString());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const focusDay = useRef(false);
  const id = useId();
  const grouped = useMemo(() => {
    const map = new Map<string, ChannelVideo[]>();
    for (const video of videos) { try { const day = publicationDay(video.published_at); const list = map.get(day) || []; list.push(video); map.set(day, list); } catch { /* An invalid publication time cannot establish a calendar day. */ } }
    for (const list of map.values()) list.sort((a, b) => a.published_at.localeCompare(b.published_at));
    return map;
  }, [videos]);
  useEffect(() => { if (focusDay.current) { document.getElementById(`${id}-${selected}`)?.focus(); focusDay.current = false; } }, [id, month, selected]);
  const leading = (new Date(month + "-01T12:00:00Z").getUTCDay() + 6) % 7;
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const selectedVideos = grouped.get(selected) || [];
  const monthCount = videos.filter(video => { try { return publicationDay(video.published_at).startsWith(month); } catch { return false; } }).length;
  function moveMonth(amount: number) { const next = monthShift(month, amount); setMonth(next); setSelected(next === today.slice(0, 7) ? today : `${next}-01`); }
  function keyboardDay(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = offsets[event.key] != null ? dayShift(day, offsets[event.key]) : event.key === "Home" ? `${month}-01` : event.key === "End" ? `${month}-${String(count).padStart(2, "0")}` : undefined;
    if (!next) return;
    event.preventDefault();
    if (next.slice(0, 7) > today.slice(0, 7)) next = today;
    focusDay.current = true; setMonth(next.slice(0, 7)); setSelected(next);
  }
  return <section className="project-calendar-section"><div className="section-toolbar"><div><h2>Upload calendar</h2><p className="project-section-note">Publish/upload dates · Asia/Jakarta · lifetime performance</p><p className="project-calendar-date-note">Private and unlisted dates represent upload time.</p></div><span className="project-section-caption"><CalendarDays size={14} />{catalog?.synced_at ? `Catalog synced ${date(catalog.synced_at)}` : loading ? "Loading upload catalog…" : "Upload catalog not synced"}</span></div>
    {!catalog?.complete && <div className="project-coverage-note"><p>{catalog?.error || "Upload history is incomplete. Days without cached videos may still have uploads."}</p><span>{number(videos.length)} videos in the saved catalog. Sync refreshes available upload history.</span></div>}
    <div className="project-calendar-layout"><div className="project-calendar"><div className="project-calendar-toolbar"><div><h3>{readableDay(`${month}-01`, { month: "long", year: "numeric" })}</h3><span>{monthCount} cached {monthCount === 1 ? "upload" : "uploads"}</span></div><div><button type="button" className="text-button" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button><button type="button" className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><button type="button" className="icon-button" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div></div><div className="project-calendar-week" aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div><div className="project-calendar-grid" role="group" aria-label={`${readableDay(`${month}-01`, { month: "long", year: "numeric" })} uploads`}>{Array.from({ length: leading }, (_, index) => <div key={`before-${index}`} className="project-calendar-blank" />)}{Array.from({ length: count }, (_, index) => { const day = `${month}-${String(index + 1).padStart(2, "0")}`; const uploads = grouped.get(day) || []; return <button type="button" id={`${id}-${day}`} key={day} className={`project-calendar-day ${day === today ? "project-calendar-today" : ""}`} aria-pressed={day === selected} aria-current={day === today ? "date" : undefined} aria-label={`${readableDay(day)}, ${uploads.length} cached ${uploads.length === 1 ? "upload" : "uploads"}`} onClick={() => setSelected(day)} onKeyDown={event => keyboardDay(event, day)}><span className="project-calendar-number">{index + 1}{uploads.length > 0 && <small>{uploads.length}</small>}</span>{uploads[0] && <span className="project-calendar-thumb">{uploads[0].thumbnail_url ? <img src={uploads[0].thumbnail_url} alt="" loading="lazy" /> : <SquarePlay size={15} />}</span>}</button>; })}{Array.from({ length: (7 - (leading + count) % 7) % 7 }, (_, index) => <div key={`after-${index}`} className="project-calendar-blank" />)}</div></div><aside className="project-calendar-selection" aria-live="polite"><h3>{readableDay(selected, { weekday: "short", month: "short", day: "numeric" })}</h3><p>{selectedVideos.length} cached {selectedVideos.length === 1 ? "upload" : "uploads"} · lifetime performance</p>{selectedVideos.length ? <div className="project-calendar-video-list">{selectedVideos.map(video => <button type="button" className="project-calendar-video" key={video.id} onClick={() => openVideo(video.id)}><Thumbnail video={video} /><span><strong>{video.title}</strong><small><VisibilityLabel video={video} />{videoDateKind(video)} {new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(video.published_at))} Jakarta · {duration(video.duration_seconds)}</small><span className="project-calendar-video-metrics">{number(video.views)} views · {number(video.likes)} likes · {number(video.comments)} comments</span></span><ChevronRight size={14} /></button>)}</div> : <p className="project-calendar-no-uploads">{catalog?.complete ? "No uploads on this day." : "No uploads are cached for this day. The saved catalog may be incomplete."}</p>}</aside></div>
  </section>;
}

export { DailyChart, Breakdown, Demographics, SectionEmpty, sectionMessage, friendlyKey, countryName };
