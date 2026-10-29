# Tools

A collection of tools created for use in Cinema 4D, After Effects, and other design software.

Each category below is a folder containing every tool for that category as loose files, with one README per folder documenting all of them. Click a tool name to jump straight to its writeup.

## Downloads

Click a file to download it. These links always give you the newest version.

| Tool | Type | Download |
|---|---|---|
| [Hex Swap](AfterEffectsScripts/README.md#hex-swap) | After Effects script | [**HexSwap.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/HexSwap.jsx) |
| [Depth Range Slice](AfterEffectsScripts/README.md#depth-range-slice) | After Effects script | [**DepthRangeSlice.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/DepthRangeSlice.jsx) |
| [Reset Layer Time Offsets](AfterEffectsScripts/README.md#reset-layer-time-offsets) | After Effects script | [**ResetLayerTimeOffsets.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/ResetLayerTimeOffsets.jsx) |
| [Comp Standardizer](AfterEffectsScripts/README.md#comp-standardizer) | After Effects script | [**CompStandardizer.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/CompStandardizer.zip) |
| [Ease Inspector](AfterEffectsPlugins/README.md#ease-inspector) | After Effects plugin | [**EaseInspector.zxp**](https://github.com/joshvanpraag/Tools/releases/download/downloads/EaseInspector.zxp) |
| [AOV Set Depth](Cinema4DScenes/README.md#aov-set-depth) | Cinema 4D scene | [**AOVSetDepth.c4d**](https://github.com/joshvanpraag/Tools/releases/download/downloads/AOVSetDepth.c4d) |
| [Align Parent to Child](Cinema4DScripts/README.md#align-parent-to-child) | Cinema 4D script | [**AlignParentToChild.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/AlignParentToChild.zip) |
| [Safe Delete Object](Cinema4DPlugins/README.md#safe-delete-object) | Cinema 4D plugin | [**SafeDeleteObject.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/SafeDeleteObject.zip) |
| [Ease FFD](Cinema4DPlugins/README.md#ease-ffd) | Cinema 4D plugin | [**EaseFFD.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/EaseFFD.zip) |
| [Center Bend](Cinema4DPlugins/README.md#center-bend) | Cinema 4D plugin | [**CenterBend.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/CenterBend.zip) |
| [Hex Bench](WindowsPrograms/README.md#hex-bench) | Windows program | [**HexBench.exe**](https://github.com/joshvanpraag/Tools/releases/download/downloads/HexBench.exe) |

All downloads are also listed on the [Downloads release](https://github.com/joshvanpraag/Tools/releases/tag/downloads).

## How to install

1. **Download** the tool from the table above (or the green **Download** button on its writeup).
2. **If it's a `.zip`**, unzip it first: on Windows, right-click it and choose **Extract All**; on a Mac, double-click it.
3. **Put it in the right place** for its type:

| Type | File | Where it goes |
|---|---|---|
| After Effects script | `.jsx` | Copy into `<After Effects>/Support Files/Scripts/ScriptUI Panels/`, restart After Effects, then open it from the **Window** menu. |
| After Effects plugin | `.zxp` | Install with a free ZXP installer such as [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/), restart After Effects, then open it from **Window > Extensions**. |
| Cinema 4D plugin | `.zip` with a folder | Unzip, then move the whole folder into Cinema 4D's plugins folder (**Edit > Preferences > Open Preferences Folder > plugins**) and restart Cinema 4D. |
| Cinema 4D script | `.zip` with a `.py` | Unzip, then copy the files into Cinema 4D's scripts folder (**Edit > Preferences > Open Preferences Folder > library/scripts**) and restart Cinema 4D. |
| Cinema 4D scene | `.c4d` | Open it in Cinema 4D. |
| Windows program | `.exe` | Double-click to run. If Windows SmartScreen says it "protected your PC", click **More info > Run anyway** (it shows this for any program that isn't from a big publisher). |

Each tool's writeup has its own install and usage notes.

## After Effects Scripts

- [Hex Swap](AfterEffectsScripts/README.md#hex-swap) — bulk find & replace hex colors across a project
- [Depth Range Slice](AfterEffectsScripts/README.md#depth-range-slice) — animated depth-pass slice/reveal rig
- [Reset Layer Time Offsets](AfterEffectsScripts/README.md#reset-layer-time-offsets) — zero out layer start times while preserving on-screen timing
- [Comp Standardizer](AfterEffectsScripts/README.md#comp-standardizer) — apply consistent comp/viewer/timeline settings across a whole project

## After Effects Plugins

- [Ease Inspector](AfterEffectsPlugins/README.md#ease-inspector) — live readout of the selected keyframes' ease influence and speed, with quick editing, ease copy/paste, and a saved-ease library

## After Effects Scenes

_Nothing here yet._

## Cinema 4D Scenes

- [AOV Set Depth](Cinema4DScenes/README.md#aov-set-depth) — reference scene for a correctly configured Redshift Depth AOV

## Cinema 4D Scripts

- [Align Parent to Child](Cinema4DScripts/README.md#align-parent-to-child) — re-anchor a parent's pivot to its child without moving the geometry

## Cinema 4D Plugins

- [Safe Delete Object](Cinema4DPlugins/README.md#safe-delete-object) — checks for scene references and confirms before deleting an object
- [Ease FFD](Cinema4DPlugins/README.md#ease-ffd) — FFD deformer with an Ease slider that blends sharp/local vs. native smooth interpolation
- [Center Bend](Cinema4DPlugins/README.md#center-bend) — deformer that wraps geometry around a cylinder from the center outward, keeping the front flat

## Windows Programs

- [Hex Bench](WindowsPrograms/README.md#hex-bench) — sRGB hex → linear-light converter

## Adding or updating tools

Every tool follows the same packaging and documentation flow, and each one gets an automatic download. See [CONTRIBUTING.md](CONTRIBUTING.md).
