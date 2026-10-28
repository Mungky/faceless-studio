import { spawn } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const child = spawn(path.join(root, ".runtime", process.platform === "win32" ? "pocketbase.exe" : "pocketbase"), ["serve", "--http=127.0.0.1:8095", `--dir=${path.join(root, ".runtime/pb_data")}`, `--migrationsDir=${path.join(root, "infra/pocketbase/pb_migrations")}`, `--hooksDir=${path.join(root, "infra/pocketbase/pb_hooks")}`, "--automigrate=false"], { stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code || 0; });
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
