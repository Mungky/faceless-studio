import path from "node:path";
import { mkdir } from "node:fs/promises";
import { run } from "./process";

export interface DriveFile { id: string; path: string; size: number; }
export class DriveConnector {
  constructor(private config = { binary: process.env.RCLONE_BIN || "rclone", remote: process.env.RCLONE_REMOTE || "", config: process.env.RCLONE_CONFIG || "" }) {}
  private target(relative: string): string {
    if (!this.config.remote) throw new Error("Google Drive is not connected. Configure RCLONE_REMOTE and rclone authorization.");
    if (!relative.startsWith("Faceless/") || relative.split(/[\\/]/).some(p => !p || p === "." || p === "..") || /[\x00-\x1f:]/.test(relative)) throw new Error("Invalid Drive path");
    return this.config.remote.replace(/\/$/, "") + (this.config.remote.endsWith(":") ? "" : "/") + relative;
  }
  private flags() { return this.config.config ? ["--config", this.config.config] : []; }
  async upload(local: string, relative: string, signal?: AbortSignal): Promise<DriveFile> {
    const remote = this.target(relative);
    await run(this.config.binary, ["copyto", local, remote, "--retries", "1", "--low-level-retries", "2", ...this.flags()], { signal });
    const stat = JSON.parse(await run(this.config.binary, ["lsjson", remote, "--stat", ...this.flags()], { signal })) as { ID?: string; Size?: number };
    return { id: stat.ID || "", path: relative, size: stat.Size || 0 };
  }
  async download(relative: string, local: string, signal?: AbortSignal) {
    await mkdir(path.dirname(local), { recursive: true });
    await run(this.config.binary, ["copyto", this.target(relative), local, "--retries", "1", ...this.flags()], { signal });
    return local;
  }
  async check() {
    if (!this.config.remote) return { connected: false, message: "Set RCLONE_REMOTE after authorizing Google Drive." };
    try { await run(this.config.binary, ["lsf", this.config.remote, "--max-depth", "1", ...this.flags()], { timeout: 15_000 }); return { connected: true, message: "Google Drive is reachable." }; }
    catch { return { connected: false, message: "rclone could not reach Drive. Check its executable, remote and authorization." }; }
  }
}
