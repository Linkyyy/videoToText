import base64
import hashlib
import hmac
import json
import socket
import time
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

import app as service
import pipeline

TOKEN = "unit-test-worker-secret-32-characters"


def ticket(job_id, size, expires=None):
    data = base64.urlsafe_b64encode(json.dumps({"kind": "upload", "id": job_id, "size": size, "exp": expires or time.time() + 60}).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(TOKEN.encode(), data.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return data + "." + signature


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setattr(service, "DATA", tmp_path)
    monkeypatch.setattr(service, "process_job", lambda job, directory, progress: {"title": job.get("title", "测试视频"), "text": "实际队列测试", "segments": [{"start": 0, "end": 1, "text": "实际队列测试"}], "source": "asr"})
    with TestClient(service.app) as client:
        yield client


def test_domains_and_private_network(monkeypatch):
    for url in ["http://youtube.com/a", "https://bilibili.com.evil.test/a", "https://youtube.com@localhost/a", "file:///tmp/a"]:
        with pytest.raises(pipeline.PipelineError): pipeline.public_url(url, resolve=False)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(pipeline.PipelineError, match="私有"): pipeline.public_url("https://www.bilibili.com/a")


def test_caption_formats():
    srt = "1\n00:00:01,000 --> 00:00:02,500\n<b>你好</b> &amp; 世界\n\n2\n00:00:02,500 --> 00:00:03,000\n你好 &amp; 世界"
    assert pipeline.parse_captions(srt, "srt") == [{"start": 1, "end": 3, "text": "你好 & 世界"}]
    assert pipeline.parse_captions('{"events":[{"tStartMs":1000,"dDurationMs":2000,"segs":[{"utf8":"中文"}]}]}', "json3")[0]["end"] == 3
    assert pipeline.parse_captions('{"body":[{"from":1,"to":2,"content":"字幕"}]}', "bili")[0]["text"] == "字幕"


def test_bilibili_inline_subtitles_and_douyin_canonical_url():
    info = {"subtitles": {"ai-zh": [{"ext": "srt", "data": "1\n00:00:01,000 --> 00:00:02,000\nB站内嵌字幕"}]}}
    assert pipeline.fetch_captions(info)[0]["text"] == "B站内嵌字幕"
    assert pipeline.canonical_video_url("https://www.iesdouyin.com/share/video/1234567890/?region=CN") == "https://www.douyin.com/video/1234567890"


def test_download_diagnostic_redacts_credentials():
    error = Exception("HTTP Error 403 at https://user:private@cdn.test/audio?token=signed\ntoken=private gsk_012345678901234567890123\nAuthorization: Bearer private\nCookie: SESSDATA=private; another=private")
    message = pipeline.download_diagnostic(error)
    assert "HTTP Error 403" in message
    assert "private" not in message and "signed" not in message and "0123456789" not in message
    assert "https://" not in message


def test_bilibili_reuses_metadata_after_temporary_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "unit-test-provider-key")
    monkeypatch.setattr(pipeline, "resolve_video_url", lambda url: url)
    monkeypatch.setattr(pipeline, "fetch_captions", lambda info: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda _: None)
    monkeypatch.setattr(pipeline, "transcribe", lambda *args: ([{"start": 0, "end": 1, "text": "实际下载后的转写"}], 1))
    info = {"id": "BV17x411w7KC", "title": "公开视频", "duration": 1, "formats": [{"url": "https://cdn.test/audio"}]}

    class Extractor:
        params = {}
        calls = 0
        downloads = 0

        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download):
            assert download is False
            self.calls += 1
            if self.calls == 1: raise pipeline.yt_dlp.utils.DownloadError("HTTP Error 503: Service Unavailable")
            return info
        def process_ie_result(self, item, download):
            assert item is info and download is True
            self.downloads += 1
            (tmp_path / "input.m4a").write_bytes(b"downloaded")

    extractor = Extractor()
    monkeypatch.setattr(pipeline.yt_dlp, "YoutubeDL", lambda options: extractor)
    result = pipeline.process_job({"url": "https://www.bilibili.com/video/BV17x411w7KC"}, tmp_path, lambda *args: None)
    assert extractor.calls == 2 and extractor.downloads == 1
    assert result["text"] == "实际下载后的转写"


