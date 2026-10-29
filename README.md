# 🧰 Tools

A collection of tools created for use in Cinema 4D, After Effects, and other design software.

Find a tool below and click its download link. The links always give you the newest version. Click a tool's name for its full writeup, and see [How to install](#how-to-install) if you're new to installing tools. Every download is also listed on the [Downloads release](https://github.com/joshvanpraag/Tools/releases/tag/downloads).

## 🎞️ After Effects

### 📜 Scripts

| Tool | What it does | Download |
|---|---|---|
| [Hex Swap](AfterEffectsScripts/README.md#hex-swap) | Bulk find & replace hex colors across a project | [**HexSwap.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/HexSwap.jsx) |
| [Depth Range Slice](AfterEffectsScripts/README.md#depth-range-slice) | Animated depth-pass slice/reveal rig | [**DepthRangeSlice.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/DepthRangeSlice.jsx) |
| [Reset Layer Time Offsets](AfterEffectsScripts/README.md#reset-layer-time-offsets) | Zero out layer start times while preserving on-screen timing | [**ResetLayerTimeOffsets.jsx**](https://github.com/joshvanpraag/Tools/releases/download/downloads/ResetLayerTimeOffsets.jsx) |
| [Comp Standardizer](AfterEffectsScripts/README.md#comp-standardizer) | Apply consistent comp/viewer/timeline settings across a whole project | [**CompStandardizer.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/CompStandardizer.zip) |

### 🧩 Plugins

| Tool | What it does | Download |
|---|---|---|
| [Ease Inspector](AfterEffectsPlugins/README.md#ease-inspector) | Live readout of the selected keyframes' ease influence and speed, with quick editing, ease copy/paste, and a saved-ease library | [**EaseInspector.zxp**](https://github.com/joshvanpraag/Tools/releases/download/downloads/EaseInspector.zxp) |

### 🎬 Scenes

_Nothing here yet._

<br>
<br>
<br>
<br>

---

<br>

## 🧊 Cinema 4D

### 📜 Scripts

| Tool | What it does | Download |
|---|---|---|
| [Align Parent to Child](Cinema4DScripts/README.md#align-parent-to-child) | Re-anchor a parent's pivot to its child without moving the geometry | [**AlignParentToChild.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/AlignParentToChild.zip) |

### 🧩 Plugins

| Tool | What it does | Download |
|---|---|---|
| [Safe Delete Object](Cinema4DPlugins/README.md#safe-delete-object) | Checks for scene references and confirms before deleting an object | [**SafeDeleteObject.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/SafeDeleteObject.zip) |
| [Ease FFD](Cinema4DPlugins/README.md#ease-ffd) | FFD deformer with an Ease slider that blends sharp/local vs. native smooth interpolation | [**EaseFFD.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/EaseFFD.zip) |
| [Center Bend](Cinema4DPlugins/README.md#center-bend) | Deformer that wraps geometry around a cylinder from the center outward, keeping the front flat | [**CenterBend.zip**](https://github.com/joshvanpraag/Tools/releases/download/downloads/CenterBend.zip) |

### 🎬 Scenes

| Tool | What it does | Download |
|---|---|---|
| [AOV Set Depth](Cinema4DScenes/README.md#aov-set-depth) | Reference scene for a correctly configured Redshift Depth AOV | [**AOVSetDepth.c4d**](https://github.com/joshvanpraag/Tools/releases/download/downloads/AOVSetDepth.c4d) |

<br>
<br>
<br>
<br>

---

<br>

## 💻 Windows Programs

| Tool | What it does | Download |
|---|---|---|
| [Hex Bench](WindowsPrograms/README.md#hex-bench) | sRGB hex → linear-light converter | [**HexBench.exe**](https://github.com/joshvanpraag/Tools/releases/download/downloads/HexBench.exe) |

<br>
<br>
<br>
<br>

---

<br>

<a id="how-to-install"></a>

## 🛠️ How to install

1. **Download** the tool from its table above (or the green **Download** button on its writeup).
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

<a id="adding-or-updating-tools"></a>

## ✍️ Adding or updating tools

Every tool follows the same packaging and documentation flow, and each one gets an automatic download. See [CONTRIBUTING.md](CONTRIBUTING.md).
