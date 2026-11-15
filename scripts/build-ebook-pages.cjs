// Builds /ebooks (store) and one page per ebook (/ebooks/<sku>/) from lib/ebooks.cjs + lib/ebooks-copy.json.
// Run: node scripts/build-ebook-pages.cjs
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require("../lib/ebooks.cjs");
const COPY = require("../lib/ebooks-copy.json");
const SITE = process.env.SITE_URL || "https://site-production-000380c0.up.railway.app";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shared = fs.readFileSync(path.join(ROOT, "seo/index.html"), "utf8");
const CSS = shared.slice(shared.indexOf("<style>"), shared.indexOf("</style>") + 8);

// line-art icons (brass stroke), drawn for each profession
const ICON = {
  ecommerce: '<path d="M8 14h6l6 24h22l5-17H18"/><circle cx="23" cy="44" r="3"/><circle cx="38" cy="44" r="3"/>',
  "real-estate": '<path d="M10 28 32 10l22 18"/><path d="M16 24v24h32V24"/><path d="M28 48V36h8v12"/>',
  insurance: '<path d="M32 8 12 16v12c0 12 8 20 20 26 12-6 20-14 20-26V16z"/><path d="m24 30 6 6 11-12"/>',
  legal: '<path d="M32 10v38M20 48h24M14 18h36"/><path d="M14 18 8 32a6 6 0 0 0 12 0zM50 18l-6 14a6 6 0 0 0 12 0z"/>',
  events: '<circle cx="25" cy="36" r="11"/><circle cx="39" cy="36" r="11"/><path d="m28 12 4-5 4 5-4 6z"/>',
  fitness: '<path d="M14 24v16M20 20v24M44 20v24M50 24v16M20 32h24"/>',
  recruiting: '<circle cx="22" cy="20" r="6"/><circle cx="42" cy="20" r="6"/><path d="M12 44c0-8 4-12 10-12s10 4 10 12M32 44c0-8 4-12 10-12s10 4 10 12"/>',
  finance: '<path d="M10 50h44"/><path d="M16 44V32M28 44V24M40 44V28M52 44V14"/><path d="m14 26 12-10 12 6 14-12"/>',
  property: '<circle cx="22" cy="32" r="10"/><path d="M32 32h22M46 32v8M52 32v6"/><circle cx="22" cy="32" r="3"/>',
  medical: '<path d="M18 10v14a10 10 0 0 0 20 0V10"/><path d="M28 34v6a10 10 0 0 0 20 0v-6"/><circle cx="48" cy="30" r="4"/>',
  bundle: '<rect x="12" y="14" width="10" height="36" rx="1"/><rect x="24" y="10" width="10" height="40" rx="1"/><path d="m38 16 9-2 7 34-9 2z"/>',
};
const svg = (sku, size = 56) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[sku]}</svg>`;

const BOOK_CSS = `<style>
.b3d{perspective:1400px;display:flex;justify-content:center;padding:18px 0 26px}
.b3d .book{position:relative;width:var(--w,210px);aspect-ratio:3/4.1;transform-style:preserve-3d;transform:rotateY(-24deg) rotateX(4deg);transition:transform .5s ease}
.b3d:hover .book{transform:rotateY(-8deg) rotateX(2deg)}
.b3d .front{position:absolute;inset:0;border-radius:2px 6px 6px 2px;background:radial-gradient(120% 80% at 70% 10%,#22345a 0%,#14213d 45%,#0b1426 100%);box-shadow:inset 4px 0 6px #0007,inset -1px 0 0 #ffffff14;overflow:hidden;transform:translateZ(14px);color:#d8b765;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:9% 8% 8%}
.b3d .front:before{content:"";position:absolute;inset:5%;border:1.5px solid #c9a24a99;border-radius:2px;pointer-events:none}
.b3d .front:after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,#ffffff00 40%,#ffffff12 55%,#ffffff00 70%);pointer-events:none}
.b3d .kicker{font:700 9px Inter,sans-serif;letter-spacing:.22em;color:#c9a24a;text-align:center}
.b3d .medal{width:46%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;color:#f3dfa6;background:radial-gradient(circle at 35% 30%,#ffffff40,#0000 45%),radial-gradient(circle,var(--c) 0 58%,#8a6a25 60%,#e8cd84 66%,#9a7a33 72%,#5a4416 76%);box-shadow:0 10px 18px #0009,inset 0 -6px 10px #0006}
.b3d .medal svg{width:52%;height:52%;filter:drop-shadow(0 1px 0 #0008)}
.b3d .t{font:700 15px/1.12 'Space Grotesk',sans-serif;color:#f5ecd2;text-align:center;letter-spacing:.01em}
.b3d .sub{font:600 8.5px Inter,sans-serif;letter-spacing:.2em;color:#c9a24a;text-align:center;margin-top:4px}
.b3d .brand{font:700 8px Inter,sans-serif;letter-spacing:.24em;color:#c9a24a99}
.b3d .spine{position:absolute;top:0;bottom:0;left:0;width:28px;transform:rotateY(-90deg) translateZ(0) translateX(-14px);transform-origin:left;background:linear-gradient(90deg,#0a1222,#1a2a4a 60%,#0d172b);display:flex;align-items:center;justify-content:center}
.b3d .spine span{writing-mode:vertical-rl;transform:rotate(180deg);font:700 8px Inter,sans-serif;letter-spacing:.2em;color:#c9a24a;white-space:nowrap}
.b3d .pages{position:absolute;top:2%;bottom:2%;right:0;width:26px;transform:rotateY(90deg) translateZ(calc(var(--w,210px) - 13px)) translateX(13px);background:repeating-linear-gradient(90deg,#f4efe4 0 1px,#d9d2c3 1px 2px);border-radius:0 2px 2px 0}
.b3d .shadow{position:absolute;left:8%;right:-6%;bottom:-16px;height:22px;background:radial-gradient(ellipse at center,#000a,#0000 70%);filter:blur(4px);transform:translateZ(-20px)}
</style>`;
const book = (p, w = 210) => `<div class="b3d"><div class="book" style="--w:${w}px;--c:${p.color}"><div class="spine"><span>${esc(p.short.toUpperCase())} · AI PROMPT PACK</span></div>
<div class="front"><div class="kicker">${p.sku === "bundle" ? "COMPLETE LIBRARY · 100 PROMPTS" : `PACK ${String(p.n).padStart(2, "0")} · 10 PROMPTS`}</div><div class="medal">${svg(p.sku)}</div><div><div class="t">${esc(p.short)}</div><div class="sub">AI PROMPT PACK</div></div><div class="brand">TAKEKASH</div></div>
<div class="pages"></div><div class="shadow"></div></div></div>`;

const head = (title, desc, url, extra = "") => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">${extra}
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
${CSS}${BOOK_CSS}<style>.price{font:700 28px 'Space Grotesk',sans-serif}.strike{color:var(--mute);text-decoration:line-through;margin-left:8px}
.prod{display:grid;grid-template-columns:1fr 1.1fr;gap:22px;align-items:center}@media(max-width:720px){.prod{grid-template-columns:1fr}}
.incl{counter-reset:i;list-style:none;padding:0;margin:0;display:grid;gap:8px}.incl li{counter-increment:i;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px 10px 44px;position:relative}
.incl li:before{content:counter(i,decimal-leading-zero);position:absolute;left:12px;top:10px;font:700 13px 'Space Grotesk',sans-serif;color:#c9a24a}
.grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.tile{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:8px 14px 16px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column}
.tile:hover{border-color:var(--kash2)}.tile h3{font:700 16px 'Space Grotesk',sans-serif;margin:0 0 4px}.tile p{color:var(--mute);font-size:13px;margin:0 0 10px;flex:1}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.facts span{border:1px solid var(--line);border-radius:99px;padding:5px 10px;font-size:12px;color:var(--mute)}
.crumbs{font-size:13px;color:var(--mute);margin-bottom:8px}.crumbs a{color:var(--mute)}
</style></head><body><div class="wrap">
<header class="top"><a class="logo" href="/">Take<b>Kash</b></a><span style="display:flex;gap:8px"><a class="pill" href="/ebooks" style="text-decoration:none">Ebooks</a><a class="pill" href="/#get-clips" style="text-decoration:none;color:var(--kash);border-color:var(--kash2)">Get my clips</a></span></header>`;
const SCRIPT = `<script>
document.getElementById('yr').textContent=new Date().getFullYear();
try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'page_ebooks'}),keepalive:true}).catch(function(){});}catch(e){}
document.addEventListener('click',function(e){var b=e.target.closest('button[data-sku]');if(!b)return;var t=b.textContent;b.disabled=true;b.textContent='Opening checkout...';
fetch('/api/ebook-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:b.dataset.sku})}).then(function(r){return r.json();}).then(function(d){if(d.url)location.href=d.url;else throw new Error(d.error);})
.catch(function(err){var m=document.getElementById('msg');if(m)m.textContent=(err&&err.message)||'Checkout is unavailable right now.';b.disabled=false;b.textContent=t;});});
</script>`;
const foot = `<footer>© <span id="yr"></span> TakeKash · <a href="/ebooks">All ebooks</a> · <a href="/">Clips</a> · <a href="/seo">SEO Studio</a></footer></div>${SCRIPT}</body></html>\n`;
const GENERAL_FAQ = [["What format is it?", "A designed PDF ebook: illustrated cover, contents page and 10 prompts with fill-in fields. Opens on phone, tablet or computer."],
  ["Do I need ChatGPT Plus or Claude Pro?", "No. The prompts work with any AI chat tool, free or paid."], ["How do I get it?", "Right after checkout you land on your download page, and a copy of the links is emailed to you."], ["License", E.LICENSE]];

function packPage(p) {
  const c = COPY[p.sku], url = `${SITE}/ebooks/${p.sku}/`;
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Product", name: p.title, description: c.desc, brand: { "@type": "Brand", name: "TakeKash" }, category: "Ebook", offers: { "@type": "Offer", price: (p.price / 100).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock", url } },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ebooks", item: `${SITE}/ebooks` }, { "@type": "ListItem", position: 2, name: p.short, item: url }] } ] };
  const others = E.PACKS.filter((x) => x.sku !== p.sku).slice(0, 3);
  return head(`${p.title} (PDF Ebook) | TakeKash`, `${p.tagline} 10 done-for-you AI prompts for ${c.who.toLowerCase()} Instant PDF download, $${p.price / 100}.`, url, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`) + `
<nav class="crumbs"><a href="/ebooks">Ebooks</a> › ${esc(p.short)}</nav>
<section class="prod">${book(p, 230)}<div>
<h1 style="font-size:clamp(26px,5vw,38px);margin:0 0 8px">${esc(p.title)}</h1><p class="lede" style="margin-bottom:10px">${esc(p.tagline)}</p>
<div class="facts"><span>📄 PDF ebook</span><span>🧩 10 prompts</span><span>⚡ Instant download</span><span>🤖 Any AI tool</span></div>
<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span class="price">$${p.price / 100}</span><button class="btn" style="flex:0 0 auto" data-sku="${p.sku}">Buy now</button></div>
<div class="note" id="msg"></div><p class="note">Or get all 10 packs for $97 in <a href="/ebooks/bundle/">the complete library</a>.</p></div></section>
<section class="card" style="margin-top:18px"><h2 style="font:700 20px 'Space Grotesk',sans-serif;margin:0 0 10px">About this ebook</h2><p style="margin:0;line-height:1.65">${esc(c.desc)}</p>
<p class="note" style="font-size:14px;margin-top:12px"><b style="color:var(--ink)">Who it's for:</b> ${esc(c.who)}</p></section>
<section class="card" style="margin-top:14px"><h2 style="font:700 20px 'Space Grotesk',sans-serif;margin:0 0 12px">What's inside: 10 prompts</h2><ol class="incl">${c.includes.map((i) => `<li>${esc(i)}</li>`).join("")}</ol></section>
<section class="faq"><h2>Questions</h2>${c.faq.concat(GENERAL_FAQ).map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>
<section style="margin-top:26px"><h2 style="font:700 20px 'Space Grotesk',sans-serif">More packs</h2><div class="grid3">${others.map(tile).join("")}</div></section>
` + foot;
}
function tile(p) {
  return `<a class="tile" href="/ebooks/${p.sku}/">${book(p, 150)}<h3>${esc(p.short)}</h3><p>${esc(p.tagline)}</p><span style="display:flex;justify-content:space-between;align-items:center"><b style="font:700 18px 'Space Grotesk',sans-serif">$${p.price / 100}</b><span class="pill" style="color:var(--kash);border-color:var(--kash2)">View</span></span></a>`;
}
function bundlePage() {
  const p = E.BUNDLE, url = `${SITE}/ebooks/bundle/`;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.tagline, brand: { "@type": "Brand", name: "TakeKash" }, offers: { "@type": "Offer", price: "97.00", priceCurrency: "USD", availability: "https://schema.org/InStock", url } };
  return head(`${p.title} | TakeKash`, "All 10 AI prompt pack ebooks (100 prompts) for real estate, insurance, legal, events, fitness, recruiting, finance, property management, e-commerce and medical admin. $97.", url, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`) + `
<nav class="crumbs"><a href="/ebooks">Ebooks</a> › Complete library</nav>
<section class="prod">${book(p, 230)}<div><h1 style="font-size:clamp(26px,5vw,38px);margin:0 0 8px">${esc(p.title)}</h1>
<p class="lede">Every pack, bundled. For agencies, VAs and consultants who serve clients across industries and want one library in the same ready-to-adapt format.</p>
<div class="facts"><span>📚 10 PDF ebooks</span><span>🧩 100 prompts</span><span>⚡ Instant download</span></div>
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span class="price">$97</span><span class="strike">$270</span><button class="btn" style="flex:0 0 auto" data-sku="bundle">Get all 10</button></div><div class="note" id="msg"></div></div></section>
<section style="margin-top:22px"><h2 style="font:700 20px 'Space Grotesk',sans-serif">Included</h2><div class="grid3">${E.PACKS.map(tile).join("")}</div></section>
<section class="faq"><h2>Questions</h2>${GENERAL_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>` + foot;
}
function storePage() {
  return head("AI Prompt Pack Ebooks for Professionals | TakeKash", "Done-for-you AI prompt pack ebooks for 10 professions. Illustrated PDFs, 10 prompts each, instant download. $27 each or all 10 for $97.", `${SITE}/ebooks`) + `
<h1>Done-for-you <em>AI prompt packs</em>.</h1>
<p class="lede">Illustrated PDF ebooks with 10 fill-in-the-blank prompts each, built for one profession. Works with any AI chat tool. Instant download after checkout.</p>
<a class="tile" href="/ebooks/bundle/" style="border-color:var(--kash2);margin-bottom:18px"><div class="prod">${book(E.BUNDLE, 190)}<div><div style="font:700 12px Inter,sans-serif;letter-spacing:.14em;color:#c9a24a">BEST VALUE</div><h2 style="font:700 24px/1.15 'Space Grotesk',sans-serif;margin:6px 0">All 10 packs: the complete library</h2><p>100 prompts across 10 professions.</p><span class="price">$97</span><span class="strike">$270</span></div></div></a>
<div class="grid3">${E.PACKS.map(tile).join("")}</div>
<section class="faq"><h2>Questions</h2>${GENERAL_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>` + foot;
}
fs.writeFileSync(path.join(ROOT, "ebooks/index.html"), storePage());
for (const p of [...E.PACKS]) { fs.mkdirSync(path.join(ROOT, "ebooks", p.sku), { recursive: true }); fs.writeFileSync(path.join(ROOT, "ebooks", p.sku, "index.html"), packPage(p)); }
fs.mkdirSync(path.join(ROOT, "ebooks/bundle"), { recursive: true }); fs.writeFileSync(path.join(ROOT, "ebooks/bundle/index.html"), bundlePage());
console.log(`Built store + ${E.PACKS.length} ebook pages + bundle page`);
