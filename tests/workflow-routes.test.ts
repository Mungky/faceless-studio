import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {NextRequest} from "next/server";
registerHooks({resolve(s,c,n){return s==="server-only"?{url:new URL("./server-only-fixture.cjs",import.meta.url).href,shortCircuit:true}:n(s,c);}});

test("workflow endpoints reject anonymous reads and cross-origin actions before any provider or database write",async t=>{
  const route=await import("../apps/web/src/app/api/[...path]/route"),{db}=await import("../apps/web/src/server/pocketbase");let calls=0;
  mock.method(db,"create",async()=>{throw new Error("Unauthorized write");});mock.method(db,"update",async()=>{throw new Error("Unauthorized write");});mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("Unauthorized provider");});t.after(()=>mock.restoreAll());
  for(const path of [["workflows"],["workflows","not-yet"],["workflow-runs","run000000000001"]]){const response=await route.GET(new NextRequest("http://127.0.0.1:3100/api/"+path.join("/")),{params:Promise.resolve({path})});assert.equal(response.status,401);}
  for(const path of [["workflows"],["workflow-runs"],["workflow-runs","run000000000001","actions"],["workflow-runs","run000000000001","messages"]]){const response=await route.POST(new NextRequest("http://127.0.0.1:3100/api/"+path.join("/"),{method:"POST",headers:{Origin:"https://untrusted.invalid",Cookie:"studio_session=fixture","Content-Type":"application/json"},body:"{}"}),{params:Promise.resolve({path})});assert.equal(response.status,400);}
  assert.equal(calls,0);
});

test("owner workflow library is read-only and malformed run identifiers fail before database lookup",async t=>{
  const route=await import("../apps/web/src/app/api/[...path]/route"),{db}=await import("../apps/web/src/server/pocketbase");let reads=0;
  mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({record:{id:"owner0000000001",email:"fixture@example.invalid"}})));
  mock.method(db,"list",async(collection:string)=>{reads++;return collection==="channels"?[{id:"arthur000000001",name:"Arthur",playbook_path:""},{id:"notyet000000001",name:"Not Yet",playbook_path:""}]:[];});
  mock.method(db,"create",async()=>{throw new Error("GET must not create data");});mock.method(db,"get",async()=>{throw new Error("Invalid ID must not look up data");});t.after(()=>mock.restoreAll());
  const response=await route.GET(new NextRequest("http://127.0.0.1:3100/api/workflows",{headers:{Cookie:"studio_session=fixture"}}),{params:Promise.resolve({path:["workflows"]})});assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.templates.map((item:any)=>item.id),["arthur","not-yet"]);assert.deepEqual(result.runs,[]);
  const previous=reads,invalid=await route.GET(new NextRequest("http://127.0.0.1:3100/api/workflow-runs/bad",{headers:{Cookie:"studio_session=fixture"}}),{params:Promise.resolve({path:["workflow-runs","bad"]})});assert.equal(invalid.status,400);assert.equal(reads,previous);
});
