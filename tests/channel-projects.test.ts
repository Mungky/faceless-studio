import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { YouTubeConnector } from "@studio/connectors";
import { publicationDay, reportRange, validateReportRange, type Channel, type ChannelReport } from "@studio/core";

registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

const channelId = "UCfixture";
const channel = { id: channelId, snippet: { title: "Real channel", description: "Description", customUrl: "@real", thumbnails: { high: { url: "https://yt.invalid/avatar.jpg" } } }, contentDetails: { relatedPlaylists: { uploads: "UUfixture" } }, brandingSettings: { image: { bannerExternalUrl: "https://yt.invalid/banner.jpg" } }, statistics: { subscriberCount: "12", viewCount: "300", videoCount: "2" } };
const connector = () => new YouTubeConnector({ refresh_token: "fixture", access_token: "fixture", expires_at: Date.now() + 3_600_000 });
const report = (columns: string[], rows: (number | string)[][]) => ({ columnHeaders: columns.map(name => ({ name })), rows });
function analyticsResponse(query: Record<string, string>) {
  if (!query.dimensions) return report(["shares", "subscribersLost", "comments", "views", "estimatedMinutesWatched", "subscribersGained", "averageViewDuration", "likes", "averageViewPercentage", "dislikes"], [[9, 2, 7, 120, 80, 6, 40, 5, 55, 1]]);
  if (query.dimensions === "day") return report(["subscribersLost", "estimatedMinutesWatched", "day", "views", "subscribersGained"], [[1, 20, "2026-01-03", 30, 2]]);
  if (query.dimensions === "video") return report(["likes", "video", "shares", "views", "averageViewDuration", "comments", "estimatedMinutesWatched"], [[2, "abcdefghijk", 3, 40, 12, 1, 8]]);
  if (query.dimensions === "ageGroup,gender") return report(["gender", "viewerPercentage", "ageGroup"], [["female", 61.5, "age25-34"]]);
  return report(["views", query.dimensions], [[17, "fixture"]]);
}

test("whole-channel reports map every section by headers and verify ownership first", async t => {
  const youtube = connector(); const queries: Record<string, string>[] = [];
  t.after(() => mock.restoreAll());
  mock.method(youtube, "request", async (base: string, query: Record<string, string>) => {
    queries.push(query); if (base.includes("/channels")) return { items: [channel] };
    return analyticsResponse(query);
  });
  const result = await youtube.channelAnalytics(channelId, "2026-01-01", "2026-01-04");
  assert.equal(queries[0].mine, "true"); assert.match(queries[0].part, /brandingSettings/);
  assert.deepEqual(result.summary, { views: 120, watch_minutes: 80, average_view_duration: 40, average_view_percentage: 55, likes: 5, dislikes: 1, comments: 7, shares: 9, subscribers_gained: 6, subscribers_lost: 2 });
  assert.deepEqual(result.daily, [{ day: "2026-01-03", views: 30, watch_minutes: 20, subscribers_gained: 2, subscribers_lost: 1 }]);
  assert.equal(queries.find(query => query.dimensions === "day")?.metrics, queries.find(query => !query.dimensions && query.metrics)?.metrics, "Summary and trend use identical metric availability windows");
  assert.deepEqual(result.top_videos[0], { video_id: "abcdefghijk", views: 40, watch_minutes: 8, average_view_duration: 12, likes: 2, comments: 1, shares: 3 });
  assert.deepEqual(result.demographics, [{ gender: "female", percentage: 61.5, age_group: "age25-34" }]);
  for (const section of [result.countries, result.traffic_sources, result.devices, result.subscription]) assert.deepEqual(section, [{ key: "fixture", views: 17 }]);
  assert.equal(result.available_through, "2026-01-03");
  assert.ok(queries.slice(1).every(query => query.ids === `channel==${channelId}` && !query.filters));
  assert.equal(queries.find(query => query.dimensions === "ageGroup,gender")?.metrics, "viewerPercentage");
});

test("cross-channel credentials reject all channel operations before downstream requests", async t => {
  const youtube = connector(); let calls = 0; t.after(() => mock.restoreAll());
  mock.method(youtube, "request", async () => { calls++; return { items: [{ ...channel, id: "UCanother" }] }; });
  await assert.rejects(youtube.channelAnalytics(channelId, "2026-01-01", "2026-01-04"), /different channel/);
  await assert.rejects(youtube.channelProfile(channelId), /different channel/);
  await assert.rejects(youtube.channelVideos(channelId), /different channel/);
  assert.equal(calls, 3);
});