@pytest.mark.parametrize("reason,expected", [
    ("This video may be deleted or geo-restricted", "地区"),
    ("Login required. Use --cookies", "Cookie"),
    ("HTTP Error 412: Precondition Failed", "限制"),
])
def test_permanent_platform_failures_are_not_retried(reason, expected, monkeypatch):
    calls = []
    class Extractor:
        def extract_info(self, *args, **kwargs):
            calls.append(True)
            raise pipeline.yt_dlp.utils.DownloadError(reason)
    with pytest.raises(pipeline.yt_dlp.utils.DownloadError) as raised:
        pipeline.extract_video_info(Extractor(), "https://www.bilibili.com/video/BV17x411w7KC")
    assert len(calls) == 1
    assert expected in pipeline.download_error_message(raised.value, "哔哩哔哩")


def test_auth_and_invalid_inputs(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/jobs/" + "a" * 32).status_code == 401
    assert client.post("/jobs", json={"url": "https://127.0.0.1/a"}, headers={"Authorization": "Bearer " + TOKEN}).status_code == 400
    assert client.post("/uploads", files={"file": ("bad.wav", b"test")}).status_code == 403


def test_upload_queue_status_and_single_use(client):
    job_id = "a" * 32
    headers = {"Authorization": "Bearer " + ticket(job_id, 4)}
    response = client.post("/uploads", files={"file": ("../../display.wav", b"test", "audio/wav")}, headers=headers)
    assert response.status_code == 202
    for _ in range(30):
        result = client.get("/jobs/" + job_id, headers={"Authorization": "Bearer " + TOKEN}).json()
        if result["status"] == "completed": break
        time.sleep(.05)
    assert result["status"] == "completed"
    assert result["result"]["title"] == "display.wav"
    assert result["result"]["text"] == "实际队列测试"
    assert not (service.DATA / job_id).exists()
    assert client.post("/uploads", files={"file": ("a.wav", b"test")}, headers=headers).status_code == 409


def test_bad_and_expired_upload_tickets(client):
    job_id = "b" * 32
    for value in [ticket(job_id, 4, 1), ticket(job_id, 4) + "x"]:
        assert client.post("/uploads", files={"file": ("a.wav", b"test")}, headers={"Authorization": "Bearer " + value}).status_code == 403
    assert client.post("/uploads", files={"file": ("a.wav", b"test")}, headers={"Authorization": "Bearer " + ticket(job_id, 5)}).status_code == 413


def test_ffmpeg_and_transcription_contract(tmp_path, monkeypatch):
    audio = tmp_path / "input.wav"
    with wave.open(str(audio), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b"\x00\x00" * 8000)
    monkeypatch.setenv("GROQ_API_KEY", "unit-test-provider-key")
    calls = []

    def respond(request):
        assert request.url == "https://api.groq.com/openai/v1/audio/transcriptions"
        assert request.headers["authorization"] == "Bearer unit-test-provider-key"
        assert b"whisper-large-v3" in request.content and b"audio/mpeg" in request.content
        calls.append(request)
        return httpx.Response(200, json={"segments": [{"start": 0, "end": .4, "text": "转写结果"}]})

    original = httpx.Client
    monkeypatch.setattr(pipeline.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(respond), **kw))
    segments, duration = pipeline.transcribe(audio, tmp_path, lambda *a: None)
    assert segments[0]["text"] == "转写结果"
    assert .49 <= duration <= .51
    assert calls and list(tmp_path.glob("chunk-*.mp3"))


def test_missing_asr_key_is_actionable(tmp_path, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(pipeline.PipelineError, match="GROQ_API_KEY"):
        pipeline.transcribe(tmp_path / "not-used.wav", tmp_path, lambda *a: None)


def test_restart_marks_interrupted_upload_failed(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA", tmp_path)
    service.init_db()
    service.enqueue("c" * 32, {"title": "file"}, "uploading")
    service.init_db()
    assert service.get_job("c" * 32)["status"] == "failed"
