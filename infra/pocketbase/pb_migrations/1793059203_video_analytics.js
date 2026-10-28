migrate(app=>{
  const channels=app.findCollectionByNameOrId("channels");
  channels.indexes=[...channels.indexes,"CREATE UNIQUE INDEX idx_channel_name_ci ON channels (name COLLATE NOCASE)","CREATE UNIQUE INDEX idx_youtube_channel_unique ON channels (youtube_channel_id) WHERE youtube_channel_id != ''"];
  app.save(channels);
  const text=name=>({name,type:"text",required:true,max:200});
  app.save(new Collection({name:"video_reports",type:"base",listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[...['channel','youtube_channel_id','video_id','start_date','end_date'].map(text),{name:"video",type:"json",maxSize:1048576},{name:"report",type:"json",maxSize:4194304},{name:"metrics",type:"json",maxSize:4194304},{name:"created",type:"autodate",onCreate:true},{name:"updated",type:"autodate",onCreate:true,onUpdate:true}],indexes:["CREATE UNIQUE INDEX idx_video_report_scope ON video_reports (channel,youtube_channel_id,video_id,start_date,end_date)"]}));
},app=>{
  app.delete(app.findCollectionByNameOrId("video_reports"));
  const channels=app.findCollectionByNameOrId("channels");channels.indexes=channels.indexes.filter(index=>!index.includes("idx_channel_name_ci")&&!index.includes("idx_youtube_channel_unique"));app.save(channels);
});
