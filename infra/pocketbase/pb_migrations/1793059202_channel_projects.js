/// <reference path="../pb_data/types.d.ts" />
migrate(app => {
  const channels = app.findCollectionByNameOrId("channels");
  channels.fields.add(new JSONField({ name: "profile", maxSize: 1048576 }));
  app.save(channels);
  const locked = { type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
  const text = name => ({ name, type: "text", required: true, max: 200 });
  const dates = [{ name: "created", type: "autodate", onCreate: true }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true }];
  app.save(new Collection({ ...locked, name: "channel_reports", fields: [text("channel"), text("youtube_channel_id"), text("start_date"), text("end_date"), { name: "report", type: "json", maxSize: 4194304 }, ...dates], indexes: ["CREATE UNIQUE INDEX idx_channel_report_range ON channel_reports (channel, youtube_channel_id, start_date, end_date)"] }));
  app.save(new Collection({ ...locked, name: "channel_catalogs", fields: [text("channel"), text("youtube_channel_id"), { name: "videos", type: "json", maxSize: 16777216 }, { name: "catalog", type: "json", maxSize: 1048576 }, ...dates], indexes: ["CREATE UNIQUE INDEX idx_channel_catalog ON channel_catalogs (channel, youtube_channel_id)"] }));
}, app => {
  // Cache rollback does not touch credentials, episodes or production files.
  app.delete(app.findCollectionByNameOrId("channel_reports"));
  app.delete(app.findCollectionByNameOrId("channel_catalogs"));
  const channels = app.findCollectionByNameOrId("channels"); channels.fields.removeByName("profile"); app.save(channels);
});
