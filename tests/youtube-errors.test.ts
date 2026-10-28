import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { YouTubeConnector } from "@studio/connectors";

test("YouTube failure identifies the API, specific cause and recovery without exposing provider text", async t => {
  const cases = [
    { reason: "accessNotConfigured", expected: /YouTube Data API v3 is not enabled/, payload: { error: { errors: [{ reason: "accessNotConfigured" }] } } },
    { reason: "SERVICE_DISABLED", expected: /YouTube Data API v3 is not enabled/, payload: { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } },
    { reason: "insufficientPermissions", expected: /Reconnect.*grant both requested YouTube permissions/, payload: { error: { errors: [{ reason: "insufficientPermissions" }] } } },
    { reason: "quotaExceeded", expected: /quota.*No automatic retry/, payload: { error: { errors: [{ reason: "quotaExceeded" }] } } },
    { reason: "channelForbidden", expected: /selected YouTube channel/, payload: { error: { errors: [{ reason: "channelForbidden" }] } } }
  ];
  for (const item of cases) await t.test(item.reason, async () => {
    let calls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ ...item.payload, private_field: "fixture-private-token" }), { status: 403 }); });
    try {
      const connector = new YouTubeConnector({ refresh_token: "fixture", access_token: "fixture-private-token", expires_at: Date.now() + 3600000 });
      await assert.rejects(connector.ownChannel(), error => { assert.match((error as Error).message, item.expected); assert.match((error as Error).message, new RegExp(item.reason)); assert.doesNotMatch((error as Error).message, /fixture-private-token/); return true; });
      assert.equal(calls, 1);
    } finally { fetchMock.mock.restore(); }
  });
});

test("read-only YouTube requests recover once from transient server failure and stop after two attempts", async () => {
  let calls = 0, persistent = false;
  const fetchMock = mock.method(globalThis, "fetch", async () => { calls++; return persistent || calls === 1 ? new Response(JSON.stringify({error:{message:"fixture-private-token"}}), {status:503}) : new Response(JSON.stringify({items:[]})); });
  try {
    const connector = new YouTubeConnector({refresh_token:"fixture",access_token:"fixture",expires_at:Date.now()+3600000});
    assert.deepEqual(await connector.request("https://www.googleapis.com/youtube/v3/videos", {}), {items:[]});
    assert.equal(calls,2);
    calls=0; persistent=true;
    await assert.rejects(connector.request("https://youtubeanalytics.googleapis.com/v2/reports", {}), error => { assert.match((error as Error).message,/temporarily unavailable/); assert.doesNotMatch((error as Error).message,/fixture-private-token|Reconnect/); return true; });
    assert.equal(calls,2);
  } finally {fetchMock.mock.restore();}
});

test("YouTube Analytics failure identifies its own API and malformed errors remain safe", async () => {
  let payload: unknown = { error: { details: [{ reason: "SERVICE_DISABLED" }] } };
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload), { status: 403 }));
  try {
    const connector = new YouTubeConnector({ refresh_token: "fixture", access_token: "fixture", expires_at: Date.now() + 3600000 });
    await assert.rejects(connector.request("https://youtubeanalytics.googleapis.com/v2/reports", {}), /YouTube Analytics API is not enabled/);
    payload = { error: { message: "fixture-private-token", errors: "invalid", details: [{ reason: "Bearer fixture-private-token" }] } };
    await assert.rejects(connector.ownChannel(), error => { assert.match((error as Error).message, /YouTube request failed \(403\)/); assert.doesNotMatch((error as Error).message, /fixture-private-token|Bearer/); return true; });
  } finally { fetchMock.mock.restore(); }
});
