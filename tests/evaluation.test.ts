import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluateEvidence} from "../packages/core/src/evaluation";
test("video evaluation keeps missing metrics unknown and separates facts from hypotheses",()=>{
  const own={source:"youtube-api",video_id:"abcdefghijk",title:"Current",start:"2026-10-01",end:"2026-10-28",views:100,average_view_percentage:null,viewed_vs_swiped:null};
  const result=evaluateEvidence(own,[{...own,video_id:"previous123",views:200},{...own,video_id:"otherperiod",start:"2026-09-01",views:90000}]);
  assert.equal(result.evidence.length,2);assert.ok(result.observations.some(s=>s.includes("100")));assert.ok(result.observations.some(s=>s.includes("200")));assert.ok(result.limitations.some(s=>/keep watching/i.test(s)));assert.ok(result.limitations.some(s=>/umur/i.test(s)));assert.equal(result.hypotheses.length,0);
});
test("retention above 100 percent is retained as evidence and absent baseline never becomes zero",()=>{
  const result=evaluateEvidence({source:"youtube-api",video_id:"abcdefghijk",title:"Loop",start:"2026-10-01",end:"2026-10-28",views:42,average_view_percentage:145,viewed_vs_swiped:null},[]);
  assert.equal(result.evidence[0].average_view_percentage,145);assert.ok(result.limitations.some(s=>/pembanding/i.test(s)));assert.ok(!result.observations.some(s=>/median.*0/.test(s)));
});
