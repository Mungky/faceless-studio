import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Episode } from "@studio/core";

registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

const revision = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-service-regression-"));
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected fixture path");
  const previous = { VAULT_ROOT: process.env.VAULT_ROOT, NINEROUTER_URL: process.env.NINEROUTER_URL };
  process.env.VAULT_ROOT = directory; process.env.NINEROUTER_URL = "http://fixture.invalid/v1";
  const folder = path.join(directory, "Fixture", "episode"); await mkdir(folder, { recursive: true });
  const script = "First line. Second line.";
  await writeFile(path.join(folder, "script.md"), script);
  await writeFile(path.join(directory, "Fixture", "playbook.md"), "Fixture instructions.");
  const episode = { id: "episode00000001", channel: "channel00000001", title: "Fixture", slug: "episode", status: "script", format: "short", vault_path: "Fixture/episode", script_approved: true, script_meta: { approved_revision: revision(script) } } as unknown as Episode;
  const { db } = await import("../apps/web/src/server/pocketbase");
  const service = await import("../apps/web/src/server/service");
  const snapshot = { id: "snapshot0000001", metrics: { duration_seconds: 6, retention: [{ elapsed_ratio: 0.5, retention: 0.6 }] } };
  let quote: any;
  let reservations = 0;
  let providerCalls = 0;
  let generation = async () => JSON.stringify({ beats: [{ index: 1, text: script, prompt: "A scene", seconds: 6, image: "", video: "" }] });
  mock.method(db, "get", async (collection: string) => collection === "episodes" ? episode : collection === "channels" ? { id: episode.channel, name: "Fixture", playbook_path: "Fixture/playbook.md" } : collection === "analytics_snapshots" ? snapshot : quote);
  mock.method(db, "list", async (collection: string) => collection === "settings" ? [{ id: "setting00000001", value: {} }] : collection === "model_routes" ? [{ model: "fixture", max_output_tokens: 256, billing: "free", usd_per_1k_chars: 0 }] : collection === "analytics_snapshots" ? [snapshot] : []);
  mock.method(db, "create", async (_collection: string, input: any) => { quote = { ...input, id: "quote0000000001" }; return quote; });
  mock.method(db, "custom", async () => { reservations++; return { spend: { id: "spend0000000001" }, reused: false }; });
  mock.method(db, "update", async (collection: string, _id: string, input: any) => { if (collection === "episodes") Object.assign(episode, input); return input; });
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).endsWith("/api/collections/studio_users/auth-refresh")) return new Response(JSON.stringify({ record: { id: "owner0000000001", email: "fixture@example.invalid" } }), { headers: { "Content-Type": "application/json" } });
    assert.equal(String(input), "http://fixture.invalid/v1/chat/completions", "No unexpected provider/network request is allowed in this test");
    providerCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: await generation() } }], usage: {} }), { headers: { "Content-Type": "application/json" } });
  });
  t.after(async () => {
    mock.restoreAll();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  return { service, folder, script, episode, get quote() { return quote; }, get reservations() { return reservations; }, get providerCalls() { return providerCalls; }, generate(fn: typeof generation) { generation = fn; } };
}

test("external script edits invalidate approval in details and block storyboard quotes", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, "script.md"), "Externally edited narration.");
  const detail = await f.service.episodeDetails(f.episode.id);
  assert.equal(detail.episode.script_approved, false);
  await assert.rejects(f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001"), /approve|revision|changed/i);
  assert.equal(f.reservations, 0); assert.equal(f.providerCalls, 0);
});

test("stale storyboard quotes fail before reservation or provider call", async t => {
  const f = await fixture(t);
  await f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001");
  await writeFile(path.join(f.folder, "script.md"), "Externally edited narration.");
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /approve|revision|changed/i);
  assert.equal(f.reservations, 0); assert.equal(f.providerCalls, 0);
});

test("revoking script approval invalidates an otherwise current storyboard quote", async t => {
  const f = await fixture(t);
  await f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001");
  f.episode.script_approved = false;
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /approve|revision|changed/i);
  assert.equal(f.reservations, 0); assert.equal(f.providerCalls, 0);
});

test("narration omissions never overwrite an existing storyboard after generation", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, "storyboard.md"), "original storyboard");
  await f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001");
  f.generate(async () => JSON.stringify({ beats: [{ index: 1, text: "Second line.", prompt: "scene", seconds: 3, image: "", video: "" }] }));
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /complete|voiceover/i);
  assert.equal(await readFile(path.join(f.folder, "storyboard.md"), "utf8"), "original storyboard");
});

test("edits during generation preserve the edited storyboard and recover generated draft", async t => {
  const f = await fixture(t);
  await f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001");
  f.generate(async () => {
    await writeFile(path.join(f.folder, "script.md"), "New user script.");
    await writeFile(path.join(f.folder, "storyboard.md"), "User's concurrent storyboard edit.");
    return JSON.stringify({ beats: [{ index: 1, text: f.script, prompt: "A scene", seconds: 6, image: "", video: "" }] });
  });
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /draft|changed/i);
  assert.equal(await readFile(path.join(f.folder, "storyboard.md"), "utf8"), "User's concurrent storyboard edit.");
  const drafts = await readdir(path.join(f.folder, ".studio-drafts"));
  assert.equal(drafts.length, 1);
  assert.match(await readFile(path.join(f.folder, ".studio-drafts", drafts[0]), "utf8"), /First line\. Second line\./);
});

