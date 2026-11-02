import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "server-only" ? { url: new URL("./server-only-fixture.cjs", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context); } });

// A tiny stand-in for n8n's public API: one workflow kept in memory.
function fakeN8n() {
  const state = { puts: 0, workflow: { id: "wf1", name: "Arthur", active: false, settings: { executionOrder: "v1" }, nodes: [
    { id: "a", name: "Mulai", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { path: "x" } },
    { id: "b", name: "Naskah", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.5, position: [260, 0], parameters: { text: "lama" } }],
    connections: { Mulai: { main: [[{ node: "Naskah", type: "main", index: 0 }]] } } } as any };
  const original = globalThis.fetch;
  process.env.N8N_URL = "http://n8n.test"; process.env.N8N_API_KEY = "test-key";
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input), method = init.method || "GET";
    if (!url.startsWith("http://n8n.test/api/v1/workflows/wf1")) return new Response("{}", { status: 404 });
    if (method === "PUT") { state.puts++; const body = JSON.parse(init.body); state.workflow = { ...state.workflow, ...body }; }
    return new Response(JSON.stringify(state.workflow), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { state, restore: () => { globalThis.fetch = original; } };
}
const tools = async () => import("../apps/web/src/server/assistant-tools");

test("assistant edits the workflow directly, keeps connections consistent and can undo", async () => {
  const n8n = fakeN8n();
  try {
    const { runTool } = await tools(), ctx = { channel: "chan", workflowId: "wf1", snaps: [] as any[] };
    const added = await runTool(ctx, { action: "add_n8n_node", name: "Cek fakta", node_type: "n8n-nodes-base.httpRequest", connect_from: "Naskah" });
    assert.equal(added.ok, true, added.message);
    assert.equal(n8n.state.workflow.nodes.length, 3);
    assert.deepEqual(n8n.state.workflow.connections.Naskah.main[0], [{ node: "Cek fakta", type: "main", index: 0 }]);

    assert.equal((await runTool(ctx, { action: "modify_n8n_node", node_name: "naskah", prompt: "baru", new_name: "Naskah final" })).ok, true);
    const script = n8n.state.workflow.nodes.find((n: any) => n.name === "Naskah final");
    assert.equal(script.parameters.text, "baru");
    assert.equal(n8n.state.workflow.connections.Mulai.main[0][0].node, "Naskah final", "incoming link follows the rename");
    assert.ok(n8n.state.workflow.connections["Naskah final"], "outgoing links follow the rename");

    assert.equal((await runTool(ctx, { action: "remove_n8n_node", node_name: "Cek fakta" })).ok, true);
    assert.equal(n8n.state.workflow.connections["Naskah final"].main[0].length, 0, "links to a removed node are dropped");

    assert.equal(ctx.snaps.length, 3, "every change is backed up first");
    assert.equal((await runTool(ctx, { action: "undo_last_change" })).ok, true);
    assert.ok(n8n.state.workflow.nodes.some((n: any) => n.name === "Cek fakta"), "undo brings the removed node back");
  } finally { n8n.restore(); }
});

test("assistant refuses a change that would leave n8n with a broken graph", async () => {
  const n8n = fakeN8n();
  try {
    const { runTool } = await tools(), ctx = { channel: "chan", workflowId: "wf1", snaps: [] as any[], approved: true };
    const before = JSON.stringify(n8n.state.workflow);
    const bad = await runTool(ctx, { action: "replace_workflow", nodes: [{ name: "A", type: "t" }, { name: "A", type: "t" }], connections: {} });
    assert.equal(bad.ok, false); assert.match(bad.message, /dua kali/);
    const dangling = await runTool(ctx, { action: "replace_workflow", nodes: [{ name: "A", type: "t" }], connections: { A: { main: [[{ node: "Hilang", type: "main", index: 0 }]] } } });
    assert.equal(dangling.ok, false); assert.match(dangling.message, /tidak ada/);
    assert.equal((await runTool(ctx, { action: "connect_nodes", from: "Mulai", to: "Tidak ada" })).ok, false);
    assert.equal(n8n.state.puts, 0, "nothing was sent to n8n");
    assert.equal(JSON.stringify(n8n.state.workflow), before);
    assert.equal(ctx.snaps.length, 0);
    assert.equal((await runTool(ctx, { action: "hapus_semua" })).ok, false);
    assert.equal((await runTool({ ...ctx, workflowId: "" }, { action: "add_n8n_node", name: "X" })).ok, false, "no linked workflow is reported, not crashed");
  } finally { n8n.restore(); }
});

