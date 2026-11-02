import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

const CHANNEL = "arthur000000001";
const until = async (check: () => boolean | Promise<boolean>, label: string) => { for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail("timed out waiting for " + label); };
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// In-memory database, an n8n with one workflow, and a model whose answers the test controls.
async function fixture(t: TestContext) {
  const { db } = await import("../apps/web/src/server/pocketbase");
  const { defaultChannelPreferences } = await import("../packages/core/src/workspace");
  const vault = await mkdtemp(path.join(os.tmpdir(), "assistant-threads-")); await mkdir(path.join(vault, "Arthur"), { recursive: true });
  const seen: { system: string[]; sizes: number[]; tokens: unknown[] } = { system: [], sizes: [], tokens: [] };
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
  const original = globalThis.fetch, previous = { VAULT_ROOT: process.env.VAULT_ROOT, N8N_URL: process.env.N8N_URL, N8N_API_KEY: process.env.N8N_API_KEY, NINEROUTER_URL: process.env.NINEROUTER_URL };
  process.env.VAULT_ROOT = vault; process.env.N8N_URL = "http://n8n.test"; process.env.N8N_API_KEY = "k"; process.env.NINEROUTER_URL = "http://router.test/v1";
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (url.startsWith("http://n8n.test/api/v1/workflows/wf1")) {
      if ((init.method || "GET") === "PUT") Object.assign(workflow, JSON.parse(init.body));
      return new Response(JSON.stringify(workflow), { status: 200 });
    }
    if (url === "http://router.test/v1/chat/completions") {
      const body = JSON.parse(init.body), messages = body.messages as any[], users = messages.filter(m => m.role === "user");
      // Housekeeping call (summary of an old chat): a plain, non-streaming answer.
      if (body.stream === false) return new Response(JSON.stringify({ choices: [{ message: { content: "<think>x</think>RINGKASAN: pemilik melarang node If dan Wait." } }] }), { status: 200 });
      seen.system.push(String(messages[0].content)); seen.sizes.push(messages.length); seen.tokens.push(body.max_tokens);
      const followUp = String(users.at(-1).content).startsWith("[Sistem] Hasil aksi");
      const who = [...users.map(m => String(m.content)).join("\n").matchAll(/kerjakan (\w)/g)].at(-1)![1];
      // Misbehaving models: only reasoning came back (E once, Z always), or the answer sits in an unclosed <think> (T).
      const done = (reason: string) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
      const plain = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text + "data: [DONE]\n\n")); c.close(); } }), { status: 200 });
      if (!followUp) {
        const nudged = String(users.at(-1).content).includes("Jawabanmu sebelumnya kosong");
        if (who === "Z" || (who === "E" && !nudged)) return plain(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Saya menimbang permintaan ini…" } }] })}\n\n` + done("length"));
        if (who === "E") return plain(sse("Sudah saya kerjakan.") + done("stop"));
        // F: claims a change and writes its own "[Hasil aksi]", but runs nothing. P: tries to replace the whole workflow.
        if (who === "F") return plain(sse("Sudah saya ganti nama file ke notyet.\n\n[Hasil aksi]\n* modify_n8n_node: berhasil — Node \"Jadikan File .md\" diperbarui.") + done("stop"));
        if (who === "P") return plain(sse("Saya ganti seluruh workflow.\n```json\n" + JSON.stringify({ actions: [{ action: "replace_workflow", nodes: [{ name: "Baru", type: "n8n-nodes-base.set" }], connections: {} }] }) + "\n```") + done("stop"));
        if (who === "T") return plain(sse("<think>menimbang… ```json\n" + JSON.stringify({ actions: [{ action: "save_memory", note: "Dari dalam think" }] }) + "\n```") + done("stop"));
      }
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
  t.after(async () => { mock.restoreAll(); globalThis.fetch = original; await rm(vault, { recursive: true, force: true }); for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const api = await import("../apps/web/src/server/assistant");
  return { api, workflow, gate, release: (name: string) => gates[name](), table, vault, seen };
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
  // The last message is the server's own report of what really changed in the workflow.
  assert.deepEqual(done.messages.map((m: any) => m.role), ["user", "assistant", "assistant", "system"]);
  assert.deepEqual(done.messages[3].changes.added, ["Dari A"]);
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

test("standing rules and project memory from the vault reach every turn", async t => {
  const f = await fixture(t), { api } = f;
  await writeFile(path.join(f.vault, "Arthur", "ATURAN-ASSISTANT.md"), "# Aturan tetap assistant\n\n- Jangan pernah menambah node If atau Wait.\n");
  await writeFile(path.join(f.vault, "Arthur", "MEMORI-ASSISTANT.md"), "# Memori assistant\n\n- 2026-11-02: Jadwal Arthur jam 19.00 WIB.\n");
  const c = await api.createThread(CHANNEL);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan A" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  assert.ok(f.seen.system.length >= 2, "the run took two rounds");
  for (const prompt of f.seen.system) {
    assert.match(prompt, /^ATURAN TETAP DARI PEMILIK[\s\S]*Jangan pernah menambah node If atau Wait\./, "rules come first");
    assert.match(prompt, /MEMORI PROJECT[\s\S]*Jadwal Arthur jam 19\.00 WIB\./);
    assert.match(prompt, /UBAH SESEDIKIT MUNGKIN/);
  }
});

test("an answer that is only reasoning is asked for again, never saved as an empty reply", async t => {
  const f = await fixture(t), { api } = f, c = await api.createThread(CHANNEL);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan E" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  const done = await api.getThread(CHANNEL, c.id);
  assert.deepEqual(done.messages.map((m: any) => [m.role, m.content]), [["user", "kerjakan E"], ["assistant", "Sudah saya kerjakan."]]);
  assert.equal(f.seen.system.length, 2, "one retry after the empty answer");
  assert.ok(f.seen.tokens.every(n => n === 16000), "the model is given room to answer");
});

test("a model that never answers ends with a visible reason, and the next message is not confused", async t => {
  const f = await fixture(t), { api } = f, c = await api.createThread(CHANNEL);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan Z" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  const done = await api.getThread(CHANNEL, c.id);
  assert.deepEqual(done.messages.map((m: any) => m.role), ["user", "system"], "no empty assistant message is kept");
  assert.match(done.messages[1].content, /tanpa jawaban \(alasan: length\)/);
  const before = f.seen.sizes.length;
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan A" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the next run");
  assert.ok(f.seen.sizes.length > before);
});

test("an action written inside an unclosed think block still runs", async t => {
  const f = await fixture(t), { api } = f, c = await api.createThread(CHANNEL);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan T" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  const done = await api.getThread(CHANNEL, c.id);
  assert.equal(done.messages.find((m: any) => m.actions?.length)?.actions[0].action, "save_memory");
  assert.match(await readFile(path.join(f.vault, "Arthur", "MEMORI-ASSISTANT.md"), "utf8"), /Dari dalam think/);
});

// Regression from a real chat: the assistant said a file name was changed, and wrote its own "[Hasil aksi] … berhasil".
test("a made-up result is cut off, and a claim with no real change is flagged", async t => {
  const f = await fixture(t), { api } = f, c = await api.createThread(CHANNEL), before = JSON.stringify(f.workflow);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan F" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  const done = await api.getThread(CHANNEL, c.id);
  const reply = done.messages.find((m: any) => m.role === "assistant");
  assert.equal(reply.content, "Sudah saya ganti nama file ke notyet.", "the invented result block is gone");
  assert.doesNotMatch(JSON.stringify(done.messages), /\[Hasil aksi\]/);
  assert.ok(done.messages.some((m: any) => m.role === "system" && /menulis "hasil aksi" sendiri/.test(m.content)), "the owner is told");
  assert.ok(done.messages.some((m: any) => m.role === "system" && /^⚠.*TIDAK berubah/.test(m.content)), "the false claim is flagged against the real workflow");
  assert.equal(JSON.stringify(f.workflow), before, "nothing changed in n8n");
});

// Regression from a real chat: the assistant rebuilt the workflow on its own and wiped the owner's work.
test("a whole-workflow replacement waits for the owner's button, can be undone as one turn, or refused", async t => {
  const f = await fixture(t), { api } = f, c = await api.createThread(CHANNEL);
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan P" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the run to finish");
  let thread = await api.getThread(CHANNEL, c.id) as any;
  assert.equal(thread.pending.length, 1); assert.match(thread.pending[0].reason, /Mengganti seluruh isi workflow dengan 1 node/);
  assert.equal(thread.messages.find((m: any) => m.actions?.length).actions[0].pending, true);
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai"], "nothing ran yet");
  assert.ok(!thread.messages.some((m: any) => m.changes), "no change to report");

  thread = await api.approvePending(CHANNEL, c.id, thread.pending[0].id) as any;
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Baru"], "approved: it ran, exactly as stored");
  assert.equal(thread.pending.length, 0);
  const report = thread.messages.at(-1);
  assert.deepEqual([report.changes.added, report.changes.removed], [["Baru"], ["Mulai"]]);
  assert.equal(report.canUndo, true); assert.equal(report.restore, undefined, "restore data is never sent to the page");

  thread = await api.undoTurn(CHANNEL, c.id, report.id) as any;
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai"], "one click puts the whole turn back");
  assert.ok(!thread.messages.some((m: any) => m.canUndo));
  await assert.rejects(api.undoTurn(CHANNEL, c.id, report.id), /Hanya giliran terakhir/);

  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan P lagi" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the second run");
  thread = await api.getThread(CHANNEL, c.id) as any;
  assert.equal(thread.pending.length, 1);
  thread = await api.rejectPending(CHANNEL, c.id, thread.pending[0].id) as any;
  assert.equal(thread.pending.length, 0); assert.match(thread.messages.at(-1).content, /^Ditolak pemilik/);
  assert.deepEqual(f.workflow.nodes.map((n: any) => n.name), ["Mulai"], "refused: nothing ran");
});

