import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,n){return s==="server-only"?{url:new URL("./server-only-fixture.cjs",import.meta.url).href,shortCircuit:true}:n(s,c);}});

const idA="aaaaaaaaaaaaaaa",idB="bbbbbbbbbbbbbbb";
async function fixture(t:{after:(fn:()=>void)=>void}){
  const {db}=await import("../apps/web/src/server/pocketbase");
  const rows:Record<string,any>={[idA]:{id:idA,asset_group:"",tags:["hero"]},[idB]:{id:idB,asset_group:"Intro",tags:null}};
  const updates:Array<{id:string;body:any}>=[];
  mock.method(db,"get",async(_name:string,id:string)=>rows[id]);
  mock.method(db,"update",async(_name:string,id:string,body:any)=>{updates.push({id,body});rows[id]={...rows[id],...body};return rows[id];});
  t.after(()=>mock.restoreAll());
  return {updates,rows,api:await import("../apps/web/src/server/assets")};
}
test("bulk organize sets a group and merges tags without losing existing ones",async t=>{
  const {api,updates,rows}=await fixture(t);
  const result=await api.organizeAssets({ids:[idA,idB],asset_group:"Outro",add_tags:["b-roll"],remove_tags:[]});
  assert.equal(result.length,2);
  assert.deepEqual(rows[idA].tags,["hero","b-roll"]);
  assert.deepEqual(rows[idB].tags,["b-roll"]);
  assert.equal(rows[idA].asset_group,"Outro");
  assert.equal(updates.length,2);
});
test("bulk organize removes tags and keeps the group when none is given",async t=>{
  const {api,rows}=await fixture(t);
  await api.organizeAssets({ids:[idA,idB],remove_tags:["hero"]});
  assert.deepEqual(rows[idA].tags,[]);
  assert.equal(rows[idB].asset_group,"Intro");
});
test("an organize request never leaves an asset with more than twelve tags",async t=>{
  const {api,updates}=await fixture(t);
  await assert.rejects(api.organizeAssets({ids:[idA],add_tags:Array.from({length:12},(_,i)=>"t"+i)}),/12/);
  assert.equal(updates.length,0);
});
test("single update only writes the fields that were sent",async t=>{
  const {api,updates}=await fixture(t);
  await api.updateAsset(idA,{asset_group:"Intro"});
  assert.deepEqual(updates[0].body,{asset_group:"Intro"});
  await api.updateAsset(idA,{selected:false,tags:["Hero","hero","Cut"]});
  assert.deepEqual(updates[1].body,{selected:false,tags:["hero","cut"]});
});
