export interface ProductionSegment{index:number;start:number;end:number;}
export function productionTimeline(beats:{index:number;seconds:number}[]):ProductionSegment[]{
  let elapsed=0;
  return beats.map((beat,index)=>{if(beat.index!==index+1||!Number.isFinite(beat.seconds)||beat.seconds<0.1||beat.seconds>600)throw new Error("Save ordered scenes with valid durations before inspecting the timeline.");const start=elapsed;elapsed+=beat.seconds;return {index:beat.index,start,end:elapsed};});
}
export function sceneAt(timeline:ProductionSegment[],seconds:number):ProductionSegment|null{
  if(!Number.isFinite(seconds))throw new Error("Choose a finite timeline time.");
  const last=timeline.at(-1);if(!last)return null;
  const time=Math.max(0,Math.min(last.end,seconds));return timeline.find(segment=>time>=segment.start&&time<segment.end)||last;
}
