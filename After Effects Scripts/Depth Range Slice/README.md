# Depth Range Slice

ScriptUI panel for After Effects that turns a rendered depth pass into an animated reveal/slice effect.

![Depth Range Slice UI](DepthRangeSlice.png)

## What it does

- Applies a Levels rig to the selected layer(s) that remaps a chosen band of grey values (the "Lower Grey" / "Upper Grey" sliders) in a depth pass to full black → full white, with an `Offset` control that shifts the band and a `Gamma` control for the falloff.
- The band is a fixed width, so animating `Offset` sweeps it through the depth range, past both ends — useful for reveals, X-ray-style sweeps, or depth-based wipes.
- **Sweep Front → Back** / **Sweep Back → Front** buttons auto-keyframe the offset across the comp's work area with eased in/out.
- **Remove Rig** cleanly strips all the added effects back off the layer.
- Works at any bit depth (values are normalized 0–1 internally).

## Install

Copy `DepthRangeSlice.jsx` to `<After Effects>/Support Files/Scripts/ScriptUI Panels/`, restart AE, then open it from **Window > DepthRangeSlice.jsx**. It can also be run once via **File > Scripts > Run Script File**.

## Usage

1. Render or import a depth pass (e.g. a Redshift/Arnold/V-Ray Z-depth AOV) as a layer.
2. Select the layer(s) and click **Apply to Selected Layer(s)**.
3. Adjust Lower/Upper Grey to set the band width and position, then animate `Offset` (or use the Sweep buttons).
