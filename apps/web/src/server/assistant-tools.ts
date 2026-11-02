import "server-only";
import {
  buildN8nWorkflow,getN8nWorkflow,updateN8nWorkflow,activateN8nWorkflow,deactivateN8nWorkflow,triggerN8nWorkflow,
  listN8nExecutions,getN8nExecution,stopN8nExecution,listN8nCredentials
} from "./n8n";
import {addNote,replaceMemory} from "./assistant-memory";
import {listSkills,readSkill,saveSkill} from "./assistant-skills";

// Everything the project assistant may do to the project's n8n workflow. It acts directly: before each
// change the workflow is copied into the chat's snapshots, so "undo_last_change" can put it back.
type Json=Record<string,any>;
export type Snapshot={at:string;label:string;workflow:{name:string;nodes:unknown[];connections:Json;settings?:Json}};
// approval: set when the action was NOT run because it needs the owner's button press (see approvalReason).
// changes/before: what this one action really changed (read back from n8n) and the workflow as it was just before it.
export type ToolResult={ok:boolean;message:string;data?:unknown;changed?:boolean;approval?:string;changes?:Changes;before?:Snapshot["workflow"]};
// folder: the project's folder in the vault (memory and rules live there). budget: how many new
// nodes this run may still add before the owner has to approve more. approved: the owner pressed
// "Izinkan" for exactly this action, so the approval gate is skipped.
export type ToolContext={channel:string;workflowId:string;snaps:Snapshot[];folder?:string;budget?:{adds:number};approved?:boolean};
export const NODE_ADD_LIMIT=2;

// Actions that can destroy work or start things on their own never run on the model's say-so alone:
// they wait for the owner's button. The reason is what the owner sees on the card.
export function approvalReason(ctx:ToolContext,action:Json):string{
  switch(String(action.action||action.type||"")){
    case "rebuild_from_recipe":return "Membangun ulang workflow dari resep Studio MENIMPA seluruh isi workflow sekarang (cadangan disimpan, tapi semua perubahan manual diganti).";
    case "replace_workflow":return `Mengganti seluruh isi workflow dengan ${Array.isArray(action.nodes)?action.nodes.length:"?"} node yang disusun assistant.`;
    case "restore_from_execution":return `Mengganti seluruh isi workflow dengan salinan yang tersimpan di eksekusi ${action.execution_id||"?"}.`;
    case "publish_n8n_workflow":return action.active===false?"":"Mengaktifkan workflow: semua jadwalnya akan mulai berjalan sendiri.";
    case "add_n8n_node":return ctx.budget&&ctx.budget.adds<=0?`Menambah node di atas batas ${NODE_ADD_LIMIT} per pesan.`:"";
    default:return "";
  }
}
// Deep merge for node parameters: a partial edit changes only what it names and keeps its siblings.
function deepMerge(base:unknown,patch:unknown):unknown{
  if(patch&&typeof patch==="object"&&!Array.isArray(patch)&&base&&typeof base==="object"&&!Array.isArray(base)){
    const out:Json={...(base as Json)};for(const [k,v] of Object.entries(patch as Json))out[k]=deepMerge((base as Json)[k],v);return out;
  }
  return patch;
}
function setPath(target:Json,path:string,value:unknown){
  const parts=path.split(".").filter(Boolean);if(!parts.length)throw new Error("path kosong.");
  let at=target;for(const part of parts.slice(0,-1)){if(!at[part]||typeof at[part]!=="object")at[part]={};at=at[part];}
  at[parts.at(-1)!]=value;
}

