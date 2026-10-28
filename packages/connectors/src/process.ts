import { spawn } from "node:child_process";

export function run(executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLog?: (value: string) => void; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, signal: options.signal, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "", settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error(`${executable} timed out`)); }, options.timeout ?? 1_800_000);
    function finish(error?: Error) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(output); }
    child.stdout.on("data", data => { const text = data.toString(); output = (output + text).slice(-2_000_000); options.onLog?.(text); });
    child.stderr.on("data", data => { const text = data.toString(); errors = (errors + text).slice(-50_000); options.onLog?.(text); });
    child.on("error", error => finish(error));
    child.on("close", code => finish(code === 0 ? undefined : new Error(`${executable} exited ${code}: ${errors.slice(-4000)}`)));
  });
}
