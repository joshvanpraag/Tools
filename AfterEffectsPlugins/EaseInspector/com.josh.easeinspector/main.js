(function () {
  "use strict";
  var cep = window.__adobe_cep__;
  var FAST_MS = 250, IDLE_MS = 600, HIDDEN_MS = 1500, WIDE_MIN = 640;
  var DEFAULT_LIB = { name: "My Eases", presets: [
    { name: "Ease 33", inInfl: 33.33, inSpeed: 0, outInfl: 33.33, outSpeed: 0 },
    { name: "Smooth 75", inInfl: 75, inSpeed: 0, outInfl: 75, outSpeed: 0 },
    { name: "Decelerate", inInfl: 85, inSpeed: 0, outInfl: 15, outSpeed: 0 },
    { name: "Accelerate", inInfl: 15, inSpeed: 0, outInfl: 85, outSpeed: 0 }
  ] };

  var S = {
    rows: [], rowsKey: "", hl: [], anchor: -1, dirty: {}, clipCount: 0, lib: null,
    live: true, collapsed: localStorage.getItem("ei.collapsed") === "1", wide: false,
    inflight: false, timer: 0, busyHint: false, drag: null, view: "main"
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html !== undefined) { e.innerHTML = html; } return e; }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function clampInfl(v) { return Math.max(0.1, Math.min(100, v)); }

  /* ---------- host bridge ---------- */
  function host(fn, arg, cb) {
    var call = "$.global.EaseInspectorHost ? $.global.EaseInspectorHost." + fn + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ") : '{\"ok\":false,\"notLoaded\":true,\"msg\":\"Host script not loaded\"}'";
    try {
      cep.evalScript(call, function (res) {
        if (typeof res !== "string" || res === "" || res === "EvalScript error.") {
          if (cb) { cb({ ok: false, refused: true, msg: "After Effects is busy. Try again in a moment." }); }
          return;
        }
        var r;
        try { r = JSON.parse(res); } catch (e) { r = { ok: false, msg: "Unexpected reply from After Effects." }; }
        if (r && r.notLoaded) { loadHost(); }
        if (cb) { cb(r); }
      });
    } catch (e) {
      if (cb) { cb({ ok: false, refused: true, msg: "After Effects is busy. Try again in a moment." }); }
    }
  }

  function loadHost() {
    try {
      var dir = cep.getSystemPath("extension").replace(/^file:\/*/, "");
      dir = decodeURIComponent(dir);
      cep.evalScript("$.evalFile(new File(" + JSON.stringify(dir + "/host.jsx") + "))", function () {});
    } catch (e) {}
  }

  /* ---------- icons ---------- */
  var C = { key: "#d9d9d9", line: "#9e9e9e", acc: "#4a8fff" };
  function svg(w, h, body) { return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" fill="none" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"; }
  var ICON = {
    copy: svg(18, 18, '<rect x="2.5" y="2.5" width="9" height="10" stroke="' + C.line + '"/><rect x="6.5" y="6.5" width="9" height="10" fill="#2c2c2c" stroke="' + C.key + '" stroke-width="1.5"/>'),
    paste: svg(18, 18, '<rect x="3" y="3.5" width="12" height="13" stroke="' + C.key + '" stroke-width="1.5"/><rect x="6" y="1.5" width="6" height="4" fill="' + C.acc + '"/><path d="M6 9.5h6M6 12.5h5" stroke="' + C.line + '"/>'),
    save: svg(18, 18, '<path d="M2 11v5h14v-5" stroke="' + C.key + '" stroke-width="1.5"/><path d="M9 2v10M5 8l4 4 4-4" stroke="' + C.acc + '" stroke-width="2"/>'),
    manage: svg(18, 18, '<rect x="2" y="3.5" width="3" height="3" fill="' + C.acc + '"/><rect x="2" y="8.5" width="3" height="3" fill="' + C.acc + '"/><rect x="2" y="13.5" width="3" height="3" fill="' + C.acc + '"/><path d="M7 5h9M7 10h9M7 15h9" stroke="' + C.key + '" stroke-width="1.5"/>'),
    refresh: svg(16, 16, '<path d="M13 8a5 5 0 1 1-1.5-3.6" stroke="' + C.key + '" stroke-width="1.5"/><path d="M12 1.5v3.4H8.6" stroke="' + C.acc + '" stroke-width="1.5"/>'),
    open: svg(12, 12, '<path d="M3 2l4 4-4 4" fill="' + C.key + '" stroke="' + C.key + '"/>'),
    closed: svg(12, 12, '<path d="M2 4l4 4 4-4" fill="' + C.key + '" stroke="' + C.key + '"/>'),
    inflIn: svg(18, 16, '<path d="M3 8h10" stroke="' + C.line + '"/><path d="M13 4l4 4-4 4-4-4z" fill="' + C.key + '"/><circle cx="3" cy="8" r="2.5" fill="' + C.acc + '"/>'),
    inflOut: svg(18, 16, '<path d="M5 8h10" stroke="' + C.line + '"/><path d="M5 4l4 4-4 4-4-4z" fill="' + C.key + '"/><circle cx="15" cy="8" r="2.5" fill="' + C.acc + '"/>'),
    speed: svg(16, 16, '<circle cx="8" cy="8" r="6" stroke="' + C.line + '"/><path d="M8 8l4-3.5" stroke="' + C.acc + '" stroke-width="2"/><circle cx="8" cy="8" r="1.5" fill="' + C.key + '"/>'),
    lib: svg(18, 18, '<rect x="2" y="3" width="4" height="12" stroke="' + C.key + '" stroke-width="1.5"/><rect x="7" y="3" width="4" height="12" stroke="' + C.key + '" stroke-width="1.5"/><path d="M12.5 4l3.5 10.5" stroke="' + C.acc + '" stroke-width="2"/>'),
    importLib: svg(18, 18, '<path d="M2 11v5h14v-5" stroke="' + C.key + '" stroke-width="1.5"/><path d="M9 2v9M5.5 7.5L9 11l3.5-3.5" stroke="' + C.acc + '" stroke-width="2"/>'),
    exportLib: svg(18, 18, '<path d="M2 11v5h14v-5" stroke="' + C.key + '" stroke-width="1.5"/><path d="M9 12V3M5.5 6.5L9 3l3.5 3.5" stroke="' + C.acc + '" stroke-width="2"/>'),
    reset: svg(18, 18, '<path d="M4 9a5 5 0 1 0 1.5-3.6" stroke="' + C.key + '" stroke-width="1.5"/><path d="M5 2v3.5h3.5" stroke="' + C.acc + '" stroke-width="1.5"/>'),
    add: svg(18, 18, '<path d="M9 3v12M3 9h12" stroke="' + C.acc + '" stroke-width="2"/>'),
    update: svg(18, 18, '<path d="M3 9.5l4 4 8-9" stroke="' + C.acc + '" stroke-width="2"/>'),
    remove: svg(18, 18, '<path d="M3 5h12M7 3h4" stroke="' + C.key + '" stroke-width="1.5"/><path d="M4.5 6l1 10h7l1-10" stroke="' + C.key + '" stroke-width="1.5"/><path d="M8 8.5v5M10.5 8.5v5" stroke="' + C.line + '"/>'),
    up: svg(18, 18, '<path d="M9 15V4M4 9l5-5 5 5" stroke="' + C.key + '" stroke-width="1.5"/>'),
    down: svg(18, 18, '<path d="M9 3v11M4 9l5 5 5-5" stroke="' + C.key + '" stroke-width="1.5"/>')
  };
  function setIcon(id, name) { var b = $(id); b.insertAdjacentHTML("afterbegin", ICON[name]); }
  function fillIcons(root) {
    root.querySelectorAll(".ico.infl-in").forEach(function (e) { e.innerHTML = ICON.inflIn; });
    root.querySelectorAll(".ico.infl-out").forEach(function (e) { e.innerHTML = ICON.inflOut; });
    root.querySelectorAll(".ico.speed").forEach(function (e) { e.innerHTML = ICON.speed; });
    root.querySelectorAll(".ico.lib").forEach(function (e) { e.innerHTML = ICON.lib; });
  }

  /* ---------- messages ---------- */
  var msgTimer = 0;
  function message(text, opts) {
    opts = opts || {};
    var box = $(S.view === "manager" ? "mMsg" : "msg");
    clearTimeout(msgTimer);
    box.className = "msg" + (opts.error ? " error" : "");
    box.innerHTML = "";
    box.appendChild(el("span", "t")).textContent = text;
    var btns = opts.buttons || [{ label: "OK" }];
    btns.forEach(function (b) {
      var x = el("button", "tbtn text" + (b.primary ? " primary" : ""));
      x.textContent = b.label;
      x.onclick = function () { box.className = "msg hidden"; if (b.fn) { b.fn(); } };
      box.appendChild(x);
    });
    if (opts.auto) { msgTimer = setTimeout(function () { box.className = "msg hidden"; }, opts.auto); }
  }
  function status(t) { $("status").textContent = t; }

  /* ---------- library ---------- */
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function normPreset(p) {
    p = p || {};
    var name = (p.name === undefined || p.name === null || String(p.name).trim() === "") ? "" : String(p.name).trim();
    var o = { name: name, inInfl: clampInfl(num(p.inInfl, 33.33)), inSpeed: num(p.inSpeed, 0), outInfl: clampInfl(num(p.outInfl, 33.33)), outSpeed: num(p.outSpeed, 0) };
    if (o.name === autoName(o)) { o.name = ""; }
    return o;
  }
  function autoName(p) { return fmt(p.inInfl) + "/" + fmt(p.outInfl); }
  function dispName(p) { return p.name || autoName(p); }
  function normLib(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.presets)) { throw new Error("This file isn't an Ease Inspector library."); }
    return { name: String(o.name || "Imported Eases"), presets: o.presets.map(normPreset) };
  }
  function cloneLib(l) { return normLib(JSON.parse(JSON.stringify(l))); }
  function libText(l) {
    return JSON.stringify({ format: "EaseInspectorLibrary", version: 1, name: l.name, presets: l.presets }, null, 2);
  }
  function loadLib(cb) {
    host("getLib", undefined, function (r) {
      if (!r.ok) { if (cb) { cb(false); } return; }
      try { S.lib = r.data ? normLib(JSON.parse(r.data)) : cloneLib(DEFAULT_LIB); }
      catch (e) { S.lib = cloneLib(DEFAULT_LIB); message("Your saved library couldn't be read, so the default library is shown. It won't be overwritten until you change something.", { error: true }); }
      renderLibrary();
      if (cb) { cb(true); }
    });
  }
  function saveLib(cb) {
    host("setLib", libText(S.lib), function (r) {
      if (!r.ok) { message("Couldn't save the library: " + r.msg, { error: true }); }
      if (cb) { cb(r.ok); }
    });
  }

  /* ---------- tile drawing + names ---------- */
  var measureCtx = document.createElement("canvas").getContext("2d");
  function textW(t, size) { measureCtx.font = size + "px 'Segoe UI', sans-serif"; return measureCtx.measureText(t).width; }
  function shortName(n) { var m = /^\s*In\s*(-?[\d.]+)\s*\/\s*Out\s*(-?[\d.]+)\s*$/i.exec(n); return m ? m[1] + "/" + m[2] : n; }
  function fitLabel(name, maxW) {
    var cands = [name, shortName(name), shortName(name).replace(/\s+/g, "")];
    var sizes = [9, 8];
    for (var z = 0; z < sizes.length; z++) {
      for (var c = 0; c < cands.length; c++) { if (textW(cands[c], sizes[z]) <= maxW) { return { t: cands[c], s: sizes[z] }; } }
    }
    var l = cands[2];
    while (l.length > 1 && textW(l + "…", 8) > maxW) { l = l.slice(0, -1); }
    return { t: l + "…", s: 8 };
  }
  function curveSVG(p) {
    var o = p.outInfl / 100, i = p.inInfl / 100;
    var x0 = 12, y0 = 10, w = 76, h = 58;
    var d = "M" + x0 + " " + (y0 + h) + " C" + (x0 + o * w) + " " + (y0 + h) + " " + (x0 + (1 - i) * w) + " " + y0 + " " + (x0 + w) + " " + y0;
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M' + x0 + ' ' + (y0 + h) + 'H' + (x0 + w) + '" stroke="#3d3d3d" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + '" stroke="' + C.acc + '" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"/></svg>';
  }
  function presetTip(p) { return dispName(p) + (p.name ? "" : " (automatic name)") + "\nIn " + fmt(p.inInfl) + "% @ " + fmt(p.inSpeed) + "   Out " + fmt(p.outInfl) + "% @ " + fmt(p.outSpeed) + "\nClick to apply. Drag to reorder."; }
  function paintTile(t, p, hover) {
    var w = t.clientWidth || 50;
    var name = t.querySelector(".name");
    if (hover) { name.textContent = fmt(p.inInfl) + "/" + fmt(p.outInfl); name.style.fontSize = "9px"; return; }
    var f = fitLabel(dispName(p), w - 4);
    name.textContent = f.t; name.style.fontSize = f.s + "px";
  }
  function makeTile(p, idx) {
    var t = el("div", "tile", curveSVG(p) + '<div class="name"></div>');
    t.title = presetTip(p);
    t.dataset.i = idx;
    t.onmouseenter = function () { if (!S.drag) { paintTile(t, p, true); } };
    t.onmouseleave = function () { paintTile(t, p, false); };
    t.addEventListener("pointerdown", function (e) { if (e.button !== 0) { return; } S.drag = { from: idx, x: e.clientX, y: e.clientY, moved: false, to: -1, after: false }; t.setPointerCapture(e.pointerId); });
    t.addEventListener("pointermove", function (e) {
      var d = S.drag; if (!d) { return; }
      if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) { d.moved = true; t.classList.add("dragSrc"); }
      if (!d.moved) { return; }
      clearDropMarks();
      var hit = document.elementFromPoint(e.clientX, e.clientY);
      var tt = hit && hit.closest ? hit.closest("#tiles .tile") : null;
      d.to = -1;
      if (tt && tt !== t) {
        var r = tt.getBoundingClientRect();
        d.to = Number(tt.dataset.i); d.after = e.clientX > r.left + r.width / 2;
        tt.classList.add(d.after ? "dropAfter" : "dropBefore");
      }
    });
    t.addEventListener("pointerup", function () {
      var d = S.drag; S.drag = null; t.classList.remove("dragSrc"); clearDropMarks();
      if (!d) { return; }
      if (!d.moved) { applyPreset(p); return; }
      if (d.to < 0) { return; }
      var to = d.to + (d.after ? 1 : 0);
      if (d.from < to) { to--; }
      if (to === d.from) { return; }
      var item = S.lib.presets.splice(d.from, 1)[0];
      S.lib.presets.splice(to, 0, item);
      renderLibrary(); saveLib();
      status("Moved “" + dispName(item) + "”");
    });
    t.addEventListener("pointercancel", function () { S.drag = null; t.classList.remove("dragSrc"); clearDropMarks(); });
    return t;
  }
  function clearDropMarks() { document.querySelectorAll(".dropBefore,.dropAfter").forEach(function (x) { x.classList.remove("dropBefore", "dropAfter"); }); }
  function renderLibrary() {
    if (!S.lib) { return; }
    $("libName").textContent = S.lib.name + "  (" + S.lib.presets.length + ")";
    var box = $("tiles"); box.innerHTML = "";
    if (!S.lib.presets.length) { box.appendChild(el("div", "empty-lib")).textContent = "No saved eases yet. Select a key and hit Save."; return; }
    S.lib.presets.forEach(function (p, i) { box.appendChild(makeTile(p, i)); });
    requestAnimationFrame(function () { box.querySelectorAll(".tile").forEach(function (t) { paintTile(t, S.lib.presets[Number(t.dataset.i)], false); }); });
  }

  /* ---------- key list ---------- */
  function joinVals(a) { var same = a.every(function (v) { return v === a[0]; }); return same ? fmt(a[0]) : a.map(fmt).join("/"); }
  function compact(type, infl, speed) {
    if (type === "Hold") { return "Hold"; }
    var s = joinVals(infl) + "%";
    var sp = joinVals(speed); if (sp !== "0") { s += " @" + sp; }
    if (type === "Linear") { s += " L"; }
    return s;
  }
  function renderList() {
    var thead = document.querySelector("#keyTable thead"), tbody = document.querySelector("#keyTable tbody");
    var wide = S.wide;
    thead.innerHTML = wide
      ? '<tr><th style="width:auto">Property</th><th style="width:70px">Time</th><th style="width:110px">Interp</th><th class="v" style="width:70px">In %</th><th class="v" style="width:66px">In speed</th><th class="v" style="width:70px">Out %</th><th class="v" style="width:66px">Out speed</th></tr>'
      : '<tr><th style="width:auto">Key</th><th class="v" style="width:28%">In</th><th class="v" style="width:28%">Out</th></tr>';
    var h = "";
    if (!S.rows.length) { h = '<tr><td class="empty" colspan="' + (wide ? 7 : 3) + '">' + esc($("status").textContent === "No active comp" ? "No active comp" : "Select keyframes to see their eases") + "</td></tr>"; }
    S.rows.forEach(function (r, i) {
      var cls = S.hl.indexOf(i) !== -1 ? ' class="sel"' : "";
      var lab = "#" + r.layer + " " + esc(r.prop);
      if (wide) {
        h += "<tr data-i=" + i + cls + "><td>" + lab + "</td><td>" + esc(r.time) + "</td><td>" + r.inType + " › " + r.outType + '</td><td class="v">' + joinVals(r.inI) + '</td><td class="v">' + joinVals(r.inS) + '</td><td class="v">' + joinVals(r.outI) + '</td><td class="v">' + joinVals(r.outS) + "</td></tr>";
      } else {
        h += "<tr data-i=" + i + cls + "><td><span class=l>" + esc(r.time) + "</span> " + lab + '</td><td class="v">' + compact(r.inType, r.inI, r.inS) + '</td><td class="v">' + compact(r.outType, r.outI, r.outS) + "</td></tr>";
      }
    });
    tbody.innerHTML = h;
  }
  document.querySelector("#keyTable tbody").addEventListener("mousedown", function (e) {
    var tr = e.target.closest("tr[data-i]"); if (!tr) { return; }
    var i = Number(tr.dataset.i);
    if (e.shiftKey && S.anchor >= 0) {
      var a = Math.min(S.anchor, i), b = Math.max(S.anchor, i); S.hl = [];
      for (var k = a; k <= b; k++) { S.hl.push(k); }
    } else if (e.ctrlKey || e.metaKey) {
      var at = S.hl.indexOf(i); if (at === -1) { S.hl.push(i); } else { S.hl.splice(at, 1); }
      S.anchor = i;
    } else {
      S.hl = (S.hl.length === 1 && S.hl[0] === i) ? [] : [i]; S.anchor = i;
    }
    renderList(); refreshFields(true);
  });

  /* ---------- fields ---------- */
  var FIELDS = ["inI", "inS", "outI", "outS"];
  var NAMES = { inI: "In influence", inS: "In speed", outI: "Out influence", outS: "Out speed" };
  function field(k) { return document.querySelector('#edit input[data-f="' + k + '"]'); }
  function targetRows() { return S.hl.length ? S.hl.map(function (i) { return S.rows[i]; }).filter(Boolean) : S.rows; }
  function shared(rows, key) {
    var v = null;
    for (var i = 0; i < rows.length; i++) { var a = rows[i][key]; for (var d = 0; d < a.length; d++) { var s = fmt(a[d]); if (v === null) { v = s; } else if (s !== v) { return ""; } } }
    return v === null ? "" : v;
  }
  function refreshFields(force) {
    var rows = targetRows();
    FIELDS.forEach(function (k) {
      var f = field(k);
      if (!force && S.dirty[k] && document.activeElement === f && document.hasFocus()) { return; }
      f.value = shared(rows, k); S.dirty[k] = false; f.classList.remove("dirty", "err");
    });
  }
  FIELDS.forEach(function (k) {
    var f = field(k);
    f.addEventListener("input", function () { S.dirty[k] = true; f.classList.add("dirty"); f.classList.remove("err"); });
    f.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyFields(); }
      else if (e.key === "Escape") { e.preventDefault(); refreshFields(true); f.blur(); }
    });
  });
  function selArg() { return { sel: S.hl.slice(), n: S.rows.length }; }
  function applyFields() {
    var a = selArg(), any = false, bad = null;
    FIELDS.forEach(function (k) {
      a[k] = null;
      if (!S.dirty[k]) { return; }
      var t = field(k).value.trim(); if (t === "") { return; }
      var v = parseFloat(t);
      if (isNaN(v)) { bad = bad || k; field(k).classList.add("err"); return; }
      if (k === "inI" || k === "outI") { v = clampInfl(v); }
      a[k] = v; any = true;
    });
    if (bad) { message(NAMES[bad] + " isn't a number.", { error: true, auto: 4000 }); return; }
    if (!any) { status("Type a value, then press Return"); return; }
    host("apply", a, function (r) {
      if (!r.ok) { message(r.msg, { error: true, auto: 5000 }); return; }
      status("Updated " + r.data + " key" + (r.data === 1 ? "" : "s"));
      FIELDS.forEach(function (k) { S.dirty[k] = false; field(k).classList.remove("dirty"); });
      poll(true, true);
    });
  }

  /* ---------- actions ---------- */
  function updateBadge() { $("badge").textContent = S.clipCount ? String(S.clipCount) : ""; }
  function onCopy() {
    host("copy", selArg(), function (r) {
      if (!r.ok) { message(r.msg, { error: !r.refused, auto: 4000 }); return; }
      S.clipCount = r.data; updateBadge(); status("Copied " + r.data + " ease" + (r.data === 1 ? "" : "s"));
    });
  }
  function onPaste(force) {
    var a = selArg(); a.force = !!force;
    host("paste", a, function (r) {
      if (r.ok) {
        var d = r.data;
        status((d.oneToMany ? "Pasted 1 ease onto " + d.count + " keys" : "Pasted " + d.count + " ease" + (d.count === 1 ? "" : "s")) + (d.diffs ? " (different properties)" : ""));
        poll(true, true); return;
      }
      if (r.propDiffs) {
        message("Pasting between different properties:\n" + r.propDiffs.join("\n") + "\nInfluence matches exactly, but speed uses each property's own units.", {
          buttons: [{ label: "Paste anyway", primary: true, fn: function () { onPaste(true); } }, { label: "Cancel" }] });
        return;
      }
      message(r.msg, { error: !r.refused, auto: r.mismatch ? 0 : 4000 });
    });
  }
  function onSave() {
    host("easeFromSource", selArg(), function (r) {
      if (!r.ok) { message(r.msg, { error: !r.refused, auto: 5000 }); return; }
      var p = normPreset(r.data);
      var box = $("prompt"); box.className = "prompt"; box.innerHTML = "";
      box.appendChild(el("span", "", "Name"));
      var inp = box.appendChild(el("input")); inp.value = ""; inp.placeholder = autoName(p) + " (automatic, or type a name)";
      var okB = box.appendChild(el("button", "tbtn text primary")); okB.textContent = "Save";
      var noB = box.appendChild(el("button", "tbtn text")); noB.textContent = "Cancel";
      function done(save) {
        box.className = "prompt hidden";
        if (!save) { return; }
        var name = inp.value.trim();
        var np = normPreset({ name: name, inInfl: p.inInfl, inSpeed: p.inSpeed, outInfl: p.outInfl, outSpeed: p.outSpeed });
        S.lib.presets.push(np); renderLibrary(); saveLib(); status("Saved “" + dispName(np) + "”");
      }
      okB.onclick = function () { done(true); }; noB.onclick = function () { done(false); };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { done(true); } else if (e.key === "Escape") { done(false); } });
      inp.focus(); inp.select();
    });
  }
  function applyPreset(p) {
    var a = selArg(); a.preset = { name: dispName(p), inInfl: p.inInfl, inSpeed: p.inSpeed, outInfl: p.outInfl, outSpeed: p.outSpeed };
    host("applyPreset", a, function (r) {
      if (!r.ok) { message(r.msg, { error: !r.refused, auto: 4000 }); return; }
      status(dispName(p) + " → " + r.data + " key" + (r.data === 1 ? "" : "s"));
      poll(true, true);
    });
  }

  /* ---------- polling ---------- */
  function rowsKeyOf(rows) { return JSON.stringify(rows); }
  function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(function () { poll(false, false); }, ms); }
  function nextDelay() { return document.hidden ? HIDDEN_MS : (S.rows.length ? FAST_MS : IDLE_MS); }
  function poll(force, manual) {
    if (S.inflight) { if (manual) { setTimeout(function () { poll(force, manual); }, 60); } return; }
    clearTimeout(S.timer);
    if (!manual && (!S.live || S.view !== "main" || document.hidden)) { if (S.live) { schedule(nextDelay()); } return; }
    S.inflight = true;
    host("read", !!force, function (r) {
      S.inflight = false;
      if (r === "SAME") {
        if (S.busyHint) { S.busyHint = false; status(S.rows.length ? S.rows.length + " key" + (S.rows.length === 1 ? "" : "s") + " selected" : "Select keyframes…"); }
      } else if (r && r.ok) {
        S.busyHint = false;
        var rows = r.data.rows, key = rowsKeyOf(rows);
        if (key !== S.rowsKey || force) {
          var sameShape = rows.length === S.rows.length;
          S.rows = rows; S.rowsKey = key;
          if (!sameShape) { S.hl = []; S.anchor = -1; }
          renderList(); refreshFields(false);
        }
        status(!r.data.comp ? "No active comp" : (rows.length ? rows.length + " key" + (rows.length === 1 ? "" : "s") + " selected" : "Select keyframes…"));
      } else if (r && r.refused) {
        if (!S.busyHint) { S.busyHint = true; status("After Effects is busy…"); }
      }
      if (S.live) { schedule(nextDelay()); }
    });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.live) { poll(false, false); } });

  /* ---------- layout ---------- */
  function applyLayout() {
    var wide = document.body.clientWidth >= WIDE_MIN;
    document.body.classList.toggle("collapsed", S.collapsed);
    $("toggle").innerHTML = S.collapsed ? ICON.open : ICON.closed;
    if (wide !== S.wide) { S.wide = wide; document.body.classList.toggle("wide", wide); renderList(); }
    renderLibrary();
  }
  var resizeT = 0;
  window.addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(applyLayout, 60); });

  /* ---------- manager ---------- */
  var M = { lib: null, sel: [], anchor: -1, pending: false };
  function mf(id) { return $(id); }
  function openManager() {
    M.lib = cloneLib(S.lib); M.sel = []; M.anchor = -1; M.pending = false;
    mf("mName").value = M.lib.name;
    clearEditor();
    S.view = "manager"; $("main").classList.add("hidden"); $("manager").classList.remove("hidden");
    renderMList();
  }
  function closeManager() {
    S.view = "main"; $("manager").classList.add("hidden"); $("main").classList.remove("hidden"); $("mMsg").className = "msg hidden";
    applyLayout(); poll(true, true);
  }
  function sideText(i, s) { var t = fmt(i) + "%"; if (fmt(s) !== "0") { t += " @" + fmt(s); } return t; }
  function renderMList() {
    var box = mf("mList"); box.innerHTML = "";
    M.lib.presets.forEach(function (p, i) {
      var r = el("div", "mrow" + (M.sel.indexOf(i) !== -1 ? " sel" : ""));
      r.innerHTML = '<span class="n"' + (p.name ? "" : ' style="color:#8a8a8a"') + '>' + esc(dispName(p)) + '</span><span class="v">' + sideText(p.inInfl, p.inSpeed) + '</span><span class="v">' + sideText(p.outInfl, p.outSpeed) + "</span>";
      r.onmousedown = function (e) {
        if (e.shiftKey && M.anchor >= 0) { var a = Math.min(M.anchor, i), b = Math.max(M.anchor, i); M.sel = []; for (var k = a; k <= b; k++) { M.sel.push(k); } }
        else if (e.ctrlKey || e.metaKey) { var at = M.sel.indexOf(i); if (at === -1) { M.sel.push(i); } else { M.sel.splice(at, 1); } M.anchor = i; }
        else { M.sel = [i]; M.anchor = i; }
        M.sel.sort(function (x, y) { return x - y; });
        if (M.sel.length === 1) { loadEditor(M.lib.presets[M.sel[0]]); }
        renderMList();
      };
      box.appendChild(r);
    });
    if (!M.lib.presets.length) { box.appendChild(el("div", "empty-lib", "&nbsp;No eases. Type values below and press Add.")); }
  }
  var EF = { name: "mfName", inI: "mfInI", inS: "mfInS", outI: "mfOutI", outS: "mfOutS" };
  function loadEditor(p) {
    mf(EF.name).value = p.name; mf(EF.inI).value = fmt(p.inInfl); mf(EF.inS).value = fmt(p.inSpeed); mf(EF.outI).value = fmt(p.outInfl); mf(EF.outS).value = fmt(p.outSpeed);
    M.pending = false; drawPreview();
  }
  function clearEditor() { loadEditor({ name: "", inInfl: 33.33, inSpeed: 0, outInfl: 33.33, outSpeed: 0 }); mf(EF.name).value = ""; drawPreview(); }
  function editorPreset(strict) {
    var keys = ["inI", "inS", "outI", "outS"];
    if (strict) {
      for (var i = 0; i < keys.length; i++) { var t = mf(EF[keys[i]]).value.trim(); if (t !== "" && isNaN(parseFloat(t))) { throw new Error(NAMES[keys[i]] + " isn't a number."); } }
    }
    return normPreset({ name: mf(EF.name).value, inInfl: mf(EF.inI).value, inSpeed: mf(EF.inS).value, outInfl: mf(EF.outI).value, outSpeed: mf(EF.outS).value });
  }
  function drawPreview() {
    var p = editorPreset(false), box = mf("mPreview");
    mf(EF.name).placeholder = autoName(p) + " (automatic)";
    box.innerHTML = curveSVG(p) + '<div class="name"></div>';
    requestAnimationFrame(function () { paintTile(box, p, false); });
  }
  Object.keys(EF).forEach(function (k) {
    var f = mf(EF[k]);
    f.addEventListener("input", function () {
      M.pending = true;
      drawPreview();
    });
    f.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (M.sel.length === 1) { mUpdate(); } else { mAdd(); } } });
  });
  function guardEdit(fn) { try { fn(); } catch (e) { message(e.message, { error: true, auto: 4000 }); } }
  function mAdd() { guardEdit(function () { M.lib.presets.push(editorPreset(true)); M.sel = [M.lib.presets.length - 1]; M.anchor = M.sel[0]; M.pending = false; renderMList(); }); }
  function mUpdate() {
    if (M.sel.length !== 1) { message("Select one ease to update.", { auto: 3000 }); return; }
    guardEdit(function () { M.lib.presets[M.sel[0]] = editorPreset(true); M.pending = false; renderMList(); });
  }
  function mRemove() {
    if (!M.sel.length) { return; }
    for (var i = M.sel.length - 1; i >= 0; i--) { M.lib.presets.splice(M.sel[i], 1); }
    var next = Math.min(M.sel[0], M.lib.presets.length - 1);
    M.sel = next >= 0 ? [next] : []; M.anchor = next;
    if (M.sel.length) { loadEditor(M.lib.presets[next]); } else { clearEditor(); }
    renderMList();
  }
  function mMove(dir) {
    if (M.sel.length !== 1) { return; }
    var a = M.sel[0], b = a + dir; if (b < 0 || b >= M.lib.presets.length) { return; }
    var t = M.lib.presets[a]; M.lib.presets[a] = M.lib.presets[b]; M.lib.presets[b] = t;
    M.sel = [b]; M.anchor = b; renderMList();
  }
  function mReset() {
    message("Replace this library with the 4 default eases?", { buttons: [{ label: "Reset", primary: true, fn: function () {
      M.lib = cloneLib(DEFAULT_LIB); mf("mName").value = M.lib.name; M.sel = []; clearEditor(); renderMList();
    } }, { label: "Cancel" }] });
  }
  function fsOK() { return window.cep && window.cep.fs; }
  function mExport() {
    if (!fsOK()) { message("File access isn't available in this version of After Effects.", { error: true }); return; }
    var name = (mf("mName").value.trim() || "Ease Library").replace(/[\\\/:*?"<>|]/g, "_");
    var r = window.cep.fs.showSaveDialogEx("Export ease library", "", ["json"], name + ".json");
    if (r.err || !r.data) { return; }
    var path = /\.json$/i.test(r.data) ? r.data : r.data + ".json";
    var lib = { name: mf("mName").value.trim() || "My Eases", presets: M.lib.presets };
    var w = window.cep.fs.writeFile(path, libText(lib));
    if (w.err) { message("Couldn't write the file (error " + w.err + ").", { error: true }); return; }
    message("Exported " + lib.presets.length + " eases to\n" + path, { auto: 5000 });
  }
  function mImport() {
    if (!fsOK()) { message("File access isn't available in this version of After Effects.", { error: true }); return; }
    var r = window.cep.fs.showOpenDialogEx(false, false, "Import ease library", "", ["json"]);
    if (r.err || !r.data || !r.data.length) { return; }
    var f = window.cep.fs.readFile(r.data[0]);
    if (f.err) { message("Couldn't read the file (error " + f.err + ").", { error: true }); return; }
    var inc;
    try { inc = normLib(JSON.parse(f.data)); } catch (e) { message("Couldn't import this file.\n" + (e instanceof SyntaxError ? "It isn't valid JSON." : e.message), { error: true }); return; }
    if (!inc.presets.length) { message("That library has no eases in it.", { error: true }); return; }
    message("Import “" + inc.name + "” (" + inc.presets.length + " eases)?", { buttons: [
      { label: "Replace", primary: true, fn: function () { M.lib = inc; mf("mName").value = inc.name; M.sel = []; clearEditor(); renderMList(); } },
      { label: "Add to library", fn: function () { M.lib.presets = M.lib.presets.concat(inc.presets); renderMList(); } },
      { label: "Cancel" }] });
  }
  function mSave() {
    if (M.pending && M.sel.length === 1) {
      try { M.lib.presets[M.sel[0]] = editorPreset(true); } catch (e) { message(e.message, { error: true }); return; }
    }
    M.lib.name = mf("mName").value.trim() || "My Eases";
    S.lib = M.lib;
    saveLib(function (ok) { if (ok) { closeManager(); status("Library saved"); } });
  }

  /* ---------- wiring ---------- */
  function init() {
    try {
      var env = JSON.parse(cep.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      document.documentElement.style.setProperty("--bg", "rgb(" + Math.round(c.red) + "," + Math.round(c.green) + "," + Math.round(c.blue) + ")");
    } catch (e) {}
    setIcon("copy", "copy"); setIcon("paste", "paste"); setIcon("save", "save"); setIcon("manage", "manage"); setIcon("refresh", "refresh");
    setIcon("mImport", "importLib"); setIcon("mExport", "exportLib"); setIcon("mReset", "reset");
    setIcon("mAdd", "add"); setIcon("mUpd", "update"); setIcon("mRem", "remove"); setIcon("mUp", "up"); setIcon("mDown", "down");
    fillIcons(document);

    $("toggle").onclick = function () { S.collapsed = !S.collapsed; localStorage.setItem("ei.collapsed", S.collapsed ? "1" : "0"); applyLayout(); };
    $("live").onchange = function () {
      S.live = this.checked;
      if (S.live) { poll(true, true); } else { clearTimeout(S.timer); status("Live off. Click Refresh to update."); }
    };
    $("refresh").onclick = function () { poll(true, true); };
    $("copy").onclick = onCopy;
    $("paste").onclick = function () { onPaste(false); };
    $("save").onclick = onSave;
    $("manage").onclick = openManager;
    $("mAdd").onclick = mAdd; $("mUpd").onclick = mUpdate; $("mRem").onclick = mRemove;
    $("mUp").onclick = function () { mMove(-1); }; $("mDown").onclick = function () { mMove(1); };
    $("mReset").onclick = mReset; $("mImport").onclick = mImport; $("mExport").onclick = mExport;
    $("mCancel").onclick = closeManager; $("mSave").onclick = mSave;

    applyLayout();
    renderList();
    var tries = 0;
    (function start() {
      loadLib(function (ok) {
        if (!ok && ++tries < 20) { setTimeout(start, 500); return; }
        host("clipCount", undefined, function (r) { if (r.ok) { S.clipCount = r.data; updateBadge(); } });
        poll(true, true);
      });
    })();
  }

  window.EaseInspectorUI = { state: S, poll: poll };
  init();
})();
