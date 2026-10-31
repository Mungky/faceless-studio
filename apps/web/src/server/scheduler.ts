import "server-only";
import {randomUUID} from "node:crypto";
import {dueProductionSlots,boundedResearchDirection,assertAutomaticQuote,defaultChannelPreferences,channelPreferencesSchema,reportRange,type Channel,type Episode,type ScheduledTask,type ChannelPreferences,type WorkspaceRecord,type ModelRoute,type WorkflowRun,type SpendQuote} from "@studio/core";
import {db,filterValue} from "./pocketbase";
import {workspaceRows,workspaceRecord,saveWorkspace,createProduction,discover,generateVideoReport} from "./workspace";
import {actWorkflowRun,messageWorkflowRun} from "./workflows";
import {syncProject,syncVideoAnalytics} from "./projects";
export async function automationTick(){
  const now=new Date(),day=now.toISOString().slice(0,10),results:{channel:string;task?:string;error?:string}[]=[];const channels=await db.list<Channel>("channels");
  for(const channel of channels){try{
    const prefs=channelPreferencesSchema.parse((await workspaceRecord<ChannelPreferences>("preferences:"+channel.id))?.data||defaultChannelPreferences(channel.id));
    const tasks=await workspaceRows<ScheduledTask>(channel.id,"task");const episodes=await db.list<Episode>("episodes","channel="+filterValue(channel.id));
    const active=episodes.filter(e=>e.status!=="published"&&!e.youtube_video_id).length;const pending=tasks.filter(t=>t.data.kind==="research"&&!t.data.run_id&&["queued","running","blocked"].includes(t.data.status)).length;
    const due=dueProductionSlots(prefs,now,active+pending,tasks.map(t=>t.key)).map(slot=>({...slot,kind:"research" as const}));
    if(prefs.analytics_enabled)due.push({key:"analytics:"+channel.id+":"+day,target_at:now.toISOString(),kind:"analytics" as any});
    if(prefs.competitor_enabled)due.push({key:"competitors:"+channel.id+":"+day,target_at:now.toISOString(),kind:"competitors" as any});
    for(const slot of due){if(tasks.some(t=>t.key===slot.key))continue;const task:ScheduledTask={id:randomUUID(),key:slot.key,channel:channel.id,kind:slot.kind,status:"queued",target_at:slot.target_at,created:now.toISOString(),attempts:0,revision:1};try{await saveWorkspace(slot.key,"task",channel.id,task,undefined,true);}catch(error){if(!String(error).includes("already exists"))throw error;}}
  }catch(error){results.push({channel:channel.id,error:(error as Error).message});}}
  const owner=(await db.list<{id:string}>("studio_users","","created",1))[0];if(!owner)throw new Error("Studio owner is unavailable.");
  // Atomic database claims cover overlapping cron calls and server restarts.
  for(let i=0;i<4;i++){
    const claimed=await db.custom<{record:WorkspaceRecord<ScheduledTask>|null}>("workspace-task-claim",{});if(!claimed.record)break;const row=claimed.record,task=row.data;
    try{
      if(task.kind==="research"){
        const prefs=channelPreferencesSchema.parse((await workspaceRecord<ChannelPreferences>("preferences:"+task.channel))?.data||defaultChannelPreferences(task.channel));
        if(!prefs.research_enabled)throw new Error("Riset otomatis dimatikan untuk channel ini.");
        const route=(await db.list<ModelRoute>("model_routes","task=\"research\""))[0];if(!route||route.billing!=="free")throw new Error("Riset otomatis memerlukan rute research gratis yang sudah dikonfirmasi. Rute berbayar tetap melalui persetujuan.");
        const refs=await discover(task.channel,{mode:"niche",query:prefs.niche});
        const direction=boundedResearchDirection(task.target_at,refs);
        const created=await createProduction({channel:task.channel,title:"Riset · "+new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:prefs.timezone}).format(new Date(task.target_at)),entry_mode:"research",content:prefs.niche||"Temukan ide berikutnya berdasarkan sejarah channel dan referensi.",request_key:row.key},owner.id);
        task.run_id=created.run.id;task.revision++;await saveWorkspace(row.key,row.kind,task.channel,task,row.data.revision-1);
        if(created.run.graph.nodes.some(n=>created.run.states[n.id]?.quote||created.run.states[n.id]?.status==="waiting_review"||created.run.states[n.id]?.status==="running"))throw new Error("Episode hasil pemulihan memerlukan pemeriksaan. Provider tidak dipanggil ulang.");
        const directed=await messageWorkflowRun(created.run.id,{expected_revision:created.run.revision,content:direction},owner.id);
        const prepared=await actWorkflowRun(created.run.id,{action:"prepare",expected_revision:directed.run.revision},owner.id);const node=prepared.run.graph.nodes.find(n=>n.kind==="research"),state=node&&prepared.run.states[node.id];
        if(!node||!state?.quote)throw new Error(state?.error||"Riset belum dapat disiapkan.");
        const actual=await db.get<SpendQuote&{payload:{billing?:string}}>("spend_quotes",state.quote.id);assertAutomaticQuote(actual);
        const outcome=await actWorkflowRun(prepared.run.id,{action:"approve",node_id:node.id,quote_id:state.quote.id,expected_revision:prepared.run.revision},owner.id);if(["blocked","failed"].includes(outcome.run.states[node.id]?.status))throw new Error(outcome.run.states[node.id]?.error||"Riset memerlukan pemeriksaan hasil.");
      }else if(task.kind==="analytics"){
        const range=reportRange(28),project=await syncProject(task.channel,range.start,range.end);
        const existing=await workspaceRows<any>(task.channel,"report");const catalog=project.videos.filter(v=>v.visibility==="public").sort((a,b)=>Number(existing.some(r=>r.data.video_id===a.id))-Number(existing.some(r=>r.data.video_id===b.id))||b.published_at.localeCompare(a.published_at));
        for(const video of catalog.slice(0,12)){await syncVideoAnalytics(task.channel,video.id,range.start,range.end);await generateVideoReport(task.channel,video.id,range);}
      }else if(task.kind==="competitors")await discover(task.channel,{mode:"manual",query:""});
      task.status="done";task.error="";
    }catch(error){task.status="blocked";task.error=(error as Error).message;}
    const revision=task.revision;task.revision++;task.lease_until="";await saveWorkspace(row.key,row.kind,task.channel,task,revision);results.push({channel:task.channel,task:task.id,...(task.error?{error:task.error}:{})});
  }
  return {results};
}
