import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: () => ({
			get: () => undefined,
		}),
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

vi.mock("@shared/memory-types", () => ({}))

import { DagBridge } from "../DagBridge"

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
		const mockStats = {
			totalCount: 5,
			hotCount: 3,
			warmCount: 1,
			coldCount: 1,
			archivedCount: 0,
			totalEdges: 2,
			hasEmbeddings: false,
		}
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockStats)

		const result = await bridge.getMemoryStats()
		expect((bridge as any).call).toHaveBeenCalledWith("memory.stats", {})
		expect(result).toEqual(mockStats)
	})

	it("getFileMemories calls memory.file_memories", async () => {
		const mockResult = [{ id: "mem-1", content: "test" }]
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)

		const result = await bridge.getFileMemories("/path/to/file.ts")
		expect((bridge as any).call).toHaveBeenCalledWith("memory.file_memories", { file: "/path/to/file.ts" })
		expect(result).toEqual(mockResult)
	})

	it("recordCoChange calls memory.co_change", async () => {
		vi.spyOn(bridge as any, "call").mockResolvedValue(null)
		await bridge.recordCoChange(["/a.ts", "/b.ts"])
		expect((bridge as any).call).toHaveBeenCalledWith("memory.co_change", { files: ["/a.ts", "/b.ts"] })
	})

	it("getCoChanges calls memory.co_changes", async () => {
		const mockResult = [{ file: "/b.ts", weight: 3.0 }]
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)

		const result = await bridge.getCoChanges("/a.ts")
		expect((bridge as any).call).toHaveBeenCalledWith("memory.co_changes", { file: "/a.ts" })
		expect(result).toEqual(mockResult)
	})
})
