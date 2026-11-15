import type { Context, Config } from "@netlify/functions";
import snapshot from "./snapshot.json";
import access from "../../../lib/seo/access.cjs";

// Admin-only data endpoint for takekash.com/admin.html.
// Owner-only: requires the owner's signed sign-in token (see lib/seo/access.cjs). The snapshot data
// itself is baked into this function at deploy time by
// lib/export_admin_snapshot.py in the autoclip-pipeline repo — see
// ADMIN-SETUP.txt for how to refresh it.

export default async (req: Request, context: Context) => {
  // Owner sign-in only (OWNER_EMAIL via the emailed, signed link). The old shared
  // ADMIN_KEY is no longer accepted: its value was committed to this public repo.
  const auth = req.headers.get("authorization") || "";
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), process.env) : null;
  if (!email || !access.isOwner(email, process.env)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config: Config = {
  path: "/api/admin-data",
};
