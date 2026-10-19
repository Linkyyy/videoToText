"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Clock3,
  Copy,
  FileAudio,
  FileText,
  FolderClock,
  History,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { DEMO_SUMMARY, DEMO_TRANSCRIPT } from "@/lib/demo";
import {
  formatTime,
  importTranscript,
  MAX_TRANSCRIPT_CHARS,
  toSrt,
  validateVideoUrl,
} from "@/lib/transcript";
import type {
  Health,
  Job,
  SummaryLength,
  SummaryStyle,
  Transcript,
} from "@/lib/types";

type SavedNote = {
  id: string;
  date: string;
  transcript: Transcript;
  summary: string;
};
type Modal = "settings" | "guide" | null;
const HISTORY_KEY = "shijian-notes-v1";
const STYLES = [
  {
    id: "analysis",
    name: "全面解析",
    icon: Sparkles,
    desc: "观点 · 结构 · 行动",
  },
  { id: "study", name: "学习笔记", icon: BookOpen, desc: "概念 · 重点 · 复习" },
  {
    id: "meeting",
    name: "会议纪要",
    icon: CheckCheck,
    desc: "讨论 · 决定 · 待办",
  },
] as const;

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.error ||
        body.detail ||
        `请求失败（${response.status}），请稍后重试。`,
    );
  return body;
}
function download(
  text: string,
  name: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100);
}
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

