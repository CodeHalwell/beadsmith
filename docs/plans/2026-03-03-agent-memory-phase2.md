# Agent Memory Phase 2: TypeScript Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the Phase 1 Python memory service into the VS Code extension so the agent can save/recall memories via tools, and memories are automatically retrieved into the system prompt at task start.

**Architecture:** Extend the existing DagBridge JSON-RPC pattern to add memory methods. Create `save_memory` and `recall_memory` tool definitions + handler. Add an `AGENT_MEMORY` system prompt component that injects relevant memories. Keep it simple — no auto-save hook yet (Phase 3), no webview UI (Phase 4).

**Tech Stack:** TypeScript, JSON-RPC over stdio (reusing DagBridge), BeadsmithToolSpec variant system, SystemPromptSection component system.

---

## Context

Phase 1 (completed) added these Python JSON-RPC methods to `dag-engine/beadsmith_dag/server.py`:
- `memory.save(content, type, keywords, source_task, source_file)` → `{id, type, content, ...}`
- `memory.recall(query, top_k, type)` → `{results: [{memory, score, source}], query, total_searched}`
- `memory.delete(id)` → `null`
- `memory.stats()` → `{total_count, hot_count, ..., has_embeddings}`
- `memory.file_memories(file)` → `[{id, content, ...}]`
- `memory.co_change(files)` → `null`
- `memory.co_changes(file)` → `[{file, weight}]`

The DagBridge at `src/services/dag/DagBridge.ts` already manages the Python subprocess and provides `call(method, params)` for JSON-RPC. We'll add memory methods directly to DagBridge rather than creating a separate bridge (same Python process).

Key existing patterns:
- **Tool enum**: `src/shared/tools.ts` → `BeadsmithDefaultTool`
- **Tool spec**: `src/core/prompts/system-prompt/tools/*.ts` → `BeadsmithToolSpec` with `ModelFamily.GENERIC` variant
- **Tool registration**: `src/core/prompts/system-prompt/tools/init.ts` → `registerBeadsmithToolSets()`
- **Tool handler**: `src/core/task/tools/handlers/*.ts` → implements `IToolHandler`
- **Handler registration**: `src/core/task/ToolExecutor.ts` → `registerToolHandlers()` → `this.coordinator.register()`
- **System prompt section**: `src/core/prompts/system-prompt/templates/placeholders.ts` → `SystemPromptSection`
- **Component function**: `src/core/prompts/system-prompt/components/*.ts` → async function returning string
- **Variant config**: `src/core/prompts/system-prompt/variants/*/config.ts` → `.components()` + `.tools()`
- **SystemPromptContext**: `src/core/prompts/system-prompt/types.ts` → readonly context passed to components

---

### Task 1: Shared Memory Types

**Files:**
- Create: `src/shared/memory-types.ts`
- Test: `src/shared/__tests__/memory-types.test.ts`

These types mirror the Python Pydantic models for TypeScript consumption. The DagBridge's `snakeToCamelKeys` auto-converts Python snake_case → camelCase.

**Step 1: Write the failing test**

Create `src/shared/__tests__/memory-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { isValidMemoryType, MemoryType } from "../memory-types"

describe("MemoryType", () => {
	it("defines all expected memory types", () => {
		expect(MemoryType.PATTERN).toBe("pattern")
		expect(MemoryType.ERROR_FIX).toBe("error_fix")
		expect(MemoryType.PREFERENCE).toBe("preference")
		expect(MemoryType.FILE_RELATIONSHIP).toBe("file_relationship")
		expect(MemoryType.STRATEGY).toBe("strategy")
		expect(MemoryType.FACT).toBe("fact")
	})

	it("validates known types", () => {
		expect(isValidMemoryType("pattern")).toBe(true)
		expect(isValidMemoryType("error_fix")).toBe(true)
		expect(isValidMemoryType("unknown")).toBe(false)
		expect(isValidMemoryType("")).toBe(false)
	})
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/__tests__/memory-types.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/shared/memory-types.ts`:

