import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from pipeline import MAX_BYTES, PipelineError, process_job, public_url

DATA = Path(os.getenv("DATA_DIR", "./data")).resolve()
STOP = threading.Event()
DB_LOCK = threading.Lock()
MAX_AGE = 86400


@contextmanager
def db():
    connection = sqlite3.connect(DATA / "jobs.sqlite3", timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    with db() as c:
        c.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, progress INTEGER, message TEXT, input TEXT, result TEXT, error TEXT, created REAL)")
        c.execute("UPDATE jobs SET status='failed', error='服务已重启，请重新提交。', message='服务已重启' WHERE status IN ('downloading','transcribing','uploading')")
    cleanup()


def cleanup():
    with db() as c:
        rows = c.execute("SELECT id FROM jobs WHERE created < ? OR status IN ('failed','completed')", (time.time() - MAX_AGE,)).fetchall()
        for row in rows:
            shutil.rmtree(DATA / row["id"], ignore_errors=True)
        c.execute("DELETE FROM jobs WHERE created < ?", (time.time() - MAX_AGE,))


def update(job_id, **fields):
    with db() as c:
        c.execute("UPDATE jobs SET " + ",".join(f"{key}=?" for key in fields) + " WHERE id=?", [*fields.values(), job_id])


def run_queue():
    last_cleanup = 0
    while not STOP.is_set():
        if time.time() - last_cleanup > 3600:
            cleanup()
            last_cleanup = time.time()
        with db() as c:
            row = c.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if not row:
            STOP.wait(0.5)
            continue
        job_id = row["id"]
        directory = DATA / job_id
        directory.mkdir(exist_ok=True)
        update(job_id, status="downloading", progress=3, message="任务已开始…")
        try:
            def progress(status, value, message):
                update(job_id, status=status, progress=value, message=message)
            result = process_job(json.loads(row["input"]), directory, progress)
            update(job_id, status="completed", progress=100, message="字幕已准备好", result=json.dumps(result, ensure_ascii=False))
        except Exception as error:
            message = str(error) if isinstance(error, PipelineError) else "视频处理发生错误，请检查文件格式或服务配置后重试。"
            update(job_id, status="failed", message="处理失败", error=message)
        finally:
            shutil.rmtree(directory, ignore_errors=True)


@asynccontextmanager
async def lifespan(_):
    if len(os.getenv("WORKER_API_TOKEN", "")) < 32:
        raise RuntimeError("WORKER_API_TOKEN must contain at least 32 characters")
    STOP.clear()
    init_db()
    thread = threading.Thread(target=run_queue, daemon=True)
    thread.start()
    yield
    STOP.set()
    await asyncio.to_thread(thread.join, 5)


app = FastAPI(title="视笺视频处理服务", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
origins = [s.strip().rstrip("/") for s in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Authorization", "Content-Type"], allow_credentials=False)


class RequestSizeLimit:
    """Limit streamed multipart bytes before Starlette can spool an unbounded file."""
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = MAX_BYTES + 1024 * 1024 if scope["path"] == "/uploads" else 8192
        if scope["path"] == "/uploads" and scope["method"] == "POST":
            headers = dict(scope["headers"])
            try:
                ticket = upload_ticket(headers.get(b"authorization", b"").decode())
                limit = ticket["size"] + 1024 * 1024
            except HTTPException as error:
                return await JSONResponse({"detail": error.detail}, status_code=error.status_code)(scope, receive, send)
        total = 0

        async def limited_receive():
            nonlocal total
            message = await receive()
            total += len(message.get("body", b""))
            if total > limit:
                raise HTTPException(413, "文件超过 200 MB 限制。")
            return message
        await self.app(scope, limited_receive, send)


app.add_middleware(RequestSizeLimit)


def authorize(value):
    expected = "Bearer " + os.getenv("WORKER_API_TOKEN", "")
    if not secrets.compare_digest(value or "", expected):
        raise HTTPException(401, "视频处理服务认证失败。")


def upload_ticket(value):
    try:
        data, signature = (value or "").removeprefix("Bearer ").split(".")
        expected = hmac.new(os.environ["WORKER_API_TOKEN"].encode(), data.encode(), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, supplied): raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
        if payload["kind"] != "upload" or payload["exp"] < time.time() or not re.fullmatch(r"[a-f0-9]{32}", payload["id"]): raise ValueError()
        if not isinstance(payload["size"], int) or not 0 < payload["size"] <= MAX_BYTES: raise ValueError()
        return payload
    except (ValueError, KeyError, TypeError):
        raise HTTPException(403, "上传凭证无效或已过期，请重新选择文件。")


def enqueue(job_id, source, status="queued"):
    with DB_LOCK, db() as c:
        if c.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','downloading','transcribing','uploading')").fetchone()[0] >= 10:
            raise HTTPException(429, "任务队列已满，请稍后重试。")
        try:
            c.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)", (job_id, status, 0, "正在排队…", json.dumps(source, ensure_ascii=False), None, None, time.time()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "上传凭证已使用，请重新提交。")


def get_job(job_id):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id): raise HTTPException(404, "任务不存在。")
    with db() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=? AND created>?", (job_id, time.time() - MAX_AGE)).fetchone()
    if not row: raise HTTPException(404, "任务不存在或已过期。")
    return {"id": row["id"], "status": row["status"], "progress": row["progress"], "message": row["message"], "error": row["error"], "result": json.loads(row["result"]) if row["result"] else None}


class VideoInput(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
def create_job(body: VideoInput, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        public_url(body.url)
    except PipelineError as error:
        raise HTTPException(400, str(error))
    job_id = secrets.token_hex(16)
    enqueue(job_id, {"url": body.url})
    return get_job(job_id)


@app.get("/jobs/{job_id}")
def status(job_id: str, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return JSONResponse(get_job(job_id), headers={"Cache-Control": "no-store"})


@app.post("/uploads", status_code=202)
async def upload(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    ticket = upload_ticket(authorization)
    if file.size is not None and (file.size > MAX_BYTES or file.size != ticket["size"]):
        raise HTTPException(413, "文件大小与上传凭证不一致。")
    job_id = ticket["id"]
    # The user-supplied filename is only a display title, never a filesystem path.
    enqueue(job_id, {"title": Path(file.filename or "上传的音视频").name[:200]}, "uploading")
    directory = DATA / job_id
    directory.mkdir(exist_ok=True)
    try:
        size = 0
        with (directory / "upload.bin").open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > ticket["size"]: raise HTTPException(413, "上传文件超过声明的大小。")
                await asyncio.to_thread(output.write, chunk)
        if size != ticket["size"]: raise HTTPException(400, "上传不完整，请重试。")
        update(job_id, status="queued")
        return get_job(job_id)
    except Exception:
        update(job_id, status="failed", error="文件上传失败，请重新提交。")
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        await file.close()
