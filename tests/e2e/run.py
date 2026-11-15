import json, os, re, subprocess, sys, time, urllib.request, urllib.parse, base64
SPORT, RPORT, EMAILS = "8871", "8872", "/tmp/e2e_emails.json"
if os.path.exists(EMAILS): os.remove(EMAILS)
site = subprocess.Popen(["node", "/home/claude/e2e/site_server.mjs", SPORT, RPORT, EMAILS], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
rail = subprocess.Popen([sys.executable, "/home/claude/e2e/railway_server.py", SPORT, RPORT], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
def req(method, url, body=None, headers=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp: return resp.status, resp.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
def emails(): return json.load(open(EMAILS)) if os.path.exists(EMAILS) else []
passed = 0
def ok(c, m):
    global passed
    if not c:
        print("FAIL:", m); site.kill(); rail.kill(); print(site.stdout.read() if site.poll() else ""); sys.exit(1)
    passed += 1; print("ok -", m)
for _ in range(60):
    try:
        if req("GET", f"http://127.0.0.1:{RPORT}/healthz")[0] == 200 and req("GET", f"http://127.0.0.1:{SPORT}/api/pubkey")[0] == 200: break
    except Exception: pass
    time.sleep(0.5)
S = f"http://127.0.0.1:{SPORT}"
s, b = req("POST", S + "/api/clip-request", {"url": "https://www.twitch.tv/videos/987654", "email": "Fan@Mail.com"})
ok(s == 200 and b"Confirm" in b, "request accepted; customer told to confirm by email")
conf = [m for m in emails() if m["to"] == "fan@mail.com"][-1]
ok("Confirm and start" in conf["html"], "confirmation email sent to the customer")
link = re.search(r'href="([^"]+/confirm\?[^"]+)"', conf["html"]).group(1)
q = urllib.parse.parse_qs(urllib.parse.urlparse(link.replace("&amp;", "&")).query)
jid, tok = q["id"][0], q["t"][0]
ok(req("POST", S + "/api/clip-confirm", {"id": jid, "t": tok[:-2] + "xx"})[0] == 403, "forged confirm token refused")
s, b = req("POST", S + "/api/clip-confirm", {"id": jid, "t": tok}); d = json.loads(b)
ok(s == 200 and d["status"] == "processing" and d["clips"] == 3, f"confirmed: job signed and accepted by the engine ({d})")
s, b = req("POST", S + "/api/clip-confirm", {"id": jid, "t": tok})
ok(json.loads(b)["status"] in ("processing", "delivered"), "double-click doesn't start a second job")
for _ in range(60):
    done = [m for m in emails() if m["to"] == "fan@mail.com" and "ready" in m["subject"]]
    if done: break
    time.sleep(0.5)
ok(done, "engine finished and the customer got a 'clips are ready' email")
dl = re.search(r'href="([^"]+customer-download[^"]+)"', done[0]["html"]).group(1).replace("&amp;", "&")
s, b = req("GET", dl)
ok(s == 200 and b[:2] == b"PK", "download link in the email returns the zip")
ok(req("GET", dl.replace("sig=", "sig=0"))[0] == 403, "edited download link refused")
ok("2 clips" in done[0]["subject"], "customer told the real count delivered (2)")
# forged callback from an attacker
fake = {"payload": base64.b64encode(json.dumps({"v":1,"jid":jid,"status":"done","delivered":3,"iat":int(time.time()),"download":"https://evil.com/x"}).encode()).decode(), "sig": base64.b64encode(b"x"*64).decode()}
ok(req("POST", S + "/api/clip-job-done", fake)[0] == 401, "forged completion callback refused")
# second request from same email: 1 free clip left (3 reserved, 2 delivered, 1 refunded)
s, b = req("POST", S + "/api/clip-request", {"url": "https://www.youtube.com/watch?v=abc", "email": "fan@mail.com"})
conf2 = [m for m in emails() if m["to"] == "fan@mail.com" and "Confirm" in m["subject"]][-1]
l2 = re.search(r'href="([^"]+/confirm\?[^"]+)"', conf2["html"]).group(1).replace("&amp;", "&")
q2 = urllib.parse.parse_qs(urllib.parse.urlparse(l2).query)
s, b = req("POST", S + "/api/clip-confirm", {"id": q2["id"][0], "t": q2["t"][0]})
ok(json.loads(b).get("clips") == 1, "undelivered clip was refunded: exactly 1 free clip left")
# engine rejects direct submissions not signed by the site
ok(req("POST", f"http://127.0.0.1:{RPORT}/api/customer-jobs", {"ticket": "eyJ2IjoxfQ==", "sig": "AAAA"})[0] == 401, "engine refuses unsigned job submissions")
ok(req("GET", f"http://127.0.0.1:{RPORT}/api/jobs", headers={"X-Forwarded-For": "1.1.1.1"})[0] == 401, "engine admin routes stay locked")
site.kill(); rail.kill()
print(f"\nEND-TO-END: ALL {passed} CHECKS PASS")