```typescript
/**
 * TypeScript types for the Agent Memory system.
 * These mirror the Python Pydantic models in dag-engine/beadsmith_dag/memory/models.py.
 * Property names are camelCase (DagBridge auto-converts from Python's snake_case).
 */

export const MemoryType = {
	PATTERN: "pattern",
	ERROR_FIX: "error_fix",
	PREFERENCE: "preference",
	FILE_RELATIONSHIP: "file_relationship",
	STRATEGY: "strategy",
	FACT: "fact",
} as const

export type MemoryType = (typeof MemoryType)[keyof typeof MemoryType]

const VALID_MEMORY_TYPES = new Set<string>(Object.values(MemoryType))

export function isValidMemoryType(value: string): value is MemoryType {
	return VALID_MEMORY_TYPES.has(value)
}

export interface MemoryRecord {
	readonly id: string
	readonly type: MemoryType
	readonly content: string
	readonly keywords: readonly string[]
	readonly sourceTask: string | null
	readonly sourceFile: string | null
	readonly generation: number
	readonly tier: string
	readonly confidence: number
	readonly accessCount: number
	readonly lastAccessedAt: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly evolvedFrom: readonly string[]
}

export interface RecallResult {
	readonly memory: MemoryRecord
	readonly score: number
	readonly source: string
}

export interface RecallResponse {
	readonly results: readonly RecallResult[]
	readonly query: string
	readonly totalSearched: number
}

export interface MemoryStats {
	readonly totalCount: number
	readonly hotCount: number
	readonly warmCount: number
	readonly coldCount: number
	readonly archivedCount: number
	readonly totalEdges: number
	readonly hasEmbeddings: boolean
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/__tests__/memory-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/memory-types.ts src/shared/__tests__/memory-types.test.ts
git commit -m "feat(memory): add shared TypeScript memory types"
```

---

### Task 2: DagBridge Memory Methods

**Files:**
- Modify: `src/services/dag/DagBridge.ts` (add memory methods)
- Modify: `src/services/dag/types.ts` (re-export memory types for DAG layer)
- Test: `src/services/dag/__tests__/DagBridge.memory.test.ts`

Add convenience methods to DagBridge for calling the `memory.*` JSON-RPC methods. These are thin wrappers around the existing `call()` method, following the same pattern as `getStatus()`, `analyseProject()`, etc.

**Step 1: Write the failing test**

Create `src/services/dag/__tests__/DagBridge.memory.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { DagBridge } from "../DagBridge"

// We test via the public API, mocking the private `call` method
describe("DagBridge memory methods", () => {
	let bridge: DagBridge

	beforeEach(() => {
		bridge = new DagBridge("python3", "/fake/path", {
			autoRestart: false,
			enableHealthChecks: false,
		})
		// Mock the private call method
		vi.spyOn(bridge as any, "call").mockResolvedValue({})
	})

	it("saveMemory calls memory.save with correct params", async () => {
		const mockResult = { id: "test-id", type: "pattern", content: "test" }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)

		const result = await bridge.saveMemory({
			content: "Use biome for linting",
			type: "pattern",
			keywords: ["biome", "linting"],
		})

		expect((bridge as any).call).toHaveBeenCalledWith("memory.save", {
			content: "Use biome for linting",
			type: "pattern",
			keywords: ["biome", "linting"],
			source_task: undefined,
			source_file: undefined,
		})
		expect(result).toEqual(mockResult)
	})

	it("recallMemory calls memory.recall with correct params", async () => {
		const mockResult = { results: [], query: "linting", totalSearched: 0 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)

		const result = await bridge.recallMemory({ query: "linting tools", topK: 3 })

		expect((bridge as any).call).toHaveBeenCalledWith("memory.recall", {
			query: "linting tools",
			top_k: 3,
			type: undefined,
		})
		expect(result).toEqual(mockResult)
	})

	it("deleteMemory calls memory.delete", async () => {
		vi.spyOn(bridge as any, "call").mockResolvedValue(null)
		await bridge.deleteMemory("mem-123")
		expect((bridge as any).call).toHaveBeenCalledWith("memory.delete", { id: "mem-123" })
	})

	it("getMemoryStats calls memory.stats", async () => {
		const mockStats = { totalCount: 5, hotCount: 3, warmCount: 1, coldCount: 1, archivedCount: 0, totalEdges: 2, hasEmbeddings: false }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockStats)

		const result = await bridge.getMemoryStats()
		expect((bridge as any).call).toHaveBeenCalledWith("memory.stats", {})
		expect(result).toEqual(mockStats)
	})
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/dag/__tests__/DagBridge.memory.test.ts`
Expected: FAIL — `bridge.saveMemory is not a function`

