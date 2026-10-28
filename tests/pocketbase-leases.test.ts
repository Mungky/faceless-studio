import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

test("native PocketBase expires restarted-worker jobs while progress renews a live lease", async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const binary = path.join(root, ".runtime", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
  try { await access(binary); } catch { return t.skip("Native PocketBase is not installed; run setup:local."); }
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-lease-regression-"));
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith("studio-lease-regression-")) throw new Error("Unexpected fixture root");
  const hooks = path.join(directory, "hooks");
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const password = randomBytes(24).toString("hex");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await cp(path.join(root, "infra", "pocketbase", "pb_hooks"), hooks, { recursive: true });
    // Test-only fixture route: change time directly so a real two-minute sleep
    // is unnecessary. This route exists only in the disposable hooks directory.
    await writeFile(path.join(hooks, "fixture.pb.js"), `routerAdd("POST", "/api/fixture/age-job", e => {
      const id = e.requestInfo().body.id;
      $app.db().newQuery("UPDATE jobs SET updated = {:time} WHERE id = {:id}").bind({ time: new Date(Date.now() - 180000).toISOString().replace("T", " "), id }).execute();
      return e.json(200, { ok: true });
    }, $apis.requireSuperuserAuth());`);
    child = spawn(binary, ["serve", `--http=127.0.0.1:${port}`, `--dir=${path.join(directory, "data")}`, `--hooksDir=${hooks}`, `--migrationsDir=${path.join(root, "infra", "pocketbase", "pb_migrations")}`, "--automigrate=false"], { windowsHide: true, stdio: "ignore", env: { ...process.env, PB_ADMIN_EMAIL: "fixture@studio.local", PB_ADMIN_PASSWORD: password, STUDIO_OWNER_EMAIL: "owner@studio.local", STUDIO_OWNER_PASSWORD: randomBytes(24).toString("hex") } });
    let ready = false;
    for (let i = 0; i < 80; i++) { try { ready = (await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) })).ok; } catch {} if (ready) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(ready, "Disposable database starts");
    const auth = await fetch(base + "/api/collections/_superusers/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: "fixture@studio.local", password }) });
    const { token } = await auth.json() as { token: string }; assert.ok(token);
    const api = async (route: string, input?: unknown, method = input === undefined ? "GET" : "POST") => {
      const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", Authorization: token }, body: input === undefined ? undefined : JSON.stringify(input) });
      assert.ok(response.ok, `Fixture API returned ${response.status} for ${route}`);
      return response.status === 204 ? undefined : response.json();
    };
    const record = (collection: string, id: string) => api(`/api/collections/${collection}/records/${id}`);
    const channels = await api("/api/collections/channels/records");
    const owner = (await api("/api/collections/studio_users/records")).items[0];
    const episode = await api("/api/collections/episodes/records", { channel: channels.items[0].id, title: "Lease fixture", slug: "lease", status: "idea", format: "short", vault_path: "Fixture/lease" });
    const worker = await api("/api/collections/workers/records", { worker_key: "same-process-identity", hostname: "fixture", capabilities: ["image"], heartbeat: new Date().toISOString() });
    const budget = (await api('/api/collections/settings/records?filter=key%3D%22spending%22')).items[0];
    await api(`/api/collections/settings/records/${budget.id}`, { value: { ...budget.value, daily_credits: 2 } }, "PATCH");
    const quote = await api("/api/collections/spend_quotes/records", { operation: "image", episode: episode.id, provider: "flow", units: 2, est_cost: 0, currency: "credits", requested_by: owner.id, request: {}, payload: { drive_base: "Faceless/Fixture/lease" }, expires: new Date(Date.now() + 60_000).toISOString() });
    const reservation = await api("/api/studio/reserve", { quote_id: quote.id, approved_by: owner.id, day_start: new Date(Date.now() - 3_600_000).toISOString() });
    await api("/api/studio/claim", { worker_id: worker.id });
    await api("/api/fixture/age-job", { id: reservation.job.id });
    await api(`/api/collections/workers/records/${worker.id}`, { heartbeat: new Date().toISOString() }, "PATCH");
    await api("/api/crons/studio_worker_leases", {});
    let abandoned;
    for (let i = 0; i < 30; i++) { abandoned = await record("jobs", reservation.job.id); if (abandoned.status === "failed") break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(abandoned.status, "failed"); assert.equal(abandoned.attempts, 1);
    assert.equal((await record("spend_log", reservation.spend.id)).status, "failed");
    assert.equal((await api("/api/studio/claim", { worker_id: worker.id })).job, null, "Expired paid job is not requeued");
    const live = await api("/api/collections/jobs/records", { episode: episode.id, type: "image", status: "queued", payload: {} });
    await api("/api/studio/claim", { worker_id: worker.id });
    await api("/api/fixture/age-job", { id: live.id });
    const progress = await api("/api/studio/progress", { worker_id: worker.id, job_id: live.id, progress: 10, log: "Still executing" });
    assert.ok(Date.now() - Date.parse(progress.updated) < 5000, "Saving real progress renews jobs.updated");
    await api("/api/crons/studio_worker_leases", {});
    assert.equal((await record("jobs", live.id)).status, "running");
    await api("/api/collections/jobs/records", { episode: episode.id, type: "image", status: "queued", payload: {} });
    assert.equal((await api("/api/studio/claim", { worker_id: worker.id })).job, null, "Progress preserves one-running-job-per-worker semantics");
  } finally {
    if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child!.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 4000))]); }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