test("optional failures and empty demographics are unavailable without destroying usable summary", async t => {
  const youtube = connector(); t.after(() => mock.restoreAll());
  mock.method(youtube, "request", async (base: string, query: Record<string, string>) => {
    if (base.includes("/channels")) return { items: [channel] };
    if (query.dimensions === "country") throw new Error("fixture-private-token");
    if (query.dimensions === "ageGroup,gender") return report(["ageGroup", "gender", "viewerPercentage"], []);
    return analyticsResponse(query);
  });
  const result = await youtube.channelAnalytics(channelId, "2026-01-01", "2026-01-04");
  assert.equal(result.summary?.views, 120); assert.deepEqual(result.countries, []); assert.deepEqual(result.demographics, []);
  assert.ok(result.unavailable.some(item => item.section === "countries")); assert.ok(result.unavailable.some(item => item.section === "demographics"));
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-token/);
});

test("required report errors reject safely and empty summary is missing rather than zero", async t => {
  const youtube = connector(); t.after(() => mock.restoreAll()); let empty = false;
  mock.method(youtube, "request", async (base: string, query: Record<string, string>) => {
    if (base.includes("/channels")) return { items: [channel] };
    if (!query.dimensions) { if (!empty) throw new Error("fixture-private-token"); return report([], []); }
    return analyticsResponse(query);
  });
  await assert.rejects(youtube.channelAnalytics(channelId, "2026-01-01", "2026-01-04"), error => { assert.match((error as Error).message, /summary/i); assert.doesNotMatch((error as Error).message, /fixture-private-token/); return true; });
  empty = true; const result = await youtube.channelAnalytics(channelId, "2026-01-01", "2026-01-04"); assert.equal(result.summary, null); assert.ok(result.unavailable.some(item => item.section === "summary"));
});

test("required report errors preserve safe API configuration recovery details", async t => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => String(input).includes("/channels?") ? new Response(JSON.stringify({ items: [channel] })) : new Response(JSON.stringify({ error: { message: "fixture-private-token", errors: [{ reason: "accessNotConfigured" }] } }), { status: 403 }));
  await assert.rejects(connector().channelAnalytics(channelId, "2026-01-01", "2026-01-04"), error => { assert.match((error as Error).message, /YouTube Analytics API is not enabled/); assert.doesNotMatch((error as Error).message, /fixture-private-token/); return true; });
});

test("catalog paginates uploads, chunks metadata and uses actual publication time with nullable statistics", async t => {
  const youtube = connector(); const batches: number[] = []; const tokens: (string | undefined)[] = []; t.after(() => mock.restoreAll());
  mock.method(youtube, "request", async (base: string, query: Record<string, string>) => {
    if (base.includes("/channels")) return { items: [channel] };
    if (base.includes("/playlistItems")) { tokens.push(query.pageToken); return query.pageToken ? { items: [{ contentDetails: { videoId: "video0000051" } }] } : { nextPageToken: "page2", items: Array.from({ length: 50 }, (_, i) => ({ contentDetails: { videoId: `video${String(i + 1).padStart(7, "0")}` } })) }; }
    const ids = query.id.split(","); batches.push(ids.length); assert.match(query.part, /status/);
    return { items: ids.map(id => ({ id, snippet: { channelId, title: id, publishedAt: "2026-01-31T18:30:00Z", thumbnails: { medium: { url: "https://yt.invalid/video.jpg" } } }, contentDetails: { duration: "PT1M2S" }, statistics: { viewCount: "99", likeCount: "3" }, status: { privacyStatus: "private" } })) };
  });
  const result = await youtube.channelVideos(channelId);
  assert.equal(result.videos.length, 51); assert.equal(result.complete, true); assert.deepEqual(tokens, [undefined, "page2"]); assert.deepEqual(batches, [50, 1]);
  assert.deepEqual(result.videos[0], { id: "video0000001", title: "video0000001", thumbnail_url: "https://yt.invalid/video.jpg", published_at: "2026-01-31T18:30:00Z", duration_seconds: 62, views: 99, likes: 3, comments: null, visibility: "private" });
  assert.equal(publicationDay(result.videos[0].published_at), "2026-02-01");
});