**Step 3: Add memory methods to DagBridge**

Modify `src/services/dag/DagBridge.ts`. Add the following methods after the existing `getEdgesForNode` method (around line 593), before the `private async call` method:

```typescript
	// -- Memory methods -------------------------------------------------------

	/**
	 * Save a memory to the persistent memory store.
	 */
	async saveMemory(params: {
		content: string
		type: string
		keywords?: string[]
		sourceTask?: string
		sourceFile?: string
	}): Promise<MemoryRecord> {
		const result = await this.call("memory.save", {
			content: params.content,
			type: params.type,
			keywords: params.keywords ?? [],
			source_task: params.sourceTask,
			source_file: params.sourceFile,
		})
		return result as MemoryRecord
	}

	/**
	 * Recall memories matching a query.
	 */
	async recallMemory(params: {
		query: string
		topK?: number
		type?: string
	}): Promise<RecallResponse> {
		const result = await this.call("memory.recall", {
			query: params.query,
			top_k: params.topK,
			type: params.type,
		})
		return result as RecallResponse
	}

	/**
	 * Delete a memory by ID.
	 */
	async deleteMemory(memoryId: string): Promise<void> {
		await this.call("memory.delete", { id: memoryId })
	}

	/**
	 * Get memory store statistics.
	 */
	async getMemoryStats(): Promise<MemoryStats> {
		const result = await this.call("memory.stats", {})
		return result as MemoryStats
	}

	/**
	 * Get memories associated with a specific file.
	 */
	async getFileMemories(filePath: string): Promise<MemoryRecord[]> {
		const result = await this.call("memory.file_memories", { file: filePath })
		return result as MemoryRecord[]
	}

	/**
	 * Record co-change relationship between files.
	 */
	async recordCoChange(filePaths: string[]): Promise<void> {
		await this.call("memory.co_change", { files: filePaths })
	}

	/**
	 * Get files frequently changed with the given file.
	 */
	async getCoChanges(filePath: string): Promise<Array<{ file: string; weight: number }>> {
		const result = await this.call("memory.co_changes", { file: filePath })
		return result as Array<{ file: string; weight: number }>
	}
```

Also add the import at the top of `DagBridge.ts`:

```typescript
import type { MemoryRecord, MemoryStats, RecallResponse } from "@shared/memory-types"
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/dag/__tests__/DagBridge.memory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/dag/DagBridge.ts src/services/dag/__tests__/DagBridge.memory.test.ts
git commit -m "feat(memory): add memory methods to DagBridge"
```

---

### Task 3: Tool Enum + Tool Spec Definitions

**Files:**
- Modify: `src/shared/tools.ts` — Add `SAVE_MEMORY` and `RECALL_MEMORY` to `BeadsmithDefaultTool` enum; add both to `READ_ONLY_TOOLS`
- Create: `src/core/prompts/system-prompt/tools/agent_memory.ts` — Tool specs
- Modify: `src/core/prompts/system-prompt/tools/init.ts` — Register new variants

No separate test file needed — snapshot tests validate tool specs are wired correctly. We'll update snapshots at the end.

**Step 1: Add enum values to `src/shared/tools.ts`**

Add after `USE_SKILL = "use_skill"` (line 34):

```typescript
	SAVE_MEMORY = "save_memory",
	RECALL_MEMORY = "recall_memory",
```

