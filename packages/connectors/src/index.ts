export * from "./process";
export * from "./drive";
export * from "./ninerouter";
export * from "./elevenlabs";
export * from "./acestep";
export * from "./flow";
export * from "./youtube";

export async function jsonFetch<T>(url: string | URL, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Provider request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return await response.json() as T;
}
