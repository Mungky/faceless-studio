import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const root = path.resolve(import.meta.dirname, "..");
const runtime = path.join(root, ".runtime");
const directory = path.join(runtime, "test-db-" + randomUUID()); await mkdir(directory, { recursive: true });
if (!directory.startsWith(runtime + path.sep)) throw new Error("Test database path is outside .runtime");
const port = 18000 + Math.floor(Math.random() * 8000);
const env = { ...process.env, STUDIO_INTEGRATION_TESTS: "1", STUDIO_TEST_PB_URL: `http://127.0.0.1:${port}`, PB_ADMIN_EMAIL: "integration@studio.local", PB_ADMIN_PASSWORD: randomBytes(24).toString("hex"), STUDIO_OWNER_EMAIL: "test-owner@studio.local", STUDIO_OWNER_PASSWORD: randomBytes(24).toString("hex") };
const child = spawn(path.join(runtime, process.platform === "win32" ? "pocketbase.exe" : "pocketbase"), ["serve", `--http=127.0.0.1:${port}`, `--dir=${directory}`, `--migrationsDir=${path.join(root, "infra/pocketbase/pb_migrations")}`, `--hooksDir=${path.join(root, "infra/pocketbase/pb_hooks")}`, "--automigrate=false"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { const response = await fetch(env.STUDIO_TEST_PB_URL + "/api/health"); if (response.ok) { ready = true; break; } } catch {} await delay(250); }
  if (!ready) throw new Error("Integration database did not start: " + logs);
  const test = spawn(process.execPath, ["--import", "tsx", "--test", "tests/pocketbase.integration.test.ts", "tests/workflows.test.ts"], { cwd: root, env, windowsHide: true, stdio: "inherit" });
  process.exitCode = await new Promise(resolve => test.on("exit", code => resolve(code || 0)));
  if (process.exitCode) console.error("Integration server log:\n" + logs.slice(-6000));
} finally {
  child.kill(); await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(4000)]);
  const target = path.resolve(directory);
  if (!target.startsWith(path.resolve(runtime) + path.sep) || !path.basename(target).startsWith("test-db-")) throw new Error("Refusing to remove an unexpected test directory");
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