Add both to `READ_ONLY_TOOLS` array (they don't modify the workspace):

```typescript
	BeadsmithDefaultTool.SAVE_MEMORY,
	BeadsmithDefaultTool.RECALL_MEMORY,
```

**Step 2: Create tool spec file**

Create `src/core/prompts/system-prompt/tools/agent_memory.ts`:

```typescript
import { ModelFamily } from "@/shared/prompts"
import { BeadsmithDefaultTool } from "@/shared/tools"
import type { BeadsmithToolSpec } from "../spec"

// -- save_memory --------------------------------------------------------------

const SAVE_MEMORY_GENERIC: BeadsmithToolSpec = {
	variant: ModelFamily.GENERIC,
	id: BeadsmithDefaultTool.SAVE_MEMORY,
	name: "save_memory",
	description:
		"Save a learning, pattern, or useful fact to persistent memory for future tasks. Use this when you discover something reusable: project conventions, error fixes, user preferences, file relationships, or effective strategies. Memories persist across sessions.",
	parameters: [
		{
			name: "content",
			required: true,
			instruction:
				"The memory to save. Be specific and actionable — include the what, why, and context. Example: 'This project uses biome for linting, not eslint. The config is in biome.json.'",
			usage: "This project uses biome for linting (biome.json), not eslint.",
		},
		{
			name: "type",
			required: true,
			instruction:
				"The type of memory. One of: pattern (coding conventions, project patterns), error_fix (solutions to errors), preference (user preferences), file_relationship (how files relate), strategy (effective approaches), fact (project facts).",
			usage: "pattern",
		},
		{
			name: "keywords",
			required: false,
			instruction: "Comma-separated keywords for better search retrieval. Example: 'biome, linting, eslint'",
			usage: "biome, linting, config",
		},
	],
}

// -- recall_memory ------------------------------------------------------------

const RECALL_MEMORY_GENERIC: BeadsmithToolSpec = {
	variant: ModelFamily.GENERIC,
	id: BeadsmithDefaultTool.RECALL_MEMORY,
	name: "recall_memory",
	description:
		"Search persistent memory for relevant past learnings, patterns, error fixes, or facts. Use this when starting a task to check for relevant context, or when you need to remember how something was done before.",
	parameters: [
		{
			name: "query",
			required: true,
			instruction:
				"What to search for. Use natural language describing what you need to know. Example: 'How does authentication work in this project?'",
			usage: "linting configuration",
		},
		{
			name: "type",
			required: false,
			instruction:
				"Filter by memory type: pattern, error_fix, preference, file_relationship, strategy, fact. Omit to search all types.",
			usage: "pattern",
		},
		{
			name: "top_k",
			required: false,
			instruction: "Maximum number of results to return (default: 5, max: 20).",
			usage: "5",
		},
	],
}

export const save_memory_variants = [SAVE_MEMORY_GENERIC]
export const recall_memory_variants = [RECALL_MEMORY_GENERIC]
```

**Step 3: Register in init.ts**

Modify `src/core/prompts/system-prompt/tools/init.ts`:

Add import:
```typescript
import { recall_memory_variants, save_memory_variants } from "./agent_memory"
```

Add to `allToolVariants` array:
```typescript
		...save_memory_variants,
		...recall_memory_variants,
```

**Step 4: Add tools to variant configs**

Add `BeadsmithDefaultTool.SAVE_MEMORY` and `BeadsmithDefaultTool.RECALL_MEMORY` to the `.tools()` list in these variant configs:

- `src/core/prompts/system-prompt/variants/generic/config.ts`
- `src/core/prompts/system-prompt/variants/next-gen/config.ts`
- `src/core/prompts/system-prompt/variants/native-next-gen/config.ts`
- `src/core/prompts/system-prompt/variants/gpt-5/config.ts`
- `src/core/prompts/system-prompt/variants/native-gpt-5/config.ts`
- `src/core/prompts/system-prompt/variants/native-gpt-5-1/config.ts`
- `src/core/prompts/system-prompt/variants/gemini-3/config.ts`

Do NOT add to `xs/`, `hermes/`, or `glm/` — small/local models don't benefit from memory tools.

**Step 5: Verify compilation**

Run: `npm run compile`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/shared/tools.ts \
  src/core/prompts/system-prompt/tools/agent_memory.ts \
  src/core/prompts/system-prompt/tools/init.ts \
  src/core/prompts/system-prompt/variants/*/config.ts
git commit -m "feat(memory): add save_memory and recall_memory tool definitions"
```

---

### Task 4: Tool Handler

**Files:**
- Create: `src/core/task/tools/handlers/AgentMemoryToolHandler.ts`
- Modify: `src/core/task/ToolExecutor.ts` — Register handler
- Test: `src/core/task/tools/handlers/__tests__/AgentMemoryToolHandler.test.ts`

The handler processes both `save_memory` and `recall_memory` tool calls. It gets the DagBridge from the controller (via `config.context` → extension context → controller), calls the appropriate bridge method, and formats the response.

**Step 1: Write the failing test**

Create `src/core/task/tools/handlers/__tests__/AgentMemoryToolHandler.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { AgentMemoryToolHandler } from "../AgentMemoryToolHandler"
import { BeadsmithDefaultTool } from "@shared/tools"

// Minimal mock for ToolUse
function createToolUse(name: string, params: Record<string, string>): any {
	return { name, params, id: "test-id", type: "tool_use" }
}

// Minimal mock for TaskConfig
function createMockConfig(bridgeMethods: Record<string, any> = {}) {
	const dagBridge = {
		isRunning: vi.fn().mockReturnValue(true),
		saveMemory: vi.fn().mockResolvedValue({ id: "mem-1", type: "pattern", content: "test" }),
		recallMemory: vi.fn().mockResolvedValue({
			results: [{ memory: { id: "mem-1", content: "Use biome", type: "pattern", confidence: 0.95, accessCount: 3 }, score: 0.85, source: "keyword" }],
			query: "linting",
			totalSearched: 10,
		}),
		...bridgeMethods,
	}

	return {
		taskState: { consecutiveMistakeCount: 0 },
		services: {
			stateManager: {
				getGlobalSettingsKey: vi.fn((key: string) => {
					if (key === "dagEnabled") return true
					return undefined
				}),
			},
		},
		callbacks: {
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("[ERROR]"),
		},
		// Expose the mock bridge for assertions
		_dagBridge: dagBridge,
	} as any
}

describe("AgentMemoryToolHandler", () => {
	let handler: AgentMemoryToolHandler

	beforeEach(() => {
		handler = new AgentMemoryToolHandler()
	})

	it("has the correct tool name", () => {
		expect(handler.name).toBe(BeadsmithDefaultTool.SAVE_MEMORY)
	})

	it("returns error when content param is missing for save_memory", async () => {
		const config = createMockConfig()
		const block = createToolUse("save_memory", { type: "pattern" })

		const result = await handler.execute(config, block)
		expect(config.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith(
			BeadsmithDefaultTool.SAVE_MEMORY,
			"content",
		)
	})

	it("returns error when type param is missing for save_memory", async () => {
		const config = createMockConfig()
		const block = createToolUse("save_memory", { content: "test memory" })

		const result = await handler.execute(config, block)
		expect(config.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith(
			BeadsmithDefaultTool.SAVE_MEMORY,
			"type",
		)
	})
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/task/tools/handlers/__tests__/AgentMemoryToolHandler.test.ts`
Expected: FAIL — module not found

**Step 3: Write the handler**

Create `src/core/task/tools/handlers/AgentMemoryToolHandler.ts`:

```typescript
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { BeadsmithDefaultTool } from "@shared/tools"
import { Logger } from "@/shared/services/Logger"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Handles save_memory and recall_memory tool calls.
 *
 * Uses the DagBridge's memory methods to persist/retrieve memories
 * from the Python memory service.
 */
export class AgentMemoryToolHandler implements IToolHandler {
	readonly name = BeadsmithDefaultTool.SAVE_MEMORY

	getDescription(block: ToolUse): string {
		if (block.name === "recall_memory") {
			const query = block.params.query || "memories"
			return `[recall_memory for '${query}']`
		}
		const type = block.params.type || "memory"
		return `[save_memory: ${type}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		if (block.name === "recall_memory") {
			return this.handleRecall(config, block)
		}
		return this.handleSave(config, block)
	}

	private async handleSave(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const content: string | undefined = block.params.content
		const type: string | undefined = block.params.type
		const keywordsRaw: string | undefined = block.params.keywords

		if (!content) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(BeadsmithDefaultTool.SAVE_MEMORY, "content")
		}

		if (!type) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(BeadsmithDefaultTool.SAVE_MEMORY, "type")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse comma-separated keywords
		const keywords = keywordsRaw
			? keywordsRaw.split(",").map((k) => k.trim()).filter(Boolean)
			: []

		try {
			const dagBridge = config.services.dagBridge
			if (!dagBridge?.isRunning()) {
				return formatResponse.toolError(
					"Memory service is not available. The DAG engine must be running for memory operations.",
				)
			}

			const saved = await dagBridge.saveMemory({
				content,
				type,
				keywords,
				sourceTask: config.taskId,
			})

			return formatResponse.toolResult(
				`Memory saved successfully.\nID: ${saved.id}\nType: ${saved.type}\nKeywords: ${keywords.length > 0 ? keywords.join(", ") : "(none)"}`,
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			Logger.error("[AgentMemory] Failed to save memory:", message)
			return formatResponse.toolError(`Failed to save memory: ${message}`)
		}
	}

	private async handleRecall(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const query: string | undefined = block.params.query
		const type: string | undefined = block.params.type
		const topKRaw: string | undefined = block.params.top_k

		if (!query) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(BeadsmithDefaultTool.RECALL_MEMORY, "query")
		}

		config.taskState.consecutiveMistakeCount = 0

		const topK = topKRaw ? Math.min(parseInt(topKRaw, 10) || 5, 20) : 5

		try {
			const dagBridge = config.services.dagBridge
			if (!dagBridge?.isRunning()) {
				return formatResponse.toolError(
					"Memory service is not available. The DAG engine must be running for memory operations.",
				)
			}

			const response = await dagBridge.recallMemory({
				query,
				topK,
				type,
			})

			if (response.results.length === 0) {
				return formatResponse.toolResult(
					`No memories found matching "${query}". Searched ${response.totalSearched} memories.`,
				)
			}

			const lines = response.results.map((r, i) => {
				const m = r.memory
				const keywords = m.keywords.length > 0 ? ` [${m.keywords.join(", ")}]` : ""
				return `${i + 1}. [${m.type}] ${m.content}\n   (confidence: ${m.confidence}, used ${m.accessCount} times, score: ${r.score.toFixed(2)})${keywords}`
			})

			return formatResponse.toolResult(
				`Found ${response.results.length} relevant memories (searched ${response.totalSearched}):\n\n${lines.join("\n\n")}`,
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			Logger.error("[AgentMemory] Failed to recall memories:", message)
			return formatResponse.toolError(`Failed to recall memories: ${message}`)
		}
	}
}
```

**Step 4: Register handler in ToolExecutor.ts**

Modify `src/core/task/ToolExecutor.ts`:

Add import:
```typescript
import { AgentMemoryToolHandler } from "./tools/handlers/AgentMemoryToolHandler"
```

In `registerToolHandlers()`, add after the `GenerateExplanationToolHandler` line:

```typescript
		// Memory tools — shared handler for save_memory + recall_memory
		const memoryHandler = new AgentMemoryToolHandler()
		this.coordinator.register(memoryHandler) // registers as save_memory (primary name)
		this.coordinator.register(new SharedToolHandler(BeadsmithDefaultTool.RECALL_MEMORY, memoryHandler))
```

**Step 5: Wire DagBridge into TaskConfig**

The handler needs `config.services.dagBridge`. Check if `TaskConfig` already exposes the bridge via `services`. If not, add it.

Modify `src/core/task/tools/types/TaskConfig.ts` — add to `TaskServices` interface:

```typescript
	dagBridge?: DagBridge
```

Add the import:
```typescript
import type { DagBridge } from "@services/dag/DagBridge"
```

In `ToolExecutor.ts`, in the `asToolConfig()` method's `services` block, add:

```typescript
				dagBridge: this.controller?.getDagBridge(),
```

**Note**: The `controller` reference — check how `ToolExecutor` accesses the controller. It may need to be passed via the constructor or accessed through the context. Look at how `this.stateManager` is accessed in `asToolConfig()` — follow the same pattern. If the controller is not directly available, get the bridge via `this.context.subscriptions` or a similar VS Code extension pattern. The implementer should examine the actual codebase to determine the right wiring.

**Alternative approach if controller isn't accessible**: The DagBridge can be passed as a constructor parameter to ToolExecutor, similar to how `mcpHub`, `browserSession`, etc. are passed. This is cleaner and follows existing patterns.

**Step 6: Run tests**

Run: `npx vitest run src/core/task/tools/handlers/__tests__/AgentMemoryToolHandler.test.ts`
Expected: PASS

Run: `npm run compile`
Expected: No errors

**Step 7: Commit**

```bash
git add src/core/task/tools/handlers/AgentMemoryToolHandler.ts \
  src/core/task/tools/handlers/__tests__/AgentMemoryToolHandler.test.ts \
  src/core/task/ToolExecutor.ts \
  src/core/task/tools/types/TaskConfig.ts
git commit -m "feat(memory): add save_memory/recall_memory tool handler"
```

---

### Task 5: System Prompt AGENT_MEMORY Component

**Files:**
- Modify: `src/core/prompts/system-prompt/templates/placeholders.ts` — Add `AGENT_MEMORY` section
- Create: `src/core/prompts/system-prompt/components/agent_memory.ts` — Component function
- Modify: `src/core/prompts/system-prompt/types.ts` — Add memory context to `SystemPromptContext`
- Modify variant configs — Add `AGENT_MEMORY` component to `generic`, `next-gen`, `native-next-gen`, `gpt-5`, `native-gpt-5`, `native-gpt-5-1`, `gemini-3`

This component injects relevant memories into the system prompt at the start of each task, giving the agent context from previous sessions.

**Step 1: Add SystemPromptSection enum value**

Modify `src/core/prompts/system-prompt/templates/placeholders.ts`:

Add to `SystemPromptSection` enum after `BEAD_MODE`:

```typescript
	AGENT_MEMORY = "AGENT_MEMORY_SECTION",
```

**Step 2: Add memory context to SystemPromptContext**

Modify `src/core/prompts/system-prompt/types.ts`:

Add after the `dagImpact` block (around line 146):

```typescript
	// Agent memory context
	readonly memoryEnabled?: boolean
	readonly relevantMemories?: readonly {
		readonly type: string
		readonly content: string
		readonly confidence: number
		readonly accessCount: number
		readonly keywords: readonly string[]
	}[]
```

**Step 3: Create the component**

Create `src/core/prompts/system-prompt/components/agent_memory.ts`:

```typescript
/**
 * Agent Memory Component
 *
 * Injects relevant memories from previous tasks into the system prompt.
 * Memories are retrieved at task start based on the task prompt.
 */

import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const AGENT_MEMORY_TEMPLATE = `RELEVANT MEMORIES

The following are learnings from previous tasks that may be relevant to this task:

{{MEMORY_LIST}}

You have access to save_memory and recall_memory tools:
- Use save_memory when you discover reusable patterns, fixes, preferences, or facts about this project.
- Use recall_memory to search for past learnings when you need context.`

const NO_MEMORIES_TEMPLATE = `AGENT MEMORY

You have access to save_memory and recall_memory tools:
- Use save_memory when you discover reusable patterns, fixes, preferences, or facts about this project.
- Use recall_memory to search for past learnings when you need context.

No memories from previous tasks were found for this task. As you work, save useful learnings for future reference.`

export async function getAgentMemorySection(
	variant: PromptVariant,
	context: SystemPromptContext,
): Promise<string> {
	if (!context.memoryEnabled) {
		return ""
	}

	const template =
		variant.componentOverrides?.[SystemPromptSection.AGENT_MEMORY]?.template || AGENT_MEMORY_TEMPLATE

	const memories = context.relevantMemories
	if (!memories || memories.length === 0) {
		return NO_MEMORIES_TEMPLATE
	}

	const memoryLines = memories.map((m, i) => {
		const keywords = m.keywords.length > 0 ? ` [${m.keywords.join(", ")}]` : ""
		return `${i + 1}. [${m.type}] ${m.content}\n   (confidence: ${m.confidence}, used ${m.accessCount} times)${keywords}`
	})

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template as string, context, {
		MEMORY_LIST: memoryLines.join("\n\n"),
	})
}
```

**Step 4: Register component in the component registry**

Find where components like `getDagContextSection` are registered and add `getAgentMemorySection` following the same pattern. Check `src/core/prompts/system-prompt/components/index.ts` or the registry initialization.

**Step 5: Add to variant configs**

Add `SystemPromptSection.AGENT_MEMORY` to `.components()` in the same variant configs listed in Task 3 (generic, next-gen, native-next-gen, gpt-5, native-gpt-5, native-gpt-5-1, gemini-3). Place it after `USER_INSTRUCTIONS` and before `RULES` (or after `DAG_CONTEXT`).

**Step 6: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 7: Commit**

```bash
git add src/core/prompts/system-prompt/templates/placeholders.ts \
  src/core/prompts/system-prompt/types.ts \
  src/core/prompts/system-prompt/components/agent_memory.ts \
  src/core/prompts/system-prompt/variants/*/config.ts
git commit -m "feat(memory): add AGENT_MEMORY system prompt component"
```

---

### Task 6: Memory Retrieval at Task Start

**Files:**
- Modify: `src/core/task/index.ts` — Add memory retrieval in `buildSystemPromptContext()`

This is the simplest integration: when building the system prompt context, if the DAG bridge is running and has memory methods, recall relevant memories based on the current file context and inject them into `SystemPromptContext.relevantMemories`.

**Step 1: Locate the system prompt context building**

In `src/core/task/index.ts`, find the section that builds `SystemPromptContext` (around the `dagEnabled` / `dagImpact` section near line 1949). This is where we add memory retrieval.

**Step 2: Add memory retrieval after DAG impact**

After the DAG impact block, add:

```typescript
		// Retrieve relevant memories if DAG bridge is running
		let relevantMemories: SystemPromptContext["relevantMemories"]
		const memoryEnabled = dagEnabled // Memory requires DAG engine (same Python process)

		if (memoryEnabled) {
			const dagBridge = this.controller.getDagBridge()
			if (dagBridge?.isRunning()) {
				try {
					// Build a query from the task prompt and visible files
					const queryParts: string[] = []
					if (visibleTabPaths.length > 0) {
						queryParts.push(...visibleTabPaths.slice(0, 3).map((p) => path.basename(p)))
					}
					// Use the first user message as context if available
					const firstUserMessage = this.messageStateHandler
						.getApiConversationHistory()
						.find((m) => m.role === "user")
					if (firstUserMessage && typeof firstUserMessage.content === "string") {
						queryParts.push(firstUserMessage.content.substring(0, 200))
					}

					if (queryParts.length > 0) {
						const recallResponse = await dagBridge.recallMemory({
							query: queryParts.join(" "),
							topK: 5,
						})

						if (recallResponse.results.length > 0) {
							relevantMemories = recallResponse.results.map((r) => ({
								type: r.memory.type,
								content: r.memory.content,
								confidence: r.memory.confidence,
								accessCount: r.memory.accessCount,
								keywords: r.memory.keywords as string[],
							}))
						}
					}
				} catch (error) {
					Logger.debug("[Task] Failed to retrieve memories:", error)
					// Non-fatal — continue without memories
				}
			}
		}
```

Then add to the `SystemPromptContext` object being constructed:

```typescript
		memoryEnabled,
		relevantMemories,
```

**Step 3: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/core/task/index.ts
git commit -m "feat(memory): retrieve relevant memories at task start"
```

---

### Task 7: Update Snapshots and Final Verification

**Files:**
- Modify: Various snapshot files (auto-generated)

**Step 1: Run all unit tests to see what fails**

Run: `npm run test:unit`
Expected: Snapshot tests fail (new tools + component in prompts)

**Step 2: Regenerate snapshots**

Run: `UPDATE_SNAPSHOTS=true npm run test:unit`
Expected: Snapshots updated, all tests pass

**Step 3: Run type checking**

Run: `npm run check-types`
Expected: No type errors

**Step 4: Run lint**

Run: `npm run lint`
Expected: No lint errors (fix any that appear)

**Step 5: Commit**

```bash
git add -A
git commit -m "test(memory): update prompt snapshots for memory tools and component"
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Shared TS types | `src/shared/memory-types.ts` |
| 2 | DagBridge memory methods | `src/services/dag/DagBridge.ts` |
| 3 | Tool enum + specs | `src/shared/tools.ts`, `tools/agent_memory.ts`, `tools/init.ts`, variant configs |
| 4 | Tool handler | `handlers/AgentMemoryToolHandler.ts`, `ToolExecutor.ts`, `TaskConfig.ts` |
| 5 | System prompt component | `components/agent_memory.ts`, `placeholders.ts`, `types.ts`, variant configs |
| 6 | Memory retrieval at task start | `src/core/task/index.ts` |
| 7 | Snapshot updates | Auto-generated snapshots |

**Dependencies:**
- Task 1 → independent (no deps)
- Task 2 → depends on Task 1 (imports types)
- Task 3 → independent (no deps)
- Task 4 → depends on Tasks 2 + 3 (uses bridge methods + tool enum)
- Task 5 → depends on Task 3 (uses enum values in configs)
- Task 6 → depends on Tasks 2 + 5 (calls bridge, provides context to component)
- Task 7 → depends on all above

Tasks 1 & 3 can run in parallel. Tasks 2 & 5 can run in parallel (after their deps).
