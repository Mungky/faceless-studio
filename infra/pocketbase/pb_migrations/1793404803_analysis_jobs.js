// For You deep analysis runs on the PC worker as an "analyze" job that has no episode.
migrate((app)=>{
  const jobs=app.findCollectionByNameOrId("jobs");
  const type=jobs.fields.getByName("type");type.values=[...new Set([...type.values,"analyze"])];
  jobs.fields.getByName("episode").required=false;
  app.save(jobs);
},(app)=>{
  const jobs=app.findCollectionByNameOrId("jobs");
  const type=jobs.fields.getByName("type");type.values=type.values.filter(v=>v!=="analyze");
  jobs.fields.getByName("episode").required=true;
  app.save(jobs);
});
