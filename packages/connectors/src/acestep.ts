import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export class ACEStepConnector {
  constructor(private base = process.env.ACESTEP_URL || "http://127.0.0.1:8001", private key = process.env.ACESTEP_API_KEY || "") {}
  async music(input: { prompt: string; lyrics: string; seconds: number; seed: number }, output: string, signal: AbortSignal, onLog: (text: string) => void) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` };
    const released = await fetch(`${this.base}/release_task`, { method: "POST", headers, body: JSON.stringify({ prompt: input.prompt, lyrics: input.lyrics, audio_duration: Math.max(10, input.seconds), seed: input.seed, use_random_seed: false, thinking: false, batch_size: 1, audio_format: "wav" }), signal });
    if (!released.ok) throw new Error(`ACE-Step submission failed (${released.status})`);
    const job = await released.json() as { data: { task_id: string } };
    if (!job.data?.task_id) throw new Error("ACE-Step did not return a task ID");
    onLog(`ACE-Step task ${job.data.task_id} submitted.\n`);
    for (let attempt = 0; attempt < 240; attempt++) {
      await delay(5000, undefined, { signal });
      const response = await fetch(`${this.base}/query_result`, { method: "POST", headers, body: JSON.stringify({ task_id_list: [job.data.task_id] }), signal });
      if (!response.ok) throw new Error(`ACE-Step status request failed (${response.status})`);
      const result = await response.json() as { data: { status: number; result: string | { file?: string; audio_url?: string }[] }[] };
      const item = result.data?.[0];
      if (item?.status === 2) throw new Error("ACE-Step generation failed");
      if (item?.status !== 1) continue;
      const files = typeof item.result === "string" ? JSON.parse(item.result) as { file?: string; audio_url?: string }[] : item.result;
      const location = files?.[0]?.audio_url || files?.[0]?.file;
      if (!location) throw new Error("ACE-Step returned no audio file");
      const url = new URL(location.startsWith("/v1/audio") ? location : `/v1/audio?path=${encodeURIComponent(location)}`, this.base);
      if (url.origin !== new URL(this.base).origin) throw new Error("ACE-Step returned an unexpected audio host");
      const audio = await fetch(url, { headers, signal });
      if (!audio.ok) throw new Error("Could not download ACE-Step audio");
      await writeFile(output, Buffer.from(await audio.arrayBuffer()));
      return output;
    }
    throw new Error("ACE-Step timed out after 20 minutes; the task was not resubmitted");
  }
}
