import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {SearchConnector,ObscuraConnector,publicSourceUrl} from "../packages/connectors/src/research";
test("research rejects nonpublic addresses and unsafe navigation schemes",()=>{
  for(const value of ["file:///etc/passwd","http://127.0.0.1/admin","http://10.0.0.1/","http://[::1]/","https://example.com@localhost/"])assert.throws(()=>publicSourceUrl(value));
  assert.equal(publicSourceUrl("https://www.youtube.com/shorts/abcdefghijk").hostname,"www.youtube.com");
});
test("SearXNG uses documented JSON search and never invents performance",async t=>{
  let seen:URL|undefined;
  mock.method(globalThis,"fetch",async(input:any)=>{seen=new URL(String(input));return new Response(JSON.stringify({results:[{title:"A real result",url:"https://www.youtube.com/watch?v=abcdefghijk",content:"Source summary"}]}),{headers:{"Content-Type":"application/json"}});});t.after(()=>mock.restoreAll());
  const rows=await new SearchConnector("http://search.internal:8080").search("fables");
  assert.equal(seen?.pathname,"/search");assert.equal(seen?.searchParams.get("format"),"json");assert.equal(rows[0].title,"A real result");assert.equal(rows[0].views,null);
});
test("missing research connections fail without network traffic",async t=>{
  let calls=0;mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("Unexpected request");});t.after(()=>mock.restoreAll());
  await assert.rejects(new SearchConnector("").search("topic"),/SearXNG/i);
  await assert.rejects(new ObscuraConnector("").read("https://example.com"),/Obscura/i);assert.equal(calls,0);
});