// What really changed between two versions of the workflow. The owner sees this after every turn,
// whatever the assistant claims in its own words.
export type Changes={added:string[];removed:string[];changed:{node:string;fields:string[]}[];links:boolean;meta:string[]};
function leafPaths(a:unknown,b:unknown,prefix=""):string[]{
  if(JSON.stringify(a)===JSON.stringify(b))return [];
  const obj=(v:unknown)=>!!v&&typeof v==="object"&&!Array.isArray(v);
  if(obj(a)&&obj(b)){const keys=new Set([...Object.keys(a as Json),...Object.keys(b as Json)]);return [...keys].flatMap(k=>leafPaths((a as Json)[k],(b as Json)[k],prefix?prefix+"."+k:k));}
  return [prefix||"(isi)"];
}
export function diffWorkflow(before:Json,after:Json):Changes{
  const a=new Map<string,Json>(before.nodes.map((n:Json)=>[n.name,n])),b=new Map<string,Json>(after.nodes.map((n:Json)=>[n.name,n]));
  const changed:Changes["changed"]=[];
  for(const [name,x] of a){const y=b.get(name);if(!y)continue;
    const fields=[...leafPaths(x.parameters,y.parameters),...["type","typeVersion","disabled","credentials"].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]))];
    if(fields.length)changed.push({node:name,fields:fields.slice(0,8)});}
  const meta=[before.name!==after.name?"nama workflow":"",JSON.stringify(before.settings||{})!==JSON.stringify(after.settings||{})?"pengaturan workflow":"",Boolean(before.active)!==Boolean(after.active)?(after.active?"workflow diaktifkan":"workflow dinonaktifkan"):""].filter(Boolean);
  return {added:[...b.keys()].filter(n=>!a.has(n)),removed:[...a.keys()].filter(n=>!b.has(n)),changed,links:JSON.stringify(before.connections||{})!==JSON.stringify(after.connections||{}),meta};
}
export const hasChanges=(c:Changes)=>!!(c.added.length||c.removed.length||c.changed.length||c.links||c.meta.length);
// Several actions in one turn add up to one list.
export function mergeChanges(a:Changes|null,b:Changes):Changes{
  if(!a)return b;
  const changed=new Map(a.changed.map(c=>[c.node,[...c.fields]]));
  for(const c of b.changed)changed.set(c.node,[...new Set([...(changed.get(c.node)||[]),...c.fields])].slice(0,8));
  const added=[...new Set([...a.added,...b.added])],removed=[...new Set([...a.removed,...b.removed])];
  return {added:added.filter(n=>!removed.includes(n)||!a.added.includes(n)),removed:removed.filter(n=>!added.includes(n)||!a.removed.includes(n)),changed:[...changed].map(([node,fields])=>({node,fields})),links:a.links||b.links,meta:[...new Set([...a.meta,...b.meta])]};
}
export const plainWorkflow=(wf:Json):Json=>({name:wf.name,active:wf.active,nodes:wf.nodes,connections:wf.connections,settings:wf.settings});
function checkBudget(ctx:ToolContext,count:number){
  if(ctx.budget&&count>ctx.budget.adds)throw new Error(`Batas ${NODE_ADD_LIMIT} node baru per pesan pemilik sudah tercapai (sisa ${ctx.budget.adds}).`);
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
    const before:Snapshot={at:new Date().toISOString(),label,workflow:copyOf(wf)},was=structuredClone(plainWorkflow(wf));
    const message=change(wf)||label;assertGraph(wf);
    await updateN8nWorkflow(ctx.workflowId,body(wf) as never);
    // Read it back: what n8n kept is what counts, not what was sent. The difference belongs to this action alone.
    const changes=diffWorkflow(was,plainWorkflow(await getN8nWorkflow(ctx.workflowId) as never));
    if(!hasChanges(changes))return {ok:true,changed:false,message:`${message} Tapi tidak ada yang berbeda di n8n (nilainya sudah sama atau n8n tidak menyimpannya).`};
    ctx.snaps.push(before);
    return {ok:true,changed:true,message,changes,before:before.workflow};
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
  try{
    const reason=ctx.approved?"":approvalReason(ctx,action);
    if(reason)return {ok:false,approval:reason,message:`BELUM DIJALANKAN. Butuh persetujuan pemilik lewat tombol "Izinkan" di layar: ${reason} Jelaskan singkat apa yang akan dilakukan, lalu berhenti. Jangan mengulang aksi ini; mengetik "iya" di chat tidak cukup.`};
    return await dispatch(ctx,action);
  }catch(error){return fail((error as Error).message);}
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
        // Always owner-approved (see approvalReason), so it is not counted against the per-message node budget.
        return mutate(ctx,"Mengganti seluruh workflow",wf=>{
          wf.nodes=action.nodes;wf.connections=action.connections;if(action.name)wf.name=String(action.name);if(action.settings)wf.settings=action.settings;return `Workflow diganti (${wf.nodes.length} node).`;
        });
      }
      case "set_node_param":
        return mutate(ctx,`Mengubah ${action.path} di node "${action.node_name}"`,wf=>{
          const node=find(wf,action.node_name);if(!node)throw new Error(`Node "${action.node_name}" tidak ditemukan.`);
          if(typeof action.path!=="string"||!action.path.trim())throw new Error("path wajib diisi, misalnya \"options.fileName\".");
          setPath(node.parameters,action.path,action.value);
          return `Node "${node.name}": ${action.path} diubah.`;
        });
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
          if(action.parameters)node.parameters=deepMerge(node.parameters,action.parameters);
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
        if(action.active===false){await deactivateN8nWorkflow(ctx.workflowId);return {ok:true,changed:true,message:"Workflow dinonaktifkan.",changes:{added:[],removed:[],changed:[],links:false,meta:["workflow dinonaktifkan"]}};}
        await activateN8nWorkflow(ctx.workflowId);return {ok:true,changed:true,message:"Workflow diaktifkan.",changes:{added:[],removed:[],changed:[],links:false,meta:["workflow diaktifkan"]}};
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
      // n8n keeps a copy of the workflow in every execution: the way back when work was overwritten.
      case "restore_from_execution":{
        if(!ctx.workflowId)return fail("Project ini belum punya workflow n8n.");
        if(!action.execution_id)return fail("execution_id wajib diisi (lihat list_executions).");
        const saved=(await getN8nExecution(String(action.execution_id)) as unknown as Json).workflowData;
        if(!saved?.nodes||!saved?.connections)return fail("Eksekusi itu tidak menyimpan salinan workflow.");
        return mutate(ctx,`Memulihkan dari eksekusi ${action.execution_id}`,wf=>{wf.nodes=structuredClone(saved.nodes);wf.connections=structuredClone(saved.connections);return `Workflow dipulihkan dari eksekusi ${action.execution_id} (${wf.nodes.length} node).`;});
      }
      case "list_skills":{
        if(!ctx.folder)return fail("Folder vault project tidak diketahui.");
        const list=await listSkills(ctx.folder);
        return {ok:true,message:`${list.length} skill tersedia.`,data:text(list.map(s=>`${s.name} (${s.scope}): ${s.description}`).join("\n"),4000)};
      }
      case "read_skill":{
        if(!ctx.folder)return fail("Folder vault project tidak diketahui.");
        const skill=await readSkill(ctx.folder,action.name);
        return {ok:true,message:`Skill "${skill.name}" dibaca. Ikuti langkahnya.`,data:skill.content};
      }
      case "save_skill":
        if(!ctx.folder)return fail("Folder vault project tidak diketahui, skill tidak bisa disimpan.");
        return {ok:true,message:await saveSkill(ctx.folder,action)};
      case "list_credentials":{
        const list=await listN8nCredentials();
        return {ok:true,message:`${list.data.length} credential di n8n.`,data:text(list.data.map(c=>({id:c.id,name:c.name,type:c.type})),4000)};
      }
      case "rebuild_from_recipe":{
        let old:Json|null=null;
        if(ctx.workflowId){old=await getN8nWorkflow(ctx.workflowId) as unknown as Json;ctx.snaps.push({at:new Date().toISOString(),label:"Sebelum dibangun ulang dari resep",workflow:copyOf(old)});}
        const built=await buildN8nWorkflow(ctx.channel,action.name?{name:String(action.name)}:{});
        ctx.workflowId=built.id;
        const changes=old?diffWorkflow(plainWorkflow(old),plainWorkflow(await getN8nWorkflow(built.id) as never)):undefined;
        return {ok:true,changed:true,message:`Workflow dibangun dari resep Studio (${built.nodes} node).`,...(changes?{changes,before:copyOf(old!)}:{})};
      }
      case "undo_last_change":{
        const last=ctx.snaps.pop();if(!last)return fail("Belum ada perubahan yang bisa diurungkan di chat ini.");
        const current=await getN8nWorkflow(ctx.workflowId) as unknown as Json;
        await locked(ctx.workflowId,async()=>{await updateN8nWorkflow(ctx.workflowId,last.workflow as never);});
        const changes=diffWorkflow(plainWorkflow(current),plainWorkflow(await getN8nWorkflow(ctx.workflowId) as never));
        return {ok:true,changed:true,message:`Dikembalikan ke keadaan sebelum: ${last.label}.`,changes,before:copyOf(current)};
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