test("a long chat is folded into a summary and the assistant keeps its thread", async t => {
  const f = await fixture(t), { api } = f;
  const c = await api.createThread(CHANNEL);
  const row = [...f.table("workspace_records").values()].find(r => r.data?.id === c.id)!;
  for (let i = 0; i < 30; i++) row.data.messages.push({ id: "m" + i, role: i % 2 ? "assistant" : "user", content: i % 2 ? `jawaban ${i}` : `pesan ${i}`, created_at: new Date().toISOString() });
  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan A" });
  await until(async () => !!((await api.getThread(CHANNEL, c.id)) as any).summary, "the summary");
  const folded = await api.getThread(CHANNEL, c.id) as any;
  assert.match(folded.summary, /^RINGKASAN: pemilik melarang node If dan Wait\.$/, "reasoning tags are stripped");
  assert.ok(folded.summarized >= 12);
  assert.equal(folded.messages.length, 34, "the chat itself still shows every message (30 old + owner + 2 replies + change report)");

  await api.sendMessage(CHANNEL, c.id, { content: "kerjakan B" });
  await until(async () => (await api.getThread(CHANNEL, c.id)).status === "idle", "the second run");
  assert.match(f.seen.system.at(-1)!, /RINGKASAN CHAT INI SEBELUMNYA[\s\S]*RINGKASAN: pemilik melarang node If dan Wait\./);
  assert.ok(f.seen.sizes.at(-1)! < f.seen.sizes[0], `the model got fewer messages (${f.seen.sizes.at(-1)}) than before the fold (${f.seen.sizes[0]})`);
});
