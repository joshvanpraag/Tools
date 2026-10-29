"""Build the per-tool downloads listed in tools.json and check the repo follows the tool conventions.

Usage:
    python .github/scripts/build_downloads.py            # check + build into dist/
    python .github/scripts/build_downloads.py --check    # check only (no files written)

Rules enforced (see CONTRIBUTING.md):
  * every file in a category folder belongs to a tool in tools.json, or is documentation
    (README.md, other .md notes, .png screenshots, .gitkeep)
  * every path listed in tools.json exists
  * single-file assets ship as that file; .zip assets bundle the listed files/folders
  * each tool's download link appears in its category README and in the root README
"""
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST = os.path.join(ROOT, "dist")
DOC_PATTERNS = ["README.md", "*.md", "*.png", ".gitkeep"]
ZIP_EXCLUDE = ["*.png", ".DS_Store", "Thumbs.db", "desktop.ini", "*.md"]

errors = []


def err(msg):
    errors.append(msg)


def tracked_files():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def repo_slug():
    slug = os.environ.get("GITHUB_REPOSITORY")
    if slug:
        return slug
    url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
    return m.group(1) if m else "OWNER/REPO"


def under(path, prefix):
    return path == prefix or path.startswith(prefix.rstrip("/") + "/")


def is_doc(path):
    name = path.split("/")[-1]
    return any(fnmatch.fnmatch(name, p) for p in DOC_PATTERNS)


def excluded_from_zip(path):
    name = path.split("/")[-1]
    return any(fnmatch.fnmatch(name, p) for p in ZIP_EXCLUDE)


def main():
    check_only = "--check" in sys.argv
    with open(os.path.join(ROOT, "tools.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    release = manifest["release"]
    tools = manifest["tools"]
    slug = repo_slug()
    files = tracked_files()

    categories = sorted({p.split("/")[0] for p in files if "/" in p and not p.startswith(".")})
    seen_assets = set()
    for t in tools:
        for key in ("name", "category", "asset", "files"):
            if key not in t:
                err("tools.json: a tool is missing \"%s\": %r" % (key, t))
        if t["asset"] in seen_assets:
            err("tools.json: asset name \"%s\" is used twice" % t["asset"])
        seen_assets.add(t["asset"])
        if t["category"] not in categories:
            err("%s: category folder \"%s\" doesn't exist" % (t["name"], t["category"]))
        for p in t["files"] + t.get("source", []):
            if not any(under(f, p) for f in files):
                err("%s: \"%s\" is listed in tools.json but isn't in the repo" % (t["name"], p))
        if not t["asset"].endswith(".zip"):
            shipped = [f for f in files if any(under(f, p) for p in t["files"])]
            if len(shipped) != 1:
                err("%s: \"%s\" isn't a .zip, so it must list exactly one file (found %d)" % (t["name"], t["asset"], len(shipped)))

    covered = [p for t in tools for p in t["files"] + t.get("source", [])]
    for f in files:
        if "/" not in f or f.startswith(".") or is_doc(f):
            continue
        if not any(under(f, p) for p in covered):
            err("\"%s\" isn't part of any tool in tools.json. Add it to a tool's \"files\" (or \"source\")." % f)

    def url(t):
        return "https://github.com/%s/releases/download/%s/%s" % (slug, release, t["asset"])

    readmes = {}

    def readme(path):
        if path not in readmes:
            full = os.path.join(ROOT, path)
            readmes[path] = open(full, encoding="utf-8").read() if os.path.exists(full) else None
        return readmes[path]

    for t in tools:
        link = url(t)
        cat = t["category"] + "/README.md"
        if readme(cat) is None:
            err("%s: %s is missing" % (t["name"], cat))
        elif link not in readme(cat):
            err("%s: %s has no download link (%s)" % (t["name"], cat, link))
        if link not in (readme("README.md") or ""):
            err("%s: the root README.md has no download link (%s)" % (t["name"], link))

    if errors:
        print("Tool checks failed:\n  - " + "\n  - ".join(errors))
        sys.exit(1)
    print("Checks passed: %d tools, %d categories." % (len(tools), len(categories)))
    if check_only:
        return

    assets = os.path.join(DIST, "assets")
    shutil.rmtree(DIST, ignore_errors=True)
    os.makedirs(assets)
    rows = []
    for t in tools:
        out = os.path.join(assets, t["asset"])
        if t["asset"].endswith(".zip"):
            stem = t["asset"][:-4]
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                for p in t["files"]:
                    members = sorted(f for f in files if under(f, p) and not excluded_from_zip(f))
                    is_folder = any(f != p for f in members)
                    for f in members:
                        if is_folder:
                            base = p.rstrip("/").split("/")[-1]
                            arc = base + "/" + f[len(p.rstrip("/")) + 1:]
                        else:
                            arc = stem + "/" + f.split("/")[-1]
                        z.write(os.path.join(ROOT, f), arc)
        else:
            src = [f for f in files if any(under(f, p) for p in t["files"])][0]
            shutil.copyfile(os.path.join(ROOT, src), out)
        size = os.path.getsize(out)
        rows.append("| %s | [%s](%s) | %s KB |" % (t["name"], t["asset"], url(t), max(1, round(size / 1024))))
        print("  built %-26s %8d bytes" % (t["asset"], size))

    notes = ["Always-current downloads for every tool in this repo, rebuilt automatically on every change to `main`.",
             "", "Each link below (and on the tool's README) always serves the newest version.", "",
             "| Tool | Download | Size |", "|---|---|---|"] + rows + ["",
             "New to this? See [How to install](https://github.com/%s#how-to-install) in the README." % slug]
    with open(os.path.join(DIST, "notes.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(notes) + "\n")
    print("Built %d downloads into dist/assets." % len(tools))


if __name__ == "__main__":
    main()
