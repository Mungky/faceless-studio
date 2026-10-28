export const workspaceViews = ["projects", "studio", "episodes", "analytics", "assets", "jobs", "connections", "models", "spending"] as const;
export type View = typeof workspaceViews[number];
export interface StudioLocation { view: View; project: string; episode: string; tab?: "videos"; video?: string; workflow?: string; run?: string; }
const validId = (value: string | null) => value && /^[a-zA-Z0-9]{15}$/.test(value) ? value : "";
export function readStudioLocation(search: string): StudioLocation {
  const params = new URLSearchParams(search), view = params.get("view");
  const episode = validId(params.get("episode"));
  const next = episode || view === "episodes" ? "studio" : view === "analytics" ? "projects" : workspaceViews.includes(view as View) ? view as View : "projects";
  const videos = next === "projects" && (params.get("tab") === "videos" || view === "analytics");
  const video = params.get("video") || "";
  const run=validId(params.get("run")),workflow=params.get("workflow")||"";
  return { view: next, project: validId(params.get("project")), episode, ...(next==="studio"&&!episode?(run?{run}:/^[a-zA-Z0-9_-]{1,64}$/.test(workflow)?{workflow}:{}):{}), ...(videos ? {tab:"videos" as const, ...(/^[a-zA-Z0-9_-]{11}$/.test(video) ? {video} : {})} : {}) };
}
export function studioUrl(location: StudioLocation): string {
  const view = location.view === "episodes" ? "studio" : location.view === "analytics" ? "projects" : location.view;
  const params = new URLSearchParams({ view });
  if (validId(location.project)) params.set("project", location.project);
  if (view === "studio" && validId(location.episode)) params.set("episode", location.episode);
  else if(view==="studio"){if(validId(location.run||""))params.set("run",location.run!);else if(/^[a-zA-Z0-9_-]{1,64}$/.test(location.workflow||""))params.set("workflow",location.workflow!);}
  if (view === "projects" && (location.tab === "videos" || location.view === "analytics")) { params.set("tab", "videos"); if (/^[a-zA-Z0-9_-]{11}$/.test(location.video || "")) params.set("video", location.video!); }
  return "/?" + params.toString();
}
