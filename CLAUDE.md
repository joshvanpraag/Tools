# Tools repo — instructions for Claude

This repo holds Josh's tools for Cinema 4D, After Effects, and other design software, grouped into CamelCase category folders, each with one README documenting all of its tools.

## Whenever you add, change, rename, or remove a tool

Follow [CONTRIBUTING.md](CONTRIBUTING.md) exactly. In short:

1. Files go in the right category folder (single-file tools loose; multi-file tools in their own subfolder named after the tool).
2. Register the tool in `tools.json` (`name` must match its README `## Heading`; `asset` is the download file name — the file itself for one file, `ToolName.zip` otherwise).
3. Document it in the category README, including the green **Download** badge that links to `https://github.com/joshvanpraag/Tools/releases/download/downloads/<asset>`.
4. Add one row to the root README's table for its category — `| [Name](link to writeup) | description | [**asset**](download link) |` — so each tool appears there exactly once (and add to **How to install** if it's a new type).
5. Run `python .github/scripts/build_downloads.py --check` and fix every error before committing.
6. After pushing to `main`, confirm the **Build downloads** Action succeeded (`gh run list --workflow downloads.yml --limit 1`) and the download link works.

Never point people at repo file URLs for downloads, and never hand-upload files to the Downloads release — the Action owns it.

## Style

- Match the existing READMEs: a `## Tool Name` heading, the file line in backticks, the download badge, then **What it does**, **Install**, **Usage**, **Notes**; screenshots named `ToolName.png` next to the tool.
- Commit directly to `main` with a short imperative subject (e.g. "Add Center Bend Cinema 4D plugin"), as in the existing history.

## Signing

`.zxp` extensions are committed pre-signed. The certificate and password are kept outside the repo — never commit `*.p12`, `*.pfx`, or password files. See CONTRIBUTING.md for re-signing steps.
