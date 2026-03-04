import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@core/assistant-message", () => ({}))

vi.mock("@shared/memory-types", () => {
	const MemoryType = {
		PATTERN: "pattern",
		ERROR_FIX: "error_fix",
		PREFERENCE: "preference",
		FILE_RELATIONSHIP: "file_relationship",
		STRATEGY: "strategy",
		FACT: "fact",
	}
	const VALID = new Set(Object.values(MemoryType))
	return {
		MemoryType,
		isValidMemoryType: (v: string) => VALID.has(v),
	}
})

vi.mock("@core/prompts/responses", () => ({
	formatResponse: {
		toolResult: (text: string) => text,
		toolError: (error: string) => `[ERROR] ${error}`,
	},
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock("@shared/tools", () => ({
	BeadsmithDefaultTool: {
		SAVE_MEMORY: "save_memory",
		RECALL_MEMORY: "recall_memory",
	},
}))

import { AgentMemoryToolHandler, RecallMemoryAliasHandler } from "../AgentMemoryToolHandler"

function createToolUse(name: string, params: Record<string, string>): any {
	return { name, params, id: "test-id", type: "tool_use" }
}

function createMockConfig(overrides: Record<string, any> = {}) {
	const dagBridge = {
		isRunning: vi.fn().mockReturnValue(true),
		saveMemory: vi.fn().mockResolvedValue({
			id: "mem-1",
			type: "pattern",
			content: "test content",
			keywords: ["test"],
		}),
		recallMemory: vi.fn().mockResolvedValue({
			results: [
				{
					memory: {
						id: "mem-1",
						content: "Use biome for linting",
						type: "pattern",
						confidence: 0.95,
						accessCount: 3,
						keywords: ["biome", "linting"],
					},
					score: 0.85,
					source: "keyword",
				},
			],
			query: "linting",
			totalSearched: 10,
		}),
		...overrides,
	}

	return {
		taskId: "task-123",
		taskState: { consecutiveMistakeCount: 0 },
		services: {
			dagBridge,
			stateManager: {
				getGlobalSettingsKey: vi.fn(),
			},
		},
		callbacks: {
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("[ERROR]"),
		},
	} as any
}

describe("AgentMemoryToolHandler", () => {
	let handler: AgentMemoryToolHandler

	beforeEach(() => {
		handler = new AgentMemoryToolHandler()
	})

	it("has the correct tool name", () => {
		expect(handler.name).toBe("save_memory")
	})

	describe("getDescription", () => {
		it("returns save_memory description", () => {
			const block = createToolUse("save_memory", { type: "pattern" })
			expect(handler.getDescription(block)).toBe("[save_memory: pattern]")
		})

		it("returns recall_memory description", () => {
			const block = createToolUse("recall_memory", { query: "linting" })
			expect(handler.getDescription(block)).toBe("[recall_memory for 'linting']")
		})

		it("returns default description when params are missing", () => {
			expect(handler.getDescription(createToolUse("save_memory", {}))).toBe("[save_memory: memory]")
			expect(handler.getDescription(createToolUse("recall_memory", {}))).toBe("[recall_memory for 'memories']")
		})
	})

	describe("save_memory", () => {
		it("reports error when content is missing", async () => {
			const config = createMockConfig()
			const block = createToolUse("save_memory", { type: "pattern" })
			await handler.execute(config, block)
			expect(config.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith("save_memory", "content")
			expect(config.taskState.consecutiveMistakeCount).toBe(1)
		})

		it("reports error when type is missing", async () => {
			const config = createMockConfig()
			const block = createToolUse("save_memory", { content: "test" })
			await handler.execute(config, block)
			expect(config.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith("save_memory", "type")
		})

		it("reports error when type is invalid", async () => {
			const config = createMockConfig()
			const block = createToolUse("save_memory", { content: "test", type: "invalid_type" })
			const result = await handler.execute(config, block)
			expect(result).toContain('Invalid memory type: "invalid_type"')
			expect(result).toContain("pattern")
			expect(config.taskState.consecutiveMistakeCount).toBe(1)
		})

		it("saves memory successfully", async () => {
			const config = createMockConfig()
			const block = createToolUse("save_memory", {
				content: "Use biome",
				type: "pattern",
				keywords: "biome, linting",
			})
			const result = await handler.execute(config, block)
			expect(config.services.dagBridge.saveMemory).toHaveBeenCalledWith({
				content: "Use biome",
				type: "pattern",
				keywords: ["biome", "linting"],
				sourceTask: "task-123",
			})
			expect(result).toContain("Memory saved successfully")
		})

		it("saves memory with no keywords", async () => {
			const config = createMockConfig()
			const block = createToolUse("save_memory", {
				content: "A fact",
				type: "fact",
			})
			const result = await handler.execute(config, block)
			expect(config.services.dagBridge.saveMemory).toHaveBeenCalledWith({
				content: "A fact",
				type: "fact",
				keywords: [],
				sourceTask: "task-123",
			})
			expect(result).toContain("Memory saved successfully")
			expect(result).toContain("(none)")
		})

		it("resets consecutiveMistakeCount on success", async () => {
			const config = createMockConfig()
			config.taskState.consecutiveMistakeCount = 3
			const block = createToolUse("save_memory", { content: "test", type: "pattern" })
			await handler.execute(config, block)
			expect(config.taskState.consecutiveMistakeCount).toBe(0)
		})

		it("returns error when bridge is not running", async () => {
			const config = createMockConfig({ isRunning: vi.fn().mockReturnValue(false) })
			const block = createToolUse("save_memory", { content: "test", type: "pattern" })
			const result = await handler.execute(config, block)
			expect(result).toContain("Memory service is not available")
		})

		it("returns error when bridge is undefined", async () => {
			const config = createMockConfig()
			config.services.dagBridge = undefined
			const block = createToolUse("save_memory", { content: "test", type: "pattern" })
			const result = await handler.execute(config, block)
			expect(result).toContain("Memory service is not available")
		})

		it("handles saveMemory errors gracefully", async () => {
			const config = createMockConfig({
				saveMemory: vi.fn().mockRejectedValue(new Error("Connection lost")),
			})
			const block = createToolUse("save_memory", { content: "test", type: "pattern" })
			const result = await handler.execute(config, block)
			expect(result).toContain("Failed to save memory: Connection lost")
		})
	})

	describe("recall_memory", () => {
		it("reports error when query is missing", async () => {
			const config = createMockConfig()
			const block = createToolUse("recall_memory", {})
			await handler.execute(config, block)
			expect(config.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith("recall_memory", "query")
		})

		it("recalls memories successfully", async () => {
			const config = createMockConfig()
			const block = createToolUse("recall_memory", { query: "linting" })
			const result = await handler.execute(config, block)
			expect(config.services.dagBridge.recallMemory).toHaveBeenCalledWith({
				query: "linting",
				topK: 5,
				type: undefined,
			})
			expect(result).toContain("Found 1 relevant memories")
			expect(result).toContain("Use biome for linting")
		})

		it("respects top_k parameter", async () => {
			const config = createMockConfig()
			const block = createToolUse("recall_memory", { query: "test", top_k: "10" })
			await handler.execute(config, block)
			expect(config.services.dagBridge.recallMemory).toHaveBeenCalledWith({
				query: "test",
				topK: 10,
				type: undefined,
			})
		})

		it("caps top_k at 20", async () => {
			const config = createMockConfig()
			const block = createToolUse("recall_memory", { query: "test", top_k: "100" })
			await handler.execute(config, block)
			expect(config.services.dagBridge.recallMemory).toHaveBeenCalledWith({
				query: "test",
				topK: 20,
				type: undefined,
			})
		})

		it("passes type filter", async () => {
			const config = createMockConfig()
			const block = createToolUse("recall_memory", { query: "test", type: "pattern" })
			await handler.execute(config, block)
			expect(config.services.dagBridge.recallMemory).toHaveBeenCalledWith({
				query: "test",
				topK: 5,
				type: "pattern",
			})
		})

		it("returns no results message when empty", async () => {
			const config = createMockConfig({
				recallMemory: vi.fn().mockResolvedValue({ results: [], query: "xyz", totalSearched: 10 }),
			})
			const block = createToolUse("recall_memory", { query: "xyz" })
			const result = await handler.execute(config, block)
			expect(result).toContain("No memories found")
			expect(result).toContain("Searched 10 memories")
		})

		it("returns error when bridge is not running", async () => {
			const config = createMockConfig({ isRunning: vi.fn().mockReturnValue(false) })
			const block = createToolUse("recall_memory", { query: "test" })
			const result = await handler.execute(config, block)
			expect(result).toContain("Memory service is not available")
		})

		it("handles recallMemory errors gracefully", async () => {
			const config = createMockConfig({
				recallMemory: vi.fn().mockRejectedValue(new Error("Timeout")),
			})
			const block = createToolUse("recall_memory", { query: "test" })
			const result = await handler.execute(config, block)
			expect(result).toContain("Failed to recall memories: Timeout")
		})
	})
})

describe("RecallMemoryAliasHandler", () => {
	it("has the correct tool name", () => {
		const baseHandler = new AgentMemoryToolHandler()
		const alias = new RecallMemoryAliasHandler(baseHandler)
		expect(alias.name).toBe("recall_memory")
	})

	it("delegates execute to base handler", async () => {
		const baseHandler = new AgentMemoryToolHandler()
		const alias = new RecallMemoryAliasHandler(baseHandler)
		const config = createMockConfig()
		const block = createToolUse("recall_memory", { query: "linting" })
		const result = await alias.execute(config, block)
		expect(result).toContain("Found 1 relevant memories")
	})

	it("delegates getDescription to base handler", () => {
		const baseHandler = new AgentMemoryToolHandler()
		const alias = new RecallMemoryAliasHandler(baseHandler)
		const block = createToolUse("recall_memory", { query: "linting" })
		expect(alias.getDescription(block)).toBe("[recall_memory for 'linting']")
	})
})
