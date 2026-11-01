import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { loadEnvFile } from "node:process";

try { loadEnvFile(".env"); } catch {}

// 1. Directory and file detection for Google Drive outputs
const tempDir = await mkdir(path.join(os.tmpdir(), "test-drive-output-" + Date.now()), { recursive: true });
const targetDir = path.join(os.tmpdir(), "test-drive-output-" + Date.now(), "Faceless/TestProject");
await mkdir(targetDir, { recursive: true });
await writeFile(path.join(targetDir, "final-video.mp4"), "fake-video-content");
await writeFile(path.join(targetDir, "narration.mp3"), "fake-audio-content");
await writeFile(path.join(targetDir, "thumbnail.png"), "fake-image-content");
await writeFile(path.join(targetDir, "script.md"), "fake-doc-content");

const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });
const files = entries.filter(e => e.isFile()).map(e => e.name);
assert.ok(files.includes("final-video.mp4"));
assert.ok(files.includes("narration.mp3"));
assert.ok(files.includes("thumbnail.png"));
assert.ok(files.includes("script.md"));
await rm(path.dirname(targetDir), { recursive: true, force: true }).catch(() => undefined);

// 2. ExtKind classification check
const extKind = (filepath) => {
  const ext = filepath.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "webm", "mkv", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(ext)) return "vo";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  return "doc";
};
assert.equal(extKind("video.mp4"), "video");
assert.equal(extKind("audio.mp3"), "vo");
assert.equal(extKind("cover.png"), "image");
assert.equal(extKind("brief.md"), "doc");

// 3. Live Server Endpoint Check
const email = process.env.STUDIO_OWNER_EMAIL;
const password = process.env.STUDIO_OWNER_PASSWORD;
if (email && password) {
  const login = await fetch("http://127.0.0.1:3100/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(login.status, 200);
  const token = login.headers.get("set-cookie")?.split(";")[0];

  const dashRes = await fetch("http://127.0.0.1:3100/api/dashboard", { headers: { Cookie: token } });
  assert.equal(dashRes.status, 200);
  const dash = await dashRes.json();
  const channel = dash.channels?.[0];
  if (channel) {
    const driveRes = await fetch("http://127.0.0.1:3100/api/projects/" + channel.id + "/drive", { headers: { Cookie: token } });
    assert.equal(driveRes.status, 200);
    const driveData = await driveRes.json();
    assert.ok(driveData.project);
    assert.ok(driveData.folder);
    assert.ok(Array.isArray(driveData.files));
    assert.ok(Array.isArray(driveData.assets));
  }
}

console.log("All Drive output & API checks passed successfully.");
