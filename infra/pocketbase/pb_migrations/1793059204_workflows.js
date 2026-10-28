migrate(app=>{
  const text=(name,required=false)=>({name,type:"text",required,max:200});
  const dates=[{name:"created",type:"autodate",onCreate:true},{name:"updated",type:"autodate",onCreate:true,onUpdate:true}];
  const privateRules={listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null};
  app.save(new Collection({name:"workflow_templates",type:"base",...privateRules,fields:[text("key",true),{name:"data",type:"json",required:true,maxSize:2097152},...dates],indexes:["CREATE UNIQUE INDEX idx_workflow_template_key ON workflow_templates (key)"]}));
  app.save(new Collection({name:"workflow_runs",type:"base",...privateRules,fields:[{name:"data",type:"json",required:true,maxSize:8388608},{name:"meta",type:"json",maxSize:2097152},...dates]}));
},app=>{
  throw new Error("Workflow history is production data. Back up and remove workflow collections manually to roll back.");
});
