import { test } from "node:test";
import assert from "node:assert/strict";
test("obsolete composition completion is historical and cannot replace current production",{skip:!process.env.STUDIO_INTEGRATION_TESTS},async()=>{
  const base=process.env.STUDIO_TEST_PB_URL!,login=await fetch(base+"/api/collections/_superusers/auth-with-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identity:process.env.PB_ADMIN_EMAIL,password:process.env.PB_ADMIN_PASSWORD})}),{token}=await login.json() as any;
  const call=async(route:string,input:any)=>{const r=await fetch(base+route,{method:"POST",headers:{"Content-Type":"application/json",Authorization:token},body:JSON.stringify(input)});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
  const episode=await call("/api/collections/episodes/records",{channel:"arthur000000001",title:"Changed source",slug:"changed-source",status:"script",format:"short",vault_path:"Fixture/changed",script_meta:{composition_hash:"new-hash",approved_revision:"new-script",document_revisions:{"storyboard.md":"new-storyboard"}}});
  const worker=await call("/api/collections/workers/records",{worker_key:"historical-fixture",hostname:"fixture",capabilities:["render"],heartbeat:new Date().toISOString()});
  const job=await call("/api/collections/jobs/records",{episode:episode.id,type:"render",status:"running",worker_id:worker.id,payload:{drive_base:"Faceless/Fixture/changed",composition_hash:"old-hash",script_revision:"old-script",storyboard_revision:"old-storyboard",composition_mode:"render"}});
  const result=await call("/api/studio/complete",{job_id:job.id,worker_id:worker.id,asset:{drive_path:"Faceless/Fixture/changed/renders/old.mp4",drive_file_id:"fixture",kind:"render",source:"render",meta:{}}});assert.equal(result.asset.selected,false);assert.equal(result.asset.meta.historical,true);
  const current=await fetch(base+"/api/collections/episodes/records/"+episode.id,{headers:{Authorization:token}}).then(r=>r.json());assert.equal(current.status,"script");
});

test("workspace preferences are private and transactional claims survive duplicate triggers",{skip:!process.env.STUDIO_INTEGRATION_TESTS},async()=>{
  const base=process.env.STUDIO_TEST_PB_URL!;const login=await fetch(base+"/api/collections/_superusers/auth-with-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identity:process.env.PB_ADMIN_EMAIL,password:process.env.PB_ADMIN_PASSWORD})});const {token}=await login.json() as {token:string};
  const call=async(route:string,input:unknown)=>fetch(base+"/api/studio/"+route,{method:"POST",headers:{"Content-Type":"application/json",Authorization:token},body:JSON.stringify(input)});
  const row={key:"preferences:nativetest",kind:"preferences",channel:"arthur000000001",data:{revision:1,slots:["06:00","19:00"]},expected_revision:0};
  const first=await call("workspace-save",row);assert.equal(first.status,200,await first.text());
  const concurrent=await Promise.all([1,2].map(()=>call("workspace-save",{...row,data:{...row.data,revision:2},expected_revision:1})));assert.equal(concurrent.filter(r=>r.ok).length,1);
  assert.equal((await fetch(base+"/api/collections/workspace_records/records")).status,403);
  const data={id:"native-task",key:"production:nativetest",channel:"arthur000000001",kind:"research",status:"queued",target_at:new Date().toISOString(),created:new Date().toISOString(),attempts:0,revision:1};
  const saved=await call("workspace-save",{key:data.key,kind:"task",channel:data.channel,data,create_only:true});assert.equal(saved.status,200,await saved.text());
  const claims=await Promise.all([1,2].map(()=>call("workspace-task-claim",{}).then(r=>r.json())));assert.equal(claims.filter((r:any)=>r.record).length,1,JSON.stringify(claims));assert.equal((claims.find((r:any)=>r.record) as any).record.data.status,"running");
});

test("PocketBase migrations, private records, atomic worker claims and budget approvals", { skip: process.env.STUDIO_INTEGRATION_TESTS !== "1" }, async () => {
  const base = process.env.STUDIO_TEST_PB_URL!;
  const authentication = await fetch(base + "/api/collections/_superusers/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }) });
  assert.equal(authentication.status, 200); const { token } = await authentication.json() as { token: string };
  const api = async (route: string, input?: unknown, method = "POST") => {
    const response = await fetch(base + route, { method: input === undefined ? "GET" : method, headers: { "Content-Type": "application/json", Authorization: token }, body: input === undefined ? undefined : JSON.stringify(input) });
    const data = await response.json(); return { response, data };
  };
  const create = async (collection: string, input: unknown) => { const { response, data } = await api(`/api/collections/${collection}/records`, input); assert.equal(response.status, 200, JSON.stringify(data)); return data; };
  const channels = await api("/api/collections/channels/records"); assert.equal(channels.data.totalItems, 3);
  const anonymous = await fetch(base + "/api/collections/channels/records"); assert.equal(anonymous.status, 403);
  const owner = (await api("/api/collections/studio_users/records")).data.items[0];
  const episode = await create("episodes", { channel: channels.data.items[0].id, title: "Integration fixture", slug: "fixture", status: "idea", format: "short", vault_path: "Integration/fixture" });
  const workers = await Promise.all(["a", "b"].map(key => create("workers", { worker_key: "fixture-" + key, hostname: "integration", capabilities: ["render", "image"], heartbeat: new Date().toISOString() })));
  const job = await create("jobs", { episode: episode.id, type: "render", status: "queued", payload: { drive_base: "Faceless/Integration/fixture" } });
  const claims = await Promise.all(workers.map(worker => api("/api/studio/claim", { worker_id: worker.id })));
  for (const claim of claims) assert.equal(claim.response.status, 200, JSON.stringify(claim.data));
  const winners = claims.filter(item => item.data.job); assert.equal(winners.length, 1, "A queued job was claimed twice");
  assert.equal(winners[0].data.job.id, job.id);
  const workerId = winners[0].data.job.worker_id;
  const second = await create("jobs", { episode: episode.id, type: "render", status: "queued", payload: { drive_base: "Faceless/Integration/fixture" } });
  const busy = await api("/api/studio/claim", { worker_id: workerId }); assert.equal(busy.data.job, null, "One worker must not run two GPU jobs");
  const wrong = await api("/api/studio/complete", { job_id: job.id, worker_id: workers.find(worker => worker.id !== workerId).id, error: "wrong worker" }); assert.equal(wrong.response.status, 400);
  const complete = await api("/api/studio/complete", { job_id: job.id, worker_id: workerId, asset: { kind: "render", source: "render", drive_file_id: "fixture", drive_path: "Faceless/Integration/fixture/renders/01_test_v1.mp4", meta: {} } });
  assert.equal(complete.response.status, 200, JSON.stringify(complete.data)); assert.equal(complete.data.job.status, "done"); assert.ok(complete.data.job.result_asset);
  const duplicate = await api("/api/studio/complete", { job_id: job.id, worker_id: workerId, error: "duplicate" }); assert.equal(duplicate.response.status, 400);
  const budget = (await api('/api/collections/settings/records?filter=key%3D%22spending%22')).data.items[0];
  await api(`/api/collections/settings/records/${budget.id}`, { value: { ...budget.value, daily_usd: 0.05, daily_credits: 4 } }, "PATCH");
  const quotes = await Promise.all([1, 2].map(() => create("spend_quotes", { operation: "research", episode: episode.id, provider: "ninerouter", units: 1, est_cost: 0.04, currency: "USD", requested_by: owner.id, request: {}, payload: {}, expires: new Date(Date.now() + 60000).toISOString() })));
  const start = new Date(Date.now() - 3600000).toISOString();
  const reservations = await Promise.all(quotes.map(quote => api("/api/studio/reserve", { quote_id: quote.id, approved_by: owner.id, day_start: start })));
  assert.equal(reservations.filter(item => item.response.ok).length, 1, JSON.stringify(reservations.map(item => item.data)));
  const accepted = reservations.find(item => item.response.ok)!;
  const replay = await api("/api/studio/reserve", { quote_id: accepted.data.spend.quote, approved_by: owner.id, day_start: start }); assert.equal(replay.data.reused, true);
  const flowQuote = await create("spend_quotes", { operation: "image", episode: episode.id, provider: "flow", units: 4, est_cost: 0, currency: "credits", requested_by: owner.id, request: {}, payload: { drive_base: "Faceless/Integration/fixture" }, expires: new Date(Date.now() + 60000).toISOString() });
  const flow = await api("/api/studio/reserve", { quote_id: flowQuote.id, approved_by: owner.id, day_start: start }); assert.equal(flow.response.status, 200, JSON.stringify(flow.data)); assert.equal(flow.data.job.status, "queued");
  const expired = await create("spend_quotes", { operation: "research", episode: episode.id, provider: "ninerouter", units: 0, est_cost: 0, currency: "USD", requested_by: owner.id, request: {}, payload: {}, expires: new Date(Date.now() - 1000).toISOString() });
  const invalid = await api("/api/studio/reserve", { quote_id: expired.id, approved_by: owner.id, day_start: start }); assert.equal(invalid.response.status, 400);
  const logs = await api("/api/collections/spend_log/records"); assert.equal(logs.data.totalItems, 2, "Replayed and rejected approvals must not create charges");
  assert.ok(second.id);
});
