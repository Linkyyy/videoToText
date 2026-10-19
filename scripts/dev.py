"""Start only this project's development processes with shared, ephemeral auth."""
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
web_env = {k: v for k, v in dotenv_values(ROOT / ".env.local").items() if v}
worker_env = {k: v for k, v in dotenv_values(ROOT / "worker/.env").items() if v}
if not os.getenv("WORKER_API_TOKEN") and web_env.get("WORKER_API_TOKEN") and worker_env.get("WORKER_API_TOKEN") and web_env["WORKER_API_TOKEN"] != worker_env["WORKER_API_TOKEN"]:
    sys.exit("WORKER_API_TOKEN differs between .env.local and worker/.env; use the same secret.")
config = {**web_env, **worker_env, **os.environ}
config["WORKER_API_TOKEN"] = config.get("WORKER_API_TOKEN") or secrets.token_urlsafe(32)
config["WORKER_URL"] = config.get("WORKER_URL") or "http://127.0.0.1:8000"
config["DATA_DIR"] = config.get("DATA_DIR") or str(ROOT / "worker/data")
if not Path(config["DATA_DIR"]).is_absolute():
    config["DATA_DIR"] = str((ROOT / "worker" / config["DATA_DIR"]).resolve())
processes = []


def stop(*_):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    if config["WORKER_URL"].rstrip("/") in ("http://127.0.0.1:8000", "http://localhost:8000"):
        processes.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--app-dir", str(ROOT / "worker"), "--host", "127.0.0.1", "--port", "8000", "--workers", "1"], cwd=ROOT, env=config, start_new_session=True))
    processes.append(subprocess.Popen(["npm", "run", "dev"], cwd=ROOT, env=config, start_new_session=True))
    print("Shijian development services starting. Credentials stay in process memory.", flush=True)
    while all(p.poll() is None for p in processes):
        time.sleep(.5)
    sys.exit(next((p.returncode for p in processes if p.poll() is not None), 1))
except KeyboardInterrupt:
    pass
finally:
    for process in processes:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    for process in processes:
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
