import "server-only";
import {
  buildN8nWorkflow,getN8nWorkflow,updateN8nWorkflow,activateN8nWorkflow,deactivateN8nWorkflow,triggerN8nWorkflow,
  listN8nExecutions,getN8nExecution,stopN8nExecution,listN8nCredentials
} from "./n8n";
import {addNote,replaceMemory} from "./assistant-memory";

// Everything the project assistant may do to the project's n8n workflow. It acts directly: before each
// change the workflow is copied into the chat's snapshots, so "undo_last_change" can put it back.
type Json=Record<string,any>;
export type Snapshot={at:string;label:string;workflow:{name:string;nodes:unknown[];connections:Json;settings?:Json}};
export type ToolResult={ok:boolean;message:string;data?:unknown;changed?:boolean};
// folder: the project's folder in the vault (memory and rules live there). budget: how many new
// nodes this run may still add; the owner's next message starts a fresh budget.
export type ToolContext={channel:string;workflowId:string;snaps:Snapshot[];folder?:string;budget?:{adds:number}};
export const NODE_ADD_LIMIT=2;
function checkBudget(ctx:ToolContext,count:number){
  if(ctx.budget&&count>ctx.budget.adds)throw new Error(`Batas ${NODE_ADD_LIMIT} node baru per pesan pemilik sudah tercapai (sisa ${ctx.budget.adds}). Berhenti, laporkan apa yang sudah dilakukan, dan tanyakan pemilik sebelum menambah lagi.`);
}

// Chats may edit the same workflow at once; their read-change-write steps queue one behind another.
const queue=new Map<string,Promise<unknown>>();
async function locked<T>(key:string,fn:()=>Promise<T>):Promise<T>{
  const prior=queue.get(key)||Promise.resolve(),next=prior.catch(()=>undefined).then(fn);queue.set(key,next);
  try{return await next;}finally{if(queue.get(key)===next)queue.delete(key);}
}
const fail=(message:string):ToolResult=>({ok:false,message});
const text=(value:unknown,max=800)=>{const s=typeof value==="string"?value:JSON.stringify(value);return s.length>max?s.slice(0,max)+"…":s;};
const body=(wf:Json)=>({name:wf.name,nodes:wf.nodes,connections:wf.connections,settings:wf.settings||{executionOrder:"v1"}});
const find=(wf:Json,name:unknown)=>wf.nodes.find((n:Json)=>String(n.name).toLowerCase()===String(name||"").toLowerCase());
const copyOf=(wf:Json):Snapshot["workflow"]=>({name:wf.name,nodes:structuredClone(wf.nodes),connections:structuredClone(wf.connections),settings:structuredClone(wf.settings)});

// A broken graph is refused before it reaches n8n: unique names, and connections only between real nodes.
function assertGraph(wf:Json){
  const names=new Set<string>();
  for(const node of wf.nodes){
    if(!node.name||!node.type)throw new Error("Setiap node butuh name dan type.");
    if(names.has(node.name))throw new Error(`Nama node "${node.name}" dipakai dua kali.`);
    names.add(node.name);node.id||=`node-${Math.random().toString(36).slice(2,10)}`;node.typeVersion??=1;node.parameters??={};node.position??=[0,0];
  }
  for(const [from,outputs] of Object.entries<Json>(wf.connections||{})){
    if(!names.has(from))throw new Error(`Koneksi berasal dari node "${from}" yang tidak ada.`);
    for(const groups of Object.values<any[]>(outputs))for(const group of groups||[])for(const link of group||[])if(!names.has(link.node))throw new Error(`Koneksi dari "${from}" menuju node "${link.node}" yang tidak ada.`);
  }
}
function connect(wf:Json,from:string,to:string,type="main",output=0,input=0){
  const outputs=((wf.connections[from]??={})[type]??=[]);while(outputs.length<=output)outputs.push([]);
  if(!outputs[output].some((l:Json)=>l.node===to&&l.index===input))outputs[output].push({node:to,type,index:input});
}
function disconnect(wf:Json,from:string,to:string,type?:string){
  for(const [kind,groups] of Object.entries<any[]>(wf.connections[from]||{}))if(!type||kind===type)wf.connections[from][kind]=groups.map(group=>group.filter((l:Json)=>l.node!==to));
}
function removeNode(wf:Json,name:string){
  wf.nodes=wf.nodes.filter((n:Json)=>n.name!==name);delete wf.connections[name];
  for(const from of Object.keys(wf.connections))for(const kind of Object.keys(wf.connections[from]))wf.connections[from][kind]=wf.connections[from][kind].map((group:any[])=>group.filter(l=>l.node!==name));
}
function renameNode(wf:Json,from:string,to:string){
  if(wf.nodes.some((n:Json)=>n.name===to))throw new Error(`Nama node "${to}" sudah dipakai.`);
  const node=wf.nodes.find((n:Json)=>n.name===from);node.name=to;
  if(wf.connections[from]){wf.connections[to]=wf.connections[from];delete wf.connections[from];}
  for(const source of Object.keys(wf.connections))for(const kind of Object.keys(wf.connections[source]))for(const group of wf.connections[source][kind])for(const link of group)if(link.node===from)link.node=to;
}

