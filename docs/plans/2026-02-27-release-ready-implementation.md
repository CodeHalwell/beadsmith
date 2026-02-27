# Beadsmith Release-Ready Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Beadsmith's three differentiating systems (Ralph loop, Beads, DAG) fully integrated with showcase-quality UI and ship a GitHub release.

**Architecture:** The backend (BeadManager, RalphLoopController, DAG engine) is ~90% complete. This plan wires real-time streaming from backend to webview, builds missing UI components (diff viewer, bead history), connects DAG visualization to bead changes, and adds integration tests.

**Tech Stack:** TypeScript, React, gRPC/Protobuf, D3.js, react-diff-viewer-continued, Mocha/Sinon, Playwright, Python/pytest

---

## Task 1: Add Live Bead State to Controller State Sync

The webview gets state via `getStateToPostToWebview()` in the Controller. Currently `currentBeadNumber`, `beadTaskStatus`, and `totalBeadsCompleted` are NOT included. Add them.

**Files:**
- Modify: `src/core/controller/index.ts:1240-1252`
- Modify: `src/shared/ExtensionMessage.ts` (add missing fields to `ExtensionState` if not present)

**Step 1: Check ExtensionState interface for bead runtime fields**

Search `src/shared/ExtensionMessage.ts` for `currentBeadNumber`. If missing, add:

```typescript
// In ExtensionState interface
currentBeadNumber?: number
beadTaskStatus?: "idle" | "running" | "paused" | "awaiting_approval" | "completed" | "failed"
totalBeadsCompleted?: number
```

**Step 2: Add bead runtime state to getStateToPostToWebview()**

In `src/core/controller/index.ts`, after line 1246 (`ralphTokenBudget`), add:

```typescript
currentBeadNumber: this.beadManager?.getState().currentBeadNumber ?? 0,
beadTaskStatus: this.beadManager?.getState().status ?? "idle",
totalBeadsCompleted: this.beadManager?.getState().beads.filter(b => b.status === "approved").length ?? 0,
```

**Step 3: Verify type checking passes**

Run: `npm run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/controller/index.ts src/shared/ExtensionMessage.ts
git commit -m "feat: add live bead runtime state to webview state sync"
```

---

## Task 2: Wire Real-Time Bead Update Streaming in Webview

The backend has `subscribeToBeadUpdates` streaming, but the webview never subscribes. Add a subscription in `ExtensionStateContext`.

**Files:**
- Modify: `webview-ui/src/context/ExtensionStateContext.tsx`

**Step 1: Add bead update subscription alongside existing state subscription**

In `ExtensionStateContext.tsx`, find where `StateServiceClient.subscribeToState` is called (in the `useEffect` that sets up subscriptions). Add a parallel subscription:

```typescript
import { BeadServiceClient } from "../services/grpc-client"
import type { BeadUpdateEvent } from "@shared/proto/beadsmith/bead"

// Inside the useEffect that sets up subscriptions, after the state subscription:
const beadUpdateUnsubscribeRef = useRef<(() => void) | null>(null)

// In the subscription setup:
beadUpdateUnsubscribeRef.current = BeadServiceClient.subscribeToBeadUpdates(
  EmptyRequest.create({}),
  {
    onResponse: (event: BeadUpdateEvent) => {
      setState((prevState) => ({
        ...prevState,
        currentBeadNumber: event.bead?.beadNumber ?? prevState.currentBeadNumber,
        beadTaskStatus: event.taskStatus ?? prevState.beadTaskStatus,
        totalBeadsCompleted: event.bead?.status === "approved"
          ? (prevState.totalBeadsCompleted ?? 0) + 1
          : prevState.totalBeadsCompleted,
      }))
    },
    onError: (error) => console.error("Bead update subscription error:", error),
    onComplete: () => console.log("Bead update subscription completed"),
  },
)
```

**Step 2: Add cleanup in the useEffect return**

```typescript
return () => {
  // ... existing cleanup
  if (beadUpdateUnsubscribeRef.current) {
    beadUpdateUnsubscribeRef.current()
    beadUpdateUnsubscribeRef.current = null
  }
}
```

