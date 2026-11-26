// node tests/site-hygiene.test.mjs — guards against the flaws found in the Nov 26 audit coming back
import fs from "fs"; import path from "path"; import assert from "assert";
const walk = (d, out = []) => { for (const f of fs.readdirSync(d)) { if (["node_modules", ".git", "tests"].includes(f)) continue; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const files = walk(".");
const read = (p) => fs.readFileSync(p, "utf8");
const pages = files.filter((p) => /\.(html|xml|txt)$/.test(p) || p === "_redirects");
const railway = pages.filter((p) => /up\.railway\.app/.test(read(p)));
assert.deepStrictEqual(railway, [], "pages still pointing at the retired Railway site: " + railway.join(", "));
const fns = files.filter((p) => p.startsWith("netlify/functions") && /\.(mjs|js|mts)$/.test(p));
const rawOwner = fns.filter((p) => /(process\.)?env\.OWNER_EMAIL(?!\s*\|\|)/.test(read(p).replace(/\/\/.*$/gm, "")));
assert.deepStrictEqual(rawOwner, [], "owner alerts must use access.ownerEmail(): " + rawOwner.join(", "));
const directMail = [...fns, ...files.filter((p) => p.startsWith("lib/") && p !== "lib/mail.cjs")].filter((p) => /api\.resend\.com/.test(read(p)));
assert.deepStrictEqual(directMail, [], "send email through lib/mail.cjs only: " + directMail.join(", "));
console.log(`site-hygiene: ok (${pages.length} pages, ${fns.length} functions)`);
