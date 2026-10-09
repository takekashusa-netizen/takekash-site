import type { Context, Config } from "@netlify/functions";
import snapshot from "./snapshot.json";

// Admin-only data endpoint for takekash.com/admin.html.
// Nothing here is reachable without the ADMIN_KEY secret (set in
// Netlify: Site settings > Environment variables). The snapshot data
// itself is baked into this function at deploy time by
// lib/export_admin_snapshot.py in the autoclip-pipeline repo — see
// ADMIN-SETUP.txt for how to refresh it.

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const key = req.headers.get("x-admin-key") || url.searchParams.get("key");
  const expected = Netlify.env.get("ADMIN_KEY");

  if (!expected || !key || key !== expected) {
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
