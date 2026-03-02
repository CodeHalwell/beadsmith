# Beadsmith v3.56.0 Deployment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a tagged GitHub release (v3.56.0) with a VSIX artifact and release notes highlighting Ralph Loop, Beads, and DAG features.

**Architecture:** Manual release process — fix changesets, bump version, build and package VSIX locally, verify installation, then create GitHub release with `gh`. No Marketplace publishing. No CI pipeline fixes.

**Tech Stack:** @changesets/cli, @vscode/vsce, gh CLI, esbuild, Vite

---

### Task 1: Fix Changeset Package Names

Existing changesets reference `claude-dev` (the Cline fork origin). The package name is now `beadsmith`. These must be fixed before `changeset version` can run.

**Files:**
- Modify: `.changeset/eight-wasps-clap.md`
- Modify: `.changeset/eighty-waves-stay.md`

**Step 1: Fix first changeset**

Replace the frontmatter package name in `.changeset/eight-wasps-clap.md`:

```markdown
---
"beadsmith": patch
---

Lock the LiteLLM Api Key input when it's remotely configured
```

**Step 2: Fix second changeset**

Replace the frontmatter package name in `.changeset/eighty-waves-stay.md`:

```markdown
---
"beadsmith": patch
---

updated welcome card content and added ability to close each card
```

**Step 3: Verify no other changesets reference old name**

Run: `grep -r "claude-dev" .changeset/`
Expected: No output (no remaining references)

**Step 4: Commit**

```bash
git add .changeset/eight-wasps-clap.md .changeset/eighty-waves-stay.md
git commit -m "fix: update changeset package names from claude-dev to beadsmith"
```

---

### Task 2: Create Release Changeset

Create a changeset covering all the release-ready features built in the previous implementation plan.

**Files:**
- Create: `.changeset/release-ready-features.md`

**Step 1: Create the changeset file**

Create `.changeset/release-ready-features.md` with this exact content:

```markdown
---
"beadsmith": patch
---

Add Ralph Wiggum Loop, Beads system, and DAG engine with full UI integration.

- Real-time bead streaming from backend to webview
- Collapsible diff viewer in bead review using react-diff-viewer-continued
- DAG-bead visual integration with change overlay and "View in DAG" button
- Bead history panel with vertical timeline in task header
- Integration tests for Ralph+Bead, Bead+DAG, and DAG Python engine
- E2E smoke test for bead workflow
```

**Step 2: Verify changeset is valid**

Run: `npx changeset status`
Expected: Output lists 3 changesets (two existing + the new one), all for `beadsmith` as `patch`

**Step 3: Commit**

```bash
git add .changeset/release-ready-features.md
git commit -m "chore: add release-ready features changeset"
```

---

### Task 3: Version Bump

Consume all changesets and bump the version from 3.55.0 to 3.55.3 (three patch bumps).

**Files:**
- Modify: `package.json` (version field)
- Modify: `CHANGELOG.md` (new entry)
- Delete: `.changeset/eight-wasps-clap.md`
- Delete: `.changeset/eighty-waves-stay.md`
- Delete: `.changeset/release-ready-features.md`

**Step 1: Run changeset version**

Run: `npx changeset version`

Expected:
- `package.json` version updated (likely to `3.55.3` — three patches)
- `CHANGELOG.md` has a new entry at the top
- The three `.md` changeset files are deleted (only `README.md` and `config.json` remain)

**Step 2: Verify version was bumped**

Run: `grep '"version"' package.json`
Expected: `"version": "3.55.3",` (or similar patch bump)

**Step 3: Review generated changelog**

Read the first 30 lines of `CHANGELOG.md` to verify the entry looks correct. Entries should list the three changeset descriptions.

**Step 4: Commit**

```bash
git add package.json CHANGELOG.md .changeset/
git commit -m "chore: version bump to v3.55.3"
```

Note: The exact version number depends on how changesets resolves the three patches. Adjust the tag in subsequent tasks to match.

---

### Task 4: Build Verification — Type Check & Lint

Verify the codebase compiles and passes quality checks.

**Step 1: Generate protos**

Run: `npm run protos`
Expected: Completes without errors. Proto files generated in `src/generated/` and `src/shared/proto/`.

**Step 2: Type check extension**

Run: `npx tsc --noEmit`
Expected: No errors (0 exit code)

**Step 3: Type check webview**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: No errors (0 exit code)

**Step 4: Lint**

Run: `npm run lint`
Expected: No errors

---

### Task 5: Build Verification — Package VSIX

Build the extension and package it as a VSIX.

**Step 1: Build webview**

Run: `cd webview-ui && npm run build`
Expected: Vite build completes, output in `webview-ui/dist/`

**Step 2: Build extension**

Run: `node esbuild.mjs --production`
Expected: esbuild completes, output in `dist/`

**Step 3: Package VSIX**

Run: `npx @vscode/vsce package --no-dependencies`
Expected: Creates `beadsmith-<version>.vsix` in the project root. Note the exact filename.

If vsce is not installed globally, this will npx it. The `--no-dependencies` flag skips running `npm install` during packaging since dependencies are already bundled by esbuild.

**Step 4: Verify VSIX exists**

Run: `ls -la beadsmith-*.vsix`
Expected: One `.vsix` file, several MB in size

