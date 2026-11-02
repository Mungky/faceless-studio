import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

// Memory and rules are Markdown files in the project's vault folder; n8n is a small in-memory stand-in.
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "assistant-memory-")), previous = { VAULT_ROOT: process.env.VAULT_ROOT, N8N_URL: process.env.N8N_URL, N8N_API_KEY: process.env.N8N_API_KEY };
  await mkdir(path.join(directory, "Arthur"), { recursive: true });
  process.env.VAULT_ROOT = directory; process.env.N8N_URL = "http://n8n.test"; process.env.N8N_API_KEY = "k";
  const workflow = { id: "wf1", name: "Arthur", active: false, settings: { executionOrder: "v1" }, connections: {}, nodes: [{ id: "a", name: "Mulai", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: {} }] } as any;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    if (!String(input).startsWith("http://n8n.test/api/v1/workflows/wf1")) return new Response("{}", { status: 404 });
    if ((init.method || "GET") === "PUT") Object.assign(workflow, JSON.parse(init.body));
    return new Response(JSON.stringify(workflow), { status: 200 });
  }) as typeof fetch;
  t.after(async () => { globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } await rm(directory, { recursive: true, force: true }); });
  const tools = await import("../apps/web/src/server/assistant-tools"), notes = await import("../apps/web/src/server/assistant-memory"), skills = await import("../apps/web/src/server/assistant-skills");
  return { ...tools, ...notes, ...skills, workflow, directory, ctx: (extra: object = {}) => ({ channel: "chan", workflowId: "wf1", snaps: [] as any[], folder: "Arthur", ...extra }) };
}

test("a run may add only a few nodes; the owner's next message starts a fresh budget", async t => {
  const f = await fixture(t), ctx = f.ctx({ budget: { adds: f.NODE_ADD_LIMIT } });
  assert.equal((await f.runTool(ctx, { action: "add_n8n_node", name: "Satu", node_type: "n8n-nodes-base.set" })).ok, true);
  assert.equal((await f.runTool(ctx, { action: "add_n8n_node", name: "Dua", node_type: "n8n-nodes-base.set" })).ok, true);
  const third = await f.runTool(ctx, { action: "add_n8n_node", name: "If liar", node_type: "n8n-nodes-base.if" });
  assert.equal(third.ok, false); assert.match(third.approval!, /di atas batas 2/); assert.match(third.message, /BELUM DIJALANKAN/);
  assert.equal(f.workflow.nodes.some((n: any) => n.name === "If liar"), false, "the held-back node never reached n8n");
  const bulk = await f.runTool(ctx, { action: "replace_workflow", nodes: [...f.workflow.nodes, { name: "X", type: "t" }], connections: f.workflow.connections });
  assert.equal(bulk.ok, false); assert.ok(bulk.approval, "replace_workflow always waits for the owner's button");
  // Only the owner's approval lets the held-back action through.
  assert.equal((await f.runTool({ ...ctx, approved: true, budget: undefined }, { action: "add_n8n_node", name: "If liar", node_type: "n8n-nodes-base.if" })).ok, true);
  assert.equal(f.workflow.nodes.some((n: any) => n.name === "If liar"), true);
  // Changing existing nodes is not "adding": it stays allowed once the budget is spent.
  assert.equal((await f.runTool(ctx, { action: "modify_n8n_node", node_name: "Satu", prompt: "x" })).ok, true);
  assert.equal((await f.runTool(f.ctx({ budget: { adds: f.NODE_ADD_LIMIT } }), { action: "add_n8n_node", name: "Tiga", node_type: "n8n-nodes-base.set" })).ok, true, "a new message starts a fresh budget");
});

