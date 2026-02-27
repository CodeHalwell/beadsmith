# Beadsmith Release-Ready Design

**Date:** 2026-02-27
**Target:** GitHub release (tagged, with VSIX artifact)
**Approach:** Full polish — all three differentiating systems (Ralph loop, Beads, DAG) working end-to-end with showcase-quality UI

## Current State

The backend is ~90% complete. BeadManager, RalphLoopController, DAG engine, all controllers, and proto definitions are implemented. The gaps are in integration wiring, UI polish, and test coverage.

| Area | Status | Gap |
|------|--------|-----|
| Backend logic | ~90% | Missing: integration between Ralph/Bead/DAG |
| Bead UI components | ~90% | Missing: real-time streaming subscription |
| DAG UI | ~85% | Missing: bead impact overlay |
| State sync | ~40% | Static only, no live updates |
| Diff viewer | 0% | Not built |
| Bead history panel | 0% | Not built |
| Integration tests | 0% | No tests exercise full workflow |

## Work Streams

### 1. Real-Time Bead Streaming

Wire `subscribeToBeadUpdates` from the backend to the webview so bead state updates live.

- Webview calls `BeadServiceClient.subscribeToBeadUpdates()` on mount
- `ExtensionStateContext` gets a new reducer/state slice for live bead state
- Events (bead_started, bead_completed, bead_failed, awaiting_approval) trigger re-renders
- `BeadTimeline` in task header updates live with progress, iteration count, status
- `bead_review` events trigger the review UI inline in chat
- Cancellation follows existing `!isLast` + `lastModifiedMessage?.ask === "resume_task"` pattern

### 2. Diff Viewer in Bead Review

Add `react-diff-viewer-continued` for rendering diffs in `BeadReviewMessage`.

- Render diffs from `Bead.filesChanged[].diff` field
- Each file is collapsible — filename + change summary by default, expand for diff
- Unified diff view with green/red color coding matching VS Code theme
- Line wrapping, no horizontal scroll
- Read-only — no inline commenting

### 3. DAG-Bead Visual Integration

Connect the DAG visualization to bead changes so users see impact visually.

- "View in DAG" button in `BeadReviewMessage` impact section opens DAG panel with changed files highlighted
- `ForceGraph` bead overlay mode: changed nodes in one color, affected/dependent nodes in another
- Confidence breakdown uses existing DAG color scheme
- Standalone DAG panel shows "last bead impact" indicator when bead task is active
- Scope: current/last bead impact only, no bead history in DAG

### 4. Bead History Panel

Vertical timeline of all beads in a task, accessible from task header.

- Shows: bead number, status (approved/rejected/skipped/failed), files changed count, token usage
- Expandable entries: change summary, success criteria results, rejection feedback, commit hash
- Clicking a bead scrolls to corresponding chat messages
- Uses existing `getBeadHistory` controller
- Read-only — no rollback/revert

### 5. Integration Tests

#### Backend (TypeScript, Mocha)
- RalphLoop + BeadManager: task lifecycle through iteration, completion, approval
- BeadManager + DAG: bead file changes trigger impact analysis
- Full workflow: start → iterate → criteria pass → approve → complete
- Error paths: max iterations, token budget, criteria failure, cancellation

#### DAG Engine (Python, pytest)
- Impact analysis correctness (change function → verify affected dependents)
- Confidence scoring verification
- Cross-language dependency tracking

#### E2E (Playwright)
- Happy-path smoke test: start extension → open bead task → UI updates → approve → complete

### 6. Release Packaging

- All tests pass (`npm run test`, integration tests, DAG pytest)
- Type checking clean (`npm run check-types`)
- Lint clean (`npm run lint`)
- VSIX builds (`vsce package`)
- DAG setup works clean (`npm run setup:dag`)
- Changeset created (patch bump)
- Tagged release with VSIX artifact
- Release notes highlighting Ralph loop, Beads, DAG features
- "Getting Started" section noting Python 3.12+ requirement for DAG

## Dependency Order

```
1. Real-time streaming (unblocks all UI work)
2. Diff viewer (independent of streaming, but needed for review)
3. DAG-bead integration (depends on streaming for overlay triggers)
4. Bead history panel (depends on streaming for live state)
5. Integration tests (depends on all features being wired)
6. Release packaging (depends on everything)
```

## Out of Scope

- Bead rollback/revert UI
- Inline commenting on diffs
- DAG bead history (showing all beads' impacts over time)
- Windows CLI support
- VS Code Marketplace listing
- TaskComplete / PreCompact hooks (marked "coming soon" in code)
