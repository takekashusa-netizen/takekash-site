// Verifies a Google identity token from the TakeKash Gmail sender (Apps Script running in the owner's
// Google account). No shared secret: Google signs the token; we require the owner's verified email and pin
// the sender's client id (aud) on first use, so a token minted for any other app can't be replayed here.
const crypto = require("crypto");

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
let jwks = null, jwksAt = 0;

async function keys(fetcher, force) {
  if (!force && jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetcher(CERTS, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`google certs ${r.status}`);
  jwks = (await r.json()).keys; jwksAt = Date.now();
  return jwks;
}
const part = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// pinStore: Blobs store holding "gmail-relay-aud". ownerEmail: required email.
async function verify(token, { ownerEmail, pinStore, fetcher = fetch, now = Date.now() }) {
  if (typeof token !== "string" || token.length > 8000) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header, c;
  try { header = part(h); c = part(p); } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  let jwk = (await keys(fetcher)).find((k) => k.kid === header.kid) || (await keys(fetcher, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  if (!crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"))) return null;
  const t = now / 1000;
  if (!ISSUERS.has(c.iss) || !(c.exp > t) || !(c.iat < t + 60)) return null;
  if (!c.email_verified || String(c.email || "").toLowerCase() !== ownerEmail) return null;
  if (typeof c.aud !== "string" || !c.aud.endsWith(".apps.googleusercontent.com")) return null;
  const pinned = await pinStore.get("gmail-relay-aud", { type: "text" });
  if (pinned && pinned !== c.aud) return null;
  if (!pinned) await pinStore.set("gmail-relay-aud", c.aud, { onlyIfNew: true });   // trust on first use, then fixed
  return c;
}

module.exports = { verify };
