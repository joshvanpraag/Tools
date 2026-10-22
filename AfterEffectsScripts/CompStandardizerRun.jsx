// Comp Standardizer - headless runner for KBar. Uses settings saved by the panel.
var CompStd = (function () {
    var VERSION = "1.0";
    var SETTINGS_FOLDER = Folder.userData.fsName + "/CompStandardizer";
    var SETTINGS_FILE = SETTINGS_FOLDER + "/settings.json";

    var COLUMN_IDS = {
        "A/V Features": "0009",
        "Label": "0006",
        "#": "0007",
        "Comment": "0008",
        "Switches": "000a",
        "Modes": "000c",
        "Parent & Link": "000d",
        "Keys": "000b",
        "Render Time": "0014",
        "In": "000e",
        "Out": "000f",
        "Duration": "0010",
        "Stretch": "0011"
    };
    var NAME_ID = "0004";
    var PARENT_ID = "000d";
    var DEFAULT_WIDTHS = {
        "0009": 68, "0005": 16, "0006": 16, "0007": 33, "0004": 275, "0008": 200, "000a": 140,
        "000c": 271, "000d": 339, "000b": 47, "0014": 110, "000e": 70, "000f": 70, "0010": 70, "0011": 61
    };
    var OUTLINE_IDS = ["0009", "0005", "0006", "0007", "0004", "0008", "000a", "000c", "000d", "000b", "0014", "000e", "000f", "0010", "0011"];
    var NAME_TEXT_INSET = 28;
    var COLUMN_ORDER = ["A/V Features", "Label", "#", "Comment", "Switches", "Modes", "Parent & Link", "Keys", "Render Time", "In", "Out", "Duration", "Stretch"];

    var VIEWER_LAYOUTS = {
        "1 View": "0000",
        "2 Views - Horizontal": "0001",
        "2 Views - Vertical": "0002",
        "4 Views": "0003",
        "4 Views - Left": "0004",
        "4 Views - Right": "0005",
        "4 Views - Top": "0006",
        "4 Views - Bottom": "0007"
    };

    function defaults() {
        var cols = {};
        var on = ["A/V Features", "Label", "#", "Switches", "Modes", "Parent & Link"];
        for (var i = 0; i < COLUMN_ORDER.length; i++) {
            cols[COLUMN_ORDER[i]] = indexOf(on, COLUMN_ORDER[i]) !== -1;
        }
        return {
            version: 1,
            live: {
                resolution: "half",
                fastPreview: "off",
                shy: "leave",
                draft3d: "leave",
                frameBlending: "leave",
                motionBlur: "leave",
                zoom: "leave",
                channels: "leave",
                exposure: "leave",
                transparencyGrid: "leave",
                rulers: "leave",
                guides: "leave",
                workArea: "leave",
                playhead: "leave",
                bgColorMode: "leave",
                bgColor: [0, 0, 0],
                preserveFrameRate: "leave",
                preserveResolution: "leave",
                closeTabs: true
            },
            file: {
                enabled: false,
                setColumns: false,
                columns: cols,
                twirlUp: false,
                zoomOut: false,
                graphEditor: "leave",
                grid: "leave",
                viewerLayout: "leave",
                nameWidthMode: "leave",
                nameWidth: 275,
                autoPadding: 10,
                autoMin: 150,
                autoMax: 700,
                dividerMode: "leave",
                parentWidth: 339,
                totalWidth: 1100,
                resetOtherWidths: false
            },
            showSummary: true
        };
    }

    function indexOf(arr, v) {
        for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return i; } }
        return -1;
    }

    function merge(base, over) {
        if (over === null || typeof over !== "object") { return base; }
        for (var k in base) {
            if (!base.hasOwnProperty(k) || !over.hasOwnProperty(k)) { continue; }
            var b = base[k];
            var o = over[k];
            if (b !== null && typeof b === "object" && !(b instanceof Array)) {
                base[k] = merge(b, o);
            } else if (typeof o === typeof b) {
                base[k] = o;
            }
        }
        return base;
    }

    function toJSON(v, indent) {
        indent = indent || "";
        var next = indent + "  ";
        if (v === null) { return "null"; }
        if (typeof v === "boolean" || typeof v === "number") { return String(v); }
        if (typeof v === "string") {
            return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
        }
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) { a.push(toJSON(v[i], next)); }
            return "[" + a.join(", ") + "]";
        }
        var parts = [];
        for (var k in v) {
            if (v.hasOwnProperty(k)) { parts.push(next + toJSON(k) + ": " + toJSON(v[k], next)); }
        }
        return "{\n" + parts.join(",\n") + "\n" + indent + "}";
    }

    function loadSettings() {
        var s = defaults();
        var f = new File(SETTINGS_FILE);
        if (!f.exists) { return s; }
        f.encoding = "UTF-8";
        f.open("r");
        var txt = f.read();
        f.close();
        var parsed = null;
        try {
            parsed = eval("(" + txt + ")");
        } catch (e) {
            alert("Comp Standardizer: settings file is unreadable, using defaults.\n" + SETTINGS_FILE + "\n" + e.toString());
            return s;
        }
        return merge(s, parsed);
    }

    function saveSettings(s) {
        var folder = new Folder(SETTINGS_FOLDER);
        if (!folder.exists) { folder.create(); }
        var f = new File(SETTINGS_FILE);
        f.encoding = "UTF-8";
        f.open("w");
        f.write(toJSON(s));
        f.close();
    }

    function allComps() {
        var out = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) { out.push(it); }
        }
        return out;
    }

    function compHasLayer(comp, prop) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            if (prop in l && l[prop] === true) { return true; }
        }
        return false;
    }

    function triState(mode, comp, layerProp) {
        if (mode === "on") { return true; }
        if (mode === "off") { return false; }
        if (mode === "smart") { return compHasLayer(comp, layerProp); }
        return null;
    }

    var RES = { full: [1, 1], half: [2, 2], third: [3, 3], quarter: [4, 4] };
    var ZOOM = { "200": 2, "100": 1, "50": 0.5, "25": 0.25 };

    function fastPreviewValue(mode) {
        var map = {
            off: FastPreviewType.FP_OFF,
            adaptive: FastPreviewType.FP_ADAPTIVE_RESOLUTION,
            draft: FastPreviewType.FP_DRAFT,
            fastdraft: FastPreviewType.FP_FAST_DRAFT,
            wireframe: FastPreviewType.FP_WIREFRAME
        };
        return map.hasOwnProperty(mode) ? map[mode] : null;
    }

    function needsViewer(L) {
        return L.fastPreview !== "leave" || L.zoom !== "leave" || L.channels !== "leave" || L.exposure !== "leave" ||
            L.transparencyGrid !== "leave" || L.rulers !== "leave" || L.guides !== "leave";
    }

    function applyViewOptions(viewer, L, report) {
        var fp = fastPreviewValue(L.fastPreview);
        for (var v = 0; v < viewer.views.length; v++) {
            var o = viewer.views[v].options;
            if (fp !== null) { o.fastPreview = fp; }
            if (ZOOM.hasOwnProperty(L.zoom)) { o.zoom = ZOOM[L.zoom]; }
            if (L.channels === "rgb") { o.channels = ChannelType.CHANNEL_RGB; }
            if (L.exposure === "zero") { o.exposure = 0; }
            if (L.transparencyGrid !== "leave") { o.checkerboards = (L.transparencyGrid === "on"); }
            if (L.rulers !== "leave") { o.rulers = (L.rulers === "on"); }
            if (L.guides !== "leave") { o.guidesVisibility = (L.guides === "on"); }
            report.views++;
        }
    }

    function runLive(s, report) {
        var L = s.live;
        var comps = allComps();
        var startItem = app.project.activeItem;
        var restoreComp = (startItem instanceof CompItem) ? startItem : null;
        var wantViewer = needsViewer(L);
        var mbValue = null;
        if (L.motionBlur === "on") { mbValue = true; }
        if (L.motionBlur === "off") { mbValue = false; }
        if (L.motionBlur === "smart") {
            mbValue = false;
            for (var m = 0; m < comps.length; m++) { if (compHasLayer(comps[m], "motionBlur")) { mbValue = true; break; } }
        }

        app.beginUndoGroup("Comp Standardizer");
        for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
            if (RES.hasOwnProperty(L.resolution)) { c.resolutionFactor = RES[L.resolution]; }
            var v1 = triState(L.shy, c, "shy");
            if (v1 !== null) { c.hideShyLayers = v1; }
            var v2 = triState(L.draft3d, c, "threeDLayer");
            if (v2 !== null) { c.draft3d = v2; }
            var v3 = triState(L.frameBlending, c, "frameBlending");
            if (v3 !== null) { c.frameBlending = v3; }
            if (mbValue !== null) { c.motionBlur = mbValue; }
            if (L.workArea === "full") {
                c.workAreaStart = 0;
                c.workAreaDuration = c.duration;
            }
            if (L.playhead === "start") { c.time = 0; }
            if (L.bgColorMode === "set") { c.bgColor = L.bgColor; }
            if (L.preserveFrameRate !== "leave") { c.preserveNestedFrameRate = (L.preserveFrameRate === "on"); }
            if (L.preserveResolution !== "leave") { c.preserveNestedResolution = (L.preserveResolution === "on"); }
            report.comps++;
        }
        app.endUndoGroup();

        if (wantViewer) {
            for (var j = 0; j < comps.length; j++) {
                var comp = comps[j];
                var viewer = comp.openInViewer();
                if (viewer === null) {
                    report.warnings.push("Could not open viewer for: " + comp.name);
                    continue;
                }
                applyViewOptions(viewer, L, report);
                if (L.closeTabs && (restoreComp === null || comp.id !== restoreComp.id)) {
                    viewer.setActive();
                    var active = app.project.activeItem;
                    if (active instanceof CompItem && active.id === comp.id && app.activeViewer !== null && app.activeViewer.type === ViewerType.VIEWER_COMPOSITION) {
                        app.executeCommand(4);
                        report.tabsClosed++;
                    }
                }
            }
            if (restoreComp !== null) { restoreComp.openInViewer(); }
        }
        if (L.motionBlur !== "leave") {
            report.notes.push("Motion Blur switch is project-wide in AE 2026; set to " + (mbValue ? "ON" : "OFF") + ".");
        }
    }

    function hexNibble(str, idx, fn) {
        var n = parseInt(str.charAt(idx), 16);
        var r = fn(n) & 0xF;
        return str.substr(0, idx) + r.toString(16) + str.substr(idx + 1);
    }

    function replaceTag(text, tag, fn, counter) {
        var re = new RegExp("<" + tag + ' bdata="([0-9a-f]*)"', "g");
        return text.replace(re, function (whole, data) {
            var out = fn(data);
            if (out === null || out === data) { return whole; }
            counter[tag] = (counter[tag] || 0) + 1;
            return "<" + tag + ' bdata="' + out + '"';
        });
    }

    var REC_START = 48;
    var REC_LEN = 176;
    var REC_FLAG = 143;

    function parseRecords(d) {
        var recs = [];
        if ((d.length - REC_START) % REC_LEN !== 0) { return null; }
        for (var p = REC_START; p + REC_LEN <= d.length; p += REC_LEN) {
            var flag = d.charAt(p + REC_FLAG);
            if (flag !== "0" && flag !== "1") { return null; }
            recs.push({ id: d.substr(p, 4), width: parseInt(d.substr(p + 4, 4), 16), visible: flag === "1", pos: p });
        }
        return recs;
    }

    function hex4(n) {
        var h = Math.max(0, Math.min(0xFFFF, Math.round(n))).toString(16);
        while (h.length < 4) { h = "0" + h; }
        return h;
    }

    function writeRecords(d, recs) {
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            d = d.substr(0, r.pos + 4) + hex4(r.width) + d.substr(r.pos + 8);
            d = d.substr(0, r.pos + REC_FLAG) + (r.visible ? "1" : "0") + d.substr(r.pos + REC_FLAG + 1);
        }
        return d;
    }

    function findRec(recs, id) {
        for (var i = 0; i < recs.length; i++) { if (recs[i].id === id) { return recs[i]; } }
        return null;
    }

    function isOutline(id) { return indexOf(OUTLINE_IDS, id) !== -1; }

    function timelineWanted(F) {
        return F.setColumns || F.nameWidthMode !== "leave" || F.dividerMode !== "leave" || F.resetOtherWidths;
    }

    function editTimeline(F, nameWidths, stats) {
        return function (acsi, seq, compId) {
            var recs = parseRecords(acsi);
            if (recs === null || seq.length !== 148 || findRec(recs, NAME_ID) === null) { stats.skipped++; return null; }
            var i, r;
            if (F.resetOtherWidths) {
                for (i = 0; i < recs.length; i++) {
                    r = recs[i];
                    if (r.id !== NAME_ID && r.id !== PARENT_ID && DEFAULT_WIDTHS.hasOwnProperty(r.id)) { r.width = DEFAULT_WIDTHS[r.id]; }
                }
            }
            if (F.setColumns) {
                for (var name in COLUMN_IDS) {
                    if (!COLUMN_IDS.hasOwnProperty(name)) { continue; }
                    r = findRec(recs, COLUMN_IDS[name]);
                    if (r !== null) { r.visible = F.columns[name] === true; }
                }
            }
            var nameRec = findRec(recs, NAME_ID);
            if (F.nameWidthMode === "default") { nameRec.width = DEFAULT_WIDTHS[NAME_ID]; }
            if (F.nameWidthMode === "fixed") { nameRec.width = F.nameWidth; }
            if (F.nameWidthMode === "auto" && nameWidths.hasOwnProperty(compId)) { nameRec.width = nameWidths[compId]; }
            var parentRec = findRec(recs, PARENT_ID);
            if (F.dividerMode === "default" && parentRec !== null) { parentRec.width = DEFAULT_WIDTHS[PARENT_ID]; }
            if (F.dividerMode === "parent" && parentRec !== null) { parentRec.width = F.parentWidth; }
            if (F.dividerMode === "total") {
                var filler = (parentRec !== null && parentRec.visible) ? parentRec : null;
                if (filler === null) {
                    for (i = recs.length - 1; i >= 0; i--) { if (recs[i].visible && isOutline(recs[i].id)) { filler = recs[i]; break; } }
                }
                if (filler !== null) {
                    var others = 0;
                    for (i = 0; i < recs.length; i++) {
                        if (recs[i] !== filler && recs[i].visible && isOutline(recs[i].id)) { others += recs[i].width; }
                    }
                    filler.width = Math.max(60, F.totalWidth - others);
                }
            }
            var nameEnd = 0;
            for (i = 0; i < recs.length; i++) {
                if (recs[i].visible) { nameEnd += recs[i].width; }
                if (recs[i].id === NAME_ID) { break; }
            }
            stats.edited++;
            return { acsi: writeRecords(acsi, recs), seq: seq.substr(0, 24) + hex4(nameEnd) + seq.substr(28) };
        };
    }

    function replaceTimelines(text, fn, counter) {
        var re = /<seq bdata="([0-9a-f]*)"(\/>\s*<LSIf>\s*)<ACsi bdata="([0-9a-f]*)"/g;
        return text.replace(re, function (whole, seq, mid, acsi, offset) {
            var itemPos = text.lastIndexOf("<Item>", offset);
            var idPos = text.indexOf('<idta bdata="', itemPos);
            var compId = (itemPos === -1 || idPos === -1 || idPos > offset) ? -1 : parseInt(text.substr(idPos + 13 + 32, 8), 16);
            var out = fn(acsi, seq, compId);
            if (out === null) { return whole; }
            counter.timelines = (counter.timelines || 0) + 1;
            return '<seq bdata="' + out.seq + '"' + mid + '<ACsi bdata="' + out.acsi + '"';
        });
    }

    function displayedName(L) {
        if (L.isNameSet === false && L.source) { return "[" + L.name + "]"; }
        return L.name;
    }

    function measureNameWidths(F) {
        var out = {};
        if (F.nameWidthMode !== "auto") { return out; }
        var w = new Window("palette");
        var st = w.add("statictext", undefined, "x");
        var g = st.graphics;
        var font = ScriptUI.newFont("Adobe Clean", "REGULAR", 12);
        var comps = allComps();
        for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
            var maxW = 0;
            for (var j = 1; j <= c.numLayers; j++) {
                var m = g.measureString(displayedName(c.layer(j)), font)[0];
                if (m > maxW) { maxW = m; }
            }
            var width = Math.ceil(maxW) + NAME_TEXT_INSET + F.autoPadding;
            out[c.id] = Math.max(F.autoMin, Math.min(F.autoMax, width));
        }
        return out;
    }

    function editTwirl(d) {
        if (d.length < 8) { return null; }
        var n = parseInt(d.substr(0, 8), 16);
        if (d.length !== 8 + 8 * n) { return null; }
        var out = [d.substr(0, 8)];
        for (var i = 0; i < n; i++) {
            var rec = d.substr(8 + i * 8, 8);
            var b = parseInt(rec.substr(0, 2), 16);
            if (b === 0) { b = 0x80; }
            if (b & 0x40) { b = (b & ~0x40) | 0x80; }
            if (b & 0x04) { b = (b & ~0x04) | 0x08; }
            var h = b.toString(16);
            if (h.length < 2) { h = "0" + h; }
            out.push(h + rec.substr(2));
        }
        return out.join("");
    }

    function editZoomOut(d) {
        if (d.length !== 148) { return null; }
        return d.substr(0, 36) + "000000000000f000f000" + d.substr(56);
    }

    function editGraphEditor(on) {
        return function (d) {
            if (d.length !== 408) { return null; }
            return hexNibble(d, 277, function (n) { return on ? (n | 0x2) : (n & ~0x2); });
        };
    }

    function editGrid(on) {
        return function (d) {
            if (d.length !== 192) { return null; }
            return hexNibble(d, 47, function (n) { return on ? (n | 0x8) : (n & ~0x8); });
        };
    }

    function editLayout(code) {
        return function (d) {
            if (d.length !== 4) { return null; }
            return code;
        };
    }

    function fileStageWanted(F) {
        return F.enabled && (timelineWanted(F) || F.twirlUp || F.zoomOut || F.graphEditor !== "leave" || F.grid !== "leave" || F.viewerLayout !== "leave");
    }

    function readBinary(f) {
        f.encoding = "BINARY";
        f.open("r");
        var t = f.read();
        f.close();
        return t;
    }

    function writeBinary(f, t) {
        f.encoding = "BINARY";
        f.open("w");
        f.write(t);
        f.close();
    }

    function nextVersionFile(base) {
        var folder = base.parent.fsName;
        var name = decodeURI(base.name).replace(/\.(aep|aepx)$/i, "").replace(/_std_v\d+$/i, "");
        for (var v = 1; v < 1000; v++) {
            var num = (v < 10 ? "0" : "") + v;
            var f = new File(folder + "/" + name + "_std_v" + num + ".aep");
            if (!f.exists) { return f; }
        }
        throw new Error("Could not find a free _std_v## filename next to " + base.fsName);
    }

    function runFile(s, report) {
        var F = s.file;
        if (!fileStageWanted(F)) { return; }
        if (!app.project.file) {
            report.warnings.push("File-level options skipped: project has never been saved, so there is no folder to write the _std copy to.");
            return;
        }
        var original = app.project.file;
        var nameWidths = measureNameWidths(F);
        var allCompsCount = allComps().length;
        var target = nextVersionFile(original);
        var itemCount = app.project.numItems;
        var stamp = new Date().getTime();
        var tmpA = new File(Folder.temp.fsName + "/CompStd_" + stamp + "_src.aepx");
        var tmpB = new File(Folder.temp.fsName + "/CompStd_" + stamp + "_edit.aepx");

        app.project.save(tmpA);
        var text = readBinary(tmpA);
        var counter = {};
        if (F.twirlUp) { text = replaceTag(text, "otln", editTwirl, counter); }
        if (F.zoomOut) { text = replaceTag(text, "seq", editZoomOut, counter); }
        if (timelineWanted(F)) {
            var tStats = { edited: 0, skipped: 0 };
            text = replaceTimelines(text, editTimeline(F, nameWidths, tStats), counter);
            if (tStats.skipped) { report.warnings.push(tStats.skipped + " timeline(s) had an unexpected layout and were left unchanged."); }
            var unopened = allCompsCount - tStats.edited - tStats.skipped;
            if (unopened > 0) { report.notes.push(unopened + " comp(s) have never been opened in a timeline; AE gives them default columns when first opened."); }
        }
        if (F.graphEditor !== "leave") { text = replaceTag(text, "cdta", editGraphEditor(F.graphEditor === "on"), counter); }
        if (F.grid !== "leave") { text = replaceTag(text, "fips", editGrid(F.grid === "on"), counter); }
        if (VIEWER_LAYOUTS.hasOwnProperty(F.viewerLayout)) { text = replaceTag(text, "fipl", editLayout(VIEWER_LAYOUTS[F.viewerLayout]), counter); }
        writeBinary(tmpB, text);
        text = null;

        var opened = null;
        try {
            opened = app.open(tmpB);
        } catch (openErr) {
            report.warnings.push("Open failed: " + openErr.toString());
        }
        if (opened === null || app.project.numItems !== itemCount) {
            app.open(tmpA);
            app.project.save(target);
            tmpA.remove();
            report.warnings.push("Edited file failed validation; saved an UNEDITED copy instead. Original untouched.");
            report.savedAs = target.fsName;
            return;
        }
        app.project.save(target);
        tmpA.remove();
        tmpB.remove();
        report.savedAs = target.fsName;
        report.original = original.fsName;
        var parts = [];
        for (var k in counter) { if (counter.hasOwnProperty(k)) { parts.push(k + ":" + counter[k]); } }
        report.fileEdits = parts.join("  ");
    }

    function summary(r) {
        var lines = [];
        lines.push("Comp Standardizer: " + r.comps + " comps, " + r.views + " viewer views set" + (r.tabsClosed ? ", " + r.tabsClosed + " tabs closed" : "") + ".");
        if (r.savedAs) {
            lines.push("Saved standardized copy: " + r.savedAs);
            if (r.original) { lines.push("Original untouched: " + r.original); }
            if (r.fileEdits) { lines.push("File edits: " + r.fileEdits); }
        }
        for (var i = 0; i < r.notes.length; i++) { lines.push(r.notes[i]); }
        for (var j = 0; j < r.warnings.length; j++) { lines.push("WARNING: " + r.warnings[j]); }
        lines.push("Time: " + r.seconds + "s");
        return lines.join("\n");
    }

    function run(s, interactive) {
        if (!app.project) { alert("Comp Standardizer: no project open."); return null; }
        var t0 = new Date().getTime();
        var report = { comps: 0, views: 0, tabsClosed: 0, warnings: [], notes: [], savedAs: null, original: null, fileEdits: "" };
        try {
            runLive(s, report);
            runFile(s, report);
        } catch (e) {
            alert("Comp Standardizer error:\n" + e.toString() + (e.line ? "\nLine " + e.line : ""));
            return report;
        }
        report.seconds = Math.round((new Date().getTime() - t0) / 100) / 10;
        var text = summary(report);
        writeLn(text.split("\n")[0]);
        if (interactive || s.showSummary || report.warnings.length) { alert(text); }
        return report;
    }

    return {
        VERSION: VERSION,
        SETTINGS_FILE: SETTINGS_FILE,
        COLUMN_ORDER: COLUMN_ORDER,
        VIEWER_LAYOUTS: VIEWER_LAYOUTS,
        defaults: defaults,
        loadSettings: loadSettings,
        saveSettings: saveSettings,
        run: run,
        _editTwirl: editTwirl,
        _editTimeline: editTimeline,
        _parseRecords: parseRecords,
        _measureNameWidths: measureNameWidths,
        _replaceTimelines: replaceTimelines
    };
})();
(function () {
    var s = CompStd.loadSettings();
    if (!(new File(CompStd.SETTINGS_FILE)).exists) {
        alert("Comp Standardizer: no saved settings yet.\nOpen the Comp Standardizer panel once to choose your settings.");
        return;
    }
    CompStd.run(s, false);
})();
