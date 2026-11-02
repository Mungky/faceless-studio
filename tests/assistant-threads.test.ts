import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

const CHANNEL = "arthur000000001";
const until = async (check: () => boolean | Promise<boolean>, label: string) => { for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail("timed out waiting for " + label); };
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// In-memory database, an n8n with one workflow, and a model whose answers the test controls.
async function fixture(t: TestContext) {
  const { db } = await import("../apps/web/src/server/pocketbase");
  const { defaultChannelPreferences } = await import("../packages/core/src/workspace");
  const tables = new Map<string, Map<string, any>>(); let sequence = 0;
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name)!; };
  table("channels").set(CHANNEL, { id: CHANNEL, name: "Arthur" });
  const prefs = { ...defaultChannelPreferences(CHANNEL), n8n_workflow_id: "wf1" };
  table("workspace_records").set("p", { id: "p", key: "preferences:" + CHANNEL, kind: "preferences", channel: CHANNEL, data: prefs });
  mock.method(db, "get", async (name: string, id: string) => { const row = table(name).get(id); if (!row) throw Object.assign(new Error("Not found"), { status: 404 }); return structuredClone(row); });
  mock.method(db, "list", async (name: string, filter = "") => {
    let rows = [...table(name).values()];
    for (const field of ["key", "channel", "kind"]) { const m = new RegExp(`(?:^|\\s)${field}="([^"]*)"`).exec(filter); if (m) rows = rows.filter(r => r[field] === m[1]); }
    return structuredClone(rows);
  });
  mock.method(db, "delete", async (name: string, id: string) => { table(name).delete(id); });
  mock.method(db, "custom", async (route: string, body: any) => {
    assert.equal(route, "workspace-save");
    const rows = table("workspace_records"), old = [...rows.values()].find(r => r.key === body.key);
    const row = { ...(old || { id: "r" + ++sequence }), key: body.key, kind: body.kind, channel: body.channel, data: structuredClone(body.data) };
    rows.set(row.id, row); return structuredClone(row);
  });

  const workflow = { id: "wf1", name: "Arthur", active: false, settings: { executionOrder: "v1" }, connections: {}, nodes: [{ id: "a", name: "Mulai", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: {} }] } as any;
  const gates: Record<string, () => void> = {}, waiting: Record<string, Promise<void>> = {};
  const gate = (name: string) => { waiting[name] = new Promise<void>(r => { gates[name] = r; }); };
  const original = globalThis.fetch, previous = { N8N_URL: process.env.N8N_URL, N8N_API_KEY: process.env.N8N_API_KEY, NINEROUTER_URL: process.env.NINEROUTER_URL };
  process.env.N8N_URL = "http://n8n.test"; process.env.N8N_API_KEY = "k"; process.env.NINEROUTER_URL = "http://router.test/v1";
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (url.startsWith("http://n8n.test/api/v1/workflows/wf1")) {
      if ((init.method || "GET") === "PUT") Object.assign(workflow, JSON.parse(init.body));
      return new Response(JSON.stringify(workflow), { status: 200 });
    }
    if (url === "http://router.test/v1/chat/completions") {
      const messages = JSON.parse(init.body).messages as any[], users = messages.filter(m => m.role === "user");
      const first = String(users[0].content), followUp = String(users.at(-1).content).startsWith("[Sistem]");
      const who = /kerjakan (\w)/.exec(first)![1];
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ async start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        if (followUp) { controller.enqueue(encoder.encode(sse(`Selesai ${who}.`) + "data: [DONE]\n\n")); controller.close(); return; }
        controller.enqueue(encoder.encode(sse(`Mengubah node untuk ${who}. `)));
        if (waiting[who]) await waiting[who];
        if (who === "S") return; // the stop test never finishes on its own
        controller.enqueue(encoder.encode(sse("```json\n" + JSON.stringify({ actions: [{ action: "add_n8n_node", name: "Dari " + who, node_type: "n8n-nodes-base.set" }] }) + "\n```") + "data: [DONE]\n\n"));
        controller.close();
      } }), { status: 200 });
    }
    return original(input, init);
  }) as typeof fetch;
  t.after(() => { mock.restoreAll(); globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const api = await import("../apps/web/src/server/assistant");
  return { api, workflow, gate, release: (name: string) => gates[name](), table };
}

test("chats run on the server, in parallel, and survive a refresh", async t => {
  const f = await fixture(t), { api } = f;
  const a = await api.createThread(CHANNEL), b = await api.createThread(CHANNEL);
  f.gate("A"); f.gate("B");
  await api.sendMessage(CHANNEL, a.id, { content: "kerjakan A" });
  await api.sendMessage(CHANNEL, b.id, { content: "kerjakan B" });

  // "Refresh": a brand-new read of the server state sees both chats working, with progress so far.
  await until(async () => (await api.getThread(CHANNEL, a.id)).messages.some((m: any) => m.id === "live"), "live reply");
  const rows = await api.listThreads(CHANNEL);
  assert.deepEqual(rows.map((r: any) => r.status), ["running", "running"]);
  const mid = await api.getThread(CHANNEL, a.id);
  assert.equal(mid.status, "running");
  assert.match(mid.messages.at(-1)!.content, /Mengubah node untuk A/);
  await assert.rejects(api.sendMessage(CHANNEL, a.id, { content: "lagi" }), /masih bekerja/);

  f.release("A"); f.release("B");
  await until(async () => (await api.listThreads(CHANNEL)).every((r: any) => r.status === "idle"), "both chats to finish");

  const done = await api.getThread(CHANNEL, a.id);
  assert.deepEqual(done.messages.map((m: any) => m.role), ["user", "assistant", "assistant"]);
  assert.equal(done.messages[1].actions?.[0].ok, true);
  assert.doesNotMatch(done.messages[1].content, /```/, "the action block is not shown as text");
  assert.equal(done.messages[2].content, "Selesai A.");
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name).sort(), ["Dari A", "Dari B", "Mulai"], "both chats changed the same workflow without clobbering each other");
  assert.equal(done.title, "kerjakan A");
  assert.equal(done.undo, 1);
});

test("stop ends a run, keeps what was written, and frees the chat", async t => {
  const f = await fixture(t), { api } = f;
  const s = await api.createThread(CHANNEL);
  f.gate("S");
  await api.sendMessage(CHANNEL, s.id, { content: "kerjakan S" });
  await until(async () => (await api.getThread(CHANNEL, s.id)).messages.some((m: any) => m.id === "live"), "live reply");
  await api.stopThread(CHANNEL, s.id);
  await until(async () => (await api.getThread(CHANNEL, s.id)).status === "idle", "chat to stop");
  const stopped = await api.getThread(CHANNEL, s.id);
  assert.match(stopped.messages.at(-1)!.content, /Mengubah node untuk S[\s\S]*dihentikan/);
  await api.sendMessage(CHANNEL, s.id, { content: "kerjakan A" }); // the chat accepts new work again
  await api.stopThread(CHANNEL, s.id);
});

test("a chat left running by a restart is shown as stopped, not stuck", async t => {
  const f = await fixture(t), { api } = f;
  const c = await api.createThread(CHANNEL);
  const row = [...f.table("workspace_records").values()].find(r => r.data?.id === c.id)!;
  row.data.status = "running"; // saved as running, but no run is alive in this process
  const shown = await api.getThread(CHANNEL, c.id);
  assert.equal(shown.status, "idle");
  assert.match(shown.notice || "", /terputus/);
  assert.equal((await api.listThreads(CHANNEL))[0].status, "idle");
  await api.deleteThread(CHANNEL, c.id);
  assert.deepEqual(await api.listThreads(CHANNEL), []);
});
