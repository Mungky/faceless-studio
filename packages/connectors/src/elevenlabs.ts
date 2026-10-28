import { writeFile } from "node:fs/promises";

export class ElevenLabsConnector {
  constructor(private key = process.env.ELEVENLABS_API_KEY || "") {}
  async voiceover(text: string, voiceId: string, output: string, modelId = "eleven_v3") {
    if (!this.key || !voiceId) throw new Error("Configure ElevenLabs API key and a voice ID before approving voiceover.");
    if (!/^[a-zA-Z0-9_-]+$/.test(voiceId)) throw new Error("Invalid voice ID");
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": this.key },
      body: JSON.stringify({ text, model_id: modelId }), signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw new Error(`ElevenLabs failed (${response.status}). The paid request was not retried.`);
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    return output;
  }
  async check() {
    if (!this.key) return { connected: false, message: "Add your ElevenLabs key to the server environment." };
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": this.key }, signal: AbortSignal.timeout(10_000) });
    return { connected: response.ok, message: response.ok ? "ElevenLabs is connected. No generation credits used." : `ElevenLabs rejected the connection (${response.status}).` };
  }
}
