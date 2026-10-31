import path from "node:path";
import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import type { RenderEngine, RenderInput } from "@studio/core";
import { run } from "@studio/connectors";
export * from "./composition";

const require = createRequire(import.meta.url);
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
export class HyperFramesEngine implements RenderEngine {
  readonly name = "hyperframes-studio-basic";
  async render(input: RenderInput, directory: string, signal: AbortSignal, onLog: (value: string) => void) {
    await mkdir(path.join(directory, "assets"), { recursive: true });
    await copyFile(require.resolve("gsap/dist/gsap.min.js"), path.join(directory, "assets/gsap.min.js"));
    const copied: Record<string, string> = {};
    for (const [id, file] of Object.entries(input.assetPaths)) {
      if (!/^[a-zA-Z0-9]{15}$/.test(id)) throw new Error("Invalid render asset ID");
      const name = id + path.extname(file).toLowerCase(); await copyFile(file, path.join(directory, "assets", name)); copied[id] = `assets/${name}`;
    }
    const duration = input.beats.reduce((sum, beat) => sum + beat.seconds, 0);
    if (!duration || duration > 7200) throw new Error("Render duration must be between 0 and 7200 seconds");
    let start = 0;
    const schedule: { index: number; start: number; end: number }[] = [];
    const fallback = Object.keys(copied)[0];
    const scenes = input.beats.map((beat, index) => {
      const id = beat.video && copied[beat.video] ? beat.video : beat.image && copied[beat.image] ? beat.image : fallback;
      if (!id) throw new Error(`Beat ${beat.index} has no usable footage`);
      const src = copied[id]; const isVideo = /\.(mp4|webm|mov)$/i.test(src);
      const media = isVideo ? `<video id="media-${index}" src="${escapeHtml(src)}" muted playsinline data-start="${start}" data-duration="${beat.seconds}" data-track-index="0"></video>` : `<img src="${escapeHtml(src)}" alt="">`;
      schedule.push({ index, start, end: start + beat.seconds }); start += beat.seconds;
      return `<section class="scene" id="scene-${index}">${media}<div class="shade"></div><div class="caption">${escapeHtml(beat.text)}</div></section>`;
    }).join("\n");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title><style>
html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden;background:#171b23;font-family:Arial,sans-serif}*{box-sizing:border-box}#main{position:relative;width:100%;height:100%;overflow:hidden}.scene{position:absolute;inset:0;opacity:0;overflow:hidden}.scene img,.scene video{width:100%;height:100%;object-fit:cover}.shade{position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.76))}.caption{position:absolute;left:8%;right:8%;bottom:12%;color:#fff;font-size:${Math.round(input.width * 0.055)}px;line-height:1.18;font-weight:700;text-align:center;text-wrap:balance;text-shadow:0 2px 8px #111}
</style></head><body><main id="main" data-composition-id="main" data-width="${input.width}" data-height="${input.height}" data-fps="${input.fps}" data-start="0" data-duration="${duration}">${scenes}</main><script src="assets/gsap.min.js"></script><script>
const timeline=gsap.timeline({paused:true});const schedule=${JSON.stringify(schedule)};
schedule.forEach(s=>{timeline.set('#scene-'+s.index,{opacity:1},s.start);const image=document.querySelector('#scene-'+s.index+' img');if(image)timeline.fromTo(image,{scale:1.02},{scale:1.10,duration:s.end-s.start,ease:'none'},s.start);timeline.set('#scene-'+s.index,{opacity:0},s.end)});
window.__timelines=window.__timelines||{};window.__timelines.main=timeline;timeline.seek(0);
</script></body></html>`;
    await writeFile(path.join(directory, "index.html"), html);
    await writeFile(path.join(directory, "hyperframes.json"), JSON.stringify({ name: "studio-basic", width: input.width, height: input.height, fps: input.fps }));
    const cli = path.join(path.dirname(require.resolve("hyperframes/package.json")), "bin/hyperframes.mjs");
    const video = path.join(directory, "video.mp4");
    await run(process.execPath, [cli, "render", directory, "--output", video, "--fps", String(input.fps), "--workers", "1", "--quality", "delivery", "--strict"], { signal, onLog, timeout: 7_200_000 });
    if (!input.audioPaths.length) return video;
    const output = path.join(directory, "final.mp4");
    const args = ["-y", "-i", video]; input.audioPaths.forEach(file => args.push("-i", file));
    const labels = input.audioPaths.map((_, index) => `[${index + 1}:a]volume=${index === 0 ? 1 : 0.22}[a${index}]`);
    const mix = input.audioPaths.map((_, index) => `[a${index}]`).join("") + `amix=inputs=${input.audioPaths.length}:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=0:${duration}[audio]`;
    args.push("-filter_complex", labels.concat(mix).join(";"), "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(duration), "-movflags", "+faststart", output);
    await run(process.env.FFMPEG_BIN || "ffmpeg", args, { signal, onLog }); return output;
  }
}
