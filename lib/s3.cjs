// Minimal S3 SigV4 (no SDK): presigned GET/PUT links and signed bucket requests, for the clip-storage bucket.
// Path-style URLs (https://endpoint/bucket/key) work with the Railway/Tigris bucket and any S3-compatible store.
const crypto = require("crypto");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split("/").map(enc).join("/");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const stamp = (now) => { const iso = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); return { amz: iso, day: iso.slice(0, 8) }; };
function signingKey(secret, day, region) { return hmac(hmac(hmac(hmac("AWS4" + secret, day), region), "s3"), "aws4_request"); }

function presign(cfg, method, key, { expires = 3600, now = Date.now(), query = {} } = {}) {
  const u = new URL(cfg.endpoint), host = u.host, region = cfg.region || "auto", { amz, day } = stamp(now);
  const path = `/${enc(cfg.bucket)}/${encPath(key)}`, scope = `${day}/${region}/s3/aws4_request`;
  const q = { ...query, "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amz, "X-Amz-Expires": String(expires), "X-Amz-SignedHeaders": "host" };
  const cq = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");
  const creq = [method, path, cq, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(creq)].join("\n");
  const sig = crypto.createHmac("sha256", signingKey(cfg.secretAccessKey, day, region)).update(sts).digest("hex");
  return `${u.protocol}//${host}${path}?${cq}&X-Amz-Signature=${sig}`;
}

// Signed bucket-level request (e.g. PUT ?cors). Returns fetch() args.
function signedRequest(cfg, method, subresource, body = "", { now = Date.now(), headers = {} } = {}) {
  const u = new URL(cfg.endpoint), host = u.host, region = cfg.region || "auto", { amz, day } = stamp(now);
  const path = `/${enc(cfg.bucket)}`, scope = `${day}/${region}/s3/aws4_request`, ph = sha(body);
  const h = { host, "x-amz-content-sha256": ph, "x-amz-date": amz, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  const names = Object.keys(h).sort();
  const creq = [method, path, `${enc(subresource)}=`, names.map((n) => `${n}:${String(h[n]).trim()}\n`).join(""), names.join(";"), ph].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(creq)].join("\n");
  const sig = crypto.createHmac("sha256", signingKey(cfg.secretAccessKey, day, region)).update(sts).digest("hex");
  const out = { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` };
  delete out.host;
  return [`${u.protocol}//${host}${path}?${subresource}`, { method, headers: out, body: body || undefined }];
}

function corsXml(origins) {
  return `<CORSConfiguration><CORSRule>${origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("")}` +
    `<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedHeader>*</AllowedHeader>` +
    `<ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
}
async function applyCors(cfg, origins, fetcher = fetch) {
  const body = corsXml(origins), md5 = crypto.createHash("md5").update(body).digest("base64");
  const [url, init] = signedRequest(cfg, "PUT", "cors", body, { headers: { "Content-MD5": md5, "Content-Type": "application/xml" } });
  const r = await fetcher(url, { ...init, signal: AbortSignal.timeout(15000) });
  return { ok: r.ok, status: r.status };
}

module.exports = { presign, signedRequest, applyCors, corsXml };