test("rules and memory are saved as Markdown in the project's vault folder", async t => {
  const f = await fixture(t), ctx = f.ctx();
  assert.equal(await f.readNotes("Arthur", "rules"), "", "nothing yet");
  assert.equal((await f.runTool(ctx, { action: "save_rule", rule: "Jangan pernah menambah node If atau Wait." })).ok, true);
  assert.equal((await f.runTool(ctx, { action: "save_rule", rule: "jangan pernah menambah node if atau wait." })).message, "Sudah tercatat sebelumnya.");
  assert.equal((await f.runTool(ctx, { action: "save_memory", note: "Workflow Arthur membaca /vault/Arthur/decision-log.md" })).ok, true);
  assert.match(await readFile(path.join(f.directory, "Arthur", "ATURAN-ASSISTANT.md"), "utf8"), /^# Aturan tetap assistant[\s\S]*- Jangan pernah menambah node If atau Wait\.\n$/);
  const memory = await f.readNotes("Arthur", "memory");
  assert.match(memory, /^- \d{4}-\d{2}-\d{2}: Workflow Arthur membaca \/vault\/Arthur\/decision-log\.md$/);
  assert.equal((await f.runTool(ctx, { action: "save_memory", note: "   " })).ok, false);
  assert.equal((await f.runTool(f.ctx({ folder: undefined }), { action: "save_memory", note: "x" })).ok, false, "no folder is reported, not crashed");
  assert.equal((await f.runTool(ctx, { action: "rewrite_memory", content: "- 2026-11-02: Ringkas." })).ok, true);
  assert.equal(await f.readNotes("Arthur", "memory"), "- 2026-11-02: Ringkas.");
});

test("a full memory forgets its oldest lines; full rules refuse instead of dropping one", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 60; i++) await f.addNote("Arthur", "memory", `catatan ${i} ` + "x".repeat(380));
  const memory = await f.readNotes("Arthur", "memory");
  assert.ok(memory.length <= 12_000);
  assert.match(memory, /catatan 59 /, "the newest note is kept");
  assert.doesNotMatch(memory, /catatan 0 /, "the oldest was dropped");
  await assert.rejects(async () => { for (let i = 0; i < 40; i++) await f.addNote("Arthur", "rules", `aturan ${i} ` + "y".repeat(380)); }, /penuh/);
  assert.match(await f.readNotes("Arthur", "rules"), /aturan 0 /, "no earlier rule was silently dropped");
});

test("skills are read on demand, saved in the vault, and a project skill overrides a built-in one", async t => {
  const f = await fixture(t), ctx = f.ctx();
  assert.ok((await f.listSkills("Arthur")).some(s => s.name === "ubah-prompt-dari-playbook" && s.scope === "bawaan"), "built-in skills come with the app");
  const read = await f.runTool(ctx, { action: "read_skill", name: "ubah-prompt-dari-playbook" });
  assert.equal(read.ok, true); assert.match(String(read.data), /Petakan setiap tahap/);
  assert.equal((await f.runTool(ctx, { action: "read_skill", name: "tidak-ada" })).ok, false);

  assert.equal((await f.runTool(ctx, { action: "save_skill", name: "Cek Telegram", description: "Cara menguji pengiriman Telegram.", content: "1. Buka node Telegram.\n2. Jalankan uji dan baca hasilnya." })).ok, true);
  assert.match(await readFile(path.join(f.directory, "Arthur", "Assistant Skills", "cek-telegram.md"), "utf8"), /^---\nname: cek-telegram\ndescription: Cara menguji pengiriman Telegram\.\n---\n1\. Buka node/);

  await f.runTool(ctx, { action: "save_skill", name: "edit-aman", description: "Versi project.", content: "Aturan khusus project Arthur: jangan sentuh node Telegram." });
  const mine = await f.readSkill("Arthur", "edit-aman");
  assert.equal(mine.scope, "project"); assert.match(mine.content, /jangan sentuh node Telegram/);
  assert.equal((await f.readSkill("Not Yet", "edit-aman")).scope, "bawaan", "another project still sees the built-in one");

  assert.equal((await f.runTool(ctx, { action: "save_skill", name: "umum", scope: "global", description: "Berlaku di semua project.", content: "Langkah umum yang berguna untuk semua project." })).ok, true);
  assert.ok((await f.listSkills("Not Yet")).some(s => s.name === "umum" && s.scope === "global"), "a global skill reaches every project");

  for (const bad of [{ name: "A!", description: "x", content: "x".repeat(40) }, { name: "ok-nama", description: "", content: "x".repeat(40) }, { name: "ok-nama", description: "d", content: "pendek" }, { name: "ok-nama", description: "d", content: "x".repeat(7000) }])
    assert.equal((await f.runTool(ctx, { action: "save_skill", ...bad })).ok, false, JSON.stringify(bad).slice(0, 60));

  // A skill written by hand in Obsidian is picked up like any other.
  await writeFile(path.join(f.directory, "Arthur", "Assistant Skills", "tulis-tangan.md"), "---\nname: tulis-tangan\ndescription: Ditulis di Obsidian.\n---\nIsi langkahnya di sini, cukup panjang.\n");
  assert.equal((await f.listSkills("Arthur")).find(s => s.name === "tulis-tangan")?.description, "Ditulis di Obsidian.");
  await f.deleteSkill("Arthur", "cek-telegram", "project");
  assert.ok(!(await f.listSkills("Arthur")).some(s => s.name === "cek-telegram"));
});

