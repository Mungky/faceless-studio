// Studio n8n MCP Server: provides scoped tools to DeepSeek Harness for the active project.
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline";

const envFile = path.resolve(process.cwd(), ".env");
const env = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "")
    .split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const n8nUrl = (process.env.N8N_URL || env.N8N_URL || "").replace(/\/+$/, "");
const n8nKey = process.env.N8N_API_KEY || env.N8N_API_KEY || "";

function getActiveProject(explicitWorkflowId) {
  const activeFile = path.resolve(process.cwd(), ".runtime", "active-project.json");
  let active = { name: "Project", n8nWorkflowId: "" };
  if (existsSync(activeFile)) {
    try {
      active = JSON.parse(readFileSync(activeFile, "utf8"));
    } catch {}
  }
  const wfId = explicitWorkflowId || active.n8nWorkflowId;
  if (!wfId) {
    throw new Error(
      `Project "${active.name || "aktif"}" belum memiliki workflow n8n. Buka project di Studio dan bangun workflow-nya terlebih dahulu.`
    );
  }
  return { ...active, workflowId: wfId };
}

async function n8n(endpoint, init = {}) {
  const res = await fetch(n8nUrl + "/api/v1" + endpoint, {
    ...init,
    headers: {
      "X-N8N-API-KEY": n8nKey,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`n8n error ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

const tools = [
  {
    name: "n8n_get_workflow",
    description: "Ambil informasi lengkap workflow n8n milik project yang sedang aktif (daftar node, koneksi, status aktif).",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik, default ke project aktif" }
      },
      additionalProperties: false
    }
  },
  {
    name: "n8n_add_node",
    description: "Sisipkan node baru secara aman ke alur n8n project aktif tanpa merusak node lain.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama node baru" },
        type: { type: "string", description: "Tipe node n8n (misal: n8n-nodes-base.httpRequest, n8n-nodes-base.youTube)" },
        typeVersion: { type: "number", description: "Versi tipe node (default 1)" },
        parameters: { type: "object", description: "Parameter node" },
        connect_from: { type: "string", description: "Nama node sumber" },
        connect_to: { type: "string", description: "Nama node tujuan" },
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik" }
      },
      required: ["name", "type"]
    }
  },
  {
    name: "n8n_modify_node",
    description: "Ubah prompt atau parameter pada node n8n yang sudah ada di workflow project aktif.",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Nama node yang ingin diubah" },
        prompt: { type: "string", description: "Teks prompt baru (jika node AI/prompt)" },
        parameters: { type: "object", description: "Parameter yang ingin di-update" },
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik" }
      },
      required: ["node_name"]
    }
  },
  {
    name: "n8n_remove_node",
    description: "Hapus satu node dari workflow n8n project aktif.",
    inputSchema: {
      type: "object",
      properties: {
        node_name: { type: "string", description: "Nama node yang ingin dihapus" },
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik" }
      },
      required: ["node_name"]
    }
  },
  {
    name: "n8n_publish_workflow",
    description: "Aktifkan (publish) atau nonaktifkan workflow n8n project aktif.",
    inputSchema: {
      type: "object",
      properties: {
        active: { type: "boolean", description: "true untuk mengaktifkan, false untuk menonaktifkan" },
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik" }
      },
      required: ["active"]
    }
  },
  {
    name: "n8n_execute_workflow",
    description: "Jalankan uji coba (test run/execute) workflow n8n project aktif dengan brief tertentu.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "Ide/topik yang ingin diuji coba" },
        title: { type: "string", description: "Judul uji coba" },
        workflow_id: { type: "string", description: "Opsional: Workflow ID jika ingin spesifik" }
      }
    }
  }
];

async function handleToolCall(name, args) {
  const { workflowId, name: projectName } = getActiveProject(args.workflow_id);

  if (name === "n8n_get_workflow") {
    const wf = await n8n(`/workflows/${workflowId}`);
    const summary = {
      project: projectName,
      workflow_id: wf.id,
      name: wf.name,
      active: wf.active,
      total_nodes: wf.nodes.length,
      nodes: wf.nodes.map(n => ({
        name: n.name,
        type: n.type,
        parameters: n.parameters
      })),
      connections: wf.connections
    };
    return JSON.stringify(summary, null, 2);
  }

  if (name === "n8n_add_node") {
    const wf = await n8n(`/workflows/${workflowId}`);
    if (wf.nodes.some(n => n.name === args.name)) {
      throw new Error(`Node "${args.name}" sudah ada.`);
    }
    const fromNode = wf.nodes.find(n => n.name === args.connect_from);
    const toNode = wf.nodes.find(n => n.name === args.connect_to);
    let position = [0, 0];
    if (fromNode && toNode) position = [Math.round((fromNode.position[0] + toNode.position[0]) / 2), fromNode.position[1] - 70];
    else if (fromNode) position = [fromNode.position[0] + 260, fromNode.position[1]];

    const newNode = {
      id: randomUUID(),
      name: args.name,
      type: args.type,
      typeVersion: args.typeVersion || 1,
      position,
      parameters: args.parameters || {}
    };
    wf.nodes.push(newNode);

    const conn = wf.connections;
    if (args.connect_from) {
      const fromOutputs = (conn[args.connect_from] ??= {})["main"] ??= [[]];
      if (fromOutputs.length === 0) fromOutputs.push([]);
      if (args.connect_to) {
        let found = false;
        for (const outList of fromOutputs) {
          const idx = outList.findIndex(c => c.node === args.connect_to);
          if (idx !== -1) { outList[idx] = { node: newNode.name, type: "main", index: 0 }; found = true; break; }
        }
        if (!found) fromOutputs[0].push({ node: newNode.name, type: "main", index: 0 });
      } else {
        fromOutputs[0].push({ node: newNode.name, type: "main", index: 0 });
      }
    }
    if (args.connect_to) {
      const newOutputs = (conn[newNode.name] ??= {})["main"] ??= [[]];
      newOutputs[0] = [{ node: args.connect_to, type: "main", index: 0 }];
    }

    const updated = await n8n(`/workflows/${workflowId}`, {
      method: "PUT",
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || { executionOrder: "v1" } })
    });
    return `Node "${newNode.name}" (${newNode.type}) berhasil ditambahkan ke workflow project "${projectName}". Total sekarang: ${updated.nodes.length} node.`;
  }

  if (name === "n8n_modify_node") {
    const wf = await n8n(`/workflows/${workflowId}`);
    const node = wf.nodes.find(n => n.name === args.node_name);
    if (!node) throw new Error(`Node "${args.node_name}" tidak ditemukan di workflow "${projectName}".`);
    if (args.parameters) node.parameters = { ...node.parameters, ...args.parameters };
    if (args.prompt) node.parameters.text = args.prompt;

    await n8n(`/workflows/${workflowId}`, {
      method: "PUT",
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || { executionOrder: "v1" } })
    });
    return `Node "${args.node_name}" pada project "${projectName}" berhasil diperbarui.`;
  }

  if (name === "n8n_remove_node") {
    const wf = await n8n(`/workflows/${workflowId}`);
    wf.nodes = wf.nodes.filter(n => n.name !== args.node_name);
    delete wf.connections[args.node_name];
    for (const from of Object.keys(wf.connections)) {
      const outs = wf.connections[from];
      for (const t of Object.keys(outs)) {
        outs[t] = outs[t].map(group => group.filter(c => c.node !== args.node_name));
      }
    }
    await n8n(`/workflows/${workflowId}`, {
      method: "PUT",
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || { executionOrder: "v1" } })
    });
    return `Node "${args.node_name}" berhasil dihapus dari workflow project "${projectName}".`;
  }

  if (name === "n8n_publish_workflow") {
    const action = args.active ? "activate" : "deactivate";
    const res = await n8n(`/workflows/${workflowId}/${action}`, { method: "POST" });
    return `Workflow project "${projectName}" berhasil ${res.active ? "diaktifkan (published)" : "dinonaktifkan"}.`;
  }

  if (name === "n8n_execute_workflow") {
    const wf = await n8n(`/workflows/${workflowId}`);
    const hook = wf.nodes.find(n => n.type === "n8n-nodes-base.webhook");
    if (!hook) throw new Error(`Workflow "${projectName}" belum memiliki webhook.`);
    if (!wf.active) await n8n(`/workflows/${workflowId}/activate`, { method: "POST" });

    const path = hook.parameters.path;
    const res = await fetch(`${n8nUrl}/webhook/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: args.brief || "", title: args.title || "Manual Run", task: "mcp-run-" + randomUUID().slice(0, 8) })
    });
    const d = await res.json().catch(() => ({}));
    return `Uji coba alur n8n "${projectName}" berhasil dipicu! Status HTTP: ${res.status}. Execution ID: #${d.execution_id || "running"}`;
  }

  throw new Error(`Tool tidak dikenal: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", async line => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;

    if (method === "initialize") {
      const resp = {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "studio-n8n", version: "1.0.0" }
        }
      };
      process.stdout.write(JSON.stringify(resp) + "\n");
      return;
    }

    if (method === "notifications/initialized") return;

    if (method === "tools/list") {
      const resp = { jsonrpc: "2.0", id, result: { tools } };
      process.stdout.write(JSON.stringify(resp) + "\n");
      return;
    }

    if (method === "tools/call") {
      try {
        const text = await handleToolCall(params.name, params.arguments || {});
        const resp = {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }] }
        };
        process.stdout.write(JSON.stringify(resp) + "\n");
      } catch (err) {
        const resp = {
          jsonrpc: "2.0",
          id,
          result: { isError: true, content: [{ type: "text", text: "Error: " + err.message }] }
        };
        process.stdout.write(JSON.stringify(resp) + "\n");
      }
      return;
    }

    if (id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }) + "\n");
    }
  } catch (e) {
    // ignore parse errors
  }
});
