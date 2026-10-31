import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,n){return s==="server-only"?{url:new URL("./server-only-fixture.cjs",import.meta.url).href,shortCircuit:true}:n(s,c);}});
test("provider keys stay encrypted in private records and are sent only to their configured connector",async t=>{
  const previous={key:process.env.OAUTH_ENCRYPTION_KEY,url:process.env.NINEROUTER_URL};process.env.OAUTH_ENCRYPTION_KEY="a".repeat(64);process.env.NINEROUTER_URL="http://router.fixture/v1";const {db}=await import("../apps/web/src/server/pocketbase");let stored:any;
  mock.method(db,"custom",async(_name:string,body:any)=>{stored=body;return body;});mock.method(db,"list",async()=>stored?[stored]:[]);mock.method(globalThis,"fetch",async(_url:any,init:any)=>{assert.equal(init.headers.Authorization,"Bearer fixture-key-only");return new Response(JSON.stringify({data:[{id:"fixture-model"}]}));});t.after(()=>{mock.restoreAll();if(previous.key===undefined)delete process.env.OAUTH_ENCRYPTION_KEY;else process.env.OAUTH_ENCRYPTION_KEY=previous.key;if(previous.url===undefined)delete process.env.NINEROUTER_URL;else process.env.NINEROUTER_URL=previous.url;});
  const api=await import("../apps/web/src/server/provider-credentials");assert.deepEqual(await api.saveProviderKey({provider:"ninerouter",key:"fixture-key-only"}),{saved:true});assert.equal(stored.kind,"service-key");assert.ok(!JSON.stringify(stored).includes("fixture-key-only"));assert.deepEqual(await (await api.routerConnector()).models(),["fixture-model"]);
});

test("service addresses saved in the app override the environment and reject unsafe forms",async t=>{
  const previous={key:process.env.OAUTH_ENCRYPTION_KEY,url:process.env.SEARXNG_URL};process.env.OAUTH_ENCRYPTION_KEY="a".repeat(64);process.env.SEARXNG_URL="http://env.fixture";
  const {db}=await import("../apps/web/src/server/pocketbase");const rows:any[]=[];
  mock.method(db,"custom",async(_n:string,body:any)=>{rows.splice(0,rows.length,...rows.filter(r=>r.key!==body.key),body);return body;});
  mock.method(db,"list",async(_n:string,filter:string)=>rows.filter(r=>filter.includes(r.key)));
  t.after(()=>{mock.restoreAll();for(const [k,v] of [["OAUTH_ENCRYPTION_KEY",previous.key],["SEARXNG_URL",previous.url]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const api=await import("../apps/web/src/server/provider-credentials");
  assert.equal(api.parseServiceUrl(" http://search.fixture:8080/ "),"http://search.fixture:8080");
  assert.throws(()=>api.parseServiceUrl("ftp://x"),/http/);assert.throws(()=>api.parseServiceUrl("http://user:pw@x"),/kata sandi/);
  assert.equal(await api.serviceUrl("searxng"),"http://env.fixture");
  const saved:any=await api.saveServiceConnection({provider:"searxng",url:"http://search.fixture:8080",key:"fixture-secret"});
  assert.equal(saved.searxng.url,"http://search.fixture:8080");assert.equal(saved.searxng.url_source,"app");assert.equal(saved.searxng.has_key,true);assert.ok(!JSON.stringify(saved).includes("fixture-secret"));
  await api.saveServiceConnection({provider:"searxng",url:""});assert.equal(await api.serviceUrl("searxng"),"http://env.fixture");
});
