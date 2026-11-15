End-to-end delivery test: the real website functions (Node, local Blobs) and the real
Railway API (autoclip-pipeline/web, FastAPI) talking over HTTP; only the video pipeline is stubbed.
Expects both repos checked out side by side; edit the paths at the top of each file if needed.
  python3 tests/e2e/run.py
