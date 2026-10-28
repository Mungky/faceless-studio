import { requireCappedFlow } from "./flow-runtime";
export { requireCappedFlow, FLOW_BLOCK_REASON, FLOW_MAX_ATTEMPTS } from "./flow-runtime";

export class FlowConnector {
  async status(signal?: AbortSignal) {
    const port = Number(process.env.FLOW_BRIDGE_PORT || 8791);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Set a valid FLOW_BRIDGE_PORT.");
    // Inspect an existing bridge only; starting a daemon can reclaim old jobs.
    const response = await fetch(`http://127.0.0.1:${port}/status?site=flow`, { signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new Error("Flow bridge status is unavailable.");
    return response.json() as Promise<{ loggedIn?: boolean; duplicateInstalls?: boolean; extensionConnected?: boolean; grokVisible?: boolean; warning?: string; lastWarning?: string }>;
  }
  async generate(_input: { kind: "image" | "video"; prompt: string; model: string; aspectRatio: string; jobId: string; reference?: string }, _signal: AbortSignal): Promise<string> {
    requireCappedFlow();
  }
}
