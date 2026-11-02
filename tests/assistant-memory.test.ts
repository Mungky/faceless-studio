import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
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
  const tools = await import("../apps/web/src/server/assistant-tools"), notes = await import("../apps/web/src/server/assistant-memory");
  return { ...tools, ...notes, workflow, directory, ctx: (extra: object = {}) => ({ channel: "chan", workflowId: "wf1", snaps: [] as any[], folder: "Arthur", ...extra }) };
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