async function mutate(ctx:ToolContext,label:string,change:(wf:Json)=>string|void):Promise<ToolResult>{
  if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n. Jalankan rebuild_from_recipe untuk membuatnya dari resep Studio.");
  return locked(ctx.workflowId,async()=>{
    const wf=await getN8nWorkflow(ctx.workflowId) as unknown as Json;
    const before:Snapshot={at:new Date().toISOString(),label,workflow:copyOf(wf)};
    const message=change(wf)||label;assertGraph(wf);
    await updateN8nWorkflow(ctx.workflowId,body(wf) as never);
    ctx.snaps.push(before);
    return {ok:true,changed:true,message};
  });
}

function summarizeExecution(exec:Json){
  const result=exec.data?.resultData||{},nodes:Json[]=[];
  for(const [name,runs] of Object.entries<Json[]>(result.runData||{})){
    const last=runs.at(-1)||{},first=last.data?.main?.[0]?.[0]?.json;
    nodes.push({node:name,runs:runs.length,...(last.error?{error:text(last.error.message,300)}:{}),...(first?{output:text(first.text??first,500)}:{})});
  }
  return {id:exec.id,status:exec.status,finished:exec.finished,startedAt:exec.startedAt,stoppedAt:exec.stoppedAt,...(result.error?{error:text(result.error.message,300)}:{}),lastNode:result.lastNodeExecuted,nodes};
}

