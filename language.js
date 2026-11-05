/*
 * Bitcoin Journey - shared language system
 * ----------------------------------------
 * This one file runs on every page. It:
 *   1. draws the language selector (globe button),
 *   2. remembers the visitor's choice (browser localStorage),
 *   3. switches the page between left-to-right and right-to-left,
 *   4. swaps the English text for the chosen language.
 *
 * TO ADD A NEW LANGUAGE LATER:
 *   a) add one entry to LANGS below (copy the "ar" entry),
 *   b) create a file called translations-XX.js (copy translations-ar.js).
 * Nothing else needs to change.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "bj-lang";
  var DEFAULT_LANG = "en";

  // ---- The list of languages (add new ones here) ----------------------
  var LANGS = {
    en: { name: "English", short: "EN", dir: "ltr", htmlLang: "en", uiLabel: "Language" },
    ar: { name: "العربية", short: "AR", dir: "rtl", htmlLang: "ar", uiLabel: "اللغة", file: "translations-ar.js" }
  };

  // Folder this script lives in (so translation files are found on GitHub Pages)
  var scriptEl = document.currentScript;
  var BASE = scriptEl && scriptEl.src ? scriptEl.src.replace(/[^\/]*$/, "") : "";

  var current = DEFAULT_LANG;
  var registry = [];          // everything we changed, so we can restore English
  var missingList = [];       // English texts that had no translation
  var observer = null;
  var uiMounted = false;

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, IFRAME: 1, SVG: 1, CODE: 1, PRE: 1, HEAD: 1 };
  var INLINE_TAGS = { BDI: 1, A: 1, STRONG: 1, B: 1, EM: 1, I: 1, SPAN: 1, SUP: 1, SUB: 1, U: 1, SMALL: 1, MARK: 1, BR: 1 };
  var ATTRS = ["title", "aria-label", "placeholder", "alt"];

  // ---- Small helpers --------------------------------------------------
  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }
  function hasLetters(s) { return /[A-Za-z\u0600-\u06FF]/.test(s); }

  function readSaved() {
    var fromUrl = null;
    try {
      var m = /[?&]lang=([a-z]{2})/i.exec(window.location.search);
      if (m) fromUrl = m[1].toLowerCase();
    } catch (e) {}
    if (fromUrl && LANGS[fromUrl]) return fromUrl;
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      if (v && LANGS[v]) return v;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  function saveLang(code) {
    try { window.localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
  }

  function setDocAttrs(code) {
    var L = LANGS[code];
    var root = document.documentElement;
    root.setAttribute("lang", L.htmlLang);
    root.setAttribute("dir", L.dir);
  }

  function data(code) {
    return (window.BJ_LANG_DATA && window.BJ_LANG_DATA[code]) || null;
  }

  // Keeps a bracketed English term such as "(Proof of Work)" on one line
  function polish(text) {
    // Money amounts such as £10 must always read left-to-right
    text = text.replace(/£[\d][\d.,]*/g, function (m) { return "\u2066" + m + "\u2069"; });
    return text.replace(/\(([A-Za-z][A-Za-z0-9\-'\/ ]*)\)/g, function (m) {
      return m.replace(/ /g, "\u00A0");
    });
  }

  // ---- Looking up a translation ---------------------------------------
  // Returns the translated text, or null if there is none.
  function lookup(key) {
    var r = lookupRaw(key);
    return r === null ? null : polish(r);
  }

  function lookupRaw(key) {
    var d = data(current);
    if (!d) return null;
    if (Object.prototype.hasOwnProperty.call(d.strings, key)) return d.strings[key];

    // Patterns handle text with numbers in it, e.g. "You scored 3 out of 4."
    var pats = d.patterns || [];
    for (var i = 0; i < pats.length; i++) {
      var re = new RegExp(pats[i][0]);
      if (re.test(key)) return key.replace(re, pats[i][1]);
    }

    // Last try: translate sentence by sentence (quiz results join sentences)
    var parts = key.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
    if (parts && parts.length > 1) {
      var out = [];
      for (var j = 0; j < parts.length; j++) {
        var p = norm(parts[j]);
        var t = null;
        if (Object.prototype.hasOwnProperty.call(d.strings, p)) t = d.strings[p];
        else {
          for (var k = 0; k < pats.length; k++) {
            var re2 = new RegExp(pats[k][0]);
            if (re2.test(p)) { t = p.replace(re2, pats[k][1]); break; }
          }
        }
        if (t === null) return null;
        out.push(t);
      }
      return out.join(" ");
    }
    return null;
  }

  function isIgnorable(s) {
    var rest = s.replace(/[\d.,£$€%:+\-–—×()\/\s₿]/g, "");
    if (!hasLetters(rest)) return true;                       // only numbers and symbols
    return /\d/.test(s) && /^[\d.,£$€%+\-–—×()\/\s]*(BTC|sats?|satoshis?|sat\/vB|vB)$/i.test(s);  // e.g. "0.5 BTC"
  }

  function noteMissing(key) {
    if (isIgnorable(key)) return;
    if (missingList.indexOf(key) === -1) missingList.push(key);
  }

  // ---- Translating the page -------------------------------------------
  function isMixedUnit(el) {
    // A sentence broken up by inline tags, e.g. "A <strong>wallet</strong> holds keys."
    var sawText = false, ok = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (hasLetters(n.nodeValue)) sawText = true;
      } else if (n.nodeType === 1) {
        if (!INLINE_TAGS[n.tagName]) return false;
        if (sawText && hasLetters(n.textContent)) ok = true;
      }
    }
    return ok;
  }

  function isSkippedElement(e) {
    var tag = (e.tagName || "").toUpperCase();
    if (SKIP_TAGS[tag]) return true;
    if (e.hasAttribute("data-no-translate")) return true;
    return !!(e.classList && (e.classList.contains("bj-lang") || e.classList.contains("bj-lang-bar")));
  }

  function insideSkipped(node) {
    for (var e = node.nodeType === 1 ? node : node.parentNode; e && e.nodeType === 1; e = e.parentNode) {
      if (isSkippedElement(e)) return true;
    }
    return false;
  }

  function translateTextNode(node) {
    var raw = node.nodeValue;
    var key = norm(raw);
    if (!key || !hasLetters(key)) return;
    var out = lookup(key);
    if (out === null) { noteMissing(key); return; }
    var lead = /^\s*/.exec(raw)[0];
    var trail = /\s*$/.exec(raw)[0];
    var finalText = lead + out + trail;
    if (finalText === raw) return;
    registry.push({ kind: "text", node: node, en: raw, ar: finalText });
    node.nodeValue = finalText;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var raw = el.getAttribute(name);
      var key = norm(raw);
      if (!key || !hasLetters(key)) continue;
      var out = lookup(key);
      if (out === null) { noteMissing(key); continue; }
      if (out === raw) continue;
      registry.push({ kind: "attr", el: el, name: name, en: raw, ar: out });
      el.setAttribute(name, out);
    }
  }

  function walk(el) {
    if (el.nodeType !== 1) return;
    if (isSkippedElement(el)) return;

    translateAttrs(el);

    if (isMixedUnit(el)) {
      var enHTML = el.innerHTML;
      var key = norm(enHTML);
      var out = lookup(key);
      if (out !== null) {
        if (out !== enHTML) {
          registry.push({ kind: "html", el: el, en: enHTML, ar: out });
          el.innerHTML = out;
        }
        return;
      }
      noteMissing(key);
      // fall through: translate the pieces we can
    }

    var child = el.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1) walk(child);
      child = next;
    }
  }

  function translateTitleAndMeta() {
    var titleKey = norm(document.title);
    var out = lookup(titleKey);
    if (out !== null && out !== document.title) {
      registry.push({ kind: "title", en: document.title, ar: out });
      document.title = out;
    } else if (out === null) noteMissing(titleKey);

    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      var raw = meta.getAttribute("content") || "";
      var mOut = lookup(norm(raw));
      if (mOut !== null && mOut !== raw) {
        registry.push({ kind: "attr", el: meta, name: "content", en: raw, ar: mOut });
        meta.setAttribute("content", mOut);
      } else if (mOut === null && raw) noteMissing(norm(raw));
    }
  }

  function restoreEnglish() {
    stopObserver();
    for (var i = registry.length - 1; i >= 0; i--) {
      var r = registry[i];
      if (r.kind === "text") { if (r.node.nodeValue === r.ar) r.node.nodeValue = r.en; }
      else if (r.kind === "attr") { if (r.el.getAttribute(r.name) === r.ar) r.el.setAttribute(r.name, r.en); }
      else if (r.kind === "html") { r.el.innerHTML = r.en; }
      else if (r.kind === "title") { document.title = r.en; }
    }
    registry = [];
  }

  function translatePage() {
    missingList = [];
    translateTitleAndMeta();
    if (document.body) walk(document.body);
  }

  // ---- Watching for text the page creates later (quiz results, etc.) ---
  function startObserver() {
    if (observer || !window.MutationObserver || !document.body) return;
    observer = new MutationObserver(function (records) {
      if (current === DEFAULT_LANG) return;
      stopObserver();
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === "characterData") {
          if (rec.target.isConnected && !insideSkipped(rec.target)) translateTextNode(rec.target);
        } else {
          for (var j = 0; j < rec.addedNodes.length; j++) {
            var n = rec.addedNodes[j];
            if (!n.isConnected || insideSkipped(n)) continue;
            if (n.nodeType === 3) translateTextNode(n);
            else if (n.nodeType === 1) walk(n);
          }
        }
      }
      startObserver();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ---- Loading a translation file --------------------------------------
  function loadLanguage(code, done) {
    var L = LANGS[code];
    if (!L.file || data(code)) { done(true); return; }
    var s = document.createElement("script");
    s.src = BASE + L.file;
    s.onload = function () { done(!!data(code)); };
    s.onerror = function () { done(false); };
    document.head.appendChild(s);
  }

  // ---- Switching language ----------------------------------------------
  function showPage() {
    document.documentElement.classList.remove("bj-loading");
  }

  function applyLanguage(code, persist) {
    if (!LANGS[code]) code = DEFAULT_LANG;
    loadLanguage(code, function (ok) {
      if (!ok) {
        if (window.console) console.warn("Bitcoin Journey: could not load language '" + code + "'. Showing English.");
        code = DEFAULT_LANG;
      }
      restoreEnglish();
      current = code;
      setDocAttrs(code);
      if (persist) saveLang(code);
      if (code !== DEFAULT_LANG) {
        translatePage();
        startObserver();
        if (missingList.length && window.console) {
          console.warn("Bitcoin Journey: " + missingList.length + " text(s) have no " + LANGS[code].name + " translation yet. Type BJ.missing() to see them.");
        }
      }
      updateUI();
      showPage();
    });
  }

  // ---- The selector (globe button) -------------------------------------
  var ui = {};

  var GLOBE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function buildSelector() {
    var wrap = document.createElement("div");
    wrap.className = "bj-lang";
    wrap.setAttribute("data-no-translate", "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bj-lang-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = GLOBE +
      '<span class="bj-lang-name"></span><span class="bj-lang-code"></span>' + CHEVRON;

    var menu = document.createElement("ul");
    menu.className = "bj-lang-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    var items = {};
    Object.keys(LANGS).forEach(function (code) {
      var li = document.createElement("li");
      li.setAttribute("role", "none");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bj-lang-item";
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("lang", LANGS[code].htmlLang);
      b.setAttribute("data-lang", code);
      b.textContent = LANGS[code].name;
      b.addEventListener("click", function () {
        closeMenu(true);
        if (code !== current) applyLanguage(code, true);
      });
      li.appendChild(b);
      menu.appendChild(li);
      items[code] = b;
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    ui = { wrap: wrap, btn: btn, menu: menu, items: items,
           name: btn.querySelector(".bj-lang-name"), code: btn.querySelector(".bj-lang-code") };

    btn.addEventListener("click", function () {
      if (menu.hidden) openMenu(); else closeMenu(true);
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) { closeMenu(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (menu.hidden) { openMenu(); e.preventDefault(); return; }
        var list = Array.prototype.slice.call(menu.querySelectorAll(".bj-lang-item"));
        var i = list.indexOf(document.activeElement);
        i = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[i].focus();
        e.preventDefault();
      }
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !wrap.contains(e.target)) closeMenu(false);
    });
    return wrap;
  }

  function openMenu() {
    ui.menu.hidden = false;
    ui.btn.setAttribute("aria-expanded", "true");
    var sel = ui.items[current];
    if (sel) sel.focus();
  }

  function closeMenu(returnFocus) {
    ui.menu.hidden = true;
    ui.btn.setAttribute("aria-expanded", "false");
    if (returnFocus) ui.btn.focus();
  }

  function updateUI() {
    if (!uiMounted) return;
    var L = LANGS[current];
    ui.name.textContent = L.name;
    ui.code.textContent = L.short;
    ui.btn.setAttribute("aria-label", L.uiLabel + ": " + L.name);
    ui.btn.setAttribute("title", L.uiLabel);
    Object.keys(ui.items).forEach(function (code) {
      ui.items[code].setAttribute("aria-checked", code === current ? "true" : "false");
    });
  }

  function mountSelector() {
    var sel = buildSelector();
    var slot = document.getElementById("bj-lang-slot");
    var header = document.querySelector("header");
    if (slot) {
      slot.appendChild(sel);
    } else if (header) {
      sel.classList.add("bj-lang--lesson");
      if (window.getComputedStyle(header).position === "static") header.style.position = "relative";
      header.appendChild(sel);
    } else {
      var bar = document.createElement("div");
      bar.className = "bj-lang-bar";
      bar.setAttribute("data-no-translate", "");
      bar.appendChild(sel);
      document.body.insertBefore(bar, document.body.firstChild);
    }
    uiMounted = true;
    updateUI();
  }

  // ---- Start up ---------------------------------------------------------
  var saved = readSaved();

  // Set direction immediately so the page does not "jump" while loading
  if (saved !== DEFAULT_LANG) {
    setDocAttrs(saved);
    document.documentElement.classList.add("bj-loading");
    window.setTimeout(showPage, 3000); // safety: never leave the page hidden
  }

  function start() {
    mountSelector();
    applyLanguage(saved, false);
    if (window.addEventListener) {
      window.addEventListener("storage", function (e) {
        if (e.key === STORAGE_KEY && e.newValue && LANGS[e.newValue] && e.newValue !== current) {
          applyLanguage(e.newValue, false);
        }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // ---- Public helpers (used by pages and for testing) -------------------
  window.BJ = {
    languages: LANGS,
    getLanguage: function () { return current; },
    setLanguage: function (code) { applyLanguage(code, true); },
    // Translate a piece of text on demand (used for pop-up messages)
    t: function (text) {
      if (current === DEFAULT_LANG) return text;
      var out = lookup(norm(text));
      return out === null ? text : out;
    },
    // List English texts on this page that still need a translation
    missing: function () { return missingList.slice(); }
  };
})();
