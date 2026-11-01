import {test} from "node:test";
import assert from "node:assert/strict";
import {assetOrganizeSchema,filterAssets,groupAssets,normalizeAssetTags,type LibraryAsset} from "../packages/core/src/assets";

const asset=(id:string,patch:Partial<LibraryAsset>={}):LibraryAsset=>({id,kind:"image",episode:"ep1",channel:"arthur000000001",drive_path:"Faceless/Arthur/ep/stills/"+id+".png",asset_group:"",tags:[],created:"2026-10-31 10:00:00.000Z",...patch});

test("tags are trimmed, lowercased, de-duplicated and bounded",()=>{
  assert.deepEqual(normalizeAssetTags([" Hero ","hero","B-Roll","  "]),["hero","b-roll"]);
  assert.equal(normalizeAssetTags(Array.from({length:30},(_,i)=>"t"+i)).length,12);
  assert.throws(()=>normalizeAssetTags(["x".repeat(41)]),/tag/i);
});
test("organize input accepts a bounded group and tags, and needs at least one change",()=>{
  const parsed=assetOrganizeSchema.parse({ids:["aaaaaaaaaaaaaaa"],asset_group:"  Intro  ",add_tags:["Hero"]});
  assert.equal(parsed.asset_group,"Intro");
  assert.deepEqual(parsed.add_tags,["hero"]);
  assert.equal(assetOrganizeSchema.safeParse({ids:["aaaaaaaaaaaaaaa"]}).success,false);
  assert.equal(assetOrganizeSchema.safeParse({ids:[],asset_group:"x"}).success,false);
  assert.equal(assetOrganizeSchema.safeParse({ids:["not-an-id"],asset_group:"x"}).success,false);
  assert.equal(assetOrganizeSchema.safeParse({ids:["aaaaaaaaaaaaaaa"],asset_group:"x".repeat(81)}).success,false);
});
test("filters combine owner channel, kind, group, tag and filename search",()=>{
  const list=[asset("a1",{asset_group:"Intro",tags:["hero"]}),asset("a2",{kind:"vo",channel:"notyet000000001"}),asset("a3",{kind:"video",asset_group:"Outro",tags:["hero","b-roll"]})];
  assert.deepEqual(filterAssets(list,{channel:"arthur000000001"}).map(a=>a.id),["a1","a3"]);
  assert.deepEqual(filterAssets(list,{kind:"vo"}).map(a=>a.id),["a2"]);
  assert.deepEqual(filterAssets(list,{tag:"b-roll"}).map(a=>a.id),["a3"]);
  assert.deepEqual(filterAssets(list,{group:"Intro"}).map(a=>a.id),["a1"]);
  assert.deepEqual(filterAssets(list,{group:"__none__"}).map(a=>a.id),["a2"]);
  assert.deepEqual(filterAssets(list,{search:"A3"}).map(a=>a.id),["a3"]);
  assert.equal(filterAssets(list,{}).length,3);
});
test("grouping by group puts ungrouped assets last and keeps the newest first inside a group",()=>{
  const list=[asset("a1",{asset_group:"Outro",created:"2026-10-31 09:00:00.000Z"}),asset("a2"),asset("a3",{asset_group:"Intro"}),asset("a4",{asset_group:"Outro",created:"2026-10-31 11:00:00.000Z"})];
  const groups=groupAssets(list,"group");
  assert.deepEqual(groups.map(g=>g.label),["Intro","Outro","Tanpa grup"]);
  assert.deepEqual(groups[1].items.map(a=>a.id),["a4","a1"]);
});
test("grouping by owner uses the channel id and none keeps one flat list",()=>{
  const list=[asset("a1"),asset("a2",{channel:"notyet000000001"})];
  assert.deepEqual(groupAssets(list,"channel").map(g=>g.key).sort(),["arthur000000001","notyet000000001"]);
  const flat=groupAssets(list,"none");
  assert.equal(flat.length,1);
  assert.equal(flat[0].items.length,2);
});
