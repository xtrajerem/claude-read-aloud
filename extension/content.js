(() => {
  if (window.__craLoaded) return;
  window.__craLoaded = true;

  const ON_CLAUDE = location.hostname === "claude.ai";
  const REPLY_SEL = ".font-claude-response, [data-testid='assistant-message'], [data-is-streaming]";
  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote, dt, dd, figcaption";
  const SKIP_SEL = "button, svg, style, script, noscript, textarea, input, select, [aria-hidden='true'], [hidden], .sr-only, #cra-host";
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const MAX_LEN = 240; // long sentences are split so voices don't cut off

  const DEFAULTS = {
    voice: "", voiceFr: "", voiceByLang: {}, seenLangs: [], siteLang: {}, autoLang: true, rate: 1, pitch: 1,
    hlSentence: true, hlWord: true, autoContrast: true,
    sentenceColor: "#ffd24d", sentenceAlpha: 0.3, wordBg: "#ff9f1c", wordText: "#000000",
    followAlong: true, showBlockButtons: true, blockMode: "block",
    autoRead: false, skipCode: true,
    blocksEverywhere: true, disabledSites: [],
  };
  const SITE = location.hostname;
  const NOISE_SEL = "nav, footer, aside, form, menu, [role='navigation'], [role='contentinfo'], [role='menu'], [role='toolbar'], [contenteditable=''], [contenteditable='true'], [aria-hidden='true']";
  const HEAD_SEL = "h1, h2, h3, h4, h5, h6, [role='heading']";
  // Page chrome (menus, footers, site header). An article's own <header> (title/byline) is kept.
  function isNoise(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(NOISE_SEL)) return true;
    const hd = el.closest("header, [role='banner']");
    return !!(hd && !hd.closest("article, main, [role='main']"));
  }
  const levelOf = (h) => (/^H[1-6]$/.test(h.tagName) ? +h.tagName[1] : +(h.getAttribute("aria-level") || 2));
  const siteOff = () => (S.disabledSites || []).includes(SITE);
  let S = { ...DEFAULTS };

  const hasHL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
  const sentSeg = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const wordSeg = new Intl.Segmenter(undefined, { granularity: "word" });
  const safe = (fn) => { try { return fn(); } catch { return null; } };

  // ================= colour utilities =================
  const cvs = document.createElement("canvas"); cvs.width = cvs.height = 1;
  const cx = cvs.getContext("2d", { willReadFrequently: true });
  function toRGBA(str) {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (f, b, a) => ({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const rgba = (c, a) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`;
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const BLACK = { r: 0, g: 0, b: 0 }, WHITE = { r: 255, g: 255, b: 255 };

  function effectiveBg(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = toRGBA(getComputedStyle(e).backgroundColor);
      if (c.a > 0.5) return c;
    }
    return { ...WHITE, a: 1 };
  }

  const DARK_ACCENTS = ["#ffd24d", "#5ee6ff", "#a6f06b", "#ff8ad8", "#ffb15e"];
  const LIGHT_ACCENTS = ["#1f6feb", "#c2185b", "#7b2ff7", "#0f8a5f", "#d14900"];
  const colorCache = new Map();
  // Picks an accent that stands out from the page background and differs from the text colour,
  // then fades the sentence tint until the text on it still meets WCAG 4.5:1.
  function autoColors(el) {
    const bg = effectiveBg(el), fg = toRGBA(getComputedStyle(el).color);
    const key = hex(bg) + hex(fg);
    if (colorCache.has(key)) return colorCache.get(key);
    const dark = lum(bg) < 0.25;
    let best = null, bestScore = -1;
    for (const h of dark ? DARK_ACCENTS : LIGHT_ACCENTS) {
      const a = toRGBA(h);
      const score = contrast(a, bg) + 0.5 * (dist(a, fg) / 441);
      if (score > bestScore) { bestScore = score; best = a; }
    }
    let alpha = dark ? 0.32 : 0.22;
    while (alpha > 0.08 && contrast(fg, blend(best, bg, alpha)) < 4.5) alpha -= 0.02;
    const res = {
      bg, fg,
      sentenceBg: rgba(best, alpha.toFixed(2)),
      wordBg: hex(best),
      wordText: contrast(BLACK, best) >= contrast(WHITE, best) ? "#000000" : "#ffffff",
    };
    colorCache.set(key, res);
    return res;
  }
  function colorsFor(el) {
    el = el || document.body;
    if (S.autoContrast) return autoColors(el);
    return {
      bg: effectiveBg(el), fg: toRGBA(getComputedStyle(el).color),
      sentenceBg: rgba(toRGBA(S.sentenceColor), S.sentenceAlpha), wordBg: S.wordBg, wordText: S.wordText,
    };
  }

  const hlStyle = document.createElement("style");
  hlStyle.id = "cra-hl-style";
  (document.head || document.documentElement).appendChild(hlStyle);
  let lastCss = "", lastColorEl = null;
  function applyColors(el) {
    lastColorEl = el;
    const c = colorsFor(el);
    const css = `::highlight(cra-sentence){background-color:${c.sentenceBg};}
::highlight(cra-word){background-color:${c.wordBg};color:${c.wordText};}`;
    if (css !== lastCss) { hlStyle.textContent = css; lastCss = css; }
  }

  // ================= text extraction =================
  // A "unit" is the text of one block (paragraph, list item, ...) plus a map back to its DOM text nodes,
  // so any character offset can be turned into a Range for highlighting.
  function buildUnits(root, range, forceCode) {
    const units = [];
    let cur = null, lastPre = null;
    const skipCode = S.skipCode && !forceCode && !root.closest("pre");
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (range && !range.intersectsNode(n)) continue;
      const p = n.parentElement;
      if (!p || p.closest(SKIP_SEL)) continue;
      if (!ON_CLAUDE && !isNoise(root) && isNoise(p)) continue;
      if (skipCode) {
        const pre = p.closest("pre");
        if (pre) {
          if (pre !== lastPre) { lastPre = pre; units.push({ spoken: SKIPPED.en, skipped: true, owner: pre }); cur = null; }
          continue;
        }
      }
      let s = 0, e = n.nodeValue.length;
      if (range) {
        if (n === range.startContainer) s = range.startOffset;
        if (n === range.endContainer) e = range.endOffset;
      }
      if (e <= s) continue;
      const ob = p.closest(BLOCK_SEL);
      const owner = ob && root.contains(ob) ? ob : root;
      if (!cur || cur.owner !== owner) { cur = { owner, text: "", map: [] }; units.push(cur); }
      cur.map.push({ node: n, nodeStart: s, len: e - s, textStart: cur.text.length });
      cur.text += n.nodeValue.slice(s, e).replace(/\s/g, " "); // 1:1 so offsets stay valid
    }
    return units.filter((u) => u.spoken || u.text.trim());
  }

  function sentencesOf(unit) {
    if (unit.spoken) return [{ unit, spoken: unit.spoken }];
    const out = [], t = unit.text;
    for (const seg of sentSeg.segment(t)) {
      let s = seg.index, e = s + seg.segment.length;
      while (s < e && t[s] === " ") s++;
      while (e > s && t[e - 1] === " ") e--;
      while (e - s > MAX_LEN) {
        const slice = t.slice(s, s + MAX_LEN);
        let cut = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf("; "), slice.lastIndexOf(": "));
        if (cut < MAX_LEN / 3) cut = slice.lastIndexOf(" ");
        cut = cut <= 0 ? MAX_LEN : cut + 1;
        out.push({ unit, start: s, end: s + cut });
        s += cut;
        while (s < e && t[s] === " ") s++;
      }
      if (e > s && /[\p{L}\p{N}]/u.test(t.slice(s, e))) out.push({ unit, start: s, end: e });
    }
    return out;
  }

  function rangeFor(unit, s, e) {
    let r = null;
    for (const m of unit.map) {
      const mEnd = m.textStart + m.len;
      if (!r && s < mEnd) { r = document.createRange(); r.setStart(m.node, m.nodeStart + s - m.textStart); }
      if (r && e <= mEnd) { r.setEnd(m.node, m.nodeStart + e - m.textStart); return r; }
    }
    return r;
  }
  const wordEnd = (t, i) => { const m = /^[\p{L}\p{N}\p{M}'’-]+/u.exec(t.slice(i)); return i + (m ? m[0].length : 1); };

  // Which heading should get a section 🔊 button?
  function readableHeading(target) {
    const h = target.closest && target.closest(HEAD_SEL);
    if (!h || h === host || !h.textContent.trim()) return null;
    if (ON_CLAUDE) return h.closest(REPLY_SEL) ? h : null;
    if (!S.blocksEverywhere || siteOff() || isNoise(h)) return null;
    return h;
  }
  const containerOf = (block) =>
    block.closest(REPLY_SEL) || block.closest("article, main, [role='main']") || document.body;

  // ================= language detection =================
  const W = (words) => new RegExp(`(?<![\\p{L}])(${words})(?![\\p{L}])`, "giu"); // \b is ASCII-only, breaks on "tá", "où"
  const STOP = {
    fr: W("le|la|les|des|du|une|est|et|pour|dans|que|qui|pas|sur|avec|vous|nous|sont|cette|mais|plus|aux|ces|être|été|où|très|aussi"),
    en: W("the|and|is|are|of|to|in|that|for|with|this|you|was|not|on|be|it|have|from|which|will|can|or|by|they"),
    ga: W("agus|tá|bhí|níl|atá|freisin|chun|nach|agam|bhfuil|dtí|ach|leis|sé|sí|mé|tú|seo|ar|ag|leat|orm|dom|anseo|inniu|conas|cén"),
  };
  // Fallback when the browser detector is unavailable or unsure: highest stop-word score wins by a margin.
  function heuristicLang(t) {
    const sc = Object.entries(STOP).map(([l, re]) => [l, (t.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
    return sc[0][1] >= 2 && sc[0][1] > sc[1][1] * 1.2 ? sc[0][0] : null;
  }
  // Browser's built-in language detector (CLD), with a stop-word fallback for short or unclear text.
  function detectLang(text) {
    text = text.slice(0, 3000);
    return new Promise((res) => {
      try {
        chrome.i18n.detectLanguage(text, (r) => {
          const langs = (!chrome.runtime.lastError && r && r.languages) || [];
          const top = langs.sort((a, b) => b.percentage - a.percentage)[0];
          if (top && top.language !== "und" && (r.isReliable || top.percentage >= 70)) res(top.language.split("-")[0].toLowerCase());
          else res(heuristicLang(text));
        });
      } catch { res(heuristicLang(text)); }
    });
  }
  const domLang = (el) => { const l = el && el.closest && el.closest("[lang]"); return l ? l.lang.split("-")[0].toLowerCase() : null; };
  async function assignLangs(units) {
    const todo = units.filter((u) => !u.lang);
    if (!todo.length) return;
    const doc = (await detectLang(todo.map((u) => u.text || "").join(" "))) || domLang(todo[0].owner) || "en";
    for (const u of todo.slice(0, 300)) {
      // long blocks get their own detection so mixed-language pages switch voice per paragraph
      u.lang = (u.text && u.text.length >= 100 && (await detectLang(u.text))) || doc;
    }
  }
  const SKIPPED = { en: "Code block skipped.", fr: "Bloc de code ignoré." };
  const LN = new Intl.DisplayNames(["en"], { type: "language" });
  const langName = (c) => { try { return LN.of(c) || c; } catch { return c; } };
  const SAMPLE = {
    en: "Hello, this is how I sound.", fr: "Bonjour, voici ma voix.", ga: "Dia duit, seo é mo ghuth.",
    de: "Hallo, so klingt meine Stimme.", es: "Hola, así suena mi voz.", it: "Ciao, questa è la mia voce.",
    pt: "Olá, esta é a minha voz.", nl: "Hallo, zo klinkt mijn stem.",
  };
  const sampleText = (l) => SAMPLE[l] || (() => { try { return new Intl.DisplayNames([l], { type: "language" }).of(l); } catch { return l; } })();
  function addSeen(langs) {
    const seen = S.seenLangs || [];
    const add = langs.filter((l) => l && !seen.includes(l));
    if (add.length) save({ seenLangs: [...seen, ...add].slice(-20) });
  }

  const replies = () => [...document.querySelectorAll(REPLY_SEL)].filter((el) => el.innerText.trim());
  const lastReply = () => { const r = replies(); return r[r.length - 1]; };

  // ================= on-page UI (shadow DOM, isolated from the site's CSS) =================
  const host = document.createElement("div");
  host.id = "cra-host";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const sr = host.attachShadow({ mode: "open" });
  sr.innerHTML = `<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  [hidden]{display:none!important}
  .bar{position:fixed;right:16px;bottom:16px;display:flex;gap:4px;align-items:center;padding:5px;border-radius:999px;background:#1f1e1d;box-shadow:0 2px 12px rgba(0,0,0,.35);font-size:13px}
  .bar button,.panel button{all:unset;cursor:pointer;color:#fff;padding:5px 9px;border-radius:999px;background:#3a3938;line-height:1.1;font-size:13px;text-align:center}
  .bar button:hover,.panel button:hover{background:#4a4947}
  .bar button.on{background:#c96442}
  .bar button:disabled{opacity:.35;cursor:default}
  #lang{font-size:11px;font-weight:600;background:#2d4a6b}
  #lang:hover{background:#3b5f88}
  #lang.manual{background:#c96442}
  .menu{position:fixed;right:16px;bottom:62px;width:250px;max-height:62vh;overflow:auto;background:#262624;color:#e8e6e3;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.5);padding:8px;font-size:13px}
  .menu .mh{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a8a6a1;margin:8px 6px 4px}
  .menu .it{all:unset;display:block;cursor:pointer;padding:6px 8px;border-radius:8px;width:calc(100% - 16px)}
  .menu .it:hover{background:#3a3938}
  .menu .it.on{background:#c96442;color:#fff}
  .menu label{margin:8px 6px 2px;font-size:12px}
  .lrow{display:flex;align-items:center;gap:6px;margin:6px 0}
  .lrow span{width:78px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lrow select{flex:1;min-width:0}
  .lrow button{padding:5px 8px}
  .srow{display:flex;justify-content:space-between;align-items:center;margin:4px 0}
  #speed{min-width:38px}
  .float{position:fixed;display:none;cursor:pointer;background:#1f1e1d;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);font-size:13px;user-select:none}
  .float:hover{background:#c96442}
  .round{width:28px;height:28px;line-height:28px;text-align:center;border-radius:50%}
  .pill{padding:5px 10px;border-radius:999px}
  .panel{position:fixed;right:16px;bottom:62px;width:330px;max-height:78vh;overflow:auto;background:#262624;color:#e8e6e3;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.5);padding:12px 14px 14px;font-size:13px}
  .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .ph b{font-size:14px}
  h4{margin:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a8a6a1;display:flex;justify-content:space-between}
  h4 span{color:#e8e6e3;letter-spacing:0;text-transform:none;font-size:12px}
  select{width:100%;padding:6px;border-radius:8px;border:1px solid #444;background:#1f1e1d;color:#e8e6e3;font-size:13px}
  input[type=range]{width:100%;accent-color:#c96442}
  label{display:flex;gap:8px;align-items:center;margin:5px 0;cursor:pointer}
  input[type=checkbox]{accent-color:#c96442;margin:0}
  .chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
  .chips button{padding:4px 8px;font-size:12px}
  .chips button.on{background:#c96442}
  .crow{display:flex;align-items:center;gap:8px;margin:6px 0}
  .crow span{flex:1}
  .crow input[type=color]{width:34px;height:24px;border:0;padding:0;background:none;cursor:pointer}
  .crow input[type=range]{width:90px}
  .off{opacity:.4;pointer-events:none}
  .sample{margin-top:8px;padding:10px;border-radius:8px;line-height:1.6;border:1px solid #444}
  .row{display:flex;gap:6px;margin-top:8px}
  .note{color:#a8a6a1;font-size:11.5px;margin-top:4px;line-height:1.4}
</style>
<div class="bar" id="bar" hidden>
  <button id="prev" title="Previous sentence">⏮</button>
  <button id="play" title="Play / pause (⌥⇧R)">▶</button>
  <button id="stop" title="Stop (Esc)">⏹</button>
  <button id="next" title="Next sentence">⏭</button>
  <button id="lang" title="Language — click to change" hidden></button>
  <button id="speed" title="Speed — click: faster, right-click: slower">1×</button>
  <button id="auto" title="Auto-read new Claude replies">Auto</button>
  <button id="gear" title="Settings">⚙</button>
</div>
<div class="panel" id="panel" hidden>
  <div class="ph"><b id="panelTitle">Read Aloud settings</b><button id="close" title="Close">✕</button></div>
  <div id="langView" hidden>
    <div class="row" style="margin:0 0 6px"><button id="backMain">‹ Back</button></div>
    <div class="note">Narrator used for each language. <b>Auto</b> picks the best Natural voice. Languages appear here once they've been detected.</div>
    <div id="langRows"></div>
    <h4>Add a language</h4>
    <select id="addLang"></select>
    <h4>Sites with a forced language</h4>
    <div id="siteRows"></div>
  </div>
  <div id="mainView">
  <h4>Voice</h4>
  <select id="voice"></select>
  <div class="row"><button id="preview">▶ Preview</button></div>
  <label style="margin-top:10px"><input type="checkbox" id="autoLang"> Auto-detect language and switch voice</label>
  <div class="row"><button id="openLangs">Voices per language ›</button></div>
  <h4>Speed <span id="rateVal"></span></h4>
  <div class="chips" id="chips"></div>
  <input type="range" id="rate" min="0.5" max="3" step="0.05">
  <h4>Pitch <span id="pitchVal"></span></h4>
  <input type="range" id="pitch" min="0.5" max="1.5" step="0.05">
  <h4>Highlighting</h4>
  <label><input type="checkbox" id="hlSentence"> Highlight current sentence</label>
  <label><input type="checkbox" id="hlWord"> Highlight current word</label>
  <label><input type="checkbox" id="autoContrast"> Auto colours (contrast with page)</label>
  <div id="manual">
    <div class="crow"><span>Sentence</span><input type="color" id="sentenceColor"><input type="range" id="sentenceAlpha" min="0.05" max="0.8" step="0.01" title="Sentence opacity"></div>
    <div class="crow"><span>Word background</span><input type="color" id="wordBg"></div>
    <div class="crow"><span>Word text</span><input type="color" id="wordText"></div>
  </div>
  <div class="sample" id="sample">Reading now. <span id="sS">This sentence is being read, and the <span id="sW">current</span> word stands out.</span> Next one waits.</div>
  <h4>Behaviour</h4>
  <label><input type="checkbox" id="followAlong"> Scroll to follow the reading</label>
  <label><input type="checkbox" id="showBlockButtons"> Show 🔊 next to headings (reads the section)</label>
  <label><input type="checkbox" id="blocksEverywhere"> …on all websites, not just Claude</label>
  <label><input type="checkbox" id="siteOn"> Enabled on <b id="siteName"></b></label>
  <label><input type="checkbox" id="autoRead"> Auto-read new Claude replies</label>
  <label><input type="checkbox" id="skipCode"> Skip code blocks</label>
  <div class="row"><button id="reset">Reset to defaults</button></div>
  </div>
</div>
<div class="menu" id="langMenu" hidden></div>
<div class="float round" id="blockBtn" title="Read this section">🔊</div>
<div class="float pill" id="selBtn" title="Read the selection aloud">🔊 Read</div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => sr.getElementById(id);
  const bar = $("bar"), panel = $("panel"), blockBtn = $("blockBtn"), selBtn = $("selBtn");
  sr.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { openPanel(false); openLangMenu(false); } });
  for (const b of [blockBtn, selBtn, bar]) b.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection

  SPEEDS.forEach((v) => {
    const b = document.createElement("button");
    b.textContent = v + "×"; b.dataset.v = v;
    b.onclick = () => save({ rate: v });
    $("chips").appendChild(b);
  });

  // ================= settings =================
  function save(obj) {
    const changed = Object.keys(obj);
    Object.assign(S, obj);
    onSettings(changed);
    chrome.storage.local.set(obj);
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    const changed = [];
    for (const k in ch) {
      const v = ch[k].newValue === undefined ? DEFAULTS[k] : ch[k].newValue;
      if (S[k] !== v) { S[k] = v; changed.push(k); }
    }
    if (changed.length) onSettings(changed);
  });

  let restartT = null;
  function onSettings(keys) {
    colorCache.clear(); lastCss = "";
    if (lastColorEl) applyColors(lastColorEl);
    if (keys.includes("hlSentence") && !S.hlSentence && hasHL) CSS.highlights.delete("cra-sentence");
    if (keys.includes("hlWord") && !S.hlWord && hasHL) CSS.highlights.delete("cra-word");
    if (keys.includes("hlSentence") && S.hlSentence && P.cur) showSentence(P.cur.item, false);
    if (keys.includes("autoRead") && S.autoRead) resetAutoBaseline();
    if (["rate", "pitch", "voice", "voiceByLang", "autoLang"].some((k) => keys.includes(k)) && P.state === "playing") {
      clearTimeout(restartT);
      restartT = setTimeout(restartFromWord, 250);
    }
    refreshUI();
  }

  function refreshUI() {
    $("speed").textContent = +(+S.rate).toFixed(2) + "×";
    $("auto").classList.toggle("on", !!S.autoRead);
    $("rate").value = S.rate; $("rateVal").textContent = (+S.rate).toFixed(2) + "×";
    $("pitch").value = S.pitch; $("pitchVal").textContent = (+S.pitch).toFixed(2);
    for (const b of $("chips").children) b.classList.toggle("on", +b.dataset.v === +S.rate);
    for (const k of ["hlSentence", "hlWord", "autoContrast", "followAlong", "showBlockButtons", "blocksEverywhere", "autoRead", "skipCode", "autoLang"]) $(k).checked = !!S[k];
    if (!$("langView").hidden) renderLangView();
    $("siteOn").checked = !siteOff(); $("siteName").textContent = SITE;
    if (siteOff() || !S.showBlockButtons) blockBtn.style.display = "none";
    $("sentenceColor").value = S.sentenceColor; $("sentenceAlpha").value = S.sentenceAlpha;
    $("wordBg").value = S.wordBg; $("wordText").value = S.wordText;
    $("manual").classList.toggle("off", !!S.autoContrast);
    const v = currentVoice(); if (v) $("voice").value = v.name;
    if (!S.showBlockButtons) blockBtn.style.display = "none";
    // live sample, rendered on the same background/text colour as Claude's replies
    const c = colorsFor(lastReply() || document.body);
    $("sample").style.background = hex(c.bg); $("sample").style.color = hex(c.fg);
    $("sS").style.background = S.hlSentence ? c.sentenceBg : "transparent";
    $("sW").style.background = S.hlWord ? c.wordBg : "transparent";
    $("sW").style.color = S.hlWord ? c.wordText : "inherit";
    updateBar();
  }

  // ================= voices =================
  let voices = [];
  function currentVoice() {
    return voices.find((v) => v.name === S.voice)
      || voices.find((v) => /christopher/i.test(v.name) && /natural/i.test(v.name))
      || voices.find((v) => v.default) || voices[0] || null;
  }
  function bestVoice(lang) {
    const pref = { fr: ["fr-fr"], en: ["en-us", "en-gb", "en-ie"] }[lang] || [];
    const score = (v) => (/natural/i.test(v.name) ? 4 : 0) + (pref.includes(v.lang.toLowerCase()) ? 2 : 0)
      + (lang === "fr" && /henri|denise/i.test(v.name) ? 1 : 0) - (/multilingual/i.test(v.name) ? 0.5 : 0);
    return voices.filter((v) => v.lang.toLowerCase().startsWith(lang)).sort((a, b) => score(b) - score(a))[0] || null;
  }
  const availLangs = () => [...new Set(voices.map((v) => v.lang.split("-")[0].toLowerCase()))]
    .sort((a, b) => langName(a).localeCompare(langName(b)));
  const shortName = (n) => n.replace(/^Microsoft /, "").replace(/ Online \(Natural\)/, " (Natural)").replace(/ - .*$/, "");
  // Narrator for a language: pinned per-language voice > default voice if it fits > best Natural voice.
  function voiceFor(lang) {
    const def = currentVoice();
    if (!lang || !def) return def;
    const pinned = voices.find((x) => x.name === (S.voiceByLang || {})[lang]);
    if (pinned) return pinned;
    if (def.lang.toLowerCase().startsWith(lang) || /multilingual/i.test(def.name)) return def;
    return bestVoice(lang) || def;
  }
  function loadVoices() {
    voices = speechSynthesis.getVoices();
    const sel = $("voice");
    sel.textContent = "";
    for (const v of [...voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))) {
      const o = document.createElement("option");
      o.value = v.name; o.textContent = `${v.name.replace(/^Microsoft /, "")} — ${v.lang}`;
      sel.appendChild(o);
    }
    const cv = currentVoice(); if (cv) sel.value = cv.name;
    if (!$("langView").hidden) renderLangView();
  }

  // ================= player =================
  const P = { queue: [], idx: 0, state: "idle", gen: 0, utt: null, cur: null, lastWord: null, est: null, sawBoundary: false, noBoundary: new Set(), startBlock: null };

  let playToken = 0;
  async function play(units, startBlock = null) {
    const q = units.flatMap(sentencesOf);
    if (!q.length) return;
    const token = ++playToken;
    const preview = units.some((u) => u.preview);
    const forced = preview ? null : (S.siteLang || {})[SITE] || null;
    if (S.autoLang && !forced) {
      await assignLangs(units);
      addSeen([...new Set(units.map((u) => u.lang))]);
    }
    if (token !== playToken) return;
    stop();
    P.langOverride = forced;
    P.queue = q; P.idx = 0; P.state = "playing"; P.startBlock = startBlock;
    speakCurrent(0);
  }

  function speakCurrent(fromRel) {
    const gen = ++P.gen;
    clearTimeout(P.est);
    const item = P.queue[P.idx];
    if (!item) return stop();
    const base = item.spoken ? 0 : item.start + fromRel;
    const lang = P.langOverride || item.unit.lang;
    P.lang = lang;
    const spoken = item.unit.skipped ? SKIPPED[lang] || SKIPPED.en : item.spoken;
    const text = spoken || item.unit.text.slice(base, item.end);
    P.cur = { item, base, text }; P.lastWord = null; P.sawBoundary = false;

    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(lang);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = S.rate; u.pitch = S.pitch;
    P.voice = v;
    showSentence(item, true);

    u.onstart = () => { if (gen === P.gen) startEstimate(gen); };
    u.onboundary = (ev) => {
      if (gen !== P.gen || item.spoken || (ev.name && ev.name !== "word")) return;
      P.sawBoundary = true; clearTimeout(P.est);
      showWord(item, base + ev.charIndex, ev.charLength);
    };
    const next = () => {
      if (gen !== P.gen) return;
      if (v && !item.spoken) P.sawBoundary ? P.noBoundary.delete(v.name) : P.noBoundary.add(v.name);
      P.idx++; speakCurrent(0);
    };
    u.onend = next;
    u.onerror = (ev) => { if (gen === P.gen && ev.error !== "interrupted" && ev.error !== "canceled") next(); };
    P.utt = u; // keep a reference: Chrome can garbage-collect utterances and never fire onend

    const go = () => { if (gen === P.gen) { speechSynthesis.resume(); speechSynthesis.speak(u); } };
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(go, 60); } else go();
    updateBar();
  }

  // Fallback for voices that don't report word boundaries: estimate word timing from speech rate.
  function startEstimate(gen) {
    const { item, base, text } = P.cur;
    if (!S.hlWord || item.spoken) return;
    const v = P.voice;
    const delay = v && P.noBoundary.has(v.name) ? 0 : 700;
    const t0 = performance.now();
    P.est = setTimeout(() => {
      if (gen !== P.gen || P.sawBoundary) return;
      const words = [...wordSeg.segment(text)].filter((w) => w.isWordLike);
      const cps = 14.5 * S.rate;
      const step = (i) => {
        if (gen !== P.gen || P.sawBoundary || i >= words.length) return;
        const w = words[i];
        const wait = (w.index / cps) * 1000 - (performance.now() - t0);
        P.est = setTimeout(() => {
          if (gen !== P.gen || P.sawBoundary) return;
          showWord(item, base + w.index, w.segment.length);
          step(i + 1);
        }, Math.max(0, wait));
      };
      step(0);
    }, delay);
  }

  function showSentence(item, scroll) {
    if (!hasHL) return;
    CSS.highlights.delete("cra-word");
    if (item.spoken) { CSS.highlights.delete("cra-sentence"); return; }
    const r = safe(() => rangeFor(item.unit, item.start, item.end));
    if (!r) return;
    applyColors(r.startContainer.parentElement);
    if (S.hlSentence) CSS.highlights.set("cra-sentence", new Highlight(r));
    if (scroll && S.followAlong) {
      const rect = r.getBoundingClientRect();
      if (rect.height && (rect.top < 70 || rect.bottom > innerHeight - 120))
        r.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  function showWord(item, abs, len) {
    P.lastWord = abs;
    if (!S.hlWord || !hasHL) return;
    const end = Math.min(item.end, len ? abs + len : wordEnd(item.unit.text, abs));
    const r = safe(() => rangeFor(item.unit, abs, end));
    if (!r) return;
    const h = new Highlight(r); h.priority = 1;
    CSS.highlights.set("cra-word", h);
  }
  function clearHL() { if (hasHL) { CSS.highlights.delete("cra-sentence"); CSS.highlights.delete("cra-word"); } }

  function resumeOffset() {
    const it = P.cur && P.cur.item;
    return it && !it.spoken && P.lastWord != null ? Math.max(0, P.lastWord - it.start) : 0;
  }
  function pause() {
    if (P.state !== "playing") return;
    P.state = "paused"; P.gen++; clearTimeout(P.est); speechSynthesis.cancel(); updateBar();
  }
  function resume() { if (P.state === "paused") { P.state = "playing"; speakCurrent(resumeOffset()); } }
  function restartFromWord() { if (P.state === "playing") speakCurrent(resumeOffset()); }
  function stop() {
    P.gen++; clearTimeout(P.est); speechSynthesis.cancel();
    P.state = "idle"; P.queue = []; P.cur = null; P.startBlock = null;
    clearHL(); updateBar();
  }
  function skip(d) {
    if (P.state === "idle") return;
    P.idx = Math.max(0, Math.min(P.queue.length - 1, P.idx + d));
    P.state = "playing"; speakCurrent(0);
  }
  function togglePlay() {
    if (P.state === "playing") return pause();
    if (P.state === "paused") return resume();
    readDefault();
  }

  function readRange(range) {
    let root = range.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentElement;
    const units = buildUnits(root, range, false);
    getSelection().removeAllRanges(); // otherwise the selection colour hides the highlights
    play(units);
  }
  function readDefault() {
    const sel = getSelection();
    if (sel && sel.rangeCount && String(sel).trim()) return readRange(sel.getRangeAt(0).cloneRange());
    if (ON_CLAUDE) { const r = lastReply(); if (r) play(buildUnits(r)); return; }
    const main = document.querySelector("article, main, [role='main']") || document.body;
    play(buildUnits(main));
  }
  // Heading → read until the next heading of the same or higher level (H1 = whole article).
  function readSection(h) {
    const cont = containerOf(h), L = levelOf(h);
    let end = null;
    for (const x of cont.querySelectorAll(HEAD_SEL)) {
      if (h.contains(x) || x.contains(h) || !(h.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (levelOf(x) <= L && (ON_CLAUDE || !isNoise(x))) { end = x; break; }
    }
    const r = document.createRange();
    r.selectNodeContents(cont); r.setStartBefore(h);
    if (end) r.setEndBefore(end);
    play(buildUnits(cont, r), h);
  }

  // ================= language menu (badge) =================
  function openLangMenu(open) {
    const m = $("langMenu");
    m.hidden = !open;
    if (!open) return;
    if (panelOpen) openPanel(false);
    m.textContent = "";
    const detected = P.cur && P.cur.item.unit.lang;
    const active = P.state === "idle" ? (S.siteLang || {})[SITE] || null : P.langOverride;
    const head = (t) => { const d = document.createElement("div"); d.className = "mh"; d.textContent = t; m.appendChild(d); };
    const item = (code, label) => {
      const b = document.createElement("button");
      b.className = "it" + (code === active ? " on" : ""); b.textContent = label;
      b.onclick = () => setLangOverride(code);
      m.appendChild(b);
    };
    item(null, "Auto" + (detected ? ` — detected ${langName(detected)}` : ""));
    const avail = availLangs(), seen = (S.seenLangs || []).filter((l) => avail.includes(l));
    if (seen.length) { head("Recent"); seen.forEach((l) => item(l, langName(l))); }
    head("All languages");
    avail.filter((l) => !seen.includes(l)).forEach((l) => item(l, langName(l)));
    const lab = document.createElement("label");
    lab.innerHTML = '<input type="checkbox" id="langSite"> ';
    lab.append(`Always use on ${SITE || "this site"}`);
    m.insertBefore(lab, m.firstChild);
    const cb = lab.querySelector("input");
    cb.checked = !!(S.siteLang || {})[SITE];
    cb.onchange = () => {
      const sl = { ...(S.siteLang || {}) };
      const code = P.langOverride || (P.state === "idle" ? sl[SITE] : P.lang);
      if (cb.checked && code) sl[SITE] = code; else delete sl[SITE];
      save({ siteLang: sl });
    };
  }
  function setLangOverride(code) {
    const keep = !!sr.getElementById("langSite")?.checked;
    P.langOverride = code;
    const sl = { ...(S.siteLang || {}) };
    if (keep && code) sl[SITE] = code; else if (!code || !keep) delete sl[SITE];
    save({ siteLang: sl });
    if (code) addSeen([code]);
    openLangMenu(false);
    if (P.state === "playing") restartFromWord(); else updateBar();
  }

  // ================= settings sub-page: voices per language =================
  function showLangView(on) {
    $("langView").hidden = !on; $("mainView").hidden = on;
    $("panelTitle").textContent = on ? "Voices per language" : "Read Aloud settings";
    if (on) renderLangView();
  }
  function renderLangView() {
    const avail = availLangs();
    const list = [...new Set(["en", "fr", ...(S.seenLangs || []), ...Object.keys(S.voiceByLang || {})])].filter((l) => avail.includes(l));
    const rows = $("langRows"); rows.textContent = "";
    for (const l of list) {
      const row = document.createElement("div"); row.className = "lrow";
      const name = document.createElement("span"); name.textContent = langName(l); name.title = langName(l);
      const sel = document.createElement("select");
      const best = bestVoice(l), def = currentVoice();
      const autoV = def && (def.lang.toLowerCase().startsWith(l) || /multilingual/i.test(def.name)) ? def : best;
      sel.add(new Option(`Auto${autoV ? ` (${shortName(autoV.name)})` : ""}`, ""));
      for (const v of voices.filter((x) => x.lang.toLowerCase().startsWith(l))) sel.add(new Option(`${shortName(v.name)} — ${v.lang}`, v.name));
      sel.value = (S.voiceByLang || {})[l] || "";
      sel.onchange = () => { const mp = { ...(S.voiceByLang || {}) }; if (sel.value) mp[l] = sel.value; else delete mp[l]; save({ voiceByLang: mp }); };
      const pv = document.createElement("button"); pv.textContent = "▶"; pv.title = "Preview";
      pv.onclick = () => play([{ spoken: sampleText(l), lang: l, preview: true, owner: document.body }]);
      row.append(name, sel, pv); rows.appendChild(row);
    }
    const add = $("addLang"); add.textContent = "";
    add.add(new Option("Choose a language…", ""));
    avail.filter((l) => !list.includes(l)).forEach((l) => add.add(new Option(langName(l), l)));
    const sites = $("siteRows"); sites.textContent = "";
    const entries = Object.entries(S.siteLang || {});
    if (!entries.length) { const n = document.createElement("div"); n.className = "note"; n.textContent = "None. Use the language badge in the player to force one."; sites.appendChild(n); }
    for (const [host, l] of entries) {
      const r = document.createElement("div"); r.className = "srow";
      const t = document.createElement("span"); t.textContent = `${host} → ${langName(l)}`;
      const x = document.createElement("button"); x.textContent = "✕"; x.title = "Remove";
      x.onclick = () => { const sl = { ...(S.siteLang || {}) }; delete sl[host]; save({ siteLang: sl }); };
      r.append(t, x); sites.appendChild(r);
    }
  }

  // ================= bar & panel =================
  let panelOpen = false, hideBarT = null;
  function updateBar() {
    const idle = P.state === "idle";
    $("play").textContent = P.state === "playing" ? "⏸" : "▶";
    $("prev").disabled = $("next").disabled = $("stop").disabled = idle;
    const siteForced = (S.siteLang || {})[SITE];
    const lg = idle ? siteForced : P.lang;
    $("lang").hidden = !lg || (idle && !siteForced);
    if (lg) {
      const manual = idle ? true : !!P.langOverride;
      $("lang").textContent = lg.toUpperCase() + " ▾";
      $("lang").classList.toggle("manual", manual);
      $("lang").title = `${langName(lg)} — ${manual ? (siteForced === lg ? "forced on this site" : "set manually") : "detected"}`
        + (P.voice && !idle ? `\nVoice: ${shortName(P.voice.name)}` : "") + "\nClick to change";
    }
    if (idle) $("langMenu").hidden = true;
    $("auto").hidden = !ON_CLAUDE;
    clearTimeout(hideBarT);
    if (ON_CLAUDE || !idle || panelOpen) bar.hidden = false;
    else hideBarT = setTimeout(() => { bar.hidden = true; }, 2500);
  }
  function openPanel(open) {
    panelOpen = open; panel.hidden = !open;
    if (open) { $("langMenu").hidden = true; showLangView(false); loadVoices(); refreshUI(); }
    updateBar();
  }

  $("play").onclick = togglePlay;
  $("stop").onclick = stop;
  $("prev").onclick = () => skip(-1);
  $("next").onclick = () => skip(1);
  $("gear").onclick = () => openPanel(!panelOpen);
  $("close").onclick = () => openPanel(false);
  $("auto").onclick = () => save({ autoRead: !S.autoRead });
  const stepSpeed = (d) => {
    const i = SPEEDS.findIndex((v) => v >= S.rate - 0.001);
    let j = d > 0 ? (SPEEDS[i] > S.rate + 0.001 ? i : i + 1) : (i <= 0 ? SPEEDS.length - 1 : i - 1);
    if (j >= SPEEDS.length || j < 0) j = d > 0 ? 0 : SPEEDS.length - 1;
    save({ rate: SPEEDS[j] });
  };
  $("speed").onclick = () => stepSpeed(1);
  $("speed").oncontextmenu = (e) => { e.preventDefault(); stepSpeed(-1); };

  $("siteOn").addEventListener("change", (e) => {
    const set = new Set(S.disabledSites || []);
    e.target.checked ? set.delete(SITE) : set.add(SITE);
    save({ disabledSites: [...set] });
  });
  for (const k of ["hlSentence", "hlWord", "autoContrast", "followAlong", "showBlockButtons", "blocksEverywhere", "autoRead", "skipCode", "autoLang"])
    $(k).addEventListener("change", (e) => save({ [k]: e.target.checked }));
  for (const k of ["sentenceColor", "wordBg", "wordText"]) $(k).addEventListener("input", (e) => save({ [k]: e.target.value }));
  for (const k of ["rate", "pitch", "sentenceAlpha"]) $(k).addEventListener("input", (e) => save({ [k]: +e.target.value }));
  $("voice").addEventListener("change", (e) => save({ voice: e.target.value }));

  $("preview").onclick = () => play([{ spoken: "Hello. This is how I sound at this speed.", lang: (currentVoice() || { lang: "en" }).lang.slice(0, 2).toLowerCase(), preview: true, owner: document.body }]);
  $("openLangs").onclick = () => showLangView(true);
  $("backMain").onclick = () => showLangView(false);
  $("lang").onclick = () => openLangMenu($("langMenu").hidden);
  $("addLang").addEventListener("change", (e) => { if (e.target.value) addSeen([e.target.value]); });
  $("reset").onclick = () => save({ ...DEFAULTS, disabledSites: S.disabledSites, seenLangs: S.seenLangs });

  // ================= section 🔊 buttons on headings (+ whole-reply button on claude.ai) =================
  let hoverTarget = null, hoverKind = null, hideBlockT = null;
  function placeBlockBtn() {
    if (!hoverTarget || !document.contains(hoverTarget) || !S.showBlockButtons) return (blockBtn.style.display = "none");
    let top, left;
    if (hoverKind === "heading") {
      // just after the end of the heading's text (headings are often full-width boxes)
      const rr = document.createRange(); rr.selectNodeContents(hoverTarget);
      const rects = rr.getClientRects(), last = rects[rects.length - 1] || hoverTarget.getBoundingClientRect();
      top = last.top + (last.height - 28) / 2; left = last.right + 10;
      blockBtn.title = levelOf(hoverTarget) === 1 ? "Read the whole article" : "Read this section";
    } else {
      const r = hoverTarget.getBoundingClientRect();
      top = r.top; left = r.left >= 40 ? r.left - 36 : r.right + 6;
      blockBtn.title = "Read this whole reply";
    }
    if (top > innerHeight || top < -28) return (blockBtn.style.display = "none");
    blockBtn.style.display = "block";
    blockBtn.style.top = Math.max(4, top) + "px";
    blockBtn.style.left = Math.min(innerWidth - 34, Math.max(4, left)) + "px";
    const active = P.state !== "idle" && P.startBlock === hoverTarget;
    blockBtn.textContent = active ? "⏹" : "🔊";
  }
  document.addEventListener("mouseover", (e) => {
    if (e.target === host) { clearTimeout(hideBlockT); return; }
    let t = null, kind = null;
    if (S.showBlockButtons) {
      t = readableHeading(e.target); kind = "heading";
      if (!t && ON_CLAUDE) { t = e.target.closest && e.target.closest(REPLY_SEL); kind = "reply"; }
    }
    if (t) { hoverTarget = t; hoverKind = kind; clearTimeout(hideBlockT); placeBlockBtn(); }
    else { clearTimeout(hideBlockT); hideBlockT = setTimeout(() => (blockBtn.style.display = "none"), 500); }
  }, true);
  document.addEventListener("scroll", placeBlockBtn, true);
  blockBtn.addEventListener("click", () => {
    if (!hoverTarget) return;
    if (P.state !== "idle" && P.startBlock === hoverTarget) { stop(); return placeBlockBtn(); }
    if (hoverKind === "heading") readSection(hoverTarget);
    else play(buildUnits(hoverTarget), hoverTarget);
    placeBlockBtn();
  });

  // ================= "🔊 Read" next to selected text (any site) =================
  // Follows the moving end of the selection and stays pinned on screen while you scroll / Shift+click to extend.
  function activeSelection() {
    const s = getSelection();
    if (siteOff() || !s || !s.rangeCount || s.isCollapsed || String(s).trim().length < 2) return null;
    const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    if (!node || node.closest("[contenteditable='true'], [contenteditable=''], textarea, input")) return null;
    return s;
  }
  let selRaf = 0;
  function placeSelBtn() {
    cancelAnimationFrame(selRaf);
    selRaf = requestAnimationFrame(() => {
      const s = activeSelection();
      if (!s) { selBtn.style.display = "none"; return; }
      let r = null;
      try { const fr = document.createRange(); fr.setStart(s.focusNode, s.focusOffset); r = fr.getBoundingClientRect(); } catch {}
      if (!r || (!r.height && !r.width)) {
        const rects = s.getRangeAt(0).getClientRects();
        r = rects[rects.length - 1] || s.getRangeAt(0).getBoundingClientRect();
      }
      selBtn.style.display = "block";
      selBtn.style.top = Math.min(innerHeight - 40, Math.max(8, r.top - 36)) + "px";
      selBtn.style.left = Math.min(innerWidth - 90, Math.max(8, r.right - 20)) + "px";
    });
  }
  document.addEventListener("selectionchange", placeSelBtn);
  document.addEventListener("scroll", placeSelBtn, true);
  window.addEventListener("resize", placeSelBtn);
  selBtn.addEventListener("click", () => {
    const s = activeSelection();
    selBtn.style.display = "none";
    if (s) readRange(s.getRangeAt(0).cloneRange());
  });

  // ================= auto-read finished replies (claude.ai) =================
  let baseEl = null, baseText = "", basePath = location.pathname;
  function resetAutoBaseline() { baseEl = lastReply() || null; baseText = baseEl ? baseEl.innerText : ""; basePath = location.pathname; }
  if (ON_CLAUDE) {
    let t = null;
    new MutationObserver(() => {
      if (!S.autoRead) return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (location.pathname !== basePath) return resetAutoBaseline(); // switched conversation: don't read old replies
        const el = lastReply();
        if (!el || el.closest("[data-is-streaming='true']") || el.getAttribute("data-is-streaming") === "true") return;
        const txt = el.innerText;
        if (txt === baseText) return;
        baseEl = el; baseText = txt;
        play(buildUnits(el));
      }, 1500);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ================= messages, keys, init =================
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m.type === "readSelection") readDefault();
    else if (m.type === "toggle") togglePlay();
    else if (m.type === "stop") stop();
    else if (m.type === "openSettings") openPanel(true);
    reply({ ok: true });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && P.state !== "idle") stop(); });
  window.addEventListener("beforeunload", () => speechSynthesis.cancel());

  speechSynthesis.addEventListener("voiceschanged", () => { loadVoices(); refreshUI(); });
  loadVoices();
  chrome.storage.local.get(DEFAULTS, (s) => {
    S = { ...DEFAULTS, ...s };
    if (S.voiceFr && !(S.voiceByLang || {}).fr) save({ voiceByLang: { ...(S.voiceByLang || {}), fr: S.voiceFr }, voiceFr: "" }); refreshUI(); resetAutoBaseline(); });
  refreshUI();
})();
