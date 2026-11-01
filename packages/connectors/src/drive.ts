import path from "node:path";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { run } from "./process";

export interface DriveFile { id: string; path: string; size: number; }
export const localMediaRoot = () => path.resolve(process.env.LOCAL_MEDIA_ROOT || path.join(process.env.STUDIO_CACHE_ROOT || ".cache", "media"));
function checkedPath(relative: string) {
  if (!relative.startsWith("Faceless/") || relative.split(/[\\/]/).some(p => !p || p === "." || p === "..") || /[\x00-\x1f:]/.test(relative)) throw new Error("Invalid Drive path");
  return relative;
}
// Without RCLONE_REMOTE the same Faceless/... paths live in a local media folder, so
// uploads, generated media and previews keep working before Drive is set up.
export class DriveConnector {
  constructor(private config = { binary: process.env.RCLONE_BIN || "rclone", remote: process.env.RCLONE_REMOTE || "", config: process.env.RCLONE_CONFIG || "", localRoot: localMediaRoot() }) {}
  get isLocal() { return !this.config.remote; }
  private target(relative: string): string {
    checkedPath(relative);
    return this.config.remote.replace(/\/$/, "") + (this.config.remote.endsWith(":") ? "" : "/") + relative;
  }
  private localPath(relative: string) { return path.join(this.config.localRoot, ...checkedPath(relative).split(/[\\/]/)); }
  private flags() { return this.config.config ? ["--config", this.config.config] : []; }
  async upload(local: string, relative: string, signal?: AbortSignal): Promise<DriveFile> {
    if (this.isLocal) { const destination = this.localPath(relative); await mkdir(path.dirname(destination), { recursive: true }); await copyFile(local, destination); return { id: "local", path: relative, size: (await stat(destination)).size }; }
    const remote = this.target(relative);
    await run(this.config.binary, ["copyto", local, remote, "--retries", "1", "--low-level-retries", "2", ...this.flags()], { signal });
    const info = JSON.parse(await run(this.config.binary, ["lsjson", remote, "--stat", ...this.flags()], { signal })) as { ID?: string; Size?: number };
    return { id: info.ID || "", path: relative, size: info.Size || 0 };
  }
  async download(relative: string, local: string, signal?: AbortSignal) {
    await mkdir(path.dirname(local), { recursive: true });
    if (this.isLocal) { await copyFile(this.localPath(relative), local); return local; }
    await run(this.config.binary, ["copyto", this.target(relative), local, "--retries", "1", ...this.flags()], { signal });
    return local;
  }
  async check() {
    if (!this.config.remote) return { connected: false, message: "Drive belum diatur. Media disimpan di folder lokal server; isi RCLONE_REMOTE untuk memakai Drive." };
    try { await run(this.config.binary, ["lsf", this.config.remote, "--max-depth", "1", ...this.flags()], { timeout: 15_000 }); return { connected: true, message: "Google Drive is reachable." }; }
    catch { return { connected: false, message: "rclone could not reach Drive. Check its executable, remote and authorization." }; }
  }
}
