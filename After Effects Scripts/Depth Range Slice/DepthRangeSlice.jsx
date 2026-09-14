// Depth Range Slice v1.0
// Remaps a window of grey values in a depth pass to full black -> full white,
// and lets that fixed-width window travel past both ends of the depth range.
// Works in any bit depth (Levels values are normalised 0-1 internally).
//
// Install: copy to  <AE>/Support Files/Scripts/ScriptUI Panels/  and restart AE,
// then open from Window > DepthRangeSlice.jsx.  Or run via File > Scripts > Run Script File.

(function depthRangeSlice(thisObj) {

    var CTRL = ["Lower Grey", "Upper Grey", "Offset", "Gamma"];
    var CHK = "Invert";
    var LEVELS_NAME = "Depth Range Levels";

    function buildExpression() {
        var s = "";
        s += "var lo = effect(\"Lower Grey\")(\"Slider\").value / 100;\n";
        s += "var hi = effect(\"Upper Grey\")(\"Slider\").value / 100;\n";
        s += "var off = effect(\"Offset\")(\"Slider\").value / 100;\n";
        s += "lo = lo + off;\n";
        s += "hi = hi + off;\n";
        s += "if (hi < lo) { var sw = lo; lo = hi; hi = sw; }\n";
        s += "var w = hi - lo;\n";
        s += "if (w < 0.000001) { w = 0.000001; hi = lo + w; }\n";
        s += "var inB = Math.min(Math.max(lo, 0), 1);\n";
        s += "var inW = Math.min(Math.max(hi, 0), 1);\n";
        s += "var oB = Math.min(Math.max((inB - lo) / w, 0), 1);\n";
        s += "var oW = Math.min(Math.max((inW - lo) / w, 0), 1);\n";
        s += "if ((inW - inB) < 0.00001) {\n";
        s += "  inB = 0;\n";
        s += "  inW = 1;\n";
        s += "  var flat = 1;\n";
        s += "  if (lo >= 1) { flat = 0; }\n";
        s += "  oB = flat;\n";
        s += "  oW = flat;\n";
        s += "}\n";
        s += "if (effect(\"Invert\")(\"Checkbox\").value == 1) { var sv = oB; oB = oW; oW = sv; }\n";
        return s;
    }

    function addSlider(layer, name, val, mn, mx) {
        var fx = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        fx.name = name;
        var sl = fx.property("ADBE Slider Control-0001");
        sl.setValue(val);
        return fx;
    }

    function apply(layer) {
        var parade = layer.property("ADBE Effect Parade");
        var i;
        for (i = parade.numProperties; i >= 1; i--) {
            var nm = parade.property(i).name;
            if (nm == LEVELS_NAME || nm == CHK) { parade.property(i).remove(); continue; }
            for (var c = 0; c < CTRL.length; c++) {
                if (nm == CTRL[c]) { parade.property(i).remove(); }
            }
        }

        addSlider(layer, "Lower Grey", 30);
        addSlider(layer, "Upper Grey", 45);
        addSlider(layer, "Offset", 0);
        addSlider(layer, "Gamma", 1);
        var chk = layer.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
        chk.name = CHK;

        var lv = layer.property("ADBE Effect Parade").addProperty("ADBE Pro Levels2");
        lv.name = LEVELS_NAME;

        var parade2 = layer.property("ADBE Effect Parade");
        var lev = parade2.property(LEVELS_NAME);
        var pre = buildExpression();
        lev.property("ADBE Pro Levels2-0004").expression = pre + "inB;";
        lev.property("ADBE Pro Levels2-0005").expression = pre + "inW;";
        lev.property("ADBE Pro Levels2-0007").expression = pre + "oB;";
        lev.property("ADBE Pro Levels2-0008").expression = pre + "oW;";
        lev.property("ADBE Pro Levels2-0006").expression =
            "var g = effect(\"Gamma\")(\"Slider\").value;\n" +
            "if (effect(\"Invert\")(\"Checkbox\").value == 1) { g = 1 / g; }\n" +
            "g;";
    }

    function sweep(layer, comp, reverse) {
        var parade = layer.property("ADBE Effect Parade");
        var lower = parade.property("Lower Grey").property("ADBE Slider Control-0001").value;
        var upper = parade.property("Upper Grey").property("ADBE Slider Control-0001").value;
        var off = parade.property("Offset").property("ADBE Slider Control-0001");

        var startOff = -upper;
        var endOff = 100 - lower;
        if (reverse) { var t = startOff; startOff = endOff; endOff = t; }

        var t0 = comp.workAreaStart;
        var t1 = comp.workAreaStart + comp.workAreaDuration;
        while (off.numKeys > 0) { off.removeKey(1); }
        off.setValueAtTime(t0, startOff);
        off.setValueAtTime(t1, endOff);
        var ease = new KeyframeEase(0, 33);
        off.setTemporalEaseAtKey(1, [ease], [ease]);
        off.setTemporalEaseAtKey(2, [ease], [ease]);
    }

    function strip(layer) {
        var parade = layer.property("ADBE Effect Parade");
        for (var i = parade.numProperties; i >= 1; i--) {
            var nm = parade.property(i).name;
            var kill = (nm == LEVELS_NAME || nm == CHK);
            for (var c = 0; c < CTRL.length; c++) {
                if (nm == CTRL[c]) { kill = true; }
            }
            if (kill) { parade.property(i).remove(); }
        }
    }

    function selectedLayers() {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { return null; }
        if (comp.selectedLayers.length === 0) { return null; }
        return comp.selectedLayers;
    }

    function runOn(fn, undoName, needsComp) {
        var comp = app.project.activeItem;
        var layers = selectedLayers();
        if (layers === null) {
            alert("Select one or more depth-pass layers in an open composition.");
            return;
        }
        app.beginUndoGroup(undoName);
        for (var i = 0; i < layers.length; i++) {
            if (needsComp) { fn(layers[i], comp); } else { fn(layers[i]); }
        }
        app.endUndoGroup();
    }

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Depth Range Slice", undefined, { resizeable: true });
        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 10;

        var info = pal.add("statictext", undefined,
            "Set Lower/Upper to define the band, then animate Offset.", { multiline: true });
        info.characters = 30;

        var bApply = pal.add("button", undefined, "Apply to Selected Layer(s)");
        var bFwd = pal.add("button", undefined, "Sweep Front > Back (work area)");
        var bRev = pal.add("button", undefined, "Sweep Back > Front (work area)");
        var bStrip = pal.add("button", undefined, "Remove Rig");

        bApply.onClick = function () { runOn(apply, "Apply Depth Range Slice", false); };
        bFwd.onClick = function () {
            runOn(function (l, c) { sweep(l, c, false); }, "Depth Sweep Front to Back", true);
        };
        bRev.onClick = function () {
            runOn(function (l, c) { sweep(l, c, true); }, "Depth Sweep Back to Front", true);
        };
        bStrip.onClick = function () { runOn(strip, "Remove Depth Range Slice", false); };

        if (pal instanceof Window) {
            pal.center();
            pal.show();
        } else {
            pal.layout.layout(true);
        }
        return pal;
    }

    buildUI(thisObj);

})(this);
