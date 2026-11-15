// Drop-in for @netlify/blobs on our own server: same API the site uses (get, getWithMetadata,
// set, setJSON, delete, list, onlyIfNew/onlyIfMatch), stored as files on the /data volume.
// Writes per key are serialized in-process (single replica), so create-only is truly atomic.
const fs = require("fs"), fsp = fs.promises, path = require("path"), crypto = require("crypto");
const ROOT = path.join(process.env.DATA_DIR || "/data", "blobs");
const locks = new Map();
async function withLock(k, fn) {
  const prev = locks.get(k) || Promise.resolve();
  let release; const p = new Promise((r) => (release = r));
  const chain = prev.then(() => p); locks.set(k, chain);
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(k) === chain) locks.delete(k); }
}
const enc = (k) => Buffer.from(String(k)).toString("base64url");
const dec = (f) => Buffer.from(f, "base64url").toString();
const etagOf = (buf) => '"' + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32) + '"';

class Store {
  constructor(name) { this.dir = path.join(ROOT, String(name).replace(/[^a-zA-Z0-9_-]/g, "_")); fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 }); }
  file(k) { return path.join(this.dir, enc(k)); }
  async _read(k) { try { return await fsp.readFile(this.file(k)); } catch { return null; } }
  _conv(buf, type) {
    if (buf === null) return null;
    if (type === "json") return JSON.parse(buf.toString());
    if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    return buf.toString();
  }
  async get(k, o = {}) { return this._conv(await this._read(k), o.type || "text"); }
  async getWithMetadata(k, o = {}) { const b = await this._read(k); return b === null ? null : { data: this._conv(b, o.type || "text"), etag: etagOf(b), metadata: {} }; }
  async set(k, v, o = {}) {
    const buf = Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : String(v));
    return withLock(this.file(k), async () => {
      const cur = await this._read(k);
      if (o.onlyIfNew && cur !== null) return { modified: false };
      if (o.onlyIfMatch && (cur === null || etagOf(cur) !== o.onlyIfMatch)) return { modified: false };
      const tmp = this.file(k) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
      await fsp.writeFile(tmp, buf, { mode: 0o600 }); await fsp.rename(tmp, this.file(k));
      return { modified: true, etag: etagOf(buf) };
    });
  }
  async setJSON(k, v, o) { return this.set(k, JSON.stringify(v), o); }
  async delete(k) { return withLock(this.file(k), async () => { await fsp.rm(this.file(k), { force: true }); }); }
  async list(o = {}) {
    const files = (await fsp.readdir(this.dir).catch(() => [])).filter((f) => !f.endsWith(".tmp"));
    const blobs = files.map(dec).filter((k) => !o.prefix || k.startsWith(o.prefix)).map((key) => ({ key, etag: "" }));
    return { blobs, directories: [] };
  }
}
const stores = new Map();
function getStore(arg) { const name = typeof arg === "string" ? arg : arg && arg.name; if (!stores.has(name)) stores.set(name, new Store(name)); return stores.get(name); }
module.exports = { getStore, getDeployStore: getStore, connectLambda() {}, setEnvironmentContext() {} };
