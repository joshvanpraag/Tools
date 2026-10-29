$.global.EaseInspectorHost = (function () {
    var SECTION = "EaseInspector";
    var H = { clip: ($.global.EaseInspectorHost && $.global.EaseInspectorHost.clip) || null, lastSig: null, sameCount: 0 };

    function enc(v) {
        if (v === null || v === undefined) { return "null"; }
        var t = typeof v;
        if (t === "number") { return isFinite(v) ? String(v) : "null"; }
        if (t === "boolean") { return v ? "true" : "false"; }
        if (t === "string") {
            var s = "";
            for (var i = 0; i < v.length; i++) {
                var c = v.charAt(i), code = v.charCodeAt(i);
                if (c === "\"" || c === "\\") { s += "\\" + c; }
                else if (code < 32 || code > 126) { var h = code.toString(16); while (h.length < 4) { h = "0" + h; } s += "\\u" + h; }
                else { s += c; }
            }
            return "\"" + s + "\"";
        }
        if (v instanceof Array) {
            var a = [];
            for (var j = 0; j < v.length; j++) { a.push(enc(v[j])); }
            return "[" + a.join(",") + "]";
        }
        var o = [];
        for (var k in v) { if (v.hasOwnProperty(k)) { o.push(enc(k) + ":" + enc(v[k])); } }
        return "{" + o.join(",") + "}";
    }

    function ok(data) { return enc({ ok: true, data: data }); }
    function fail(msg, extra) { var r = { ok: false, msg: msg }; if (extra) { for (var k in extra) { r[k] = extra[k]; } } return enc(r); }
    function guard(fn) {
        try { return fn(); } catch (e) { return fail(String(e.message || e)); }
    }

    function interpName(t) {
        if (t === KeyframeInterpolationType.BEZIER) { return "Bezier"; }
        if (t === KeyframeInterpolationType.LINEAR) { return "Linear"; }
        if (t === KeyframeInterpolationType.HOLD) { return "Hold"; }
        return "?";
    }

    function round(n) { return Math.round(n * 100) / 100; }
    function list(eases, field) { var o = []; for (var i = 0; i < eases.length; i++) { o.push(round(eases[i][field])); } return o; }

    function propLabel(p) {
        var layer = p.propertyGroup(p.propertyDepth);
        var parent = p.propertyGroup(1);
        var label = p.name;
        if (parent && parent !== layer && parent.matchName !== "ADBE Transform Group") { label = parent.name + " > " + label; }
        return { layer: layer.index, prop: label };
    }

    function activeComp() {
        var c = app.project.activeItem;
        return (c instanceof CompItem) ? c : null;
    }

    function refs() {
        var comp = activeComp();
        var out = [];
        if (!comp) { return out; }
        var props = comp.selectedProperties;
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime || p.numKeys === 0) { continue; }
            var keys = p.selectedKeys;
            for (var k = 0; k < keys.length; k++) { out.push({ prop: p, key: keys[k] }); }
        }
        return out;
    }

    function selectionSig() {
        var comp = activeComp();
        if (!comp) { return "none"; }
        var props = comp.selectedProperties;
        var parts = [comp.id];
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime || p.numKeys === 0) { continue; }
            var k = p.selectedKeys;
            if (!k.length) { continue; }
            parts.push(p.propertyGroup(p.propertyDepth).index + ":" + p.propertyDepth + ":" + p.propertyIndex + ":" + p.name + ":" + k.join(","));
        }
        return parts.join("|");
    }

    function rowOf(r, comp) {
        var p = r.prop, k = r.key;
        var inE = p.keyInTemporalEase(k), outE = p.keyOutTemporalEase(k);
        var lbl = propLabel(p);
        return {
            layer: lbl.layer, prop: lbl.prop,
            time: timeToCurrentFormat(p.keyTime(k), comp.frameRate),
            inType: interpName(p.keyInInterpolationType(k)), outType: interpName(p.keyOutInterpolationType(k)),
            inI: list(inE, "influence"), inS: list(inE, "speed"), outI: list(outE, "influence"), outS: list(outE, "speed"),
            matchName: p.matchName
        };
    }

    function pick(sel, n) {
        var all = refs();
        if (!sel || !sel.length || all.length !== n) { return all; }
        var out = [];
        for (var i = 0; i < sel.length; i++) { if (sel[i] >= 0 && sel[i] < all.length) { out.push(all[sel[i]]); } }
        return out.length ? out : all;
    }

    function clampInfl(v) { return Math.max(0.1, Math.min(100, v)); }

    function buildEases(current, infl, speed) {
        var out = [];
        for (var d = 0; d < current.length; d++) {
            out.push(new KeyframeEase(speed === null ? current[d].speed : speed, infl === null ? current[d].influence : clampInfl(infl)));
        }
        return out;
    }

    function fitEases(src, dims) {
        var out = [];
        for (var d = 0; d < dims; d++) {
            var e = src[Math.min(d, src.length - 1)];
            out.push(new KeyframeEase(e.speed, clampInfl(e.influence)));
        }
        return out;
    }

    function easeData(eases) {
        var out = [];
        for (var i = 0; i < eases.length; i++) { out.push({ speed: eases[i].speed, influence: eases[i].influence }); }
        return out;
    }

    function num(v) {
        if (v === null || v === undefined || v === "") { return null; }
        var n = Number(v);
        if (isNaN(n)) { throw new Error("\"" + v + "\" isn't a number."); }
        return n;
    }

    H.read = function (force) {
        return guard(function () {
            var comp = activeComp();
            if (!comp) { H.lastSig = "none"; return ok({ comp: false, rows: [] }); }
            var sig = selectionSig();
            if (!force && sig === H.lastSig && sig.indexOf("|") === -1) { return "\"SAME\""; }
            if (!force && sig === H.lastSig && ++H.sameCount % 4 !== 0) { return "\"SAME\""; }
            H.lastSig = sig;
            var rs = refs(), rows = [];
            for (var i = 0; i < rs.length; i++) { rows.push(rowOf(rs[i], comp)); }
            return ok({ comp: true, rows: rows });
        });
    };

    H.apply = function (a) {
        return guard(function () {
            var vals = { inI: num(a.inI), inS: num(a.inS), outI: num(a.outI), outS: num(a.outS) };
            var changeIn = vals.inI !== null || vals.inS !== null;
            var changeOut = vals.outI !== null || vals.outS !== null;
            if (!changeIn && !changeOut) { return ok(0); }
            var t = pick(a.sel, a.n);
            if (!t.length) { return fail("Select keyframes first."); }
            app.beginUndoGroup("Ease Inspector: Set Ease");
            for (var i = 0; i < t.length; i++) {
                var p = t[i].prop, k = t[i].key;
                var inType = p.keyInInterpolationType(k), outType = p.keyOutInterpolationType(k);
                if (changeIn && inType === KeyframeInterpolationType.LINEAR) { inType = KeyframeInterpolationType.BEZIER; }
                if (changeOut && outType === KeyframeInterpolationType.LINEAR) { outType = KeyframeInterpolationType.BEZIER; }
                p.setInterpolationTypeAtKey(k, inType, outType);
                var newIn = changeIn ? buildEases(p.keyInTemporalEase(k), vals.inI, vals.inS) : p.keyInTemporalEase(k);
                var newOut = changeOut ? buildEases(p.keyOutTemporalEase(k), vals.outI, vals.outS) : p.keyOutTemporalEase(k);
                p.setTemporalEaseAtKey(k, newIn, newOut);
            }
            app.endUndoGroup();
            H.lastSig = null;
            return ok(t.length);
        });
    };

    H.copy = function (a) {
        return guard(function () {
            var t = pick(a.sel, a.n);
            if (!t.length) { return fail("Select keys to copy."); }
            var clip = [];
            for (var i = 0; i < t.length; i++) {
                var p = t[i].prop, k = t[i].key;
                clip.push({ inE: easeData(p.keyInTemporalEase(k)), outE: easeData(p.keyOutTemporalEase(k)),
                    inType: p.keyInInterpolationType(k), outType: p.keyOutInterpolationType(k),
                    cont: p.keyTemporalContinuous(k), auto: p.keyTemporalAutoBezier(k), matchName: p.matchName, name: p.name });
            }
            H.clip = clip;
            return ok(clip.length);
        });
    };

    H.clipCount = function () { return ok(H.clip ? H.clip.length : 0); };

    H.paste = function (a) {
        return guard(function () {
            var clip = H.clip;
            if (!clip || !clip.length) { return fail("Nothing copied yet. Select keys and hit Copy first."); }
            var t = pick(a.sel, a.n);
            var n = clip.length, m = t.length;
            if (!m) { return fail("Select keys to paste onto."); }
            if (n !== m && n !== 1) {
                return fail("You copied " + n + " keyframes, but " + m + (m === 1 ? " is" : " are") + " selected. Select " + n + " to paste in order, or copy a single key to paste it onto any number.", { mismatch: true });
            }
            var diffs = [];
            for (var i = 0; i < m; i++) {
                var src = clip[n === 1 ? 0 : i];
                var pair = src.name + " → " + t[i].prop.name;
                if (src.matchName !== t[i].prop.matchName && diffs.join("\n").indexOf(pair) === -1) { diffs.push(pair); }
            }
            if (diffs.length && !a.force) { return fail("Different properties", { propDiffs: diffs }); }
            app.beginUndoGroup("Ease Inspector: Paste Ease");
            for (var j = 0; j < m; j++) {
                var s = clip[n === 1 ? 0 : j];
                var p = t[j].prop, k = t[j].key;
                var dims = p.keyInTemporalEase(k).length;
                p.setInterpolationTypeAtKey(k, s.inType, s.outType);
                p.setTemporalAutoBezierAtKey(k, false);
                p.setTemporalContinuousAtKey(k, s.cont);
                p.setTemporalEaseAtKey(k, fitEases(s.inE, dims), fitEases(s.outE, dims));
                if (s.auto) { p.setTemporalAutoBezierAtKey(k, true); }
            }
            app.endUndoGroup();
            H.lastSig = null;
            return ok({ count: m, oneToMany: n === 1 && m > 1, diffs: diffs.length > 0 });
        });
    };

    H.easeFromSource = function (a) {
        return guard(function () {
            var src;
            if (H.clip && H.clip.length > 1) { return fail("You copied " + H.clip.length + " keyframes. Copy a single key, then hit Save."); }
            if (H.clip && H.clip.length === 1) {
                src = H.clip[0];
            } else {
                var t = pick(a.sel, a.n);
                if (t.length !== 1) { return fail("Select (or copy) a single keyframe to save its ease."); }
                src = { inE: easeData(t[0].prop.keyInTemporalEase(t[0].key)), outE: easeData(t[0].prop.keyOutTemporalEase(t[0].key)) };
            }
            return ok({ inInfl: round(src.inE[0].influence), inSpeed: round(src.inE[0].speed), outInfl: round(src.outE[0].influence), outSpeed: round(src.outE[0].speed) });
        });
    };

    H.applyPreset = function (a) {
        return guard(function () {
            var t = pick(a.sel, a.n);
            if (!t.length) { return fail("Select keyframes to apply this ease."); }
            var pr = a.preset;
            app.beginUndoGroup("Ease Inspector: Apply " + pr.name);
            for (var i = 0; i < t.length; i++) {
                var p = t[i].prop, k = t[i].key;
                var dims = p.keyInTemporalEase(k).length;
                p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                p.setTemporalAutoBezierAtKey(k, false);
                p.setTemporalEaseAtKey(k, fitEases([{ speed: pr.inSpeed, influence: pr.inInfl }], dims), fitEases([{ speed: pr.outSpeed, influence: pr.outInfl }], dims));
            }
            app.endUndoGroup();
            H.lastSig = null;
            return ok(t.length);
        });
    };

    H.getLib = function () {
        return guard(function () {
            return ok(app.settings.haveSetting(SECTION, "library") ? app.settings.getSetting(SECTION, "library") : "");
        });
    };

    H.setLib = function (text) {
        return guard(function () { app.settings.saveSetting(SECTION, "library", text); return ok(true); });
    };

    return H;
})();