**Step 5: Commit** (no code changes, but record the successful build)

No commit needed — build artifacts are gitignored.

---

### Task 6: DAG Engine Verification

Verify the Python DAG engine sets up and its tests pass.

**Step 1: Set up DAG engine**

Run: `npm run setup:dag`
Expected: Python venv created in `dag-engine/.venv/`, dependencies installed

If Python 3.12+ is not available, note this as a known limitation but don't block the release.

**Step 2: Run DAG tests**

Run: `cd dag-engine && .venv/bin/python -m pytest tests/ -v`
Expected: All tests pass. If some tests fail due to missing dependencies or environment issues, document but don't block.

**Step 3: Return to project root**

Run: `cd /Users/danielhalwell/PythonProjects/beadsmith`

---

### Task 7: Write Release Notes

Create a release notes file for use in the GitHub release.

**Files:**
- Create: `docs/release-notes/v3.55.3.md` (adjust version to match Task 3)

**Step 1: Create release notes file**

Create `docs/release-notes/v3.55.3.md` (adjust version) with this content:

```markdown
## Beadsmith v3.55.3 — Ralph Loop, Beads & DAG

### Highlights

**Ralph Wiggum Loop** — Iterative AI task execution with fresh context per iteration, automatic completion detection via promise string matching, and backpressure checks (tests, types, lint must pass before advancing).

**Beads** — Each iteration produces a discrete, reviewable "bead" of work. Review file diffs inline with a collapsible diff viewer, approve or reject changes, and track progress through the bead history timeline.

**DAG Engine** — Python-powered dependency analysis visualizes how code changes ripple through your project. See affected files highlighted in the force-directed graph, with confidence scoring (high/medium/low) for each impact path.

### New UI Features

- Real-time bead status streaming to the webview
- Collapsible per-file diff viewer in bead review (powered by react-diff-viewer-continued)
- "View in DAG" button showing change impact overlay on the dependency graph
- Bead history panel with expandable vertical timeline in task header

### Installation

1. Download `beadsmith-3.55.3.vsix` from the release assets below
2. Install via CLI: `code --install-extension beadsmith-3.55.3.vsix`
3. Or in VS Code: Extensions → `...` menu → "Install from VSIX..."

### DAG Engine Setup

The DAG dependency analysis requires Python 3.12+:

1. Open the Beadsmith sidebar in VS Code
2. Navigate to DAG panel
3. Run setup when prompted, or manually: `npm run setup:dag` from the extension directory

### Known Limitations

- VS Code Marketplace listing not yet available — install from VSIX
- Windows CLI support not included in this release
- DAG engine requires Python 3.12+ (optional feature)
```

**Step 2: Commit**

```bash
mkdir -p docs/release-notes
git add docs/release-notes/
git commit -m "docs: add v3.55.3 release notes"
```

Adjust the version number in filenames and content to match the actual version from Task 3.

---

### Task 8: Tag & Create GitHub Release

Create the git tag and GitHub release with the VSIX artifact.

**Step 1: Determine the version**

Run: `grep '"version"' package.json | head -1`
Note the version number — use it for all subsequent commands. We'll call it `VERSION` below.

**Step 2: Create git tag**

Run: `git tag v${VERSION}`
Example: `git tag v3.55.3`

**Step 3: Push to origin with tags**

Run: `git push origin main --tags`
Expected: Tag pushed successfully

**Step 4: Create GitHub release**

Run the following (substituting the actual version and VSIX filename):

```bash
gh release create v3.55.3 \
  beadsmith-3.55.3.vsix \
  --title "Beadsmith v3.55.3 — Ralph Loop, Beads & DAG" \
  --notes-file docs/release-notes/v3.55.3.md
```

Expected: GitHub release created with the VSIX as a downloadable asset. The command outputs the release URL.

**Step 5: Verify release**

Run: `gh release view v3.55.3`
Expected: Shows the release with title, notes, and the `.vsix` asset listed

---

### Task 9: Post-Release Verification

Verify the release artifact is downloadable and functional.

**Step 1: Download VSIX from release**

Run: `gh release download v3.55.3 --pattern "*.vsix" --dir /tmp/beadsmith-verify/`
Expected: VSIX downloaded to `/tmp/beadsmith-verify/`

**Step 2: Verify VSIX installs**

Run: `code --install-extension /tmp/beadsmith-verify/beadsmith-3.55.3.vsix`
Expected: Extension installs successfully

**Step 3: Manual smoke test**

Open VS Code and verify:
- [ ] Beadsmith appears in the sidebar
- [ ] Webview loads without errors
- [ ] DAG panel is accessible
- [ ] No error notifications on activation

**Step 4: Print release URL**

Run: `gh release view v3.55.3 --json url -q .url`
Expected: Prints the GitHub release URL. Share this with the user.

---

## Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Fix changeset package names | — |
| 2 | Create release changeset | — |
| 3 | Version bump | 1, 2 |
| 4 | Type check & lint | 3 |
| 5 | Package VSIX | 4 |
| 6 | DAG verification | — (parallel with 4-5) |
| 7 | Write release notes | 3 (needs version number) |
| 8 | Tag & GitHub release | 5, 6, 7 |
| 9 | Post-release verification | 8 |
