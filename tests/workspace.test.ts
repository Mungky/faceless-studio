import {test} from "node:test";
import assert from "node:assert/strict";
import {channelPreferencesSchema,defaultChannelPreferences,resolveEpisodeTemplate,scheduledSlotKey} from "../packages/core/src/workspace";

const channel="arthur000000001";
test("channel settings validate distinct local target slots and bounded queues",()=>{
  const base=defaultChannelPreferences(channel);
  assert.equal(channelPreferencesSchema.parse({...base,slots:["12:00","19:00"]}).slots.length,2);
  for(const slots of [["24:00"],["12:00","12:00"],["x"]])assert.equal(channelPreferencesSchema.safeParse({...base,slots}).success,false);
  assert.equal(channelPreferencesSchema.safeParse({...base,queue_limit:0}).success,false);
  assert.equal(channelPreferencesSchema.safeParse({...base,timezone:"not-a-zone"}).success,false);
});
test("episode override uses the requested template without changing channel default",()=>{
  const prefs={...defaultChannelPreferences(channel),default_template_id:"arthur"};
  const templates=[{id:"arthur",channel},{id:"not-yet",channel:"notyet000000001"}];
  assert.equal(resolveEpisodeTemplate(channel,prefs,templates).id,"arthur");
  assert.equal(resolveEpisodeTemplate(channel,prefs,templates,"not-yet").id,"not-yet");
  assert.equal(prefs.default_template_id,"arthur");
  assert.throws(()=>resolveEpisodeTemplate(channel,prefs,templates,"missing"),/template/i);
});
test("a channel without a default only falls back to its own template",()=>{
  const prefs=defaultChannelPreferences(channel);
  assert.throws(()=>resolveEpisodeTemplate(channel,prefs,[{id:"other",channel:"notyet000000001"}]),/template/i);
  assert.equal(resolveEpisodeTemplate(channel,prefs,[{id:"own",channel}]).id,"own");
});
test("production deduplication is channel and local target specific",()=>{
  assert.notEqual(scheduledSlotKey(channel,"2026-10-31","12:00"),scheduledSlotKey(channel,"2026-10-31","19:00"));
  assert.notEqual(scheduledSlotKey(channel,"2026-10-31","12:00"),scheduledSlotKey("notyet000000001","2026-10-31","12:00"));
  assert.equal(scheduledSlotKey(channel,"2026-10-31","12:00"),scheduledSlotKey(channel,"2026-10-31","12:00"));
});
