// Free channel stats: YouTube's public channel feed (no key, no paid tool) gives the latest 15 uploads with views.
// A scheduled run snapshots them so the Admin Hub can show growth over 1 and 7 days.
const CHANNELS = [
  { id: "UCdUw5G-PosX3PPJwpSWTFPA", name: "@gtaxzombies" },
  { id: "UCgyL1-D9rlQGSWnihVglFEg", name: "@takekashgaming" },
  { id: "UC80HlOkbHCQtUfZ_8MhuzQA", name: "TheRainTown" },
];
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, re) => { const m = xml.match(re); return m ? decode(m[1]).trim() : ""; };

function parseFeed(xml) {
  return String(xml).split("<entry>").slice(1).map((e) => ({
    id: tag(e, /<yt:videoId>([^<]+)</),
    title: tag(e, /<title>([^<]*)</).slice(0, 140),
    published: tag(e, /<published>([^<]+)</),
    short: /\/shorts\//.test(e),
    views: Number(tag(e, /<media:statistics views="(\d+)"/) || 0),
    likes: Number(tag(e, /<media:starRating count="(\d+)"/) || 0),
  })).filter((v) => /^[A-Za-z0-9_-]{6,20}$/.test(v.id));
}

async function snapshot(store, fetchImpl = fetch, now = new Date()) {
  const day = now.toISOString().slice(0, 10), out = [];
  for (const ch of CHANNELS) {
    try {
      const r = await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, { headers: { "User-Agent": "takekash-stats" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`feed ${r.status}`);
      const videos = parseFeed(await r.text());
      const snap = { channel: ch.id, at: now.toISOString(), videos: Object.fromEntries(videos.map((v) => [v.id, v.views])) };
      await store.setJSON(`snap:${ch.id}:${day}`, snap);           // one per day (latest wins)
      await store.setJSON(`latest:${ch.id}`, { ...snap, list: videos });
      out.push({ channel: ch.name, videos: videos.length });
    } catch (e) { out.push({ channel: ch.name, error: e.message }); }
  }
  return out;
}

// Views gained since a snapshot n days back, over the videos both snapshots know.
function gained(latest, old) {
  if (!latest || !old) return null;
  let g = 0; for (const [id, v] of Object.entries(latest.videos || {})) if (id in (old.videos || {})) g += Math.max(0, v - old.videos[id]);
  return g;
}

async function report(store, now = new Date()) {
  const ago = (n) => new Date(now - n * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const ch of CHANNELS) {
    const latest = await store.get(`latest:${ch.id}`, { type: "json" });
    if (!latest) { out.push({ name: ch.name, id: ch.id, empty: true }); continue; }
    const d1 = await store.get(`snap:${ch.id}:${ago(1)}`, { type: "json" }), d7 = await store.get(`snap:${ch.id}:${ago(7)}`, { type: "json" });
    const list = latest.list || [];
    out.push({ name: ch.name, id: ch.id, at: latest.at, recentViews: list.reduce((a, v) => a + v.views, 0), uploads: list.length,
      gained1d: gained(latest, d1), gained7d: gained(latest, d7),
      top: [...list].sort((a, b) => b.views - a.views).slice(0, 5), newest: list.slice(0, 5) });
  }
  return out;
}
module.exports = { CHANNELS, parseFeed, snapshot, report, gained };
