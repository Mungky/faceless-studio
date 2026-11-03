import "server-only";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Channel } from "@studio/core";
import { channelPreferences } from "./workspace";
import { vaultRoot } from "./vault";

function findRepoRoot() {
  if (process.env.STUDIO_ROOT) return process.env.STUDIO_ROOT;
  let curr = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(curr, "package.json");
    if (existsSync(pkg)) {
      try {
        const d = JSON.parse(readFileSync(pkg, "utf8"));
        if (d.name === "faceless-studio") return curr;
      } catch {}
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

const root = findRepoRoot();
const runtimeDir = path.resolve(root, ".runtime");
const activeProjectFile = path.resolve(runtimeDir, "active-project.json");

export async function ensureProjectWorkspace(channel: Channel) {
  const prefs = await channelPreferences(channel.id).catch(() => ({ project_name: "", n8n_workflow_id: "" }));
  const name = (prefs.project_name || channel.name).trim();
  const storageRoot = vaultRoot();
  const projectDir = path.resolve(storageRoot, name);
  if (projectDir === storageRoot || !projectDir.startsWith(storageRoot + path.sep)) {
    throw new Error("Invalid project directory: escapes Restard Studio storage root");
  }

  await mkdir(projectDir, { recursive: true });
  await mkdir(path.resolve(projectDir, "assets"), { recursive: true });
  await mkdir(path.resolve(projectDir, "prompts"), { recursive: true });
  await mkdir(path.resolve(projectDir, "nodes"), { recursive: true });

  const agentsMd = `# Restard Studio Agent — Project: ${name}

Kamu adalah AI Workflow Architect & Production Assistant resmi untuk project **${name}** di Restard Studio.

## Identitas & Batasan Proyek (STRICT SCOPE)
- **Project Name:** ${name}
- **Channel ID:** \`${channel.id}\`
- **Terkoneksi ke n8n Workflow ID:** \`${prefs.n8n_workflow_id || "Belum dibuat (jalankan perintah bangun workflow n8n)"}\`
- **Working Directory:** Folder ini (\`projects/${name}\`)
- **ATURAN ISOLASI UTAMA:**
  1. Hak akses penuh kamu **HANYA** berlaku untuk workflow n8n milik project ini.
  2. DILARANG KERAS memodifikasi, menghapus, atau mengakses workflow dari project lain.
  3. Semua file riset, skrip, catatan, dan aset yang kamu hasilkan harus disimpan di dalam folder project ini.

## Kemampuan & Tools Workflow n8n
Kamu terhubung ke n8n melalui MCP Server (\`studio-n8n\`):
- \`n8n_get_workflow\`: Memeriksa struktur node dan koneksi saat ini.
- \`n8n_add_node\`: Menyisipkan node n8n baru secara presisi tanpa merusak node lain.
- \`n8n_modify_node\`: Mengubah prompt, parameter, atau konfigurasi node tertentu.
- \`n8n_remove_node\`: Menghapus satu node dari alur.
- \`n8n_publish_workflow\`: Mengaktifkan / mempublikasikan workflow.
- \`n8n_execute_workflow\`: Memicu test run (uji coba eksekusi) alur n8n dengan brief tertentu.
`;

  await writeFile(path.resolve(projectDir, "AGENTS.md"), agentsMd, "utf8");

  const activeData = {
    channelId: channel.id,
    name,
    n8nWorkflowId: prefs.n8n_workflow_id || ""
  };
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(activeProjectFile, JSON.stringify(activeData, null, 2), "utf8");

  // Automatically register project in DSH workspace storage
  try {
    const userProfile = process.env.USERPROFILE || "";
    if (userProfile) {
      const wsFile = path.join(userProfile, ".dsh", "storages", "workspace.json");
      if (existsSync(wsFile)) {
        const wsData = JSON.parse(readFileSync(wsFile, "utf8"));
        if (wsData.tables?.workspaces) {
          let existingId = Object.keys(wsData.tables.workspaces).find(
            id => wsData.tables.workspaces[id].path?.toLowerCase() === projectDir.toLowerCase()
          );
          const now = new Date().toISOString();
          if (!existingId) {
            const { randomUUID } = await import("node:crypto");
            existingId = randomUUID();
            wsData.tables.workspaces[existingId] = {
              path: projectDir,
              title: name,
              sessionIds: [],
              createdAt: now,
              updatedAt: now
            };
            if (Array.isArray(wsData.global?.workspaceIds)) {
              wsData.global.workspaceIds.unshift(existingId);
            }
          } else {
            wsData.tables.workspaces[existingId].title = name;
            wsData.tables.workspaces[existingId].updatedAt = now;
            if (Array.isArray(wsData.global?.workspaceIds)) {
              wsData.global.workspaceIds = [
                existingId,
                ...wsData.global.workspaceIds.filter((wid: string) => wid !== existingId)
              ];
            }
          }
          await writeFile(wsFile, JSON.stringify(wsData, null, 2), "utf8");
        }
      }
    }
  } catch {}
}

export async function removeProjectWorkspace(channelName: string) {
  const trimmed = channelName.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return;
  const storageRoot = vaultRoot();
  const projectDir = path.resolve(storageRoot, trimmed);
  // STRICT ISOLATION GUARD: Must be strictly inside storageRoot and NOT storageRoot itself
  if (projectDir !== storageRoot && projectDir.startsWith(storageRoot + path.sep)) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
  const legacyDir = path.resolve(root, "projects", trimmed);
  if (legacyDir !== projectDir && legacyDir.startsWith(path.resolve(root, "projects") + path.sep)) {
    await rm(legacyDir, { recursive: true, force: true }).catch(() => undefined);
  }
  if (existsSync(activeProjectFile)) {
    try {
      const active = JSON.parse(readFileSync(activeProjectFile, "utf8"));
      if (active.name === channelName) {
        await rm(activeProjectFile, { force: true }).catch(() => undefined);
      }
    } catch {}
  }

  // Deep cleanup in DSH storage to avoid orphaned/broken workspace entries
  try {
    const userProfile = process.env.USERPROFILE || "";
    if (userProfile) {
      const dshDir = path.join(userProfile, ".dsh");

      // 1. Clean workspace.json
      const wsFile = path.join(dshDir, "storages", "workspace.json");
      if (existsSync(wsFile)) {
        const wsData = JSON.parse(readFileSync(wsFile, "utf8"));
        let modified = false;
        if (wsData.tables?.workspaces) {
          for (const [id, ws] of Object.entries(wsData.tables.workspaces as Record<string, { path: string }>)) {
            if (ws.path && (ws.path.toLowerCase() === projectDir.toLowerCase() || ws.path.toLowerCase().endsWith(path.sep + channelName.toLowerCase()))) {
              delete wsData.tables.workspaces[id];
              if (Array.isArray(wsData.global?.workspaceIds)) {
                wsData.global.workspaceIds = wsData.global.workspaceIds.filter((wid: string) => wid !== id);
              }
              modified = true;
            }
          }
        }
        if (modified) {
          await writeFile(wsFile, JSON.stringify(wsData, null, 2), "utf8");
        }
      }

      // 2. Clean session projection caches
      const projCacheDir = path.join(dshDir, "storages", "session_projcache", "sessions");
      if (existsSync(projCacheDir)) {
        const { readdir, unlink } = await import("node:fs/promises");
        const files = await readdir(projCacheDir).catch(() => []);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const fullPath = path.join(projCacheDir, file);
          try {
            const content = JSON.parse(readFileSync(fullPath, "utf8"));
            const cwd = content.record?.identity?.cwd || "";
            if (cwd.toLowerCase() === projectDir.toLowerCase() || cwd.toLowerCase().endsWith(path.sep + channelName.toLowerCase())) {
              await unlink(fullPath).catch(() => undefined);
            }
          } catch {}
        }
      }

      // 3. Clean sessions folder
      const sessionsDir = path.join(dshDir, "sessions");
      if (existsSync(sessionsDir)) {
        const { readdir } = await import("node:fs/promises");
        const dirs = await readdir(sessionsDir).catch(() => []);
        const targetSlug = channelName.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const dir of dirs) {
          const lower = dir.toLowerCase();
          if (lower.includes("projects") && (lower.includes(channelName.toLowerCase()) || (targetSlug && lower.replace(/[^a-z0-9]/g, "").includes(targetSlug)))) {
            await rm(path.join(sessionsDir, dir), { recursive: true, force: true }).catch(() => undefined);
          }
        }
      }
    }
  } catch {}
}
