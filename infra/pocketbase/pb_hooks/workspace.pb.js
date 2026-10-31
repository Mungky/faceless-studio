routerAdd("POST","/api/studio/workspace-save",(e)=>{
  const body=e.requestInfo().body;
  if(!body.key||!body.kind||!body.channel||!body.data)throw new BadRequestError("Workspace key, kind, channel and data are required.");
  let saved;
  $app.runInTransaction((tx)=>{
    let record;
    try{record=tx.findFirstRecordByFilter("workspace_records","key = {:key}",{key:body.key});}catch(error){if(!String(error).includes("no rows"))throw error;}
    const current=record?JSON.parse(record.getString("data")||"null"):null;
    if(body.expected_revision!==undefined&&Number(current&&current.revision||0)!==body.expected_revision)throw new BadRequestError("This record changed. Reload before saving.");
    if(body.create_only&&record)throw new BadRequestError("Workspace record already exists.");
    if(!record)record=new Record(tx.findCollectionByNameOrId("workspace_records"));
    record.set("key",body.key);record.set("kind",body.kind);record.set("channel",body.channel);record.set("data",body.data);tx.save(record);saved=record;
  });
  return e.json(200,saved);
},$apis.requireSuperuserAuth());

routerAdd("POST","/api/studio/workspace-task-claim",(e)=>{
  let claimed=null;
  $app.runInTransaction((tx)=>{
    const rows=tx.findRecordsByFilter("workspace_records","kind = 'task' && (data.status = 'queued' || data.status = 'running')","created",500,0);
    const dataOf=r=>JSON.parse(r.getString("data")||"{}");
    for(const row of rows){const data=dataOf(row);if(data.status==="running"&&data.lease_until&&Date.parse(data.lease_until)<Date.now()){data.status="blocked";data.error="Proses terputus. Periksa hasil sebelum mencoba kembali; permintaan provider tidak diulang otomatis.";data.revision=(data.revision||0)+1;row.set("data",data);tx.save(row);}}
    const pending=rows.filter(r=>dataOf(r).status==="queued").sort((a,b)=>String(dataOf(a).target_at).localeCompare(String(dataOf(b).target_at)))[0];
    if(pending){const data=dataOf(pending);data.status="running";data.attempts=(data.attempts||0)+1;data.revision=(data.revision||0)+1;data.lease_until=new Date(Date.now()+30*60*1000).toISOString();pending.set("data",data);tx.save(pending);claimed=pending;}
  });
  return e.json(200,{record:claimed});
},$apis.requireSuperuserAuth());

cronAdd("studio_workspace_tick","*/5 * * * *",()=>{
  if($os.getenv("STUDIO_AUTOMATION_DISABLED")==="1")return;
  const url=$os.getenv("STUDIO_WEB_INTERNAL_URL")||$os.getenv("APP_URL"),token=$os.getenv("AUTOMATION_TOKEN");if(!url||!token)return;
  try{$http.send({url:url.replace(/\/$/,"")+"/api/automation/tick",method:"POST",headers:{Authorization:"Bearer "+token},timeout:240});}catch(error){console.error("Workspace automation trigger failed: "+String(error));}
});