test("catalog bounds, partial errors and missing metadata expose incomplete coverage", async t => {
  const youtube = connector(); t.after(() => mock.restoreAll()); let fail = false;
  mock.method(youtube, "request", async (base: string, query: Record<string, string>) => {
    if (base.includes("/channels")) return { items: [channel] };
    if (base.includes("/playlistItems")) { if (fail && query.pageToken) throw new Error("fixture-private-token"); return { nextPageToken: "next", items: [{ contentDetails: { videoId: "abcdefghijk" } }] }; }
    return { items: [] };
  });
  const bounded = await youtube.channelVideos(channelId, 1); assert.equal(bounded.complete, false); assert.match(bounded.error || "", /limit|bound/i);
  fail = true; const partial = await youtube.channelVideos(channelId, 2); assert.equal(partial.complete, false); assert.ok(partial.error); assert.doesNotMatch(partial.error || "", /fixture-private-token/);
});

test("profile uses actual branding and does not turn hidden or missing counts into zero", async t => {
  const youtube = connector(); t.after(() => mock.restoreAll());
  mock.method(youtube, "request", async () => ({ items: [{ ...channel, statistics: { hiddenSubscriberCount: true, subscriberCount: "12", viewCount: "0" } }] }));
  const result = await youtube.channelProfile(channelId);
  assert.equal(result.title, "Real channel"); assert.equal(result.handle, "@real"); assert.equal(result.banner_url, "https://yt.invalid/banner.jpg"); assert.equal(result.subscribers, null); assert.equal(result.total_views, 0); assert.equal(result.total_videos, null);
});

test("report ranges validate real dates, maximum size, ordering and Pacific day boundaries", () => {
  for (const [start, end] of [["2026-02-30", "2026-03-01"], ["2026-01-02", "2026-01-01"], ["2025-01-01", "2026-01-01"], ["2999-01-01", "2999-01-02"], ["2026-1-01", "2026-01-02"]]) assert.throws(() => validateReportRange(start, end));
  assert.doesNotThrow(() => validateReportRange("2025-01-01", "2025-12-31"));
  assert.deepEqual(reportRange(7, new Date("2026-02-01T06:30:00Z")), { start: "2026-01-24", end: "2026-01-30" });
  assert.equal(publicationDay("2026-12-31T17:00:00Z"), "2027-01-01");
});

async function cachedFixture(t: TestContext) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = "1".repeat(64);
  const { encrypt } = await import("../apps/web/src/server/auth"); const { db } = await import("../apps/web/src/server/pocketbase");
  const project = { id: "channel00000001", name: "Fixture", handle: "@fixture", color: "#fff", playbook_path: "fixture", youtube_channel_id: channelId, oauth_ref: "oauth0000000001" } satisfies Channel;
  const records = new Map<string, any[]>(); const writes: string[] = []; let providerCalls = 0;
  mock.method(db, "get", async (collection: string, id: string) => { if (collection === "channels") { assert.equal(id, project.id); return project; } if (collection === "oauth_credentials") return { ciphertext: encrypt({ refresh_token: "fixture" }) }; throw new Error("Unexpected collection"); });
  mock.method(db, "list", async (collection: string, filter = "") => { if (collection === "channels") return [project]; return (records.get(collection) || []).filter(item => (!filter.includes("youtube_channel_id=") || filter.includes(JSON.stringify(item.youtube_channel_id))) && (!filter.includes("channel=") || filter.includes(JSON.stringify(item.channel)))); });
  mock.method(db, "create", async (collection: string, input: any) => { writes.push(collection); const result = { id: `record${writes.length}`, ...input }; records.set(collection, [...(records.get(collection) || []), result]); return result; });
  mock.method(db, "update", async (collection: string, id: string, input: any) => { writes.push(collection); if (collection === "channels") return Object.assign(project, input); const record = records.get(collection)?.find(item => item.id === id); assert.ok(record); return Object.assign(record, input); });
  mock.method(globalThis, "fetch", async () => { providerCalls++; throw new Error("No provider call permitted"); });
  t.after(() => { mock.restoreAll(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  return { db, project, records, writes, providerCalls: () => providerCalls };
}

test("cached GET is scope-isolated, never queries YouTube, and validates ranges first", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/projects");
  f.records.set("channel_reports", [{ id: "other", channel: f.project.id, youtube_channel_id: "UCold", start_date: "2026-01-01", end_date: "2026-01-04", report: { summary: { views: 999 } } }]);
  const result = await service.projectData(f.project.id, "2026-01-01", "2026-01-04");
  assert.equal(result.channel.id, f.project.id); assert.equal(result.report, null); assert.deepEqual(result.videos, []); assert.equal(result.catalog.complete, false); assert.equal(f.providerCalls(), 0); assert.deepEqual(f.writes, []);
  await assert.rejects(service.projectData(f.project.id, "2026-02-30", "2026-03-01"));
});

test("project sync rejects mismatched OAuth before any cache, channel, episode or vault writes", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/projects");
  mock.method(YouTubeConnector.prototype, "ownChannel", async () => ({ ...channel, id: "UCanother" }));
  await assert.rejects(service.syncProject(f.project.id, "2026-01-01", "2026-01-04"), /different channel/); assert.deepEqual(f.writes, []); assert.equal(f.providerCalls(), 0);
});

