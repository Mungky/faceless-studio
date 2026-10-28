import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@studio/core", "@studio/connectors"],
  outputFileTracingExcludes: { "/*": ["../../.env", "../../.env.*", "../../.runtime/**/*", "../../.cache/**/*", "../../.impeccable/**/*", "../../docs/**/*"] },
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "X-Frame-Options", value: "DENY" }, { key: "Referrer-Policy", value: "same-origin" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }] }]; }
};
export default config;
