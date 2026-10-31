import "server-only";
import {z} from "@studio/core";
import {NineRouterConnector,ObscuraConnector,SearchConnector} from "@studio/connectors";
import {db,filterValue} from "./pocketbase";
import {encrypt,decrypt} from "./auth";
const providers=["ninerouter","searxng","obscura"] as const;
type Provider=typeof providers[number];
const envUrl:Record<Provider,string>={ninerouter:"NINEROUTER_URL",searxng:"SEARXNG_URL",obscura:"OBSCURA_MCP_URL"};
const envKey:Record<Provider,string>={ninerouter:"NINEROUTER_API_KEY",searxng:"SEARXNG_API_KEY",obscura:"OBSCURA_API_KEY"};
async function key(provider:string){const [row]=await db.list<{data:{ciphertext:string}}>("workspace_records","key="+filterValue("service-key:"+provider));return row?.data.ciphertext?decrypt<{key:string}>(row.data.ciphertext).key:undefined;}
async function storedUrl(provider:Provider){const [row]=await db.list<{data:{url?:string}}>("workspace_records","key="+filterValue("service-url:"+provider));return row?.data.url||"";}
// A service address saved in the app wins over the server environment; clearing it falls back again.
export async function serviceUrl(provider:Provider){return await storedUrl(provider)||process.env[envUrl[provider]]||"";}
export function parseServiceUrl(value:string){const text=value.trim();if(!text)return "";let url:URL;try{url=new URL(text);}catch{throw new Error("Alamat layanan tidak valid. Contoh: http://192.168.1.10:8080");}if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("Gunakan alamat http:// atau https:// tanpa nama pengguna atau kata sandi.");return url.href.replace(/\/$/,"");}
export async function routerConnector(){return new NineRouterConnector(await serviceUrl("ninerouter"),await key("ninerouter")||process.env.NINEROUTER_API_KEY||"");}
export async function browserConnector(){return new ObscuraConnector(await serviceUrl("obscura"),await key("obscura")||process.env.OBSCURA_API_KEY||"");}
export async function searchConnector(){return new SearchConnector(await serviceUrl("searxng"),await key("searxng")||process.env.SEARXNG_API_KEY||"");}
export async function saveProviderKey(input:unknown){const value=z.object({provider:z.enum(providers),key:z.string().min(1).max(2000)}).strict().parse(input);await db.custom("workspace-save",{key:"service-key:"+value.provider,kind:"service-key",channel:"global",data:{ciphertext:encrypt({key:value.key}),updated:new Date().toISOString()}});return {saved:true};}
export async function serviceConnections(){return Object.fromEntries(await Promise.all(providers.map(async p=>{const stored=await storedUrl(p),url=stored||process.env[envUrl[p]]||"";return [p,{url,url_source:stored?"app":url?"server":"none",has_key:!!(await key(p)||process.env[envKey[p]])}];})));}
export async function saveServiceConnection(input:unknown){const value=z.object({provider:z.enum(providers),url:z.string().max(500).optional(),key:z.string().max(2000).optional()}).strict().parse(input);
  if(value.url!==undefined)await db.custom("workspace-save",{key:"service-url:"+value.provider,kind:"service-url",channel:"global",data:{url:parseServiceUrl(value.url),updated:new Date().toISOString()}});
  if(value.key)await saveProviderKey({provider:value.provider,key:value.key});
  return serviceConnections();}
export async function checkService(provider:Provider){
  if(provider==="ninerouter"){const models=await (await routerConnector()).models();return {connected:true,message:"9Router terhubung. "+models.length+" model tersedia.",models};}
  if(provider==="searxng"){const results=await (await searchConnector()).search("test");return {connected:true,message:"Pencarian merespons. "+results.length+" hasil contoh.",models:[] as string[]};}
  if(!await serviceUrl("obscura"))throw new Error("Isi alamat Obscura terlebih dahulu.");
  const tools=await (await browserConnector()).tools();return {connected:true,message:"Obscura terhubung. Alat tersedia: "+(tools.join(", ")||"tidak ada")+".",models:[] as string[]};}
