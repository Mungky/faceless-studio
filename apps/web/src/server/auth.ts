import "server-only";
import { timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./pocketbase";

export const sessionCookie = "studio_session";
export function secretMatches(actual: string, expected: string | undefined) {
  if (!expected || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL || "http://127.0.0.1:3100").origin) throw new Error("Request origin is not allowed");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Cross-site requests are not allowed");
}
export async function authenticate(request: NextRequest) {
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return null;
  try {
    const response = await fetch(`${db.url}/api/collections/studio_users/auth-refresh`, { method: "POST", headers: { Authorization: token }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) return null;
    const result = await response.json() as { record: { id: string; email: string } };
    return result.record;
  } catch { return null; }
}
function encryptionKey() {
  const key = process.env.OAUTH_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("Set OAUTH_ENCRYPTION_KEY to a random 32-byte hex key.");
  return Buffer.from(key, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), payload.toString("hex")].join(":");
}
export function decrypt<T>(text: string): T {
  const [iv, tag, payload] = text.split(":");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "hex")); decipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, "hex")), decipher.final()]).toString()) as T;
}
