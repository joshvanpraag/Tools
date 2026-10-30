# Windows Programs

- [Hex Bench](#hex-bench) — `HexBench.exe`

## Hex Bench

`HexBench.exe`

<a href="https://github.com/joshvanpraag/Tools/releases/download/downloads/HexBench.exe"><img src="https://img.shields.io/badge/Download-HexBench.exe-2ea44f?style=for-the-badge&logo=github" alt="Download HexBench.exe" height="28"></a>

Small Windows utility for converting sRGB hex color codes to linear-light values.

<img src="HexBench.png" alt="Hex Bench UI" width="800" height="1089">

**What it does**

Paste one or more sRGB hex codes (`#RGB` or `#RRGGBB`, separated by spaces/commas/newlines) and each channel is run through the sRGB inverse transfer function (threshold `0.04045`, exponent `2.4`, per IEC 61966-2-1) and re-encoded back to hex, alongside the raw 0–1 float values. Useful for getting correct linear-light values for shaders and render engines from a color picked in an sRGB-space tool.

**Usage**

Run `HexBench.exe`, paste your hex code(s) into the input box, and read the converted linear hex + float values below. Click **Copy** to grab a result.

<!-- Spacer so the last section can scroll to the top when linked to. -->
<img src="../.github/assets/spacer.png" width="1" height="1000" alt="">
