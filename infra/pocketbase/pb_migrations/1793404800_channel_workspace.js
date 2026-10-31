migrate((app)=>{
  app.save(new Collection({
    name:"workspace_records",type:"base",listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[
      {name:"key",type:"text",required:true,max:220},
      {name:"kind",type:"text",required:true,max:40},
      {name:"channel",type:"text",required:true,max:40},
      {name:"data",type:"json",required:true,maxSize:8388608},
      {name:"created",type:"autodate",onCreate:true},
      {name:"updated",type:"autodate",onCreate:true,onUpdate:true}
    ],
    indexes:["CREATE UNIQUE INDEX idx_workspace_key ON workspace_records (key)","CREATE INDEX idx_workspace_channel_kind ON workspace_records (channel, kind)"]
  }));
},(app)=>{app.delete(app.findCollectionByNameOrId("workspace_records"));});
