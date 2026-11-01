migrate((app)=>{
  const assets=app.findCollectionByNameOrId("assets");
  assets.fields.add(new TextField({name:"asset_group",max:80}));
  assets.fields.add(new JSONField({name:"tags",maxSize:4096}));
  app.save(assets);
},(app)=>{
  const assets=app.findCollectionByNameOrId("assets");
  assets.fields.removeByName("asset_group");
  assets.fields.removeByName("tags");
  app.save(assets);
});
