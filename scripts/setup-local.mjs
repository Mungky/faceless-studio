import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const runtime = path.join(root, ".runtime");
await mkdir(runtime, { recursive: true });
const exists = async p => { try { await access(p); return true; } catch { return false; } };
const envPath = path.join(root, ".env");
if (!await exists(envPath)) {
  let env = await readFile(path.join(root, ".env.example"), "utf8");
  const values = {
    PB_ADMIN_PASSWORD: randomBytes(24).toString("hex"), STUDIO_OWNER_PASSWORD: randomBytes(18).toString("hex"),
    WORKER_TOKEN: randomBytes(32).toString("hex"), AUTOMATION_TOKEN: randomBytes(32).toString("hex"),
    OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"), N8N_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    VAULT_ROOT: path.resolve(root, "../projects").replaceAll("\\", "/"),
    STUDIO_CACHE_ROOT: path.join(root, ".cache").replaceAll("\\", "/"),
    FLOW_DOWNLOAD_ROOT: path.join(os.homedir(), "Downloads").replaceAll("\\", "/")
  };
  for (const [name, value] of Object.entries(values)) env = env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${JSON.stringify(value)}`);
  await writeFile(envPath, env, { mode: 0o600, flag: "wx" });
  console.log("Created .env with unique local credentials. Read STUDIO_OWNER_EMAIL and STUDIO_OWNER_PASSWORD there to sign in.");
} else console.log("Existing .env preserved.");
const executable = path.join(runtime, process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
if (!await exists(executable)) {
  const platform = { win32: "windows", linux: "linux", darwin: "darwin" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!platform || !arch) throw new Error("Download PocketBase v0.40.6 manually for this platform.");
  const metadata = await fetch("https://api.github.com/repos/pocketbase/pocketbase/releases/tags/v0.40.6", { headers: { "User-Agent": "faceless-studio" } });
  if (!metadata.ok) throw new Error("Could not read the official PocketBase release.");
  const release = await metadata.json();
  const name = `pocketbase_0.40.6_${platform}_${arch}.zip`;
  const asset = release.assets.find(a => a.name === name);
  if (!asset) throw new Error(`Release does not contain ${name}`);
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error("PocketBase download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  let expected = asset.digest?.replace(/^sha256:/, "");
  if (!expected) {
    const checksums = release.assets.find(a => /checksums/i.test(a.name));
    if (!checksums) throw new Error("Official release has no checksum; refusing unverified binary.");
    const sums = await (await fetch(checksums.browser_download_url)).text();
    expected = sums.split(/\r?\n/).find(line => line.endsWith(name))?.split(/\s+/)[0];
  }
  if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("PocketBase checksum mismatch");
  const zip = path.join(runtime, name); await writeFile(zip, bytes);
  let result;
  if (process.platform === "win32") {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(runtime)} -Force`], { stdio: "inherit", windowsHide: true });
  } else result = spawnSync("unzip", ["-o", zip, "-d", runtime], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Could not extract PocketBase");
  if (process.platform !== "win32") spawnSync("chmod", ["+x", executable]);
  console.log("PocketBase v0.40.6 downloaded and SHA-256 verified.");
}
console.log("Next: npm run dev:db, then npm run dev (separate terminals). No external generation was called.");
