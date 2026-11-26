// Verifies a GitHub Actions OIDC token, so the clip engine can prove "I am the customer-job workflow on
// main in autoclip-pipeline" without any shared secret. GitHub signs the token; we check it against
// GitHub's published keys and pin every claim that matters.
const crypto = require("crypto");

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "takekash-engine";
const REPO = process.env.ENGINE_REPO || "takekashusa-netizen/autoclip-pipeline";
const WORKFLOW = `${REPO}/.github/workflows/customer-job.yml@refs/heads/main`;
const EVENTS = new Set(["schedule", "workflow_dispatch", "repository_dispatch"]);   // never pull_request (forks)

let jwks = null, jwksAt = 0;
async function keys(fetcher, force = false) {
  if (!force && jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetcher(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  jwks = (await r.json()).keys; jwksAt = Date.now();
  return jwks;
}

const part = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

async function verify(token, { fetcher = fetch, now = Date.now() } = {}) {
  if (typeof token !== "string" || token.length > 8000) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header, claims;
  try { header = part(h); claims = part(p); } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  let jwk = (await keys(fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await keys(fetcher, true)).find((k) => k.kid === header.kid);   // GitHub rotated keys
  if (!jwk) return null;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) return null;
  const t = now / 1000;
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
  if (!(claims.exp > t) || (claims.nbf && claims.nbf > t + 60) || !(claims.iat < t + 60)) return null;
  if (claims.repository !== REPO || claims.ref !== "refs/heads/main" || claims.job_workflow_ref !== WORKFLOW) return null;
  if (!EVENTS.has(claims.event_name)) return null;
  return claims;
}

module.exports = { ISSUER, AUDIENCE, REPO, WORKFLOW, verify };
