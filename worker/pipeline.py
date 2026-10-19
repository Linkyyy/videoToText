"""Blocking video pipeline. Run on the worker, never inside a Vercel function."""
import html
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import yt_dlp

MAX_BYTES = 200 * 1024 * 1024
MAX_TEXT = 60_000
DOMAINS = {
    "bilibili.com": "哔哩哔哩", "b23.tv": "哔哩哔哩", "douyin.com": "抖音",
    "iesdouyin.com": "抖音", "youtube.com": "YouTube", "youtu.be": "YouTube",
    "tiktok.com": "TikTok", "vimeo.com": "Vimeo", "xiaohongshu.com": "小红书",
    "xhslink.com": "小红书", "kuaishou.com": "快手",
}


class PipelineError(Exception):
    pass


def public_url(url: str, platform_only: bool = True, resolve: bool = True) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    try:
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError()
    except ValueError:
        raise PipelineError("仅支持安全的 HTTPS 视频链接。")
    if not host or (platform_only and not any(host == d or host.endswith("." + d) for d in DOMAINS)):
        raise PipelineError("不支持该视频域名。")
    if resolve:
        try:
            addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        except OSError:
            raise PipelineError("视频域名无法解析，请稍后重试。")
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise PipelineError("不允许访问私有网络地址。")
    return url


def resolve_video_url(url: str) -> str:
    public_url(url)
    host = urlparse(url).hostname or ""
    short = host in ("b23.tv", "v.douyin.com", "vm.tiktok.com", "vt.tiktok.com", "xhslink.com", "v.kuaishou.com")
    if not short:
        return canonical_video_url(url)
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        for _ in range(6):
            public_url(url)
            with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise PipelineError("视频链接跳转异常。")
                    url = urljoin(url, location)
                    continue
                if response.status_code >= 400:
                    raise PipelineError("视频页面拒绝访问，可能需要登录或更换网络出口。")
                return canonical_video_url(url)
    raise PipelineError("视频链接跳转次数过多。")


def canonical_video_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname in ("iesdouyin.com", "www.iesdouyin.com"):
        match = re.search(r"/(?:share/)?video/(\d+)", parsed.path)
        if match:
            return "https://www.douyin.com/video/" + match[1]
    return url


def clean_text(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def parse_captions(data: str, ext: str) -> list[dict]:
    segments = []
    if ext == "json3":
        for event in json.loads(data).get("events", []):
            text = "".join(s.get("utf8", "") for s in event.get("segs", [])).strip()
            start = event.get("tStartMs", 0) / 1000
            if text:
                segments.append({"start": start, "end": start + event.get("dDurationMs", 1000) / 1000, "text": text})
    elif ext == "bili":
        segments = [{"start": float(s["from"]), "end": float(s["to"]), "text": clean_text(s["content"])} for s in json.loads(data).get("body", [])]
    else:
        def seconds(value):
            total = 0.0
            for part in value.replace(",", ".").split(":"):
                total = total * 60 + float(part)
            return total
        for block in re.split(r"\n\s*\n", data.replace("\r\n", "\n")):
            if re.match(r"^(NOTE|STYLE|REGION)(\s|$)", block):
                continue
            match = re.search(r"((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})[^\n]*\n(.*)", block, re.S)
            if match:
                text = clean_text(match[3].replace("\n", " "))
                if text:
                    segments.append({"start": seconds(match[1]), "end": seconds(match[2]), "text": text})
    deduped = []
    for s in segments:
        if not s["text"] or s["end"] <= s["start"]:
            continue
        if deduped and deduped[-1]["text"] == s["text"]:
            deduped[-1]["end"] = max(deduped[-1]["end"], s["end"])
        else:
            deduped.append(s)
    return deduped


def fetch_captions(info: dict) -> list[dict]:
    tracks = []
    for source in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):
        for lang, choices in source.items():
            rank = 0 if "zh" in lang else 1 if lang.startswith("en") else 2
            for track in choices:
                if track.get("ext") in ("vtt", "srt", "json3", "bili") and (track.get("url") or track.get("data")):
                    tracks.append((rank, track))
    for _, track in sorted(tracks, key=lambda t: t[0])[:8]:
        try:
            if track.get("data"):
                result = parse_captions(track["data"], track["ext"])
                if result:
                    return result
                continue
            url = track["url"]
            with httpx.Client(timeout=25, follow_redirects=False) as client:
                for _ in range(5):
                    public_url(url, platform_only=False)
                    with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}) as response:
                        if response.is_redirect:
                            url = urljoin(url, response.headers["location"])
                            continue
                        response.raise_for_status()
                        content = bytearray()
                        for piece in response.iter_bytes():
                            content.extend(piece)
                            if len(content) > 8 * 1024 * 1024:
                                raise PipelineError("字幕文件过大。")
                        result = parse_captions(content.decode("utf-8-sig"), track["ext"])
                        if result:
                            return result
                        break
        except (httpx.HTTPError, PipelineError, ValueError, KeyError, UnicodeError):
            continue
    return []


