import {test} from "node:test";
import assert from "node:assert/strict";
import {dueProductionSlots} from "../packages/core/src/scheduler";
import {boundedResearchDirection,assertAutomaticQuote,resolveProductionEntry} from "../packages/core/src/scheduler";
import {defaultChannelPreferences} from "../packages/core/src/workspace";
test("schedule resolves several WIB slots across UTC midnight and limits backlog",()=>{
  const prefs={...defaultChannelPreferences("arthur000000001"),research_enabled:true,slots:["06:00","19:00"],lead_hours:24,queue_limit:4};
  const rows=dueProductionSlots(prefs,new Date("2026-10-30T23:30:00Z"),1);
  assert.deepEqual(rows.map(r=>r.target_at),["2026-10-31T12:00:00.000Z","2026-10-31T23:00:00.000Z"]);assert.equal(new Set(rows.map(r=>r.key)).size,2);
  assert.equal(dueProductionSlots(prefs,new Date("2026-10-30T23:30:00Z"),4).length,0);
});
test("research must be enabled and repeated ticks generate stable keys",()=>{
  const prefs=defaultChannelPreferences("arthur000000001"),now=new Date("2026-10-31T00:00:00Z");assert.deepEqual(dueProductionSlots(prefs,now,0),[]);
  const on={...prefs,research_enabled:true};assert.equal(dueProductionSlots(on,now,0)[0].key,dueProductionSlots(on,now,0)[0].key);
});
test("scheduled source direction stays under message limits and retains actual source URLs",()=>{
  const refs=Array.from({length:30},(_,i)=>({title:"Source "+i,url:"https://example.com/video/"+i,summary:"x".repeat(4000)}));const text=boundedResearchDirection("2026-10-31",refs);assert.ok(text.length<20000);assert.match(text,/https:\/\/example.com\/video\/0/);
});
test("automatic approval checks the actual quote billing snapshot, including zero-priced paid routes",()=>{
  for(const billing of ["paid",undefined])assert.throws(()=>assertAutomaticQuote({provider:"ninerouter",currency:"USD",est_cost:0,payload:{billing}}));assert.doesNotThrow(()=>assertAutomaticQuote({provider:"ninerouter",currency:"USD",est_cost:0,payload:{billing:"free"}}));assert.throws(()=>assertAutomaticQuote({provider:"ninerouter",currency:"USD",est_cost:1,payload:{billing:"free"}}));
});
test("automatic research fills a missing title and brief from the channel niche",()=>{
  const prefs={...defaultChannelPreferences("arthur000000001"),niche:"Cerita fabel pendek",timezone:"Asia/Jakarta"};
  const entry=resolveProductionEntry({entry_mode:"research"},prefs,new Date("2026-10-31T12:00:00Z"));
  assert.match(entry.title,/^Riset · /);assert.match(entry.title,/19\.00/);assert.equal(entry.content,"Cerita fabel pendek");
});
test("automatic research keeps what the owner typed and falls back when the niche is empty",()=>{
  const prefs={...defaultChannelPreferences("arthur000000001"),niche:"",timezone:"Asia/Jakarta"};
  assert.deepEqual(resolveProductionEntry({entry_mode:"research",title:"  Judul saya  ",content:"Arahan  saya\n"},prefs,new Date("2026-10-31T12:00:00Z")),{title:"Judul saya",content:"Arahan  saya\n"});
  const empty=resolveProductionEntry({entry_mode:"research",title:" ",content:" "},prefs,new Date("2026-10-31T12:00:00Z"));
  assert.ok(empty.content.length>20);assert.ok(empty.title.startsWith("Riset"));
});
test("idea and script entries still need a title and text, and the script is kept exactly",()=>{
  const prefs=defaultChannelPreferences("arthur000000001"),now=new Date("2026-10-31T12:00:00Z");
  for(const entry_mode of ["idea","script"] as const){
    assert.throws(()=>resolveProductionEntry({entry_mode,title:"",content:"isi"},prefs,now),/judul/i);
    assert.throws(()=>resolveProductionEntry({entry_mode,title:"Judul",content:"  "},prefs,now),/isi|naskah|ide/i);
  }
  assert.equal(resolveProductionEntry({entry_mode:"script",title:"Judul",content:"Baris 1.  \n\nBaris 2."},prefs,now).content,"Baris 1.  \n\nBaris 2.");
});
