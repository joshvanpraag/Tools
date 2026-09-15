/*
    Hex Swap v1.0
    Find and replace hex colors across an After Effects project.

    INSTALL
      Windows: C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\
      macOS:   /Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/
      Restart After Effects, then open it from the Window menu > Hex Swap.jsx

      Copy / Save / Load need: Settings (Preferences) > Scripting & Expressions >
      "Allow Scripts to Write Files and Access Network".
*/

(function hexSwapPanel(thisObj) {
    var NAME = "Hex Swap";
    var VERSION = "1.0";
    var SETTINGS_SECTION = "HexSwap";
    var STATE_KEY = "state_v1";
    var REPORT_KEY = "lastReport_v1";
    var VISIBLE_ROWS = 8;
    var MAX_TOL = 64;
    var MAX_LOCS = 250;
    var IS_WIN = $.os.indexOf("Windows") !== -1;
    var ARROW = "\u2192";

    var CATS = [
        { key: "shapeFill", label: "Fill", abbr: "Shape Fill", group: "Shape Layers" },
        { key: "shapeStroke", label: "Stroke", abbr: "Shape Stroke", group: "Shape Layers" },
        { key: "gradients", label: "Gradients (report only)", abbr: "Gradient", group: "Shape Layers",
            tip: "Shape gradient colors can't be edited by scripts. They're listed in the report so you can change them by hand." },
        { key: "textFill", label: "Fill color", abbr: "Text Fill", group: "Text Layers",
            tip: "Includes per-character colors and Fill Color in text animators." },
        { key: "textStroke", label: "Stroke color", abbr: "Text Stroke", group: "Text Layers",
            tip: "Includes per-character colors and Stroke Color in text animators." },
        { key: "compBg", label: "Background color", abbr: "Comp BG", group: "Composition" },
        { key: "solids", label: "Solid colors", abbr: "Solid", group: "Layers",
            tip: "Changes the solid's source color, so it updates everywhere that solid is used." },
        { key: "lights", label: "Light colors", abbr: "Light", group: "Layers" },
        { key: "layerStyles", label: "Layer Styles", abbr: "Layer Style", group: "Layers",
            tip: "Drop Shadow, Stroke, Color Overlay, Glows, Bevel, Satin, and more." },
        { key: "effects", label: "Effect colors", abbr: "Effect", group: "Effects & Controls",
            tip: "Every color parameter on every effect (Fill, Tint, Tritone, Gradient Ramp, Glow, CC effects...)." },
        { key: "colorControls", label: "Color Controls / rigs", abbr: "Color Control", group: "Effects & Controls",
            tip: "Expression Controls > Color Control and pseudo-effect rig controls." },
        { key: "essentialProps", label: "Essential Properties", abbr: "Essential Prop", group: "Effects & Controls",
            tip: "Color overrides on precomp layers (Essential Graphics)." }
    ];

    /* ---------------- JSON ---------------- */

    var Json = (function () {
        var ESC = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
        function quote(s) {
            var out = '"';
            for (var i = 0; i < s.length; i++) {
                var c = s.charAt(i);
                if (ESC[c]) { out += ESC[c]; }
                else if (c < " ") { out += "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4); }
                else { out += c; }
            }
            return out + '"';
        }
        function ser(v, ind, cur) {
            if (v === null || v === undefined) { return "null"; }
            var t = typeof v;
            if (t === "number") { return isFinite(v) ? String(v) : "null"; }
            if (t === "boolean") { return v ? "true" : "false"; }
            if (t === "string") { return quote(v); }
            var nxt = cur + ind, nl = ind ? "\n" : "", sep = ind ? ": " : ":", parts = [], i, k;
            if (v instanceof Array) {
                for (i = 0; i < v.length; i++) { parts.push(nxt + ser(v[i], ind, nxt)); }
                return parts.length ? "[" + nl + parts.join("," + nl) + nl + cur + "]" : "[]";
            }
            for (k in v) {
                if (v.hasOwnProperty(k) && typeof v[k] !== "function") { parts.push(nxt + quote(k) + sep + ser(v[k], ind, nxt)); }
            }
            return parts.length ? "{" + nl + parts.join("," + nl) + nl + cur + "}" : "{}";
        }
        function parse(s) {
            var i = 0;
            var UNESC = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
            function fail(m) { throw new Error("Invalid JSON (" + m + ") at position " + i); }
            function ws() { while (i < s.length && " \t\r\n\ufeff".indexOf(s.charAt(i)) >= 0) { i++; } }
            function str() {
                var out = "";
                i++;
                while (i < s.length) {
                    var c = s.charAt(i++);
                    if (c === '"') { return out; }
                    if (c === "\\") {
                        var e = s.charAt(i++);
                        if (e === "u") { out += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
                        else { out += UNESC[e] || e; }
                    } else { out += c; }
                }
                fail("unterminated string");
            }
            function num() {
                var m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.substr(i, 40));
                if (!m) { fail("unexpected '" + s.charAt(i) + "'"); }
                i += m[0].length;
                return parseFloat(m[0]);
            }
            function arr() {
                var a = [];
                i++; ws();
                if (s.charAt(i) === "]") { i++; return a; }
                while (true) {
                    a.push(val()); ws();
                    var c = s.charAt(i++);
                    if (c === "]") { return a; }
                    if (c !== ",") { fail("expected , or ]"); }
                }
            }
            function obj() {
                var o = {};
                i++; ws();
                if (s.charAt(i) === "}") { i++; return o; }
                while (true) {
                    ws();
                    if (s.charAt(i) !== '"') { fail("expected key"); }
                    var k = str(); ws();
                    if (s.charAt(i++) !== ":") { fail("expected :"); }
                    o[k] = val(); ws();
                    var c = s.charAt(i++);
                    if (c === "}") { return o; }
                    if (c !== ",") { fail("expected , or }"); }
                }
            }
            function val() {
                ws();
                var c = s.charAt(i);
                if (c === "{") { return obj(); }
                if (c === "[") { return arr(); }
                if (c === '"') { return str(); }
                if (s.substr(i, 4) === "true") { i += 4; return true; }
                if (s.substr(i, 5) === "false") { i += 5; return false; }
                if (s.substr(i, 4) === "null") { i += 4; return null; }
                return num();
            }
            var r = val(); ws();
            if (i < s.length) { fail("trailing characters"); }
            return r;
        }
        return { stringify: function (v, ind) { return ser(v, ind || "", ""); }, parse: parse };
    })();

    /* ---------------- Helpers ---------------- */

    function trim(s) { return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, ""); }
    function clampInt(v, lo, hi) { v = Math.round(Number(v)); if (isNaN(v)) { v = lo; } return v < lo ? lo : (v > hi ? hi : v); }
    function pad2(n) { return (n < 10 ? "0" : "") + n; }
    function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
    function userError(msg) { var e = new Error(msg); e.userMsg = msg; return e; }
    function catShort(key) { for (var i = 0; i < CATS.length; i++) { if (CATS[i].key === key) { return CATS[i].abbr; } } return key; }
    function catNames(keys) { var out = []; for (var i = 0; i < keys.length; i++) { out.push(catShort(keys[i])); } return out.join(", "); }
    function tolLabel(t) { return t === 0 ? "exact match" : "\u00B1" + t + " per channel"; }

    /* ---------------- Color math ---------------- */

    function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

    function parseHex(str) {
        var s = trim(str).replace(/^#/, "").replace(/^0x/i, "");
        if (/^[0-9a-f]{3}$/i.test(s)) { s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2); }
        if (!/^[0-9a-f]{6}$/i.test(s)) { return null; }
        return "#" + s.toUpperCase();
    }
    function hexToRgb(hex) { var s = hex.substr(1); return [parseInt(s.substr(0, 2), 16), parseInt(s.substr(2, 2), 16), parseInt(s.substr(4, 2), 16)]; }
    function rgbToHex(rgb) {
        var out = "#";
        for (var i = 0; i < 3; i++) { out += ("0" + rgb[i].toString(16)).slice(-2); }
        return out.toUpperCase();
    }
    function valueToRgb(v, mode) {
        var out = [];
        for (var i = 0; i < 3; i++) {
            var c = v[i];
            if (typeof c !== "number" || c < -0.0005 || c > 1.0005) { return null; }
            c = c < 0 ? 0 : (c > 1 ? 1 : c);
            if (mode === 1) { c = linearToSrgb(c); }
            out.push(Math.round(c * 255));
        }
        return out;
    }
    function hexToValue(hex, mode, template) {
        var rgb = hexToRgb(hex), out = [];
        for (var i = 0; i < 3; i++) {
            var c = rgb[i] / 255;
            if (mode === 1) { c = srgbToLinear(c); }
            out.push(c);
        }
        if (template && template.length > 3) { out.push(template[3]); }
        return out;
    }
    function sameColor(a, b) {
        if (a === undefined || b === undefined) { return a === b; }
        for (var i = 0; i < 3; i++) { if (Math.abs(a[i] - b[i]) > 0.000001) { return false; } }
        return true;
    }
    function fmtVal(v) { var o = []; for (var i = 0; i < 3; i++) { o.push(Number(v[i]).toFixed(3)); } return o.join(", "); }

    /* ---------------- Swap list parsing ---------------- */

    function blankMapping() { return { from: "", to: "", on: true }; }
    function isBlank(m) { return trim(m.from) === "" && trim(m.to) === ""; }

    function parseSwapText(text) {
        var lines = String(text).split(/\r\n|\r|\n/), out = [];
        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i]);
            if (!line || line.charAt(0) === ";" || line.substr(0, 2) === "//") { continue; }
            var re = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])|(?:0x|\b)([0-9a-fA-F]{6})\b/g, m, hexes = [];
            while ((m = re.exec(line)) !== null) { hexes.push(parseHex(m[1] || m[2])); }
            if (hexes.length) { out.push({ from: hexes[0], to: hexes.length > 1 ? hexes[1] : "", on: true }); }
        }
        return out;
    }

    function sanitizeMappings(arr) {
        var out = [];
        if (arr instanceof Array) {
            for (var i = 0; i < arr.length; i++) {
                var m = arr[i];
                if (m && typeof m === "object") { out.push({ from: String(m.from || ""), to: String(m.to || ""), on: m.on !== false }); }
            }
        }
        if (!out.length) { out.push(blankMapping()); }
        return out;
    }

    function buildRules(st) {
        var rules = [], errors = [], warnings = [], seen = {};
        for (var i = 0; i < st.mappings.length; i++) {
            var m = st.mappings[i];
            if (!m.on || isBlank(m)) { continue; }
            var fs = trim(m.from), ts = trim(m.to), f = parseHex(fs), t = parseHex(ts);
            if (!f) { errors.push("Row " + (i + 1) + ": old hex " + (fs ? "\"" + fs + "\" is not a valid hex code" : "is empty")); }
            if (!t) { errors.push("Row " + (i + 1) + ": new hex " + (ts ? "\"" + ts + "\" is not a valid hex code" : "is empty")); }
            if (!f || !t) { continue; }
            if (seen[f]) { warnings.push("Row " + (i + 1) + ": " + f + " is already used in row " + seen[f] + ", so row " + (i + 1) + " was ignored."); continue; }
            if (f === t) { warnings.push("Row " + (i + 1) + ": old and new are both " + f + " (no change)."); }
            seen[f] = i + 1;
            rules.push({ row: i + 1, from: f, to: t, rgb: hexToRgb(f), hits: 0, locs: [], more: 0 });
        }
        return { rules: rules, errors: errors, warnings: warnings };
    }

    function matchRule(rgb, rules, tol) {
        var best = null, bestD = 9999;
        for (var i = 0; i < rules.length; i++) {
            var r = rules[i].rgb;
            var d = Math.max(Math.abs(rgb[0] - r[0]), Math.abs(rgb[1] - r[1]), Math.abs(rgb[2] - r[2]));
            if (d <= tol && d < bestD) { best = rules[i]; bestD = d; }
        }
        return best;
    }

    /* ---------------- Engine ---------------- */

    function Ctx(st, mode, rules) {
        this.mode = mode;
        this.apply = mode === "apply";
        this.cats = st.cats;
        this.keyframes = st.keyframes;
        this.colorMode = st.colorMode;
        this.tol = st.tolerance;
        this.rules = rules;
        this.found = {};
        this.foundOrder = [];
        this.catHits = {};
        this.total = 0;
        this.exprSkipped = [];
        this.keyedSkipped = [];
        this.gradients = [];
        this.outOfRange = [];
        this.errors = [];
        this.warnings = [];
        this.seenSolids = {};
        this.relock = [];
        this.unlocked = 0;
        this.prefix = "";
        this.comp = null;
        this.comps = [];
    }

    function collectComps(st) {
        var list = [], seen = {};
        function addComp(c, recurse) {
            if (seen[c.id]) { return; }
            seen[c.id] = true;
            list.push(c);
            if (!recurse) { return; }
            for (var i = 1; i <= c.numLayers; i++) {
                var L = c.layer(i);
                if (L instanceof AVLayer && L.source instanceof CompItem) { addComp(L.source, true); }
            }
        }
        function addFolder(f) {
            for (var i = 1; i <= f.numItems; i++) {
                var it = f.item(i);
                if (it instanceof CompItem) { addComp(it, st.nested); }
                else if (it instanceof FolderItem) { addFolder(it); }
            }
        }
        var i;
        if (st.scope === 0) {
            for (i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i) instanceof CompItem) { addComp(app.project.item(i), false); }
            }
        } else {
            var sel = app.project.selection;
            for (i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) { addComp(sel[i], st.nested); }
                else if (sel[i] instanceof FolderItem) { addFolder(sel[i]); }
            }
        }
        return list;
    }

    function recordFound(ctx, hex, cat, loc) {
        var f = ctx.found[hex];
        if (!f) {
            f = { hex: hex, count: 0, cats: {}, catOrder: [], locs: [], more: 0 };
            ctx.found[hex] = f;
            ctx.foundOrder.push(hex);
        }
        f.count++;
        if (!f.cats[cat]) { f.cats[cat] = true; f.catOrder.push(cat); }
        if (f.locs.length < MAX_LOCS) { f.locs.push(loc); } else { f.more++; }
    }

    function evalColor(ctx, v, cat, loc, seen, silent) {
        var rgb = valueToRgb(v, ctx.colorMode);
        if (!rgb) {
            if (!silent) { ctx.outOfRange.push(loc + "  [" + fmtVal(v) + "]"); }
            return null;
        }
        var hex = rgbToHex(rgb);
        if (!silent && !seen[hex]) { seen[hex] = true; recordFound(ctx, hex, cat, loc); }
        if (!ctx.rules.length) { return null; }
        var r = matchRule(rgb, ctx.rules, ctx.tol);
        if (!r || r.to === hex) { return null; }
        r.hits++;
        if (r.locs.length < MAX_LOCS) { r.locs.push(loc + (hex !== r.from ? "  (was " + hex + ")" : "")); } else { r.more++; }
        ctx.catHits[cat] = (ctx.catHits[cat] || 0) + 1;
        ctx.total++;
        return hexToValue(r.to, ctx.colorMode, v);
    }

    function propPath(p) {
        var names = [], q = p;
        while (q && q.propertyDepth > 0) { names.unshift(q.name); q = q.parentProperty; }
        return names.join(" > ");
    }

    function keyLabel(ctx, p, k) { return " @ key " + k + " (" + timeToCurrentFormat(p.keyTime(k), ctx.comp.frameRate) + ")"; }

    function unlockLayer(ctx, layer) {
        if (layer.locked) { layer.locked = false; ctx.relock.push(layer); ctx.unlocked++; }
    }
    function relockLayers(ctx) {
        for (var i = 0; i < ctx.relock.length; i++) { ctx.relock[i].locked = true; }
        ctx.relock = [];
    }

    function hasExpression(p) { return p.canSetExpression && p.expressionEnabled && trim(p.expression) !== ""; }

    function processColorProp(ctx, p, cat, layer) {
        if (!ctx.cats[cat] || !p.canSetExpression) { return; }
        var loc = ctx.prefix + " > " + propPath(p);
        try {
            if (hasExpression(p)) {
                var rgb = valueToRgb(p.value, ctx.colorMode);
                ctx.exprSkipped.push({ loc: loc, hex: rgb ? rgbToHex(rgb) : "", expr: p.expression, cat: cat });
                return;
            }
            if (p.numKeys > 0) {
                if (!ctx.keyframes) { ctx.keyedSkipped.push(loc + "  (" + p.numKeys + " keys)"); return; }
                var seen = {};
                for (var k = 1; k <= p.numKeys; k++) {
                    var nv = evalColor(ctx, p.keyValue(k), cat, loc + keyLabel(ctx, p, k), seen, false);
                    if (nv && ctx.apply) { unlockLayer(ctx, layer); p.setValueAtKey(k, nv); }
                }
            } else {
                var nv2 = evalColor(ctx, p.value, cat, loc, {}, false);
                if (nv2 && ctx.apply) { unlockLayer(ctx, layer); p.setValue(nv2); }
            }
        } catch (e) {
            ctx.errors.push(loc + ": " + e.message);
        }
    }

    function colorVisitor(ctx, cat, layer) {
        return function (p) {
            if (p.propertyValueType === PropertyValueType.COLOR) { processColorProp(ctx, p, cat, layer); }
        };
    }

    function walkProps(group, visit) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            if (!p) { continue; }
            if (p.propertyType === PropertyType.PROPERTY) { visit(p); } else { walkProps(p, visit); }
        }
    }

    function textKinds(ctx) {
        var kinds = [];
        if (ctx.cats.textFill) { kinds.push({ cat: "textFill", color: "fillColor", use: "applyFill" }); }
        if (ctx.cats.textStroke) { kinds.push({ cat: "textStroke", color: "strokeColor", use: "applyStroke" }); }
        return kinds;
    }

    function processTextDoc(ctx, td, loc, seen) {
        var kinds = textKinds(ctx), changed = false, len = td.text.length, k, nv;
        if (typeof td.characterRange !== "function" || len === 0) {
            for (k = 0; k < kinds.length; k++) {
                if (!td[kinds[k].use]) { continue; }
                nv = evalColor(ctx, td[kinds[k].color], kinds[k].cat, loc, seen, false);
                if (nv) { td[kinds[k].color] = [nv[0], nv[1], nv[2]]; changed = true; }
            }
            return changed;
        }
        for (k = 0; k < kinds.length; k++) {
            var kind = kinds[k];
            var whole = td.characterRange(0, len);
            var wc = whole[kind.color], wu = whole[kind.use];
            if (wu === false) { continue; }
            if (wu === true && wc !== undefined) {
                nv = evalColor(ctx, wc, kind.cat, loc, seen, false);
                if (nv) { whole[kind.color] = [nv[0], nv[1], nv[2]]; changed = true; }
                continue;
            }
            var i = 0;
            while (i < len) {
                var cr = td.characterRange(i, i + 1), c = cr[kind.color], u = cr[kind.use], j = i + 1;
                while (j < len) {
                    var nx = td.characterRange(j, j + 1);
                    if (nx[kind.use] !== u || !sameColor(nx[kind.color], c)) { break; }
                    j++;
                }
                if (u && c !== undefined) {
                    var visible = /\S/.test(td.text.substring(i, j));
                    nv = evalColor(ctx, c, kind.cat, loc + "  (characters " + (i + 1) + "-" + j + ")", seen, !visible);
                    if (nv) { td.characterRange(i, j)[kind.color] = [nv[0], nv[1], nv[2]]; changed = true; }
                }
                i = j;
            }
        }
        return changed;
    }

    function processTextProp(ctx, p, layer) {
        var loc = ctx.prefix + " > Source Text";
        try {
            if (hasExpression(p)) {
                ctx.exprSkipped.push({ loc: loc, hex: "", expr: p.expression, cat: "textFill" });
                return;
            }
            if (p.numKeys > 0) {
                if (!ctx.keyframes) { ctx.keyedSkipped.push(loc + "  (" + p.numKeys + " keys)"); return; }
                var seen = {};
                for (var k = 1; k <= p.numKeys; k++) {
                    var td = p.keyValue(k);
                    if (processTextDoc(ctx, td, loc + keyLabel(ctx, p, k), seen) && ctx.apply) { unlockLayer(ctx, layer); p.setValueAtKey(k, td); }
                }
            } else {
                var td2 = p.value;
                if (processTextDoc(ctx, td2, loc, {}) && ctx.apply) { unlockLayer(ctx, layer); p.setValue(td2); }
            }
        } catch (e) {
            ctx.errors.push(loc + ": " + e.message);
        }
    }

    function processLayer(ctx, layer, comp) {
        var c = ctx.cats;
        ctx.prefix = comp.name + " > [" + layer.index + "] " + layer.name;

        if (layer instanceof LightLayer) {
            if (c.lights) {
                var lo = layer.property("ADBE Light Options Group");
                if (lo) { walkProps(lo, colorVisitor(ctx, "lights", layer)); }
            }
            return;
        }
        if (layer instanceof CameraLayer) { return; }

        if (layer instanceof ShapeLayer && (c.shapeFill || c.shapeStroke || c.gradients)) {
            walkProps(layer.property("ADBE Root Vectors Group"), function (p) {
                var parentMN = p.parentProperty.matchName;
                if (p.propertyValueType === PropertyValueType.COLOR) {
                    processColorProp(ctx, p, parentMN === "ADBE Vector Graphic - Stroke" ? "shapeStroke" : "shapeFill", layer);
                } else if (p.matchName === "ADBE Vector Grad Colors" && c.gradients) {
                    ctx.gradients.push(ctx.prefix + " > " + propPath(p.parentProperty) +
                        (parentMN === "ADBE Vector Graphic - G-Stroke" ? "  (gradient stroke)" : "  (gradient fill)"));
                }
            });
        }

        if (layer instanceof TextLayer && (c.textFill || c.textStroke)) {
            var tp = layer.property("ADBE Text Properties");
            processTextProp(ctx, tp.property("ADBE Text Document"), layer);
            var anim = tp.property("ADBE Text Animators");
            if (anim) {
                walkProps(anim, function (p) {
                    if (p.propertyValueType !== PropertyValueType.COLOR) { return; }
                    processColorProp(ctx, p, p.matchName.indexOf("Stroke") !== -1 ? "textStroke" : "textFill", layer);
                });
            }
        }

        if (c.effects || c.colorControls) {
            var fx = layer.property("ADBE Effect Parade");
            if (fx) {
                for (var e = 1; e <= fx.numProperties; e++) {
                    var eff = fx.property(e);
                    var isCtl = eff.matchName === "ADBE Color Control" || eff.matchName.indexOf("Pseudo/") === 0;
                    var cat = isCtl ? "colorControls" : "effects";
                    if (c[cat]) { walkProps(eff, colorVisitor(ctx, cat, layer)); }
                }
            }
        }

        if (c.layerStyles) {
            var ls = layer.property("ADBE Layer Styles");
            if (ls && ls.canSetEnabled) {
                for (var s = 1; s <= ls.numProperties; s++) {
                    var sty = ls.property(s);
                    if (sty.matchName === "ADBE Blend Options Group" || !sty.canSetEnabled) { continue; }
                    walkProps(sty, colorVisitor(ctx, "layerStyles", layer));
                }
            }
        }

        if (c.essentialProps) {
            var ov = layer.property("ADBE Layer Overrides");
            if (ov) { walkProps(ov, colorVisitor(ctx, "essentialProps", layer)); }
        }

        if (c.solids && layer.source && !layer.nullLayer && !layer.adjustmentLayer &&
                layer.source instanceof FootageItem && layer.source.mainSource instanceof SolidSource) {
            var src = layer.source;
            if (!ctx.seenSolids[src.id]) {
                ctx.seenSolids[src.id] = true;
                var sloc = "Solid \"" + src.name + "\" (used in " + ctx.prefix + ")";
                try {
                    var nv = evalColor(ctx, src.mainSource.color, "solids", sloc, {}, false);
                    if (nv && ctx.apply) { src.mainSource.color = [nv[0], nv[1], nv[2]]; }
                } catch (err) {
                    ctx.errors.push(sloc + ": " + err.message);
                }
            }
        }
    }

    function processComp(ctx, comp) {
        ctx.comp = comp;
        if (ctx.cats.compBg) {
            var loc = comp.name + " > Background Color";
            try {
                var nv = evalColor(ctx, comp.bgColor, "compBg", loc, {}, false);
                if (nv && ctx.apply) { comp.bgColor = [nv[0], nv[1], nv[2]]; }
            } catch (e) {
                ctx.errors.push(loc + ": " + e.message);
            }
        }
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            try {
                processLayer(ctx, layer, comp);
            } catch (e2) {
                ctx.errors.push(comp.name + " > [" + i + "] " + layer.name + ": " + e2.message);
            }
            relockLayers(ctx);
        }
    }

    function makeProgress(total, label) {
        if (total < 4) { return null; }
        var w = new Window("palette", NAME, undefined, { closeButton: false });
        w.alignChildren = ["fill", "top"];
        var t = w.add("statictext", undefined, label);
        t.preferredSize = [340, 18];
        var b = w.add("progressbar", undefined, 0, total);
        b.preferredSize = [340, 10];
        w.show();
        return { w: w, t: t, b: b };
    }

    function runEngine(st, mode) {
        var rules = [], warnings = [];
        if (mode !== "scan") {
            var rb = buildRules(st);
            if (rb.errors.length) { throw userError("Please fix these swap rows first:\n\n" + rb.errors.join("\n")); }
            if (!rb.rules.length) { throw userError("Add at least one active swap (old hex and new hex) on the Swap tab."); }
            rules = rb.rules;
            warnings = rb.warnings;
        }
        if (!app.project) { throw userError("Open a project first."); }
        var comps = collectComps(st);
        if (!comps.length) {
            throw userError(st.scope === 1 ?
                "Nothing selected. Select one or more comps (or folders containing comps) in the Project panel, then try again." :
                "This project has no compositions.");
        }
        var ctx = new Ctx(st, mode, rules);
        ctx.warnings = warnings;
        ctx.comps = comps;
        var verb = mode === "scan" ? "Scanning" : (mode === "preview" ? "Previewing" : "Swapping");
        var prog = makeProgress(comps.length, verb + "...");
        var t0 = new Date().getTime();
        if (ctx.apply) { app.beginUndoGroup(NAME); }
        try {
            for (var i = 0; i < comps.length; i++) {
                if (prog) { prog.b.value = i; prog.t.text = verb + " " + (i + 1) + "/" + comps.length + ": " + comps[i].name; prog.w.update(); }
                processComp(ctx, comps[i]);
            }
        } finally {
            relockLayers(ctx);
            if (ctx.apply) { app.endUndoGroup(); }
            if (prog) { prog.w.close(); }
        }
        ctx.seconds = (new Date().getTime() - t0) / 1000;
        return ctx;
    }

    function sortedFound(ctx, sortMode) {
        var list = [];
        for (var i = 0; i < ctx.foundOrder.length; i++) { list.push(ctx.found[ctx.foundOrder[i]]); }
        list.sort(function (a, b) {
            if (sortMode === 0 && a.count !== b.count) { return b.count - a.count; }
            return a.hex < b.hex ? -1 : (a.hex > b.hex ? 1 : 0);
        });
        return list;
    }

    /* ---------------- Report ---------------- */

    function scopeLabel(st) {
        return st.scope === 0 ? "Entire project" : "Selected comps/folders" + (st.nested ? " + nested precomps" : " (no nested precomps)");
    }
    function enabledCats(st) {
        var out = [];
        for (var i = 0; i < CATS.length; i++) { if (st.cats[CATS[i].key]) { out.push(CATS[i].abbr); } }
        return out.length ? out.join(", ") : "(nothing)";
    }

    function linearizedLabel() {
        try { return app.project.linearizeWorkingSpace ? "ON - rendered colors differ from picker values; try Linear mode to match rendered hexes" : "off"; }
        catch (e) { return "unknown"; }
    }

    function buildReport(ctx, st, mode) {
        var L = [], i, j;
        var title = mode === "scan" ? "SCAN" : (mode === "preview" ? "PREVIEW (no changes made)" : "APPLY");
        L.push("HEX SWAP REPORT - " + title);
        L.push("Date:        " + fmtDate(new Date()));
        L.push("Project:     " + (app.project.file ? app.project.file.fsName : "(unsaved project)"));
        L.push("Scope:       " + scopeLabel(st) + " - " + ctx.comps.length + " comp(s)");
        L.push("Looking in:  " + enabledCats(st));
        L.push("Keyframes:   " + (st.keyframes ? "included" : "skipped"));
        L.push("Color mode:  " + (st.colorMode === 1 ? "Linear" : "Standard") + "     Tolerance: " + tolLabel(st.tolerance));
        L.push("Linearized:  " + linearizedLabel());
        L.push("Time:        " + ctx.seconds.toFixed(1) + " s");
        L.push("");

        if (mode === "scan") {
            var list = sortedFound(ctx, st.sort);
            L.push("COLORS FOUND (" + list.length + " unique)");
            if (!list.length) { L.push("  No colors found for the selected categories."); }
            for (i = 0; i < list.length; i++) {
                var f = list[i];
                L.push("  " + f.hex + "   " + f.count + " use(s)   [" + catNames(f.catOrder) + "]");
                for (j = 0; j < f.locs.length; j++) { L.push("      - " + f.locs[j]); }
                if (f.more) { L.push("      ... and " + f.more + " more"); }
            }
        } else {
            var verb = mode === "apply" ? "changed" : "would change";
            L.push("SWAPS - " + ctx.total + " value(s) " + verb + "  (all swaps run at the same time)");
            for (i = 0; i < ctx.rules.length; i++) {
                var r = ctx.rules[i];
                L.push("  Row " + r.row + ":  " + r.from + " -> " + r.to + "   " + r.hits + " value(s)");
                for (j = 0; j < r.locs.length; j++) { L.push("      - " + r.locs[j]); }
                if (r.more) { L.push("      ... and " + r.more + " more"); }
            }
            if (ctx.total === 0) { L.push("  No matching colors were found in scope."); }
            L.push("");
            L.push("BY CATEGORY");
            var any = false;
            for (i = 0; i < CATS.length; i++) {
                if (ctx.catHits[CATS[i].key]) { L.push("  " + CATS[i].abbr + ": " + ctx.catHits[CATS[i].key]); any = true; }
            }
            if (!any) { L.push("  (none)"); }
            if (ctx.warnings.length) {
                L.push("");
                L.push("WARNINGS");
                for (i = 0; i < ctx.warnings.length; i++) { L.push("  - " + ctx.warnings[i]); }
            }
        }

        if (ctx.exprSkipped.length) {
            L.push("");
            L.push("SKIPPED - EXPRESSION-DRIVEN (" + ctx.exprSkipped.length + ")");
            L.push("  These colors come from expressions and were not changed. Edit the expression or its source instead.");
            for (i = 0; i < ctx.exprSkipped.length; i++) {
                var x = ctx.exprSkipped[i];
                L.push("  - " + x.loc + (x.hex ? "   [currently " + x.hex + "]" : ""));
                var exLines = String(x.expr).split(/\r\n|\r|\n/);
                L.push("      expression:");
                for (j = 0; j < exLines.length && j < 40; j++) { L.push("        " + exLines[j]); }
                if (exLines.length > 40) { L.push("        ... (" + (exLines.length - 40) + " more lines)"); }
            }
        }
        if (ctx.keyedSkipped.length) {
            L.push("");
            L.push("SKIPPED - KEYFRAMED (keyframed colors are turned off) (" + ctx.keyedSkipped.length + ")");
            for (i = 0; i < ctx.keyedSkipped.length; i++) { L.push("  - " + ctx.keyedSkipped[i]); }
        }
        if (ctx.gradients.length) {
            L.push("");
            L.push("GRADIENTS - scripts can't read or edit these, so change them by hand (" + ctx.gradients.length + ")");
            for (i = 0; i < ctx.gradients.length; i++) { L.push("  - " + ctx.gradients[i]); }
        }
        if (ctx.outOfRange.length) {
            L.push("");
            L.push("SKIPPED - OVER-BRIGHT / 32-BPC VALUES outside the hex range (" + ctx.outOfRange.length + ")");
            for (i = 0; i < ctx.outOfRange.length; i++) { L.push("  - " + ctx.outOfRange[i]); }
        }
        if (ctx.unlocked) {
            L.push("");
            L.push("NOTE: " + ctx.unlocked + " locked layer(s) were unlocked briefly to change them, then locked again.");
        }
        if (ctx.errors.length) {
            L.push("");
            L.push("ERRORS (" + ctx.errors.length + ")");
            for (i = 0; i < ctx.errors.length; i++) { L.push("  - " + ctx.errors[i]); }
        }
        L.push("");
        L.push("COMPS IN SCOPE (" + ctx.comps.length + ")");
        for (i = 0; i < ctx.comps.length && i < 200; i++) { L.push("  - " + ctx.comps[i].name); }
        if (ctx.comps.length > 200) { L.push("  ... and " + (ctx.comps.length - 200) + " more"); }
        return L.join("\n");
    }

    /* ---------------- Files & clipboard ---------------- */

    function filesAllowed() {
        var ok = true;
        try { ok = app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1; } catch (e) { ok = true; }
        if (!ok) {
            alert("To save, load, or copy, turn on:\n\n" + (IS_WIN ? "Edit" : "After Effects") +
                " > Settings (Preferences) > Scripting & Expressions >\n\"Allow Scripts to Write Files and Access Network\"", NAME);
        }
        return ok;
    }
    function writeTextFile(f, text) {
        f.encoding = "UTF-8";
        f.lineFeed = IS_WIN ? "Windows" : "Unix";
        if (!f.open("w")) { alert("Couldn't write the file:\n" + f.fsName, NAME); return false; }
        f.write(text);
        f.close();
        return true;
    }
    function readTextFile(f) {
        f.encoding = "UTF-8";
        if (!f.open("r")) { alert("Couldn't read the file:\n" + f.fsName, NAME); return null; }
        var s = f.read();
        f.close();
        return s.replace(/^\ufeff/, "");
    }
    function copyToClipboard(text) {
        if (!filesAllowed()) { return false; }
        var f = new File(Folder.temp.fsName + "/HexSwap_clipboard.txt");
        if (!writeTextFile(f, text)) { return false; }
        if (IS_WIN) {
            system.callSystem("powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command \"Get-Content -Raw -Encoding UTF8 -LiteralPath '" +
                f.fsName.replace(/'/g, "''") + "' | Set-Clipboard\"");
        } else {
            system.callSystem("LANG=en_US.UTF-8 pbcopy < \"" + f.fsName + "\"");
        }
        return true;
    }
    function fileFilter(exts, label) {
        if (IS_WIN) {
            var parts = [];
            for (var i = 0; i < exts.length; i++) { parts.push(label[i] + ":*." + exts[i]); }
            parts.push("All files:*.*");
            return parts.join(",");
        }
        return function (f) {
            if (f instanceof Folder) { return true; }
            for (var j = 0; j < exts.length; j++) { if (new RegExp("\\." + exts[j] + "$", "i").test(f.name)) { return true; } }
            return false;
        };
    }
    function stamp() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + pad2(d.getMinutes()); }

    function saveReportFile(text) {
        if (!filesAllowed()) { return; }
        var f = new File(Folder.myDocuments.fsName + "/HexSwap Report " + stamp() + ".txt").saveDlg("Save Hex Swap report", fileFilter(["txt"], ["Text"]));
        if (!f) { return; }
        if (!/\.txt$/i.test(f.name)) { f = new File(f.fsName + ".txt"); }
        if (writeTextFile(f, text)) { alert("Report saved:\n" + f.fsName, NAME); }
    }

    function showReport(text, title) {
        var d = new Window("dialog", NAME + " - " + title, undefined, { resizeable: true });
        d.orientation = "column";
        d.alignChildren = ["fill", "fill"];
        var et = d.add("edittext", undefined, text, { multiline: true, scrolling: true });
        et.preferredSize = [700, 460];
        var g = d.add("group");
        g.alignment = ["fill", "bottom"];
        var bCopy = g.add("button", undefined, "Copy to Clipboard");
        var bSave = g.add("button", undefined, "Save as .txt...");
        var msg = g.add("statictext", undefined, "");
        msg.alignment = ["fill", "center"];
        var bClose = g.add("button", undefined, "Close", { name: "ok" });
        bCopy.onClick = function () { if (copyToClipboard(et.text)) { msg.text = "Copied to clipboard."; } };
        bSave.onClick = function () { saveReportFile(et.text); };
        bClose.onClick = function () { d.close(); };
        d.onResizing = d.onResize = function () { this.layout.resize(); };
        d.show();
    }

    /* ---------------- State ---------------- */

    function defaultState() {
        var cats = {};
        for (var i = 0; i < CATS.length; i++) { cats[CATS[i].key] = true; }
        return { scope: 0, nested: true, cats: cats, keyframes: true, colorMode: 0, tolerance: 0, sort: 0, tab: 0, mappings: [blankMapping()] };
    }

    function loadState() {
        var st = defaultState(), saved, k;
        if (!app.settings.haveSetting(SETTINGS_SECTION, STATE_KEY)) { return st; }
        try { saved = Json.parse(app.settings.getSetting(SETTINGS_SECTION, STATE_KEY)); } catch (e) { return st; }
        if (!saved || typeof saved !== "object") { return st; }
        for (k in st) {
            if (!st.hasOwnProperty(k) || k === "cats" || k === "mappings") { continue; }
            if (saved.hasOwnProperty(k) && typeof saved[k] === typeof st[k]) { st[k] = saved[k]; }
        }
        if (saved.cats) {
            for (k in st.cats) { if (st.cats.hasOwnProperty(k) && typeof saved.cats[k] === "boolean") { st.cats[k] = saved.cats[k]; } }
        }
        st.mappings = sanitizeMappings(saved.mappings);
        st.scope = clampInt(st.scope, 0, 1);
        st.colorMode = clampInt(st.colorMode, 0, 1);
        st.tolerance = clampInt(st.tolerance, 0, MAX_TOL);
        st.sort = clampInt(st.sort, 0, 1);
        st.tab = clampInt(st.tab, 0, 2);
        return st;
    }

    var state = loadState();

    function saveState() {
        try { app.settings.saveSetting(SETTINGS_SECTION, STATE_KEY, Json.stringify(state)); }
        catch (e) { $.writeln(NAME + ": couldn't save settings - " + e.toString()); }
    }

    var lastReport = { text: "", title: "" };
    if (app.settings.haveSetting(SETTINGS_SECTION, REPORT_KEY)) {
        try { lastReport = Json.parse(app.settings.getSetting(SETTINGS_SECTION, REPORT_KEY)); } catch (e) { lastReport = { text: "", title: "" }; }
    }
    function setLastReport(text, title) {
        lastReport = { text: text, title: title };
        try { app.settings.saveSetting(SETTINGS_SECTION, REPORT_KEY, Json.stringify({ text: text.length > 200000 ? text.substr(0, 200000) + "\n... (truncated)" : text, title: title })); }
        catch (e) { $.writeln(NAME + ": couldn't store report - " + e.toString()); }
    }

    /* ---------------- UI ---------------- */

    function boldify(st) {
        st.graphics.font = ScriptUI.newFont(st.graphics.font.name, "BOLD", st.graphics.font.size);
        return st;
    }

    function drawSwatch() {
        var g = this.graphics, w = this.size[0], h = this.size[1];
        var hex = parseHex(this.hsHex);
        g.newPath();
        g.rectPath(0, 0, w, h);
        if (hex) {
            var rgb = hexToRgb(hex);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1]));
        } else {
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.2, 0.2, 1]));
            if (trim(this.hsHex) !== "") {
                g.newPath();
                g.moveTo(3, h - 3);
                g.lineTo(w - 3, 3);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0.9, 0.25, 0.25, 1], 2));
            }
        }
        g.newPath();
        g.rectPath(0, 0, w, h);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0.05, 0.05, 0.05, 1], 1));
    }

    function addSwatch(parent, w, h, clickable) {
        var b = clickable ? parent.add("button", undefined, "") : parent.add("group");
        b.preferredSize = [w, h];
        b.hsHex = "";
        b.onDraw = drawSwatch;
        return b;
    }

    function setSwatch(b, hex) {
        b.hsHex = hex || "";
        if (b.visible) { b.hide(); b.show(); }
    }

    function buildUI(host) {
        var win = (host instanceof Panel) ? host : new Window("palette", NAME + " " + VERSION, undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 8;

        var rowOffset = 0;
        var lastScan = null;
        var foundList = [];

        var head = win.add("group");
        head.alignChildren = ["left", "center"];
        boldify(head.add("statictext", undefined, NAME));
        head.add("statictext", undefined, "v" + VERSION + "  -  find & replace hex colors");
        var btnHelp = head.add("button", undefined, "?");
        btnHelp.preferredSize = [24, 22];
        btnHelp.alignment = ["right", "center"];

        var tabs = win.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        var tabSetup = tabs.add("tab", undefined, "1  Setup");
        var tabScan = tabs.add("tab", undefined, "2  Scan");
        var tabSwap = tabs.add("tab", undefined, "3  Swap");
        var allTabs = [tabSetup, tabScan, tabSwap];
        for (var ti = 0; ti < allTabs.length; ti++) {
            allTabs[ti].orientation = "column";
            allTabs[ti].alignChildren = ["fill", "top"];
            allTabs[ti].margins = [8, 10, 8, 8];
            allTabs[ti].spacing = 8;
        }

        /* --- Setup tab --- */
        var pScope = tabSetup.add("panel", undefined, "Scope");
        pScope.alignChildren = ["fill", "top"];
        pScope.margins = [10, 14, 10, 10];
        var ddScope = pScope.add("dropdownlist", undefined, ["Entire project", "Selected comps / folders in Project panel"]);
        var cbNested = pScope.add("checkbox", undefined, "Include nested precomps");
        cbNested.helpTip = "Also search precomps used inside the selected comps, at any depth.";

        var pLook = tabSetup.add("panel", undefined, "Look in");
        pLook.alignChildren = ["fill", "top"];
        pLook.margins = [10, 14, 10, 10];
        var gLookBtns = pLook.add("group");
        gLookBtns.alignment = ["right", "top"];
        var btnAll = gLookBtns.add("button", undefined, "All");
        var btnNone = gLookBtns.add("button", undefined, "None");
        btnAll.preferredSize = btnNone.preferredSize = [50, 20];
        var gCols = pLook.add("group");
        gCols.alignChildren = ["left", "top"];
        gCols.spacing = 18;
        var colA = gCols.add("group"), colB = gCols.add("group");
        colA.orientation = colB.orientation = "column";
        colA.alignChildren = colB.alignChildren = ["left", "top"];
        colA.spacing = colB.spacing = 2;
        var colFor = { "Shape Layers": colA, "Text Layers": colA, "Composition": colA, "Layers": colB, "Effects & Controls": colB };
        var cbCats = {}, lastGroup = "";
        for (var ci = 0; ci < CATS.length; ci++) {
            var cd = CATS[ci], col = colFor[cd.group];
            if (cd.group !== lastGroup) {
                if (col.children.length) { col.add("statictext", undefined, "").preferredSize = [10, 4]; }
                boldify(col.add("statictext", undefined, cd.group.toUpperCase()));
                lastGroup = cd.group;
            }
            var cb = col.add("checkbox", undefined, cd.label);
            if (cd.tip) { cb.helpTip = cd.tip; }
            cb.hsKey = cd.key;
            cbCats[cd.key] = cb;
        }

        var pOpt = tabSetup.add("panel", undefined, "Matching");
        pOpt.alignChildren = ["fill", "top"];
        pOpt.margins = [10, 14, 10, 10];
        var cbKeys = pOpt.add("checkbox", undefined, "Include keyframed colors (swap matching keyframes)");
        var gMode = pOpt.add("group");
        gMode.add("statictext", undefined, "Color values:");
        var ddMode = gMode.add("dropdownlist", undefined, ["Standard (as shown in color picker)", "Linear (matches rendered output)"]);
        ddMode.helpTip = "Standard matches the hex shown in the After Effects color picker, which suits most projects.\n" +
            "Linear matches the hex you see in rendered frames when the project uses a linearized working space (the sRGB curve is applied before matching).";
        var gTol = pOpt.add("group");
        gTol.add("statictext", undefined, "Tolerance:");
        var slTol = gTol.add("slider", undefined, 0, 0, MAX_TOL);
        slTol.preferredSize = [130, 20];
        var etTol = gTol.add("edittext", undefined, "0");
        etTol.characters = 3;
        var stTol = gTol.add("statictext", undefined, "exact match");
        stTol.characters = 14;
        slTol.helpTip = etTol.helpTip = "How far a color can be from an old hex and still match, per RGB channel (0-255).\n0 = exact. 2-4 catches eyedropper drift.";

        /* --- Scan tab --- */
        var gScanTop = tabScan.add("group");
        gScanTop.alignChildren = ["left", "center"];
        var btnScan = gScanTop.add("button", undefined, "Scan Scope");
        btnScan.preferredSize = [110, 26];
        gScanTop.add("statictext", undefined, "Sort:");
        var ddSort = gScanTop.add("dropdownlist", undefined, ["Most used", "Hex value"]);
        var stScan = tabScan.add("statictext", undefined, "Scan to list every color in scope, using the Setup tab settings.", { truncate: "end" });
        var lbFound = tabScan.add("listbox", undefined, [], {
            multiselect: true, numberOfColumns: 3, showHeaders: true,
            columnTitles: ["Hex", "Uses", "Found in"], columnWidths: [80, 50, 200]
        });
        lbFound.preferredSize = [340, 230];
        var gScanBot = tabScan.add("group");
        gScanBot.alignChildren = ["left", "center"];
        var swSel = addSwatch(gScanBot, 34, 34, false);
        var stSel = gScanBot.add("statictext", undefined, "No color selected");
        stSel.characters = 13;
        var gScanBtns = gScanBot.add("group");
        gScanBtns.alignment = ["right", "center"];
        var btnAddSel = gScanBtns.add("button", undefined, "Add to Swaps");
        var btnCopyList = gScanBtns.add("button", undefined, "Copy List");
        var btnScanDetails = gScanBtns.add("button", undefined, "Details...");
        btnScanDetails.helpTip = "Full scan report showing where every color is used.";
        tabScan.add("statictext", undefined, "Tip: double-click a color, or select several, to add them to the swap list.");

        /* --- Swap tab --- */
        var gHdr = tabSwap.add("group");
        gHdr.spacing = 4;
        var hdrSpec = [["", 16], ["#", 22], ["Old hex", 76], ["", 20], ["", 12], ["New hex", 76], ["", 20]];
        for (var hi = 0; hi < hdrSpec.length; hi++) {
            var hs = gHdr.add("statictext", undefined, hdrSpec[hi][0]);
            hs.preferredSize = [hdrSpec[hi][1], 16];
        }
        var gRowsWrap = tabSwap.add("group");
        gRowsWrap.alignChildren = ["left", "top"];
        gRowsWrap.spacing = 6;
        var gRows = gRowsWrap.add("group");
        gRows.orientation = "column";
        gRows.alignChildren = ["left", "top"];
        gRows.spacing = 3;
        var rows = [];
        for (var ri = 0; ri < VISIBLE_ROWS; ri++) { rows.push(makeRow(gRows)); }
        var sb = gRowsWrap.add("scrollbar", undefined, 0, 0, 1);
        sb.preferredSize = [16, VISIBLE_ROWS * 25];

        var gTools1 = tabSwap.add("group");
        var btnAdd = gTools1.add("button", undefined, "+ Add Row");
        var btnPaste = gTools1.add("button", undefined, "Paste List...");
        var btnReverse = gTools1.add("button", undefined, "Reverse");
        var btnClear = gTools1.add("button", undefined, "Clear");
        btnPaste.helpTip = "Paste many swaps at once, one per line: #FF0000 > #00AAFF";
        btnReverse.helpTip = "Swap old and new on every row. Handy for undoing a swap later.";
        var gTools2 = tabSwap.add("group");
        var btnSaveSet = gTools2.add("button", undefined, "Save Set...");
        var btnLoadSet = gTools2.add("button", undefined, "Load Set...");
        btnSaveSet.helpTip = "Save this swap list as a .json (or .txt) file, such as a brand palette.";
        btnLoadSet.helpTip = "Load a saved .json set or a .txt list of hex pairs.";
        var stCount = gTools2.add("statictext", undefined, "");
        stCount.characters = 18;
        tabSwap.add("statictext", undefined, "Swaps run at the same time, so A\u2192B plus B\u2192A exchanges two colors.");

        /* --- Bottom --- */
        var gAct = win.add("group");
        gAct.alignChildren = ["fill", "center"];
        var btnPreview = gAct.add("button", undefined, "Preview");
        var btnApply = gAct.add("button", undefined, "Apply Swaps");
        btnPreview.helpTip = "Show what would change without touching the project.";
        btnApply.helpTip = "Apply all active swaps as one undo step.";
        var gAct2 = win.add("group");
        gAct2.alignChildren = ["fill", "center"];
        var btnReport = gAct2.add("button", undefined, "Last Report...");
        var btnReset = gAct2.add("button", undefined, "Reset to Defaults");
        var stStatus = win.add("statictext", undefined, "Ready.", { truncate: "end" });
        stStatus.alignment = ["fill", "top"];

        function setStatus(t) { stStatus.text = t; }

        /* --- Rows --- */
        function makeRow(parent) {
            var g = parent.add("group");
            g.spacing = 4;
            g.alignChildren = ["left", "center"];
            var row = { g: g, idx: -1 };
            row.cb = g.add("checkbox", undefined, "");
            row.cb.preferredSize = [16, 20];
            row.cb.helpTip = "Include this swap";
            row.num = g.add("statictext", undefined, "");
            row.num.preferredSize = [22, 20];
            row.from = g.add("edittext", undefined, "");
            row.from.preferredSize = [76, 22];
            row.from.helpTip = "Old hex, e.g. #FF0000 or F00";
            row.swFrom = addSwatch(g, 20, 20, true);
            row.swFrom.helpTip = "Pick the old color";
            row.arrow = g.add("statictext", undefined, ARROW);
            row.arrow.preferredSize = [12, 20];
            row.to = g.add("edittext", undefined, "");
            row.to.preferredSize = [76, 22];
            row.to.helpTip = "New hex";
            row.swTo = addSwatch(g, 20, 20, true);
            row.swTo.helpTip = "Pick the new color";
            row.del = g.add("button", undefined, "\u00D7");
            row.del.preferredSize = [24, 22];
            row.del.helpTip = "Remove this row";

            row.cb.onClick = function () {
                var m = state.mappings[row.idx];
                if (!m) { return; }
                m.on = row.cb.value;
                saveState();
                updateCount();
            };
            function wireField(field, swatch, key) {
                field.onChanging = function () {
                    var m = state.mappings[row.idx];
                    if (!m) { return; }
                    m[key] = field.text;
                    setSwatch(swatch, field.text);
                };
                field.onChange = function () {
                    var m = state.mappings[row.idx];
                    if (!m) { return; }
                    var h = parseHex(field.text);
                    if (h) { field.text = h; }
                    m[key] = h || trim(field.text);
                    setSwatch(swatch, m[key]);
                    saveState();
                    updateCount();
                };
                swatch.onClick = function () {
                    var m = state.mappings[row.idx];
                    if (!m) { return; }
                    var cur = parseHex(m[key]);
                    var res = $.colorPicker(cur ? parseInt(cur.substr(1), 16) : 0xFFFFFF);
                    if (typeof res !== "number" || res < 0) { return; }
                    m[key] = "#" + ("000000" + res.toString(16).toUpperCase()).slice(-6);
                    field.text = m[key];
                    setSwatch(swatch, m[key]);
                    saveState();
                    updateCount();
                };
            }
            wireField(row.from, row.swFrom, "from");
            wireField(row.to, row.swTo, "to");
            row.del.onClick = function () { removeMapping(row.idx); };
            return row;
        }

        function updateCount() {
            var n = 0, active = 0;
            for (var i = 0; i < state.mappings.length; i++) {
                if (!isBlank(state.mappings[i])) { n++; if (state.mappings[i].on) { active++; } }
            }
            stCount.text = n + " swap" + (n === 1 ? "" : "s") + " (" + active + " active)";
        }

        function refreshRows() {
            var n = state.mappings.length, maxOff = Math.max(0, n - VISIBLE_ROWS), r, row, m;
            if (rowOffset > maxOff) { rowOffset = maxOff; }
            if (rowOffset < 0) { rowOffset = 0; }
            for (r = 0; r < rows.length; r++) {
                row = rows[r];
                m = state.mappings[rowOffset + r];
                row.idx = m ? rowOffset + r : -1;
                var ctrls = [row.cb, row.num, row.from, row.swFrom, row.arrow, row.to, row.swTo, row.del];
                for (var c = 0; c < ctrls.length; c++) { ctrls[c].visible = !!m; }
                if (m) {
                    row.cb.value = m.on;
                    row.num.text = String(rowOffset + r + 1);
                    row.from.text = m.from;
                    row.to.text = m.to;
                    setSwatch(row.swFrom, m.from);
                    setSwatch(row.swTo, m.to);
                }
            }
            sb.maxvalue = Math.max(1, maxOff);
            sb.value = rowOffset;
            sb.stepdelta = 1;
            sb.jumpdelta = VISIBLE_ROWS;
            sb.enabled = maxOff > 0;
            updateCount();
        }

        function removeMapping(idx) {
            if (idx < 0 || idx >= state.mappings.length) { return; }
            state.mappings.splice(idx, 1);
            if (!state.mappings.length) { state.mappings.push(blankMapping()); }
            refreshRows();
            saveState();
        }

        function addMappings(list, replace) {
            if (replace) { state.mappings = []; }
            while (state.mappings.length && isBlank(state.mappings[state.mappings.length - 1])) { state.mappings.pop(); }
            for (var i = 0; i < list.length; i++) { state.mappings.push(list[i]); }
            if (!state.mappings.length) { state.mappings.push(blankMapping()); }
            rowOffset = replace ? 0 : state.mappings.length - VISIBLE_ROWS;
            refreshRows();
            saveState();
            tabs.selection = tabSwap;
        }

        function addHexesToSwaps(hexes) {
            var existing = {}, added = 0, dup = 0, i, j;
            for (i = 0; i < state.mappings.length; i++) {
                var h = parseHex(state.mappings[i].from);
                if (h) { existing[h] = true; }
            }
            for (i = 0; i < hexes.length; i++) {
                if (existing[hexes[i]]) { dup++; continue; }
                existing[hexes[i]] = true;
                var placed = false;
                for (j = 0; j < state.mappings.length; j++) {
                    if (isBlank(state.mappings[j])) { state.mappings[j].from = hexes[i]; placed = true; break; }
                }
                if (!placed) { state.mappings.push({ from: hexes[i], to: "", on: true }); }
                added++;
            }
            rowOffset = state.mappings.length - VISIBLE_ROWS;
            refreshRows();
            saveState();
            setStatus("Added " + added + " color(s) to Swaps" + (dup ? " (" + dup + " already listed)" : "") + ". Enter the new hex codes on the Swap tab.");
        }

        /* --- Sync --- */
        function syncUI() {
            ddScope.selection = state.scope;
            cbNested.value = state.nested;
            cbNested.enabled = state.scope === 1;
            for (var k in cbCats) { if (cbCats.hasOwnProperty(k)) { cbCats[k].value = !!state.cats[k]; } }
            cbKeys.value = state.keyframes;
            ddMode.selection = state.colorMode;
            slTol.value = state.tolerance;
            etTol.text = String(state.tolerance);
            stTol.text = tolLabel(state.tolerance);
            ddSort.selection = state.sort;
            rowOffset = 0;
            refreshRows();
            tabs.selection = allTabs[state.tab];
        }

        function fillFoundList() {
            lbFound.removeAll();
            foundList = lastScan ? sortedFound(lastScan, state.sort) : [];
            for (var i = 0; i < foundList.length; i++) {
                var it = lbFound.add("item", foundList[i].hex);
                it.subItems[0].text = String(foundList[i].count);
                it.subItems[1].text = catNames(foundList[i].catOrder);
            }
            stSel.text = "No color selected";
            setSwatch(swSel, "");
        }

        function selectedFoundHexes() {
            var sel = lbFound.selection, out = [];
            if (!sel) { return out; }
            if (!(sel instanceof Array)) { sel = [sel]; }
            for (var i = 0; i < sel.length; i++) { out.push(foundList[sel[i].index].hex); }
            return out;
        }

        /* --- Actions --- */
        function runOp(mode) {
            var ctx;
            try {
                ctx = runEngine(state, mode);
            } catch (e) {
                if (e.userMsg) { alert(e.userMsg, NAME); }
                else { alert("Something went wrong:\n" + e.toString() + (e.line ? "\n(line " + e.line + ")" : ""), NAME, true); }
                return;
            }
            var rep = buildReport(ctx, state, mode);
            var extra = [];
            if (ctx.exprSkipped.length) { extra.push(ctx.exprSkipped.length + " expression-driven skipped"); }
            if (ctx.gradients.length) { extra.push(ctx.gradients.length + " gradient(s) to check by hand"); }
            if (ctx.errors.length) { extra.push(ctx.errors.length + " error(s)"); }
            var tail = extra.length ? "  |  " + extra.join(", ") : "";
            if (mode === "scan") {
                lastScan = ctx;
                setLastReport(rep, "Scan Report");
                fillFoundList();
                stScan.text = ctx.foundOrder.length + " unique color(s) in " + ctx.comps.length + " comp(s)." + tail;
                setStatus("Scan complete." + tail);
            } else if (mode === "preview") {
                setLastReport(rep, "Preview Report");
                setStatus("Preview: " + ctx.total + " value(s) would change in " + ctx.comps.length + " comp(s)." + tail);
                showReport(rep, "Preview Report");
            } else {
                setLastReport(rep, "Apply Report");
                if (ctx.total > 0 && lastScan) { stScan.text = "Colors have changed. Scan again to refresh this list."; }
                setStatus("Applied: " + ctx.total + " value(s) changed in " + ctx.comps.length + " comp(s)." + (ctx.total ? " Ctrl/Cmd+Z to undo." : "") + tail + "  (Details: Last Report)");
            }
        }

        function showPasteDialog() {
            var d = new Window("dialog", NAME + " - Paste Swap List");
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            d.add("statictext", undefined, "One swap per line: old hex, then new hex. Any separator works:");
            d.add("statictext", undefined, "    #FF0000 > #00AAFF        FF0000, 00AAFF        #f00 -> #0af");
            d.add("statictext", undefined, "Lines starting with // or ; are ignored. Spreadsheet columns can be pasted directly.");
            var et = d.add("edittext", undefined, "", { multiline: true, scrolling: true });
            et.preferredSize = [460, 240];
            var g = d.add("group");
            g.alignment = ["right", "top"];
            var result = "";
            var bRep = g.add("button", undefined, "Replace List");
            var bApp = g.add("button", undefined, "Append");
            var bCan = g.add("button", undefined, "Cancel", { name: "cancel" });
            bRep.onClick = function () { result = "replace"; d.close(); };
            bApp.onClick = function () { result = "append"; d.close(); };
            bCan.onClick = function () { d.close(); };
            d.show();
            if (!result) { return; }
            var parsed = parseSwapText(et.text);
            if (!parsed.length) { alert("No hex codes found in the pasted text.", NAME); return; }
            addMappings(parsed, result === "replace");
            setStatus((result === "replace" ? "Replaced list with " : "Added ") + parsed.length + " swap(s).");
        }

        function saveSet() {
            if (!filesAllowed()) { return; }
            var f = new File(Folder.myDocuments.fsName + "/HexSwap Set.json").saveDlg("Save swap set", fileFilter(["json", "txt"], ["Hex Swap Set", "Text list"]));
            if (!f) { return; }
            var list = [];
            for (var i = 0; i < state.mappings.length; i++) {
                var m = state.mappings[i];
                if (!isBlank(m)) { list.push({ from: parseHex(m.from) || trim(m.from), to: parseHex(m.to) || trim(m.to), on: m.on }); }
            }
            var text;
            if (/\.txt$/i.test(f.name)) {
                var lines = ["// Hex Swap set - old > new"];
                for (var j = 0; j < list.length; j++) { lines.push((list[j].on ? "" : "// ") + list[j].from + " > " + list[j].to); }
                text = lines.join("\n");
            } else {
                if (!/\.json$/i.test(f.name)) { f = new File(f.fsName + ".json"); }
                text = Json.stringify({ app: NAME, version: 1, saved: fmtDate(new Date()), mappings: list }, "  ");
            }
            if (writeTextFile(f, text)) { setStatus("Saved " + list.length + " swap(s) to " + f.name); }
        }

        function loadSet() {
            if (!filesAllowed()) { return; }
            var f = File.openDialog("Load swap set", fileFilter(["json", "txt"], ["Hex Swap Set", "Text list"]), false);
            if (!f) { return; }
            var text = readTextFile(f);
            if (text === null) { return; }
            var list = null;
            if (/^\s*[\{\[]/.test(text)) {
                try {
                    var data = Json.parse(text);
                    list = sanitizeMappings(data instanceof Array ? data : data.mappings);
                } catch (e) {
                    alert("Couldn't read this set file:\n" + e.message, NAME);
                    return;
                }
            } else {
                list = parseSwapText(text);
            }
            for (var i = 0; i < list.length; i++) {
                list[i].from = parseHex(list[i].from) || list[i].from;
                list[i].to = parseHex(list[i].to) || list[i].to;
            }
            if (!list.length || (list.length === 1 && isBlank(list[0]))) { alert("No swaps found in " + f.name, NAME); return; }
            var hasRows = false;
            for (var k = 0; k < state.mappings.length; k++) { if (!isBlank(state.mappings[k])) { hasRows = true; break; } }
            var replace = !hasRows || confirm("Replace the current swap list with " + f.name + "?\n\nYes = replace, No = add to the end of the list.", false, NAME);
            addMappings(list, replace);
            setStatus("Loaded " + list.length + " swap(s) from " + f.name);
        }

        /* --- Wiring --- */
        btnHelp.onClick = function () {
            alert(NAME + " " + VERSION + "\n\n" +
                "1  SETUP: choose the scope (whole project, or comps/folders selected in the Project panel) and which kinds of color to search.\n\n" +
                "2  SCAN (optional): lists every color in scope with usage counts. Double-click a color to add it as a swap.\n\n" +
                "3  SWAP: enter old > new hex pairs. Use + Add Row, Paste List, or Load Set for lots at once. Click a swatch to pick a color.\n\n" +
                "Preview shows what would change without touching the project. Apply makes every change as one undo step.\n\n" +
                "Colors driven by expressions are skipped and listed in the report, which you can copy or save. " +
                "Shape gradient colors can't be edited by scripts, so they're listed for you to change by hand.\n\n" +
                "Your settings and swaps are remembered between sessions. Reset to Defaults brings back the original settings.", NAME);
        };

        ddScope.onChange = function () {
            if (!ddScope.selection) { return; }
            state.scope = ddScope.selection.index;
            cbNested.enabled = state.scope === 1;
            saveState();
        };
        cbNested.onClick = function () { state.nested = cbNested.value; saveState(); };
        for (var kk in cbCats) {
            if (cbCats.hasOwnProperty(kk)) {
                cbCats[kk].onClick = function () { state.cats[this.hsKey] = this.value; saveState(); };
            }
        }
        function setAllCats(v) {
            for (var k in cbCats) { if (cbCats.hasOwnProperty(k)) { cbCats[k].value = v; state.cats[k] = v; } }
            saveState();
        }
        btnAll.onClick = function () { setAllCats(true); };
        btnNone.onClick = function () { setAllCats(false); };
        cbKeys.onClick = function () { state.keyframes = cbKeys.value; saveState(); };
        ddMode.onChange = function () { if (ddMode.selection) { state.colorMode = ddMode.selection.index; saveState(); } };
        slTol.onChanging = function () {
            state.tolerance = Math.round(slTol.value);
            etTol.text = String(state.tolerance);
            stTol.text = tolLabel(state.tolerance);
        };
        slTol.onChange = function () { slTol.onChanging(); slTol.value = state.tolerance; saveState(); };
        etTol.onChange = function () {
            state.tolerance = clampInt(etTol.text, 0, MAX_TOL);
            etTol.text = String(state.tolerance);
            slTol.value = state.tolerance;
            stTol.text = tolLabel(state.tolerance);
            saveState();
        };
        tabs.onChange = function () {
            for (var i = 0; i < allTabs.length; i++) { if (tabs.selection === allTabs[i]) { state.tab = i; } }
            saveState();
        };

        btnScan.onClick = function () { runOp("scan"); };
        ddSort.onChange = function () {
            if (!ddSort.selection) { return; }
            state.sort = ddSort.selection.index;
            saveState();
            if (lastScan) { fillFoundList(); }
        };
        lbFound.onChange = function () {
            var hx = selectedFoundHexes();
            stSel.text = hx.length ? hx[0] + (hx.length > 1 ? " +" + (hx.length - 1) : "") : "No color selected";
            setSwatch(swSel, hx.length ? hx[0] : "");
        };
        lbFound.onDoubleClick = function () { var hx = selectedFoundHexes(); if (hx.length) { addHexesToSwaps(hx); } };
        btnAddSel.onClick = function () {
            var hx = selectedFoundHexes();
            if (!hx.length) { alert("Select one or more colors in the list first.", NAME); return; }
            addHexesToSwaps(hx);
        };
        btnCopyList.onClick = function () {
            if (!foundList.length) { alert("Run a scan first.", NAME); return; }
            var lines = [];
            for (var i = 0; i < foundList.length; i++) { lines.push(foundList[i].hex + "\t" + foundList[i].count + "\t" + catNames(foundList[i].catOrder)); }
            if (copyToClipboard(lines.join("\n"))) { setStatus("Copied " + foundList.length + " colors to clipboard."); }
        };
        btnScanDetails.onClick = function () {
            if (!lastScan) { alert("Run a scan first.", NAME); return; }
            showReport(buildReport(lastScan, state, "scan"), "Scan Report");
        };

        sb.onChanging = sb.onChange = function () {
            var v = Math.round(sb.value);
            if (v !== rowOffset) { rowOffset = v; refreshRows(); }
        };
        btnAdd.onClick = function () {
            state.mappings.push(blankMapping());
            rowOffset = state.mappings.length - VISIBLE_ROWS;
            refreshRows();
            saveState();
            var rr = rows[state.mappings.length - 1 - rowOffset];
            if (rr) { rr.from.active = true; }
        };
        btnPaste.onClick = showPasteDialog;
        btnReverse.onClick = function () {
            for (var i = 0; i < state.mappings.length; i++) {
                var m = state.mappings[i], t = m.from;
                m.from = m.to;
                m.to = t;
            }
            refreshRows();
            saveState();
            setStatus("Reversed every swap (old \u2194 new).");
        };
        btnClear.onClick = function () {
            if (!confirm("Remove all swap rows?", true, NAME)) { return; }
            state.mappings = [blankMapping()];
            rowOffset = 0;
            refreshRows();
            saveState();
            setStatus("Swap list cleared.");
        };
        btnSaveSet.onClick = saveSet;
        btnLoadSet.onClick = loadSet;

        btnPreview.onClick = function () { runOp("preview"); };
        btnApply.onClick = function () { runOp("apply"); };
        btnReport.onClick = function () {
            if (!lastReport || !lastReport.text) { alert("No report yet. Run Scan, Preview, or Apply first.", NAME); return; }
            showReport(lastReport.text, lastReport.title || "Report");
        };
        btnReset.onClick = function () {
            if (!confirm("Reset Hex Swap to its default settings?\n\nThis restores every option and clears the swap list.", true, NAME)) { return; }
            state = defaultState();
            saveState();
            lastScan = null;
            fillFoundList();
            stScan.text = "Scan to list every color in scope, using the Setup tab settings.";
            syncUI();
            setStatus("Settings reset to defaults.");
        };

        win.onResizing = win.onResize = function () { this.layout.resize(); };
        syncUI();
        return win;
    }

    /* ---------------- Boot ---------------- */

    if ($.global.HEXSWAP_TEST === true) {
        $.global.HexSwapAPI = {
            runEngine: runEngine, buildReport: buildReport, parseHex: parseHex, parseSwapText: parseSwapText,
            buildRules: buildRules, defaultState: defaultState, loadState: loadState, Json: Json, buildUI: buildUI,
            valueToRgb: valueToRgb, hexToValue: hexToValue
        };
        return;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) {
        ui.center();
        ui.show();
    } else {
        ui.layout.layout(true);
        ui.layout.resize();
    }
})(this);
