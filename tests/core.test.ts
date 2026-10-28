import { test } from "node:test";
import assert from "node:assert/strict";
import { segment, slugify, estimateCost, serializeStoryboard, parseStoryboard, validateDiagnosis, parseJsonOutput } from "@studio/core";
import { isoDurationSeconds, parseCsv, studioSupplement } from "@studio/connectors";
import { escapeHtml } from "@studio/render-hyperframes";

test("vault segments reject traversal, absolute paths and Windows stream syntax", () => {
  for (const input of ["..", ".", "../Arthur", "C:", "file:stream", "a\\b", "a/b", "name.", "name ", "a\u0000b"]) assert.equal(segment.safeParse(input).success, false, input);
  assert.equal(segment.parse("Exhibit Pop"), "Exhibit Pop"); assert.equal(slugify("A story: déjà vu?"), "a-story-deja-vu");
});
test("storyboard round trip preserves pipes, newlines, entities and asset references", () => {
  const beats = [{ index: 1, text: "This | that\n& another", prompt: "Rain &amp; light", seconds: 2.5, image: "image0000000001", video: "" }];
  assert.deepEqual(parseStoryboard(serializeStoryboard(beats)), beats);
  assert.throws(() => parseStoryboard("| 1 | text | prompt | -1 | | |"));
});
test("cost rounds conservatively and rejects invalid units", () => {
  assert.equal(estimateCost(0.1, 0.2), 0.020001); // Floating point must never round a reservation down.
  assert.equal(estimateCost(0, 10), 0);
  assert.throws(() => estimateCost(-1, 1)); assert.throws(() => estimateCost(1, Infinity));
});
test("diagnoses must cite exact script text at a real video timestamp", () => {
  const diagnosis = { summary: "Drop after hook", findings: [{ timestamp: 4, quote: "He opened the door.", observation: "Retention drops here", recommendation: "Shorten the pause" }] };
  assert.equal(validateDiagnosis(diagnosis, "0:04 He opened the door.", 30).findings[0].timestamp, 4);
  assert.throws(() => validateDiagnosis(diagnosis, "An unrelated line", 30));
  assert.throws(() => validateDiagnosis(diagnosis, "He opened the door.", 3));
  assert.deepEqual(parseJsonOutput('```json\n{"ok":true}\n```'), { ok: true });
});
test("YouTube metadata and supplementary Studio CSV use the selected video", () => {
  assert.equal(isoDurationSeconds("PT1H2M3S"), 3723);
  assert.equal(isoDurationSeconds("PT40S"), 40);
  const csv = 'Content,Video title,Impressions click-through rate (%),Stayed to watch (%)\r\nabcdefghijk,"A title, with commas",6.5,71.2\r\nother000000,"Other",80,99';
  assert.deepEqual(studioSupplement(csv, "abcdefghijk"), { ctr: 6.5, viewed_vs_swiped: 71.2 });
  assert.throws(() => studioSupplement(csv, "missing0000"));
  assert.deepEqual(parseCsv('a,b\n"line\nwith quote ""x""",2'), [["a", "b"], ['line\nwith quote "x"', "2"]]);
  assert.throws(() => parseCsv('a,"unclosed'));
});
test("the render template cannot interpolate active HTML from script text", () => {
  assert.equal(escapeHtml('<script src="bad">&'), "&lt;script src=&quot;bad&quot;&gt;&amp;");
});
