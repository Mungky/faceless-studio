// Serves the owner's n8n editor on a local origin so Studio can show it in its Workflow page.
// It forwards every request (and the editor's websocket) to N8N_URL, drops the header that forbids
// framing, keeps the login cookie working over local HTTP, and adds Studio's theme to the HTML.
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const here=path.dirname(fileURLToPath(import.meta.url));
const envFile=path.join(here,"..",".env");
const env=Object.fromEntries((existsSync(envFile)?readFileSync(envFile,"utf8"):"").split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).trim().replace(/^"|"$/g,"")];}));
const targetUrl=new URL(process.env.N8N_URL||env.N8N_URL||"");
const port=Number(process.env.N8N_PROXY_PORT||env.N8N_PROXY_PORT||5679);
if(targetUrl.protocol!=="http:")throw new Error("This local proxy forwards to an http:// n8n URL.");
const target={host:targetUrl.hostname,port:Number(targetUrl.port||80)};
const theme=()=>readFileSync(path.join(here,"n8n-theme.css"),"utf8");
// Runs before the editor boots: dark theme, like the rest of Studio.
const boot=`<script>try{localStorage.setItem("N8N_THEME","dark")}catch(e){}</script><link rel="stylesheet" href="/__studio/theme.css">`;

function rewriteHeaders(headers,origin){
  const out={...headers};
  delete out["x-frame-options"];
  if(out["content-security-policy"])out["content-security-policy"]=String(out["content-security-policy"]).replace(/frame-ancestors[^;]*;?/i,"");
  if(out["set-cookie"])out["set-cookie"]=[].concat(out["set-cookie"]).map(c=>c.replace(/;\s*Domain=[^;]*/i,"").replace(/;\s*Secure/i,""));
  if(out.location)out.location=String(out.location).replace(targetUrl.origin,origin);
  return out;
}

const server=http.createServer((req,res)=>{
  if(req.url==="/__studio/theme.css"){res.writeHead(200,{"content-type":"text/css; charset=utf-8","cache-control":"no-store"});res.end(theme());return;}
  const origin="http://"+(req.headers.host||"127.0.0.1:"+port);
  // Keep the browser's compression: the editor's bundles and /types/nodes.json are several MB.
  const headers={...req.headers,host:targetUrl.host};
  if(headers.origin)headers.origin=targetUrl.origin;
  if(headers.referer)headers.referer=String(headers.referer).replace(origin,targetUrl.origin);
  const upstream=http.request({...target,method:req.method,path:req.url,headers},up=>{
    const outHeaders=rewriteHeaders(up.headers,origin);
    // The editor learns its base URLs (REST, push, telemetry) from HTML and JSON; point them here.
    // Only the page and the settings call carry those URLs; they are unpacked, rewritten and sent
    // plain. Everything else, such as /types/nodes.json, passes through still compressed.
    const type=String(up.headers["content-type"]||""),html=type.includes("text/html");
    const rewrite=html||req.url.split("?")[0]==="/rest/settings";
    if(!rewrite){res.writeHead(up.statusCode||502,outHeaders);up.pipe(res);return;}
    const encoding=String(up.headers["content-encoding"]||"");
    const unpack={gzip:zlib.createGunzip,br:zlib.createBrotliDecompress,deflate:zlib.createInflate}[encoding];
    const source=unpack?up.pipe(unpack()):up;delete outHeaders["content-encoding"];
    const chunks=[];source.on("error",()=>res.destroy());source.on("data",c=>chunks.push(c));source.on("end",()=>{
      const local=origin.replace(/^http:\/\//,"");
      let body=Buffer.concat(chunks).toString("utf8").split(targetUrl.origin).join(origin).split("ws://"+targetUrl.host).join("ws://"+local);
      if(html)body=body.replace(/<head>/i,"<head>"+boot);
      delete outHeaders["content-length"];res.writeHead(up.statusCode||200,outHeaders);res.end(body);
    });
  });
  // A dropped connection mid-response (long-lived pushes, a closed tab) only ends that request.
  upstream.on("error",error=>{if(res.headersSent){res.destroy();return;}res.writeHead(502,{"content-type":"text/plain"});res.end("n8n is not reachable: "+error.message);});
  res.on("close",()=>{if(!res.writableFinished)upstream.destroy();});
  req.pipe(upstream);
});

// The editor's live updates use a websocket; pass the upgrade through untouched apart from Host/Origin.
server.on("upgrade",(req,socket,head)=>{
  const upstream=net.connect(target.port,target.host,()=>{
    const lines=[`${req.method} ${req.url} HTTP/1.1`];
    for(const [k,v] of Object.entries({...req.headers,host:targetUrl.host,...(req.headers.origin?{origin:targetUrl.origin}:{})}))lines.push(`${k}: ${v}`);
    upstream.write(lines.join("\r\n")+"\r\n\r\n");if(head?.length)upstream.write(head);
    upstream.pipe(socket);socket.pipe(upstream);
  });
  upstream.on("error",()=>socket.destroy());socket.on("error",()=>upstream.destroy());
});

server.on("clientError",(_error,socket)=>socket.destroy());
process.on("uncaughtException",error=>console.error("proxy error (kept running):",error.message));
server.listen(port,"127.0.0.1",()=>console.log(`n8n editor for Studio: http://127.0.0.1:${port} -> ${targetUrl.origin}`));