def media_duration(path: Path) -> float:
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
        return float(json.loads(result.stdout)["format"]["duration"])
    except (subprocess.SubprocessError, KeyError, ValueError):
        raise PipelineError("无法读取文件。请上传有效且带音轨的视频或音频。")


def transcribe(path: Path, directory: Path, progress) -> tuple[list[dict], float]:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise PipelineError("视频没有可提取的字幕；请在视频处理服务配置 GROQ_API_KEY 后进行语音转写。")
    duration = media_duration(path)
    if duration > int(os.getenv("MAX_VIDEO_SECONDS", "7200")):
        raise PipelineError("视频时长超过上限（默认 2 小时），请分段后上传。")
    progress("transcribing", 38, "正在提取音轨并分段…")
    try:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-threads", "1", "-i", str(path), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "segment", "-segment_time", "600", str(directory / "chunk-%03d.mp3")], capture_output=True, check=True, timeout=600)
    except (subprocess.SubprocessError, OSError):
        raise PipelineError("音轨提取失败。请确认文件格式有效且包含音轨。")
    chunks = sorted(directory.glob("chunk-*.mp3"))
    if not chunks:
        raise PipelineError("文件中没有可转写的音频。")
    segments, offset = [], 0.0
    with httpx.Client(timeout=httpx.Timeout(180, connect=20)) as client:
        for i, chunk in enumerate(chunks):
            progress("transcribing", 42 + int(50 * i / len(chunks)), f"正在转写音频 {i + 1}/{len(chunks)} 段…")
            try:
                with chunk.open("rb") as f:
                    response = client.post("https://api.groq.com/openai/v1/audio/transcriptions", headers={"Authorization": f"Bearer {key}"}, files={"file": (chunk.name, f, "audio/mpeg")}, data={"model": os.getenv("GROQ_MODEL", "whisper-large-v3"), "response_format": "verbose_json", "temperature": "0", "timestamp_granularities[]": "segment"})
                if response.status_code == 401:
                    raise PipelineError("语音转写密钥无效，请检查 GROQ_API_KEY。")
                if response.status_code == 429:
                    raise PipelineError("语音转写额度或速率受限，请稍后重试。")
                response.raise_for_status()
                result = response.json()
            except httpx.HTTPError:
                raise PipelineError("语音转写服务连接失败，请稍后重试。")
            parts = result.get("segments") or []
            for segment in parts:
                if segment.get("text", "").strip():
                    segments.append({"start": round(offset + float(segment["start"]), 3), "end": round(offset + float(segment["end"]), 3), "text": segment["text"].strip()})
            if not parts and result.get("text", "").strip():
                segments.append({"start": None, "end": None, "text": result["text"].strip()})
            offset += media_duration(chunk)
    if not segments:
        raise PipelineError("没有识别到语音，请检查音频内容。")
    return segments, duration


class QuietLogger:
    def debug(self, _): pass
    def warning(self, _): pass
    def error(self, _): pass


def download_diagnostic(error: Exception) -> str:
    """Keep extractor errors useful without logging signed URLs or credentials."""
    message = re.sub(r"https?://[^\s<>\"']+", "[URL]", str(error))
    message = re.sub(r"(?im)\b(authorization|cookie)\s*[:=][^\r\n]*", r"\1=[redacted]", message)
    message = re.sub(r"(?i)(authorization|cookie|token|password|secret)(\s*[:=]\s*)[^\s,;]+", r"\1\2[redacted]", message)
    message = re.sub(r"\b(?:gsk_|sk-|vcp_|vca_)[A-Za-z0-9_-]{16,}", "[redacted]", message)
    return re.sub(r"\x1b\[[0-9;]*m", "", message).replace("\r", " ").replace("\n", " ")[:800]


def download_failure_kind(error: Exception) -> str:
    message = str(error).lower()
    if any(value in message for value in ("geo-restricted", "not available in your country", "not available in your region", "deleted or geo")):
        return "unavailable"
    if any(value in message for value in ("login required", "sign in", "log in", "use --cookies", "supporter-only")):
        return "login"
    if re.search(r"http error (?:412|429)\b", message) or "rate limit" in message:
        return "rate_limit"
    if re.search(r"http error (?:408|5\d\d)\b", message) or any(value in message for value in (
        "timed out", "timeout", "connection reset", "connection aborted", "connection refused",
        "remote end closed", "temporary failure", "unable to resolve", "name or service not known",
    )):
        return "temporary"
    return "other"