export default function Workspace() {
  const [source, setSource] = useState<"link" | "file" | "text">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [style, setStyle] = useState<SummaryStyle>("analysis");
  const [length, setLength] = useState<SummaryLength>("normal");
  const [health, setHealth] = useState<Health | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [view, setView] = useState<"workspace" | "history">("workspace");
  const [mobileNav, setMobileNav] = useState(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState("");
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [busy, setBusy] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<SavedNote[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(jsonResponse)
      .then(setHealth)
      .catch(() => setToast("服务状态读取失败，可在设置中刷新。"));
    try {
      const notes = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(notes))
        setHistory(
          notes
            .filter(
              (n) =>
                typeof n.id === "string" &&
                typeof n.summary === "string" &&
                typeof n.transcript?.title === "string" &&
                Array.isArray(n.transcript?.segments),
            )
            .slice(0, 6),
        );
    } catch {
      /* A corrupted browser history must not prevent the app from opening. */
    }
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3800);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);

  function saveNote(item: Transcript, markdown: string) {
    const note = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      transcript: item,
      summary: markdown,
    };
    setHistory((prev) => {
      const notes = [
        note,
        ...prev.filter(
          (n) =>
            n.transcript.title !== item.title ||
            n.transcript.text !== item.text,
        ),
      ].slice(0, 6);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(notes));
      } catch {
        setToast("浏览器存储空间不足，本次结果请及时导出。");
      }
      return notes;
    });
  }
  function showDemo() {
    if (busy || summarizing) return;
    setTranscript(DEMO_TRANSCRIPT);
    setSummary(DEMO_SUMMARY);
    setDemo(true);
    setTab("summary");
    setError("");
    setEditing(false);
    setView("workspace");
    setTimeout(
      () =>
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        }),
      100,
    );
  }
  function newTask() {
    if (busy || summarizing) {
      setToast("请先停止当前处理，再新建笔记。");
      return;
    }
    abortRef.current?.abort();
    setBusy(false);
    setSummarizing(false);
    setTranscript(null);
    setSummary("");
    setJob(null);
    setDemo(false);
    setError("");
    setStatus("");
    setUrl("");
    setText("");
    setFile(null);
    setView("workspace");
    setMobileNav(false);
    setEditing(false);
  }
  function chooseFile(value?: File) {
    if (!value) return;
    const subtitles = /\.(srt|vtt|txt)$/i.test(value.name);
    if (
      !subtitles &&
      !/\.(mp4|mov|mkv|webm|avi|mp3|m4a|wav|ogg|flac|aac)$/i.test(value.name)
    ) {
      setError("请选择音视频文件，或 SRT / VTT / TXT 字幕。");
      return;
    }
    if (value.size > (subtitles ? 1024 * 1024 : 200 * 1024 * 1024)) {
      setError(subtitles ? "字幕文件最大 1 MB。" : "音视频文件最大 200 MB。");
      return;
    }
    setFile(value);
    setError("");
  }
  async function poll(
    initial: Job,
    ticket: string,
    signal: AbortSignal,
  ): Promise<Transcript> {
    let current = initial;
    for (let i = 0; i < 900; i++) {
      setJob(current);
      setStatus(current.message);
      if (current.status === "completed" && current.result)
        return current.result;
      if (current.status === "failed")
        throw new Error(current.error || "视频处理失败，请重试。");
      await wait(2000, signal);
      current = await fetch(`/api/jobs/${initial.id}`, {
        headers: { "x-job-ticket": ticket },
        signal,
      }).then(jsonResponse);
    }
    throw new Error("等待超时。处理服务可能仍在运行，请检查服务日志。");
  }
  async function generateSummary(
    item: Transcript,
    controller?: AbortController,
  ) {
    const abort = controller ?? new AbortController();
    abortRef.current = abort;
    setSummarizing(true);
    setSummary("");
    setTab("summary");
    setStatus("正在连接 DeepSeek…");
    setError("");
    let output = "";
    try {
      const annotated = item.segments
        .map(
          (s) =>
            `${s.start !== null ? `[${formatTime(s.start)}] ` : ""}${s.text}`,
        )
        .join("\n");
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: annotated, style, length }),
        signal: abort.signal,
      });
      if (!response.ok) {
        await jsonResponse(response);
        return;
      }
      if (!response.body) throw new Error("服务器没有返回生成内容。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (done && buffer) lines.push(buffer);
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "progress") setStatus(event.message);
            if (event.type === "delta") {
              output += event.text;
              setSummary(output);
            }
            if (event.type === "done") finished = true;
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!finished)
        throw new Error("生成连接中断，当前内容可能不完整，请重试。");
      saveNote(item, output);
      setToast("笔记已整理好，并保存在本机历史中。");
    } catch (e) {
      if (abort.signal.aborted)
        setToast("已停止生成，已收到的内容保留在页面中。");
      else setError(e instanceof Error ? e.message : "总结失败，请重试。");
    } finally {
      setSummarizing(false);
      setStatus("");
    }
  }
  async function run() {
    const abort = new AbortController();
    abortRef.current = abort;
    setError("");
    setBusy(true);
    setDemo(false);
    setSummary("");
    setTranscript(null);
    setJob(null);
    setEditing(false);
    setStatus("正在准备内容…");
    try {
      let result: Transcript;
      if (source === "text") result = importTranscript(text, "我的文本笔记");
      else if (source === "file" && file && /\.(srt|vtt|txt)$/i.test(file.name))
        result = importTranscript(
          await file.text(),
          file.name.replace(/\.[^.]+$/, ""),
        );
      else if (source === "file") {
        if (!file) throw new Error("请先选择一个文件。");
        const upload = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ size: file.size }),
          signal: abort.signal,
        }).then(jsonResponse);
        setStatus("正在上传到视频处理服务，请保持页面打开…");
        const data = new FormData();
        data.append("file", file);
        let initial;
        try {
          initial = await fetch(upload.url, {
            method: "POST",
            headers: { Authorization: `Bearer ${upload.token}` },
            body: data,
            signal: abort.signal,
          }).then(jsonResponse);
        } catch (e) {
          if (abort.signal.aborted) throw e;
          throw new Error(
            e instanceof TypeError
              ? "上传连接失败，请检查处理服务的 HTTPS 地址与 CORS_ORIGINS 配置。"
              : (e as Error).message,
          );
        }
        result = await poll(initial, upload.ticket, abort.signal);
      } else {
        const extracted = url.match(/https:\/\/[^\s<>"\u3000]+/)?.[0] ?? url;
        const input = validateVideoUrl(extracted);
        const initial: Job = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: abort.signal,
        }).then(jsonResponse);
        result = await poll(initial, initial.ticket!, abort.signal);
      }
      if (abort.signal.aborted) return;
      setTranscript(result);
      setJob(null);
      setBusy(false);
      saveNote(result, "");
      if (health?.deepseek)
        await generateSummary(result, abort);
      else {
        setTab("transcript");
        setStatus("");
        setToast("字幕已就绪。配置 DeepSeek 后即可生成 AI 笔记。");
      }
    } catch (e) {
      if (abort.signal.aborted)
        setToast("已停止等待；已提交的处理任务会在服务端继续完成。");
      else setError(e instanceof Error ? e.message : "处理失败，请稍后重试。");
      setStatus("");
      setJob(null);
    } finally {
      setBusy(false);
    }
  }
  async function copyResult() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(
        tab === "summary" ? summary : transcript.text,
      );
      setToast("已复制到剪贴板。");
    } catch {
      setToast("浏览器未开放剪贴板权限，请使用导出。");
    }
  }
  function exportResult(kind: "md" | "txt" | "srt") {
    if (!transcript) return;
    try {
      const content =
        kind === "md"
          ? `# ${transcript.title}\n\n${summary}`
          : kind === "srt"
            ? toSrt(transcript)
            : transcript.text;
      download(content, `${safeName(transcript.title)}.${kind}`);
      setToast("文件已导出。");
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function editSegment(index: number, value: string) {
    if (!transcript) return;
    const segments = transcript.segments.map((s, i) =>
      i === index ? { ...s, text: value } : s,
    );
    const combined = segments.map((s) => s.text).join("\n");
    if (combined.length > MAX_TRANSCRIPT_CHARS) {
      setToast("字幕不能超过 60,000 字符。");
      return;
    }
    setTranscript({ ...transcript, segments, text: combined });
    setSummary("");
    setDemo(false);
  }
  const working = busy || summarizing;
  const filteredHistory = history.filter((n) =>
    n.transcript.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <button className="brand" onClick={newTask} aria-label="视笺首页">
          <span className="brand-icon">
            <AudioLines size={25} strokeWidth={2.3} />
          </span>
          <span>
            视笺<small>VIDEO TO KNOWLEDGE</small>
          </span>
        </button>
        <button className="new-note" onClick={newTask}>
          <Plus size={18} />
          新建笔记
        </button>
        <div className="nav-caption">你的工作空间</div>
        <nav aria-label="主导航">
          <button
            className={view === "workspace" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setView("workspace");
              setMobileNav(false);
            }}
          >
            <LayoutDashboard size={18} />
            工作台
            <span className="nav-dot" />
          </button>
          <button
            className={view === "history" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setView("history");
              setMobileNav(false);
            }}
          >
            <FolderClock size={18} />
            本机历史<span className="nav-count">{history.length}</span>
          </button>
        </nav>
        <div className="sidebar-tip">
          <div className="tip-icon">
            <WandSparkles size={21} />
          </div>
          <strong>少一点收藏，多一点理解。</strong>
          <p>
            把看过的好内容，
            <br />
            变成真正属于你的知识。
          </p>
          <button onClick={showDemo}>
            看看一份好笔记
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal("guide")}>
            <CircleHelp size={18} />
            使用与部署指南
            <ArrowRight size={14} />
          </button>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings2 size={18} />
            服务设置
          </button>
          <div className="engine">
            <span
              className={health?.deepseek ? "status-dot" : "status-dot pending"}
            />
            <span>
              Powered by <b>DeepSeek</b>
            </span>
            <ShieldCheck size={13} />
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          onClick={() => setMobileNav(false)}
          aria-label="关闭导航"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            <span>我的工作空间</span>
            <span className="crumb-divider">/</span>
            <strong>{view === "workspace" ? "工作台" : "本机历史"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-badge">
              <span />
              个人知识工作台
            </span>
            <button
              className="avatar"
              onClick={() => setModal("settings")}
              aria-label="打开设置"
            >
              笺
            </button>
          </div>
        </header>
        <main className="main-content">
          {view === "history" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <History size={14} /> YOUR KNOWLEDGE, KEPT CLOSE
                  </div>
                  <h1>每一次理解，都有迹可循。</h1>
                  <p>
                    最近 6 份笔记仅保存在此浏览器，清理浏览器数据会删除记录。
                  </p>
                </div>
                <button className="secondary-button" onClick={newTask}>
                  <Plus size={16} />
                  新建笔记
                </button>
              </div>
              <div className="history-toolbar">
                <label className="history-search">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索笔记标题…"
                    aria-label="搜索笔记"
                  />
                </label>
                <button
                  className="text-button danger"
                  disabled={!history.length}
                  onClick={() => {
                    if (
                      confirm(
                        "确定清空本机的全部笔记？已导出的文件不会受影响。",
                      )
                    ) {
                      setHistory([]);
                      localStorage.removeItem(HISTORY_KEY);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  清空记录
                </button>
              </div>
              <div className="history-grid">
                {filteredHistory.map((n) => (
                  <article className="history-card" key={n.id}>
                    <div className="history-card-top">
                      <span className="history-file">
                        <FileText size={23} />
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`删除 ${n.transcript.title}`}
                        onClick={() =>
                          setHistory((prev) => {
                            const next = prev.filter((v) => v.id !== n.id);
                            try {
                              localStorage.setItem(
                                HISTORY_KEY,
                                JSON.stringify(next),
                              );
                            } catch {
                              setToast("删除记录未能写入浏览器存储。");
                            }
                            return next;
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <h3>{n.transcript.title}</h3>
                    <p>
                      {n.summary
                        ? n.summary.replace(/[#*\[\]]/g, "").slice(0, 100)
                        : n.transcript.text.slice(0, 100)}
                    </p>
                    <div className="history-card-bottom">
                      <span>
                        {new Date(n.date).toLocaleDateString("zh-CN")}
                      </span>
                      <button
                        onClick={() => {
                          setTranscript(n.transcript);
                          setSummary(n.summary);
                          setDemo(false);
                          setTab(n.summary ? "summary" : "transcript");
                          setView("workspace");
                          setError("");
                          setEditing(false);
                        }}
                      >
                        打开笔记
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!filteredHistory.length && (
                <div className="history-empty">
                  <FolderClock size={40} />
                  <h3>
                    {search
                      ? "没有找到这份笔记"
                      : "你的知识库，从第一份笔记开始"}
                  </h3>
                  <p>完成字幕提取或 AI 总结后，笔记会自动保存在这里。</p>
                  <button className="primary-button" onClick={newTask}>
                    开始整理
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-spark">✦</span> WATCH LESS. UNDERSTAND
                    MORE.
                  </div>
                  <h1>
                    让视频，成为你的
                    <span className="headline-accent">知识。</span>
                  </h1>
                  <p>从一段视频，到一份清晰的笔记。把时间留给思考。</p>
                </div>
                <button
                  className="demo-button"
                  onClick={showDemo}
                  disabled={working}
                >
                  <span className="play-mini">▶</span>体验示例
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="workflow-strip">
                <span>
                  <span className="workflow-number">01</span>导入视频
                </span>
                <i />
                <span>
                  <span className="workflow-number">02</span>提取字幕
                </span>
                <i />
                <span>
                  <span className="workflow-number">03</span>AI 整理与分析
                  <span className="ai-mini">DeepSeek</span>
                </span>
              </div>
              <div className="workspace-grid">
                <section
                  className="input-panel card"
                  aria-label="输入视频与总结设置"
                >
                  <div className="panel-title">
                    <span className="section-icon">
                      <Link2 size={18} />
                    </span>
                    <h2>从这里开始</h2>
                    <span className="subtle-tag">INPUT</span>
                  </div>
                  <div
                    className="source-tabs"
                    role="tablist"
                    aria-label="内容来源"
                  >
                    {(
                      [
                        { id: "link", label: "视频链接", icon: Link2 },
                        { id: "file", label: "上传文件", icon: UploadCloud },
                        { id: "text", label: "粘贴文本", icon: FileText },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        role="tab"
                        aria-selected={source === s.id}
                        className={source === s.id ? "selected" : ""}
                        disabled={working}
                        onClick={() => {
                          setSource(s.id);
                          setError("");
                        }}
                      >
                        <s.icon size={15} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="source-content">
                    {source === "link" && (
                      <>
                        <label className="field-label" htmlFor="video-url">
                          视频地址
                        </label>
                        <div className="url-input">
                          <Link2 size={17} />
                          <input
                            id="video-url"
                            placeholder="粘贴视频链接，或分享文案"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={working}
                          />
                          <button
                            className="icon-button"
                            disabled={working}
                            title="从剪贴板粘贴"
                            aria-label="从剪贴板粘贴"
                            onClick={async () => {
                              try {
                                setUrl(await navigator.clipboard.readText());
                              } catch {
                                setToast("请直接粘贴链接到输入框。");
                              }
                            }}
                          >
                            <Clipboard size={16} />
                          </button>
                        </div>
                        <p className="field-help">
                          支持视频页面地址，也可以直接粘贴分享链接。
                        </p>
                        <div className="platform-list">
                          <span>
                            <b className="platform-bili">哔</b>哔哩哔哩
                          </span>
                          <span>
                            <b className="platform-douyin">♪</b>抖音
                          </span>
                          <span>
                            <b className="platform-youtube">▶</b>YouTube
                          </span>
                          <span
                            className="more-platforms"
                            title="也支持 TikTok、Vimeo、小红书、快手"
                          >
                            + 更多
                          </span>
                        </div>
                        <div className="source-note">
                          <ShieldCheck size={15} />
                          <span>
                            优先读取已有字幕；无字幕时自动语音转写。
                            <br />
                            部分视频受登录、地区或平台规则限制。
                          </span>
                        </div>
                      </>
                    )}
                    {source === "file" && (
                      <>
                        <input
                          ref={fileRef}
                          type="file"
                          accept=".mp4,.mov,.mkv,.webm,.avi,.mp3,.m4a,.wav,.ogg,.flac,.aac,.srt,.vtt,.txt"
                          hidden
                          onChange={(e) => chooseFile(e.target.files?.[0])}
                        />
                        <button
                          disabled={working}
                          className={`upload-area ${dragging ? "dragging" : ""}`}
                          onClick={() => fileRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                          }}
                          onDragLeave={() => setDragging(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            if (!working) chooseFile(e.dataTransfer.files[0]);
                          }}
                        >
                          <span className="upload-icon">
                            {file ? (
                              <FileAudio size={25} />
                            ) : (
                              <UploadCloud size={25} />
                            )}
                          </span>
                          <strong>
                            {file ? file.name : "点击上传，或将文件拖到这里"}
                          </strong>
                          <span>
                            {file
                              ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击重新选择`
                              : "音视频 ≤ 200 MB · 字幕 SRT / VTT / TXT"}
                          </span>
                        </button>
                        <div className="source-note">
                          <ShieldCheck size={15} />
                          <span>
                            音视频直接上传到处理服务，处理后删除。
                            <br />
                            字幕文件在浏览器解析，无需转写服务。
                          </span>
                        </div>
                      </>
                    )}
                    {source === "text" && (
                      <>
                        <label
                          className="field-label"
                          htmlFor="transcript-input"
                        >
                          字幕或文本
                        </label>
                        <textarea
                          id="transcript-input"
                          className="text-input"
                          placeholder="把字幕、访谈或课程文本粘贴到这里…\n支持带时间轴的 SRT / VTT 格式。"
                          value={text}
                          maxLength={MAX_TRANSCRIPT_CHARS}
                          disabled={working}
                          onChange={(e) => setText(e.target.value)}
                        />
                        <div className="text-count">
                          {text.length.toLocaleString()} / 60,000
                        </div>
                      </>
                    )}
                  </div>
                  <div className="input-divider" />
                  <div className="section-label">
                    <Sparkles size={16} />
                    笔记整理方式<span>按你的需要，组织内容</span>
                  </div>
                  <div className="style-options">
                    {STYLES.map((s) => (
                      <button
                        key={s.id}
                        disabled={working}
                        className={
                          style === s.id
                            ? "style-option selected"
                            : "style-option"
                        }
                        onClick={() => setStyle(s.id)}
                      >
                        <s.icon size={18} />
                        <strong>{s.name}</strong>
                        <small>{s.desc}</small>
                        {style === s.id && (
                          <span className="style-check">
                            <Check size={10} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="length-row">
                    <label htmlFor="summary-length">内容详略</label>
                    <span className="select-wrap">
                      <select
                        id="summary-length"
                        value={length}
                        disabled={working}
                        onChange={(e) =>
                          setLength(e.target.value as SummaryLength)
                        }
                      >
                        <option value="short">精简 · 快速掌握</option>
                        <option value="normal">标准 · 重点与细节</option>
                        <option value="long">详细 · 深入整理</option>
                      </select>
                      <ChevronDown size={13} />
                    </span>
                  </div>
                  <button
                    className="primary-button run-button"
                    onClick={run}
                    disabled={working}
                  >
                    {working ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <WandSparkles size={18} />
                    )}
                    {busy
                      ? "正在提取字幕…"
                      : summarizing
                        ? "正在整理笔记…"
                        : health?.deepseek
                          ? "提取字幕并总结"
                          : "提取字幕"}
                    {!working && <ArrowRight size={17} />}
                  </button>
                  <div className="run-hint">
                    <Zap size={12} />
                    {source === "text"
                      ? "直接整理文本，无需视频下载"
                      : "提取耗时取决于视频长度与平台响应"}
                  </div>
                  {working && (
                    <button
                      className="cancel-button"
                      onClick={() => abortRef.current?.abort()}
                    >
                      停止{busy ? "等待" : "生成"}
                    </button>
                  )}
                  {error && (
                    <div className="error-message" role="alert">
                      <strong>这次处理遇到了一点问题</strong>
                      <p>{error}</p>
                    </div>
                  )}
                </section>

                <section
                  className="result-panel card"
                  ref={resultRef}
                  aria-label="字幕与 AI 笔记结果"
                >
                  <div className="result-heading">
                    <div className="panel-title">
                      <span className="section-icon mint">
                        <FileText size={18} />
                      </span>
                      <h2>你的知识笔记</h2>
                    </div>
                    <span
                      className={`result-badge ${transcript ? "ready" : ""}`}
                    >
                      <span />
                      {working
                        ? "正在处理中"
                        : demo
                          ? "示例预览"
                          : transcript
                            ? "已整理"
                            : "等待灵感"}
                    </span>
                  </div>
                  {!transcript && !busy ? (
                    <div className="empty-result">
                      <div className="empty-art" aria-hidden="true">
                        <div className="art-orbit orbit-one" />
                        <div className="art-orbit orbit-two" />
                        <div className="art-video">
                          <span className="art-video-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                          <div className="waveform">
                            {[
                              14, 24, 39, 23, 49, 34, 58, 42, 27, 45, 23, 15,
                            ].map((h, i) => (
                              <i key={i} style={{ height: h }} />
                            ))}
                          </div>
                          <span className="art-video-label">
                            A WORLD OF IDEAS
                          </span>
                        </div>
                        <div className="art-note">
                          <span className="art-note-top">
                            <span />
                            <Sparkles size={16} />
                          </span>
                          <b />
                          <i />
                          <i />
                          <i />
                          <div className="art-note-check">
                            <Check size={12} />
                            <span />
                          </div>
                        </div>
                        <span className="art-star star-one">✦</span>
                        <span className="art-star star-two">✦</span>
                        <span className="art-pill">
                          <Check size={12} />
                          灵感已捕获
                        </span>
                      </div>
                      <div className="empty-eyebrow">
                        FROM WATCHING TO UNDERSTANDING
                      </div>
                      <h2>把长视频，读成几分钟。</h2>
                      <p>
                        精彩内容不必反复拖进度条。
                        <br />
                        字幕、要点与行动建议，在这里清晰呈现。
                      </p>
                      <div className="empty-features">
                        <span>
                          <Clock3 size={14} />
                          带时间轴字幕
                        </span>
                        <span>
                          <Sparkles size={14} />
                          结构化 AI 总结
                        </span>
                        <span>
                          <ArrowDownToLine size={14} />
                          一键导出
                        </span>
                      </div>
                      <button className="empty-demo" onClick={showDemo}>
                        还没有视频？先看看示例
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : busy ? (
                    <div className="processing-result">
                      <div className="processing-icon">
                        <AudioLines size={39} />
                      </div>
                      <div className="eyebrow">MAKING ROOM FOR INSIGHT</div>
                      <h2>内容，正在变成笔记。</h2>
                      <p role="status">{status}</p>
                      <div className="progress-track">
                        <span style={{ width: `${job?.progress ?? 6}%` }} />
                      </div>
                      <small>
                        {job ? `${job.progress}% · ` : ""}
                        你可以留在这里，稍等片刻
                      </small>
                      <div className="process-steps">
                        <span className="done">
                          <Check size={14} />
                          内容已提交
                        </span>
                        <span className="current">
                          <LoaderCircle className="spin" size={14} />
                          {job?.status === "transcribing"
                            ? "语音转写中"
                            : "解析与提取中"}
                        </span>
                        <span>
                          <Sparkles size={14} />
                          AI 整理
                        </span>
                      </div>
                    </div>
                  ) : (
                    transcript && (
                      <>
                        <div className="note-meta">
                          <h3 title={transcript.title}>{transcript.title}</h3>
                          <div>
                            <span>{transcript.platform || "导入文本"}</span>
                            {transcript.duration ? (
                              <>
                                <span className="meta-dot">·</span>
                                <span>
                                  <Clock3 size={12} />
                                  {formatTime(transcript.duration)}
                                </span>
                              </>
                            ) : null}
                            <span className="meta-dot">·</span>
                            <span>
                              {transcript.text.length.toLocaleString()} 字符
                            </span>
                            <span className="source-badge">
                              {transcript.source === "caption"
                                ? "平台字幕"
                                : transcript.source === "asr"
                                  ? "语音转写"
                                  : demo
                                    ? "演示素材"
                                    : "导入文本"}
                            </span>
                          </div>
                        </div>
                        {demo && (
                          <div className="demo-notice">
                            <Sparkles size={13} />
                            内置演示内容，用于展示效果，未调用 API。
                          </div>
                        )}
                        <div className="result-tabs">
                          <div role="tablist" aria-label="结果类型">
                            <button
                              role="tab"
                              aria-selected={tab === "summary"}
                              className={tab === "summary" ? "selected" : ""}
                              onClick={() => setTab("summary")}
                            >
                              <Sparkles size={15} />
                              AI 笔记
                            </button>
                            <button
                              role="tab"
                              aria-selected={tab === "transcript"}
                              className={tab === "transcript" ? "selected" : ""}
                              onClick={() => setTab("transcript")}
                            >
                              <FileText size={15} />
                              原文字幕<span>{transcript.segments.length}</span>
                            </button>
                          </div>
                          <button
                            className="icon-button"
                            aria-label="复制当前内容"
                            title="复制内容"
                            disabled={
                              summarizing || (tab === "summary" && !summary)
                            }
                            onClick={copyResult}
                          >
                            <Copy size={15} />
                          </button>
                        </div>
                        <div className="result-content">
                          {tab === "summary" ? (
                            <>
                              {summarizing && (
                                <div className="stream-status" role="status">
                                  <LoaderCircle className="spin" size={14} />
                                  {status}
                                </div>
                              )}
                              {summary ? (
                                <div
                                  className={`markdown ${summarizing ? "streaming" : ""}`}
                                >
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    skipHtml
                                  >
                                    {summary}
                                  </ReactMarkdown>
                                </div>
                              ) : (
                                !summarizing && (
                                  <div className="summary-empty">
                                    <Sparkles size={30} />
                                    <h3>字幕已就绪，让 AI 再想一步。</h3>
                                    <p>
                                      提炼观点、组织结构，生成属于你的知识笔记。
                                    </p>
                                    <button
                                      className="primary-button"
                                      onClick={() =>
                                        generateSummary(transcript)
                                      }
                                    >
                                      <WandSparkles size={16} />
                                      生成 AI 笔记
                                    </button>
                                    {!health?.deepseek && (
                                      <button
                                        className="text-button"
                                        onClick={() => setModal("settings")}
                                      >
                                        需要配置 DeepSeek API
                                        <ArrowRight size={13} />
                                      </button>
                                    )}
                                  </div>
                                )
                              )}
                            </>
                          ) : (
                            <>
                              <div className="transcript-toolbar">
                                <span>
                                  {transcript.segments.some(
                                    (s) => s.start !== null,
                                  )
                                    ? "时间轴 · 原文"
                                    : "纯文本 · 无时间轴"}
                                </span>
                                <button
                                  className="text-button"
                                  disabled={summarizing}
                                  onClick={() => {
                                    setEditing(!editing);
                                    if (editing && !demo)
                                      saveNote(transcript, summary);
                                  }}
                                >
                                  {editing ? "完成编辑" : "编辑字幕"}
                                </button>
                              </div>
                              {editing && (
                                <p className="edit-notice">
                                  编辑保留原时间轴；修改字幕会清除旧总结，请重新生成。
                                </p>
                              )}
                              <div className="transcript-list">
                                {transcript.segments.map((s, i) => (
                                  <div className="transcript-segment" key={i}>
                                    <span className="timestamp">
                                      {s.start !== null
                                        ? formatTime(s.start)
                                        : String(i + 1).padStart(2, "0")}
                                    </span>
                                    {editing ? (
                                      <textarea
                                        aria-label={`第 ${i + 1} 段字幕`}
                                        value={s.text}
                                        onChange={(e) =>
                                          editSegment(i, e.target.value)
                                        }
                                      />
                                    ) : (
                                      <p>{s.text}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="result-footer">
                          <span>
                            <ShieldCheck size={13} />
                            {demo ? "示例笔记" : "历史仅存此浏览器"}
                          </span>
                          <div>
                            {tab === "summary" ? (
                              <>
                                <button
                                  className="text-button"
                                  disabled={summarizing}
                                  onClick={() => {
                                    setDemo(false);
                                    generateSummary(transcript);
                                  }}
                                >
                                  <WandSparkles size={14} />
                                  重新生成
                                </button>
                                <button
                                  className="export-button"
                                  disabled={!summary || summarizing}
                                  onClick={() => exportResult("md")}
                                >
                                  <ArrowDownToLine size={14} />
                                  导出 Markdown
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="text-button"
                                  onClick={() => exportResult("txt")}
                                >
                                  <ArrowDownToLine size={14} />
                                  TXT
                                </button>
                                <button
                                  className="export-button"
                                  disabled={
                                    !transcript.segments.some(
                                      (s) => s.start !== null && s.end !== null,
                                    )
                                  }
                                  onClick={() => exportResult("srt")}
                                >
                                  <ArrowDownToLine size={14} />
                                  导出 SRT
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  )}
                </section>
              </div>
              <div className="bottom-note">
                <span>
                  <ShieldCheck size={14} />
                  密钥仅在服务端使用
                </span>
                <span className="bottom-dot">·</span>
                <span>支持链接、音视频及字幕文件</span>
                <button onClick={() => setModal("guide")}>
                  了解工作原理
                  <ArrowRight size={12} />
                </button>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              视笺 <i>✦</i> 把看见的，变成理解的。
            </span>
            <span>MADE FOR CURIOUS MINDS</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialogRef}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="modal-inner">
          <button
            className="modal-close icon-button"
            onClick={() => setModal(null)}
            aria-label="关闭弹窗"
          >
            <X size={20} />
          </button>
          {modal === "settings" ? (
            <>
              <span className="modal-symbol">
                <Settings2 size={24} />
              </span>
              <h2>服务设置</h2>
              <p className="modal-description">
                API 密钥通过部署平台的环境变量配置，不会发送到浏览器。
              </p>
              <div className="service-row">
                <div>
                  <strong>DeepSeek</strong>
                  <small>视频总结与内容分析</small>
                </div>
                <span
                  className={
                    health?.deepseek ? "connection ready" : "connection"
                  }
                >
                  {health?.deepseek ? "已配置" : "待配置"}
                </span>
              </div>
              <div className="service-row">
                <div>
                  <strong>视频处理服务</strong>
                  <small>平台解析、音轨提取与 Whisper 转写</small>
                </div>
                <span
                  className={health?.worker ? "connection ready" : "connection"}
                >
                  {health?.worker ? "已配置" : "待配置"}
                </span>
              </div>
              <p className="settings-caption">
                以上仅表示已填写配置，实际连通性以处理结果为准。
              </p>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      setHealth(await fetch("/api/health").then(jsonResponse));
                      setToast("配置状态已刷新。");
                    } catch {
                      setToast("无法刷新配置状态。");
                    }
                  }}
                >
                  刷新状态
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setModal(null);
                  }}
                >
                  完成
                  <Check size={16} />
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="modal-symbol">
                <BookOpen size={24} />
              </span>
              <h2>让每段内容，都有收获。</h2>
              <p className="modal-description">
                支持
                B站、抖音、YouTube、TikTok、Vimeo、小红书与快手。平台可能要求登录或限制服务器访问；无法解析时可上传音视频。
              </p>
              <ol className="guide-list">
                <li>
                  <span>01</span>
                  <div>
                    <strong>导入你想理解的内容</strong>
                    <p>
                      粘贴单个视频链接，上传音视频（≤ 200 MB），或导入 SRT / VTT
                      / TXT 字幕。
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>字幕优先，语音转写兜底</strong>
                    <p>
                      Docker 服务用 yt-dlp 读取已有字幕；无字幕时由 FFmpeg
                      提取音轨，调用 Groq Whisper 分段转写。
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>用 DeepSeek 组织知识</strong>
                    <p>
                      选择全面解析、学习笔记或会议纪要，保留已有时间戳；长字幕会分段整理后合并。
                    </p>
                  </div>
                </li>
              </ol>
              <div className="deploy-guide">
                <strong>部署：Vercel + Docker</strong>
                <p>
                  ① 部署仓库的 worker/ 目录，配置
                  GROQ_API_KEY、WORKER_API_TOKEN、CORS_ORIGINS。
                  <br />② 在 Vercel 导入项目，配置
                  DEEPSEEK_API_KEY、WORKER_URL 和相同的 WORKER_API_TOKEN。
                  <br />③ 打开网站即可使用。完整命令和自检步骤见仓库 README。
                </p>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={17} />
                <p>
                  音视频处理完即删除；处理服务的字幕结果 24
                  小时后过期，并定期清理。字幕会发送给 DeepSeek，音频会发送给
                  Groq。历史笔记仅存浏览器，可随时清空。
                </p>
              </div>
              <button className="primary-button" onClick={() => setModal(null)}>
                开始整理
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