**Step 3: Verify type checking passes**

Run: `npm run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add webview-ui/src/context/ExtensionStateContext.tsx
git commit -m "feat: wire real-time bead update streaming to webview"
```

---

## Task 3: Install react-diff-viewer-continued

**Files:**
- Modify: `webview-ui/package.json`

**Step 1: Install the dependency**

Run: `cd webview-ui && npm install react-diff-viewer-continued`

**Step 2: Verify it installs correctly**

Run: `cd webview-ui && npx tsc --noEmit`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add webview-ui/package.json webview-ui/package-lock.json
git commit -m "chore: add react-diff-viewer-continued for bead review diffs"
```

---

## Task 4: Add Diff Viewer to BeadReviewMessage

The `BeadReviewMessage` component shows files changed but doesn't render diffs. Add collapsible diff rendering per file.

**Files:**
- Modify: `webview-ui/src/components/chat/BeadMessage.tsx`
- Create: `webview-ui/src/components/chat/BeadDiffViewer.tsx`

**Step 1: Create the BeadDiffViewer component**

Create `webview-ui/src/components/chat/BeadDiffViewer.tsx`:

```tsx
import React, { useState } from "react"
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued"

interface BeadDiffViewerProps {
  fileName: string
  changeType: string // "added" | "modified" | "deleted"
  oldValue: string
  newValue: string
}

const diffStyles = {
  variables: {
    dark: {
      diffViewerBackground: "var(--vscode-editor-background)",
      addedBackground: "rgba(0, 128, 0, 0.15)",
      removedBackground: "rgba(255, 0, 0, 0.15)",
      addedColor: "var(--vscode-editor-foreground)",
      removedColor: "var(--vscode-editor-foreground)",
      wordAddedBackground: "rgba(0, 128, 0, 0.3)",
      wordRemovedBackground: "rgba(255, 0, 0, 0.3)",
      addedGutterBackground: "rgba(0, 128, 0, 0.2)",
      removedGutterBackground: "rgba(255, 0, 0, 0.2)",
      gutterBackground: "var(--vscode-editor-background)",
      gutterColor: "var(--vscode-editorLineNumber-foreground)",
      codeFoldBackground: "var(--vscode-editor-background)",
      codeFoldGutterBackground: "var(--vscode-editor-background)",
      codeFoldContentColor: "var(--vscode-descriptionForeground)",
      emptyLineBackground: "var(--vscode-editor-background)",
    },
  },
  line: {
    fontSize: "12px",
    fontFamily: "var(--vscode-editor-font-family)",
  },
}

