import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { cp, access } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
try { loadEnvFile(path.join(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const action = process.argv[2];
if (!["dev", "build", "start"].includes(action)) throw new Error("Expected dev, build or start");
// Next propagates execArgv to build workers; load env here instead of passing an
// --env-file flag that Node refuses when Next copies it into NODE_OPTIONS.
let args;
if (action === "start") {
  const web = path.join(root, "apps/web"), standalone = path.join(web, ".next/standalone/apps/web");
  await access(path.join(standalone, "server.js"));
  await cp(path.join(web, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
  try { await cp(path.join(web, "public"), path.join(standalone, "public"), { recursive: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
  args = [path.join(standalone, "server.js")];
} else {
  args = [path.join(root, "node_modules/next/dist/bin/next"), action, path.join(root, "apps/web")];
  if (action === "dev") args.push("--hostname", "127.0.0.1", "--port", "3100");
}
const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PORT: "3100", HOSTNAME: "127.0.0.1" }, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code || 0; });
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
