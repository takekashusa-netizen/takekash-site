# Local stand-in for Railway: the real FastAPI app; only the heavy video pipeline is stubbed.
import os, sys, tempfile
SPORT, RPORT = sys.argv[1], sys.argv[2]
os.environ.update({"SITE_PUBKEY_URL": f"http://127.0.0.1:{SPORT}/api/pubkey", "SITE_CALLBACK_URL": f"http://127.0.0.1:{SPORT}/api/clip-job-done",
                   "PUBLIC_BASE_URL": f"http://127.0.0.1:{RPORT}", "CUSTOMER_DATA_DIR": tempfile.mkdtemp(), "ADMIN_TOKEN": "admin-secret"})
sys.path.insert(0, "/home/claude/autoclip-pipeline")
from web import main as M
def fake_pipeline(job, url, fmt, clip_length, clip_count, skip_music, content_type=""):
    os.makedirs(M.OUTPUTS, exist_ok=True)
    for i in range(2):   # pretend 2 of the requested clips met the quality bar
        open(os.path.join(M.OUTPUTS, f"{job}__clip{i+1:02d}.final.mp4"), "wb").write(b"\x00" * 64)
M._background_clip_run_from_url = fake_pipeline
import uvicorn
uvicorn.run(M.app, host="127.0.0.1", port=int(RPORT), log_level="warning")
