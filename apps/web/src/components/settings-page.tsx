"use client";

import { useState } from "react";
import { ModelSettings, ServiceSettings } from "./connection-settings";
import { StorageInfo, YoutubeConnections } from "./settings";
import type { Dashboard } from "./ui";
import type { Perform } from "./workspace-types";

const tabs = [
  { id: "models", label: "Model AI" },
  { id: "services", label: "Layanan" },
  { id: "storage", label: "Penyimpanan" },
  { id: "accounts", label: "Akun YouTube" }
] as const;

type Tab = typeof tabs[number]["id"];

export function SettingsPage({
  data,
  busy,
  perform,
  refresh,
  tab
}: {
  data: Dashboard;
  busy: boolean;
  perform: Perform;
  refresh: () => Promise<void>;
  tab?: string;
}) {
  const [active, setActive] = useState<Tab>(
    tabs.some(t => t.id === tab) ? (tab as Tab) : "models"
  );

  return (
    <div className="settings-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Pengaturan</h1>
          <p>Konfigurasi model AI utama, status layanan, dan penyimpanan project.</p>
        </div>
      </header>
      <nav className="channel-tabs" aria-label="Bagian pengaturan">
        {tabs.map(t => (
          <button
            key={t.id}
            aria-current={active === t.id ? "page" : undefined}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {active === "models" && (
          <ModelSettings data={data} busy={busy} perform={perform} refresh={refresh} />
        )}
        {active === "services" && (
          <ServiceSettings busy={busy} perform={perform} />
        )}
        {active === "storage" && <StorageInfo data={data} />}
        {active === "accounts" && (
          <YoutubeConnections channels={data.channels} data={data} />
        )}
      </div>
    </div>
  );
}
