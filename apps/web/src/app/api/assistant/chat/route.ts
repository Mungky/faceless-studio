import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { authenticate } from "../../../../server/auth";
import { db } from "../../../../server/pocketbase";
import { channelPreferences } from "../../../../server/workspace";
import { getN8nWorkflow } from "../../../../server/n8n";
import { routerAuth } from "../../../../server/provider-credentials";
import { extractUrls, fetchUrlContext } from "../../../../server/url-context";
import type { Channel } from "@studio/core";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await request.json();
    const { channelId, messages = [], model: reqModel } = body;
    if (!channelId || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request payload" }), { status: 400 });
    }

    const channel = await db.get<Channel>("channels", channelId).catch(() => null);
    if (!channel) {
      return new Response(JSON.stringify({ error: "Project channel not found" }), { status: 404 });
    }

    const prefs = await channelPreferences(channelId).catch(() => ({ project_name: "", n8n_workflow_id: "" }));
    const projectName = (prefs.project_name || channel.name).trim();

    // Context from n8n
    let n8nSummary = "Workflow n8n belum terhubung ke project ini.";
    if (prefs.n8n_workflow_id) {
      try {
        const wf = await getN8nWorkflow(prefs.n8n_workflow_id);
        const nodeNames = wf.nodes.map(n => `- "${n.name}" (${n.type})`).join("\n");
        n8nSummary = `Workflow n8n aktif (ID: ${wf.id}, ${wf.nodes.length} nodes, status: ${wf.active ? "Aktif" : "Non-aktif"}):
Node terpasang:
${nodeNames}`;
      } catch (e) {
        n8nSummary = `(Gagal mengambil data n8n: ${(e as Error).message})`;
      }
    }

    // Process latest message for links & attachments
    const history = [...messages];
    const lastUserMsg = history[history.length - 1];
    let extraContext = "";

    if (lastUserMsg && lastUserMsg.role === "user") {
      // 1. Inspect URLs in message
      const urls = extractUrls(lastUserMsg.content || "");
      if (urls.length > 0) {
        const urlData = await Promise.all(urls.slice(0, 3).map(fetchUrlContext));
        const validData = urlData.filter(Boolean);
        if (validData.length > 0) {
          extraContext += "\n\n--- [Informasi Link yang Diberikan Pengguna] ---\n" +
            validData.map(d => `Link: ${d!.url}\nJudul: ${d!.title}\nKeterangan: ${d!.description || ""}\nKonten: ${d!.content || ""}`).join("\n\n") +
            "\n--- [Akhir Informasi Link] ---\n";
        }
      }

      // 2. Inspect document attachments
      if (Array.isArray(lastUserMsg.attachments)) {
        for (const att of lastUserMsg.attachments) {
          if (att.text) {
            extraContext += `\n\n--- [Lampiran Dokumen: ${att.name}] ---\n${att.text.slice(0, 8000)}\n--- [Akhir Dokumen] ---\n`;
          }
        }
      }
    }

    const projectDir = path.resolve(process.cwd(), "projects", projectName);
    let projectCustomInstructions = "";
    for (const f of ["system.md", "SYSTEM.md", "AGENTS.md"]) {
      const p = path.join(projectDir, f);
      if (existsSync(p)) {
        try {
          projectCustomInstructions = readFileSync(p, "utf8");
          break;
        } catch {}
      }
    }

    const systemPrompt = `Kamu adalah AI Assistant & Workflow Architect resmi untuk project "${projectName}" di Restard Studio.
Channel ID: ${channelId}
Connected n8n Workflow ID: ${prefs.n8n_workflow_id || "Belum ada"}

IDENTITAS & BATASAN KERJA:
1. Kamu fokus membantu pembuatan konten video faceless dan merancang otomasi workflow n8n untuk project "${projectName}".
2. Kamu memiliki akses untuk mengubah alur kerja n8n khusus project ini.
3. Jika kamu menyarankan atau diminta mengubah workflow n8n, jelaskan secara singkat dan di bagian akhir pesanmu lampirkan SATU blok kode json aksi:
\`\`\`json
{
  "action": "add_n8n_node" | "modify_n8n_node" | "remove_n8n_node" | "publish_n8n_workflow" | "execute_n8n_workflow",
  "explanation": "Penjelasan singkat perubahan",
  ... parameter aksi
}
\`\`\`
Spesifikasi parameter aksi n8n:
- add_n8n_node: {"action":"add_n8n_node", "name":"Nama Node", "type":"n8n-nodes-base.xxx", "parameters":{}, "connect_from":"Nama Node Sumber", "connect_to":"Nama Node Tujuan"}
- modify_n8n_node: {"action":"modify_n8n_node", "node_name":"Nama Node", "prompt":"teks prompt baru jika node AI", "parameters":{}}
- remove_n8n_node: {"action":"remove_n8n_node", "node_name":"Nama Node"}
- publish_n8n_workflow: {"action":"publish_n8n_workflow", "active": true | false}
- execute_n8n_workflow: {"action":"execute_n8n_workflow", "brief":"topik/ide uji coba", "title":"Judul test"}

4. Berikan jawaban yang cerdas, terstruktur, ramah, dan profesional dalam Bahasa Indonesia.

${projectCustomInstructions ? `\nPANDUAN & ATURAN SPESIFIK PROJECT (system.md):\n${projectCustomInstructions}\n` : ""}

${n8nSummary}
`;

    // Format messages for 9Router
    const formattedMessages: any[] = [{ role: "system", content: systemPrompt }];

    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      const isLast = i === history.length - 1;
      let text = m.content || "";
      if (isLast && extraContext) text += extraContext;

      // Handle image attachments for vision models
      const images = (m.attachments || []).filter((a: any) => a.type?.startsWith("image/") && a.url);
      if (images.length > 0) {
        formattedMessages.push({
          role: m.role,
          content: [
            { type: "text", text },
            ...images.map((img: any) => ({ type: "image_url", image_url: { url: img.url } }))
          ]
        });
      } else {
        formattedMessages.push({ role: m.role, content: text });
      }
    }

    const { url: routerUrl, apiKey } = await routerAuth();
    if (!routerUrl) {
      return new Response(JSON.stringify({ error: "9Router URL is not configured." }), { status: 500 });
    }

    const model = reqModel || "faceless-creation";
    const endpoint = routerUrl.replace(/\/+$/, "") + "/chat/completions";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true
      }),
      signal: AbortSignal.timeout(300_000)
    });

    if (!response.ok) {
      const errTxt = await response.text().catch(() => "");
      return new Response(JSON.stringify({ error: `9Router error ${response.status}: ${errTxt}` }), { status: 502 });
    }

    // Stream SSE to client with real-time thinking extraction
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstream = response.body?.getReader();
    if (!upstream) {
      return new Response(JSON.stringify({ error: "Failed to read 9Router stream" }), { status: 502 });
    }

    let inThinkTag = false;
    let fullResponseText = "";
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await upstream.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const dataStr = trimmed.slice(6);
              if (dataStr === "[DONE]") continue;

              try {
                const json = JSON.parse(dataStr);
                const delta = json.choices?.[0]?.delta;
                if (!delta) continue;

                // 1. Direct reasoning_content (DeepSeek R1 native)
                if (delta.reasoning_content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "think", text: delta.reasoning_content })}\n\n`));
                  continue;
                }

                // 2. <think> tag inside content
                const contentChunk = delta.content || "";
                if (!contentChunk) continue;

                fullResponseText += contentChunk;
                let remaining = contentChunk;

                while (remaining.length > 0) {
                  if (!inThinkTag) {
                    const openIdx = remaining.indexOf("<think>");
                    if (openIdx !== -1) {
                      if (openIdx > 0) {
                        const pre = remaining.slice(0, openIdx);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content", text: pre })}\n\n`));
                      }
                      inThinkTag = true;
                      remaining = remaining.slice(openIdx + 7);
                    } else {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content", text: remaining })}\n\n`));
                      remaining = "";
                    }
                  } else {
                    const closeIdx = remaining.indexOf("</think>");
                    if (closeIdx !== -1) {
                      const thinkPart = remaining.slice(0, closeIdx);
                      if (thinkPart) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "think", text: thinkPart })}\n\n`));
                      }
                      inThinkTag = false;
                      remaining = remaining.slice(closeIdx + 8);
                    } else {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "think", text: remaining })}\n\n`));
                      remaining = "";
                    }
                  }
                }
              } catch {
                // Ignore chunk parse errors
              }
            }
          }

          // Parse any JSON action proposal from the complete response
          const actionMatch = fullResponseText.match(/```json\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/i);
          if (actionMatch) {
            try {
              const parsedAction = JSON.parse(actionMatch[1]);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "action", action: parsedAction })}\n\n`));
            } catch {}
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: (err as Error).message })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
