// Automated clip delivery: website <-> Railway trust + per-email clip allowances.
// Website signs job tickets with an Ed25519 key that lives ONLY in Netlify Blobs ("keys");
// Railway's completion callbacks are verified against Railway's public key, pinned on first fetch.
const crypto = require("crypto");

const API_BASE = process.env.CLIP_API_BASE || "https://api.takekash.com";
const PLAN_CLIPS = { free: 3, creator: 50, pro: 300 };      // free = lifetime; paid = per calendar month
const PER_JOB = { free: 3, creator: 5, pro: 10 };

async function siteKey(keys) {
  let rec = await keys.get("site-ed25519", { type: "json" });
  if (!rec) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const fresh = { priv: privateKey.export({ type: "pkcs8", format: "pem" }), pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") };
    await keys.setJSON("site-ed25519", fresh, { onlyIfNew: true });   // concurrent cold starts can't create two keys
    rec = await keys.get("site-ed25519", { type: "json", consistency: "strong" }).catch(() => null) || await keys.get("site-ed25519", { type: "json" }) || fresh;
  }
  return { privateKey: crypto.createPrivateKey(rec.priv), pub: rec.pub };
}

function makeTicket(privateKey, { jid, url, clips, cbk }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const t = { v: 1, jid, url, clips, iat, exp: iat + 600, nonce: crypto.randomBytes(12).toString("hex") };
  if (cbk) t.cbk = cbk;   // per-job callback key for the free GitHub Actions engine
  const raw = Buffer.from(JSON.stringify(t));
  return { ticket: raw.toString("base64"), sig: crypto.sign(null, raw, privateKey).toString("base64") };
}

async function railwayPub(keys, fetcher = fetch) {
  let pub = await keys.get("railway-pub", { type: "text" });
  if (!pub) {
    const r = await fetcher(`${API_BASE}/api/pubkey`);
    if (!r.ok) throw new Error(`pubkey fetch ${r.status}`);
    pub = (await r.json()).publicKey;
    if (!pub || Buffer.from(pub, "base64").length !== 32) throw new Error("bad railway pubkey");
    await keys.set("railway-pub", pub, { onlyIfNew: true });
    pub = (await keys.get("railway-pub", { type: "text" })) || pub;
  }
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

function verifyCallback(pubKey, body, now = Date.now()) {
  try {
    const raw = Buffer.from(String(body.payload), "base64");
    if (!crypto.verify(null, raw, pubKey, Buffer.from(String(body.sig), "base64"))) return null;
    const p = JSON.parse(raw.toString("utf8"));
    if (p.v !== 1 || !/^[a-z0-9]{8,40}$/.test(p.jid || "") || Math.abs(now / 1000 - p.iat) > 3 * 86400) return null;
    if (p.download && !String(p.download).startsWith(`${API_BASE}/api/customer-download/`)) return null;
    return p;
  } catch { return null; }
}

// ---- free engine (GitHub Actions) ----
// GITHUB_DISPATCH_TOKEN: fine-grained token with Contents: read & write on ENGINE_REPO only.
const ENGINE_REPO = process.env.ENGINE_REPO || "takekashusa-netizen/autoclip-pipeline";
const DOWNLOAD_PREFIX = process.env.DOWNLOAD_PREFIX || "";   // bucket origin, e.g. https://<bucket-host>/
const useGithubEngine = () => !!process.env.GITHUB_DISPATCH_TOKEN;
const newCallbackKey = () => crypto.randomBytes(32).toString("base64");

async function dispatchJob(ticket, fetcher = fetch) {
  const r = await fetcher(`https://api.github.com/repos/${ENGINE_REPO}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "takekash-site" },
    body: JSON.stringify({ event_type: "customer-job", client_payload: ticket }),
    signal: AbortSignal.timeout(15000),
  });
  return r.status === 204;
}

// Callback from the GitHub engine: HMAC-SHA256(per-job key) over the raw payload.
function peekJid(body) {
  try { const p = JSON.parse(Buffer.from(String(body.payload), "base64").toString("utf8")); return /^[a-z0-9]{8,40}$/.test(p.jid || "") ? p.jid : null; }
  catch { return null; }
}
function verifyMacCallback(cbk, body, now = Date.now()) {
  try {
    if (!cbk || typeof body.mac !== "string") return null;
    const raw = Buffer.from(String(body.payload), "base64");
    const want = crypto.createHmac("sha256", Buffer.from(cbk, "base64")).update(raw).digest("hex");
    if (body.mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(body.mac), Buffer.from(want))) return null;
    const p = JSON.parse(raw.toString("utf8"));
    if (p.v !== 1 || !/^[a-z0-9]{8,40}$/.test(p.jid || "") || Math.abs(now / 1000 - p.iat) > 3 * 86400) return null;
    if (p.download && !(DOWNLOAD_PREFIX && String(p.download).startsWith(DOWNLOAD_PREFIX))) return null;
    return p;
  } catch { return null; }
}

// ---- allowances ----
const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
async function planFor(accessStore, email) {
  const rec = await accessStore.get(`email:${email}`, { type: "json" });
  return rec && rec.active ? (rec.plan === "pro" ? "pro" : "creator") : "free";
}
// Each clip of allowance is a slot key that can only be CREATED once (If-None-Match: *),
// so parallel requests can never spend the same clip twice, and nothing depends on read etags.
const slotPrefix = (email, plan, m) => plan === "free" ? `slot:${email}:free:` : `slot:${email}:${m}:`;
async function reserve(quota, email, plan, owner = "job") {
  const m = month(), limit = PLAN_CLIPS[plan], want = PER_JOB[plan], prefix = slotPrefix(email, plan, m);
  const used = new Set((await quota.list({ prefix })).blobs.map((b) => b.key));
  const slots = [];
  for (let i = 1; i <= limit && slots.length < want; i++) {
    const key = prefix + i;
    if (used.has(key)) continue;
    const w = await quota.set(key, owner, { onlyIfNew: true });
    if (!w || w.modified !== false) slots.push(key);
  }
  return { clips: slots.length, slots, month: m, left: Math.max(0, limit - used.size - slots.length) };
}
async function refund(quota, slots = [], n = slots.length) {
  for (const key of slots.slice(slots.length - Math.max(0, n))) await quota.delete(key);
}

module.exports = { API_BASE, PLAN_CLIPS, PER_JOB, siteKey, makeTicket, railwayPub, verifyCallback, planFor, reserve, refund,
  useGithubEngine, newCallbackKey, dispatchJob, peekJid, verifyMacCallback };
