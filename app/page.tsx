"use client";

// @phase TQ-03/TQ-06 — independent production studio with accounts and autosave.

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildAss, buildSrt, buildVtt } from "../lib/media-core.mjs";

type View = "home" | "projects" | "studio" | "quran" | "renders" | "settings";
type StudioStep = "source" | "sync" | "design" | "review" | "render";
type Ratio = "16:9" | "9:16" | "1:1";
type ProjectStatus = "draft" | "review" | "ready";

type Segment = {
  id: string;
  surah: string;
  surahNumber: number;
  ayah: number;
  start: number;
  end: number;
  arabic: string;
  translation: string;
  confidence: number;
  verified: boolean;
};

type Project = {
  id: string;
  title: string;
  updatedAt: string;
  status: ProjectStatus;
  ratio: Ratio;
  duration: number;
  progress: number;
  audioName?: string;
  audioAssetId?: string;
  backgroundAssetId?: string;
  serverVersion?: number;
  segments: Segment[];
};

type RenderJob = {
  id: string;
  projectId: string;
  title: string;
  ratio: Ratio;
  resolution: string;
  progress: number;
  status: "queued" | "processing" | "complete" | "failed" | "cancelled";
  format: "MP4" | "WebM";
  outputUrl?: string;
  error?: string;
};

type ServerCapabilities = {
  ffmpeg: boolean;
  transcription: boolean;
  transcriptionModel?: string | null;
  quran: { available: boolean; counts?: { surahs: number; ayahs: number; pages: number; juz: number; rubus: number }; checksum?: string };
  maxUploadBytes?: number;
  persistence?: { configured: boolean; healthy: boolean; database?: string };
  storage?: { driver: string; configured: boolean; healthy: boolean };
  queue?: { configured: boolean; healthy: boolean };
  collaboration?: boolean;
  version?: string;
};

type SessionInfo = {
  authenticated: boolean;
  user?: { id: string; email: string; displayName: string };
  workspaces?: { id: string; name: string; slug: string; role: "owner" | "editor" | "reviewer" | "viewer" }[];
};

type TranscriptPart = { text: string; start?: number; end?: number; avg_logprob?: number; words?: { word?: string; start?: number; end?: number; probability?: number }[] };
type AlignedPart = { matched: boolean; confidence: number; repeated?: boolean; start?: number | null; end?: number | null; ayah?: { surah: string; surahNumber: number; ayah: number; arabic: string; score: number } };
type ReviewComment = { id: string; at_seconds: number; body: string; display_name: string; resolved_at?: string | null; created_at: string };
type ContentSource = { edition: string; kind: string; language: string; name: string; author?: string; licenseName: string; enabled: boolean; redistributionAllowed: boolean };
type WorkspaceMember = { id: string; email: string; display_name: string; role: "owner" | "editor" | "reviewer" | "viewer" };

const STORAGE_KEY = "taysriul-qurani-v0.1";

const sampleSegments: Segment[] = [
  {
    id: "seg-1",
    surah: "Al-Fatihah",
    surahNumber: 1,
    ayah: 1,
    start: 0,
    end: 4.8,
    arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    translation: "Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.",
    confidence: 98,
    verified: true,
  },
  {
    id: "seg-2",
    surah: "Al-Fatihah",
    surahNumber: 1,
    ayah: 2,
    start: 4.8,
    end: 10.7,
    arabic: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    translation: "Segala puji bagi Allah, Tuhan seluruh alam.",
    confidence: 96,
    verified: true,
  },
  {
    id: "seg-3",
    surah: "Al-Fatihah",
    surahNumber: 1,
    ayah: 3,
    start: 10.7,
    end: 14.9,
    arabic: "الرَّحْمَٰنِ الرَّحِيمِ",
    translation: "Yang Maha Pengasih, Maha Penyayang.",
    confidence: 92,
    verified: false,
  },
];

const initialProjects: Project[] = [
  {
    id: "project-fatihah",
    title: "Al-Fatihah • Video Tadabbur",
    updatedAt: new Date().toISOString(),
    status: "review",
    ratio: "16:9",
    duration: 14.9,
    progress: 72,
    segments: sampleSegments,
  },
];

const waveform = [
  18, 34, 26, 54, 78, 42, 63, 86, 48, 31, 67, 91, 58, 42, 75, 62, 29, 47,
  84, 69, 38, 57, 93, 71, 46, 82, 61, 36, 55, 88, 72, 51, 64, 97, 66, 43,
  59, 80, 53, 28, 62, 89, 70, 41, 77, 56, 32, 49, 85, 64, 37, 73, 92, 58,
  44, 68, 83, 52, 35, 61, 87, 73, 48, 66, 94, 57, 39, 71, 81, 46, 30, 60,
];

const navItems: { id: View; label: string; hint: string; icon: IconName }[] = [
  { id: "home", label: "Beranda", hint: "Ringkasan", icon: "home" },
  { id: "projects", label: "Proyek", hint: "Karya Anda", icon: "folder" },
  { id: "studio", label: "Studio", hint: "Ruang kerja", icon: "studio" },
  { id: "quran", label: "Sumber Qur'an", hint: "Korpus & tafsir", icon: "book" },
  { id: "renders", label: "Render", hint: "Antrean video", icon: "play" },
];

const studioSteps: { id: StudioStep; label: string; index: string }[] = [
  { id: "source", label: "Sumber", index: "01" },
  { id: "sync", label: "Sinkronisasi", index: "02" },
  { id: "design", label: "Desain", index: "03" },
  { id: "review", label: "Pemeriksaan", index: "04" },
  { id: "render", label: "Render", index: "05" },
];

type IconName =
  | "home"
  | "folder"
  | "studio"
  | "book"
  | "play"
  | "settings"
  | "plus"
  | "upload"
  | "spark"
  | "check"
  | "clock"
  | "chevron"
  | "more"
  | "search"
  | "download"
  | "shield"
  | "globe"
  | "audio"
  | "layers"
  | "close"
  | "pause";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
    folder: <><path d="M3 6.5h7l2 2h9v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></>,
    studio: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m8 22 4-4 4 4M8 9h8M8 13h5"/></>,
    book: <><path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3Z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3Z"/></>,
    play: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/></>,
    pause: <><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    upload: <><path d="M12 16V3M7 8l5-5 5 5"/><path d="M4 15v5h16v-5"/></>,
    spark: <><path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    download: <><path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 21h16"/></>,
    shield: <><path d="M12 2 4 5v6c0 5.2 3.3 9 8 11 4.7-2 8-5.8 8-11V5Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    audio: <><path d="M4 14v-4M8 18V6M12 21V3M16 17V7M20 14v-4"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function relativeDate(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return "baru saja";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(date));
}

