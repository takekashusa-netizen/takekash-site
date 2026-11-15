// GET /api/pubkey — the website's Ed25519 public key (the Railway engine pins it to verify job tickets).
import { getStore } from "@netlify/blobs";
import D from "../../lib/seo/delivery.cjs";
export default async () => {
  const { pub } = await D.siteKey(getStore("keys"));
  return new Response(JSON.stringify({ publicKey: pub, alg: "Ed25519" }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
};
export const config = { path: "/api/pubkey" };
