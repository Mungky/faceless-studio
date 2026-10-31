import {test} from "node:test";
import assert from "node:assert/strict";
import {validateComposition,compositionDigest} from "../packages/core/src/composition";
import {validateNarrationTake} from "../packages/core/src/composition";
const source={files:[{path:"index.html",content:'<main data-composition-id="main" data-duration="2" data-width="1080" data-height="1920"></main><script>window.__timelines={main:{seek(){}}}</script>'}],duration:2,width:1080,height:1920};
test("code composition preserves actual scene code and rejects traversal, missing timeline and remote assets",()=>{
  const value=validateComposition(source);assert.equal(value.files[0].content,source.files[0].content);
  assert.equal(compositionDigest(source),compositionDigest(value),"JSON object property order does not change a composition hash");
  assert.throws(()=>validateComposition({...source,files:[{path:"../secret.js",content:"bad"},...source.files]}));
  assert.throws(()=>validateComposition({...source,files:[{path:"index.html",content:"a slideshow with no composition"}]}));
  assert.throws(()=>validateComposition({...source,files:[{path:"index.html",content:source.files[0].content+'<script src="https://evil.example/code.js"></script>'}]}));
  assert.equal(compositionDigest(value),compositionDigest(value));assert.notEqual(compositionDigest(value),compositionDigest({...value,files:[{...value.files[0],content:value.files[0].content+" "}]}));
});
test("narrated production requires one selected take and cannot truncate its duration",()=>{
  assert.throws(()=>validateNarrationTake([],10));assert.throws(()=>validateNarrationTake([{id:"one",kind:"vo",selected:true,meta:{}},{id:"two",kind:"vo",selected:true,meta:{}}],10));
  assert.throws(()=>validateNarrationTake([{id:"one",kind:"vo",selected:true,meta:{duration_seconds:12}}],10));assert.equal(validateNarrationTake([{id:"one",kind:"vo",selected:true,meta:{duration_seconds:9}}],10).id,"one");
});