// A failing action becomes a failed result the assistant can read and react to; it never ends the run.
export async function runTool(ctx:ToolContext,action:Json):Promise<ToolResult>{
  try{return await dispatch(ctx,action);}catch(error){return fail((error as Error).message);}
}
async function dispatch(ctx:ToolContext,action:Json):Promise<ToolResult>{
  const kind=String(action.action||action.type||"");
  {
    switch(kind){
      case "get_workflow":{
        if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n.");
        const wf=await getN8nWorkflow(ctx.workflowId) as unknown as Json;
        return {ok:true,message:"Workflow lengkap dibaca.",data:text({name:wf.name,active:wf.active,nodes:wf.nodes,connections:wf.connections,settings:wf.settings},40_000)};
      }
      case "replace_workflow":{
        if(!Array.isArray(action.nodes)||typeof action.connections!=="object")return fail("replace_workflow butuh nodes (array) dan connections (objek).");
        let fresh=0;
        const done=await mutate(ctx,"Mengganti seluruh workflow",wf=>{
          fresh=action.nodes.filter((n:Json)=>!wf.nodes.some((o:Json)=>o.name===n.name)).length;checkBudget(ctx,fresh);
          wf.nodes=action.nodes;wf.connections=action.connections;if(action.name)wf.name=String(action.name);if(action.settings)wf.settings=action.settings;return `Workflow diganti (${wf.nodes.length} node).`;
        });
        if(done.ok&&ctx.budget)ctx.budget.adds-=fresh;
        return done;
      }
      case "add_n8n_node":{
        const done=await mutate(ctx,`Menambah node "${action.name}"`,wf=>{
          checkBudget(ctx,1);
          const name=String(action.name||action.node?.name||"");if(!name)throw new Error("Nama node wajib diisi.");
          const source=action.connect_from?find(wf,action.connect_from):undefined;
          const position=action.position||(source?[source.position[0]+260,source.position[1]]:[(wf.nodes.at(-1)?.position?.[0]||0)+260,300]);
          wf.nodes.push({id:`node-${Math.random().toString(36).slice(2,10)}`,name,type:action.node_type||action.node?.type||(typeof action.type==="string"&&action.type.includes(".")?action.type:"n8n-nodes-base.httpRequest"),typeVersion:action.typeVersion||action.node?.typeVersion||1,position,parameters:action.parameters||action.node?.parameters||{},...(action.credentials?{credentials:action.credentials}:{})});
          if(action.connect_from)connect(wf,source?.name||String(action.connect_from),name,action.connection_type||"main");
          if(action.connect_to)connect(wf,name,String(find(wf,action.connect_to)?.name||action.connect_to));
          return `Node "${name}" ditambahkan.`;
        });
        if(done.ok&&ctx.budget)ctx.budget.adds--;
        return done;
      }
      case "save_memory":
        if(!ctx.folder)return fail("Folder vault project tidak diketahui, memori tidak bisa disimpan.");
        return {ok:true,message:await addNote(ctx.folder,"memory",action.note??action.text)};
      case "save_rule":
        if(!ctx.folder)return fail("Folder vault project tidak diketahui, aturan tidak bisa disimpan.");
        return {ok:true,message:await addNote(ctx.folder,"rules",action.rule??action.note??action.text)};
      case "rewrite_memory":
        if(!ctx.folder)return fail("Folder vault project tidak diketahui, memori tidak bisa diubah.");
        return {ok:true,message:await replaceMemory(ctx.folder,action.content)};
      case "modify_n8n_node":
        return mutate(ctx,`Mengubah node "${action.node_name||action.name}"`,wf=>{
          const node=find(wf,action.node_name||action.name);if(!node)throw new Error(`Node "${action.node_name||action.name}" tidak ditemukan.`);
          if(action.set_parameters)node.parameters=action.set_parameters;
          if(action.parameters)node.parameters={...node.parameters,...action.parameters};
          if(action.prompt!==undefined){const key=node.parameters.prompt!==undefined&&node.parameters.text===undefined?"prompt":"text";node.parameters[key]=action.prompt;}
          if(action.credentials)node.credentials={...node.credentials,...action.credentials};
          if(action.disabled!==undefined)node.disabled=!!action.disabled;
          if(action.position)node.position=action.position;
          if(action.typeVersion)node.typeVersion=action.typeVersion;
          if(action.new_name&&action.new_name!==node.name)renameNode(wf,node.name,String(action.new_name));
          return `Node "${action.new_name||node.name}" diperbarui.`;
        });
      case "remove_n8n_node":
        return mutate(ctx,`Menghapus node "${action.node_name||action.name}"`,wf=>{const node=find(wf,action.node_name||action.name);if(!node)throw new Error(`Node "${action.node_name||action.name}" tidak ditemukan.`);removeNode(wf,node.name);return `Node "${node.name}" dihapus.`;});
      case "connect_nodes":
        return mutate(ctx,`Menyambung "${action.from}" ke "${action.to}"`,wf=>{const a=find(wf,action.from),b=find(wf,action.to);if(!a||!b)throw new Error("Kedua node harus ada.");connect(wf,a.name,b.name,action.connection_type||"main",action.output||0,action.input||0);return `"${a.name}" tersambung ke "${b.name}".`;});
      case "disconnect_nodes":
        return mutate(ctx,`Memutus "${action.from}" dari "${action.to}"`,wf=>{const a=find(wf,action.from),b=find(wf,action.to);if(!a||!b)throw new Error("Kedua node harus ada.");disconnect(wf,a.name,b.name,action.connection_type);return `Sambungan "${a.name}" → "${b.name}" diputus.`;});
      case "rename_workflow":
        return mutate(ctx,"Mengganti nama workflow",wf=>{if(!action.name)throw new Error("Nama baru wajib diisi.");wf.name=String(action.name);return `Workflow dinamai "${wf.name}".`;});
      case "publish_n8n_workflow":
        if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n.");
        if(action.active===false){await deactivateN8nWorkflow(ctx.workflowId);return {ok:true,changed:true,message:"Workflow dinonaktifkan."};}
        await activateN8nWorkflow(ctx.workflowId);return {ok:true,changed:true,message:"Workflow diaktifkan."};
      case "execute_n8n_workflow":{
        if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n.");
        const run=await triggerN8nWorkflow(ctx.workflowId,{brief:action.brief||action.title||"Uji coba dari asisten",title:action.title||"Uji coba asisten"});
        return {ok:run.status<400,message:`Workflow dijalankan (eksekusi ${run.execution_id}, HTTP ${run.status}).`,data:{execution_id:run.execution_id}};
      }
      case "list_executions":{
        if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n.");
        const list=await listN8nExecutions(ctx.workflowId,Number(action.limit)||10);
        return {ok:true,message:`${list.length} eksekusi terakhir.`,data:text(list.map(e=>({id:e.id,status:e.status,mulai:e.startedAt,selesai:e.stoppedAt})),6000)};
      }
      case "get_execution":{
        if(!action.execution_id)return fail("execution_id wajib diisi.");
        return {ok:true,message:"Hasil eksekusi dibaca.",data:text(summarizeExecution(await getN8nExecution(String(action.execution_id)) as unknown as Json),12_000)};
      }
      case "stop_execution":
        if(!action.execution_id)return fail("execution_id wajib diisi.");
        await stopN8nExecution(String(action.execution_id));return {ok:true,changed:true,message:`Eksekusi ${action.execution_id} dihentikan.`};
      case "list_credentials":{
        const list=await listN8nCredentials();
        return {ok:true,message:`${list.data.length} credential di n8n.`,data:text(list.data.map(c=>({id:c.id,name:c.name,type:c.type})),4000)};
      }
      case "rebuild_from_recipe":{
        if(ctx.workflowId){const wf=await getN8nWorkflow(ctx.workflowId) as unknown as Json;ctx.snaps.push({at:new Date().toISOString(),label:"Sebelum dibangun ulang dari resep",workflow:copyOf(wf)});}
        const built=await buildN8nWorkflow(ctx.channel,action.name?{name:String(action.name)}:{});
        ctx.workflowId=built.id;return {ok:true,changed:true,message:`Workflow dibangun dari resep Studio (${built.nodes} node).`};
      }
      case "undo_last_change":{
        const last=ctx.snaps.pop();if(!last)return fail("Belum ada perubahan yang bisa diurungkan di chat ini.");
        await locked(ctx.workflowId,async()=>{await updateN8nWorkflow(ctx.workflowId,last.workflow as never);});
        return {ok:true,changed:true,message:`Dikembalikan ke keadaan sebelum: ${last.label}.`};
      }
      default:return fail(`Aksi "${kind}" tidak dikenal.`);
    }
  }
}

