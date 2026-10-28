import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { HyperFramesEngine } from "@studio/render-hyperframes";
import { run } from "@studio/connectors";

try { loadEnvFile(".env"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const root = path.resolve(".runtime/render-smoke");
await mkdir(root, { recursive: true });
const signal = AbortSignal.timeout(180_000), ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const image = path.join(root, "synthetic-still.svg"), clip = path.join(root, "synthetic-clip.mp4"), audio = path.join(root, "synthetic-audio.wav");
await writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#302443"/><rect x="220" y="500" width="640" height="640" fill="#aba0ea"/></svg>');
await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip], { signal });
await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", audio], { signal });
const output = await new HyperFramesEngine().render({
  title: "Synthetic render verification", width: 1080, height: 1920, fps: 24,
  beats: [
    { index: 1, text: "SYNTHETIC STILL", prompt: "Test fixture", seconds: 1, image: "fixtureimage001", video: "" },
    { index: 2, text: "SYNTHETIC CLIP", prompt: "Test fixture", seconds: 1, image: "", video: "fixturevideo001" }
  ],
  assetPaths: { fixtureimage001: image, fixturevideo001: clip }, audioPaths: [audio]
}, path.join(root, "composition"), signal, value => process.stdout.write(value));
assert.ok((await stat(output)).size > 1000);
const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { signal }));
const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
assert.equal(video.width, 1080); assert.equal(video.height, 1920); assert.equal(video.r_frame_rate, "24/1");
assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.1);
assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio"));
await run(ffmpeg, ["-y", "-ss", "0.5", "-i", output, "-frames:v", "1", path.join(root, "still-check.png")], { signal });
await run(ffmpeg, ["-y", "-ss", "1.5", "-i", output, "-frames:v", "1", path.join(root, "clip-check.png")], { signal });
for (const [name, time] of [["early", "1.1"], ["late", "1.8"]]) await run(ffmpeg, ["-y", "-ss", time, "-i", output, "-vf", "crop=540:540:0:0", "-frames:v", "1", path.join(root, `${name}-motion.png`)], { signal });
assert.notDeepEqual(await readFile(path.join(root, "early-motion.png")), await readFile(path.join(root, "late-motion.png")), "The rendered clip must advance rather than freeze on one frame");
console.log("Render smoke passed: synthetic still + clip, 1080×1920, 24 fps, two seconds, mixed AAC audio. Local output only.");
