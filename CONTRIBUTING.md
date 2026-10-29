# Adding and updating tools

Every tool in this repo follows the same flow so that anyone — including people who've never used GitHub — can download it with one click. A GitHub Action ([`.github/workflows/downloads.yml`](.github/workflows/downloads.yml)) packages each tool and publishes it to the rolling [**Downloads** release](https://github.com/joshvanpraag/Tools/releases/tag/downloads) on every push to `main`. Download links never change, so they always serve the newest version.

**Never link to files in the repo as a "download".** Readers get a code view instead of a file. Always use the release link (below).

## Adding a new tool

1. **Put the files in the right category folder.** Folder names are CamelCase with no spaces (e.g. `AfterEffectsScripts`, `Cinema4DPlugins`).
   - Single-file tools (a `.jsx`, `.py`, `.exe`, `.c4d`) sit loose in the category folder.
   - Tools that need several files or a folder structure (Cinema 4D plugins, CEP extensions) get their own subfolder named after the tool, e.g. `Cinema4DPlugins/EaseFFD/`.
2. **Add a screenshot** (optional) named after the tool, e.g. `EaseFFD.png`, next to the tool. Screenshots and `.md` notes are documentation and are never included in downloads.
3. **Register the tool in [`tools.json`](tools.json):**

   ```json
   {
     "name": "Ease FFD",
     "category": "Cinema4DPlugins",
     "asset": "EaseFFD.zip",
     "files": ["Cinema4DPlugins/EaseFFD"]
   }
   ```

   - `name` must match the tool's `## Heading` in its category README exactly.
   - `asset` is the download's file name — unique, no spaces.
     - One file → use that file's name (e.g. `HexSwap.jsx`), and list exactly that one file. It's published as-is.
     - More than one file, or a folder → use `ToolName.zip`. A listed folder is zipped as that folder (unzips to `EaseFFD/…`); loose files are zipped into a folder named after the asset (unzips to `CompStandardizer/…`).
   - `files` are the repo paths that ship in the download (files or folders).
   - `source` (optional) lists repo paths that belong to the tool but aren't shipped — e.g. the source folder of a signed `.zxp`.
4. **Write it up in the category's `README.md`**, matching the existing style:
   - Add it to the contents list at the top.
   - Add a `## Tool Name` section: the file line in backticks, then the download button, then **What it does**, **Install**, **Usage**, and **Notes** as needed. Separate tools with the `<br>` spacer block used in the other READMEs.
   - Download button (replace both `ASSET` placeholders; in the badge text, write `-` as `--` and `_` as `__`):

     ```markdown
     [![Download ASSET](https://img.shields.io/badge/Download-ASSET-2ea44f?style=for-the-badge&logo=github)](https://github.com/joshvanpraag/Tools/releases/download/downloads/ASSET)
     ```
5. **Update the root [`README.md`](README.md):**
   - Add a row to the **Downloads** table (tool, type, download link).
   - Add a bullet under the tool's category section.
   - If it's a new *type* of tool, add a row to the **How to install** table.
6. **Run the check locally** (optional, but catches mistakes before pushing):

   ```
   python .github/scripts/build_downloads.py --check
   ```

   Run it without `--check` to also build the downloads into `dist/` (git-ignored) so you can test them.
7. **Commit and push to `main`.** Then check the repo's **Actions** tab: the **Build downloads** run should be green, and the tool appears on the Downloads release within a minute or two.

## Updating a tool

Edit the files and push to `main`. The Action republishes the download under the same link. Update the README if the behavior changed.

## Removing a tool

Delete its files, its `tools.json` entry, its README section, and its root README rows. The Action removes the old download from the release automatically.

## Adding a new category

Create the CamelCase folder with a `README.md` (title + contents list, like the others), add a section for it to the root README in the same style, and add its type to the **How to install** table.

## Signed After Effects extensions (`.zxp`)

The `.zxp` is committed already signed — the Action publishes it as-is and never signs anything.

1. Bump `ExtensionBundleVersion` and the `<Extension … Version>` in `CSXS/manifest.xml`.
2. Re-sign: `ZXPSignCmd -sign <ExtensionFolder> <Tool>.zxp <cert.p12> <password>`, then `ZXPSignCmd -verify <Tool>.zxp`.
3. Commit the source changes and the new `.zxp` together.

The signing certificate and its password live outside the repo and must **never** be committed (`.gitignore` blocks `*.p12`, `*.pfx`, and password files). ZXPSignCmd 4.1.103 crashes when given `-tsa`, so packages aren't timestamped; the certificate is valid until October 2036.

## What the automated check enforces

The build fails — and nothing is published — if:

- a file in a category folder isn't part of any tool in `tools.json` (documentation files — `README.md`, other `.md`, `.png`, `.gitkeep` — are exempt);
- a path listed in `tools.json` doesn't exist;
- a single-file asset doesn't map to exactly one file, or two tools share an asset name;
- a tool's download link is missing from its category README or from the root README.

The check also runs on pull requests (without publishing).
