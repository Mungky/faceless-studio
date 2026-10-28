import { test } from "node:test";
import assert from "node:assert/strict";
import { readStudioLocation, studioUrl } from "../apps/web/src/components/navigation";
import { publicationDay, reportRange, validateReportRange } from "@studio/core";

test("home opens Projects and invalid scopes do not leak into navigation", () => {
  assert.deepEqual(readStudioLocation(""), { view: "projects", project: "", episode: "" });
  assert.deepEqual(readStudioLocation("?view=unknown&project=../bad&episode=bad"), { view: "projects", project: "", episode: "" });
});
test("project and production deep links round trip independently", () => {
  const project = "arthur000000001";
  const url = studioUrl({ view: "projects", project, episode: "" });
  assert.deepEqual(readStudioLocation(url.slice(1)), { view: "projects", project, episode: "" });
  assert.deepEqual(readStudioLocation("?view=assets&project=" + project + "&episode=episode00000001"), { view: "studio", project, episode: "episode00000001" });
  assert.equal(studioUrl({ view: "assets", project, episode: "" }), "/?view=assets&project=" + project);
});
test("video analytics deep links retain the exact project and video", () => {
  const location = { view: "projects" as const, project: "arthur000000001", episode: "", tab: "videos" as const, video: "abcdefghijk" };
  assert.deepEqual(readStudioLocation(studioUrl(location).slice(1)), location);
  assert.deepEqual(readStudioLocation("?view=analytics&project=arthur000000001&video=abcdefghijk"), location);
  assert.deepEqual(readStudioLocation("?view=episodes&episode=episode00000001"), {view:"studio",project:"",episode:"episode00000001"});
  assert.deepEqual(readStudioLocation("?view=projects&project=arthur000000001&tab=videos&video=../bad"), {view:"projects",project:"arthur000000001",episode:"",tab:"videos"});
});

test("workflow templates and production conversations retain independent deep links", () => {
  const template={view:"studio" as const,project:"notyet000000001",episode:"",workflow:"not-yet"};
  const run={view:"studio" as const,project:"notyet000000001",episode:"",run:"run000000000001"};
  assert.deepEqual(readStudioLocation(studioUrl(template).slice(1)),template);
  assert.deepEqual(readStudioLocation(studioUrl(run).slice(1)),run);
  assert.deepEqual(readStudioLocation("?view=studio&workflow=../escape&run=bad"),{view:"studio",project:"",episode:""});
  assert.deepEqual(readStudioLocation("?view=projects&workflow=not-yet"),{view:"projects",project:"",episode:""});
  assert.deepEqual(readStudioLocation("?view=studio&episode=episode00000001&run=run000000000001&workflow=not-yet"),{view:"studio",project:"",episode:"episode00000001"});
});
test("publication calendar respects Jakarta month rollover", () => {
  assert.equal(publicationDay("2026-01-31T17:01:00Z"), "2026-02-01");
  assert.equal(publicationDay("2026-01-31T16:59:00Z"), "2026-01-31");
  assert.throws(() => publicationDay("not-a-date"));
});
test("default ranges use completed Pacific reporting days", () => {
  assert.deepEqual(reportRange(7, new Date("2026-10-28T02:00:00Z")), { start: "2026-10-20", end: "2026-10-26" });
});
test("report ranges reject rollover dates, reversed ranges and oversized intervals", () => {
  validateReportRange("2024-02-29", "2024-03-01");
  for (const [start, end] of [["2025-02-29", "2025-03-01"], ["2024-03-01", "2024-02-29"], ["2024-01-01", "2025-01-01"], ["2024-1-1", "2024-01-02"]]) assert.throws(() => validateReportRange(start, end));
});