function safeFilename(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "taysriul-qurani";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function projectState(project: Project) {
  return {
    updatedAt: project.updatedAt,
    status: project.status,
    ratio: project.ratio,
    duration: project.duration,
    progress: project.progress,
    audioName: project.audioName,
    audioAssetId: project.audioAssetId,
    backgroundAssetId: project.backgroundAssetId,
    segments: project.segments,
  };
}

function canvasDimensions(ratio: Ratio, resolution: string) {
  const scale = resolution === "2160p (4K)" ? 2 : resolution === "1440p" ? 1.34 : 1;
  const base = ratio === "16:9" ? [1280, 720] : ratio === "9:16" ? [720, 1280] : [900, 900];
  return { width: Math.round(base[0] * scale), height: Math.round(base[1] * scale) };
}

function drawWrappedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((item, index) => context.fillText(item, x, startY + index * lineHeight));
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [studioStep, setStudioStep] = useState<StudioStep>("source");
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0].id);
  const [selectedSegmentId, setSelectedSegmentId] = useState(sampleSegments[0].id);
  const [mushafVersion, setMushafVersion] = useState<"v1" | "v2">("v2");
  const [translationSource, setTranslationSource] = useState("Teks manual");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [fontScale, setFontScale] = useState(100);
  const [showTranslation, setShowTranslation] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioFile, setAudioFile] = useState<File>();
  const [audioName, setAudioName] = useState<string>();
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [backgroundFile, setBackgroundFile] = useState<File>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [capabilities, setCapabilities] = useState<ServerCapabilities>({ ffmpeg: false, transcription: false, quran: { available: false } });
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [toast, setToast] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [session, setSession] = useState<SessionInfo>({ authenticated: false });
  const [sessionMode, setSessionMode] = useState<"checking" | "local" | "guest" | "authenticated">("checking");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [contentSources, setContentSources] = useState<ContentSource[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "reviewer" | "viewer">("reviewer");
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);
  const serverSnapshots = useRef(new Map<string, string>());
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects],
  );
  const selectedSegment = useMemo(
    () => activeProject?.segments.find((segment) => segment.id === selectedSegmentId) ?? activeProject?.segments[0],
    [activeProject, selectedSegmentId],
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { projects?: Project[]; renderJobs?: RenderJob[] };
        if (parsed.projects?.length) {
          // Hydration is client-only because this studio stores drafts locally.
          setProjects(parsed.projects);
          setActiveProjectId(parsed.projects[0].id);
        }
        if (parsed.renderJobs) setRenderJobs(parsed.renderJobs);
      }
      const hash = window.location.hash.replace("#", "") as View;
      if (navItems.some((item) => item.id === hash) || hash === "settings") setView(hash);
    } catch {
      // Keep the clean sample workspace if old local data cannot be parsed.
    }
    hydrated.current = true;
    fetch("/media-api/capabilities")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(async (payload: ServerCapabilities) => {
        setCapabilities(payload);
        fetch("/media-api/quran/content/sources").then((response) => response.ok ? response.json() : Promise.reject()).then((content) => setContentSources(content.sources || [])).catch(() => {});
        if (!payload.persistence?.configured) return setSessionMode("local");
        const response = await fetch("/api/v1/auth/session");
        const account = await response.json() as SessionInfo;
        setSession(account);
        setSessionMode(account.authenticated ? "authenticated" : "guest");
      })
      .catch(() => {
        setCapabilities({ ffmpeg: false, transcription: false, quran: { available: false } });
        setSessionMode("local");
      });
  }, []);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    fetch("/api/v1/projects", { headers: { "x-tq-workspace": session.workspaces[0].id } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Proyek server tidak dapat dimuat.");
        const loaded = (payload.projects || []).map((project: Project & { version?: number }) => ({ ...project, serverVersion: project.version || project.serverVersion }));
        serverSnapshots.current = new Map(loaded.map((project: Project) => [project.id, JSON.stringify({ title: project.title, state: projectState(project) })]));
        if (loaded.length) {
          setProjects(loaded);
          setActiveProjectId(loaded[0].id);
          setSelectedSegmentId(loaded[0].segments?.[0]?.id || "");
        } else {
          setProjects([]);
        }
      })
      .catch((error) => setToast(error.message));
  }, [session, sessionMode]);

  useEffect(() => {
    if (!hydrated.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const persistentJobs = renderJobs.map((job) => ({ ...job, outputUrl: undefined }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, renderJobs: persistentJobs }));
      setSaveState("saved");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [projects, renderJobs]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    const dirty = projects.filter((project) => project.serverVersion && serverSnapshots.current.get(project.id) !== JSON.stringify({ title: project.title, state: projectState(project) }));
    if (!dirty.length) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      for (const project of dirty) {
        const snapshot = JSON.stringify({ title: project.title, state: projectState(project) });
        try {
          const response = await fetch(`/api/v1/projects/${project.id}`, {
            method: "PUT",
            headers: { "content-type": "application/json", "if-match": String(project.serverVersion), "x-tq-workspace": session.workspaces![0].id },
            body: JSON.stringify({ title: project.title, version: project.serverVersion, state: projectState(project) }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Autosave server gagal.");
          serverSnapshots.current.set(project.id, snapshot);
          setProjects((items) => items.map((item) => item.id === project.id ? { ...item, serverVersion: payload.project.version } : item));
        } catch (error) {
          setToast(error instanceof Error ? error.message : "Autosave server gagal.");
        }
      }
      setSaveState("saved");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [projects, session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0] || !capabilities.queue?.healthy) return;
    let active = true;
    const refresh = () => fetch("/api/v1/render-jobs", { headers: { "x-tq-workspace": session.workspaces![0].id } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Antrean render tidak dapat dimuat.");
        if (!active) return;
        setRenderJobs((payload.jobs || []).map((job: {
          id: string; project_id: string; status: RenderJob["status"]; progress: number; preset?: { title?: string; ratio?: Ratio; resolution?: string }; output_asset_id?: string; error?: string;
        }) => ({
          id: job.id,
          projectId: job.project_id,
          title: job.preset?.title || "Video Qur'an",
          ratio: job.preset?.ratio || "16:9",
          resolution: job.preset?.resolution || "1080p",
          status: job.status,
          progress: job.progress,
          format: "MP4",
          outputUrl: job.output_asset_id ? `/api/v1/assets/${job.output_asset_id}/download?workspace=${session.workspaces![0].id}` : undefined,
          error: job.error,
        })));
      }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [capabilities.queue?.healthy, session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0] || !activeProject?.serverVersion) return;
    fetch(`/api/v1/comments?projectId=${encodeURIComponent(activeProject.id)}`, { headers: { "x-tq-workspace": session.workspaces[0].id } })
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok) setComments(payload.comments || []);
      }).catch(() => {});
  }, [activeProject?.id, activeProject?.serverVersion, session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    fetch("/api/v1/members", { headers: { "x-tq-workspace": session.workspaces[0].id } })
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok) setMembers(payload.members || []);
      }).catch(() => {});
  }, [session, sessionMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(next: View) {
    setView(next);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openProject(projectId: string, step: StudioStep = "source") {
    setActiveProjectId(projectId);
    const project = projects.find((item) => item.id === projectId);
    if (project?.segments[0]) setSelectedSegmentId(project.segments[0].id);
    setRatio(project?.ratio ?? "16:9");
    setStudioStep(step);
    navigate("studio");
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const title = newProjectName.trim() || "Proyek Qur'an Baru";
    let project: Project = {
      id: `project-${Date.now()}`,
      title,
      updatedAt: new Date().toISOString(),
      status: "draft",
      ratio: "16:9",
      duration: 0,
      progress: 10,
      segments: sampleSegments.map((segment) => ({ ...segment, id: `${segment.id}-${Date.now()}`, verified: false })),
    };
    if (sessionMode === "authenticated" && session.workspaces?.[0]) {
      try {
        const response = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
          body: JSON.stringify({ title, state: projectState(project) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Proyek server gagal dibuat.");
        project = { ...payload.project, serverVersion: payload.project.version };
        serverSnapshots.current.set(project.id, JSON.stringify({ title: project.title, state: projectState(project) }));
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Proyek server gagal dibuat.");
        return;
      }
    }
    setProjects((items) => [project, ...items]);
    setNewProjectName("");
    setIsNewProjectOpen(false);
    setToast(sessionMode === "authenticated" ? "Proyek baru dibuat dan disimpan di server." : "Proyek baru dibuat dan disimpan di perangkat ini.");
    window.setTimeout(() => openProject(project.id), 0);
  }

  function processAudio(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      setToast("Pilih berkas audio atau video yang didukung.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setToast("Ukuran berkas maksimal untuk prototipe lokal adalah 500 MB.");
      return;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioFile(file);
    setAudioName(file.name);
    setProjects((items) =>
      items.map((project) =>
        project.id === activeProject.id
          ? { ...project, audioName: file.name, updatedAt: new Date().toISOString(), progress: Math.max(project.progress, 25) }
          : project,
      ),
    );
    setToast("Audio siap diputar. Berkas tetap berada di perangkat Anda.");
    if (sessionMode === "authenticated" && session.workspaces?.[0] && activeProject.serverVersion) {
      fetch(`/api/v1/assets?projectId=${encodeURIComponent(activeProject.id)}&kind=audio`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": file.name, "x-tq-workspace": session.workspaces[0].id },
        body: file,
      }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unggah audio ke server gagal.");
        setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, audioAssetId: payload.asset.id } : project));
        setToast("Audio tersimpan aman di ruang kerja server.");
      }).catch((error) => setToast(error.message));
    }
  }

  function handleAudioMetadata() {
    const duration = audioRef.current?.duration;
    if (!duration || !Number.isFinite(duration)) return;
    setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, duration } : project));
  }

  function processBackground(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setToast("Latar harus berupa gambar atau video.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setToast("Ukuran latar maksimal 500 MB.");
      return;
    }
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    setBackgroundFile(file);
    setBackgroundUrl(URL.createObjectURL(file));
    setToast("Latar visual siap digunakan pada pratinjau dan render.");
    if (sessionMode === "authenticated" && session.workspaces?.[0] && activeProject.serverVersion) {
      fetch(`/api/v1/assets?projectId=${encodeURIComponent(activeProject.id)}&kind=background`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": file.name, "x-tq-workspace": session.workspaces[0].id },
        body: file,
      }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unggah latar ke server gagal.");
        setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, backgroundAssetId: payload.asset.id } : project));
        setToast("Latar tersimpan aman di ruang kerja server.");
      }).catch((error) => setToast(error.message));
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    processAudio(event.dataTransfer.files[0]);
  }

  function togglePlayback() {
    if (!audioRef.current) {
      setToast("Unggah audio terlebih dahulu untuk memutar sumber asli.");
      return;
    }
    if (audioRef.current.paused) {
      void audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }

  function updateSegment(patch: Partial<Segment>) {
    if (!selectedSegment) return;
    setProjects((items) =>
      items.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              updatedAt: new Date().toISOString(),
              segments: project.segments.map((segment) =>
                segment.id === selectedSegment.id ? { ...segment, ...patch } : segment,
              ),
            }
          : project,
      ),
    );
  }

  async function selectTranslationSource(source: string) {
    setTranslationSource(source);
    if (!selectedSegment || source === "Teks manual") return;
    try {
      const response = await fetch(`/media-api/quran/content?edition=${encodeURIComponent(source)}&surah=${selectedSegment.surahNumber}&ayah=${selectedSegment.ayah}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sumber belum tersedia.");
      updateSegment({ translation: payload.entry.text || "" });
      setToast("Terjemahan berlisensi dimuat dari sumber terverifikasi.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Sumber belum tersedia.");
    }
  }

  function toggleVerification() {
    if (!selectedSegment) return;
    updateSegment({ verified: !selectedSegment.verified });
    setToast(selectedSegment.verified ? "Pemeriksaan ayat dibatalkan." : "Ayat ditandai sudah diperiksa manusia.");
  }

  async function addReviewComment(event: FormEvent) {
    event.preventDefault();
    if (!commentText.trim() || !session.workspaces?.[0] || !activeProject?.serverVersion) return;
    try {
      const response = await fetch("/api/v1/comments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
        body: JSON.stringify({ projectId: activeProject.id, atSeconds: selectedSegment?.start || 0, body: commentText }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Komentar gagal disimpan.");
      setComments((items) => [...items, { ...payload.comment, display_name: session.user?.displayName || "Pemeriksa" }]);
      setCommentText("");
      setToast("Komentar pemeriksaan tersimpan pada waktu ayat.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Komentar gagal disimpan.");
    }
  }

  async function decideProject(decision: "approved" | "changes-requested") {
    if (!session.workspaces?.[0] || !activeProject?.serverVersion) return;
    try {
      const response = await fetch("/api/v1/approvals", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
        body: JSON.stringify({ projectId: activeProject.id, decision, note: decision === "approved" ? "Seluruh ayat dan waktu telah diperiksa." : "Perlu koreksi berdasarkan komentar pemeriksa." }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Keputusan gagal disimpan.");
      if (decision === "approved") setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, status: "ready", progress: Math.max(90, project.progress) } : project));
      setToast(decision === "approved" ? "Proyek disetujui dan siap masuk antrean render." : "Permintaan perubahan berhasil dicatat.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Keputusan gagal disimpan.");
    }
  }

  async function runLocalAnalysis() {
    if (!audioFile) {
      setToast("Unggah audio terlebih dahulu.");
      return;
    }
    if (!capabilities.transcription) {
      setToast("Hubungkan endpoint Whisper/OpenAI-compatible pada konfigurasi Coolify terlebih dahulu.");
      return;
    }
    if (!capabilities.quran.available) {
      setToast("Korpus 114 surah belum tersinkron pada penyimpanan aplikasi.");
      return;
    }
    setIsTranscribing(true);
    setToast("Audio sedang ditranskripsi dan dicocokkan dengan korpus Qur'an…");
    try {
      const form = new FormData();
      form.append("file", audioFile, audioFile.name);
      form.append("language", "ar");
      form.append("response_format", "verbose_json");
      if (capabilities.transcriptionModel) form.append("model", capabilities.transcriptionModel);
      const response = await fetch("/media-api/transcribe", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.error || "Transkripsi gagal.");
      const fullText = String(payload.text || payload.transcript || "").trim();
      if (!fullText) throw new Error("Provider tidak mengembalikan teks transkripsi.");
      setTranscript(fullText);
      const parts: TranscriptPart[] = Array.isArray(payload.segments) && payload.segments.length
        ? payload.segments.map((part: TranscriptPart) => ({ text: String(part.text || ""), start: part.start, end: part.end, avg_logprob: part.avg_logprob, words: part.words })).filter((part: TranscriptPart) => part.text.trim())
        : [{ text: fullText, start: 0, end: activeProject.duration || audioRef.current?.duration || 10 }];
      const alignmentResponse = await fetch("/media-api/quran/align", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: parts.slice(0, 240), options: { lookBehind: 4, lookAhead: 32, alternatives: 3, threshold: 0.16 } }),
      });
      const alignmentPayload = await alignmentResponse.json().catch(() => ({}));
      if (!alignmentResponse.ok) throw new Error(alignmentPayload.error || "Alignment ayat gagal.");
      const matched: AlignedPart[] = alignmentPayload.aligned || [];
      const duration = activeProject.duration || audioRef.current?.duration || 10;
      const nextSegments: Segment[] = matched
        .filter((item): item is AlignedPart & { ayah: NonNullable<AlignedPart["ayah"]> } => Boolean(item.matched && item.ayah))
        .map((item, index) => ({
          id: `seg-ai-${Date.now()}-${index}`,
          surah: item.ayah.surah,
          surahNumber: item.ayah.surahNumber,
          ayah: item.ayah.ayah,
          start: typeof item.start === "number" && Number.isFinite(item.start) ? item.start : (index / matched.length) * duration,
          end: typeof item.end === "number" && Number.isFinite(item.end) ? item.end : ((index + 1) / matched.length) * duration,
          arabic: item.ayah.arabic,
          translation: "",
          confidence: item.confidence,
          verified: false,
        }))
        .filter((segment, index, items) => index === 0 || `${segment.surahNumber}:${segment.ayah}:${segment.start}` !== `${items[index - 1].surahNumber}:${items[index - 1].ayah}:${items[index - 1].start}`);
      if (!nextSegments.length) throw new Error("Belum ditemukan kecocokan ayat yang memadai.");
      setProjects((items) => items.map((project) => project.id === activeProject.id ? {
        ...project,
        segments: nextSegments,
        duration,
        progress: Math.max(project.progress, 58),
        status: "review",
        updatedAt: new Date().toISOString(),
      } : project));
      setSelectedSegmentId(nextSegments[0].id);
      setStudioStep("sync");
      setToast(`${nextSegments.length} potongan ayat ditemukan. Periksa teks dan waktunya sebelum ekspor.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Transkripsi tidak dapat diselesaikan.");
    } finally {
      setIsTranscribing(false);
    }
  }

  function addManualSegment() {
    const last = activeProject.segments.at(-1);
    const start = last?.end ?? 0;
    const segment: Segment = {
      id: `seg-manual-${Date.now()}`,
      surah: last?.surah ?? "Al-Fatihah",
      surahNumber: last?.surahNumber ?? 1,
      ayah: (last?.ayah ?? 0) + 1,
      start,
      end: Math.min(activeProject.duration || start + 5, start + 5),
      arabic: "",
      translation: "",
      confidence: 0,
      verified: false,
    };
    setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, segments: [...project.segments, segment] } : project));
    setSelectedSegmentId(segment.id);
  }

  function exportSubtitle(format: "srt" | "vtt" | "ass", mode: "arabic" | "translation" | "both" = "both") {
    const content = format === "srt" ? buildSrt(activeProject.segments, mode) : format === "vtt" ? buildVtt(activeProject.segments, mode) : buildAss(activeProject.segments, mode, ratio);
    const mime = format === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8";
    downloadBlob(new Blob([`\uFEFF${content}`], { type: mime }), `${safeFilename(activeProject.title)}-${mode}.${format}`);
    setToast(`Subtitle ${format.toUpperCase()} berhasil dibuat.`);
  }

  async function renderVideo() {
    if (isRendering) return;
    if (!activeProject.segments.length) return setToast("Tambahkan minimal satu potongan ayat.");
    if (activeProject.segments.some((segment) => !segment.verified)) return setToast("Semua potongan ayat harus diperiksa manusia sebelum render.");
    if (!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream)) return setToast("Browser ini belum mendukung render lokal. Gunakan Chrome atau Edge terbaru.");
    const jobId = `render-${Date.now()}`;
    const baseJob: RenderJob = { id: jobId, projectId: activeProject.id, title: activeProject.title, ratio, resolution, progress: 5, status: "queued", format: capabilities.ffmpeg ? "MP4" : "WebM" };
    setRenderJobs((jobs) => [baseJob, ...jobs]);
    setIsRendering(true);
    setToast("Render nyata dimulai di perangkat ini…");
    try {
      const { width, height } = canvasDimensions(ratio, resolution);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Kanvas video tidak tersedia.");
      const sourceAudio = audioUrl ? new Audio(audioUrl) : null;
      const duration = sourceAudio ? await new Promise<number>((resolve, reject) => {
        sourceAudio.preload = "auto";
        sourceAudio.onloadedmetadata = () => resolve(sourceAudio.duration);
        sourceAudio.onerror = () => reject(new Error("Audio tidak dapat dibaca untuk render."));
      }) : Math.max(1, activeProject.duration || activeProject.segments.at(-1)?.end || 10);
      const backgroundImage = backgroundUrl && backgroundFile?.type.startsWith("image/") ? new Image() : null;
      if (backgroundImage) {
        backgroundImage.src = backgroundUrl;
        await backgroundImage.decode();
      }
      const backgroundVideo = backgroundUrl && backgroundFile?.type.startsWith("video/") ? document.createElement("video") : null;
      if (backgroundVideo) {
        backgroundVideo.src = backgroundUrl;
        backgroundVideo.muted = true;
        backgroundVideo.loop = true;
        backgroundVideo.playsInline = true;
        await new Promise<void>((resolve, reject) => { backgroundVideo.onloadeddata = () => resolve(); backgroundVideo.onerror = () => reject(new Error("Video latar tidak dapat dibaca.")); });
      }
      const stream = canvas.captureStream(30);
      let audioContext: AudioContext | undefined;
      if (sourceAudio) {
        audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(sourceAudio);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);
        source.connect(audioContext.destination);
        destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((item) => MediaRecorder.isTypeSupported(item));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: resolution === "2160p (4K)" ? 18_000_000 : 8_000_000 } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Perekaman kanvas gagal.")); });
      let running = true;
      const startedAt = performance.now();
      const draw = () => {
        if (!running) return;
        const time = sourceAudio?.currentTime ?? Math.min(duration, (performance.now() - startedAt) / 1000);
        const segment = activeProject.segments.find((item) => time >= item.start && time < item.end) ?? activeProject.segments.at(-1)!;
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#071f19"); gradient.addColorStop(0.55, "#0d3b2d"); gradient.addColorStop(1, "#061510");
        context.fillStyle = gradient; context.fillRect(0, 0, width, height);
        const background: HTMLImageElement | HTMLVideoElement | null = backgroundImage || (backgroundVideo?.readyState && backgroundVideo.readyState >= 2 ? backgroundVideo : null);
        if (background) {
          const sourceWidth = background instanceof HTMLVideoElement ? background.videoWidth : background.naturalWidth;
          const sourceHeight = background instanceof HTMLVideoElement ? background.videoHeight : background.naturalHeight;
          const scale = Math.max(width / sourceWidth, height / sourceHeight);
          const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale;
          context.drawImage(background, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
          context.fillStyle = "rgba(2,18,13,.62)"; context.fillRect(0, 0, width, height);
        }
        context.strokeStyle = "rgba(219,181,110,.72)"; context.lineWidth = Math.max(2, width * 0.002); context.strokeRect(width * 0.035, height * 0.045, width * 0.93, height * 0.91);
        context.textAlign = "center"; context.direction = "rtl"; context.fillStyle = "#fffdf5";
        const arabicSize = Math.round(width * (ratio === "9:16" ? 0.063 : 0.043) * (fontScale / 100));
        context.font = `600 ${arabicSize}px "Amiri", "Noto Naskh Arabic", serif`;
        drawWrappedText(context, segment.arabic, width / 2, height * 0.47, width * 0.82, arabicSize * 1.7);
        if (showTranslation && segment.translation) {
          context.direction = "ltr"; context.fillStyle = "rgba(255,255,255,.88)"; const translationSize = Math.round(width * (ratio === "9:16" ? 0.028 : 0.018));
          context.font = `400 ${translationSize}px Arial, sans-serif`;
          drawWrappedText(context, segment.translation, width / 2, height * 0.67, width * 0.76, translationSize * 1.45);
        }
        context.direction = "ltr"; context.textAlign = "left"; context.fillStyle = "#dbb56e"; context.font = `600 ${Math.round(width * 0.012)}px Arial`;
        context.fillText("TAYSRiUL QUR'ANI", width * 0.055, height * 0.92);
        context.textAlign = "right"; context.fillText(`QS ${segment.surahNumber}:${segment.ayah}`, width * 0.945, height * 0.92);
        const progress = Math.min(82, 12 + Math.round((time / duration) * 70));
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress, status: "processing" } : job));
        requestAnimationFrame(draw);
      };
      recorder.start(1000);
      if (backgroundVideo) await backgroundVideo.play();
      draw();
      if (sourceAudio) {
        await sourceAudio.play();
        await new Promise<void>((resolve) => { sourceAudio.onended = () => resolve(); });
      } else await new Promise((resolve) => window.setTimeout(resolve, duration * 1000));
      running = false;
      recorder.stop();
      await stopped;
      sourceAudio?.pause(); backgroundVideo?.pause(); stream.getTracks().forEach((track) => track.stop()); await audioContext?.close();
      const webm = new Blob(chunks, { type: mime || "video/webm" });
      if (capabilities.queue?.healthy && sessionMode === "authenticated" && session.workspaces?.[0] && activeProject.serverVersion) {
        const response = await fetch(`/api/v1/render-jobs?projectId=${encodeURIComponent(activeProject.id)}`, {
          method: "POST",
          headers: {
            "content-type": "video/webm",
            "x-tq-workspace": session.workspaces[0].id,
            "x-project-name": activeProject.title,
            "x-render-ratio": ratio,
            "x-render-resolution": resolution,
            "x-render-duration": String(duration),
          },
          body: webm,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Video gagal masuk antrean render.");
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, id: payload.job.id, progress: 0, status: "queued", format: "MP4" } : job));
        setToast("Video masuk antrean server. Anda boleh menutup halaman dan kembali nanti.");
        navigate("renders");
        return;
      }
      let output = webm;
      let format: "MP4" | "WebM" = "WebM";
      if (capabilities.ffmpeg) {
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress: 88 } : job));
        const response = await fetch("/media-api/transcode", { method: "POST", headers: { "content-type": webm.type, "x-project-name": safeFilename(activeProject.title) }, body: webm });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "FFmpeg gagal membuat MP4.");
        output = await response.blob(); format = "MP4";
      }
      const outputUrl = URL.createObjectURL(output);
      setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress: 100, status: "complete", format, outputUrl } : job));
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, progress: 100, status: "ready" } : project));
      setToast(`Video ${format} selesai. Buka menu Render untuk mengunduh.`);
      navigate("renders");
    } catch (error) {
      setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, status: "failed", error: error instanceof Error ? error.message : "Render gagal." } : job));
      setToast(error instanceof Error ? error.message : "Render gagal.");
    } finally {
      setIsRendering(false);
    }
  }

  function exportProject() {
    const payload = {
      product: "Taysriul Qur'ani",
      schemaVersion: "0.1",
      exportedAt: new Date().toISOString(),
      project: activeProject,
      preferences: { mushafVersion, translationSource, ratio, resolution, fontScale, showTranslation },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeProject.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.tq.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Konfigurasi proyek berhasil diekspor.");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const body = {
      displayName: String(form.get("displayName") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
    };
    try {
      const response = await fetch(`/api/v1/auth/${authMode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Akun tidak dapat diproses.");
      setSession(payload);
      setSessionMode("authenticated");
      setToast(authMode === "register" ? "Ruang kerja baru berhasil dibuat." : "Selamat datang kembali.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Akun tidak dapat diproses.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    setSession({ authenticated: false });
    setSessionMode("guest");
  }

  async function exportServerBackup() {
    if (!session.workspaces?.[0]) return;
    try {
      const response = await fetch("/api/v1/backup", { headers: { "x-tq-workspace": session.workspaces[0].id } });
      if (!response.ok) throw new Error((await response.json()).error || "Backup gagal dibuat.");
      downloadBlob(await response.blob(), `taysriul-qurani-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setToast("Backup ruang kerja berhasil diunduh.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Backup gagal dibuat.");
    }
  }

  async function addWorkspaceMember(event: FormEvent) {
    event.preventDefault();
    if (!session.workspaces?.[0] || !memberEmail.trim()) return;
    try {
      const response = await fetch("/api/v1/members", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
        body: JSON.stringify({ email: memberEmail, role: memberRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Anggota gagal ditambahkan.");
      setMembers((items) => [...items.filter((item) => item.id !== payload.member.id), payload.member]);
      setMemberEmail("");
      setToast("Anggota dan perannya berhasil disimpan.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Anggota gagal ditambahkan.");
    }
  }

  async function restoreServerBackup(file?: File) {
    if (!file || !session.workspaces?.[0]) return;
    try {
      const response = await fetch("/api/v1/restore", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
        body: await file.text(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Pemulihan backup gagal.");
      setToast(`${payload.projects} proyek berhasil dipulihkan. Muat ulang daftar proyek untuk melihatnya.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Pemulihan backup gagal.");
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  }

  if (sessionMode === "checking") return <LoadingScreen />;
  if (sessionMode === "guest") return <AuthScreen mode={authMode} busy={authBusy} error={authError} onMode={setAuthMode} onSubmit={submitAuth} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Buka beranda Taysriul Qur'ani">
          <span className="brand-mark"><span>ت</span></span>
          <span className="brand-copy">
            <strong>Taysriul</strong>
            <small>Qur&apos;ani Studio</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="Navigasi utama">
          <span className="nav-kicker">Ruang kerja</span>
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon"><Icon name={item.icon} /></span>
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              {item.id === "renders" && renderJobs.length > 0 && <em>{renderJobs.length}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}>
            <span className="nav-icon"><Icon name="settings" /></span>
            <span><strong>Pengaturan</strong><small>Sistem & sumber</small></span>
          </button>
          <div className="local-badge">
            <span className="status-dot" />
            <span><strong>{sessionMode === "authenticated" ? "Mode server" : "Mode lokal"}</strong><small>{sessionMode === "authenticated" ? "Autosave PostgreSQL aktif" : "Data tersimpan di perangkat"}</small></span>
          </div>
          <div className="founder-card">
            <span className="avatar">{session.user?.displayName?.slice(0, 2).toUpperCase() || "SQ"}</span>
            <span><strong>{session.user?.displayName || "Ruang Pendiri"}</strong><small>{saveState === "saving" ? "Menyimpan…" : "Semua perubahan tersimpan"}</small></span>
            {sessionMode === "authenticated" ? <button className="account-exit" onClick={logout} aria-label="Keluar akun"><Icon name="close" size={16}/></button> : <Icon name="more" size={17} />}
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark compact"><span>ت</span></span>
            <strong>Taysriul Qur&apos;ani</strong>
          </div>
          <div className="breadcrumb">
            <span>Taysriul Qur&apos;ani</span><Icon name="chevron" size={14} /><strong>{navItems.find((item) => item.id === view)?.label ?? "Pengaturan"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="stage-pill"><span /> Production v1.0</span>
            <button className="icon-button" aria-label="Cari proyek" onClick={() => navigate("projects")}><Icon name="search" /></button>
            <button className="primary-button compact-button" onClick={() => setIsNewProjectOpen(true)}><Icon name="plus" /> Proyek baru</button>
          </div>
        </header>

        {view === "home" && (
          <div className="page home-page">
            <section className="hero-panel">
              <div className="hero-copy">
                <span className="eyebrow"><span /> Dibangun untuk memuliakan firman-Nya</span>
                <h1>Audio Al-Qur&apos;an menjadi video yang <em>indah, tepat, dan mudah.</em></h1>
                <p>
                  Satu ruang produksi untuk mencocokkan bacaan dengan ayat, menata Mushaf Madinah,
                  menambahkan terjemahan dan tafsir, lalu menyiapkan video dakwah yang siap dibagikan.
                </p>
                <div className="hero-actions">
                  <button className="primary-button large" onClick={() => activeProject ? openProject(activeProject.id) : setIsNewProjectOpen(true)}><Icon name="studio" /> {activeProject ? "Buka studio" : "Buat proyek pertama"}</button>
                  <button className="secondary-button large" onClick={() => setIsNewProjectOpen(true)}><Icon name="plus" /> Mulai proyek</button>
                </div>
                <div className="trust-row">
                  <span><Icon name="shield" size={16} /> Pemeriksaan manusia wajib</span>
                  <span><Icon name="globe" size={16} /> Siap multibahasa</span>
                  <span><Icon name="layers" size={16} /> Mushaf v1 & v2</span>
                </div>
              </div>
              <div className="hero-visual" aria-label="Pratinjau video Al-Qur'an">
                <div className="visual-orbit orbit-one" />
                <div className="visual-orbit orbit-two" />
                <div className="verse-card">
                  <div className="verse-top"><span>١</span><small>الفاتحة</small><em>1:2</em></div>
                  <p dir="rtl">الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ</p>
                  <div className="verse-rule" />
                  <small>Segala puji bagi Allah, Tuhan seluruh alam.</small>
                  <div className="mini-wave">{waveform.slice(0, 36).map((height, index) => <i key={index} style={{ height: `${height * 0.34}px` }} />)}</div>
                </div>
                <span className="floating-tag tag-one"><Icon name="audio" size={15} /> Audio → Ayat</span>
                <span className="floating-tag tag-two"><Icon name="check" size={15} /> Tervalidasi</span>
              </div>
            </section>

            <section className="metrics-grid" aria-label="Status fondasi aplikasi">
              <article><span className="metric-icon green"><Icon name="book" /></span><div><small>Korpus Qur&apos;an</small><strong>{capabilities.quran.available ? "114 surah siap" : "Menunggu sinkronisasi"}</strong><em>{capabilities.quran.available ? "6.236 ayat tervalidasi" : "Sampel lokal tetap tersedia"}</em></div></article>
              <article><span className="metric-icon gold"><Icon name="layers" /></span><div><small>Tampilan Mushaf</small><strong>v1 & v2 siap UI</strong><em>Font resmi belum diimpor</em></div></article>
              <article><span className="metric-icon blue"><Icon name="spark" /></span><div><small>Mesin AI</small><strong>{capabilities.transcription ? "Terhubung" : "Adaptor siap"}</strong><em>{capabilities.transcription ? capabilities.transcriptionModel || "Endpoint aktif" : "Isi endpoint pada Coolify"}</em></div></article>
              <article><span className="metric-icon violet"><Icon name="play" /></span><div><small>Mesin render</small><strong>{capabilities.ffmpeg ? "MP4 aktif" : "WebM browser"}</strong><em>{capabilities.ffmpeg ? "FFmpeg H.264 tersedia" : "MP4 aktif setelah Docker dijalankan"}</em></div></article>
            </section>

            <section className="section-block">
              <div className="section-heading">
                <div><span className="section-kicker">Lanjutkan berkarya</span><h2>Proyek terbaru</h2></div>
                <button className="text-button" onClick={() => navigate("projects")}>Lihat semua <Icon name="chevron" size={15} /></button>
              </div>
              <div className="project-grid">
                {projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id)} />)}
                <button className="new-project-card" onClick={() => setIsNewProjectOpen(true)}><span><Icon name="plus" size={24} /></span><strong>Mulai dari awal</strong><small>Audio, video, atau rekaman baru</small></button>
              </div>
            </section>

            <section className="workflow-section">
              <div className="workflow-intro"><span className="section-kicker">Alur yang terjaga</span><h2>Dari bacaan hingga video,<br/>dalam lima langkah.</h2><p>Setiap ayat melewati pencocokan, penyuntingan, dan pemeriksaan sebelum video dapat dirender.</p></div>
              <div className="workflow-list">
                {[
                  ["01", "Masukkan sumber", "Unggah audio atau video bacaan yang akan diolah."],
                  ["02", "Cocokkan ayat", "AI mengenali bacaan, lalu mengusulkan surah dan ayat."],
                  ["03", "Susun tampilan", "Atur Mushaf, terjemahan, warna, rasio, dan gerak."],
                  ["04", "Periksa dengan teliti", "Manusia memverifikasi ayat dan waktu tampil."],
                  ["05", "Render dan bagikan", "Ekspor video horizontal, vertikal, atau persegi."],
                ].map(([number, title, copy], index) => (
                  <button key={number} onClick={() => { setStudioStep(studioSteps[index].id); navigate("studio"); }}>
                    <span>{number}</span><div><strong>{title}</strong><small>{copy}</small></div><Icon name="chevron" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "projects" && (
          <div className="page">
            <PageHeader eyebrow="Karya Anda" title="Semua proyek" copy="Kelola seluruh produksi video Qur'an dari satu tempat." action={<button className="primary-button" onClick={() => setIsNewProjectOpen(true)}><Icon name="plus" /> Proyek baru</button>} />
            <div className="filter-row">
              <div className="search-field"><Icon name="search" /><input aria-label="Cari proyek" placeholder="Cari judul proyek…" /></div>
              <div className="filter-pills"><button className="active">Semua <span>{projects.length}</span></button><button>Draf</button><button>Perlu diperiksa</button><button>Siap render</button></div>
            </div>
            <div className="project-grid wide">
              {projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id)} />)}
              <button className="new-project-card" onClick={() => setIsNewProjectOpen(true)}><span><Icon name="plus" size={24} /></span><strong>Buat proyek baru</strong><small>Mulai produksi dari sumber baru</small></button>
            </div>
          </div>
        )}

        {view === "studio" && activeProject && selectedSegment && (
          <div className="studio-page">
            <div className="studio-head">
              <div className="studio-title"><button className="back-button" onClick={() => navigate("projects")} aria-label="Kembali ke proyek">‹</button><div><small>Proyek aktif</small><h1>{activeProject.title}</h1></div><span className={`status-label ${activeProject.status}`}>{activeProject.status === "draft" ? "Draf" : activeProject.status === "review" ? "Perlu diperiksa" : "Siap render"}</span></div>
              <div className="studio-actions"><span className="save-label"><Icon name="check" size={14} /> {saveState === "saved" ? sessionMode === "authenticated" ? "Tersimpan di server" : "Tersimpan lokal" : "Menyimpan…"}</span><button className="secondary-button" onClick={exportProject}><Icon name="download" /> Ekspor proyek</button><button className="primary-button" onClick={() => setStudioStep("render")}>Lanjutkan <Icon name="chevron" size={15} /></button></div>
            </div>

            <div className="stepper" role="tablist" aria-label="Tahapan produksi">
              {studioSteps.map((step, index) => {
                const activeIndex = studioSteps.findIndex((item) => item.id === studioStep);
                return <button key={step.id} className={`${studioStep === step.id ? "active" : ""} ${index < activeIndex ? "complete" : ""}`} onClick={() => setStudioStep(step.id)}><span>{index < activeIndex ? <Icon name="check" size={14} /> : step.index}</span><strong>{step.label}</strong></button>;
              })}
            </div>

            <div className="studio-workspace">
              <aside className="source-panel panel">
                <div className="panel-heading"><div><span className="panel-kicker">Sumber media</span><h2>Audio bacaan</h2></div><button className="icon-button small" aria-label="Pilihan sumber"><Icon name="more" /></button></div>
                <input ref={fileInputRef} type="file" accept="audio/*,video/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => processAudio(event.target.files?.[0])} />
                <div
                  className={`drop-zone ${isDragging ? "dragging" : ""} ${audioName ? "has-file" : ""}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <span className="upload-icon"><Icon name={audioName ? "audio" : "upload"} size={22} /></span>
                  {audioName ? <><strong>{audioName}</strong><small>Siap diputar dari perangkat ini</small><button onClick={() => fileInputRef.current?.click()}>Ganti berkas</button></> : <><strong>Letakkan audio di sini</strong><small>MP3, WAV, M4A, MP4 • maks. 500 MB</small><button onClick={() => fileInputRef.current?.click()}>Pilih berkas</button></>}
                </div>
                <audio ref={audioRef} src={audioUrl} onLoadedMetadata={handleAudioMetadata} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} />
                <button className="ai-action" onClick={runLocalAnalysis} disabled={isTranscribing}><span><Icon name="spark" /></span><div><strong>{isTranscribing ? "Menganalisis bacaan…" : "Transkripsi & cocokkan ayat"}</strong><small>{capabilities.transcription ? "AI aktif" : "Perlu endpoint AI"} • {capabilities.quran.available ? "korpus siap" : "korpus belum sinkron"}</small></div><Icon name="chevron" size={16} /></button>

                <div className="source-settings">
                  <label><span>Bahasa audio</span><select defaultValue="Arabic"><option>Arab (Al-Qur&apos;an)</option></select></label>
                  <label><span>Model pencocokan</span><select defaultValue="Quran"><option>Qur&apos;an matcher • n-gram Arab</option></select></label>
                </div>

                {transcript && <div className="transcript-note"><strong>Transkripsi terakhir</strong><p dir="rtl">{transcript}</p></div>}

                <div className="segments-heading"><span>Potongan ayat</span><div><em>{activeProject.segments.length}</em><button onClick={addManualSegment} aria-label="Tambah potongan ayat"><Icon name="plus" size={14}/></button></div></div>
                <div className="segment-list">
                  {activeProject.segments.map((segment) => (
                    <button key={segment.id} className={selectedSegment.id === segment.id ? "active" : ""} onClick={() => setSelectedSegmentId(segment.id)}>
                      <span className={`segment-state ${segment.verified ? "verified" : ""}`}>{segment.verified ? <Icon name="check" size={12} /> : segment.ayah}</span>
                      <div><strong>{segment.surah} · {segment.ayah}</strong><small>{formatDuration(segment.start)} — {formatDuration(segment.end)}</small></div>
                      <em>{segment.confidence}%</em>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="preview-panel panel">
                <div className="preview-toolbar">
                  <div className="device-tabs"><button className="active">Kanvas</button><button onClick={() => setToast("Pratinjau layar penuh disiapkan untuk fase berikutnya.")}>Pratinjau</button></div>
                  <div className="zoom-control"><button aria-label="Perkecil">−</button><span>Fit</span><button aria-label="Perbesar">+</button></div>
                </div>
                <div className="canvas-stage">
                  <div className={`video-canvas ratio-${ratio.replace(":", "-")} mushaf-${mushafVersion}`} style={backgroundUrl && backgroundFile?.type.startsWith("image/") ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
                    {backgroundUrl && backgroundFile?.type.startsWith("video/") && <video className="canvas-background-video" src={backgroundUrl} autoPlay muted loop playsInline/>}
                    {backgroundUrl && <div className="canvas-background-scrim"/>}
                    <div className="canvas-decoration top" />
                    <span className="surah-chip"><i>١</i> سُورَةُ الْفَاتِحَة</span>
                    <div className="canvas-verse">
                      <p
                        dir="rtl"
                        style={{
                          fontSize: `${fontScale * (ratio === "16:9" ? 0.44 : ratio === "9:16" ? 0.31 : 0.37)}px`,
                        }}
                      >
                        {selectedSegment.arabic}<span className="ayah-marker">{selectedSegment.ayah}</span>
                      </p>
                      {showTranslation && <><span className="translation-rule"/><small>{selectedSegment.translation}</small></>}
                    </div>
                    <div className="canvas-footer"><span>TAYSRiUL QUR&apos;ANI</span><em>{selectedSegment.surahNumber}:{selectedSegment.ayah}</em></div>
                    <div className="canvas-decoration bottom" />
                  </div>
                </div>
                <div className="timeline">
                  <div className="transport"><button className="round-play" onClick={togglePlayback} aria-label={isPlaying ? "Jeda" : "Putar"}><Icon name={isPlaying ? "pause" : "play"} size={16} /></button><strong>{formatDuration(selectedSegment.start)}</strong><span>/ {formatDuration(activeProject.duration || 14.9)}</span><div className="transport-spacer"/><button aria-label="Pengaturan timeline"><Icon name="settings" size={16}/></button></div>
                  <div className="waveform"><div className="playhead" style={{ left: `${Math.max(5, (selectedSegment.start / (activeProject.duration || 14.9)) * 100)}%` }} />{waveform.map((height, index) => <i key={index} className={index / waveform.length < selectedSegment.end / (activeProject.duration || 14.9) ? "passed" : ""} style={{ height: `${height * 0.34}px` }} />)}</div>
                  <div className="timeline-cues">{activeProject.segments.map((segment) => <button key={segment.id} className={segment.id === selectedSegment.id ? "active" : ""} style={{ left: `${(segment.start / (activeProject.duration || 14.9)) * 100}%`, width: `${Math.max(12, ((segment.end - segment.start) / (activeProject.duration || 14.9)) * 100)}%` }} onClick={() => setSelectedSegmentId(segment.id)}>QS {segment.surahNumber}:{segment.ayah}</button>)}</div>
                </div>
              </section>

              <aside className="inspector-panel panel">
                <div className="panel-heading"><div><span className="panel-kicker">Inspektur</span><h2>Pengaturan ayat</h2></div></div>
                <div className="inspector-section">
                  <div className="section-label"><span>Referensi Qur&apos;an</span><Icon name="book" size={15}/></div>
                  <div className="field-row"><label><span>Surah</span><select value={selectedSegment.surah} onChange={(event) => updateSegment({ surah: event.target.value })}><option value={selectedSegment.surah}>{selectedSegment.surah}</option></select></label><label className="short-field"><span>Ayat</span><input type="number" value={selectedSegment.ayah} onChange={(event) => updateSegment({ ayah: Number(event.target.value) })}/></label></div>
                  <label><span>Teks Arab <em>{capabilities.quran.available ? "korpus produksi" : "contoh lokal"}</em></span><textarea dir="rtl" value={selectedSegment.arabic} onChange={(event) => updateSegment({ arabic: event.target.value })}/></label>
                  <div className="confidence"><span>Keyakinan pencocokan</span><strong>{selectedSegment.confidence}%</strong><i><b style={{ width: `${selectedSegment.confidence}%` }}/></i></div>
                  <div className="field-row time-fields"><label><span>Mulai (detik)</span><input type="number" min="0" step="0.1" value={selectedSegment.start} onChange={(event) => updateSegment({ start: Math.max(0, Number(event.target.value)) })}/></label><label><span>Selesai (detik)</span><input type="number" min="0" step="0.1" value={selectedSegment.end} onChange={(event) => updateSegment({ end: Math.max(selectedSegment.start + 0.1, Number(event.target.value)) })}/></label></div>
                </div>
                <div className="inspector-section">
                  <div className="section-label"><span>Tampilan Mushaf</span><Icon name="layers" size={15}/></div>
                  <div className="segmented-control"><button className={mushafVersion === "v1" ? "active" : ""} onClick={() => setMushafVersion("v1")}>Madinah v1</button><button className={mushafVersion === "v2" ? "active" : ""} onClick={() => setMushafVersion("v2")}>Madinah v2</button></div>
                  <label><span>Ukuran teks Arab <em>{fontScale}%</em></span><input className="range" type="range" min="76" max="138" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))}/></label>
                </div>
                <div className="inspector-section">
                  <div className="section-label"><span>Terjemahan</span><label className="switch"><input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)}/><i/></label></div>
                  <label><span>Sumber</span><select value={translationSource} onChange={(event) => selectTranslationSource(event.target.value)}><option>Teks manual</option>{contentSources.filter((source) => source.enabled && source.redistributionAllowed).map((source) => <option key={source.edition} value={source.edition}>{source.name}</option>)}</select></label>
                  <label><span>Teks terjemahan</span><textarea value={selectedSegment.translation} onChange={(event) => updateSegment({ translation: event.target.value })}/></label>
                </div>
                <div className="inspector-section compact-section">
                  <div className="section-label"><span>Format video</span></div>
                  <div className="ratio-control">{(["16:9", "9:16", "1:1"] as Ratio[]).map((item) => <button key={item} className={ratio === item ? "active" : ""} onClick={() => setRatio(item)}><i className={`ratio-shape r-${item.replace(":", "-")}`}/><span>{item}</span></button>)}</div>
                </div>
                <div className="inspector-section compact-section">
                  <div className="section-label"><span>Latar visual</span><Icon name="layers" size={15}/></div>
                  <input ref={backgroundInputRef} type="file" accept="image/*,video/*" hidden onChange={(event) => processBackground(event.target.files?.[0])}/>
                  <button className="background-picker" onClick={() => backgroundInputRef.current?.click()}><Icon name="upload" size={16}/><span><strong>{backgroundFile?.name || "Pilih gambar atau video"}</strong><small>{backgroundFile ? "Digunakan pada pratinjau & render" : "JPG, PNG, WebP, atau MP4"}</small></span></button>
                </div>
                <button className={`verify-button ${selectedSegment.verified ? "verified" : ""}`} onClick={toggleVerification}><Icon name={selectedSegment.verified ? "check" : "shield"}/>{selectedSegment.verified ? "Sudah diperiksa manusia" : "Tandai sudah diperiksa"}</button>
              </aside>
            </div>

            {studioStep === "review" && (
              <section className="review-workspace">
                <div className="review-summary panel"><span className="section-kicker">Pemeriksaan berjenjang</span><h2>Validasi ayat sebelum render</h2><p>{activeProject.segments.filter((segment) => segment.verified).length} dari {activeProject.segments.length} potongan telah diperiksa manusia.</p><div className="review-meter"><i style={{ width: `${(activeProject.segments.filter((segment) => segment.verified).length / Math.max(1, activeProject.segments.length)) * 100}%` }}/></div><div className="review-decisions"><button className="secondary-button" onClick={() => decideProject("changes-requested")}><Icon name="clock"/> Minta perbaikan</button><button className="primary-button" disabled={activeProject.segments.some((segment) => !segment.verified)} onClick={() => decideProject("approved")}><Icon name="check"/> Setujui proyek</button></div></div>
                <div className="review-comments panel"><div className="section-title-row"><div><span className="section-kicker">Komentar berbasis waktu</span><h2>Catatan pemeriksa</h2></div><em>{comments.length}</em></div><div className="comment-list">{comments.length ? comments.map((comment) => <article key={comment.id}><span>{comment.display_name?.slice(0, 2).toUpperCase() || "RV"}</span><div><strong>{comment.display_name || "Pemeriksa"}<em>{formatDuration(Number(comment.at_seconds))}</em></strong><p>{comment.body}</p></div></article>) : <p className="empty-comments">Belum ada komentar. Pilih potongan ayat, lalu tulis catatan dengan waktu otomatis.</p>}</div><form className="comment-form" onSubmit={addReviewComment}><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder={`Catatan pada ${formatDuration(selectedSegment.start)}…`}/><button className="primary-button" disabled={sessionMode !== "authenticated" || !commentText.trim()}><Icon name="plus"/> Tambah</button></form></div>
              </section>
            )}

            {studioStep === "render" && (
              <div className="render-drawer">
                <div><span className="section-kicker">Langkah terakhir</span><h2>Ekspor subtitle & video nyata</h2><p>Subtitle dibuat langsung. Video dirender oleh browser lalu dikonversi FFmpeg menjadi MP4 ketika container Coolify aktif.</p><div className="subtitle-actions"><button onClick={() => exportSubtitle("srt")}><Icon name="download" size={15}/> SRT</button><button onClick={() => exportSubtitle("vtt")}><Icon name="download" size={15}/> VTT</button><button onClick={() => exportSubtitle("ass")}><Icon name="download" size={15}/> ASS</button><button onClick={() => exportSubtitle("srt", "arabic")}><Icon name="book" size={15}/> Arab saja</button><button onClick={() => exportSubtitle("srt", "translation")}><Icon name="globe" size={15}/> Terjemahan</button></div></div>
                <label><span>Resolusi</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option>1080p</option><option>1440p</option><option>2160p (4K)</option></select></label>
                <label><span>Format hasil</span><select value={capabilities.ffmpeg ? "MP4" : "WebM"} disabled><option value={capabilities.ffmpeg ? "MP4" : "WebM"}>{capabilities.ffmpeg ? "MP4 · H.264 + AAC" : "WebM · browser"}</option></select></label>
                <button className="primary-button large" onClick={renderVideo} disabled={isRendering}><Icon name="play" /> {isRendering ? "Sedang merender…" : "Render video sekarang"}</button>
              </div>
            )}
          </div>
        )}

        {view === "quran" && (
          <div className="page">
            <PageHeader eyebrow="Sumber terverifikasi" title="Pustaka Al-Qur'an" copy="Pusat korpus ayat, tampilan Mushaf, terjemahan, dan tafsir yang akan digunakan oleh studio." />
            <div className="notice-card"><span><Icon name="shield" /></span><div><strong>Integritas teks adalah prioritas utama</strong><p>{capabilities.quran.available ? `Korpus Utsmani 114 surah telah divalidasi dan dikunci dengan ${capabilities.quran.checksum?.slice(0, 24) || "checksum SHA-256"}…` : "Sampel Al-Fatihah digunakan untuk antarmuka. Container produksi akan menyinkronkan korpus lengkap, memvalidasi jumlahnya, lalu menyimpan checksum SHA-256."}</p></div><button onClick={() => setToast(capabilities.quran.available ? "Korpus produksi tersedia dan siap untuk pencocokan." : "Aktifkan TQ_QURAN_AUTO_SYNC=true pada Coolify.")}>{capabilities.quran.available ? "Korpus siap" : "Cara mengaktifkan"}</button></div>
            <section className="source-overview">
              <article><span className="metric-icon green"><Icon name="book" /></span><small>Surah siap</small><strong>{capabilities.quran.counts?.surahs || 1} <em>/ 114</em></strong><div className="source-progress"><i style={{width:capabilities.quran.available ? "100%" : "0.88%"}}/></div></article>
              <article><span className="metric-icon gold"><Icon name="layers" /></span><small>Halaman terpetakan</small><strong>{capabilities.quran.counts?.pages || 0} <em>/ 604</em></strong><div className="source-progress"><i style={{width:capabilities.quran.available ? "100%" : "0%"}}/></div></article>
              <article><span className="metric-icon blue"><Icon name="globe" /></span><small>Sumber bahasa</small><strong>{contentSources.length} <em>terdaftar</em></strong><div className="source-progress"><i style={{width: contentSources.some((source) => source.enabled && source.redistributionAllowed) ? "100%" : "18%"}}/></div></article>
            </section>
            <div className="library-layout">
              <section className="library-table panel">
                <div className="table-tools"><div className="search-field"><Icon name="search"/><input placeholder="Cari surah atau nomor…"/></div><button className="secondary-button"><Icon name="layers"/> Semua sumber</button></div>
                <div className="table-head"><span>Surah</span><span>Ayat</span><span>Status teks</span><span>Mushaf</span><span/></div>
                <button className="surah-row" onClick={() => activeProject ? openProject(activeProject.id, "sync") : setIsNewProjectOpen(true)}><span><i>١</i><span><strong>Al-Fatihah</strong><small>الفاتحة · Pembukaan</small></span></span><span>7</span><span><em className="ready-dot"/> Sampel UI</span><span>v1 · v2</span><Icon name="chevron"/></button>
                {["Al-Baqarah", "Ali 'Imran", "An-Nisa'", "Al-Ma'idah", "Al-An'am"].map((name, index) => <div className={`surah-row ${capabilities.quran.available ? "" : "muted"}`} key={name}><span><i>{index + 2}</i><span><strong>{name}</strong><small>{capabilities.quran.available ? "Tersedia dalam korpus" : "Menunggu korpus produksi"}</small></span></span><span>—</span><span><em className={capabilities.quran.available ? "ready-dot" : "waiting-dot"}/> {capabilities.quran.available ? "Tervalidasi" : "Belum diimpor"}</span><span>{capabilities.quran.available ? "Utsmani" : "—"}</span><Icon name={capabilities.quran.available ? "check" : "clock"}/></div>)}
              </section>
              <aside className="source-side panel"><span className="panel-kicker">Registri sumber</span><h2>Paket data & lisensi</h2><div className="source-package"><span className="priority"><Icon name="shield" size={16}/></span><div><strong>Teks Utsmani</strong><small>6.236 ayat • checksum SHA-256</small></div></div>{contentSources.map((source) => <div className="source-package" key={source.edition}><span className={source.enabled && source.redistributionAllowed ? "priority" : "planned"}><Icon name={source.enabled && source.redistributionAllowed ? "check" : "clock"} size={16}/></span><div><strong>{source.name}</strong><small>{source.language.toUpperCase()} • {source.licenseName === "verification-required" ? "izin distribusi belum diverifikasi" : source.licenseName}</small></div></div>)}<div className="integrity-note"><Icon name="shield"/><p><strong>Aturan sistem:</strong> teks Qur&apos;an tidak boleh diubah tanpa jejak revisi. Terjemahan dan tafsir tidak dapat disinkronkan sebelum lisensi distribusinya dicatat.</p></div></aside>
            </div>
          </div>
        )}

        {view === "renders" && (
          <div className="page">
            <PageHeader eyebrow="Produksi video" title="Antrean render" copy="Pantau komposisi yang sedang disiapkan dan hasil yang sudah selesai." action={<button className="secondary-button" onClick={() => navigate("studio")}><Icon name="studio"/> Kembali ke studio</button>} />
            <div className="simulation-banner real-mode"><Icon name="check"/><span><strong>Mesin render nyata</strong><small>{capabilities.ffmpeg ? "Browser menyusun video; FFmpeg mengubah hasilnya menjadi MP4 H.264." : "Mode browser menghasilkan WebM. Jalankan Docker untuk mengaktifkan MP4 H.264."}</small></span></div>
            {renderJobs.length === 0 ? <div className="empty-state"><span><Icon name="play" size={28}/></span><h2>Belum ada video dalam antrean</h2><p>Selesaikan pemeriksaan di studio, pilih format, lalu jalankan render pertama.</p><button className="primary-button" onClick={() => { setStudioStep("render"); navigate("studio"); }}>Siapkan video <Icon name="chevron"/></button></div> : <div className="render-list">{renderJobs.map((job) => <RenderJobCard key={job.id} job={job} onDownload={() => { if (!job.outputUrl) return; const anchor = document.createElement("a"); anchor.href = job.outputUrl; anchor.download = `${safeFilename(job.title)}.${job.format === "MP4" ? "mp4" : "webm"}`; anchor.click(); }}/>)}</div>}
          </div>
        )}

        {view === "settings" && (
          <div className="page settings-page">
            <PageHeader eyebrow="Fondasi sistem" title="Pengaturan aplikasi" copy="Konfigurasi identitas, penyimpanan, mesin AI, dan kesiapan deployment." />
            <div className="settings-layout">
              <nav className="settings-nav"><button className="active"><Icon name="globe"/> Identitas produk</button><button><Icon name="audio"/> Transkripsi AI</button><button><Icon name="book"/> Sumber Qur&apos;an</button><button><Icon name="play"/> Mesin render</button><button><Icon name="shield"/> Keamanan</button></nav>
              <section className="settings-content panel">
                <div className="settings-section"><span className="section-kicker">Identitas mandiri</span><h2>Taysriul Qur&apos;ani</h2><p>Proyek baru yang tidak berbagi akun, database, media, maupun deployment dengan Sullamul Hifz.</p><div className="settings-grid"><label><span>Nama aplikasi</span><input value="Taysriul Qur'ani" readOnly/></label><label><span>Domain produksi</span><input value="taysriulqurani.id" readOnly/></label><label><span>Versi produksi</span><input value="1.0.0" readOnly/></label><label><span>Zona waktu</span><input value="Asia/Jakarta" readOnly/></label></div>{sessionMode === "authenticated" && <div className="backup-actions"><button className="secondary-button backup-button" onClick={exportServerBackup}><Icon name="download"/> Unduh backup</button><input ref={restoreInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => restoreServerBackup(event.target.files?.[0])}/><button className="secondary-button backup-button" onClick={() => restoreInputRef.current?.click()}><Icon name="upload"/> Pulihkan backup</button></div>}</div>
                {sessionMode === "authenticated" && <div className="settings-section"><span className="section-kicker">Kolaborasi</span><h2>Anggota workspace</h2><p>Editor mengubah proyek, pemeriksa memberi komentar dan persetujuan, sedangkan viewer hanya membaca.</p><div className="member-list">{members.map((member) => <div key={member.id}><span>{member.display_name?.slice(0,2).toUpperCase() || "U"}</span><div><strong>{member.display_name}</strong><small>{member.email}</small></div><em>{member.role}</em></div>)}</div>{session.workspaces?.[0]?.role === "owner" && <form className="member-form" onSubmit={addWorkspaceMember}><input type="email" required value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="Email pengguna yang sudah terdaftar"/><select value={memberRole} onChange={(event) => setMemberRole(event.target.value as "editor" | "reviewer" | "viewer")}><option value="editor">Editor</option><option value="reviewer">Pemeriksa</option><option value="viewer">Viewer</option></select><button className="primary-button"><Icon name="plus"/> Tambahkan</button></form>}</div>}
                <div className="settings-section"><div className="section-title-row"><div><span className="section-kicker">Kesiapan mesin produksi</span><h2>Komponen deployment</h2></div><span className="readiness">{7 + Number(capabilities.quran.available) + Number(capabilities.transcription) + Number(capabilities.ffmpeg) + Number(capabilities.persistence?.healthy) + Number(capabilities.storage?.healthy) + Number(capabilities.queue?.healthy)} dari 13 aktif</span></div><div className="checklist">{[
                  ["Antarmuka responsif", true, "Desktop, tablet, dan ponsel"],
                  ["Docker & pemeriksaan kesehatan", true, "Disiapkan untuk Coolify"],
                  ["Konfigurasi environment", true, "Tidak menyimpan rahasia di kode"],
                  ["Fallback proyek lokal", true, "Pengujian tetap dapat dilakukan tanpa server"],
                  ["Generator subtitle SRT/VTT/ASS", true, "Ekspor Arab, terjemahan, atau gabungan"],
                  ["Akun & workspace", Boolean(capabilities.persistence?.healthy), capabilities.persistence?.healthy ? "PostgreSQL dan sesi aman aktif" : "Aktif saat PostgreSQL tersambung"],
                  ["Penyimpanan media", Boolean(capabilities.storage?.healthy), capabilities.storage?.healthy ? `${capabilities.storage?.driver} siap` : "Object storage belum aktif"],
                  ["Kolaborasi & audit", Boolean(capabilities.collaboration), capabilities.collaboration ? "Peran, komentar, persetujuan, audit aktif" : "Aktif bersama database"],
                  ["Antrean render", Boolean(capabilities.queue?.healthy), capabilities.queue?.healthy ? "Redis dan worker siap" : "Aktif saat Redis tersambung"],
                  ["Korpus 114 surah", capabilities.quran.available, capabilities.quran.available ? "6.236 ayat tervalidasi" : "Sinkron otomatis saat container aktif"],
                  ["Layanan transkripsi AI", capabilities.transcription, capabilities.transcription ? "Endpoint aktif" : "Provider belum diisi"],
                  ["Render FFmpeg MP4", capabilities.ffmpeg, capabilities.ffmpeg ? "H.264 + AAC aktif" : "Aktif di image Docker"],
                ].map(([label, ready, copy]) => <div key={String(label)}><span className={ready ? "done" : "pending"}>{ready ? <Icon name="check" size={14}/> : <Icon name="clock" size={14}/>}</span><div><strong>{label}</strong><small>{copy}</small></div><em>{ready ? "Siap" : "Berikutnya"}</em></div>)}</div></div>
                <div className="separation-card"><span><Icon name="shield"/></span><div><strong>Pagar pemisahan proyek aktif</strong><p>Repository, database, penyimpanan media, akun pengguna, domain, serta roadmap Taysriul Qur&apos;ani berdiri sendiri.</p></div></div>
              </section>
            </div>
          </div>
        )}
      </main>

      <nav className="mobile-nav" aria-label="Navigasi seluler">
        {navItems.slice(0, 5).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}
      </nav>

      {isNewProjectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsNewProjectOpen(false); }}>
          <form className="modal" onSubmit={createProject}>
            <div className="modal-head"><span className="upload-icon"><Icon name="plus"/></span><button type="button" className="icon-button" onClick={() => setIsNewProjectOpen(false)} aria-label="Tutup"><Icon name="close"/></button></div>
            <span className="section-kicker">Proyek baru</span><h2>Mulai produksi Qur&apos;an</h2><p>Beri nama yang mudah dikenali. Audio dapat ditambahkan setelah ruang studio dibuka.</p>
            <label><span>Nama proyek</span><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Contoh: Surah Ar-Rahman untuk YouTube"/></label>
            <div className="modal-options"><button type="button" className="active"><i className="ratio-shape r-16-9"/><span><strong>Video horizontal</strong><small>YouTube · 16:9</small></span><Icon name="check"/></button><button type="button"><i className="ratio-shape r-9-16"/><span><strong>Video vertikal</strong><small>Reels · 9:16</small></span></button></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsNewProjectOpen(false)}>Batal</button><button type="submit" className="primary-button">Buat & buka studio <Icon name="chevron"/></button></div>
          </form>
        </div>
      )}

      {toast && <div className="toast" role="status"><span><Icon name="check" size={15}/></span>{toast}</div>}
    </div>
  );
}