test("project sync caches actual reports and retains previous catalog on partial refresh", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/projects");
  const oldVideo = { id: "abcdefghijk", title: "Existing", published_at: "2026-01-01T12:00:00Z", thumbnail_url: "", duration_seconds: 12, views: 9, likes: null, comments: null };
  const previousCatalog = { synced_at: "2026-01-04T12:00:00Z", complete: true };
  f.records.set("channel_catalogs", [{ id: "catalog1", channel: f.project.id, youtube_channel_id: channelId, videos: [oldVideo], catalog: previousCatalog }]);
  mock.method(YouTubeConnector.prototype, "ownChannel", async () => channel);
  mock.method(YouTubeConnector.prototype, "channelAnalytics", async () => ({ start_date: "2026-01-01", end_date: "2026-01-04", summary: { views: 120 }, daily: [], unavailable: [] } as unknown as ChannelReport));
  mock.method(YouTubeConnector.prototype, "channelVideos", async () => ({ videos: [], complete: false, synced_at: new Date().toISOString(), error: "Metadata unavailable" }));
  const result = await service.syncProject(f.project.id, "2026-01-01", "2026-01-04");
  assert.equal(result.report?.summary?.views, 120); assert.equal(result.channel.profile?.title, "Real channel"); assert.deepEqual(result.videos, [oldVideo]); assert.equal(result.catalog.synced_at, previousCatalog.synced_at); assert.equal(result.catalog.complete, false); assert.match(result.catalog.error || "", /Metadata unavailable/);
  assert.ok(f.writes.includes("channel_reports")); assert.ok(f.writes.every(value => ["channels", "channel_reports", "channel_catalogs"].includes(value))); assert.equal(f.providerCalls(), 0);
});

test("partial catalog refresh merges new uploads and fresh statistics without losing known older history", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/projects");
  const video = (id: string, views: number) => ({ id, title: id, published_at: "2026-01-01T12:00:00Z", thumbnail_url: "", duration_seconds: 12, views, likes: null, comments: null });
  f.records.set("channel_catalogs", [{ id: "catalog1", channel: f.project.id, youtube_channel_id: channelId, videos: [video("old", 5), video("updated", 6)], catalog: { synced_at: "2026-01-01T12:00:00Z", complete: true } }]);
  mock.method(YouTubeConnector.prototype, "ownChannel", async () => channel);
  mock.method(YouTubeConnector.prototype, "channelAnalytics", async () => ({ start_date: "2026-01-01", end_date: "2026-01-04", summary: { views: 120 }, daily: [], unavailable: [] } as unknown as ChannelReport));
  mock.method(YouTubeConnector.prototype, "channelVideos", async () => ({ videos: [video("updated", 20), video("new", 1)], complete: false, synced_at: "2026-01-04T12:00:00Z", error: "Some uploads are unavailable" }));
  const result = await service.syncProject(f.project.id, "2026-01-01", "2026-01-04");
  assert.deepEqual(new Map(result.videos.map(item => [item.id, item.views])), new Map([["old", 5], ["updated", 20], ["new", 1]])); assert.equal(result.catalog.complete, false); assert.equal(result.catalog.synced_at, "2026-01-04T12:00:00Z"); assert.match(result.catalog.error || "", /older cached|previous/i);
});

test("required sync errors preserve previous reports and profile refresh writes no report caches", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/projects");
  const oldReport = { start_date: "2026-01-01", end_date: "2026-01-04", summary: { views: 42 } };
  f.records.set("channel_reports", [{ id: "report1", channel: f.project.id, youtube_channel_id: channelId, start_date: "2026-01-01", end_date: "2026-01-04", report: oldReport }]);
  mock.method(YouTubeConnector.prototype, "ownChannel", async () => channel);
  mock.method(YouTubeConnector.prototype, "channelAnalytics", async () => { throw new Error("Summary unavailable"); });
  await assert.rejects(service.syncProject(f.project.id, "2026-01-01", "2026-01-04"), /Summary unavailable/); assert.deepEqual(f.records.get("channel_reports")?.[0].report, oldReport);
  f.writes.length = 0; const result = await service.syncProjectProfiles(); assert.deepEqual(result, { results: [{ channel: "Fixture" }] }); assert.deepEqual(f.writes, ["channels"]);
});