// The assistant reads the workflow like this in every turn, so it works from the real current state.
export async function describeWorkflow(workflowId:string){
  if(!workflowId)return "Belum ada workflow n8n yang terhubung ke project ini (gunakan rebuild_from_recipe untuk membuatnya dari resep Studio).";
  try{
    const wf=await getN8nWorkflow(workflowId) as unknown as Json;
    const nodes=wf.nodes.map((n:Json)=>`- "${n.name}" [${n.type} v${n.typeVersion}]${n.disabled?" (nonaktif)":""}${n.credentials?" credential: "+Object.values<Json>(n.credentials).map(c=>c.name).join(", "):""}\n    parameter: ${text(n.parameters,600)}`).join("\n");
    const links:string[]=[];for(const [from,outputs] of Object.entries<Json>(wf.connections||{}))for(const [kind,groups] of Object.entries<any[]>(outputs))groups.forEach((group,index)=>group.forEach((l:Json)=>links.push(`"${from}" -${kind}${index?"#"+index:""}-> "${l.node}"`)));
    return text(`Workflow "${wf.name}" (ID ${wf.id}, ${wf.active?"aktif":"nonaktif"}, ${wf.nodes.length} node)\nNode:\n${nodes}\nSambungan:\n${links.join("\n")||"(belum ada)"}`,16_000);
  }catch(error){return `(Gagal membaca workflow n8n: ${(error as Error).message})`;}
}
