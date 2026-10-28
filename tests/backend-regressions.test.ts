import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "@studio/core";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";

const beat = (index: number, text: string, seconds = 3) => ({ index, text, prompt: "A still", seconds, image: "", video: "" });

test("storyboard documents reject duplicate/reordered indices and excessive aggregate duration", () => {
  assert.throws(() => core.parseStoryboard(core.serializeStoryboard([beat(1, "First"), beat(1, "Second")])));
  assert.throws(() => core.parseStoryboard(core.serializeStoryboard([beat(2, "First"), beat(1, "Second")])));
  assert.throws(() => core.parseStoryboard(core.serializeStoryboard(Array.from({ length: 13 }, (_, index) => beat(index + 1, "Long", 600)))));
  assert.throws(() => core.parseStoryboard("| 1 | text | prompt | NaN | | |"));
  assert.throws(() => core.parseStoryboard("| invalid | text | prompt | 3 | | |"));
  assert.throws(() => core.parseStoryboard("Unstructured prose is not a storyboard table."));
  assert.deepEqual(core.parseStoryboard(""), []);
});

test("generated storyboards must cover all approved narration once and in order", () => {
  const validate = (core as typeof core & { validateStoryboardCoverage(script: string, beats: core.Beat[]): core.Beat[] }).validateStoryboardCoverage;
  for (const beats of [[beat(1, "Second line.")], [beat(1, "Second line."), beat(2, "First line.")], [beat(1, "First line."), beat(2, "First line."), beat(3, "Second line.")], [beat(1, "")]]) {
    assert.throws(() => validate("First line. Second line.", beats), /complete|voiceover|narration/i);
  }
  assert.equal(validate("# Episode\n\n0:00 First line.\n0:03 Second line.", [beat(1, "First line."), beat(2, "Second line.")]).length, 2);
  assert.throws(() => validate("# Episode\nFirst line.\n[whispering] Second line.", [beat(1, "First line. Second line.")]), /complete|voiceover|narration/i);
});

test("diagnosis quotes belong to the timestamped interval rather than anywhere in the script", () => {
  const finding = (timestamp: number, quote: string) => ({ summary: "Finding", findings: [{ timestamp, quote, observation: "A measured drop", recommendation: "Review this beat" }] });
  const script = "0:00 Opening line.\n0:29 Ending line.";
  assert.throws(() => core.validateDiagnosis(finding(29, "Opening line."), script, 30), /interval|timing|timestamp|beat/i);
  assert.equal(core.validateDiagnosis(finding(29, "Ending line."), script, 30).findings[0].quote, "Ending line.");
  assert.throws(() => core.validateDiagnosis(finding(4, "Opening line."), "Opening line.", 30), /timing|time cues|timed/i);
  const validate = core.validateDiagnosis as (value: unknown, script: string, duration: number, beats?: core.Beat[]) => ReturnType<typeof core.validateDiagnosis>;
  assert.equal(validate(finding(4, "Second line."), "First line. Second line.", 6, [beat(1, "First line."), beat(2, "Second line.")]).findings[0].timestamp, 4);
  assert.throws(() => validate(finding(4, "First line."), "First line. Second line.", 6, [beat(1, "First line."), beat(2, "Second line.")]), /interval|timing|timestamp|beat/i);
});

test("same-identity worker heartbeat cannot preserve an abandoned paid job", async () => {
  const source = await readFile(new URL("../infra/pocketbase/pb_hooks/lib/studio.js", import.meta.url), "utf8");
  const record = (values: Record<string, unknown>) => ({ id: String(values.id), values, getString(key: string) { return String(this.values[key] || ""); }, getBool(key: string) { return Boolean(this.values[key]); }, set(key: string, value: unknown) { this.values[key] = value; } });
  const abandoned = record({ id: "abandoned000001", status: "running", worker_id: "worker000000001", updated: new Date(Date.now() - 180_000).toISOString(), payload: JSON.stringify({ spend_id: "spend0000000001" }), log: "" });
  const live = record({ id: "livejob00000001", status: "running", worker_id: "worker000000001", updated: new Date().toISOString(), payload: "{}", log: "" });
  const worker = record({ id: "worker000000001", heartbeat: new Date().toISOString() });
  const spend = record({ id: "spend0000000001", status: "reserved" });
  const app = { findRecordsByFilter() { return [abandoned, live]; }, findRecordById(collection: string, id: string) { if (collection === "workers") return worker; if (collection === "spend_log") return spend; return id === abandoned.id ? abandoned : live; }, save() {}, runInTransaction(callback: (tx: unknown) => void) { callback(this); } };
  const context = { module: { exports: {} as { expireLeases(): void } }, $app: app, Date };
  vm.runInNewContext(source, context);
  context.module.exports.expireLeases();
  assert.equal(abandoned.values.status, "failed");
  assert.equal(spend.values.status, "failed");
  assert.equal(live.values.status, "running");
  assert.match(String(abandoned.values.log), /not automatically retried/i);
});

registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

test("invalid storyboard saves retain the valid document and its history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-vault-regression-"));
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected test root");
  const previous = process.env.VAULT_ROOT;
  process.env.VAULT_ROOT = root;
  try {
    const vault = await import("../apps/web/src/server/vault");
    await mkdir(path.join(root, "Fixture", "episode"), { recursive: true });
    const original = core.serializeStoryboard([beat(1, "Original narration.")]);
    await vault.writeDocument("Fixture/episode", "storyboard.md", original);
    await assert.rejects(vault.writeDocument("Fixture/episode", "storyboard.md", core.serializeStoryboard([beat(1, "Invalid", 0)])));
    assert.equal(await vault.readDocument("Fixture/episode", "storyboard.md"), original);
    await writeFile(path.join(root, "Fixture", "episode", "storyboard.md"), "| 1 | broken | prompt | 0 | | |\n");
    const state = await (vault as typeof vault & { readStoryboardState(folder: string): Promise<{ beats: core.Beat[]; error: string | null }> }).readStoryboardState("Fixture/episode");
    assert.deepEqual(state.beats, []);
    assert.ok(state.error);
    assert.match(await vault.readDocument("Fixture/episode", "storyboard.md"), /broken/);
  } finally {
    if (previous === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