function LoadingScreen() {
  return <main className="auth-shell"><div className="auth-loading"><span className="brand-mark"><span>ت</span></span><strong>Menyiapkan Taysriul Qur&apos;ani…</strong><small>Memeriksa mesin, data, dan ruang kerja.</small></div></main>;
}

function AuthScreen({ mode, busy, error, onMode, onSubmit }: {
  mode: "login" | "register";
  busy: boolean;
  error: string;
  onMode: (mode: "login" | "register") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="auth-brand"><span className="brand-mark"><span>ت</span></span><div><strong>Taysriul Qur&apos;ani</strong><small>Studio Video Al-Qur&apos;an</small></div></div>
        <div><span className="section-kicker">Ruang produksi yang terjaga</span><h1>Dari lantunan ayat<br/>menjadi video yang<br/><em>layak dibagikan.</em></h1><p>Transkripsi Arab, pencocokan ayat, terjemahan, pemeriksaan manusia, dan render video dalam satu alur mandiri.</p></div>
        <div className="auth-principle"><Icon name="shield"/><span><strong>Data Taysriul Qur&apos;ani berdiri sendiri</strong><small>Akun, proyek, media, dan deployment tidak terhubung dengan Sullamul Hifz.</small></span></div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={onSubmit}>
          <span className="section-kicker">{mode === "login" ? "Selamat datang kembali" : "Mulai ruang dakwah Anda"}</span>
          <h2>{mode === "login" ? "Masuk ke studio" : "Buat akun mandiri"}</h2>
          <p>{mode === "login" ? "Lanjutkan proyek yang tersimpan aman di ruang kerja." : "Satu akun pertama otomatis menjadi pemilik workspace."}</p>
          {mode === "register" && <label><span>Nama lengkap</span><input name="displayName" autoComplete="name" required minLength={2} placeholder="Nama Anda"/></label>}
          <label><span>Email</span><input name="email" type="email" autoComplete="email" required placeholder="nama@email.com"/></label>
          <label><span>Kata sandi</span><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={10} placeholder="Minimal 10 karakter"/></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? "Memproses…" : mode === "login" ? "Masuk ke studio" : "Buat akun & workspace"}<Icon name="chevron"/></button>
          <button type="button" className="auth-switch" onClick={() => onMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}</button>
          <small className="auth-note">Dengan melanjutkan, setiap ayat tetap wajib diperiksa manusia sebelum render final.</small>
        </form>
      </section>
    </main>
  );
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const statusText = project.status === "draft" ? "Draf" : project.status === "review" ? "Perlu diperiksa" : "Siap render";
  return (
    <button className="project-card" onClick={onOpen}>
      <div className={`project-cover cover-${project.ratio.replace(":", "-")}`}>
        <span className="project-bismillah" dir="rtl">بِسْمِ اللَّهِ</span>
        <span className="project-ratio">{project.ratio}</span>
        <span className="project-play"><Icon name="play" size={17}/></span>
      </div>
      <div className="project-card-body"><div className="project-card-title"><strong>{project.title}</strong><Icon name="more" size={17}/></div><div className="project-meta"><span className={`status-label ${project.status}`}>{statusText}</span><span><Icon name="clock" size={13}/>{relativeDate(project.updatedAt)}</span></div><div className="project-progress"><i style={{width:`${project.progress}%`}}/><span>{project.progress}%</span></div></div>
    </button>
  );
}

function RenderJobCard({ job, onDownload }: { job: RenderJob; onDownload: () => void }) {
  const status = job.status === "complete" ? "Selesai" : job.status === "failed" ? "Gagal" : job.status === "cancelled" ? "Dibatalkan" : job.status === "queued" ? "Menunggu" : "Memproses";
  return <article>
    <div className="render-thumb"><span className="brand-mark compact"><span>ت</span></span><small>{job.ratio}</small></div>
    <div className="render-info">
      <div><strong>{job.title}</strong><span className={`render-status ${job.status}`}>{status}</span></div>
      <small>{job.resolution} · {job.format}{job.format === "MP4" ? " · H.264" : " · browser"}</small>
      {job.error ? <p className="render-error">{job.error}</p> : <div className="job-progress"><i style={{width:`${job.progress}%`}}/><span>{job.progress}%</span></div>}
    </div>
    {job.outputUrl ? <button className="download-result" onClick={onDownload}><Icon name="download" size={16}/> Unduh</button> : <span className="render-wait"><Icon name={job.status === "failed" ? "close" : "clock"} size={17}/></span>}
  </article>;
}
