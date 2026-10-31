import {lookup} from "node:dns/promises";
import {isIP} from "node:net";

function privateHost(host:string){
  const value=host.toLowerCase().replace(/^\[|\]$/g,"");
  if(value==="localhost"||value.endsWith(".localhost")||value.endsWith(".local")||!value.includes("."))return true;
  if(value.includes(":"))return /^(::|fc|fd|fe[89ab])/i.test(value)||value.includes("ffff:");
  if(isIP(value)){const [a,b]=value.split(".").map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
  return false;
}
export function publicSourceUrl(value:string){const url=new URL(value);if(!["http:","https:"].includes(url.protocol)||url.username||url.password||privateHost(url.hostname))throw new Error("Use a public HTTP or HTTPS source URL.");return url;}
export interface SearchResult {title:string;url:string;summary:string;thumbnail:string;source:string;views:null;}
async function bounded(response:Response){if(!response.ok)throw new Error("Research service returned HTTP "+response.status);const reader=response.body?.getReader();if(!reader)throw new Error("Empty research response");let size=0;const chunks:Uint8Array[]=[];while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>2_000_000){await reader.cancel();throw new Error("Research response exceeds 2 MB");}chunks.push(item.value);}return Buffer.concat(chunks).toString("utf8");}
export class SearchConnector {
  constructor(private endpoint=process.env.SEARXNG_URL||"",private token=process.env.SEARXNG_API_KEY||""){}
  async search(query:string):Promise<SearchResult[]>{
    if(!this.endpoint)throw new Error("Hubungkan SearXNG di server terlebih dahulu.");
    const url=new URL("search",this.endpoint.replace(/\/search\/?$/,"").replace(/\/?$/,"/"));url.search=new URLSearchParams({q:query.slice(0,1000),format:"json",safesearch:"0"}).toString();
    const response=await fetch(url,{signal:AbortSignal.timeout(25_000),redirect:"error",...(this.token?{headers:{Authorization:"Bearer "+this.token}}:{})});const payload=JSON.parse(await bounded(response)) as {results?:Record<string,unknown>[]};
    return (payload.results||[]).slice(0,30).flatMap(item=>{try{const source=publicSourceUrl(String(item.url));return [{title:String(item.title||source.hostname).slice(0,300),url:source.href,summary:String(item.content||"").slice(0,4000),thumbnail:"",source:"SearXNG · "+source.hostname,views:null}];}catch{return [];}});
  }
}
// The browser bridge is an explicitly configured Streamable HTTP MCP server.
// Tool discovery verifies the bridge contract instead of guessing a browser REST API.
export class ObscuraConnector {
  constructor(private endpoint=process.env.OBSCURA_MCP_URL||"",private token=process.env.OBSCURA_API_KEY||""){}
  private async open(){
    if(!this.endpoint)throw new Error("Hubungkan Obscura MCP di server terlebih dahulu.");
    let session="",id=0;
    const rpc=async(method:string,params:unknown,notification=false):Promise<any>=>{
      const response=await fetch(this.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream",...(this.token?{Authorization:"Bearer "+this.token}:{}),...(session?{"Mcp-Session-Id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",...(notification?{}:{id:++id}),method,params}),signal:AbortSignal.timeout(45_000),redirect:"error"});
      session=response.headers.get("mcp-session-id")||session;if(notification){await response.body?.cancel().catch(()=>undefined);return null;}
      const body=await bounded(response);const messages=response.headers.get("content-type")?.includes("text/event-stream")?body.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>JSON.parse(line.slice(5))):[JSON.parse(body)];
      const message=messages.find(m=>m.id===id)||messages.at(-1);if(message?.error)throw new Error(String(message.error.message));return message?.result;
    };
    await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"faceless-studio",version:"1.0"}});
    await rpc("notifications/initialized",{},true);
    return rpc;
  }
  // Lists the advertised MCP tools; proves the bridge answers without reading any page.
  async tools(){const rpc=await this.open();const listed=await rpc("tools/list",{});return (listed?.tools||[]).map((t:any)=>String(t.name));}
  async read(value:string){
    const url=publicSourceUrl(value);const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(a=>privateHost(a.address)))throw new Error("Browser sources must resolve to public addresses.");
    const rpc=await this.open();
    const listed=await rpc("tools/list",{});const names=new Set<string>((listed?.tools||[]).map((t:any)=>String(t.name)));
    const custom=process.env.OBSCURA_READ_TOOL;let output:any;
    if(!custom&&names.has("browser_navigate")&&names.has("browser_markdown")){
      // Stateful browser MCP: load the page, then read it back as text.
      const nav=await rpc("tools/call",{name:"browser_navigate",arguments:{url:url.href,waitUntil:"domcontentloaded"}});
      if(nav?.isError)throw new Error("Obscura could not open this public source.");
      output=await rpc("tools/call",{name:"browser_markdown",arguments:{max_chars:80000}});
    }else{
      const tool=listed?.tools?.find((t:any)=>t.name===(custom||"browse_page"));
      if(!tool?.inputSchema?.properties?.url)throw new Error("Obscura bridge needs a URL reading tool. Set OBSCURA_READ_TOOL to the advertised MCP tool name.");
      output=await rpc("tools/call",{name:tool.name,arguments:{url:url.href,...(tool.inputSchema.properties.format?{format:"markdown"}:{})}});
    }
    if(output?.isError)throw new Error("Obscura could not read this public source.");
    const content=(output?.content||[]).filter((c:any)=>c.type==="text").map((c:any)=>String(c.text)).join("\n").slice(0,80_000);if(!content)throw new Error("Obscura returned no source text.");
    return {url:url.href,content,source:"Obscura",observed_at:new Date().toISOString()};
  }
}
