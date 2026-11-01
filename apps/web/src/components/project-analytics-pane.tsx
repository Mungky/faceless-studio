"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ProjectBar, type ProjectProps } from "./project-studio";
import { ProjectAnalytics } from "./project-analytics";
import { VideoAnalytics } from "./video-analytics";
import { Button } from "./ui";
import type { QuoteRequest } from "@studio/core";

export function ProjectAnalyticsPane(props: ProjectProps) {
  const { project, data, busy, perform, refresh } = props;
  const channel = data.channels.find(c => c.id === project);
  const [selectedVideo, setSelectedVideo] = useState("");

  if (!channel) {
    return (
      <div className="pj-page">
        <ProjectBar props={props} tab="analytics" />
        <div className="po-body">
          <p className="muted">Channel tidak ditemukan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pj-page">
      <ProjectBar props={props} tab="analytics">
        {selectedVideo && (
          <div className="pj-bar-actions">
            <Button onClick={() => setSelectedVideo("")}>
              <ArrowLeft size={14} /> Kembali ke Ringkasan
            </Button>
          </div>
        )}
      </ProjectBar>

      <div className="po-body" style={{ padding: "20px 24px" }}>
        {selectedVideo ? (
          <VideoAnalytics
            data={data}
            channel={channel}
            videoId={selectedVideo}
            onVideoChange={setSelectedVideo}
            busy={busy}
            run={perform}
            refresh={refresh}
            openEpisode={() => undefined}
            quote={(_req: QuoteRequest) => undefined}
            onRangeChange={() => undefined}
          />
        ) : (
          <ProjectAnalytics
            data={data}
            channel={channel}
            busy={busy}
            run={perform}
            refresh={refresh}
            openEpisode={() => undefined}
            navigate={() => undefined}
            openVideoAnalytics={id => setSelectedVideo(id)}
          />
        )}
      </div>
    </div>
  );
}
