/* TakeKash chat widget — add <script src="/chat-widget.js" defer></script> to any page. No outside vendor. */
(() => {
  if (window.__tkChat) return; window.__tkChat = 1;
  const S = "tk_chat", P = new URLSearchParams(location.search);
  let conv = null; try { conv = JSON.parse(localStorage.getItem(S) || "null"); } catch {}
  if (P.get("c") && P.get("k")) { conv = { id: P.get("c"), key: P.get("k") }; try { localStorage.setItem(S, JSON.stringify(conv)); } catch {} }
  const css = `#tkc-b{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#2fe07c;color:#04210f;border:0;border-radius:99px;padding:12px 18px;font:700 15px 'Space Grotesk',Inter,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer}
#tkc-p{position:fixed;right:16px;bottom:76px;z-index:2147483000;width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 100px));display:flex;flex-direction:column;background:#131715;color:#eef3ef;border:1px solid #26302b;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.45 Inter,system-ui,sans-serif;overflow:hidden}
#tkc-p[hidden]{display:none}#tkc-p header{padding:12px 14px;border-bottom:1px solid #26302b;display:flex;justify-content:space-between;align-items:center}#tkc-p header b{font-family:'Space Grotesk',sans-serif}
#tkc-p .m{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}#tkc-p .q{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
#tkc-p .q.v{align-self:flex-end;background:#2fe07c;color:#04210f}#tkc-p .q.o{align-self:flex-start;background:#1a1f1c;border:1px solid #26302b}
#tkc-p form{padding:10px;border-top:1px solid #26302b;display:grid;gap:7px}#tkc-p input,#tkc-p textarea{width:100%;box-sizing:border-box;background:#1a1f1c;color:#eef3ef;border:1px solid #26302b;border-radius:10px;padding:9px;font:inherit;font-size:16px}
#tkc-p textarea{min-height:64px;resize:vertical}#tkc-p button.s{background:#2fe07c;color:#04210f;border:0;border-radius:10px;padding:10px;font:700 14px 'Space Grotesk',sans-serif;cursor:pointer}
#tkc-p .x{background:none;border:0;color:#93a39a;font-size:20px;cursor:pointer}#tkc-p .n{color:#93a39a;font-size:12px}#tkc-p .hp{position:absolute;left:-9999px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const b = document.createElement("button"); b.id = "tkc-b"; b.type = "button"; b.textContent = "💬 Chat with TakeKash"; b.setAttribute("aria-label", "Open chat");
  const p = document.createElement("div"); p.id = "tkc-p"; p.hidden = true; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "TakeKash chat");
  p.innerHTML = `<header><b>TakeKash</b><button class="x" type="button" aria-label="Close">×</button></header><div class="m"><div class="q o">Hey 👋 Questions about clips, plans or a custom job? Send a message and we'll reply here and by email.</div></div>
  <form><input class="hp" name="website" tabindex="-1" autocomplete="off"><input name="name" placeholder="Your name" autocomplete="name"><input name="email" type="email" placeholder="Your email" autocomplete="email" required><textarea name="message" placeholder="Your message" required></textarea><button class="s">Send</button><div class="n"></div></form>`;
  document.body.append(b, p);
  const $m = p.querySelector(".m"), f = p.querySelector("form"), note = p.querySelector(".n");
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let timer = null, seen = 0;
  const draw = (c) => {
    if (!c || !c.messages) return; seen = c.messages.length;
    $m.innerHTML = c.messages.map((x) => `<div class="q ${x.from === "visitor" ? "v" : "o"}">${esc(x.text)}</div>`).join("");
    $m.scrollTop = $m.scrollHeight;
    f.name.hidden = f.email.hidden = true; f.email.required = false;
  };
  const poll = async () => {
    if (!conv) return;
    const r = await fetch(`/api/chat?id=${encodeURIComponent(conv.id)}&key=${encodeURIComponent(conv.key)}`);
    if (r.status === 404) { conv = null; try { localStorage.removeItem(S); } catch {} f.name.hidden = f.email.hidden = false; f.email.required = true; return; }
    const c = await r.json(); if (c.messages && c.messages.length !== seen) draw(c);
  };
  const open = (on) => { p.hidden = !on; if (on) { poll(); timer = setInterval(() => !document.hidden && poll(), 8000); } else clearInterval(timer); };
  b.onclick = () => open(p.hidden); p.querySelector(".x").onclick = () => open(false);
  f.onsubmit = async (e) => {
    e.preventDefault(); note.textContent = "Sending…";
    const body = conv ? { id: conv.id, key: conv.key, message: f.message.value } : { name: f.name.value, email: f.email.value, message: f.message.value, website: f.website.value };
    const r = await fetch(conv ? "/api/chat/send" : "/api/chat/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const c = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = c.error || "Couldn't send. Try again."; return; }
    if (c.key) { conv = { id: c.id, key: c.key }; try { localStorage.setItem(S, JSON.stringify(conv)); } catch {} }
    f.message.value = ""; note.textContent = "Sent. We reply here and by email."; draw(c);
  };
  if (P.get("c") || location.hash === "#chat") open(true);
})();
