// Builds the free SEO topic pages (/seo/<slug>/), sitemap.xml and robots.txt from the same engine.
// Run after editing TOPICS or the engine:  node scripts/build-seo-pages.cjs
const fs = require("fs"), path = require("path");
const E = require("../lib/seo/engine.cjs");
const SITE = process.env.SITE_URL || "https://takekash.netlify.app"; // switch to the final domain when it serves this site
const YEAR = new Date().getFullYear();
const ROOT = path.join(__dirname, "..");

// [slug, display name, engine topic, category]
const TOPICS = [
  ["warzone","Warzone","warzone highlights","gaming"],["modern-warfare-4","Modern Warfare 4","mw4 highlights","gaming"],
  ["black-ops","Black Ops","black ops highlights","gaming"],["call-of-duty","Call of Duty","call of duty clips","gaming"],
  ["apex-legends","Apex Legends","apex legends highlights","gaming"],["nba-2k27","NBA 2K27","nba 2k27 highlights","gaming"],
  ["fortnite","Fortnite","fortnite highlights","gaming"],["gta-6","GTA 6","gta 6 gameplay","gaming"],
  ["minecraft","Minecraft","minecraft builds","gaming"],["valorant","Valorant","valorant clips","gaming"],
  ["roblox","Roblox","roblox funny moments","gaming"],["ea-fc","EA FC","ea fc ultimate team","gaming"],
  ["madden","Madden","madden highlights","gaming"],["rocket-league","Rocket League","rocket league highlights","gaming"],
  ["twitch-streamer","Twitch Streamers","twitch streamer clips","creator"],["stream-overlay","Stream Overlays","stream overlay setup","creator"],
  ["obs-setup","OBS Setup","obs setup guide","creator"],["gaming-clips","Gaming Clips","gaming clips","gaming"],
  ["ai-clipping","AI Clipping","ai clipping tool review","tech"],["video-editing","Video Editing","video editing tips","creator"],
  ["podcast-clips","Podcast Clips","podcast clips","podcast"],["youtube-growth","YouTube Growth","grow on youtube tips","creator"],
  ["nba-highlights","NBA Highlights","nba highlights","sports"],["football-highlights","Football Highlights","nfl highlights","sports"],
  ["home-workout","Home Workouts","home workout tips","fitness"],["easy-recipes","Easy Recipes","easy dinner recipe","food"],
  ["makeup-tutorial","Makeup Tutorials","makeup tutorial","beauty"],["sneakers","Sneakers","sneaker review","beauty"],
  ["day-trading","Day Trading","day trading tips","finance"],["personal-finance","Personal Finance","personal finance tips","finance"],
  ["car-reviews","Car Reviews","car review","auto"],["home-security","Home Security Cameras","home security camera review","home"],
  ["amazon-finds","Amazon Finds","amazon finds review","home"],["travel-vlog","Travel Vlogs","travel vlog","travel"],
  ["comedy-skits","Comedy Skits","funny skits","comedy"],["music-producer","Music Producers","music producer beats","music"],
  ["small-business","Small Business","small business tips","business"],["side-hustle","Side Hustles","side hustle tips","business"],
  ["fiverr","Fiverr Sellers","fiverr gig tips","business"],["product-review","Product Reviews","product review","home"],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shared = fs.readFileSync(path.join(ROOT, "seo/index.html"), "utf8");
const CSS = shared.slice(shared.indexOf("<style>"), shared.indexOf("</style>") + 8);
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';
const extraCss = `<style>.list{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}.list li{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 9px;font-size:13px}
.blurred li:nth-child(n+4){filter:blur(4px);user-select:none}.crumbs{font-size:13px;color:var(--mute);margin-bottom:6px}.crumbs a{color:var(--mute)}
.rel{display:flex;flex-wrap:wrap;gap:8px}.rel a{border:1px solid var(--line);border-radius:99px;padding:6px 12px;text-decoration:none;color:var(--ink);font-size:14px}
.cta{display:inline-block;text-decoration:none;text-align:center}ol.t{margin:0;padding-left:20px}ol.t li{margin:4px 0}</style>`;

function page([slug, name, topic, cat]) {
  const o = E.generate({ topic, category: cat, platform: "all", seed: 11 });
  const yt = o.results.youtube, tk = o.results.tiktok, tw = o.results.twitch, T = o.tiers;
  const url = `${SITE}/seo/${slug}/`;
  const title = `${name} Tags, Hashtags & Titles (${YEAR}) | TakeKash`;
  const desc = `The best ${name} tags, hashtags and title ideas for YouTube, TikTok, Instagram and Twitch in ${YEAR}, sized to each platform's limits.`.slice(0, 158);
  const related = TOPICS.filter((t) => t[3] === cat && t[0] !== slug).slice(0, 6);
  const more = TOPICS.filter((t) => t[3] !== cat).sort((a, b) => (a[0] + slug).length % 7 - (b[0] + slug).length % 7).slice(0, 6);
  const faq = [
    [`What are the best ${name} tags?`, `Start with exact-match tags like ${T.core.slice(0, 3).join(", ")}, then add related searches like ${T.similar.slice(0, 3).join(", ")} and one broad tag like ${T.broad[0]} to reach the whole ${o.analysis.categoryLabel.toLowerCase()} audience.`],
    [`How many hashtags should I use for ${name} posts?`, `Instagram allows up to 5 hashtags per post. TikTok works best with 3 to 5. YouTube shows the first 3 above the title and ignores hashtags if a video has more than 15.`],
  ];
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "SEO Studio", item: `${SITE}/seo` }, { "@type": "ListItem", position: 2, name, item: url }] },
    { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) } ] };
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}"><meta name="robots" content="index, follow">
<meta property="og:type" content="article"><meta property="og:site_name" content="TakeKash"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary"><script type="application/ld+json">${JSON.stringify(ld)}</script>
${FONTS}${CSS}${extraCss}</head><body><div class="wrap">
<header class="top"><a class="logo" href="/">Take<b>Kash</b></a><a class="pill" href="/seo" style="text-decoration:none">SEO Studio</a></header>
<nav class="crumbs"><a href="/seo">SEO Studio</a> › ${esc(name)}</nav>
<h1>${esc(name)} <em>tags, hashtags</em> &amp; titles for ${YEAR}</h1>
<p class="lede">Ready-to-use ${esc(name)} tags and title ideas, built for how YouTube, TikTok, Instagram and Twitch rank content right now. Copy the starter set below, or generate a set tailored to your exact video.</p>
<div class="results">
<section class="card"><h2 style="font:700 18px Space Grotesk,sans-serif;margin:0 0 10px">Title ideas</h2><ol class="t">${li(yt.titles.slice(0, 3).map((t) => t.text))}</ol>
<p class="note">Keep the keyword in the first 40 characters. YouTube search shows about 60 to 70.</p></section>
<section class="card"><h2 style="font:700 18px Space Grotesk,sans-serif;margin:0 0 10px">Core ${esc(name)} tags</h2><ul class="list">${li(T.core.slice(0, 6))}</ul>
<h3 style="font-size:13px;color:var(--mute);margin:14px 0 8px">Broad reach tags</h3><ul class="list">${li(T.broad.slice(0, 6))}</ul>
<h3 style="font-size:13px;color:var(--mute);margin:14px 0 8px">Similar &amp; long-tail tags (members)</h3><ul class="list blurred">${li(T.similar.slice(0, 3).concat(T.longtail.slice(0, 5)))}</ul></section>
<section class="card"><h2 style="font:700 18px Space Grotesk,sans-serif;margin:0 0 10px">Hashtags</h2><p class="note" style="margin-top:0">TikTok / Instagram (5 max on Instagram)</p><ul class="list">${li(tk.hashtags)}</ul>
<h3 style="font-size:13px;color:var(--mute);margin:14px 0 8px">Twitch stream tags</h3><ul class="list">${li(tw.twitchTags.slice(0, 6))}</ul></section>
<section class="card upsell"><h2>Get a set made for your exact video</h2><ul><li>Titles, descriptions and tags for every platform at once</li><li>The full 500-character YouTube tag set, with all 4 tag tiers</li></ul>
<a class="btn cta" href="/seo?topic=${encodeURIComponent(topic)}">Try it free: 3 runs a week</a></section>
<section class="card"><h2 style="font:700 18px Space Grotesk,sans-serif;margin:0 0 10px">FAQ</h2>${faq.map(([q, a]) => `<h3 style="font-size:15px;margin:12px 0 4px">${esc(q)}</h3><p class="note" style="font-size:14px">${esc(a)}</p>`).join("")}</section>
<section class="card"><h2 style="font:700 18px Space Grotesk,sans-serif;margin:0 0 10px">Related</h2><div class="rel">${related.concat(more).map((t) => `<a href="/seo/${t[0]}/">${esc(t[1])}</a>`).join("")}</div></section>
</div><footer>© ${YEAR} TakeKash · <a href="/seo">SEO Studio</a> · <a href="/">TakeKash</a></footer></div></body></html>
`;
}

for (const t of TOPICS) { const d = path.join(ROOT, "seo", t[0]); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "index.html"), page(t)); }

// Topic directory on /seo (between markers, so re-runs replace it)
const dirHtml = `<!--TOPICS-->\n  <section class="faq"><h2>Popular tag sets</h2><div class="rel" style="display:flex;flex-wrap:wrap;gap:8px">${TOPICS.map((t) => `<a href="/seo/${t[0]}/" style="border:1px solid var(--line);border-radius:99px;padding:6px 12px;text-decoration:none;color:var(--ink);font-size:14px">${esc(t[1])}</a>`).join("")}</div></section>\n  <!--/TOPICS-->`;
let seo = shared.replace(/<!--TOPICS-->[\s\S]*?<!--\/TOPICS-->/, "");
seo = seo.replace('  <footer>', dirHtml + '\n  <footer>');
seo = seo.replace(/https:\/\/takekash\.com\/seo/g, `${SITE}/seo`); // canonical/OG point at where the page actually lives
fs.writeFileSync(path.join(ROOT, "seo/index.html"), seo);

const today = new Date().toISOString().slice(0, 10);
const urls = ["/", "/seo"].concat(TOPICS.map((t) => `/seo/${t[0]}/`));
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
fs.writeFileSync(path.join(ROOT, "robots.txt"), `User-agent: *\nDisallow: /admin.html\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Built ${TOPICS.length} topic pages + sitemap (${urls.length} URLs)`);
