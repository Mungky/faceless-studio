"use client";

import { useState, useCallback } from "react";
import { Sparkles } from "lucide-react";
import type { WorkflowTemplate } from "@studio/core";
import { ProjectBar, type ProjectProps } from "./project-studio";
import { ProjectChat } from "./project-chat";
import { N8nPane } from "./n8n-pane";
import { projectPrefs, projectName } from "./project-model";
import "./workflow-studio.css";

// Workflow: n8n canvas paired with Hermes Agent Copilot chat
export function ProjectWorkflow(props: ProjectProps & { workflow: WorkflowTemplate; run: string }) {
  const { project, data, workspace, busy, perform, refresh, workflow } = props;
  const [chatOpen, setChatOpen] = useState(true);
  const [reloadEpoch, setReloadEpoch] = useState(0);

  const channel = data.channels.find(c => c.id === project);
  const name = channel ? projectName(channel, projectPrefs(workspace, project)) : project;

  const handleRefresh = useCallback(async () => {
    setReloadEpoch(v => v + 1);
    await refresh();
  }, [refresh]);

  return (
    <div className={"studio-stage pj-stage" + (chatOpen ? " has-chat" : "")}>
      <ProjectBar props={props} tab="workflow" />

      <div className="studio-canvas-layer">
        <N8nPane project={project} busy={busy} perform={perform} reload={reloadEpoch} />
      </div>

      {chatOpen ? (
        <ProjectChat
          project={project}
          projectName={name}
          workflow={workflow}
          selectedRun=""
          clearRun={() => undefined}
          busy={busy}
          perform={perform}
          refresh={handleRefresh}
          openTask={() => undefined}
          minimize={() => setChatOpen(false)}
        />
      ) : (
        <button className="studio-pill pj-chat-pill" onClick={() => setChatOpen(true)}>
          <Sparkles size={15} />
          Hermes Copilot
        </button>
      )}
    </div>
  );
}
