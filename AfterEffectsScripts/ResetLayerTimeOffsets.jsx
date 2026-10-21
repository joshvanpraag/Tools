/*
    Reset Layer Time Offsets.jsx

    For every eligible layer in the active comp:
      - Moves the layer's start time back to 0 while keeping every keyframe
        (and layer marker) at the same comp time it had before.
      - Extends the in point to the start of the comp and the out point to
        the end of the comp.
      - On visible layers, adds a 0% HOLD opacity key at 0 and keeps the layer
        hidden until its original in point, then adds a 0% HOLD key at its
        original out point. The last opacity key before that is set to HOLD.

    Skipped: video, image sequences, audio, precomps, cameras and lights.
    Exception: any layer with Time Remap keyframes is processed.
    Nulls get the time reset, but no opacity hold keys.
    If a layer has expressions, you're warned first and can choose to include it.
*/

(function () {
    var SCRIPT_NAME = "Reset Layer Time Offsets";
    var EPS = 0.00001;

    function isActiveProp(p) {
        if (p.isSeparationLeader && p.dimensionsSeparated) { return false; }
        if (p.isSeparationFollower && !p.separationLeader.dimensionsSeparated) { return false; }
        return true;
    }

    function forEachProp(group, fn, path) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            var name = path ? path + " > " + p.name : p.name;
            if (p.propertyType === PropertyType.PROPERTY) {
                fn(p, name);
            } else {
                forEachProp(p, fn, name);
            }
        }
    }

    function classify(layer) {
        if (layer instanceof CameraLayer || layer instanceof LightLayer) { return { ok: false, why: "camera / light" }; }
        if (layer instanceof ShapeLayer || layer instanceof TextLayer) { return { ok: true, seen: true }; }
        if (!(layer instanceof AVLayer)) { return { ok: false, why: "unsupported layer type" }; }
        if (layer.timeRemapEnabled && layer.property("ADBE Time Remapping").numKeys > 0) {
            if (!layer.hasVideo) { return { ok: false, why: "audio" }; }
            return { ok: true, seen: true };
        }
        var src = layer.source;
        if (src instanceof CompItem) { return { ok: false, why: "precomp (no time remap keys)" }; }
        if (src instanceof FootageItem) {
            if (src.mainSource instanceof SolidSource) { return { ok: true, seen: !layer.nullLayer }; }
            if (src.mainSource.isStill) { return { ok: true, seen: layer.hasVideo }; }
            return { ok: false, why: src.hasVideo ? "video / sequence" : "audio" };
        }
        return { ok: false, why: "unsupported source" };
    }

    function findExpressions(layer) {
        var out = [];
        forEachProp(layer, function (p, name) {
            if (p.canSetExpression && p.expressionEnabled && p.expression !== "") {
                out.push({ name: name, expr: p.expression });
            }
        });
        return out;
    }

    function findBlockers(layer) {
        var out = [];
        forEachProp(layer, function (p, name) {
            if (isActiveProp(p) && p.numKeys > 0 && p.propertyValueType === PropertyValueType.CUSTOM_VALUE) {
                out.push(name);
            }
        });
        return out;
    }

    function buildPlan(comp) {
        var plan = [];
        var dur = comp.duration;
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var entry = { layer: layer, index: i, name: layer.name };
            var info = classify(layer);
            entry.info = info;
            if (!info.ok) { entry.action = "skip"; entry.reason = info.why; plan.push(entry); continue; }
            entry.needShift = Math.abs(layer.startTime) > EPS;
            entry.needIn = layer.inPoint > EPS;
            entry.needOut = layer.outPoint < dur - EPS;
            if (!entry.needShift && !entry.needIn && !entry.needOut) { entry.action = "none"; plan.push(entry); continue; }
            if (layer.outPoint <= 0 || layer.inPoint >= dur) { entry.action = "skip"; entry.reason = "layer is entirely outside the comp"; plan.push(entry); continue; }
            if (layer.stretch < 0) { entry.action = "skip"; entry.reason = "time-reversed layer"; plan.push(entry); continue; }
            var blockers = findBlockers(layer);
            if (blockers.length) { entry.action = "skip"; entry.reason = "keyframes that can't be moved by script: " + blockers.join(", "); plan.push(entry); continue; }
            entry.exprs = findExpressions(layer);
            entry.action = "process";
            plan.push(entry);
        }
        return plan;
    }

    function isSpatial(p) {
        var t = p.propertyValueType;
        return t === PropertyValueType.TwoD_SPATIAL || t === PropertyValueType.ThreeD_SPATIAL;
    }

    function isMarkerProp(p) {
        return p.propertyValueType === PropertyValueType.MARKER;
    }

    function readKeys(p) {
        var marker = isMarkerProp(p);
        var spatial = !marker && isSpatial(p);
        var bez = !marker && p.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER);
        var hasLabel = typeof p.keyLabel === "function";
        var keys = [];
        for (var k = 1; k <= p.numKeys; k++) {
            var d = { t: p.keyTime(k), v: p.keyValue(k), sel: p.keySelected(k) };
            if (!marker) {
                d.inI = p.keyInInterpolationType(k);
                d.outI = p.keyOutInterpolationType(k);
                if (bez) {
                    d.inE = p.keyInTemporalEase(k);
                    d.outE = p.keyOutTemporalEase(k);
                    d.tc = p.keyTemporalContinuous(k);
                    d.tab = p.keyTemporalAutoBezier(k);
                }
                if (spatial) {
                    d.inS = p.keyInSpatialTangent(k);
                    d.outS = p.keyOutSpatialTangent(k);
                    d.sc = p.keySpatialContinuous(k);
                    d.sab = p.keySpatialAutoBezier(k);
                    d.rov = p.keyRoving(k);
                }
            }
            if (hasLabel) { d.lbl = p.keyLabel(k); }
            keys.push(d);
        }
        return { p: p, keys: keys, marker: marker, spatial: spatial, bez: bez, hasLabel: hasLabel };
    }

    function removeAllButFirstKey(p) {
        for (var k = p.numKeys; k >= 2; k--) { p.removeKey(k); }
    }

    function writeKeys(rec) {
        var p = rec.p;
        var keys = rec.keys;
        var n = keys.length;
        var i, d;
        for (i = 0; i < n; i++) { p.setValueAtTime(keys[i].t, keys[i].v); }
        for (var k = p.numKeys; k >= 1; k--) {
            var kt = p.keyTime(k);
            var match = false;
            for (i = 0; i < n; i++) {
                if (Math.abs(keys[i].t - kt) < 0.00001) { match = true; break; }
            }
            if (!match) { p.removeKey(k); }
        }
        if (!rec.marker) {
            for (i = 0; i < n; i++) {
                d = keys[i];
                var k = i + 1;
                if (rec.bez && !d.tab) { p.setTemporalEaseAtKey(k, d.inE, d.outE); }
                p.setInterpolationTypeAtKey(k, d.inI, d.outI);
                if (rec.bez) {
                    p.setTemporalContinuousAtKey(k, d.tc);
                    p.setTemporalAutoBezierAtKey(k, d.tab);
                }
                if (rec.spatial) {
                    p.setSpatialContinuousAtKey(k, d.sc);
                    p.setSpatialAutoBezierAtKey(k, d.sab);
                    if (!d.sab) { p.setSpatialTangentsAtKey(k, d.inS, d.outS); }
                }
            }
            if (rec.spatial) {
                for (i = 1; i < n - 1; i++) {
                    if (keys[i].rov) { p.setRovingAtKey(i + 1, true); }
                }
            }
        }
        for (i = 0; i < n; i++) {
            if (rec.hasLabel && keys[i].lbl) { p.setLabelAtKey(i + 1, keys[i].lbl); }
            p.setSelectedAtKey(i + 1, keys[i].sel);
        }
    }

    function keyIndexAt(p, t) {
        for (var k = 1; k <= p.numKeys; k++) {
            if (Math.abs(p.keyTime(k) - t) < 0.0005) { return k; }
        }
        return 0;
    }

    function setHold(p, k, inToo) {
        var H = KeyframeInterpolationType.HOLD;
        p.setInterpolationTypeAtKey(k, inToo ? H : p.keyInInterpolationType(k), H);
    }

    function gateOpacity(op, tIn, tOut, needIn, needOut, fd, notes) {
        var tLast = tOut - fd;
        var k;
        if (op.numKeys === 0) {
            var v = op.value;
            if (needIn) {
                op.setValueAtTime(0, 0);
                op.setValueAtTime(tIn, v);
            } else {
                op.setValueAtTime(0, v);
            }
            if (needOut) { op.setValueAtTime(tOut, 0); }
            for (k = 1; k <= op.numKeys; k++) { setHold(op, k, true); }
            return;
        }

        var vIn = op.valueAtTime(tIn, true);
        var vLast = op.valueAtTime(tLast, true);
        var removed = 0;

        if (needIn && op.keyTime(1) < tIn - 0.0005) {
            op.setValueAtTime(tIn, vIn);
            for (k = op.numKeys; k >= 1; k--) {
                if (op.keyTime(k) < tIn - 0.0005) { op.removeKey(k); removed++; }
            }
        }
        if (needOut && op.keyTime(op.numKeys) > tLast + 0.0005) {
            op.setValueAtTime(tLast, vLast);
            for (k = op.numKeys; k >= 1; k--) {
                if (op.keyTime(k) > tLast + 0.0005) { op.removeKey(k); removed++; }
            }
        }
        if (removed) { notes.push("replaced " + removed + " opacity key(s) outside the original in/out with keys sampled at its edges"); }

        if (needIn) {
            if (!keyIndexAt(op, tIn)) {
                op.setValueAtTime(tIn, vIn);
                setHold(op, keyIndexAt(op, tIn), false);
            }
            op.setValueAtTime(0, 0);
            setHold(op, 1, true);
        }
        if (needOut) {
            op.setValueAtTime(tOut, 0);
            var ko = keyIndexAt(op, tOut);
            setHold(op, ko, true);
            if (ko > 1) { setHold(op, ko - 1, false); }
        }
    }

    function processEntry(comp, e) {
        var layer = e.layer;
        var fd = comp.frameDuration;
        var dur = comp.duration;
        var origStart = layer.startTime;
        var origIn = layer.inPoint;
        var origOut = layer.outPoint;
        var notes = [];
        var wasLocked = layer.locked;
        if (wasLocked) { layer.locked = false; }

        if (e.needShift) {
            var recs = [];
            forEachProp(layer, function (p) {
                if (isActiveProp(p) && p.numKeys > 0) { recs.push(readKeys(p)); }
            });
            for (var r = 0; r < recs.length; r++) { removeAllButFirstKey(recs[r].p); }
            layer.startTime = 0;
            for (r = 0; r < recs.length; r++) { writeKeys(recs[r]); }
            notes.push("start " + timeStr(origStart, comp) + " -> 0, " + recs.length + " keyed prop(s) kept in place");
        }

        layer.inPoint = e.needIn ? 0 : origIn;
        layer.outPoint = e.needOut ? dur : origOut;

        if (e.info.seen && (e.needIn || e.needOut)) {
            var op = layer.property("ADBE Transform Group").property("ADBE Opacity");
            gateOpacity(op, origIn, origOut, e.needIn, e.needOut, fd, notes);
            notes.push("opacity holds" + (e.needIn ? " in@" + timeStr(origIn, comp) : "") + (e.needOut ? " out@" + timeStr(origOut, comp) : ""));
        } else if (!e.info.seen && (e.needIn || e.needOut)) {
            notes.push("not visible - no opacity holds");
        }

        if (wasLocked) { layer.locked = true; }
        return notes.join("; ");
    }

    function timeStr(t, comp) {
        return timeToCurrentFormat(t, comp.frameRate);
    }

    function run(comp, plan, exprMode) {
        var lines = [];
        var done = 0;
        for (var i = 0; i < plan.length; i++) {
            var e = plan[i];
            var label = "#" + e.index + " " + e.name;
            if (e.action === "skip") { lines.push("SKIP  " + label + " (" + e.reason + ")"); continue; }
            if (e.action === "none") { continue; }
            if (e.exprs.length && exprMode === "skip") { lines.push("SKIP  " + label + " (has expressions)"); continue; }
            lines.push("DONE  " + label + ": " + processEntry(comp, e));
            done++;
        }
        lines.unshift(done + " layer(s) processed in \"" + comp.name + "\".");
        return lines.join("\n");
    }

    function askExpressions(list) {
        var txt = [];
        for (var i = 0; i < list.length; i++) {
            for (var j = 0; j < list[i].exprs.length; j++) {
                var x = list[i].exprs[j];
                var body = x.expr.replace(/[\r\n]+/g, " ");
                if (body.length > 160) { body = body.substr(0, 160) + "..."; }
                txt.push("#" + list[i].index + " " + list[i].name + "  >  " + x.name + "\n    " + body);
            }
        }
        var result = "cancel";
        var w = new Window("dialog", SCRIPT_NAME + " - expressions found");
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.add("statictext", undefined, list.length + " layer(s) to be moved have expressions. Time-based expressions (time, wiggle, loopOut, inPoint...) may play differently after the move:", { multiline: true }).preferredSize = [560, 34];
        var et = w.add("edittext", undefined, txt.join("\n"), { multiline: true, readonly: true, scrolling: true });
        et.preferredSize = [560, 260];
        var g = w.add("group");
        g.alignment = ["right", "bottom"];
        var bMove = g.add("button", undefined, "Move them too");
        var bSkip = g.add("button", undefined, "Skip these layers");
        var bCancel = g.add("button", undefined, "Cancel", { name: "cancel" });
        bMove.onClick = function () { result = "move"; w.close(); };
        bSkip.onClick = function () { result = "skip"; w.close(); };
        bCancel.onClick = function () { result = "cancel"; w.close(); };
        w.show();
        return result;
    }

    function main() {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { alert("Open or select a composition first.", SCRIPT_NAME); return; }
        var plan = buildPlan(comp);
        var withExpr = [];
        var todo = 0;
        for (var i = 0; i < plan.length; i++) {
            if (plan[i].action === "process") {
                todo++;
                if (plan[i].exprs.length) { withExpr.push(plan[i]); }
            }
        }
        if (!todo) { alert("Nothing to do - no eligible layers are offset or trimmed.", SCRIPT_NAME); return; }
        var exprMode = "move";
        if (withExpr.length) {
            exprMode = askExpressions(withExpr);
            if (exprMode === "cancel") { return; }
        }
        app.beginUndoGroup(SCRIPT_NAME);
        var report = run(comp, plan, exprMode);
        app.endUndoGroup();
        alert(report, SCRIPT_NAME);
    }

    $.global.HQ_ResetLayerTimeOffsets = { buildPlan: buildPlan, run: run };
    if (!$.global.HQ_RESET_LAYER_TIME_NO_UI) { main(); }
})();