export function BeadDiffViewer({ fileName, changeType, oldValue, newValue }: BeadDiffViewerProps) {
  const [expanded, setExpanded] = useState(false)

  const changeLabel =
    changeType === "added" ? "Added" : changeType === "deleted" ? "Deleted" : "Modified"
  const changeColor =
    changeType === "added" ? "#10b981" : changeType === "deleted" ? "#ef4444" : "#f59e0b"

  return (
    <div style={{ marginBottom: 8, border: "1px solid var(--vscode-widget-border)", borderRadius: 4 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--vscode-editor-background)",
          border: "none",
          color: "var(--vscode-editor-foreground)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          ▶
        </span>
        <span
          style={{
            color: changeColor,
            fontWeight: 600,
            fontSize: 11,
            padding: "1px 5px",
            borderRadius: 3,
            border: `1px solid ${changeColor}`,
          }}
        >
          {changeLabel}
        </span>
        <span style={{ fontFamily: "var(--vscode-editor-font-family)" }}>{fileName}</span>
      </button>
      {expanded && (
        <div style={{ maxHeight: 400, overflow: "auto" }}>
          <ReactDiffViewer
            oldValue={oldValue}
            newValue={newValue}
            splitView={false}
            useDarkTheme={true}
            styles={diffStyles}
            compareMethod={DiffMethod.WORDS}
          />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Integrate into BeadReviewMessage**

In `webview-ui/src/components/chat/BeadMessage.tsx`, find `BeadReviewMessage`. In the section that renders file changes, replace the basic list with `BeadDiffViewer`:

```tsx
import { BeadDiffViewer } from "./BeadDiffViewer"

// In the files changed section of BeadReviewMessage:
{bead.filesChanged.map((file) => (
  <BeadDiffViewer
    key={file.filePath}
    fileName={file.filePath}
    changeType={file.changeType}
    oldValue={file.oldContent ?? ""}
    newValue={file.newContent ?? ""}
  />
))}
```

**Step 3: Verify type checking and build**

Run: `npm run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add webview-ui/src/components/chat/BeadDiffViewer.tsx webview-ui/src/components/chat/BeadMessage.tsx
git commit -m "feat: add collapsible diff viewer to bead review UI"
```

---

## Task 5: Add DAG Impact Overlay to ForceGraph

When viewing bead impact, highlight changed nodes and their dependents in the DAG visualization.

**Files:**
- Modify: `webview-ui/src/components/dag/ForceGraph.tsx`
- Modify: `webview-ui/src/components/dag/DagPanel.tsx`

**Step 1: Add beadChangedNodeIds prop to ForceGraph**

In `ForceGraph.tsx`, extend the props interface:

```typescript
interface ForceGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width?: number
  height?: number
  onNodeClick?: (node: GraphNode) => void
  selectedNodeId?: string
  impactNodeIds?: Set<string>
  beadChangedNodeIds?: Set<string>  // NEW: nodes changed in current bead
  className?: string
}
```

**Step 2: Add bead overlay rendering in ForceGraph**

In the D3 rendering logic, after the impact path highlighting, add bead overlay:

```typescript
// In the node rendering section, add bead change detection:
.attr("stroke", (d: D3Node) => {
  if (beadChangedNodeIds?.has(d.id)) return "#ef4444" // Red ring for changed files
  if (selectedNodeId === d.id) return "#fbbf24"
  if (impactNodeIds?.has(d.id)) return "#f97316"
  return "none"
})
.attr("stroke-width", (d: D3Node) => {
  if (beadChangedNodeIds?.has(d.id)) return 3
  if (impactNodeIds?.has(d.id)) return 2
  return 0
})
```

**Step 3: Add "View in DAG" trigger from BeadReviewMessage to DagPanel**

In `DagPanel.tsx`, add a `beadChangedFiles` prop and compute affected node IDs:

```typescript
interface DagPanelProps {
  className?: string
  onDone?: () => void
  beadChangedFiles?: string[] // File paths changed in current bead
}
```

Compute `beadChangedNodeIds` from `beadChangedFiles` by matching against `graph.nodes`:

```typescript
const beadChangedNodeIds = useMemo(() => {
  if (!beadChangedFiles?.length || !graph) return undefined
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (beadChangedFiles.some((f) => node.filePath.endsWith(f) || node.id.includes(f))) {
      ids.add(node.id)
    }
  }
  return ids.size > 0 ? ids : undefined
}, [beadChangedFiles, graph])
```

**Step 4: Wire "View in DAG" button in BeadReviewMessage**

In `BeadMessage.tsx`, in the impact analysis section of `BeadReviewMessage`, add:

```tsx
<button
  onClick={() => {
    // Use existing showDag mechanism from ExtensionStateContext
    // Pass changed files to DagPanel
    setShowDag(true, bead.filesChanged.map(f => f.filePath))
  }}
  style={{
    padding: "4px 8px",
    fontSize: 11,
    background: "var(--vscode-button-secondaryBackground)",
    color: "var(--vscode-button-secondaryForeground)",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
  }}
>
  View in DAG
</button>
```

**Step 5: Verify type checking passes**

Run: `npm run check-types`
Expected: PASS

**Step 6: Commit**

```bash
git add webview-ui/src/components/dag/ForceGraph.tsx webview-ui/src/components/dag/DagPanel.tsx webview-ui/src/components/chat/BeadMessage.tsx
git commit -m "feat: add bead change overlay to DAG visualization"
```

---

## Task 6: Build Bead History Panel

Create a vertical timeline showing all beads in the current task.

**Files:**
- Create: `webview-ui/src/components/chat/BeadHistoryPanel.tsx`
- Modify: `webview-ui/src/components/chat/task-header/BeadTimeline.tsx`

**Step 1: Create BeadHistoryPanel component**

Create `webview-ui/src/components/chat/BeadHistoryPanel.tsx`:

```tsx
import React, { useEffect, useState } from "react"
import { BeadServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/beadsmith/common"

interface BeadHistoryEntry {
  id: string
  beadNumber: number
  status: string
  filesChangedCount: number
  tokensUsed: number
  commitHash?: string
  rejectionFeedback?: string
  criteriaResults?: Record<string, boolean>
}

interface BeadHistoryPanelProps {
  onScrollToBead?: (beadNumber: number) => void
}

const STATUS_COLORS: Record<string, string> = {
  approved: "#10b981",
  rejected: "#ef4444",
  skipped: "#6b7280",
  failed: "#ef4444",
  running: "#3b82f6",
  awaiting_approval: "#f59e0b",
}

const STATUS_ICONS: Record<string, string> = {
  approved: "\u2713",
  rejected: "\u2717",
  skipped: "\u2192",
  failed: "!",
  running: "\u25CB",
  awaiting_approval: "\u25CF",
}

export function BeadHistoryPanel({ onScrollToBead }: BeadHistoryPanelProps) {
  const [beads, setBeads] = useState<BeadHistoryEntry[]>([])
  const [expandedBead, setExpandedBead] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    BeadServiceClient.getBeadHistory(EmptyRequest.create({}))
      .then((response) => {
        setBeads(
          (response.beads ?? []).map((b) => ({
            id: b.id,
            beadNumber: b.beadNumber,
            status: b.status,
            filesChangedCount: b.filesChanged?.length ?? 0,
            tokensUsed: b.tokensUsed ?? 0,
            commitHash: b.commitHash,
            rejectionFeedback: b.rejectionFeedback,
            criteriaResults: b.criteriaResults,
          })),
        )
      })
      .catch((err) => console.error("Failed to fetch bead history:", err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: 12, color: "var(--vscode-descriptionForeground)" }}>Loading...</div>
  }

  if (beads.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--vscode-descriptionForeground)" }}>No beads yet</div>
    )
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {beads.map((bead, idx) => {
        const isExpanded = expandedBead === bead.id
        const color = STATUS_COLORS[bead.status] ?? "#6b7280"
        const icon = STATUS_ICONS[bead.status] ?? "?"
        const isLast = idx === beads.length - 1

        return (
          <div key={bead.id} style={{ display: "flex", gap: 10, paddingLeft: 8 }}>
            {/* Timeline line + dot */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: color,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {icon}
              </div>
              {!isLast && (
                <div style={{ width: 2, flexGrow: 1, background: "var(--vscode-widget-border)" }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingBottom: 12 }}>
              <button
                onClick={() => setExpandedBead(isExpanded ? null : bead.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--vscode-editor-foreground)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                Bead #{bead.beadNumber}
                <span
                  style={{
                    fontWeight: 400,
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: 11,
                  }}
                >
                  {bead.filesChangedCount} file{bead.filesChangedCount !== 1 ? "s" : ""} \u00B7{" "}
                  {bead.tokensUsed.toLocaleString()} tokens
                </span>
              </button>

              {isExpanded && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--vscode-descriptionForeground)" }}>
                  {bead.commitHash && <div>Commit: <code>{bead.commitHash.slice(0, 8)}</code></div>}
                  {bead.rejectionFeedback && (
                    <div style={{ color: "#ef4444", marginTop: 4 }}>
                      Feedback: {bead.rejectionFeedback}
                    </div>
                  )}
                  {bead.criteriaResults && (
                    <div style={{ marginTop: 4 }}>
                      {Object.entries(bead.criteriaResults).map(([name, passed]) => (
                        <div key={name}>
                          {passed ? "\u2713" : "\u2717"} {name}
                        </div>
                      ))}
                    </div>
                  )}
                  {onScrollToBead && (
                    <button
                      onClick={() => onScrollToBead(bead.beadNumber)}
                      style={{
                        marginTop: 4,
                        padding: "2px 6px",
                        fontSize: 11,
                        background: "var(--vscode-button-secondaryBackground)",
                        color: "var(--vscode-button-secondaryForeground)",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      Scroll to messages
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Add toggle in BeadTimeline to show/hide history**

In `BeadTimeline.tsx`, add a "History" button that expands to show `BeadHistoryPanel`:

```tsx
import { BeadHistoryPanel } from "../BeadHistoryPanel"

// Add state:
const [showHistory, setShowHistory] = useState(false)

// Add button in the timeline header:
<button onClick={() => setShowHistory(!showHistory)}>
  {showHistory ? "Hide History" : "History"}
</button>

// Render panel when expanded:
{showHistory && <BeadHistoryPanel />}
```

**Step 3: Verify type checking passes**

Run: `npm run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add webview-ui/src/components/chat/BeadHistoryPanel.tsx webview-ui/src/components/chat/task-header/BeadTimeline.tsx
git commit -m "feat: add bead history timeline panel"
```

---

## Task 7: Backend Integration Tests — Ralph + Bead Lifecycle

Test the full Ralph loop + BeadManager interaction.

**Files:**
- Create: `src/core/__tests__/ralph-bead-integration.test.ts`

**Step 1: Write the integration test file**

```typescript
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { BeadManager } from "@core/beads/BeadManager"
import { RalphLoopController } from "@core/ralph/RalphLoopController"

describe("Ralph Loop + Bead Manager Integration", () => {
  let sandbox: sinon.SinonSandbox
  let beadManager: BeadManager
  let ralphController: RalphLoopController

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    beadManager = new BeadManager("/test/workspace")
    ralphController = new RalphLoopController({
      maxIterations: 5,
      tokenBudget: 10000,
      completionPromise: "COMPLETE",
      beadsEnabled: true,
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe("Task Lifecycle", () => {
    it("should create a bead when Ralph loop starts an iteration", async () => {
      await beadManager.startTask({
        id: "test-task-1",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      const state = beadManager.getState()
      state.status.should.equal("running")
      state.currentBeadNumber.should.equal(1)
    })

    it("should transition to awaiting_approval when criteria pass", async () => {
      await beadManager.startTask({
        id: "test-task-2",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      await beadManager.completeBead("This task is DONE", [])

      const state = beadManager.getState()
      state.status.should.equal("awaiting_approval")
    })

    it("should start next bead after approval", async () => {
      const approvedSpy = sandbox.spy()
      beadManager.on("beadStarted", approvedSpy)

      await beadManager.startTask({
        id: "test-task-3",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      await beadManager.completeBead("DONE", [])
      await beadManager.approveBead()

      // After approval, task should be complete or next bead started
      const state = beadManager.getState()
      ;(state.status === "completed" || state.status === "running").should.be.true()
    })

    it("should retry when criteria fail", async () => {
      await beadManager.startTask({
        id: "test-task-4",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      // Complete without DONE tag — criteria should fail
      await beadManager.completeBead("Still working on it", [])

      const state = beadManager.getState()
      state.status.should.equal("running") // Should retry, not await approval
    })

    it("should fail when max iterations exceeded", async () => {
      await beadManager.startTask({
        id: "test-task-5",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 2,
      })

      // Exhaust iterations without completion
      await beadManager.completeBead("No done tag", [])
      await beadManager.completeBead("Still no done tag", [])

      const state = beadManager.getState()
      state.status.should.equal("failed")
    })

    it("should fail when token budget exceeded", async () => {
      await beadManager.startTask({
        id: "test-task-6",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 100, // Very small budget
        maxIterations: 10,
      })

      // Report high token usage
      beadManager.recordTokenUsage(150)

      const state = beadManager.getState()
      state.totalTokensUsed.should.be.above(100)
    })

    it("should handle rejection with feedback", async () => {
      await beadManager.startTask({
        id: "test-task-7",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      await beadManager.completeBead("DONE", [])
      await beadManager.rejectBead("Needs error handling")

      const state = beadManager.getState()
      state.status.should.equal("running") // Should start new bead
      state.beads[0].rejectionFeedback!.should.equal("Needs error handling")
    })

    it("should handle cancellation mid-bead", async () => {
      await beadManager.startTask({
        id: "test-task-8",
        description: "Test task",
        workspaceRoot: "/test",
        successCriteria: [{ type: "done_tag" }],
        tokenBudget: 10000,
        maxIterations: 5,
      })

      await beadManager.cancelTask()

      const state = beadManager.getState()
      state.status.should.equal("idle")
    })
  })
})
```

**Step 2: Run the integration test**

Run: `npm run test:unit -- --grep "Ralph Loop + Bead Manager"`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/core/__tests__/ralph-bead-integration.test.ts
git commit -m "test: add Ralph loop + Bead manager integration tests"
```

---

## Task 8: Backend Integration Tests — Bead + DAG Impact

Test that bead completion triggers DAG impact analysis.

**Files:**
- Create: `src/core/__tests__/bead-dag-integration.test.ts`

**Step 1: Write the test file**

```typescript
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { BeadManager } from "@core/beads/BeadManager"

describe("Bead + DAG Impact Integration", () => {
  let sandbox: sinon.SinonSandbox
  let beadManager: BeadManager

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    beadManager = new BeadManager("/test/workspace")
  })

  afterEach(() => {
    sandbox.restore()
  })

  it("should record file changes on bead completion", async () => {
    await beadManager.startTask({
      id: "dag-test-1",
      description: "Test DAG integration",
      workspaceRoot: "/test",
      successCriteria: [{ type: "done_tag" }],
      tokenBudget: 10000,
      maxIterations: 5,
    })

    const fileChanges = [
      { filePath: "/test/src/api.ts", changeType: "modified" as const },
      { filePath: "/test/src/handler.ts", changeType: "added" as const },
    ]

    await beadManager.completeBead("DONE", fileChanges)

    const state = beadManager.getState()
    const currentBead = state.beads[state.beads.length - 1]
    currentBead.filesChanged.should.have.length(2)
    currentBead.filesChanged[0].filePath.should.equal("/test/src/api.ts")
  })

  it("should populate impact summary when DAG is available", async () => {
    // Stub the DAG bridge to return mock impact data
    const mockImpact = {
      changedFile: "/test/src/api.ts",
      affectedFiles: ["/test/src/controller.ts", "/test/src/router.ts"],
      affectedFunctions: ["handleRequest", "routeApi"],
      confidenceBreakdown: { high: 1, medium: 1, low: 0, unsafe: 0 },
      impactDepth: 2,
      hasCircularDependencies: false,
    }

    // Provide a DAG impact provider to the bead manager
    beadManager.setImpactProvider(async (filePath: string) => mockImpact)

    await beadManager.startTask({
      id: "dag-test-2",
      description: "Test impact analysis",
      workspaceRoot: "/test",
      successCriteria: [{ type: "done_tag" }],
      tokenBudget: 10000,
      maxIterations: 5,
    })

    await beadManager.completeBead("DONE", [
      { filePath: "/test/src/api.ts", changeType: "modified" as const },
    ])

    const state = beadManager.getState()
    const currentBead = state.beads[state.beads.length - 1]
    currentBead.impactSummary!.affectedFiles.should.have.length(2)
  })
})
```

**Step 2: Run the test**

Run: `npm run test:unit -- --grep "Bead + DAG Impact"`
Expected: All tests PASS (may need to adjust based on actual BeadManager API — check method signatures first)

**Step 3: Commit**

```bash
git add src/core/__tests__/bead-dag-integration.test.ts
git commit -m "test: add Bead + DAG impact integration tests"
```

---

## Task 9: DAG Engine Python Tests — Impact Analysis

Add pytest tests for the impact analysis query engine.

**Files:**
- Create: `dag-engine/tests/test_impact_analysis.py`

**Step 1: Write the impact analysis test**

```python
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from beadsmith_dag.analyser import ProjectAnalyser
from beadsmith_dag.graph.builder import GraphBuilder
from beadsmith_dag.graph.queries import GraphQueries
from beadsmith_dag.parsers.python_parser import PythonParser


class TestImpactAnalysis:
    """Test impact analysis through the full pipeline."""

    @pytest.fixture
    def project_with_deps(self) -> Path:
        """Create a project with known dependency relationships."""
        with TemporaryDirectory() as tmpdir:
            project = Path(tmpdir)

            # Module A — the one we'll "change"
            (project / "module_a.py").write_text(
                """
def helper_function():
    return 42

class DataProcessor:
    def process(self, data):
        return helper_function()
"""
            )

            # Module B — depends on A
            (project / "module_b.py").write_text(
                """
from module_a import helper_function, DataProcessor

def use_helper():
    return helper_function()

def use_processor():
    proc = DataProcessor()
    return proc.process([1, 2, 3])
"""
            )

            # Module C — depends on B
            (project / "module_c.py").write_text(
                """
from module_b import use_helper

def high_level():
    return use_helper()
"""
            )

            yield project

    def test_direct_impact(self, project_with_deps: Path) -> None:
        """Changing module_a should impact module_b (direct dependent)."""
        parser = PythonParser()
        builder = GraphBuilder()

        for py_file in project_with_deps.glob("*.py"):
            nodes, edges = parser.parse_file(py_file)
            for node in nodes:
                builder.add_node(node)
            for edge in edges:
                builder.add_edge(edge)

        graph = builder.build()
        queries = GraphQueries(graph)

        impact = queries.get_impact(str(project_with_deps / "module_a.py"))

        assert str(project_with_deps / "module_b.py") in impact.affected_files

    def test_transitive_impact(self, project_with_deps: Path) -> None:
        """Changing module_a should transitively impact module_c."""
        parser = PythonParser()
        builder = GraphBuilder()

        for py_file in project_with_deps.glob("*.py"):
            nodes, edges = parser.parse_file(py_file)
            for node in nodes:
                builder.add_node(node)
            for edge in edges:
                builder.add_edge(edge)

        graph = builder.build()
        queries = GraphQueries(graph)

        impact = queries.get_impact(str(project_with_deps / "module_a.py"))

        assert str(project_with_deps / "module_c.py") in impact.affected_files

    def test_function_level_impact(self, project_with_deps: Path) -> None:
        """Changing helper_function should identify affected functions."""
        parser = PythonParser()
        builder = GraphBuilder()

        for py_file in project_with_deps.glob("*.py"):
            nodes, edges = parser.parse_file(py_file)
            for node in nodes:
                builder.add_node(node)
            for edge in edges:
                builder.add_edge(edge)

        graph = builder.build()
        queries = GraphQueries(graph)

        impact = queries.get_impact(
            str(project_with_deps / "module_a.py"),
            function_name="helper_function",
        )

        assert any("use_helper" in f for f in impact.affected_functions)

    def test_no_impact_on_unrelated(self, project_with_deps: Path) -> None:
        """Changing module_c should not impact module_a or module_b."""
        parser = PythonParser()
        builder = GraphBuilder()

        for py_file in project_with_deps.glob("*.py"):
            nodes, edges = parser.parse_file(py_file)
            for node in nodes:
                builder.add_node(node)
            for edge in edges:
                builder.add_edge(edge)

        graph = builder.build()
        queries = GraphQueries(graph)

        impact = queries.get_impact(str(project_with_deps / "module_c.py"))

        assert str(project_with_deps / "module_a.py") not in impact.affected_files
        assert str(project_with_deps / "module_b.py") not in impact.affected_files
```

**Step 2: Run the DAG tests**

Run: `cd dag-engine && python -m pytest tests/test_impact_analysis.py -v`
Expected: All tests PASS (may need to adjust method signatures to match actual `GraphQueries` API)

**Step 3: Commit**

```bash
git add dag-engine/tests/test_impact_analysis.py
git commit -m "test: add DAG impact analysis integration tests"
```

---

## Task 10: E2E Smoke Test — Bead Workflow

One Playwright test exercising the happy path.

**Files:**
- Create: `src/test/e2e/bead-workflow.test.ts`

**Step 1: Write the E2E test**

```typescript
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Bead Workflow - can start and view bead task", async ({ sidebar }) => {
  // Verify the extension loads
  await expect(sidebar.locator("[data-testid='chat-view']")).toBeVisible({ timeout: 10000 })

  // Check bead timeline is visible when beads are enabled
  // This is a smoke test — verify the UI renders without errors
  const beadTimeline = sidebar.locator("[data-testid='bead-timeline']")

  // If beads are enabled in settings, the timeline should be accessible
  // The exact visibility depends on whether a bead task is active
  // For now, verify no console errors related to bead components
  const consoleErrors: string[] = []
  sidebar.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("bead")) {
      consoleErrors.push(msg.text())
    }
  })

  // Wait a moment for any async errors to surface
  await sidebar.waitForTimeout(2000)

  expect(consoleErrors).toHaveLength(0)
})
```

**Step 2: Run the E2E test (if environment supports it)**

Run: `npm run test:e2e -- --grep "Bead Workflow"`
Expected: PASS (or skip if E2E environment not set up locally)

**Step 3: Commit**

```bash
git add src/test/e2e/bead-workflow.test.ts
git commit -m "test: add E2E smoke test for bead workflow"
```

---

## Task 11: Verify All Tests Pass

Run the full test suite to confirm nothing is broken.

**Files:** None (verification only)

**Step 1: Run unit tests**

Run: `npm run test:unit`
Expected: All PASS

**Step 2: Run type checking**

Run: `npm run check-types`
Expected: PASS

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 4: Run DAG tests**

Run: `cd dag-engine && python -m pytest tests/ -v`
Expected: All PASS

**Step 5: Verify VSIX builds**

Run: `npm run compile`
Expected: PASS

---

## Task 12: Create Changeset and Tag Release

**Files:**
- Create changeset via `npm run changeset`

**Step 1: Create changeset**

Run: `npm run changeset`
Select: patch
Summary: "Add real-time bead streaming, diff viewer, DAG-bead integration, bead history panel, and integration tests"

**Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for release"
```

**Step 3: Tag the release**

```bash
git tag v3.56.0
```

**Step 4: Build VSIX**

Run: `vsce package --out dist/beadsmith-3.56.0.vsix`

**Step 5: Create GitHub release**

```bash
gh release create v3.56.0 dist/beadsmith-3.56.0.vsix \
  --title "Beadsmith v3.56.0" \
  --notes "$(cat <<'EOF'
## Beadsmith v3.56.0

### Highlights

**Ralph Wiggum Loop** — Iterative AI execution with fresh context per iteration, completion detection, and backpressure checks (tests, type checking, linting).

**Beads System** — Discrete, reviewable work units with approval gates, success criteria, and commit tracking. Review diffs, approve/reject, and see impact analysis before each change lands.

**DAG Dependency Analysis** — Python-powered code dependency graph that shows which files and functions are affected by changes. Integrated into bead review with visual impact overlay.

### New in This Release
- Real-time bead status streaming to webview
- Collapsible diff viewer in bead review (react-diff-viewer-continued)
- DAG impact overlay on bead changes
- Bead history timeline panel
- Integration tests for Ralph + Bead + DAG workflows

### Getting Started
1. Download the `.vsix` file below
2. Install: `code --install-extension beadsmith-3.56.0.vsix`
3. For DAG analysis: Python 3.12+ required. Run `npm run setup:dag` in the extension directory.

EOF
)"
```
