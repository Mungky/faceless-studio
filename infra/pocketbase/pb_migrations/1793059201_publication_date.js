migrate(app => {
  const collection = app.findCollectionByNameOrId("episodes");
  collection.fields.add(new DateField({ name: "published_at" }));
  app.save(collection);
}, app => {
  const collection = app.findCollectionByNameOrId("episodes");
  collection.fields.removeByName("published_at");
  app.save(collection);
});
