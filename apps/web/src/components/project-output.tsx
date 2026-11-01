"use client";
import {useCallback,useEffect,useState} from "react";
import {AudioLines,Download,FileText,Film,Folder,HardDrive,Image as ImageIcon,LoaderCircle,PackageOpen,RefreshCw} from "lucide-react";
import type {Asset,WorkflowTemplate} from "@studio/core";
import {api,Button,Modal,date} from "./ui";
import {ProjectBar,type ProjectProps} from "./project-studio";

type DriveOutputItem = {
  id?: string;
  name: string;
  path: string;
  size: number;
  kind: "video" | "vo" | "image" | "doc";
  assetId?: string;
};

const formatSize = (bytes: number) => bytes < 1024 ? bytes + " B" : bytes < 1048576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(1) + " MB";

const extKind = (filepath: string): "video" | "vo" | "image" | "doc" => {
  const ext = filepath.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "webm", "mkv", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(ext)) return "vo";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  return "doc";
};

export function ProjectOutput(props: ProjectProps & { workflow: WorkflowTemplate }) {
  const { project, perform, busy } = props;
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState("");
  const [items, setItems] = useState<DriveOutputItem[]>([]);
  const [filter, setFilter] = useState<"all" | "video" | "vo" | "image" | "doc">("all");
  const [preview, setPreview] = useState<DriveOutputItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ project: string; folder: string; files: { id: string; path: string; size: number }[]; assets: Asset[] }>("projects/" + project + "/drive");
      setFolder(data.folder);
      const assetMap = new Map(data.assets.map(a => [a.drive_path, a]));
      const list: DriveOutputItem[] = data.files.map(f => {
        const matchingAsset = assetMap.get(f.path);
        const name = f.path.split("/").pop() || f.path;
        return {
          id: f.id,
          name,
          path: f.path,
          size: f.size,
          kind: extKind(f.path),
          assetId: matchingAsset?.id
        };
      });
      // Also include any assets that may have been generated directly
      for (const a of data.assets) {
        if (!list.some(item => item.path === a.drive_path)) {
          list.push({
            id: a.id,
            name: a.title || a.drive_path.split("/").pop() || "Asset",
            path: a.drive_path,
            size: Number(a.meta?.size) || 0,
            kind: a.kind === "video" || a.kind === "render" ? "video" : a.kind === "vo" || a.kind === "music" ? "vo" : ["image", "thumb"].includes(a.kind) ? "image" : "doc",
            assetId: a.id
          });
        }
      }
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = () => void perform(async () => {
    await api("projects/" + project + "/drive/sync", {});
    await load();
  });

  const visible = items.filter(item => filter === "all" || item.kind === filter);

  return <div className="pj-page">
    <ProjectBar props={props} tab="assets">
      <div className="pj-bar-actions">
        <Button disabled={busy || loading} onClick={sync} title="Sinkronkan file asset untuk project ini">
          <RefreshCw size={13} className={loading ? "spin" : ""} />
          Sinkronkan
        </Button>
      </div>
    </ProjectBar>

    <div className="po-body">
      <header className="po-head">
        <div>
          <span className="eyebrow">PROJECT ASSETS</span>
          <h1>Assets Project</h1>
          <p>Semua hasil generate n8n dan media project ini. Tersimpan fleksibel di folder lokal (<code>{folder || `Faceless/...`}</code>) atau penyimpanan cloud yang terhubung.</p>
        </div>
        <div className="pj-tabs" role="tablist" aria-label="Filter output">
          {(["all", "video", "vo", "image", "doc"] as const).map(f => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "Semua" : f === "video" ? "Video" : f === "vo" ? "Audio / VO" : f === "image" ? "Gambar" : "Dokumen"}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="po-empty">
          <LoaderCircle size={26} className="spin" />
          <p>Memuat asset project…</p>
        </div>
      ) : !visible.length ? (
        <div className="po-empty">
          <PackageOpen size={30} strokeWidth={1.3} />
          <strong>Belum ada asset di project ini</strong>
          <p>Jalankan workflow n8n untuk menghasilkan video, suara, atau gambar. Gunakan tombol <strong>Sinkronkan</strong> untuk memperbarui daftar asset.</p>
        </div>
      ) : (
        <div className="po-grid">
          {visible.map(item => {
            const previewUrl = item.assetId ? `/api/assets/${item.assetId}/preview` : "";
            const Icon = item.kind === "video" ? Film : item.kind === "vo" ? AudioLines : item.kind === "image" ? ImageIcon : FileText;
            return (
              <button key={item.path} className="po-item" onClick={() => setPreview(item)}>
                <span className="po-thumb">
                  {item.kind === "image" && previewUrl ? (
                    <img src={previewUrl} alt="" loading="lazy" />
                  ) : (
                    <Icon size={24} />
                  )}
                </span>
                <span className="po-meta">
                  <b title={item.name}>{item.name}</b>
                  <small>{formatSize(item.size)} · {item.kind.toUpperCase()}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>

    {preview && (
      <Modal title={preview.name} wide close={() => setPreview(null)}>
        <div className="media-player">
          {preview.assetId ? (
            preview.kind === "image" ? (
              <img alt="" src={`/api/assets/${preview.assetId}/preview`} />
            ) : preview.kind === "vo" ? (
              <audio controls autoPlay src={`/api/assets/${preview.assetId}/preview`} />
            ) : preview.kind === "video" ? (
              <video controls autoPlay src={`/api/assets/${preview.assetId}/preview`} />
            ) : (
              <div className="po-text-preview">
                <FileText size={32} />
                <p>Dokumen disimpan di: <code>{preview.path}</code></p>
              </div>
            )
          ) : (
            <div className="po-text-preview">
              <HardDrive size={32} />
              <p>Lokasi file: <code>{preview.path}</code></p>
            </div>
          )}
          <div className="button-row" style={{ marginTop: 12 }}>
            {preview.assetId && (
              <a className="button primary" href={`/api/assets/${preview.assetId}/preview`} download={preview.name}>
                <Download size={13} />
                Unduh file
              </a>
            )}
          </div>
        </div>
      </Modal>
    )}
  </div>;
}
