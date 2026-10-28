import "server-only";

export class DatabaseError extends Error { constructor(public status: number, message: string) { super(message); } }
export class StudioDatabase {
  private token = "";
  private expires = 0;
  private authenticating?: Promise<void>;
  constructor(public readonly url = process.env.POCKETBASE_URL || "http://127.0.0.1:8095") {}
  private async authenticate() {
    if (this.token && this.expires > Date.now()) return;
    if (!this.authenticating) this.authenticating = (async () => {
      const response = await fetch(`${this.url}/api/collections/_superusers/auth-with-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (!response.ok) throw new DatabaseError(503, "PocketBase admin connection failed. Check the server environment and migrations.");
      const auth = await response.json() as { token: string }; this.token = auth.token; this.expires = Date.now() + 20 * 60_000;
    })().finally(() => { this.authenticating = undefined; });
    return this.authenticating;
  }
  async request<T>(route: string, init: RequestInit = {}): Promise<T> {
    await this.authenticate();
    const response = await fetch(this.url + route, { ...init, headers: { "Content-Type": "application/json", Authorization: this.token, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(30_000), cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.expires = 0;
      const error = await response.json().catch(() => ({})) as { message?: string; data?: unknown };
      throw new DatabaseError(response.status, error.message || "PocketBase request failed");
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
  async list<T>(collection: string, filter = "", sort = "-created", limit = 500): Promise<T[]> {
    const items: T[] = []; let page = 1;
    while (items.length < limit) {
      const query = new URLSearchParams({ filter, sort, perPage: String(Math.min(100, limit - items.length)), page: String(page) });
      const result = await this.request<{ items: T[]; totalPages: number }>(`/api/collections/${collection}/records?${query}`);
      items.push(...result.items); if (page++ >= result.totalPages) break;
    }
    return items;
  }
  get<T>(collection: string, id: string) { return this.request<T>(`/api/collections/${collection}/records/${encodeURIComponent(id)}`); }
  create<T>(collection: string, body: unknown) { return this.request<T>(`/api/collections/${collection}/records`, { method: "POST", body: JSON.stringify(body) }); }
  update<T>(collection: string, id: string, body: unknown) { return this.request<T>(`/api/collections/${collection}/records/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }); }
  custom<T>(route: string, body: unknown) { return this.request<T>(`/api/studio/${route}`, { method: "POST", body: JSON.stringify(body) }); }
}
export const db = new StudioDatabase();
export function filterValue(value: string) { return JSON.stringify(value); }
