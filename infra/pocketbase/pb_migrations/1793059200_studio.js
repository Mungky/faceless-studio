/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required, max: 200000 });
  const number = name => ({ name, type: "number", min: 0 });
  const json = name => ({ name, type: "json", maxSize: 2097152 });
  const select = (name, values) => ({ name, type: "select", values, maxSelect: 1 });
  const date = name => ({ name, type: "date" });
  const bool = name => ({ name, type: "bool" });
  const schemas = {
    channels: [text("name", true), text("handle"), text("niche_id"), text("style_id"), text("playbook_path"), text("color"), text("youtube_channel_id"), text("oauth_ref")],
    niches: [text("name", true), text("rules_md_path")],
    styles: [text("name", true), text("look_md_path"), text("render_template"), text("voice_id"), text("music_prompt_preset")],
    episodes: [text("channel", true), text("title", true), text("slug", true), select("status", ["idea", "script", "storyboard", "audio", "footage", "render", "review", "published"]), select("format", ["short", "long"]), text("vault_path", true), text("drive_folder_id"), text("youtube_video_id"), bool("script_approved"), json("script_meta")],
    assets: [text("episode", true), select("kind", ["image", "video", "vo", "sfx", "bgm", "music", "render", "thumb"]), text("drive_file_id"), text("drive_path", true), json("meta"), text("source", true), bool("selected")],
    jobs: [select("type", ["render", "music", "ffmpeg", "vo", "image", "video"]), text("episode", true), json("payload"), select("status", ["queued", "running", "done", "failed", "cancelled"]), text("worker_id"), number("progress"), text("log"), text("result_asset"), number("attempts"), bool("cancel_requested"), date("started"), date("finished")],
    workers: [text("worker_key", true), text("hostname", true), json("capabilities"), text("gpu"), date("heartbeat")],
    analytics_snapshots: [text("video_id", true), text("episode", true), text("date", true), json("metrics"), text("source")],
    diagnoses: [text("video_id", true), text("snapshot", true), text("findings_md", true), text("model_used", true)],
    spend_quotes: [text("operation", true), text("episode", true), text("provider", true), number("units"), number("est_cost"), text("currency", true), text("requested_by", true), json("request"), json("payload"), date("expires"), bool("consumed")],
    spend_log: [text("quote", true), text("provider", true), number("units"), number("est_cost"), text("currency", true), text("approved_by", true), text("job"), text("asset"), text("status", true), text("error")],
    model_routes: [text("task", true), text("model", true), select("billing", ["free", "paid"]), number("usd_per_1k_chars"), number("max_output_tokens")],
    oauth_credentials: [text("channel", true), text("ciphertext", true)],
    settings: [text("key", true), json("value")]
  };
  for (const name in schemas) {
    const fields = schemas[name].concat([{ name: "created", type: "autodate", onCreate: true }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true }]);
    const collection = new Collection({ name, type: "base", fields, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null });
    if (name === "workers") collection.indexes = ["CREATE UNIQUE INDEX idx_worker_key ON workers (worker_key)"];
    if (name === "spend_log") collection.indexes = ["CREATE UNIQUE INDEX idx_spend_quote ON spend_log (quote)"];
    if (name === "settings") collection.indexes = ["CREATE UNIQUE INDEX idx_settings_key ON settings (key)"];
    if (name === "model_routes") collection.indexes = ["CREATE UNIQUE INDEX idx_model_task ON model_routes (task)"];
    if (name === "jobs") collection.indexes = ["CREATE INDEX idx_jobs_queue ON jobs (status, created)"];
    if (name === "analytics_snapshots") collection.indexes = ["CREATE UNIQUE INDEX idx_snapshot_date ON analytics_snapshots (video_id, date)"];
    app.save(collection);
  }
  const users = new Collection({ name: "studio_users", type: "auth", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, passwordAuth: { enabled: true, identityFields: ["email"] } });
  app.save(users);
  const adminEmail = $os.getenv("PB_ADMIN_EMAIL"), adminPassword = $os.getenv("PB_ADMIN_PASSWORD");
  if (!adminEmail || !adminPassword || !$os.getenv("STUDIO_OWNER_PASSWORD")) throw new Error("Set PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD and STUDIO_OWNER_PASSWORD before migrating.");
  const admin = new Record(app.findCollectionByNameOrId("_superusers")); admin.set("email", adminEmail); admin.set("password", adminPassword); app.save(admin);
  const owner = new Record(users); owner.set("email", $os.getenv("STUDIO_OWNER_EMAIL") || "owner@studio.local"); owner.set("password", $os.getenv("STUDIO_OWNER_PASSWORD")); owner.set("verified", true); app.save(owner);
  const channelCollection = app.findCollectionByNameOrId("channels");
  const channels = [
    { id: "arthur000000001", name: "Arthur", handle: "@arthurtrybetter", playbook_path: "Arthur/Arthur.md", color: "#6077BC" },
    { id: "notyet000000001", name: "Not Yet", handle: "@notyetstory", playbook_path: "Not Yet/Not Yet.md", color: "#758A68" },
    { id: "exhibit00000001", name: "Exhibit Pop", handle: "", playbook_path: "Exhibit Pop/Exhibit Pop.md", color: "#AC7581" }
  ];
  for (const data of channels) { const record = new Record(channelCollection); for (const key in data) record.set(key, data[key]); app.save(record); }
  const settings = new Record(app.findCollectionByNameOrId("settings")); settings.set("key", "spending");
  settings.set("value", { daily_usd: 0, daily_credits: 0, flow_image_credits: null, flow_video_credits: null, elevenlabs_usd_per_1k_chars: null, webhook_image_usd: null, webhook_video_usd: null }); app.save(settings);
}, (app) => {
  // Destructive rollback is deliberately manual: the studio stores production metadata.
  throw new Error("Back up pb_data and remove studio collections manually to roll back this initial migration.");
});
