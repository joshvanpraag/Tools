# Hex Swap — Developer Notes

A handoff document for future changes. To pick this up in a new AI session (Atom or another assistant), say:

> "Read `Hex Swap/DEVELOPER NOTES.md` and `Hex Swap/Hex Swap.jsx`, then help me change …"

---

## What it is
A dockable ScriptUI panel for After Effects. It finds colors by hex code across a project, or across the comps selected in the Project panel, and swaps them in bulk.

- File: `Hex Swap.jsx` (a single file with no dependencies)
- Built and tested on: **After Effects 26.3** (Windows)
- Install: copy the file to `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`, restart AE, then open **Window → Hex Swap.jsx**
- Copy, Save and Load need: Settings (Preferences) → Scripting & Expressions → "Allow Scripts to Write Files and Access Network"

## Requirements agreed with the user
1. **Scope:** Entire project, or comps/folders selected in the Project panel.
2. **Nested precomps:** included by default, with a checkbox to turn them off (only used with Selected scope).
3. **Categories to search** (checkboxes): Shape Fill / Stroke / Gradients (report only); Text Fill / Stroke (including per-character colors and animator colors); Comp background; Solid colors; Light colors; Layer Styles; Effect colors; Color Controls / pseudo-effect rigs; Essential Properties.
4. **Tolerance slider:** 0–64, as the maximum difference per RGB channel on a 0–255 scale. When several rows are within tolerance, the closest match wins.
5. **Color mode:** Standard (matches the color picker, which is the stored value) or Linear (matches rendered output in linearized projects, using the sRGB curve).
6. **Solids:** changing a solid's color is OK even though it changes everywhere that solid is used.
7. **Expressions:** skip them and list them in the report. The report can be copied to the clipboard or saved as a .txt.
8. **Swap lists:** can be saved and loaded as `.json` (the native format) or `.txt` (`#OLD > #NEW` per line).
9. **Persistence:** every setting and the swap list save automatically, and there's a **Reset to Defaults** button.
10. **Apply does NOT open a report window**; it only updates the status line. The user opens **Last Report** when needed. (Preview still opens its report.)

## Code map (`Hex Swap.jsx`)
| Section | What's there |
|---|---|
| `CATS` | Category definitions (key, checkbox label, short name `abbr`, UI group, tooltip). Add new categories here. |
| `Json` | Built-in JSON stringify/parse (ExtendScript has no native JSON). |
| Color math | `parseHex`, `hexToRgb`, `rgbToHex`, `valueToRgb(v, mode)`, `hexToValue(hex, mode, template)`, sRGB/linear conversions |
| Swap parsing | `parseSwapText` (paste box and .txt), `sanitizeMappings`, `buildRules` (validation, duplicate warnings), `matchRule` |
| Engine | `Ctx`, `collectComps`, `processComp` → `processLayer` → `processColorProp` / `processTextProp` / `processTextDoc`; `evalColor` is the single place where matching and recording happen |
| `runEngine(state, mode)` | mode = `"scan"`, `"preview"` or `"apply"`. Apply is wrapped in one undo group. |
| `buildReport` | Plain-text report (swaps, categories, warnings, skipped expressions, gradients, 32-bpc values, errors, comps) |
| Files/clipboard | `copyToClipboard` (PowerShell `Set-Clipboard` on Windows, `pbcopy` on Mac), `saveReportFile`, `writeTextFile`, `readTextFile` |
| State | `defaultState`, `loadState` (merges and clamps saved values), `saveState` → `app.settings` section `HexSwap`, key `state_v1`; last report in `lastReport_v1` |
| UI | `buildUI`: tabs **1 Setup / 2 Scan / 3 Swap**, then Preview / Apply / Last Report / Reset, then the status line. Swap rows are 8 fixed row widgets bound to `state.mappings` through a scrollbar offset. |

## After Effects quirks found during development
- **Reserved words:** ExtendScript uses ES3 syntax, so `short`, `int`, `class`, `default` and similar can't be bare property names. A key named `short` broke loading once, which is why the property is now called `abbr`.
- **Shape gradient colors** (`ADBE Vector Grad Colors`) are `NO_VALUE`, so no script can read or write them. They're reported only.
- **Text animators** create hidden, unused color properties (Stroke, Front, Bevel, Side, Back) that default to red. The filter is `if (!p.canSetExpression) skip`, since only properties the user actually added allow expressions.
- **Layer Styles:** all style groups always exist. An applied style has `canSetEnabled === true` (even when toggled off). A style that was never added has `false`.
- **Per-character text** (AE 24.3+): `td.characterRange(0, len).fillColor` returns `undefined` when the text has mixed colors. That triggers the per-run scan, which groups adjacent characters of the same color. Whitespace-only runs are swapped but not counted in scans.
- **Null and adjustment layer solids** are skipped (their color never renders).
- **Locked layers** are unlocked briefly to write the new color, then re-locked.
- **Linearized working space** (`app.project.linearizeWorkingSpace`): rendered colors differ from the stored or picker values. For example, stored `#FFAA00` renders as about `#FFD500`. The report header shows this setting.
- **Values over 1.0** (32-bpc/HDR) can't be written as hex. They're skipped and listed.

## Testing hook
Set `$.global.HEXSWAP_TEST = true` before `$.evalFile(...)` and the file exposes `$.global.HexSwapAPI` (`runEngine`, `buildReport`, `parseHex`, `parseSwapText`, `buildRules`, `defaultState`, `loadState`, `Json`, `buildUI`, `valueToRgb`, `hexToValue`) without opening the panel. Set it back to `false` afterward.

The test comps **HS Main**, **HS Nested** and **HS Other** in `test.aep` cover every category, keyframes, an expression, a locked layer, mixed text, a nested precomp and an out-of-scope comp.

## Changelog
- **v1.0**: first build: scan, preview and apply; all categories; tolerance; Standard/Linear modes; save/load sets; paste list; reverse; persistence; reset; copyable reports.
  - Fix: renamed the reserved word `short` to `abbr`.
  - Fix: hidden text animator color properties are no longer counted.
  - Linear mode relabeled "matches rendered output"; the report shows whether the project is linearized.
  - Apply no longer opens a report window; the status line points to Last Report.