test("untimed diagnosis is blocked while requesting its quote before any provider reservation", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.makeQuote({ episode: f.episode.id, operation: "diagnosis", input: "" }, "owner0000000001"), /timing|time cues/i);
  assert.equal(f.reservations, 0); assert.equal(f.providerCalls, 0);
});

test("script approval PATCH rejects an unseen revision and stores the reviewed hash", async t => {
  const f = await fixture(t);
  f.episode.script_approved = false;
  const { NextRequest } = await import("next/server");
  const { PATCH } = await import("../apps/web/src/app/api/[...path]/route");
  const request = (script_revision: string) => new NextRequest(`http://127.0.0.1:3100/api/episodes/${f.episode.id}`, { method: "PATCH", headers: { Cookie: "studio_session=fixture", "Content-Type": "application/json" }, body: JSON.stringify({ script_approved: true, script_revision }) });
  const params = { params: Promise.resolve({ path: ["episodes", f.episode.id] }) };
  const stale = await PATCH(request(revision("An earlier revision")), params);
  assert.equal(stale.status, 409);
  assert.equal(f.episode.script_approved, false);
  const accepted = await PATCH(request(revision(f.script)), params);
  assert.equal(accepted.status, 200);
  assert.equal(f.episode.script_meta.approved_revision, revision(f.script));
});

test("storyboard document PUT rejects invalid timing without overwriting current content", async t => {
  const f = await fixture(t);
  const original = "# Storyboard\n\n| Beat | Voiceover | Still prompt | Seconds | Image asset | Video asset |\n| --- | --- | --- | --- | --- | --- |\n| 1 | Original. | Scene | 3 | | |\n";
  await writeFile(path.join(f.folder, "storyboard.md"), original);
  const { NextRequest } = await import("next/server");
  const { PUT } = await import("../apps/web/src/app/api/[...path]/route");
  const response = await PUT(new NextRequest(`http://127.0.0.1:3100/api/episodes/${f.episode.id}/documents`, { method: "PUT", headers: { Cookie: "studio_session=fixture", "Content-Type": "application/json" }, body: JSON.stringify({ name: "storyboard.md", content: "| 1 | Invalid. | Scene | 0 | | |", revision: revision(original) }) }), { params: Promise.resolve({ path: ["episodes", f.episode.id, "documents"] }) });
  assert.equal(response.status, 400);
  assert.equal(await readFile(path.join(f.folder, "storyboard.md"), "utf8"), original);
});

test("externally corrupted storyboards remain readable with repair information", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, "storyboard.md"), "| 1 | Broken. | Scene | 0 | | |\n");
  const detail = await f.service.episodeDetails(f.episode.id);
  assert.match(detail.storyboard_error || "", /repair/);
  assert.match(detail.storyboard_error || "", /duration between 0.1 and 600/);
  assert.doesNotMatch(detail.storyboard_error || "", /"origin"|"code"/);
  assert.deepEqual(detail.beats, []);
  assert.match(detail.documents["storyboard.md"], /Broken/);
});

test("diagnosis uses supplied complete storyboard timing and rejects a mismatched quote interval", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, "storyboard.md"), "| 1 | First line. | Scene | 3 | | |\n| 2 | Second line. | Scene | 3 | | |\n");
  await f.service.makeQuote({ episode: f.episode.id, operation: "diagnosis", input: "" }, "owner0000000001");
  assert.match(f.quote.payload.input, /"start":3,"end":6,"text":"Second line\."/);
  f.generate(async () => JSON.stringify({ summary: "Drop", findings: [{ timestamp: 4, quote: "First line.", observation: "Drop", recommendation: "Review" }] }));
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /interval/);
});


test("Flow quotes and old approvals fail before spending reservation", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.makeQuote({ episode: f.episode.id, operation: "image", provider: "flow", input: "Never submit" }, "owner0000000001"), /verified retry limit/);
  await f.service.makeQuote({ episode: f.episode.id, operation: "storyboard", input: "" }, "owner0000000001");
  f.quote.provider = "flow";
  await assert.rejects(f.service.approveQuote(f.quote.id, "owner0000000001"), /verified retry limit/);
  assert.equal(f.reservations, 0); assert.equal(f.providerCalls, 0);
});

test("publication time requires a real past date and resets across publication transitions", async t => {
  const f = await fixture(t);
  const { NextRequest } = await import("next/server");
  const { PATCH } = await import("../apps/web/src/app/api/[...path]/route");
  const patch = (body: unknown) => PATCH(new NextRequest(`http://127.0.0.1:3100/api/episodes/${f.episode.id}`, { method: "PATCH", headers: { Cookie: "studio_session=fixture", "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ path: ["episodes", f.episode.id] }) });
  assert.equal((await patch({ published_at: "2020-01-01T00:00:00.000Z" })).status, 400);
  assert.equal((await patch({ status: "published" })).status, 200);
  assert.equal(f.episode.published_at, "");
  assert.equal((await patch({ published_at: "2999-01-01T00:00:00.000Z" })).status, 400);
  assert.equal((await patch({ published_at: "2020-01-01T00:00:00.000Z" })).status, 200);
  assert.equal(f.episode.published_at, "2020-01-01T00:00:00.000Z");
  assert.equal((await patch({ status: "review" })).status, 200);
  assert.equal(f.episode.published_at, "");
  assert.equal((await patch({ status: "published" })).status, 200);
  assert.equal(f.episode.published_at, "");
});