test("project routes require owner authentication and reject cross-origin mutations before database writes", async t => {
  const f = await cachedFixture(t); const route = await import("../apps/web/src/app/api/[...path]/route");
  const context = { params: Promise.resolve({ path: ["projects", f.project.id] }) };
  const anonymous = await route.GET(new NextRequest(`http://127.0.0.1:3100/api/projects/${f.project.id}?start=2026-01-01&end=2026-01-04`), context);
  assert.equal(anonymous.status, 401); assert.equal(f.providerCalls(), 0);
  const blocked = await route.POST(new NextRequest(`http://127.0.0.1:3100/api/projects/${f.project.id}/sync`, { method: "POST", headers: { origin: "https://untrusted.invalid", cookie: "studio_session=fixture", "Content-Type": "application/json" }, body: JSON.stringify({ start: "2026-01-01", end: "2026-01-04" }) }), { params: Promise.resolve({ path: ["projects", f.project.id, "sync"] }) });
  assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /origin/); assert.deepEqual(f.writes, []); assert.equal(f.providerCalls(), 0);
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ record: { id: "owner0000000001", email: "fixture@example.invalid" } })));
  const authorized = await route.GET(new NextRequest(`http://127.0.0.1:3100/api/projects/${f.project.id}?start=2026-01-01&end=2026-01-04`, { headers: { cookie: "studio_session=fixture" } }), context);
  assert.equal(authorized.status, 200); assert.equal((await authorized.json()).channel.id, f.project.id); assert.deepEqual(f.writes, []);
  const invalid = await route.POST(new NextRequest(`http://127.0.0.1:3100/api/projects/${f.project.id}/sync`, { method: "POST", headers: { cookie: "studio_session=fixture", "Content-Type": "application/json" }, body: JSON.stringify({ start: "2026-02-30", end: "2026-03-01" }) }), { params: Promise.resolve({ path: ["projects", f.project.id, "sync"] }) });
  assert.equal(invalid.status, 400); assert.deepEqual(f.writes, []);
});

test("channel migration adds private caches without altering OAuth credentials or production collections", async () => {
  const source = await readFile(new URL("../infra/pocketbase/pb_migrations/1793059202_channel_projects.js", import.meta.url), "utf8");
  let migrateUp: (app: any) => void = () => {}; const saved: any[] = []; const fields: any[] = [];
  const channels = { name: "channels", fields: { add(field: any) { fields.push(field); } } };
  class Field { constructor(value: any) { Object.assign(this, value); } }
  vm.runInNewContext(source, { migrate(up: typeof migrateUp) { migrateUp = up; }, JSONField: Field, Collection: Field });
  migrateUp({ findCollectionByNameOrId(name: string) { assert.equal(name, "channels"); return channels; }, save(collection: any) { saved.push(collection); } });
  assert.equal(fields[0].name, "profile"); assert.deepEqual(saved.map(value => value.name), ["channels", "channel_reports", "channel_catalogs"]);
  for (const collection of saved.slice(1)) { for (const permission of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) assert.equal(collection[permission], null); assert.ok(collection.indexes[0].includes("UNIQUE")); }
});

test("daily sync continues existing video analysis when the project report fails without creating episodes", async t => {
  const f = await cachedFixture(t); const service = await import("../apps/web/src/server/service");
  const episode = { id: "episode00000001", channel: f.project.id, youtube_video_id: "abcdefghijk" };
  mock.method(YouTubeConnector.prototype, "ownChannel", async () => channel);
  mock.method(YouTubeConnector.prototype, "channelAnalytics", async () => { throw new Error("Summary unavailable"); });
  let episodeCalls = 0;
  mock.method(YouTubeConnector.prototype, "analytics", async () => { episodeCalls++; return { views: 5 } as any; });
  mock.method(f.db, "get", async (collection: string) => { if (collection === "episodes") return episode; if (collection === "channels") return f.project; const { encrypt } = await import("../apps/web/src/server/auth"); return { ciphertext: encrypt({ refresh_token: "fixture" }) }; });
  mock.method(f.db, "list", async (collection: string) => collection === "channels" ? [f.project] : collection === "episodes" ? [episode] : []);
  const result = await service.syncAll();
  assert.equal(episodeCalls, 1); assert.ok(result.results.some(item => item.video === episode.youtube_video_id)); assert.ok(result.results.some(item => item.error === "Summary unavailable")); assert.deepEqual(f.writes, ["analytics_snapshots"]);
});
