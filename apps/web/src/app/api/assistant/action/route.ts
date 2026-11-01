import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../../../server/auth";
import { channelPreferences } from "../../../../server/workspace";
import {
  getN8nWorkflow,
  updateN8nWorkflow,
  activateN8nWorkflow,
  deactivateN8nWorkflow,
  triggerN8nWorkflow
} from "../../../../server/n8n";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { channelId, action } = await request.json();
    if (!channelId || !action || !action.action) {
      return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
    }

    const prefs = await channelPreferences(channelId).catch(() => ({ n8n_workflow_id: "" }));
    const workflowId = prefs.n8n_workflow_id;
    if (!workflowId) {
      return NextResponse.json({ error: "Belum ada workflow n8n yang terhubung ke project ini." }, { status: 400 });
    }

    const actionType = action.action || action.type;

    if (actionType === "add_n8n_node") {
      const current = await getN8nWorkflow(workflowId);
      const name = action.name || action.node?.name;
      const type = action.type || action.node?.type || "n8n-nodes-base.httpRequest";
      const parameters = action.parameters || action.node?.parameters || {};
      const typeVersion = action.typeVersion || action.node?.typeVersion || 1;
      const connectFrom = action.connect_from;
      const connectTo = action.connect_to;

      if (!name) return NextResponse.json({ error: "Nama node wajib diisi" }, { status: 400 });
      if (current.nodes.some(n => n.name.toLowerCase() === name.toLowerCase())) {
        return NextResponse.json({ error: `Node dengan nama "${name}" sudah ada.` }, { status: 400 });
      }

      const fromNode = connectFrom ? current.nodes.find(n => n.name.toLowerCase() === connectFrom.toLowerCase()) : null;
      const posX = fromNode ? fromNode.position[0] + 300 : (current.nodes.length ? current.nodes[current.nodes.length - 1].position[0] + 250 : 250);
      const posY = fromNode ? fromNode.position[1] : 300;

      const newNode = {
        parameters,
        id: `node-${Math.random().toString(36).slice(2, 9)}`,
        name,
        type,
        typeVersion,
        position: [posX, posY] as [number, number]
      };

      current.nodes.push(newNode as any);

      const conn = current.connections as Record<string, any>;
      if (connectFrom) {
        if (!conn[connectFrom]) conn[connectFrom] = { main: [[]] };
        if (!conn[connectFrom].main) conn[connectFrom].main = [[]];
        if (!conn[connectFrom].main[0]) conn[connectFrom].main[0] = [];
        conn[connectFrom].main[0].push({ node: name, type: "main", index: 0 });
      }

      if (connectTo) {
        if (!conn[name]) conn[name] = { main: [[]] };
        if (!conn[name].main) conn[name].main = [[]];
        if (!conn[name].main[0]) conn[name].main[0] = [];
        conn[name].main[0].push({ node: connectTo, type: "main", index: 0 });
      }

      await updateN8nWorkflow(workflowId, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
        settings: current.settings || { executionOrder: "v1" }
      });

      return NextResponse.json({ ok: true, message: `Node "${name}" berhasil ditambahkan ke workflow n8n.` });
    }

    if (actionType === "modify_n8n_node") {
      const current = await getN8nWorkflow(workflowId);
      const nodeName = action.node_name || action.name;
      const node = current.nodes.find(n => n.name.toLowerCase() === (nodeName || "").toLowerCase());
      if (!node) {
        return NextResponse.json({ error: `Node "${nodeName}" tidak ditemukan di workflow n8n.` }, { status: 404 });
      }

      if (action.parameters) {
        node.parameters = { ...node.parameters, ...action.parameters };
      }
      if (action.prompt) {
        if (node.parameters.text !== undefined || node.type?.includes("agent") || node.type?.includes("openAi") || node.type?.includes("chain")) {
          node.parameters.text = action.prompt;
        } else if (node.parameters.prompt !== undefined) {
          node.parameters.prompt = action.prompt;
        } else {
          node.parameters.text = action.prompt;
        }
      }

      await updateN8nWorkflow(workflowId, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
        settings: current.settings || { executionOrder: "v1" }
      });

      return NextResponse.json({ ok: true, message: `Node "${node.name}" berhasil diperbarui di n8n.` });
    }

    if (actionType === "remove_n8n_node") {
      const current = await getN8nWorkflow(workflowId);
      const nodeName = action.node_name || action.name;
      current.nodes = current.nodes.filter(n => n.name !== nodeName);
      delete (current.connections as Record<string, any>)[nodeName];
      for (const from of Object.keys(current.connections)) {
        const outs = (current.connections as Record<string, any>)[from];
        for (const type of Object.keys(outs)) {
          outs[type] = outs[type].map((group: any[]) => group.filter((c: any) => c.node !== nodeName));
        }
      }

      await updateN8nWorkflow(workflowId, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
        settings: current.settings || { executionOrder: "v1" }
      });

      return NextResponse.json({ ok: true, message: `Node "${nodeName}" berhasil dihapus dari n8n.` });
    }

    if (actionType === "publish_n8n_workflow") {
      if (action.active) {
        await activateN8nWorkflow(workflowId);
        return NextResponse.json({ ok: true, message: "Workflow n8n berhasil diaktifkan (published)." });
      } else {
        await deactivateN8nWorkflow(workflowId);
        return NextResponse.json({ ok: true, message: "Workflow n8n berhasil dinonaktifkan." });
      }
    }

    if (actionType === "execute_n8n_workflow") {
      const trigger = await triggerN8nWorkflow(workflowId, {
        brief: action.brief || action.title || "Uji coba dari Asisten",
        title: action.title || "Test Run Studio"
      });
      return NextResponse.json({ ok: true, message: `Uji coba workflow n8n berhasil dijalankan (Status: ${trigger.status}).` });
    }

    return NextResponse.json({ error: `Aksi "${actionType}" tidak didukung.` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
