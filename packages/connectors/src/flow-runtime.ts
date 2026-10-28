export const FLOW_BLOCK_REASON = "Automatic Flow generation is unavailable: the installed connector does not expose a verified retry limit or protection against reconnect replay. Generate in Flow and import the result, or select a configured alternative provider. No generation was submitted.";
export const FLOW_MAX_ATTEMPTS = 2; // Required policy if a verified implementation becomes available.

export function requireCappedFlow(_status?: unknown): never {
  // The bridge's maxRetries is queue metadata, stripped before reaching the
  // closed-source extension. It cannot enforce a generation-attempt cap.
  throw new Error(FLOW_BLOCK_REASON);
}
