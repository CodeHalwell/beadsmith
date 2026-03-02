# Beadsmith Deployment Plan Design

**Date:** 2026-03-02
**Target:** GitHub release v3.56.0 (tagged, with VSIX artifact)
**Approach:** Minimal manual release — fix only what blocks packaging, defer CI pipeline fixes

## Context

The backend and UI features are implemented (12 tasks completed in the release-ready implementation plan). The existing CI/CD infrastructure is sophisticated (publish.yml, nightly builds, multi-platform standalone) but has pre-existing issues (Node.js v25.7.0 ESM/CJS incompatibility with mocha, webview build script gap). Rather than fixing the full CI pipeline, this plan focuses on a verified manual release.

## Current State

| Area | Status |
|------|--------|
| Features implemented | 12/12 tasks complete |
| Type checking | Passes |
| Lint | Passes |
| Unit tests | Blocked by Node.js v25.7.0 mocha/yargs ESM issue |
| E2E tests | Not run (Playwright setup needed) |
| VSIX packaging | Not yet verified |
| Changeset | Existing changesets reference wrong package name (`claude-dev`) |
| Version | 3.55.0 → target 3.56.0 |

## Work Streams

### 1. Fix Changeset Package Name

Existing changesets in `.changeset/` reference `claude-dev` (the Cline fork origin). The package is now `beadsmith`. These need updating or they'll fail during `changeset version`.

- Update `eight-wasps-clap.md` and `eighty-waves-stay.md`: change `"claude-dev": patch` → `"beadsmith": patch`
- Verify `.changeset/config.json` doesn't reference old package name

### 2. Create Release Changeset

Create a new changeset covering all release-ready features:

```markdown
---
"beadsmith": patch
---

Add Ralph Wiggum Loop, Beads system, and DAG engine with full UI integration.

- Real-time bead streaming from backend to webview
- Collapsible diff viewer in bead review using react-diff-viewer-continued
- DAG-bead visual integration with "View in DAG" button and change overlay
- Bead history panel with vertical timeline in task header
- Integration tests for Ralph+Bead, Bead+DAG, and DAG Python engine
- E2E smoke test for bead workflow
```

### 3. Version Bump

- Run `npx changeset version` to consume all changesets and bump to 3.56.0
- Review generated CHANGELOG.md entry
- Verify package.json version updated

### 4. Build Verification

Verify the extension packages and installs cleanly:

```bash
# Type check
npm run check-types

# Lint
npm run lint

# Generate protos (required for build)
npm run protos

# Build webview
npm run build:webview

# Build extension
node esbuild.mjs --production

# Package VSIX
npx @vscode/vsce package --no-dependencies
```

The `--no-dependencies` flag skips npm install during packaging (dependencies are already bundled by esbuild).

### 5. DAG Engine Verification

Verify the Python DAG engine sets up cleanly:

```bash
npm run setup:dag
cd dag-engine && python -m pytest tests/ -v
```

### 6. Release Notes

```markdown
## Beadsmith v3.56.0 — Ralph Loop, Beads & DAG

### Highlights

**Ralph Wiggum Loop** — Iterative AI task execution with fresh context per iteration, automatic completion detection, and backpressure checks (tests, types, lint pass before advancing).

**Beads** — Each iteration produces a discrete, reviewable "bead" of work. Review diffs inline with a collapsible diff viewer, approve or reject changes, and track progress through the bead history timeline.

**DAG Engine** — Python-powered dependency analysis visualizes how code changes ripple through your project. See affected files highlighted in the force-directed graph, with confidence scoring (high/medium/low) for each impact path.

### New UI Features

- Real-time bead status streaming to the webview
- Collapsible per-file diff viewer in bead review
- "View in DAG" button showing change impact overlay
- Bead history panel with expandable timeline in task header

### Getting Started

1. Download `beadsmith-3.56.0.vsix` from the release assets
2. Install: `code --install-extension beadsmith-3.56.0.vsix`
3. For DAG features: Python 3.12+ required. Run `npm run setup:dag` from the extension directory.

### Known Limitations

- Unit test suite has pre-existing Node.js v25.7.0 ESM compatibility issue (does not affect extension functionality)
- VS Code Marketplace listing not yet available (install from VSIX)
- Windows CLI support not included
```

### 7. Tag & GitHub Release

```bash
# Commit version bump
git add -A
git commit -m "chore: release v3.56.0"

# Tag
git tag v3.56.0

# Push
git push origin main --tags
```

Create GitHub release via `gh release create`:
- Tag: `v3.56.0`
- Title: `Beadsmith v3.56.0 — Ralph Loop, Beads & DAG`
- Body: Release notes from Section 6
- Asset: `beadsmith-3.56.0.vsix`

### 8. Post-Release Verification

- Download VSIX from GitHub release page
- Install in a fresh VS Code window: `code --install-extension beadsmith-3.56.0.vsix`
- Verify: extension activates, sidebar loads, chat works, DAG panel opens

## Out of Scope

- VS Code Marketplace / OpenVSX publishing
- Fixing CI pipeline (mocha ESM issue, webview build)
- Nightly build naming fix (`cline-nightly` → `beadsmith-nightly`)
- Standalone distribution / NPM package
- Windows CLI support
- Automated release workflow trigger

## Dependency Order

```
1. Fix changeset package names
2. Create release changeset
3. Version bump (depends on 1, 2)
4. Build verification (depends on 3)
5. DAG verification (independent of 4)
6. Write release notes (independent)
7. Tag & GitHub release (depends on 4, 5, 6)
8. Post-release verification (depends on 7)
```
