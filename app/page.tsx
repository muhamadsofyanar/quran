"use client";

// @phase TQ-03/TQ-06/TQ-07/TQ-09/TQ-10/TQ-11/TQ-12 — independent production studio with persistent media, multilingual content, review, and rendering.

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

type View = "home" | "projects" | "studio" | "media" | "quran" | "renders" | "settings";
type StudioStep = "source" | "sync" | "design" | "review" | "render";
type Ratio = "16:9" | "9:16" | "1:1";
type ProjectStatus = "draft" | "review" | "ready";
type ProjectFilter = "all" | ProjectStatus;
type SettingsTab = "identity" | "transcription" | "quran" | "render" | "security";

type QuranPreview = {
  number?: number;
  nameArabic?: string;
  nameLatin?: string;
  nameTranslation?: string;
  revelationType?: string;
  ayahCount?: number;
  ayahs?: { ayah?: number; arabic?: string }[];
};

type Segment = {
  id: string;
  surah: string;
  surahNumber: number;
  ayah: number;
  start: number;
  end: number;
  arabic: string;
  translation: string;
  tafsir?: string;
  translationSourceEdition?: string;
  tafsirSourceEdition?: string;
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
  persistence?: { configured: boolean; healthy: boolean; database?: string; migration?: string | null };
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
type ContentSource = {
  edition: string;
  provider?: string;
  providerKey?: string;
  kind: "translation" | "tafsir" | string;
  language: string;
  name: string;
  author?: string;
  version?: string;
  attribution?: string;
  licenseName: string;
  licenseUrl?: string;
  enabled: boolean;
  redistributionAllowed: boolean;
  preferred?: boolean;
  onDemand?: boolean;
};
type WorkspaceMember = { id: string; email: string; display_name: string; role: "owner" | "editor" | "reviewer" | "viewer" };

type MediaAsset = {
  id: string;
  projectId?: string | null;
  kind: "audio" | "background" | "render-input" | "render-output" | "logo" | "other";
  originalName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  scope: "generic" | "surah" | "ayah";
  surahNumber?: number | null;
  ayahStart?: number | null;
  ayahEnd?: number | null;
  qari?: string | null;
  durationSeconds?: number | null;
  analysisStatus: "pending" | "analyzing" | "analyzed" | "needs-review" | "failed";
  metadata?: Record<string, unknown>;
  createdAt: string;
  downloadUrl: string;
  streamUrl: string;
};

type QuranLibraryRow = {
  number: number;
  name: string;
  arabic: string;
  meaning: string;
  ayahs: number;
};

const STORAGE_KEY = "taysriul-qurani-v0.1";

// Keep preview and canvas render on the exact same Arabic font stack.
// We intentionally rely on locally available fonts and never silently switch
// to a different first-choice family between preview and render.
const ARABIC_FONT_STACK = '"Traditional Arabic", "Noto Naskh Arabic", "Amiri", serif';
const ARABIC_FONT_SAMPLE = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

async function prepareArabicFont(fontSize = 64) {
  if (typeof document === "undefined" || !document.fonts) return;
  await document.fonts.ready;
  try {
    await document.fonts.load(`400 ${fontSize}px ${ARABIC_FONT_STACK}`, ARABIC_FONT_SAMPLE);
  } catch {
    // System fonts do not always expose load events; the identical stack still
    // keeps preview and canvas rendering consistent on the same browser.
  }
}

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
  { id: "media", label: "Pustaka Media", hint: "Audio & hasil", icon: "layers" },
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

const quranLibraryFallbackRows: QuranLibraryRow[] = [
  { number: 1, name: "Al-Fatihah", arabic: "الفاتحة", meaning: "Pembukaan", ayahs: 7 },
  { number: 2, name: "Al-Baqarah", arabic: "البقرة", meaning: "Sapi Betina", ayahs: 286 },
  { number: 3, name: "Ali 'Imran", arabic: "آل عمران", meaning: "Keluarga Imran", ayahs: 200 },
  { number: 4, name: "An-Nisa'", arabic: "النساء", meaning: "Wanita", ayahs: 176 },
  { number: 5, name: "Al-Ma'idah", arabic: "المائدة", meaning: "Hidangan", ayahs: 120 },
  { number: 6, name: "Al-An'am", arabic: "الأنعام", meaning: "Binatang Ternak", ayahs: 165 },
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

function formatBytes(bytes: number) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
  const [translationSource, setTranslationSource] = useState("quranenc:indonesian_affairs");
  const [tafsirSource, setTafsirSource] = useState("quranenc:indonesian_mokhtasar");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [fontScale, setFontScale] = useState(100);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showTafsir, setShowTafsir] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioFile, setAudioFile] = useState<File>();
  const [audioName, setAudioName] = useState<string>();
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(waveform);
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [backgroundFile, setBackgroundFile] = useState<File>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [capabilities, setCapabilities] = useState<ServerCapabilities>({ ffmpeg: false, transcription: false, quran: { available: false } });
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRatio, setNewProjectRatio] = useState<Ratio>("16:9");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("identity");
  const [quranQuery, setQuranQuery] = useState("");
  const [quranRows, setQuranRows] = useState<QuranLibraryRow[]>(quranLibraryFallbackRows);
  const [showEnabledSourcesOnly, setShowEnabledSourcesOnly] = useState(false);
  const [quranPreview, setQuranPreview] = useState<QuranPreview>();
  const [quranPreviewLoading, setQuranPreviewLoading] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [designPreset, setDesignPreset] = useState<"classic" | "minimal" | "cinematic">("classic");
  const [watermarkText, setWatermarkText] = useState("TAYSRiUL QUR'ANI");
  const [renderScope, setRenderScope] = useState<"surah" | "ayah">("surah");
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const [toast, setToast] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaKind, setMediaKind] = useState<"all" | MediaAsset["kind"]>("all");
  const [mediaScope, setMediaScope] = useState<"all" | MediaAsset["scope"]>("all");
  const [mediaBusyId, setMediaBusyId] = useState<string>();
  const [loadedAudioAssetId, setLoadedAudioAssetId] = useState<string>();
  const [loadedBackgroundAssetId, setLoadedBackgroundAssetId] = useState<string>();
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
  const previewStageRef = useRef<HTMLDivElement>(null);
  const mediaUploadRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);
  const serverSnapshots = useRef(new Map<string, string>());
  const contentHydrationRef = useRef(new Set<string>());
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects],
  );
  const selectedSegment = useMemo(
    () => activeProject?.segments.find((segment) => segment.id === selectedSegmentId) ?? activeProject?.segments[0],
    [activeProject, selectedSegmentId],
  );
  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = projectFilter === "all" || project.status === projectFilter;
      const matchesQuery = !query || project.title.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [projectFilter, projectQuery, projects]);
  const filteredQuranRows = useMemo(() => {
    const query = quranQuery.trim().toLowerCase();
    if (!query) return quranRows;
    return quranRows.filter((surah) =>
      String(surah.number) === query ||
      surah.name.toLowerCase().includes(query) ||
      surah.arabic.includes(quranQuery.trim()),
    );
  }, [quranQuery, quranRows]);
  const visibleContentSources = useMemo(
    () => showEnabledSourcesOnly ? contentSources.filter((source) => source.enabled && source.redistributionAllowed) : contentSources,
    [contentSources, showEnabledSourcesOnly],
  );
  const translationSources = useMemo(
    () => contentSources.filter((source) => source.kind === "translation" && source.enabled && source.redistributionAllowed),
    [contentSources],
  );
  const tafsirSources = useMemo(
    () => contentSources.filter((source) => source.kind === "tafsir" && source.enabled && source.redistributionAllowed),
    [contentSources],
  );
  const selectedTranslationInfo = useMemo(
    () => contentSources.find((source) => source.edition === translationSource),
    [contentSources, translationSource],
  );
  const selectedTafsirInfo = useMemo(
    () => contentSources.find((source) => source.edition === tafsirSource),
    [contentSources, tafsirSource],
  );
  const filteredMediaAssets = useMemo(() => {
    const query = mediaQuery.trim().toLowerCase();
    return mediaAssets.filter((asset) => {
      const kindOk = mediaKind === "all" || asset.kind === mediaKind;
      const scopeOk = mediaScope === "all" || asset.scope === mediaScope;
      const queryOk = !query || asset.originalName.toLowerCase().includes(query) || String(asset.surahNumber || "").includes(query) || String(asset.qari || "").toLowerCase().includes(query);
      return kindOk && scopeOk && queryOk;
    });
  }, [mediaAssets, mediaKind, mediaQuery, mediaScope]);


  async function refreshMediaLibrary() {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    try {
      const response = await fetch("/api/v1/assets", { headers: { "x-tq-workspace": session.workspaces[0].id } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Pustaka media tidak dapat dimuat.");
      setMediaAssets(payload.assets || []);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Pustaka media tidak dapat dimuat.");
    }
  }

  async function patchMediaAsset(assetId: string, patch: Record<string, unknown>, quiet = false) {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return null;
    const response = await fetch(`/api/v1/assets/${assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Metadata media gagal diperbarui.");
    if (!quiet) setToast("Metadata media diperbarui.");
    await refreshMediaLibrary();
    return payload.asset as MediaAsset;
  }

  async function loadAudioAsset(assetId: string, quiet = false) {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    const asset = mediaAssets.find((item) => item.id === assetId);
    try {
      const streamUrl = asset?.streamUrl || `/api/v1/assets/${assetId}/download?workspace=${encodeURIComponent(session.workspaces[0].id)}&disposition=inline`;
      const response = await fetch(streamUrl, { headers: { "x-tq-workspace": session.workspaces[0].id } });
      if (!response.ok) throw new Error("Audio tersimpan tidak dapat dimuat.");
      const blob = await response.blob();
      const name = asset?.originalName || activeProject?.audioName || "audio-quran.mp3";
      const file = new File([blob], name, { type: asset?.contentType || blob.type || "audio/mpeg" });
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
      setAudioFile(file);
      setAudioName(name);
      setAudioUrl(URL.createObjectURL(file));
      setLoadedAudioAssetId(assetId);
      if (!quiet) setToast("Audio dimuat dari Pustaka Media.");
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Audio tersimpan tidak dapat dimuat.");
    }
  }

  async function loadBackgroundAsset(assetId: string, quiet = false) {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    const asset = mediaAssets.find((item) => item.id === assetId);
    try {
      const streamUrl = asset?.streamUrl || `/api/v1/assets/${assetId}/download?workspace=${encodeURIComponent(session.workspaces[0].id)}&disposition=inline`;
      const response = await fetch(streamUrl, { headers: { "x-tq-workspace": session.workspaces[0].id } });
      if (!response.ok) throw new Error("Latar tersimpan tidak dapat dimuat.");
      const blob = await response.blob();
      const name = asset?.originalName || "background";
      const file = new File([blob], name, { type: asset?.contentType || blob.type || "image/jpeg" });
      if (backgroundUrl?.startsWith("blob:")) URL.revokeObjectURL(backgroundUrl);
      setBackgroundFile(file);
      setBackgroundUrl(URL.createObjectURL(file));
      setLoadedBackgroundAssetId(assetId);
      if (!quiet) setToast("Latar dimuat dari Pustaka Media.");
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Latar tersimpan tidak dapat dimuat.");
    }
  }

  async function useMediaAsset(asset: MediaAsset) {
    if (!activeProject) return setToast("Buat atau buka proyek terlebih dahulu.");
    if (asset.kind === "audio") {
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, audioAssetId: asset.id, audioName: asset.originalName, duration: asset.durationSeconds || project.duration, updatedAt: new Date().toISOString() } : project));
      await loadAudioAsset(asset.id);
      setStudioStep("source");
      navigate("studio");
      return;
    }
    if (asset.kind === "background" || asset.kind === "logo") {
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, backgroundAssetId: asset.id, updatedAt: new Date().toISOString() } : project));
      await loadBackgroundAsset(asset.id);
      setStudioStep("design");
      navigate("studio");
      return;
    }
    if (asset.kind === "render-output") {
      window.open(asset.downloadUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function deduplicateMediaAssets() {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    try {
      const response = await fetch("/api/v1/assets/deduplicate", {
        method: "POST",
        headers: { "x-tq-workspace": session.workspaces[0].id },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Duplikat media gagal dirapikan.");
      await refreshMediaLibrary();
      setToast(payload.archived ? `${payload.archived} media duplikat diarsipkan; file utama tetap aman.` : "Tidak ada media duplikat yang perlu dirapikan.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Duplikat media gagal dirapikan.");
    }
  }

  async function archiveMediaAsset(asset: MediaAsset) {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    if (!window.confirm(`Arsipkan ${asset.originalName}? Berkas tidak dihapus permanen.`)) return;
    setMediaBusyId(asset.id);
    try {
      const response = await fetch(`/api/v1/assets/${asset.id}`, { method: "DELETE", headers: { "x-tq-workspace": session.workspaces[0].id } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Media gagal diarsipkan.");
      await refreshMediaLibrary();
      setToast("Media dipindahkan ke arsip.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Media gagal diarsipkan.");
    } finally {
      setMediaBusyId(undefined);
    }
  }

  async function editMediaMetadata(asset: MediaAsset) {
    const originalName = window.prompt("Nama media:", asset.originalName);
    if (originalName === null) return;
    const qari = window.prompt("Nama qari (boleh kosong):", asset.qari || "");
    if (qari === null) return;
    const surahInput = window.prompt("Nomor surah 1-114 (kosong = umum):", asset.surahNumber ? String(asset.surahNumber) : "");
    if (surahInput === null) return;
    const surahNumber = surahInput.trim() ? Math.max(1, Math.min(114, Number(surahInput) || 1)) : null;
    let scope: MediaAsset["scope"] = asset.scope;
    let ayahStart: number | null = asset.ayahStart || null;
    let ayahEnd: number | null = asset.ayahEnd || null;
    if (surahNumber) {
      const ayahInput = window.prompt("Nomor ayat (kosong = satu surah penuh):", asset.scope === "ayah" && asset.ayahStart ? String(asset.ayahStart) : "");
      if (ayahInput === null) return;
      if (ayahInput.trim()) {
        ayahStart = Math.max(1, Number(ayahInput) || 1);
        ayahEnd = ayahStart;
        scope = "ayah";
      } else {
        ayahStart = 1;
        ayahEnd = asset.ayahEnd || null;
        scope = "surah";
      }
    } else {
      scope = "generic";
      ayahStart = null;
      ayahEnd = null;
    }
    try {
      await patchMediaAsset(asset.id, { originalName: originalName.trim() || asset.originalName, qari, surahNumber, ayahStart, ayahEnd, scope });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Metadata media gagal diperbarui.");
    }
  }

  async function uploadLibraryMedia(file?: File, refreshAfter = true) {
    if (!file || sessionMode !== "authenticated" || !session.workspaces?.[0]) return false;
    const kind: MediaAsset["kind"] = file.type.startsWith("audio/") ? "audio" : file.type.startsWith("image/") || file.type.startsWith("video/") ? "background" : "other";
    try {
      const response = await fetch(`/api/v1/assets?kind=${encodeURIComponent(kind)}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": file.name, "x-tq-workspace": session.workspaces[0].id },
        body: file,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unggah media gagal.");
      if (refreshAfter) {
        await refreshMediaLibrary();
        setToast("Media ditambahkan ke Pustaka Media.");
      }
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unggah media gagal.");
      return false;
    } finally {
      if (refreshAfter && mediaUploadRef.current) mediaUploadRef.current.value = "";
    }
  }

  async function uploadLibraryFiles(files: File[]) {
    if (!files.length) return;
    let uploaded = 0;
    for (const file of files.slice(0, 200)) {
      if (await uploadLibraryMedia(file, false)) uploaded += 1;
    }
    await refreshMediaLibrary();
    if (mediaUploadRef.current) mediaUploadRef.current.value = "";
    setToast(`${uploaded} dari ${Math.min(files.length, 200)} media berhasil ditambahkan.`);
  }


  // @phase TQ-11 — runtime bootstrap and persistence lifecycle.
  // Keep this block covered by tests: without it sessionMode remains "checking"
  // and the production UI never leaves LoadingScreen.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const bootstrapTimeout = window.setTimeout(() => controller.abort(), 12_000);

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { projects?: Project[]; renderJobs?: RenderJob[] };
        if (parsed.projects?.length) {
          setProjects(parsed.projects);
          setActiveProjectId(parsed.projects[0].id);
          setSelectedSegmentId(parsed.projects[0].segments?.[0]?.id || "");
        }
        if (parsed.renderJobs) setRenderJobs(parsed.renderJobs);
      }

      const hash = window.location.hash.replace("#", "") as View;
      if (navItems.some((item) => item.id === hash) || hash === "settings") setView(hash);
    } catch {
      // Invalid local drafts must never block startup.
    }

    hydrated.current = true;

    const bootstrap = async () => {
      try {
        const response = await fetch("/media-api/capabilities", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Capabilities endpoint unavailable.");
        const payload = await response.json() as ServerCapabilities;
        if (cancelled) return;
        setCapabilities(payload);

        void fetch("/media-api/quran/content/sources", { cache: "no-store" })
          .then((sourceResponse) => sourceResponse.ok ? sourceResponse.json() : Promise.reject())
          .then((content) => { if (!cancelled) setContentSources(content.sources || []); })
          .catch(() => {});

        if (payload.quran?.available) {
          void fetch("/media-api/quran/surahs", { cache: "no-store" })
            .then((surahResponse) => surahResponse.ok ? surahResponse.json() : Promise.reject())
            .then((data) => {
              if (cancelled || !Array.isArray(data.surahs)) return;
              setQuranRows(data.surahs.map((surah: {
                number?: number;
                nameLatin?: string;
                nameArabic?: string;
                nameTranslation?: string;
                ayahCount?: number;
              }) => ({
                number: Number(surah.number) || 0,
                name: String(surah.nameLatin || `Surah ${surah.number || ""}`),
                arabic: String(surah.nameArabic || ""),
                meaning: String(surah.nameTranslation || ""),
                ayahs: Number(surah.ayahCount) || 0,
              })).filter((surah: QuranLibraryRow) => surah.number >= 1 && surah.number <= 114));
            })
            .catch(() => {});
        }

        if (!payload.persistence?.configured) {
          setSessionMode("local");
          return;
        }

        const sessionResponse = await fetch("/api/v1/auth/session", { cache: "no-store", signal: controller.signal });
        if (!sessionResponse.ok) throw new Error("Session endpoint unavailable.");
        const account = await sessionResponse.json() as SessionInfo;
        if (cancelled) return;
        setSession(account);
        setSessionMode(account.authenticated ? "authenticated" : "guest");
      } catch {
        if (cancelled) return;
        setCapabilities({ ffmpeg: false, transcription: false, quran: { available: false } });
        // A failed bootstrap must fail open to the local workspace instead of
        // trapping the browser on the loading screen forever.
        setSessionMode("local");
      }
    };

    void bootstrap().finally(() => window.clearTimeout(bootstrapTimeout));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(bootstrapTimeout);
    };
  }, []);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    let cancelled = false;

    fetch("/api/v1/projects", { headers: { "x-tq-workspace": session.workspaces[0].id }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Proyek server tidak dapat dimuat.");
        if (cancelled) return;
        const loaded = (payload.projects || []).map((project: Project & { version?: number }) => ({
          ...project,
          serverVersion: project.version || project.serverVersion,
        }));
        serverSnapshots.current = new Map(loaded.map((project: Project) => [
          project.id,
          JSON.stringify({ title: project.title, state: projectState(project) }),
        ]));
        if (loaded.length) {
          setProjects(loaded);
          setActiveProjectId(loaded[0].id);
          setSelectedSegmentId(loaded[0].segments?.[0]?.id || "");
          setRatio(loaded[0].ratio || "16:9");
        } else {
          setProjects([]);
        }
      })
      .catch((error) => { if (!cancelled) setToast(error.message); });

    return () => { cancelled = true; };
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
    const dirty = projects.filter((project) =>
      project.serverVersion &&
      serverSnapshots.current.get(project.id) !== JSON.stringify({ title: project.title, state: projectState(project) }),
    );
    if (!dirty.length) return;

    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      for (const project of dirty) {
        const snapshot = JSON.stringify({ title: project.title, state: projectState(project) });
        try {
          const response = await fetch(`/api/v1/projects/${project.id}`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "if-match": String(project.serverVersion),
              "x-tq-workspace": session.workspaces![0].id,
            },
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
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    void refreshMediaLibrary();
  }, [session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !activeProject?.audioAssetId) return;
    if (activeProject.audioAssetId === loadedAudioAssetId) return;
    void loadAudioAsset(activeProject.audioAssetId, true);
  }, [activeProject?.audioAssetId, activeProject?.id, loadedAudioAssetId, mediaAssets, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !activeProject?.backgroundAssetId) return;
    if (activeProject.backgroundAssetId === loadedBackgroundAssetId) return;
    void loadBackgroundAsset(activeProject.backgroundAssetId, true);
  }, [activeProject?.backgroundAssetId, activeProject?.id, loadedBackgroundAssetId, mediaAssets, sessionMode]);

  useEffect(() => {
    if (!selectedSegment || !showTranslation || translationSource === "Teks manual") return;
    if (selectedSegment.translation) return;
    void fetchContentForSegment(translationSource, selectedSegment, "translation", true);
  }, [selectedSegmentId, translationSource, showTranslation]);

  useEffect(() => {
    if (!selectedSegment || !showTafsir || tafsirSource === "Teks manual") return;
    if (selectedSegment.tafsir) return;
    void fetchContentForSegment(tafsirSource, selectedSegment, "tafsir", true);
  }, [selectedSegmentId, tafsirSource, showTafsir]);

  useEffect(() => {
    if (!activeProject?.segments?.length) return;
    const needsTranslation = showTranslation && translationSource !== "Teks manual" && activeProject.segments.some((segment) => !segment.translation);
    const needsTafsir = showTafsir && tafsirSource !== "Teks manual" && activeProject.segments.some((segment) => !segment.tafsir);
    if (!needsTranslation && !needsTafsir) return;

    const references = activeProject.segments.map((segment) => `${segment.surahNumber}:${segment.ayah}`).join(",");
    const key = `${activeProject.id}|${translationSource}|${showTafsir ? tafsirSource : "tafsir-off"}|${references}`;
    if (contentHydrationRef.current.has(key)) return;
    contentHydrationRef.current.add(key);

    let cancelled = false;
    void (async () => {
      let hydrated = activeProject.segments;
      if (needsTranslation) hydrated = await hydrateSegmentsContent(hydrated, translationSource, "translation", true);
      if (needsTafsir) hydrated = await hydrateSegmentsContent(hydrated, tafsirSource, "tafsir", true);
      if (cancelled) return;

      const changed = hydrated.some((segment, index) =>
        segment.translation !== activeProject.segments[index]?.translation ||
        segment.translationSourceEdition !== activeProject.segments[index]?.translationSourceEdition ||
        segment.tafsir !== activeProject.segments[index]?.tafsir ||
        segment.tafsirSourceEdition !== activeProject.segments[index]?.tafsirSourceEdition,
      );
      if (!changed) return;
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, segments: hydrated, updatedAt: new Date().toISOString() } : project));
    })();

    return () => { cancelled = true; };
  }, [activeProject?.id, activeProject?.segments, showTranslation, translationSource, showTafsir, tafsirSource]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0] || !capabilities.queue?.healthy) return;
    let active = true;
    const refresh = () => fetch("/api/v1/render-jobs", {
      headers: { "x-tq-workspace": session.workspaces![0].id },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Antrean render tidak dapat dimuat.");
        if (!active) return;
        const jobs = (payload.jobs || []).map((job: {
          id: string;
          project_id: string;
          status: RenderJob["status"];
          progress: number;
          preset?: { title?: string; ratio?: Ratio; resolution?: string };
          output_asset_id?: string;
          error?: string;
        }) => ({
          id: job.id,
          projectId: job.project_id,
          title: job.preset?.title || "Video Qur'an",
          ratio: job.preset?.ratio || "16:9",
          resolution: job.preset?.resolution || "1080p",
          status: job.status,
          progress: job.progress,
          format: "MP4" as const,
          outputUrl: job.output_asset_id ? `/api/v1/assets/${job.output_asset_id}/download?workspace=${session.workspaces![0].id}` : undefined,
          error: job.error,
        }));
        setRenderJobs(jobs);
        if (jobs.some((job: RenderJob) => job.status === "complete")) void refreshMediaLibrary();
      })
      .catch(() => {});

    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [capabilities.queue?.healthy, session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0] || !activeProject?.serverVersion) return;
    fetch(`/api/v1/comments?projectId=${encodeURIComponent(activeProject.id)}`, {
      headers: { "x-tq-workspace": session.workspaces[0].id },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok) setComments(payload.comments || []);
      })
      .catch(() => {});
  }, [activeProject?.id, activeProject?.serverVersion, session, sessionMode]);

  useEffect(() => {
    if (sessionMode !== "authenticated" || !session.workspaces?.[0]) return;
    fetch("/api/v1/members", { headers: { "x-tq-workspace": session.workspaces[0].id }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok) setMembers(payload.members || []);
      })
      .catch(() => {});
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

  function goToNextStudioStep() {
    const index = studioSteps.findIndex((step) => step.id === studioStep);
    if (index < 0) return;
    if (index < studioSteps.length - 1) {
      setStudioStep(studioSteps[index + 1].id);
      return;
    }
    navigate("renders");
  }

  async function togglePreviewFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (!previewStageRef.current?.requestFullscreen) {
        setToast("Browser ini belum mendukung pratinjau layar penuh.");
        return;
      }
      await previewStageRef.current.requestFullscreen();
    } catch {
      setToast("Pratinjau layar penuh tidak dapat dibuka.");
    }
  }

  async function openQuranSurah(number: number) {
    if (!capabilities.quran.available) {
      setToast("Korpus produksi belum tersedia.");
      return;
    }
    setQuranPreviewLoading(true);
    try {
      const response = await fetch(`/media-api/quran/surah?number=${number}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Surah tidak dapat dimuat.");
      setQuranPreview(payload as QuranPreview);
      setToast(`Surah ${number} berhasil dimuat dari korpus produksi.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Surah tidak dapat dimuat.");
    } finally {
      setQuranPreviewLoading(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const title = newProjectName.trim() || "Proyek Qur'an Baru";
    let project: Project = {
      id: `project-${Date.now()}`,
      title,
      updatedAt: new Date().toISOString(),
      status: "draft",
      ratio: newProjectRatio,
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
    setNewProjectRatio("16:9");
    setIsNewProjectOpen(false);
    setToast(sessionMode === "authenticated" ? "Proyek baru dibuat dan disimpan di server." : "Proyek baru dibuat dan disimpan di perangkat ini.");
    window.setTimeout(() => openProject(project.id), 0);
  }

  async function duplicateActiveProject() {
    if (!activeProject) return;
    const title = `${activeProject.title} — Salinan`;
    let project: Project = {
      ...activeProject,
      id: `project-${Date.now()}`,
      title,
      updatedAt: new Date().toISOString(),
      serverVersion: undefined,
      segments: activeProject.segments.map((segment) => ({ ...segment, id: `${segment.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` })),
    };
    if (sessionMode === "authenticated" && session.workspaces?.[0]) {
      try {
        const response = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "content-type": "application/json", "x-tq-workspace": session.workspaces[0].id },
          body: JSON.stringify({ title, state: projectState(project) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Duplikasi proyek gagal.");
        project = { ...payload.project, serverVersion: payload.project.version };
        serverSnapshots.current.set(project.id, JSON.stringify({ title: project.title, state: projectState(project) }));
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Duplikasi proyek gagal.");
        return;
      }
    }
    setProjects((items) => [project, ...items]);
    setToast("Salinan proyek berhasil dibuat.");
    window.setTimeout(() => openProject(project.id, "design"), 0);
  }

  function processAudio(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      setToast("Pilih berkas audio atau video yang didukung.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setToast("Ukuran berkas maksimal adalah 500 MB.");
      return;
    }
    if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioFile(file);
    setAudioName(file.name);
    setLoadedAudioAssetId(undefined);
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
        setLoadedAudioAssetId(payload.asset.id);
        await refreshMediaLibrary();
        setToast("Audio tersimpan di Pustaka Media dan terhubung ke proyek.");
      }).catch((error) => setToast(error.message));
    }
  }

  function handleAudioMetadata() {
    const duration = audioRef.current?.duration;
    if (!duration || !Number.isFinite(duration)) return;
    setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, duration } : project));
    if (activeProject.audioAssetId && sessionMode === "authenticated") {
      void patchMediaAsset(activeProject.audioAssetId, { durationSeconds: duration }, true).catch(() => {});
    }
  }

  function handleAudioTimeUpdate() {
    const time = audioRef.current?.currentTime || 0;
    setPlayheadTime(time);
    const segment = activeProject?.segments.find((item) => time >= item.start && time < item.end);
    if (segment && segment.id !== selectedSegmentId) setSelectedSegmentId(segment.id);
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
    if (backgroundUrl?.startsWith("blob:")) URL.revokeObjectURL(backgroundUrl);
    setBackgroundFile(file);
    setBackgroundUrl(URL.createObjectURL(file));
    setLoadedBackgroundAssetId(undefined);
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
        setLoadedBackgroundAssetId(payload.asset.id);
        await refreshMediaLibrary();
        setToast("Latar tersimpan di Pustaka Media.");
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

  function rememberProjectState() {
    if (!activeProject) return;
    undoStack.current = [...undoStack.current.slice(-29), structuredClone(activeProject)];
    redoStack.current = [];
  }

  function undoProjectChange() {
    const previous = undoStack.current.pop();
    if (!previous || !activeProject) return setToast("Belum ada perubahan untuk dibatalkan.");
    redoStack.current.push(structuredClone(activeProject));
    setProjects((items) => items.map((project) => project.id === activeProject.id ? previous : project));
    setSelectedSegmentId(previous.segments.find((segment) => segment.id === selectedSegmentId)?.id || previous.segments[0]?.id || "");
    setToast("Perubahan terakhir dibatalkan.");
  }

  function redoProjectChange() {
    const next = redoStack.current.pop();
    if (!next || !activeProject) return setToast("Belum ada perubahan untuk diulangi.");
    undoStack.current.push(structuredClone(activeProject));
    setProjects((items) => items.map((project) => project.id === activeProject.id ? next : project));
    setSelectedSegmentId(next.segments.find((segment) => segment.id === selectedSegmentId)?.id || next.segments[0]?.id || "");
    setToast("Perubahan diterapkan kembali.");
  }

  function updateSegment(patch: Partial<Segment>) {
    if (!selectedSegment) return;
    rememberProjectState();
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

  function applySegmentContent(segmentId: string, patch: Partial<Segment>) {
    setProjects((items) => items.map((project) => project.id === activeProject.id ? {
      ...project,
      updatedAt: new Date().toISOString(),
      segments: project.segments.map((segment) => segment.id === segmentId ? { ...segment, ...patch } : segment),
    } : project));
  }

  async function fetchContentForSegment(edition: string, segment: Segment, field: "translation" | "tafsir", quiet = false) {
    if (!edition || edition === "Teks manual") return;
    try {
      const response = await fetch(`/media-api/quran/content?edition=${encodeURIComponent(edition)}&surah=${segment.surahNumber}&ayah=${segment.ayah}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sumber belum tersedia.");
      applySegmentContent(segment.id, field === "translation"
        ? { translation: payload.entry.text || "", translationSourceEdition: edition }
        : { tafsir: payload.entry.text || "", tafsirSourceEdition: edition });
      if (!quiet) setToast(`${field === "translation" ? "Terjemahan" : "Tafsir"} dimuat dari sumber terverifikasi.`);
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Sumber belum tersedia.");
    }
  }

  async function hydrateSegmentsContent(segments: Segment[], edition: string, field: "translation" | "tafsir", preserveExisting = false, strict = false) {
    if (!edition || edition === "Teks manual" || !segments.length) return segments;
    try {
      const response = await fetch("/media-api/quran/content/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edition, refs: segments.map((segment) => ({ surahNumber: segment.surahNumber, ayah: segment.ayah })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sumber konten belum tersedia.");
      const map = new Map<string, string>((payload.entries || []).map((entry: { surahNumber: number; ayah: number; text?: string }) => [`${entry.surahNumber}:${entry.ayah}`, String(entry.text || "")] as [string, string]));
      return segments.map((segment) => {
        if (preserveExisting && (field === "translation" ? Boolean(segment.translation) : Boolean(segment.tafsir))) return segment;
        const text = map.get(`${segment.surahNumber}:${segment.ayah}`);
        if (text === undefined) return segment;
        return field === "translation"
          ? { ...segment, translation: text, translationSourceEdition: edition }
          : { ...segment, tafsir: text, tafsirSourceEdition: edition };
      });
    } catch (error) {
      if (strict) throw error;
      return segments;
    }
  }

  async function selectTranslationSource(source: string) {
    setTranslationSource(source);
    if (!activeProject || source === "Teks manual") return;
    setContentBusy(true);
    try {
      const hydrated = await hydrateSegmentsContent(activeProject.segments, source, "translation", false, true);
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, segments: hydrated, updatedAt: new Date().toISOString() } : project));
      setToast("Sumber terjemahan diterapkan ke seluruh potongan proyek.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Sumber terjemahan belum dapat dimuat.");
    } finally {
      setContentBusy(false);
    }
  }

  async function selectTafsirSource(source: string) {
    setTafsirSource(source);
    if (!activeProject || source === "Teks manual") return;
    setContentBusy(true);
    try {
      const hydrated = await hydrateSegmentsContent(activeProject.segments, source, "tafsir", false, true);
      setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, segments: hydrated, updatedAt: new Date().toISOString() } : project));
      setToast("Sumber tafsir diterapkan ke seluruh potongan proyek.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Sumber tafsir belum dapat dimuat.");
    } finally {
      setContentBusy(false);
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
        body: JSON.stringify({ parts: parts.slice(0, 240), options: { lookBehind: 2, lookAhead: 32, alternatives: 3, threshold: 0.22, minimumSimilarity: 0.16, allowBacktrack: false } }),
      });
      const alignmentPayload = await alignmentResponse.json().catch(() => ({}));
      if (!alignmentResponse.ok) throw new Error(alignmentPayload.error || "Alignment ayat gagal.");
      const matched: AlignedPart[] = alignmentPayload.aligned || [];
      const duration = activeProject.duration || audioRef.current?.duration || 10;
      const rawSegments: Segment[] = matched
        .filter((item): item is AlignedPart & { ayah: NonNullable<AlignedPart["ayah"]> } => Boolean(item.matched && item.ayah && item.ayah.ayah >= 1 && item.ayah.surahNumber >= 1 && item.ayah.surahNumber <= 114))
        .map((item, index) => ({
          id: `seg-ai-${Date.now()}-${index}`,
          surah: item.ayah.surah,
          surahNumber: item.ayah.surahNumber,
          ayah: item.ayah.ayah,
          start: typeof item.start === "number" && Number.isFinite(item.start) ? Math.max(0, item.start) : (index / Math.max(1, matched.length)) * duration,
          end: typeof item.end === "number" && Number.isFinite(item.end) ? Math.min(duration, Math.max(0.1, item.end)) : ((index + 1) / Math.max(1, matched.length)) * duration,
          arabic: item.ayah.arabic,
          translation: "",
          confidence: Math.max(0, Math.min(100, item.confidence)),
          verified: false,
        }))
        .filter((segment) => segment.end > segment.start && segment.confidence > 0);
      const nextSegments: Segment[] = rawSegments.reduce<Segment[]>((items, segment) => {
        const previous = items.at(-1);
        if (previous && previous.surahNumber === segment.surahNumber && previous.ayah === segment.ayah && segment.start <= previous.end + 1.2) {
          previous.end = Math.max(previous.end, segment.end);
          previous.confidence = Math.max(previous.confidence, segment.confidence);
          return items;
        }
        items.push({ ...segment });
        return items;
      }, []);
      if (!nextSegments.length) throw new Error("Belum ditemukan kecocokan ayat yang memadai.");
      let enrichedSegments = nextSegments;
      if (showTranslation && translationSource !== "Teks manual") {
        enrichedSegments = await hydrateSegmentsContent(enrichedSegments, translationSource, "translation");
      }
      if (showTafsir && tafsirSource !== "Teks manual") {
        enrichedSegments = await hydrateSegmentsContent(enrichedSegments, tafsirSource, "tafsir");
      }
      setProjects((items) => items.map((project) => project.id === activeProject.id ? {
        ...project,
        segments: enrichedSegments,
        duration,
        progress: Math.max(project.progress, 58),
        status: "review",
        updatedAt: new Date().toISOString(),
      } : project));
      setSelectedSegmentId(enrichedSegments[0].id);
      setStudioStep("sync");
      if (activeProject.audioAssetId && sessionMode === "authenticated") {
        const surahs = [...new Set(enrichedSegments.map((segment) => segment.surahNumber))];
        const sameSurah = surahs.length === 1;
        const ayahs = enrichedSegments.map((segment) => segment.ayah);
        const minAyah = Math.min(...ayahs);
        const maxAyah = Math.max(...ayahs);
        const needsReview = nextSegments.some((segment) => segment.confidence < 70);
        void patchMediaAsset(activeProject.audioAssetId, {
          scope: sameSurah && nextSegments.length === 1 ? "ayah" : sameSurah ? "surah" : "generic",
          surahNumber: sameSurah ? surahs[0] : null,
          ayahStart: sameSurah ? minAyah : null,
          ayahEnd: sameSurah ? maxAyah : null,
          durationSeconds: duration,
          analysisStatus: needsReview ? "needs-review" : "analyzed",
          metadata: { surahName: sameSurah ? enrichedSegments[0].surah : null, transcript: fullText, alignment: enrichedSegments.map((segment) => ({ surahNumber: segment.surahNumber, ayah: segment.ayah, start: segment.start, end: segment.end, confidence: segment.confidence })), translationSource, tafsirSource: showTafsir ? tafsirSource : null },
        }, true).catch(() => {});
      }
      setToast(`${enrichedSegments.length} potongan ayat ditemukan${showTranslation && translationSource !== "Teks manual" ? " beserta terjemahan" : ""}. Periksa teks dan waktunya sebelum ekspor.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Transkripsi tidak dapat diselesaikan.");
    } finally {
      setIsTranscribing(false);
    }
  }

  function addManualSegment() {
    rememberProjectState();
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

  function exportSubtitle(format: "srt" | "vtt" | "ass", mode: "arabic" | "translation" | "tafsir" | "both" | "all" = "both") {
    const content = format === "srt" ? buildSrt(activeProject.segments, mode) : format === "vtt" ? buildVtt(activeProject.segments, mode) : buildAss(activeProject.segments, mode, ratio);
    const mime = format === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8";
    downloadBlob(new Blob([`\uFEFF${content}`], { type: mime }), `${safeFilename(activeProject.title)}-${mode}.${format}`);
    setToast(`Subtitle ${format.toUpperCase()} berhasil dibuat.`);
  }

  async function renderVideo(ratioOverride?: Ratio, navigateAfter = true, batchId?: string) {
    if (isRendering && !batchId) return;
    const outputRatio = ratioOverride || ratio;
    const renderSegments = renderScope === "ayah" && selectedSegment ? [selectedSegment] : activeProject.segments;
    if (!renderSegments.length) return setToast("Tambahkan minimal satu potongan ayat.");
    if (renderSegments.some((segment) => !segment.verified)) return setToast(renderScope === "ayah" ? "Ayat yang dipilih harus diperiksa manusia sebelum render." : "Semua potongan ayat harus diperiksa manusia sebelum render.");
    if (!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream)) return setToast("Browser ini belum mendukung render lokal. Gunakan Chrome atau Edge terbaru.");
    const sourceStart = renderScope === "ayah" ? Math.max(0, renderSegments[0].start) : 0;
    const sourceEndHint = renderScope === "ayah" ? renderSegments[0].end : Math.max(activeProject.duration || 0, renderSegments.at(-1)?.end || 0);
    const renderTitle = renderScope === "ayah" ? `${activeProject.title} • QS ${renderSegments[0].surahNumber}:${renderSegments[0].ayah}` : activeProject.title;
    const jobId = `render-${Date.now()}`;
    const baseJob: RenderJob = { id: jobId, projectId: activeProject.id, title: renderTitle, ratio: outputRatio, resolution, progress: 5, status: "queued", format: capabilities.ffmpeg ? "MP4" : "WebM" };
    setRenderJobs((jobs) => [baseJob, ...jobs]);
    setIsRendering(true);
    setToast(renderScope === "ayah" ? "Render ayat dimulai…" : "Render surah/proyek dimulai…");
    try {
      const { width, height } = canvasDimensions(outputRatio, resolution);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Kanvas video tidak tersedia.");
      const arabicRenderFontSize = Math.round(width * (outputRatio === "9:16" ? 0.063 : 0.043) * (fontScale / 100));
      await prepareArabicFont(arabicRenderFontSize);
      const sourceAudio = audioUrl ? new Audio(audioUrl) : null;
      let fullDuration = Math.max(1, activeProject.duration || renderSegments.at(-1)?.end || 10);
      if (sourceAudio) {
        fullDuration = await new Promise<number>((resolve, reject) => {
          sourceAudio.preload = "auto";
          sourceAudio.onloadedmetadata = () => resolve(sourceAudio.duration);
          sourceAudio.onerror = () => reject(new Error("Audio tidak dapat dibaca untuk render."));
        });
      }
      const captureStart = Math.min(Math.max(0, sourceStart), Math.max(0, fullDuration - 0.1));
      const captureEnd = Math.min(fullDuration, Math.max(captureStart + 0.1, sourceEndHint || fullDuration));
      const duration = Math.max(0.1, captureEnd - captureStart);
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
        sourceAudio.currentTime = captureStart;
      }
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((item) => MediaRecorder.isTypeSupported(item));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: resolution === "2160p (4K)" ? 18_000_000 : resolution === "1440p" ? 12_000_000 : 8_000_000 } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Perekaman kanvas gagal.")); });
      let running = true;
      const startedAt = performance.now();
      const draw = () => {
        if (!running) return;
        const absoluteTime = sourceAudio?.currentTime ?? Math.min(captureEnd, captureStart + (performance.now() - startedAt) / 1000);
        const segment = renderSegments.find((item) => absoluteTime >= item.start && absoluteTime < item.end) ?? renderSegments.at(-1)!;
        if (designPreset === "minimal") {
          context.fillStyle = "#09291f";
          context.fillRect(0, 0, width, height);
        } else {
          const gradient = context.createLinearGradient(0, 0, width, height);
          if (designPreset === "cinematic") {
            gradient.addColorStop(0, "#030b08"); gradient.addColorStop(0.55, "#15372b"); gradient.addColorStop(1, "#020705");
          } else {
            gradient.addColorStop(0, "#071f19"); gradient.addColorStop(0.55, "#0d3b2d"); gradient.addColorStop(1, "#061510");
          }
          context.fillStyle = gradient; context.fillRect(0, 0, width, height);
        }
        const background: HTMLImageElement | HTMLVideoElement | null = backgroundImage || (backgroundVideo?.readyState && backgroundVideo.readyState >= 2 ? backgroundVideo : null);
        if (background) {
          const sourceWidth = background instanceof HTMLVideoElement ? background.videoWidth : background.naturalWidth;
          const sourceHeight = background instanceof HTMLVideoElement ? background.videoHeight : background.naturalHeight;
          const scale = Math.max(width / sourceWidth, height / sourceHeight);
          const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale;
          context.drawImage(background, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
          context.fillStyle = designPreset === "cinematic" ? "rgba(0,8,5,.72)" : "rgba(2,18,13,.62)"; context.fillRect(0, 0, width, height);
        }
        if (designPreset !== "minimal") {
          context.strokeStyle = "rgba(219,181,110,.72)"; context.lineWidth = Math.max(2, width * 0.002); context.strokeRect(width * 0.035, height * 0.045, width * 0.93, height * 0.91);
        }
        const fade = 0.25;
        const fadeIn = Math.min(1, Math.max(0, (absoluteTime - segment.start) / fade));
        const fadeOut = Math.min(1, Math.max(0, (segment.end - absoluteTime) / fade));
        context.globalAlpha = Math.min(fadeIn, fadeOut, 1);
        context.textAlign = "center"; context.direction = "rtl"; context.fillStyle = "#fffdf5";
        const arabicSize = arabicRenderFontSize;
        context.font = `400 ${arabicSize}px ${ARABIC_FONT_STACK}`;
        drawWrappedText(context, segment.arabic, width / 2, height * 0.47, width * 0.82, arabicSize * 1.7);
        if (showTranslation && segment.translation) {
          context.direction = "ltr"; context.fillStyle = "rgba(255,255,255,.9)"; const translationSize = Math.round(width * (outputRatio === "9:16" ? 0.027 : 0.018));
          context.font = `400 ${translationSize}px Arial, sans-serif`;
          drawWrappedText(context, segment.translation, width / 2, height * (showTafsir && segment.tafsir ? 0.63 : 0.67), width * 0.78, translationSize * 1.42);
        }
        if (showTafsir && segment.tafsir) {
          context.direction = "ltr"; context.fillStyle = "rgba(224,232,228,.78)"; const tafsirSize = Math.round(width * (outputRatio === "9:16" ? 0.021 : 0.014));
          context.font = `400 ${tafsirSize}px Arial, sans-serif`;
          drawWrappedText(context, segment.tafsir, width / 2, height * 0.76, width * 0.8, tafsirSize * 1.38);
        }
        context.globalAlpha = 1;
        context.direction = "ltr";
        const creditParts = [];
        if (showTranslation && selectedTranslationInfo?.attribution) creditParts.push(`${selectedTranslationInfo.attribution}${selectedTranslationInfo.version ? ` v${selectedTranslationInfo.version}` : ""}`);
        if (showTafsir && selectedTafsirInfo?.attribution) creditParts.push(`${selectedTafsirInfo.attribution}${selectedTafsirInfo.version ? ` v${selectedTafsirInfo.version}` : ""}`);
        if (creditParts.length) {
          context.textAlign = "center"; context.fillStyle = "rgba(220,230,225,.52)"; context.font = `400 ${Math.max(9, Math.round(width * 0.0075))}px Arial`;
          context.fillText(creditParts.join(" • ").slice(0, 180), width * 0.5, height * 0.875);
        }
        context.textAlign = "left"; context.fillStyle = "#dbb56e"; context.font = `600 ${Math.round(width * 0.012)}px Arial`;
        if (watermarkText.trim()) context.fillText(watermarkText.trim().slice(0, 80), width * 0.055, height * 0.92);
        context.textAlign = "right"; context.fillText(`QS ${segment.surahNumber}:${segment.ayah}`, width * 0.945, height * 0.92);
        const progress = Math.min(82, 12 + Math.round(((absoluteTime - captureStart) / duration) * 70));
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress: Math.max(12, progress), status: "processing" } : job));
        requestAnimationFrame(draw);
      };
      recorder.start(1000);
      if (backgroundVideo) await backgroundVideo.play();
      draw();
      if (sourceAudio) {
        await sourceAudio.play();
        await new Promise<void>((resolve) => {
          const watch = window.setInterval(() => {
            if (sourceAudio.currentTime >= captureEnd || sourceAudio.ended) {
              window.clearInterval(watch);
              sourceAudio.pause();
              resolve();
            }
          }, 50);
        });
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, duration * 1000));
      }
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
            "x-project-name": renderTitle,
            "x-render-ratio": outputRatio,
            "x-render-resolution": resolution,
            "x-render-duration": String(duration),
            "x-render-scope": renderScope,
            ...(batchId ? { "x-render-batch": batchId } : {}),
          },
          body: webm,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Video gagal masuk antrean render.");
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, id: payload.job.id, progress: 0, status: "queued", format: "MP4" } : job));
        setToast("Video masuk antrean server. Hasil MP4 akan otomatis masuk Pustaka Media.");
        if (navigateAfter) navigate("renders");
        return;
      }
      let output = webm;
      let format: "MP4" | "WebM" = "WebM";
      if (capabilities.ffmpeg) {
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress: 88 } : job));
        const response = await fetch("/media-api/transcode", { method: "POST", headers: { "content-type": webm.type, "x-project-name": safeFilename(renderTitle) }, body: webm });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "FFmpeg gagal membuat MP4.");
        output = await response.blob(); format = "MP4";
      }
      const outputUrl = URL.createObjectURL(output);
      setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, progress: 100, status: "complete", format, outputUrl } : job));
      if (renderScope === "surah") setProjects((items) => items.map((project) => project.id === activeProject.id ? { ...project, progress: 100, status: "ready" } : project));
      setToast(`Video ${format} selesai. Buka menu Render untuk mengunduh.`);
      if (navigateAfter) navigate("renders");
    } catch (error) {
      setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, status: "failed", error: error instanceof Error ? error.message : "Render gagal." } : job));
      setToast(error instanceof Error ? error.message : "Render gagal.");
    } finally {
      setIsRendering(false);
    }
  }

  async function renderAllRatios() {
    if (isRendering) return;
    const batchId = `batch-${Date.now()}`;
    setToast("Batch 16:9, 9:16, dan 1:1 dimulai. Proses berjalan berurutan agar browser tetap stabil.");
    for (const targetRatio of ["16:9", "9:16", "1:1"] as Ratio[]) {
      await renderVideo(targetRatio, false, batchId);
    }
    navigate("renders");
  }

  function exportProject() {
    const payload = {
      product: "Taysriul Qur'ani",
      schemaVersion: "0.1",
      exportedAt: new Date().toISOString(),
      project: activeProject,
      preferences: { mushafVersion, translationSource, tafsirSource, ratio, resolution, fontScale, showTranslation, showTafsir },
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

  async function retryRenderJob(jobId: string) {
    if (!session.workspaces?.[0]) return;
    try {
      const response = await fetch(`/api/v1/render-jobs/${jobId}/retry`, { method: "POST", headers: { "x-tq-workspace": session.workspaces[0].id } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Render tidak dapat dicoba ulang.");
      setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, status: "queued", progress: 0, error: undefined } : job));
      setToast("Render dimasukkan kembali ke antrean.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Render tidak dapat dicoba ulang.");
    }
  }

  async function cancelRenderJob(jobId: string) {
    if (!session.workspaces?.[0]) return;
    try {
      const response = await fetch(`/api/v1/render-jobs/${jobId}`, { method: "DELETE", headers: { "x-tq-workspace": session.workspaces[0].id } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Render tidak dapat dibatalkan.");
      if (payload.cancelRequested) setToast("Permintaan pembatalan diterima. Worker akan berhenti pada checkpoint aman.");
      else {
        setRenderJobs((jobs) => jobs.map((job) => job.id === jobId ? { ...job, status: "cancelled", progress: 0 } : job));
        setToast("Render dibatalkan.");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Render tidak dapat dibatalkan.");
    }
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
            <span className="stage-pill"><span /> Production v1.2</span>
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
              <div className="search-field"><Icon name="search" /><input aria-label="Cari proyek" placeholder="Cari judul proyek…" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} /></div>
              <div className="filter-pills">
                <button className={projectFilter === "all" ? "active" : ""} onClick={() => setProjectFilter("all")}>Semua <span>{projects.length}</span></button>
                <button className={projectFilter === "draft" ? "active" : ""} onClick={() => setProjectFilter("draft")}>Draf</button>
                <button className={projectFilter === "review" ? "active" : ""} onClick={() => setProjectFilter("review")}>Perlu diperiksa</button>
                <button className={projectFilter === "ready" ? "active" : ""} onClick={() => setProjectFilter("ready")}>Siap render</button>
              </div>
            </div>
            <div className="project-grid wide">
              {filteredProjects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => openProject(project.id)} />)}
              <button className="new-project-card" onClick={() => setIsNewProjectOpen(true)}><span><Icon name="plus" size={24} /></span><strong>Buat proyek baru</strong><small>Mulai produksi dari sumber baru</small></button>
            </div>
          </div>
        )}

        {view === "media" && (
          <div className="page media-page">
            <PageHeader
              eyebrow="Aset produksi"
              title="Pustaka Media Qur'an"
              copy="Audio per surah atau per ayat, latar, dan hasil render tersimpan permanen di ruang kerja server dan dapat dipakai ulang tanpa unggah ulang."
              action={<><input ref={mediaUploadRef} type="file" accept="audio/*,video/*,image/*" multiple hidden onChange={(event) => void uploadLibraryFiles(Array.from(event.target.files || []))}/><button className="primary-button" onClick={() => mediaUploadRef.current?.click()}><Icon name="upload"/> Tambah media</button></>}
            />
            <section className="media-summary">
              <article><span className="metric-icon green"><Icon name="audio"/></span><div><small>Audio Qur'an</small><strong>{mediaAssets.filter((asset) => asset.kind === "audio").length}</strong><em>surah penuh & per ayat</em></div></article>
              <article><span className="metric-icon gold"><Icon name="layers"/></span><div><small>Latar visual</small><strong>{mediaAssets.filter((asset) => asset.kind === "background").length}</strong><em>gambar dan video</em></div></article>
              <article><span className="metric-icon blue"><Icon name="play"/></span><div><small>Hasil render</small><strong>{mediaAssets.filter((asset) => asset.kind === "render-output").length}</strong><em>MP4 tersimpan</em></div></article>
              <article><span className="metric-icon violet"><Icon name="shield"/></span><div><small>Sudah dianalisis</small><strong>{mediaAssets.filter((asset) => asset.analysisStatus === "analyzed").length}</strong><em>metadata alignment tersedia</em></div></article>
            </section>
            <div className="filter-row media-filters">
              <div className="search-field"><Icon name="search"/><input aria-label="Cari media" placeholder="Cari nama file, surah, atau qari…" value={mediaQuery} onChange={(event) => setMediaQuery(event.target.value)}/></div>
              <div className="filter-pills">
                <button className={mediaKind === "all" ? "active" : ""} onClick={() => setMediaKind("all")}>Semua</button>
                <button className={mediaKind === "audio" ? "active" : ""} onClick={() => setMediaKind("audio")}>Audio</button>
                <button className={mediaKind === "background" ? "active" : ""} onClick={() => setMediaKind("background")}>Latar</button>
                <button className={mediaKind === "render-output" ? "active" : ""} onClick={() => setMediaKind("render-output")}>Hasil render</button>
              </div>
            </div>
            <div className="media-scope-filters">
              <span>Cakupan audio:</span>
              {(["all", "surah", "ayah", "generic"] as const).map((scope) => <button key={scope} className={mediaScope === scope ? "active" : ""} onClick={() => setMediaScope(scope)}>{scope === "all" ? "Semua" : scope === "surah" ? "Per surah" : scope === "ayah" ? "Per ayat" : "Umum"}</button>)}
              <button className="media-refresh" onClick={() => void deduplicateMediaAssets()}><Icon name="layers" size={14}/> Rapikan duplikat</button>
              <button className="media-refresh" onClick={() => void refreshMediaLibrary()}><Icon name="clock" size={14}/> Muat ulang</button>
            </div>
            {filteredMediaAssets.length === 0 ? <div className="empty-state media-empty"><span><Icon name="audio" size={28}/></span><h2>Belum ada media sesuai filter</h2><p>Unggah audio Qur'an. Nama <strong>0001.mp3</strong> otomatis dikenali sebagai Surah 1 penuh, sedangkan <strong>001001.mp3</strong> sebagai QS 1:1.</p><button className="primary-button" onClick={() => mediaUploadRef.current?.click()}><Icon name="upload"/> Unggah media</button></div> : <div className="media-grid">
              {filteredMediaAssets.map((asset) => {
                const quranLabel = asset.scope === "surah" && asset.surahNumber ? `Surah ${asset.surahNumber}${asset.ayahEnd ? ` · ayat ${asset.ayahStart || 1}–${asset.ayahEnd}` : " · penuh"}` : asset.scope === "ayah" && asset.surahNumber ? `QS ${asset.surahNumber}:${asset.ayahStart}` : "Media umum";
                const statusLabel = asset.analysisStatus === "analyzed" ? "Sinkron" : asset.analysisStatus === "needs-review" ? "Perlu diperiksa" : asset.analysisStatus === "failed" ? "Analisis gagal" : "Belum dianalisis";
                return <article className="media-card" key={asset.id}>
                  <div className={`media-card-icon kind-${asset.kind}`}><Icon name={asset.kind === "audio" ? "audio" : asset.kind === "render-output" ? "play" : "layers"}/></div>
                  <div className="media-card-main"><div className="media-card-title"><strong title={asset.originalName}>{asset.originalName}</strong><span className={`media-analysis ${asset.analysisStatus}`}>{statusLabel}</span></div><small>{quranLabel}{asset.qari ? ` · ${asset.qari}` : ""}</small><div className="media-meta"><span>{asset.durationSeconds ? formatDuration(asset.durationSeconds) : "Durasi belum dibaca"}</span><span>{formatBytes(asset.sizeBytes)}</span><span>{relativeDate(asset.createdAt)}</span></div></div>
                  <div className="media-card-actions">
                    {(asset.kind === "audio" || asset.kind === "background" || asset.kind === "logo") && <button className="primary-button" onClick={() => void useMediaAsset(asset)}>{asset.kind === "audio" ? "Gunakan audio" : "Gunakan latar"}</button>}
                    <button className="secondary-button" onClick={() => window.open(asset.kind === "render-output" ? asset.downloadUrl : asset.streamUrl, "_blank", "noopener,noreferrer")}>{asset.kind === "audio" ? "Putar" : asset.kind === "render-output" ? "Unduh" : "Buka"}</button>
                    {(asset.kind === "audio" || asset.kind === "background") && <button className="secondary-button" onClick={() => void editMediaMetadata(asset)}>Metadata</button>}
                    <button className="media-archive" disabled={mediaBusyId === asset.id} onClick={() => void archiveMediaAsset(asset)}>Arsipkan</button>
                  </div>
                </article>;
              })}
            </div>}
          </div>
        )}

        {view === "studio" && activeProject && selectedSegment && (
          <div className="studio-page">
            <div className="studio-head">
              <div className="studio-title"><button className="back-button" onClick={() => navigate("projects")} aria-label="Kembali ke proyek">‹</button><div><small>Proyek aktif</small><h1>{activeProject.title}</h1></div><span className={`status-label ${activeProject.status}`}>{activeProject.status === "draft" ? "Draf" : activeProject.status === "review" ? "Perlu diperiksa" : "Siap render"}</span></div>
              <div className="studio-actions"><span className="save-label"><Icon name="check" size={14} /> {saveState === "saved" ? sessionMode === "authenticated" ? "Tersimpan di server" : "Tersimpan lokal" : "Menyimpan…"}</span><button className="secondary-button" onClick={() => void duplicateActiveProject()}><Icon name="plus" /> Duplikat</button><button className="secondary-button" onClick={exportProject}><Icon name="download" /> Ekspor proyek</button><button className="primary-button" onClick={goToNextStudioStep}>{studioStep === "render" ? "Lihat antrean" : "Lanjutkan"} <Icon name="chevron" size={15} /></button></div>
            </div>

            <div className="stepper" role="tablist" aria-label="Tahapan produksi">
              {studioSteps.map((step, index) => {
                const activeIndex = studioSteps.findIndex((item) => item.id === studioStep);
                return <button key={step.id} className={`${studioStep === step.id ? "active" : ""} ${index < activeIndex ? "complete" : ""}`} onClick={() => setStudioStep(step.id)}><span>{index < activeIndex ? <Icon name="check" size={14} /> : step.index}</span><strong>{step.label}</strong></button>;
              })}
            </div>

            <div className="studio-workspace">
              <aside className="source-panel panel">
                <div className="panel-heading"><div><span className="panel-kicker">Sumber media</span><h2>Audio bacaan</h2></div><button className="icon-button small" aria-label="Pilihan sumber" onClick={() => setToast("Sumber aktif: audio/video lokal yang diunggah ke ruang kerja server.")}><Icon name="more" /></button></div>
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
                <audio ref={audioRef} src={audioUrl} onLoadedMetadata={handleAudioMetadata} onTimeUpdate={handleAudioTimeUpdate} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => { setIsPlaying(false); setPlayheadTime(activeProject.duration || 0); }} />
                <button className="ai-action" onClick={runLocalAnalysis} disabled={isTranscribing}><span><Icon name="spark" /></span><div><strong>{isTranscribing ? "Menganalisis bacaan…" : "Transkripsi & cocokkan ayat"}</strong><small>{capabilities.transcription ? "AI aktif" : "Perlu endpoint AI"} • {capabilities.quran.available ? "korpus siap" : "korpus belum sinkron"}</small></div><Icon name="chevron" size={16} /></button>

                <div className="source-settings">
                  <label><span>Bahasa audio</span><select defaultValue="Arabic"><option>Arab (Al-Qur&apos;an)</option></select></label>
                  <label><span>Model pencocokan</span><select defaultValue="Quran"><option>Qur&apos;an matcher • n-gram Arab</option></select></label>
                </div>

                {transcript && <div className="transcript-note"><strong>Transkripsi terakhir</strong><p dir="rtl">{transcript}</p></div>}

                <div className="segments-heading"><span>Potongan ayat</span><div><em>{activeProject.segments.length}</em><button onClick={addManualSegment} aria-label="Tambah potongan ayat"><Icon name="plus" size={14}/></button></div></div>
                <div className="segment-list">
                  {activeProject.segments.map((segment) => (
                    <button key={segment.id} className={selectedSegment.id === segment.id ? "active" : ""} onClick={() => { setSelectedSegmentId(segment.id); setPlayheadTime(segment.start); if (audioRef.current) audioRef.current.currentTime = segment.start; }}>
                      <span className={`segment-state ${segment.verified ? "verified" : ""}`}>{segment.verified ? <Icon name="check" size={12} /> : segment.ayah}</span>
                      <div><strong>{segment.surah} · {segment.ayah}</strong><small>{formatDuration(segment.start)} — {formatDuration(segment.end)}</small></div>
                      <em>{segment.confidence}%</em>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="preview-panel panel">
                <div className="preview-toolbar">
                  <div className="device-tabs"><button className="active" onClick={() => setCanvasZoom(100)}>Kanvas</button><button onClick={togglePreviewFullscreen}>Pratinjau</button></div>
                  <div className="preview-toolbar-actions"><button className="history-button" onClick={undoProjectChange} title="Undo">↶</button><button className="history-button" onClick={redoProjectChange} title="Redo">↷</button><div className="zoom-control"><button aria-label="Perkecil" onClick={() => setCanvasZoom((value) => Math.max(60, value - 10))}>−</button><span>{canvasZoom === 100 ? "Fit" : `${canvasZoom}%`}</span><button aria-label="Perbesar" onClick={() => setCanvasZoom((value) => Math.min(150, value + 10))}>+</button></div></div>
                </div>
                <div className="canvas-stage" ref={previewStageRef}>
                  <div className={`video-canvas ratio-${ratio.replace(":", "-")} mushaf-${mushafVersion} preset-${designPreset}`} style={{ ...(backgroundUrl && backgroundFile?.type.startsWith("image/") ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : {}), transform: `scale(${canvasZoom / 100})`, transformOrigin: "center" }}>
                    {backgroundUrl && backgroundFile?.type.startsWith("video/") && <video className="canvas-background-video" src={backgroundUrl} autoPlay muted loop playsInline/>}
                    {backgroundUrl && <div className="canvas-background-scrim"/>}
                    <div className="canvas-decoration top" />
                    <span className="surah-chip"><i>{selectedSegment.surahNumber}</i> {selectedSegment.surah}</span>
                    <div className="canvas-verse">
                      <p
                        dir="rtl"
                        style={{
                          fontSize: `${fontScale * (ratio === "16:9" ? 0.44 : ratio === "9:16" ? 0.31 : 0.37)}px`,
                          fontFamily: ARABIC_FONT_STACK,
                          fontWeight: 400,
                        }}
                      >
                        {selectedSegment.arabic}<span className="ayah-marker">{selectedSegment.ayah}</span>
                      </p>
                      {showTranslation && <><span className="translation-rule"/><small>{selectedSegment.translation || (contentBusy ? "Memuat terjemahan…" : "")}</small></>}
                      {showTafsir && selectedSegment.tafsir && <small className="canvas-tafsir">{selectedSegment.tafsir}</small>}
                    </div>
                    {(selectedTranslationInfo?.attribution || selectedTafsirInfo?.attribution) && <span className="canvas-source-credit">{[showTranslation ? selectedTranslationInfo?.attribution : "", showTafsir ? selectedTafsirInfo?.attribution : ""].filter(Boolean).join(" • ")}</span>}
                    <div className="canvas-footer"><span>{watermarkText}</span><em>{selectedSegment.surahNumber}:{selectedSegment.ayah}</em></div>
                    <div className="canvas-decoration bottom" />
                  </div>
                </div>
                <div className="timeline">
                  <div className="transport"><button className="round-play" onClick={togglePlayback} aria-label={isPlaying ? "Jeda" : "Putar"}><Icon name={isPlaying ? "pause" : "play"} size={16} /></button><strong>{formatDuration(playheadTime)}</strong><span>/ {formatDuration(activeProject.duration || 14.9)}</span><div className="transport-spacer"/><button aria-label="Pengaturan timeline" onClick={() => setToast("Waktu potongan dapat diedit dari kolom Mulai dan Selesai di panel kanan.")}><Icon name="settings" size={16}/></button></div>
                  <div className="waveform"><div className="playhead" style={{ left: `${Math.max(0, Math.min(100, (playheadTime / (activeProject.duration || 14.9)) * 100))}%` }} />{waveformPeaks.map((height, index) => <i key={index} className={index / waveformPeaks.length < playheadTime / (activeProject.duration || 14.9) ? "passed" : ""} style={{ height: `${height * 0.34}px` }} />)}</div>
                  <div className="timeline-cues">{activeProject.segments.map((segment) => <button key={segment.id} className={segment.id === selectedSegment.id ? "active" : ""} style={{ left: `${(segment.start / (activeProject.duration || 14.9)) * 100}%`, width: `${Math.max(12, ((segment.end - segment.start) / (activeProject.duration || 14.9)) * 100)}%` }} onClick={() => { setSelectedSegmentId(segment.id); setPlayheadTime(segment.start); if (audioRef.current) audioRef.current.currentTime = segment.start; }}>QS {segment.surahNumber}:{segment.ayah}</button>)}</div>
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
                  <label><span>Sumber</span><select value={translationSource} onChange={(event) => void selectTranslationSource(event.target.value)} disabled={contentBusy}><option>Teks manual</option>{translationSources.map((source) => <option key={source.edition} value={source.edition}>{source.language.toUpperCase()} · {source.name}</option>)}</select></label>
                  {selectedTranslationInfo?.attribution && <small className="source-attribution">{selectedTranslationInfo.attribution}{selectedTranslationInfo.version ? ` · v${selectedTranslationInfo.version}` : ""}</small>}
                  <label><span>Teks terjemahan</span><textarea value={selectedSegment.translation} readOnly={translationSource !== "Teks manual"} onChange={(event) => updateSegment({ translation: event.target.value, translationSourceEdition: "manual" })}/></label>
                  {translationSource !== "Teks manual" && <small className="source-attribution">Teks sumber dikunci agar tidak berubah. Pilih Teks manual untuk menyunting.</small>}
                </div>
                <div className="inspector-section">
                  <div className="section-label"><span>Tafsir</span><label className="switch"><input type="checkbox" checked={showTafsir} onChange={(event) => setShowTafsir(event.target.checked)}/><i/></label></div>
                  <label><span>Sumber</span><select value={tafsirSource} onChange={(event) => void selectTafsirSource(event.target.value)} disabled={contentBusy}><option>Teks manual</option>{tafsirSources.map((source) => <option key={source.edition} value={source.edition}>{source.language.toUpperCase()} · {source.name}</option>)}</select></label>
                  {selectedTafsirInfo?.attribution && <small className="source-attribution">{selectedTafsirInfo.attribution}{selectedTafsirInfo.version ? ` · v${selectedTafsirInfo.version}` : ""}</small>}
                  <label><span>Teks tafsir</span><textarea value={selectedSegment.tafsir || ""} readOnly={tafsirSource !== "Teks manual"} onChange={(event) => updateSegment({ tafsir: event.target.value, tafsirSourceEdition: "manual" })}/></label>
                  {tafsirSource !== "Teks manual" && <small className="source-attribution">Teks sumber dikunci agar tidak berubah. Pilih Teks manual untuk menyunting.</small>}
                </div>
                <div className="inspector-section">
                  <div className="section-label"><span>Desain video</span><Icon name="studio" size={15}/></div>
                  <label><span>Template</span><select value={designPreset} onChange={(event) => setDesignPreset(event.target.value as "classic" | "minimal" | "cinematic")}><option value="classic">Klasik Madinah</option><option value="minimal">Minimal</option><option value="cinematic">Sinematik</option></select></label>
                  <label><span>Watermark</span><input value={watermarkText} maxLength={80} onChange={(event) => setWatermarkText(event.target.value)} placeholder="Kosongkan untuk tanpa watermark"/></label>
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
                <div><span className="section-kicker">Langkah terakhir</span><h2>Ekspor subtitle & video nyata</h2><p>Subtitle dibuat langsung. Video dirender oleh browser lalu dikonversi FFmpeg menjadi MP4 ketika container Coolify aktif.</p><div className="subtitle-actions"><button onClick={() => exportSubtitle("srt")}><Icon name="download" size={15}/> SRT</button><button onClick={() => exportSubtitle("vtt")}><Icon name="download" size={15}/> VTT</button><button onClick={() => exportSubtitle("ass")}><Icon name="download" size={15}/> ASS</button><button onClick={() => exportSubtitle("srt", "arabic")}><Icon name="book" size={15}/> Arab saja</button><button onClick={() => exportSubtitle("srt", "translation")}><Icon name="globe" size={15}/> Terjemahan</button><button onClick={() => exportSubtitle("srt", "tafsir")}><Icon name="book" size={15}/> Tafsir</button><button onClick={() => exportSubtitle("srt", "all")}><Icon name="layers" size={15}/> Semua layer</button></div></div>
                <label><span>Cakupan</span><select value={renderScope} onChange={(event) => setRenderScope(event.target.value as "surah" | "ayah")}><option value="surah">Seluruh surah/proyek</option><option value="ayah">Ayat terpilih saja</option></select></label>
                <label><span>Resolusi</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option>1080p</option><option>1440p</option><option>2160p (4K)</option></select></label>
                <label><span>Format hasil</span><select value={capabilities.ffmpeg ? "MP4" : "WebM"} disabled><option value={capabilities.ffmpeg ? "MP4" : "WebM"}>{capabilities.ffmpeg ? "MP4 · H.264 + AAC" : "WebM · browser"}</option></select></label>
                <div className="render-buttons"><button className="primary-button large" onClick={() => void renderVideo()} disabled={isRendering}><Icon name="play" /> {isRendering ? "Sedang merender…" : renderScope === "ayah" ? `Render QS ${selectedSegment.surahNumber}:${selectedSegment.ayah}` : "Render video sekarang"}</button><button className="secondary-button" onClick={() => void renderAllRatios()} disabled={isRendering}><Icon name="layers"/> Batch 3 rasio</button></div>
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
                <div className="table-tools">
                  <div className="search-field"><Icon name="search"/><input placeholder="Cari surah atau nomor…" value={quranQuery} onChange={(event) => setQuranQuery(event.target.value)}/></div>
                  <button className="secondary-button" onClick={() => setShowEnabledSourcesOnly((value) => !value)}><Icon name="layers"/> {showEnabledSourcesOnly ? "Sumber siap" : "Semua sumber"}</button>
                </div>
                <div className="table-head"><span>Surah</span><span>Ayat</span><span>Status teks</span><span>Mushaf</span><span/></div>
                {filteredQuranRows.map((surah) => (
                  <button className={`surah-row ${capabilities.quran.available ? "" : "muted"}`} key={surah.number} onClick={() => void openQuranSurah(surah.number)} disabled={quranPreviewLoading}>
                    <span><i>{surah.number}</i><span><strong>{surah.name}</strong><small>{surah.arabic} · {surah.meaning}</small></span></span>
                    <span>{surah.ayahs}</span>
                    <span><em className={capabilities.quran.available ? "ready-dot" : "waiting-dot"}/> {capabilities.quran.available ? "Tervalidasi" : "Belum diimpor"}</span>
                    <span>{capabilities.quran.available ? "Utsmani" : "—"}</span>
                    <Icon name={capabilities.quran.available ? "chevron" : "clock"}/>
                  </button>
                ))}
                {!filteredQuranRows.length && <div className="library-empty">Surah tidak ditemukan. Cari dengan nomor 1–114 atau nama surah.</div>}
              </section>
              <aside className="source-side panel">
                {quranPreview && <div className="quran-preview-card"><span className="panel-kicker">Surah terpilih</span><h2>{quranPreview.nameLatin || `Surah ${quranPreview.number || ""}`}</h2><p dir="rtl">{quranPreview.ayahs?.[0]?.arabic || quranPreview.nameArabic || "Data surah berhasil dimuat dari korpus produksi."}</p><small>{quranPreview.ayahs?.length || quranPreview.ayahCount || 0} ayat termuat</small></div>}
                <span className="panel-kicker">Registri sumber</span><h2>Paket data & lisensi</h2>
                <div className="source-package"><span className="priority"><Icon name="shield" size={16}/></span><div><strong>Teks Utsmani</strong><small>6.236 ayat • checksum SHA-256</small></div></div>
                {visibleContentSources.slice(0, 12).map((source) => <div className="source-package" key={source.edition}><span className={source.enabled && source.redistributionAllowed ? "priority" : "planned"}><Icon name={source.enabled && source.redistributionAllowed ? "check" : "clock"} size={16}/></span><div><strong>{source.name}</strong><small>{source.language.toUpperCase()} • {source.onDemand ? "on-demand" : "cache lokal"} • {source.version || source.licenseName}</small></div></div>)}
                {visibleContentSources.length > 12 && <div className="integrity-note"><Icon name="globe"/><p><strong>Katalog global:</strong> {visibleContentSources.length} sumber ditemukan. Seluruh sumber aktif tetap tersedia dari pilihan Terjemahan/Tafsir di Studio.</p></div>}
                <div className="integrity-note"><Icon name="shield"/><p><strong>Integritas konten:</strong> teks Qur&apos;an dikunci; terjemahan dan tafsir QuranEnc dipakai tanpa modifikasi dengan atribusi sumber dan versi yang dipertahankan.</p></div>
              </aside>
            </div>
          </div>
        )}

        {view === "renders" && (
          <div className="page">
            <PageHeader eyebrow="Produksi video" title="Antrean render" copy="Pantau komposisi yang sedang disiapkan dan hasil yang sudah selesai." action={<button className="secondary-button" onClick={() => navigate("studio")}><Icon name="studio"/> Kembali ke studio</button>} />
            <div className="simulation-banner real-mode"><Icon name="check"/><span><strong>Mesin render nyata</strong><small>{capabilities.ffmpeg ? "Browser menyusun video; FFmpeg mengubah hasilnya menjadi MP4 H.264." : "Mode browser menghasilkan WebM. Jalankan Docker untuk mengaktifkan MP4 H.264."}</small></span></div>
            {renderJobs.length === 0 ? <div className="empty-state"><span><Icon name="play" size={28}/></span><h2>Belum ada video dalam antrean</h2><p>Selesaikan pemeriksaan di studio, pilih format, lalu jalankan render pertama.</p><button className="primary-button" onClick={() => { setStudioStep("render"); navigate("studio"); }}>Siapkan video <Icon name="chevron"/></button></div> : <div className="render-list">{renderJobs.map((job) => <RenderJobCard key={job.id} job={job} onDownload={() => { if (!job.outputUrl) return; const anchor = document.createElement("a"); anchor.href = job.outputUrl; anchor.download = `${safeFilename(job.title)}.${job.format === "MP4" ? "mp4" : "webm"}`; anchor.click(); }} onRetry={() => void retryRenderJob(job.id)} onCancel={() => void cancelRenderJob(job.id)}/>)}</div>}
          </div>
        )}

        {view === "settings" && (
          <div className="page settings-page">
            <PageHeader eyebrow="Fondasi sistem" title="Pengaturan aplikasi" copy="Konfigurasi identitas, penyimpanan, mesin AI, sumber Qur'an, render, dan keamanan." />
            <div className="settings-layout">
              <nav className="settings-nav">
                <button className={settingsTab === "identity" ? "active" : ""} onClick={() => setSettingsTab("identity")}><Icon name="globe"/> Identitas produk</button>
                <button className={settingsTab === "transcription" ? "active" : ""} onClick={() => setSettingsTab("transcription")}><Icon name="audio"/> Transkripsi AI</button>
                <button className={settingsTab === "quran" ? "active" : ""} onClick={() => setSettingsTab("quran")}><Icon name="book"/> Sumber Qur&apos;an</button>
                <button className={settingsTab === "render" ? "active" : ""} onClick={() => setSettingsTab("render")}><Icon name="play"/> Mesin render</button>
                <button className={settingsTab === "security" ? "active" : ""} onClick={() => setSettingsTab("security")}><Icon name="shield"/> Keamanan</button>
              </nav>

              <section className="settings-content panel">
                {settingsTab === "identity" && <>
                  <div className="settings-section"><span className="section-kicker">Identitas mandiri</span><h2>Taysriul Qur&apos;ani</h2><p>Proyek baru yang tidak berbagi akun, database, media, maupun deployment dengan Sullamul Hifz.</p><div className="settings-grid"><label><span>Nama aplikasi</span><input value="Taysriul Qur'ani" readOnly/></label><label><span>Domain produksi</span><input value="taysriulqurani.id" readOnly/></label><label><span>Versi produksi</span><input value={capabilities.version || "1.2.0"} readOnly/></label><label><span>Zona waktu</span><input value="Asia/Jakarta" readOnly/></label></div></div>
                  {sessionMode === "authenticated" && <div className="settings-section"><span className="section-kicker">Kolaborasi</span><h2>Anggota workspace</h2><p>Editor mengubah proyek, pemeriksa memberi komentar dan persetujuan, sedangkan viewer hanya membaca.</p><div className="member-list">{members.map((member) => <div key={member.id}><span>{member.display_name?.slice(0,2).toUpperCase() || "U"}</span><div><strong>{member.display_name}</strong><small>{member.email}</small></div><em>{member.role}</em></div>)}</div>{session.workspaces?.[0]?.role === "owner" && <form className="member-form" onSubmit={addWorkspaceMember}><input type="email" required value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="Email pengguna yang sudah terdaftar"/><select value={memberRole} onChange={(event) => setMemberRole(event.target.value as "editor" | "reviewer" | "viewer")}><option value="editor">Editor</option><option value="reviewer">Pemeriksa</option><option value="viewer">Viewer</option></select><button className="primary-button"><Icon name="plus"/> Tambahkan</button></form>}</div>}
                </>}

                {settingsTab === "transcription" && <div className="settings-section"><span className="section-kicker">Transkripsi AI</span><h2>{capabilities.transcription ? "Layanan transkripsi aktif" : "Layanan transkripsi belum aktif"}</h2><p>Studio mengirim audio ke adaptor transkripsi Arab lalu mencocokkannya dengan korpus Al-Qur&apos;an.</p><div className="settings-grid"><label><span>Status</span><input value={capabilities.transcription ? "Aktif" : "Tidak aktif"} readOnly/></label><label><span>Model</span><input value={capabilities.transcriptionModel || "Belum tersedia"} readOnly/></label><label><span>Korpus matcher</span><input value={capabilities.quran.available ? "114 surah siap" : "Belum siap"} readOnly/></label><label><span>Batas unggah</span><input value={capabilities.maxUploadBytes ? `${Math.round(capabilities.maxUploadBytes / 1024 / 1024)} MB` : "Default server"} readOnly/></label></div><button className="secondary-button settings-action" onClick={() => activeProject ? openProject(activeProject.id, "source") : setIsNewProjectOpen(true)}><Icon name="audio"/> Uji di Studio</button></div>}

                {settingsTab === "quran" && <div className="settings-section"><span className="section-kicker">Sumber Qur&apos;an</span><h2>{capabilities.quran.available ? "Korpus produksi siap" : "Korpus belum tersinkron"}</h2><p>Teks Utsmani, struktur surah, juz, rubu&apos;, halaman, serta sumber terjemahan digunakan oleh mesin pencocokan dan studio.</p><div className="settings-grid"><label><span>Surah</span><input value={`${capabilities.quran.counts?.surahs || 0} / 114`} readOnly/></label><label><span>Ayat</span><input value={`${capabilities.quran.counts?.ayahs || 0}`} readOnly/></label><label><span>Halaman</span><input value={`${capabilities.quran.counts?.pages || 0} / 604`} readOnly/></label><label><span>Sumber bahasa</span><input value={`${contentSources.length} terdaftar`} readOnly/></label></div><button className="secondary-button settings-action" onClick={() => navigate("quran")}><Icon name="book"/> Buka Pustaka Al-Qur&apos;an</button></div>}

                {settingsTab === "render" && <div className="settings-section"><span className="section-kicker">Mesin render</span><h2>{capabilities.ffmpeg && capabilities.queue?.healthy ? "Render produksi siap" : "Render belum sepenuhnya siap"}</h2><p>Browser menyusun komposisi, antrean Redis mengelola pekerjaan, dan FFmpeg menghasilkan MP4 H.264 + AAC.</p><div className="settings-grid"><label><span>FFmpeg</span><input value={capabilities.ffmpeg ? "Aktif" : "Tidak aktif"} readOnly/></label><label><span>Antrean Redis</span><input value={capabilities.queue?.healthy ? "Sehat" : "Tidak sehat"} readOnly/></label><label><span>Format utama</span><input value={capabilities.ffmpeg ? "MP4 · H.264 + AAC" : "WebM browser"} readOnly/></label><label><span>Job saat ini</span><input value={`${renderJobs.length} job`} readOnly/></label></div><button className="secondary-button settings-action" onClick={() => navigate("renders")}><Icon name="play"/> Buka antrean render</button></div>}

                {settingsTab === "security" && <>
                  <div className="settings-section"><span className="section-kicker">Keamanan & pemulihan</span><h2>Data produksi terlindungi</h2><p>Status database, penyimpanan objek, sesi akun, dan backup workspace dapat diperiksa dari sini.</p><div className="settings-grid"><label><span>PostgreSQL</span><input value={capabilities.persistence?.healthy ? "Sehat" : "Tidak sehat"} readOnly/></label><label><span>Penyimpanan media</span><input value={capabilities.storage?.healthy ? `${capabilities.storage.driver} sehat` : "Tidak sehat"} readOnly/></label><label><span>Sesi</span><input value={sessionMode === "authenticated" ? "Terautentikasi" : sessionMode} readOnly/></label><label><span>Peran workspace</span><input value={session.workspaces?.[0]?.role || "lokal"} readOnly/></label></div>{sessionMode === "authenticated" && <div className="backup-actions"><button className="secondary-button backup-button" onClick={exportServerBackup}><Icon name="download"/> Unduh backup</button><input ref={restoreInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => restoreServerBackup(event.target.files?.[0])}/><button className="secondary-button backup-button" onClick={() => restoreInputRef.current?.click()}><Icon name="upload"/> Pulihkan backup</button></div>}</div>
                  <div className="separation-card"><span><Icon name="shield"/></span><div><strong>Pagar pemisahan proyek aktif</strong><p>Repository, database, penyimpanan media, akun pengguna, domain, serta roadmap Taysriul Qur&apos;ani berdiri sendiri.</p></div></div>
                </>}

                <div className="settings-section"><div className="section-title-row"><div><span className="section-kicker">Kesiapan mesin produksi</span><h2>Komponen deployment</h2></div><span className="readiness">{5 + Number(capabilities.persistence?.healthy) + Number(capabilities.storage?.healthy) + Number(capabilities.collaboration) + Number(capabilities.queue?.healthy) + Number(capabilities.quran.available) + Number(capabilities.transcription) + Number(capabilities.ffmpeg) + Number(Boolean(capabilities.persistence?.migration))} dari 13 aktif</span></div><div className="checklist">{[
                  ["Antarmuka responsif", true, "Desktop, tablet, dan ponsel"],
                  ["Docker & pemeriksaan kesehatan", true, "Disiapkan untuk Coolify"],
                  ["Konfigurasi environment", true, "Tidak menyimpan rahasia di kode"],
                  ["Fallback proyek lokal", true, "Pengujian tetap dapat dilakukan tanpa server"],
                  ["Generator subtitle SRT/VTT/ASS", true, "Ekspor Arab, terjemahan, atau gabungan"],
                  ["Akun & workspace", Boolean(capabilities.persistence?.healthy), capabilities.persistence?.healthy ? "PostgreSQL dan sesi aman aktif" : "Aktif saat PostgreSQL tersambung"],
                  ["Penyimpanan media", Boolean(capabilities.storage?.healthy), capabilities.storage?.healthy ? `${capabilities.storage?.driver} siap` : "Object storage belum aktif"],
                  ["Pustaka Media v1.1", Boolean(capabilities.persistence?.migration), capabilities.persistence?.migration ? `Migration ${capabilities.persistence.migration}` : "Migration media belum terdeteksi"],
                  ["Kolaborasi & audit", Boolean(capabilities.collaboration), capabilities.collaboration ? "Peran, komentar, persetujuan, audit aktif" : "Aktif bersama database"],
                  ["Antrean render", Boolean(capabilities.queue?.healthy), capabilities.queue?.healthy ? "Redis dan worker siap" : "Aktif saat Redis tersambung"],
                  ["Korpus 114 surah", capabilities.quran.available, capabilities.quran.available ? "6.236 ayat tervalidasi" : "Sinkron otomatis saat container aktif"],
                  ["Layanan transkripsi AI", capabilities.transcription, capabilities.transcription ? "Endpoint aktif" : "Provider belum diisi"],
                  ["Render FFmpeg MP4", capabilities.ffmpeg, capabilities.ffmpeg ? "H.264 + AAC aktif" : "Aktif di image Docker"],
                ].map(([label, ready, copy]) => <div key={String(label)}><span className={ready ? "done" : "pending"}>{ready ? <Icon name="check" size={14}/> : <Icon name="clock" size={14}/>}</span><div><strong>{label}</strong><small>{copy}</small></div><em>{ready ? "Siap" : "Berikutnya"}</em></div>)}</div></div>
              </section>
            </div>
          </div>
        )}
      </main>

      <nav className="mobile-nav" aria-label="Navigasi seluler">
        {navItems.slice(0, 6).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}
      </nav>

      {isNewProjectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsNewProjectOpen(false); }}>
          <form className="modal" onSubmit={createProject}>
            <div className="modal-head"><span className="upload-icon"><Icon name="plus"/></span><button type="button" className="icon-button" onClick={() => setIsNewProjectOpen(false)} aria-label="Tutup"><Icon name="close"/></button></div>
            <span className="section-kicker">Proyek baru</span><h2>Mulai produksi Qur&apos;an</h2><p>Beri nama yang mudah dikenali. Audio dapat ditambahkan setelah ruang studio dibuka.</p>
            <label><span>Nama proyek</span><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Contoh: Surah Ar-Rahman untuk YouTube"/></label>
            <div className="modal-options"><button type="button" className={newProjectRatio === "16:9" ? "active" : ""} onClick={() => setNewProjectRatio("16:9")}><i className="ratio-shape r-16-9"/><span><strong>Video horizontal</strong><small>YouTube · 16:9</small></span>{newProjectRatio === "16:9" && <Icon name="check"/>}</button><button type="button" className={newProjectRatio === "9:16" ? "active" : ""} onClick={() => setNewProjectRatio("9:16")}><i className="ratio-shape r-9-16"/><span><strong>Video vertikal</strong><small>Reels · 9:16</small></span>{newProjectRatio === "9:16" && <Icon name="check"/>}</button></div>
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

function RenderJobCard({ job, onDownload, onRetry, onCancel }: { job: RenderJob; onDownload: () => void; onRetry: () => void; onCancel: () => void }) {
  const status = job.status === "complete" ? "Selesai" : job.status === "failed" ? "Gagal" : job.status === "cancelled" ? "Dibatalkan" : job.status === "queued" ? "Menunggu" : "Memproses";
  return <article>
    <div className="render-thumb"><span className="brand-mark compact"><span>ت</span></span><small>{job.ratio}</small></div>
    <div className="render-info">
      <div><strong>{job.title}</strong><span className={`render-status ${job.status}`}>{status}</span></div>
      <small>{job.resolution} · {job.format}{job.format === "MP4" ? " · H.264" : " · browser"}</small>
      {job.error ? <p className="render-error">{job.error}</p> : <div className="job-progress"><i style={{width:`${job.progress}%`}}/><span>{job.progress}%</span></div>}
    </div>
    <div className="render-card-actions">
      {job.outputUrl && <button className="download-result" onClick={onDownload}><Icon name="download" size={16}/> Unduh</button>}
      {job.status === "failed" && <button className="render-retry" onClick={onRetry}>Coba lagi</button>}
      {(job.status === "queued" || job.status === "processing") && <button className="render-cancel" onClick={onCancel}>Batalkan</button>}
      {!job.outputUrl && !["failed", "queued", "processing"].includes(job.status) && <span className="render-wait"><Icon name="clock" size={17}/></span>}
    </div>
  </article>;
}