def extract_video_info(ydl, url: str) -> dict:
    # Retry one temporary metadata failure. yt-dlp separately retries media chunks.
    for attempt in range(2):
        try:
            return ydl.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as error:
            if attempt or download_failure_kind(error) != "temporary":
                raise
            time.sleep(2)


def download_error_message(error: Exception, platform: str) -> str:
    kind = download_failure_kind(error)
    if kind == "unavailable":
        return "该视频已被删除或限制当前地区访问。请使用可公开访问的视频，或上传你可以访问的视频文件。"
    if kind == "login":
        return f"{platform}要求登录或相应访问权限。请在视频处理服务配置有效 Cookie，或上传你有权访问的视频文件。"
    if kind == "rate_limit":
        return f"{platform}暂时限制了当前服务器的请求。请稍后重试，或改用上传视频文件。"
    if kind == "temporary":
        return "视频平台连接暂时失败，已自动重试。请稍后再试，或上传视频文件。"
    return "平台解析或下载失败。视频可能需要登录 Cookie、受地区限制，或平台规则已变化；可尝试更新 yt-dlp，或下载后上传文件。"


def process_job(job: dict, directory: Path, progress) -> dict:
    url = job.get("url")
    title = job.get("title", "上传的音视频")
    platform = "本地文件"
    source = "asr"
    segments = []
    duration = None
    if url:
        progress("downloading", 8, "正在解析视频信息与字幕…")
        url = resolve_video_url(url)
        host = urlparse(url).hostname
        platform = next((name for domain, name in DOMAINS.items() if host == domain or host.endswith("." + domain)), "视频")
        options = {
            "format": "bestaudio/best", "outtmpl": str(directory / "input.%(ext)s"),
            "noplaylist": True, "playlist_items": "1", "quiet": True, "no_warnings": True,
            "logger": QuietLogger(), "socket_timeout": 25, "retries": 2, "extractor_retries": 1,
            "max_filesize": MAX_BYTES, "cachedir": False,
            "writesubtitles": True, "writeautomaticsub": True,
            "subtitleslangs": ["zh.*", "en.*"],
            "match_filter": lambda info, *, incomplete=False: "Video is too long" if (info.get("duration") or 0) > int(os.getenv("MAX_VIDEO_SECONDS", "7200")) else None,
        }
        cookie_file = os.getenv("YTDLP_COOKIE_FILE")
        if cookie_file:
            try:
                shutil.copyfile(cookie_file, directory / "cookies.txt")
            except OSError:
                raise PipelineError("无法读取配置的平台 Cookie 文件，请检查挂载路径与权限。")
            options["cookiefile"] = str(directory / "cookies.txt")
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = extract_video_info(ydl, url)
                if not info or info.get("_type") in ("playlist", "multi_video"):
                    raise PipelineError("请使用单个视频的页面链接，不支持合集或播放列表。")
                title = str(info.get("title") or "未命名视频")[:200]
                duration = info.get("duration")
                if info.get("is_live"):
                    raise PipelineError("暂不支持正在进行的直播。")
                if duration and duration > int(os.getenv("MAX_VIDEO_SECONDS", "7200")):
                    raise PipelineError("视频时长超过上限（默认 2 小时），请使用较短的视频。")
                segments = fetch_captions(info)
                if segments:
                    source = "caption"
                else:
                    if not os.getenv("GROQ_API_KEY"):
                        raise PipelineError("未找到可用字幕。请配置 GROQ_API_KEY，或下载视频后上传 / 导入字幕。")
                    progress("downloading", 20, "没有现成字幕，正在下载音频…")
                    ydl.params["writesubtitles"] = False
                    ydl.params["writeautomaticsub"] = False
                    # Reuse the selected formats, signed media URLs and headers.
                    # Extracting the webpage again doubles platform requests and
                    # can trigger Bilibili rate limits after metadata succeeded.
                    ydl.process_ie_result(info, download=True)
                    files = [p for p in directory.glob("input.*") if p.suffix not in (".part", ".ytdl", ".json")]
                    if not files:
                        raise PipelineError("视频文件未下载成功，可能超过大小限制。")
                    path = files[0]
        except yt_dlp.utils.DownloadError as error:
            logging.getLogger(__name__).warning("Video extraction failed for %s: %s", platform, download_diagnostic(error))
            raise PipelineError(download_error_message(error, platform)) from None
    else:
        path = directory / "upload.bin"
    if not segments:
        if path.stat().st_size > MAX_BYTES:
            raise PipelineError("文件超过 200 MB 限制。")
        segments, duration = transcribe(path, directory, progress)
    text = "\n".join(s["text"] for s in segments)
    if len(text) > MAX_TEXT:
        raise PipelineError("字幕超过 60,000 字符，请按章节拆分视频后重试。")
    return {"title": title, "text": text, "segments": segments, "source": source, "platform": platform, "url": url, "duration": duration}
