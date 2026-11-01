import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const envFile = path.join(repoRoot, ".env");
const env = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "")
    .split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const targetUrl = new URL(process.env.DSH_URL || env.DSH_URL || "http://127.0.0.1:3080");
const port = Number(process.env.DSH_PROXY_PORT || env.DSH_PROXY_PORT || 3082);
const target = { host: targetUrl.hostname, port: Number(targetUrl.port || 3080) };
const theme = () => readFileSync(path.join(here, "dsh-theme.css"), "utf8");

const cookieTarget = "dsh-session-" + createHash("sha256").update(target.host + ":" + target.port).digest("base64url");
const cookieProxy = "dsh-session-" + createHash("sha256").update("127.0.0.1:" + port).digest("base64url");

const boot = `<script>try{localStorage.setItem("DSH_THEME","dark")}catch(e){}</script><link rel="stylesheet" href="/__studio/theme.css">`;

function rewriteHeaders(headers, origin) {
  const out = { ...headers };
  delete out["x-frame-options"];
  if (out["content-security-policy"]) {
    out["content-security-policy"] = String(out["content-security-policy"])
      .replace(/frame-ancestors[^;]*;?/i, "")
      .replace(/frame-src[^;]*;?/i, "");
  }
  if (out["set-cookie"]) {
    const cookies = [].concat(out["set-cookie"]);
    const rewritten = [];
    for (const c of cookies) {
      const clean = c
        .replace(/;\s*Domain=[^;]*/i, "")
        .replace(/;\s*Secure/i, "")
        .replace(/;\s*SameSite=Strict/i, "; SameSite=None");
      rewritten.push(clean);
      if (clean.startsWith(cookieTarget + "=")) {
        rewritten.push(clean.replace(cookieTarget, cookieProxy));
      }
    }
    out["set-cookie"] = rewritten;
  }
  if (out.location) out.location = String(out.location).replace(targetUrl.origin, origin);
  return out;
}

const server = http.createServer((req, res) => {
  if (req.url === "/__studio/theme.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
    res.end(theme());
    return;
  }

  const origin = "http://" + (req.headers.host || "127.0.0.1:" + port);
  const headers = { ...req.headers, host: targetUrl.host };
  if (headers.origin) headers.origin = targetUrl.origin;
  if (headers.referer) headers.referer = String(headers.referer).replace(origin, targetUrl.origin);

  if (headers.cookie && headers.cookie.includes(cookieProxy) && !headers.cookie.includes(cookieTarget)) {
    const val = headers.cookie.split(";").find(s => s.trim().startsWith(cookieProxy + "="));
    if (val) {
      headers.cookie = headers.cookie + "; " + val.trim().replace(cookieProxy, cookieTarget);
    }
  }

  const upstream = http.request({ ...target, method: req.method, path: req.url, headers }, up => {
    const outHeaders = rewriteHeaders(up.headers, origin);
    const type = String(up.headers["content-type"] || "");
    const html = type.includes("text/html");

    if (!html) {
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
      return;
    }

    const encoding = String(up.headers["content-encoding"] || "");
    const unpack = { gzip: zlib.createGunzip, br: zlib.createBrotliDecompress, deflate: zlib.createInflate }[encoding];
    const source = unpack ? up.pipe(unpack()) : up;
    delete outHeaders["content-encoding"];
    const chunks = [];
    source.on("error", () => res.destroy());
    source.on("data", c => chunks.push(c));
    source.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const injected = raw.includes("</head>")
        ? raw.replace("</head>", boot + "</head>")
        : raw + boot;
      outHeaders["content-length"] = Buffer.byteLength(injected);
      res.writeHead(up.statusCode || 200, outHeaders);
      res.end(injected);
    });
  });

  upstream.on("error", err => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Proxy error: " + err.message);
  });

  req.pipe(upstream);
});

server.on("upgrade", (req, clientSocket, head) => {
  const headers = [
    `${req.method} ${req.url} HTTP/${req.httpVersion}`,
    ...Object.entries(req.headers)
      .filter(([k]) => k.toLowerCase() !== "host")
      .map(([k, v]) => `${k}: ${v}`),
    `Host: ${target.host}:${target.port}`,
    "\r\n"
  ].join("\r\n");

  const upstreamSocket = net.connect(target.port, target.host, () => {
    upstreamSocket.write(headers);
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstreamSocket.destroy());
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[dsh-proxy] Studio DSH Proxy ready at http://127.0.0.1:${port} -> ${targetUrl.href}`);
});
