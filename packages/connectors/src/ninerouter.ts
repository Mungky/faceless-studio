export class NineRouterConnector {
  constructor(private url = process.env.NINEROUTER_URL || "", private key = process.env.NINEROUTER_API_KEY || "") {}
  private endpoint(suffix: string) { if (!this.url) throw new Error("9Router is not connected. Set NINEROUTER_URL."); return this.url.replace(/\/$/, "") + suffix; }
  async models() {
    const response = await fetch(this.endpoint("/models"), { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`9Router connection failed (${response.status})`);
    const result = await response.json() as { data: { id: string }[] };
    return result.data.map(model => model.id);
  }
  async complete(model: string, system: string, input: string, maxTokens: number) {
    const response = await fetch(this.endpoint("/chat/completions"), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: input }], max_tokens: maxTokens, stream: false }), signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw new Error(`9Router generation failed (${response.status}). This request was not retried.`);
    const result = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: unknown };
    const text = result.choices?.[0]?.message?.content;
    if (!text) throw new Error("9Router returned an empty completion");
    return { text, usage: result.usage };
  }
}
