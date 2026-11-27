// One small fixed-window limiter for every public endpoint. Keys hash the visitor IP (never stored raw).
const crypto = require("crypto");
async function hit(store, bucket, who, max, windowMs, now = Date.now()) {
  const key = `rl:${bucket}:${crypto.createHash("sha256").update(String(who || "x")).digest("hex").slice(0, 24)}`;
  const rl = (await store.get(key, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > windowMs) { rl.start = now; rl.n = 0; }
  rl.n += 1; await store.setJSON(key, rl);
  return rl.n <= max;
}
const ipOf = (req, context) => (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "x";
module.exports = { hit, ipOf };