test("the Memori panel can list and delete what was remembered", async t => {
  const f = await fixture(t);
  await f.addNote("Arthur", "memory", "Jadwal Arthur jam 19.00 WIB"); await f.addNote("Arthur", "memory", "Path decision log ada di /vault/Arthur"); await f.addNote("Arthur", "rules", "Jangan menambah node If");
  assert.equal((await f.noteLines("Arthur", "memory")).length, 2);
  assert.equal(await f.removeNote("Arthur", "memory", "jadwal arthur"), 1);
  assert.deepEqual((await f.noteLines("Arthur", "memory")).map(l => l.replace(/^- \d{4}-\d{2}-\d{2}: /, "")), ["Path decision log ada di /vault/Arthur"]);
  assert.equal(await f.removeNote("Arthur", "memory", "tidak ada"), 0);
  await assert.rejects(f.removeNote("Arthur", "memory", "  "), /bagian catatan/);
  assert.equal(await f.removeNote("Arthur", "rules", "node if"), 1);
  assert.deepEqual(await f.noteLines("Arthur", "rules"), []);
});

// Regression from a real chat: a big restructuring could only be written as one huge replace and never became approvable.
test("a plan is all-or-nothing, allows only small steps, and backs the workflow up to the vault first", async t => {
  const f = await fixture(t), ctx = f.ctx(), original = JSON.stringify(f.workflow);
  const plan = { action: "propose_plan", steps: [{ action: "add_n8n_node", name: "A1", node_type: "n8n-nodes-base.set", connect_from: "Mulai" }, { action: "add_n8n_node", name: "A2", node_type: "n8n-nodes-base.set", connect_from: "A1" }, { action: "add_n8n_node", name: "A3", node_type: "n8n-nodes-base.set", connect_from: "A2" }] };
  const held = await f.runTool({ ...ctx, budget: { adds: 2 } }, plan);
  assert.ok(held.approval); assert.match(held.approval!, /rencana 3 langkah/); assert.equal(JSON.stringify(f.workflow), original, "nothing ran without the owner");

  // One failing step puts everything back, including the steps that already worked.
  const bad = await f.runTool({ ...ctx, approved: true }, { action: "propose_plan", steps: [{ action: "add_n8n_node", name: "B1", node_type: "n8n-nodes-base.set" }, { action: "modify_n8n_node", node_name: "Tidak ada", prompt: "x" }] });
  assert.equal(bad.ok, false); assert.match(bad.message, /langkah 2.*gagal.*dikembalikan/i);
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai"], "the first step was rolled back"); assert.equal(ctx.snaps.length, 0);

  for (const step of [{ action: "replace_workflow", nodes: [], connections: {} }, { action: "rebuild_from_recipe" }, { action: "publish_n8n_workflow", active: true }, { action: "propose_plan", steps: [] }])
    assert.equal((await f.runTool({ ...ctx, approved: true }, { action: "propose_plan", steps: [step] })).ok, false, "not allowed inside a plan: " + step.action);
  assert.equal((await f.runTool({ ...ctx, approved: true }, { action: "propose_plan", steps: Array.from({ length: 41 }, (_, i) => ({ action: "add_n8n_node", name: "N" + i })) })).ok, false, "at most 40 steps");
  assert.equal((await f.runTool({ ...ctx, approved: true }, { action: "propose_plan", steps: [] })).ok, false);

  const done = await f.runTool({ ...ctx, approved: true }, plan);
  assert.equal(done.ok, true, done.message);
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai", "A1", "A2", "A3"]); assert.deepEqual(done.changes!.added, ["A1", "A2", "A3"]);
  assert.equal(ctx.snaps.length, 1, "one restore point for the whole plan"); assert.match(ctx.snaps[0].label, /Sebelum rencana \(3 langkah\)/);
  assert.equal((await f.runTool(ctx, { action: "undo_last_change" })).ok, true);
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai"], "and the whole plan is undone together");

  // Every plan was backed up in the vault before it ran, so the work never lives only in n8n.
  const dir = path.join(f.directory, "Arthur", "Workflow Backup"), files = await readdir(dir);
  assert.ok(files.length >= 2, files.join(", "));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, files[0]), "utf8")).nodes.map((n: any) => n.name), ["Mulai"]);
});

test("workflow backups keep only the newest 20", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) await f.saveBackup("Arthur", "sebelum uji " + i, { nodes: [i] });
  const files = (await readdir(path.join(f.directory, "Arthur", "Workflow Backup"))).sort();
  assert.equal(files.length, 20); assert.match(files.at(-1)!, /sebelum-uji-24\.json$/);
});
