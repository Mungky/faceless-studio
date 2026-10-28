import {test} from "node:test";
import assert from "node:assert/strict";
import {productionTimeline,sceneAt} from "../packages/core/src/production-timeline";
test("production timeline uses saved durations and half-open scene boundaries",()=>{
  const timeline=productionTimeline([{index:1,seconds:1.5},{index:2,seconds:2.5},{index:3,seconds:1}]);
  assert.deepEqual(timeline,[{index:1,start:0,end:1.5},{index:2,start:1.5,end:4},{index:3,start:4,end:5}]);
  assert.equal(sceneAt(timeline,1.499)?.index,1);assert.equal(sceneAt(timeline,1.5)?.index,2);assert.equal(sceneAt(timeline,5)?.index,3);assert.equal(sceneAt(timeline,100)?.index,3);assert.equal(sceneAt(timeline,-1)?.index,1);assert.equal(sceneAt([],0),null);
});
test("timeline rejects invalid durations and sequence rather than inventing timing",()=>{
  for(const beats of [[{index:1,seconds:0}],[{index:1,seconds:NaN}],[{index:2,seconds:3}],[{index:1,seconds:601}]])assert.throws(()=>productionTimeline(beats));
  assert.throws(()=>sceneAt([{index:1,start:0,end:1}],NaN));
});
