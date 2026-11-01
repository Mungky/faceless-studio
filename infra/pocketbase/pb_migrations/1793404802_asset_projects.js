// Assets become a standalone library: free-form projects, a display title, a trash flag,
// and uploads that do not belong to any episode.
migrate((app)=>{
  const assets=app.findCollectionByNameOrId("assets");
  assets.fields.getByName("episode").required=false;
  assets.fields.add(new TextField({name:"project",max:120}));
  assets.fields.add(new TextField({name:"title",max:200}));
  assets.fields.add(new BoolField({name:"deleted"}));
  app.save(assets);
},(app)=>{
  const assets=app.findCollectionByNameOrId("assets");
  assets.fields.getByName("episode").required=true;
  for(const name of ["project","title","deleted"])assets.fields.removeByName(name);
  app.save(assets);
});
