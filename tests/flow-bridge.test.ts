import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowConnector, requireCappedFlow } from "@studio/connectors";

test("Flow stays blocked even when a bridge advertises the old misleading cap", () => {
  for (const status of [undefined, {}, { studioAdapter: true, maxJobRetries: 1 }]) assert.throws(() => requireCappedFlow(status), /verified retry limit/);
});

test("Flow fails before status, extension submission, or a provider request", async () => {
  const flow = new FlowConnector(); let statusCalled = false;
  flow.status = async () => { statusCalled = true; return { extensionConnected: true, loggedIn: true, grokVisible: true }; };
  await assert.rejects(flow.generate({ kind: "image", prompt: "Must never submit", model: "nano-banana-pro", aspectRatio: "9:16", jobId: "test00000000001" }, AbortSignal.timeout(1000)), /No generation was submitted/);
  assert.equal(statusCalled, false);
});