test("simultaneous chats editing one workflow do not overwrite each other", async () => {
  const n8n = fakeN8n();
  try {
    const { runTool } = await tools(), one = { channel: "chan", workflowId: "wf1", snaps: [] as any[] }, two = { channel: "chan", workflowId: "wf1", snaps: [] as any[] };
    await Promise.all([runTool(one, { action: "add_n8n_node", name: "Dari chat 1" }), runTool(two, { action: "add_n8n_node", name: "Dari chat 2" })]);
    const names = n8n.state.workflow.nodes.map((n: any) => n.name);
    assert.ok(names.includes("Dari chat 1") && names.includes("Dari chat 2"), names.join(", "));
  } finally { n8n.restore(); }
});

// Regression from a real chat: asked to change only a file name, the assistant clobbered its sibling options.
test("a partial edit changes only what it names and keeps the rest of the node", async () => {
  const n8n = fakeN8n();
  try {
    const { runTool } = await tools(), ctx = { channel: "chan", workflowId: "wf1", snaps: [] as any[] };
    n8n.state.workflow.nodes.push({ id: "c", name: "Jadikan File", type: "n8n-nodes-base.convertToFile", typeVersion: 1.1, position: [0, 0], parameters: { operation: "toText", options: { fileName: "arthur.md", encoding: "utf8" } } });
    assert.equal((await runTool(ctx, { action: "modify_n8n_node", node_name: "Jadikan File", parameters: { options: { fileName: "notyet.md" } } })).ok, true);
    assert.deepEqual(n8n.state.workflow.nodes.find((n: any) => n.name === "Jadikan File").parameters, { operation: "toText", options: { fileName: "notyet.md", encoding: "utf8" } }, "deep merge keeps siblings");
    assert.equal((await runTool(ctx, { action: "set_node_param", node_name: "Jadikan File", path: "options.fileName", value: "final.md" })).ok, true);
    assert.deepEqual(n8n.state.workflow.nodes.find((n: any) => n.name === "Jadikan File").parameters.options, { fileName: "final.md", encoding: "utf8" });
    assert.equal((await runTool(ctx, { action: "set_node_param", node_name: "Jadikan File", path: "", value: "x" })).ok, false);
    assert.equal(n8n.state.workflow.nodes.find((n: any) => n.name === "Naskah").parameters.text, "lama", "other nodes are untouched");
  } finally { n8n.restore(); }
});

test("destructive actions never run on the model's say-so, and the real difference is measurable", async () => {
  const n8n = fakeN8n();
  try {
    const { runTool, diffWorkflow, hasChanges } = await tools(), ctx = { channel: "chan", workflowId: "wf1", snaps: [] as any[] };
    const before = JSON.parse(JSON.stringify(n8n.state.workflow));
    for (const action of [{ action: "rebuild_from_recipe" }, { action: "replace_workflow", nodes: [{ name: "A", type: "t" }], connections: {} }, { action: "publish_n8n_workflow", active: true }]) {
      const held = await runTool(ctx, action);
      assert.equal(held.ok, false, action.action); assert.ok(held.approval, action.action + " waits for the owner"); assert.match(held.message, /BELUM DIJALANKAN/);
    }
    assert.equal(n8n.state.puts, 0, "nothing reached n8n");
    assert.equal(hasChanges(diffWorkflow(before, n8n.state.workflow)), false, "no change is reported when none happened");
    assert.equal((await runTool(ctx, { action: "publish_n8n_workflow", active: false })).approval, undefined, "turning a workflow off needs no permission");
    await runTool(ctx, { action: "set_node_param", node_name: "Naskah", path: "text", value: "baru" });
    const diff = diffWorkflow(before, n8n.state.workflow);
    assert.deepEqual(diff.changed, [{ node: "Naskah", fields: ["text"] }]); assert.deepEqual([diff.added, diff.removed], [[], []]);
  } finally { n8n.restore(); }
});
