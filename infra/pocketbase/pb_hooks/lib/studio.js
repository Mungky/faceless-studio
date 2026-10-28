const now = () => new Date().toISOString().replace("T", " ");
const validId = value => typeof value === "string" && /^[a-zA-Z0-9]{15}$/.test(value);
const jsonField = (record, key, fallback) => {
  const raw = record.getString(key);
  return raw ? JSON.parse(raw) : fallback;
};
const exported = (record, fields) => {
  const value = record.publicExport();
  for (const field of fields || []) value[field] = jsonField(record, field, null);
  return value;
};

module.exports = {
  claim(body) {
    if (!validId(body.worker_id)) throw new BadRequestError("Invalid worker");
    let result = null;
    $app.runInTransaction(tx => {
      const worker = tx.findRecordById("workers", body.worker_id);
      if (Date.now() - Date.parse(worker.getString("heartbeat")) > 60000) throw new BadRequestError("Worker heartbeat expired");
      const busy = tx.findRecordsByFilter("jobs", 'worker_id = {:worker} && status = "running"', "", 1, 0, { worker: worker.id });
      if (busy.length) return;
      const capabilities = jsonField(worker, "capabilities", []);
      const allowed = ["render", "music", "ffmpeg", "image", "video"].filter(type => capabilities.indexOf(type) >= 0);
      if (!allowed.length) return;
      const filter = 'status = "queued" && (' + allowed.map(type => 'type = "' + type + '"').join(" || ") + ")";
      const jobs = tx.findRecordsByFilter("jobs", filter, "created", 1, 0);
      if (!jobs.length) return;
      const job = jobs[0];
      job.set("status", "running"); job.set("worker_id", worker.id); job.set("started", now());
      job.set("attempts", job.getInt("attempts") + 1); job.set("log", job.getString("log") + "Worker claimed job.\n");
      tx.save(job); result = exported(job, ["payload"]);
    });
    return { job: result };
  },
  reserve(body) {
    if (!validId(body.quote_id) || !validId(body.approved_by)) throw new BadRequestError("Invalid approval");
    let result;
    $app.runInTransaction(tx => {
      const quote = tx.findRecordById("spend_quotes", body.quote_id);
      if (quote.getString("requested_by") !== body.approved_by) throw new ForbiddenError("Quote belongs to a different user");
      const previous = tx.findRecordsByFilter("spend_log", "quote = {:quote}", "", 1, 0, { quote: quote.id });
      if (previous.length) { result = { spend: previous[0].publicExport(), reused: true }; return; }
      if (quote.getBool("consumed") || Date.parse(quote.getString("expires")) <= Date.now()) throw new BadRequestError("Quote expired. Request a fresh estimate.");
      const settings = jsonField(tx.findFirstRecordByFilter("settings", 'key = "spending"'), "value", {});
      const dayStart = new Date(body.day_start);
      if (!Number.isFinite(dayStart.getTime()) || Date.now() - dayStart.getTime() > 90000000 || dayStart.getTime() > Date.now()) throw new BadRequestError("Invalid budget window");
      const total = new DynamicModel({ usd: "", credits: "" });
      tx.db().newQuery("SELECT CAST(COALESCE(SUM(CASE WHEN currency='USD' THEN est_cost ELSE 0 END),0) AS TEXT) usd, CAST(COALESCE(SUM(CASE WHEN currency='credits' THEN units ELSE 0 END),0) AS TEXT) credits FROM spend_log WHERE created >= {:start} AND status != 'void'").bind({ start: dayStart.toISOString().replace("T", " ") }).one(total);
      if (quote.getString("currency") === "USD" && settings.daily_usd !== null && Number(total.usd) + quote.getFloat("est_cost") > Number(settings.daily_usd) + 0.0000001) throw new BadRequestError("Daily USD budget exceeded. Change the limit explicitly in Spending.");
      if (quote.getString("currency") === "credits" && settings.daily_credits !== null && Number(total.credits) + quote.getFloat("units") > Number(settings.daily_credits)) throw new BadRequestError("Daily generation credit limit exceeded. Change the limit in Spending.");
      const spend = new Record(tx.findCollectionByNameOrId("spend_log"));
      for (const key of ["provider", "units", "est_cost", "currency"]) spend.set(key, quote.get(key));
      spend.set("quote", quote.id); spend.set("approved_by", body.approved_by); spend.set("status", "reserved"); tx.save(spend);
      quote.set("consumed", true); tx.save(quote);
      let job = null;
      if (["image", "video"].indexOf(quote.getString("operation")) >= 0 && quote.getString("provider") === "flow") {
        job = new Record(tx.findCollectionByNameOrId("jobs"));
        const payload = jsonField(quote, "payload", {}); payload.spend_id = spend.id;
        job.set("type", quote.getString("operation")); job.set("episode", quote.getString("episode")); job.set("payload", payload); job.set("status", "queued"); tx.save(job);
        spend.set("job", job.id); tx.save(spend);
      }
      result = { spend: spend.publicExport(), job: job ? exported(job, ["payload"]) : null, reused: false };
    });
    return result;
  },
  complete(body) {
    if (!validId(body.job_id) || !validId(body.worker_id)) throw new BadRequestError("Invalid completion");
    let result;
    $app.runInTransaction(tx => {
      const job = tx.findRecordById("jobs", body.job_id);
      if (job.getString("worker_id") !== body.worker_id || job.getString("status") !== "running") throw new BadRequestError("Worker no longer owns this running job");
      const payload = jsonField(job, "payload", {});
      const assetData = body.asset;
      if (job.getBool("cancel_requested")) {
        job.set("status", "cancelled");
      } else if (body.error) {
        job.set("status", "failed"); job.set("log", job.getString("log") + "\n" + String(body.error).slice(0, 20000));
      } else {
        if (!assetData || typeof assetData.drive_path !== "string" || assetData.drive_path.indexOf(payload.drive_base + "/") !== 0) throw new BadRequestError("Output must be saved in the episode Drive folder");
        const asset = new Record(tx.findCollectionByNameOrId("assets"));
        for (const key of ["drive_file_id", "drive_path", "kind", "source", "meta"]) asset.set(key, assetData[key]);
        asset.set("episode", job.getString("episode")); asset.set("selected", true); tx.save(asset);
        job.set("result_asset", asset.id); job.set("progress", 100); job.set("status", "done");
        if (job.getString("type") === "render") { const episode = tx.findRecordById("episodes", job.getString("episode")); episode.set("status", "review"); tx.save(episode); }
        result = { asset: exported(asset, ["meta"]) };
      }
      job.set("finished", now()); tx.save(job);
      if (payload.spend_id) { const spend = tx.findRecordById("spend_log", payload.spend_id); spend.set("status", job.getString("status") === "done" ? "done" : "failed"); spend.set("asset", job.getString("result_asset")); spend.set("error", body.error || (job.getBool("cancel_requested") ? "Cancelled; provider credits may already be used." : "")); tx.save(spend); }
      result = Object.assign(result || {}, { job: exported(job, ["payload"]) });
    });
    return result;
  },
  cancel(body) {
    if (!validId(body.job_id)) throw new BadRequestError("Invalid job");
    let result;
    $app.runInTransaction(tx => {
      const job = tx.findRecordById("jobs", body.job_id);
      const status = job.getString("status");
      if (status !== "queued" && status !== "running") throw new BadRequestError("Only queued or running jobs can be cancelled");
      if (status === "queued") {
        job.set("status", "cancelled"); job.set("finished", now());
        const payload = jsonField(job, "payload", {});
        if (payload.spend_id) { const spend = tx.findRecordById("spend_log", payload.spend_id); spend.set("status", "void"); spend.set("error", "Cancelled before any worker claim; reservation released."); tx.save(spend); }
      } else job.set("cancel_requested", true);
      tx.save(job); result = exported(job, ["payload"]);
    });
    return result;
  },
  progress(body) {
    if (!validId(body.job_id) || !validId(body.worker_id)) throw new BadRequestError("Invalid progress update");
    let result;
    $app.runInTransaction(tx => {
      const job = tx.findRecordById("jobs", body.job_id);
      if (job.getString("status") !== "running" || job.getString("worker_id") !== body.worker_id) throw new BadRequestError("Worker no longer owns this job");
      const progress = Number(body.progress); if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new BadRequestError("Invalid progress");
      job.set("progress", Math.max(job.getFloat("progress"), progress)); job.set("log", String(body.log || "").slice(-100000)); tx.save(job); result = exported(job, ["payload"]);
    });
    return result;
  },
  expireLeases() {
    const jobs = $app.findRecordsByFilter("jobs", 'status = "running"', "", 1000, 0);
    for (const candidate of jobs) $app.runInTransaction(tx => {
      const job = tx.findRecordById("jobs", candidate.id);
      if (job.getString("status") !== "running") return;
      // Only progress on this job renews its lease. A restarted process can
      // refresh the same worker identity without owning the abandoned task.
      if (Date.now() - Date.parse(job.getString("updated")) < 120000) return;
      job.set("status", "failed"); job.set("finished", now()); job.set("log", job.getString("log") + "\nJob progress lease expired. Not automatically retried; paid provider state may be uncertain."); tx.save(job);
      const payload = jsonField(job, "payload", {});
      if (payload.spend_id) { const spend = tx.findRecordById("spend_log", payload.spend_id); spend.set("status", "failed"); spend.set("error", "Job progress lease expired; confirm provider outcome before generating again."); tx.save(spend); }
    });
  }
};
