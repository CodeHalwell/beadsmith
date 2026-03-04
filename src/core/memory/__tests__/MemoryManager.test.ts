import { beforeEach, describe, expect, it, vi } from "vitest"

import * as vscode from "vscode"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: () => true,
		})),
	},
}))

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

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

import type { DagBridge } from "@services/dag/DagBridge"
import type { ApiHandler } from "@core/api"
import type { ApiStream, ApiStreamTextChunk } from "@core/api/transform/stream"
import { MemoryManager } from "../MemoryManager"

/**
 * Helper to create an ApiStream (AsyncGenerator) that yields a single text chunk.
 */
function createMockStream(text: string): ApiStream {
	async function* gen(): ApiStream {
		yield { type: "text", text } satisfies ApiStreamTextChunk
	}
	return gen()
}

function createMockBridge(): DagBridge {
	return {
		saveMemory: vi.fn().mockResolvedValue({ id: "mem-1" }),
		recallMemory: vi.fn().mockResolvedValue({ results: [], query: "", totalSearched: 0 }),
		recordCoChange: vi.fn().mockResolvedValue(undefined),
		logPolicy: vi.fn().mockResolvedValue({ id: 1 }),
		promoteTiers: vi.fn().mockResolvedValue({ promoted: 0 }),
		applyDecay: vi.fn().mockResolvedValue({ updated: 0 }),
		getMergeCandidates: vi.fn().mockResolvedValue({ groups: [] }),
		validateMerge: vi.fn().mockResolvedValue({ valid: true, score: 1.0 }),
		commitMerge: vi.fn().mockResolvedValue({ id: "merged-1" }),
		updatePolicyOutcome: vi.fn().mockResolvedValue(undefined),
		getMemoryStats: vi.fn().mockResolvedValue({ hotCount: 5 }),
	} as unknown as DagBridge
}

function createMockApi(): ApiHandler {
	return {
		createMessage: vi.fn().mockReturnValue(
			createMockStream(
				JSON.stringify([
					{
						type: "pattern",
						content: "This project uses biome for linting",
						keywords: ["biome", "linting"],
					},
				]),
			),
		),
		getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
	} as unknown as ApiHandler
}

describe("MemoryManager", () => {
	let manager: MemoryManager
	let mockBridge: DagBridge
	let mockApi: ApiHandler

	beforeEach(() => {
		mockBridge = createMockBridge()
		mockApi = createMockApi()
		manager = new MemoryManager(mockBridge, mockApi)
	})

	describe("onTaskComplete", () => {
		it("extracts and saves memories from conversation", async () => {
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, [])
			expect(mockApi.createMessage).toHaveBeenCalled()
			expect(mockBridge.saveMemory).toHaveBeenCalled()
			expect(mockBridge.logPolicy).toHaveBeenCalled()
		})

		it("skips short conversations (< 5 messages)", async () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi" },
			]
			await manager.onTaskComplete("task-1", messages, [])
			expect(mockApi.createMessage).not.toHaveBeenCalled()
		})

		it("caps at 5 memories per task", async () => {
			;(mockApi.createMessage as any).mockReturnValue(
				createMockStream(
					JSON.stringify(
						Array.from({ length: 10 }, (_, i) => ({
							type: "fact",
							content: `Learning ${i}`,
							keywords: ["test"],
						})),
					),
				),
			)
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, [])
			expect((mockBridge.saveMemory as any).mock.calls.length).toBeLessThanOrEqual(5)
		})

		it("records co-changes for changed files", async () => {
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, ["a.ts", "b.ts", "c.ts"])
			expect(mockBridge.recordCoChange).toHaveBeenCalledWith(["a.ts", "b.ts", "c.ts"])
		})

		it("does not record co-changes for single file", async () => {
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, ["single.ts"])
			expect(mockBridge.recordCoChange).not.toHaveBeenCalled()
		})

		it("handles LLM errors gracefully", async () => {
			;(mockApi.createMessage as any).mockReturnValue(createMockStream("not valid json [[["))
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, [])
			// Should not throw — invalid JSON is handled gracefully
		})

		it("skips saving when a highly similar memory already exists (dedup)", async () => {
			;(mockBridge.recallMemory as any).mockResolvedValue({
				results: [{ score: 0.95, content: "This project uses biome for linting" }],
				query: "",
				totalSearched: 1,
			})
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, [])
			expect(mockBridge.recallMemory).toHaveBeenCalled()
			expect(mockBridge.saveMemory).not.toHaveBeenCalled()
		})

		it("returns early when autoSave is disabled", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: () => false,
			} as any)
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
			}))
			await manager.onTaskComplete("task-1", messages, [])
			expect(mockApi.createMessage).not.toHaveBeenCalled()
			expect(mockBridge.saveMemory).not.toHaveBeenCalled()
			// Restore default mock
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: () => true,
			} as any)
		})
	})

	describe("runCompaction", () => {
		it("skips if hot count < 20", async () => {
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 5 })
			await manager.runCompaction()
			expect(mockBridge.promoteTiers).not.toHaveBeenCalled()
		})

		it("runs full pipeline when hot count >= 20", async () => {
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 25 })
			;(mockBridge.getMergeCandidates as any).mockResolvedValue({ groups: [] })
			await manager.runCompaction()
			expect(mockBridge.promoteTiers).toHaveBeenCalled()
			expect(mockBridge.applyDecay).toHaveBeenCalled()
			expect(mockBridge.getMergeCandidates).toHaveBeenCalled()
		})

		it("processes merge groups through LLM", async () => {
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 30 })
			;(mockBridge.getMergeCandidates as any).mockResolvedValue({
				groups: [
					{
						sourceIds: ["id1", "id2"],
						memories: [
							{ content: "Use biome", type: "pattern", keywords: ["biome"] },
							{ content: "Biome replaces eslint", type: "pattern", keywords: ["biome", "eslint"] },
						],
						jaccard: 0.5,
					},
				],
			})
			;(mockApi.createMessage as any).mockReturnValue(createMockStream("Use biome instead of eslint for linting"))
			await manager.runCompaction()
			expect(mockBridge.validateMerge).toHaveBeenCalled()
			expect(mockBridge.commitMerge).toHaveBeenCalled()
			expect(mockBridge.logPolicy).toHaveBeenCalled()
		})

		it("rejects merge when validation fails", async () => {
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 30 })
			;(mockBridge.getMergeCandidates as any).mockResolvedValue({
				groups: [
					{
						sourceIds: ["id1", "id2"],
						memories: [
							{ content: "a", type: "pattern", keywords: ["x"] },
							{ content: "b", type: "pattern", keywords: ["x"] },
						],
						jaccard: 0.5,
					},
				],
			})
			;(mockApi.createMessage as any).mockReturnValue(createMockStream("merged text"))
			;(mockBridge.validateMerge as any).mockResolvedValue({ valid: false, score: 0.3 })
			await manager.runCompaction()
			expect(mockBridge.commitMerge).not.toHaveBeenCalled()
		})

		it("handles errors in individual groups gracefully", async () => {
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 30 })
			;(mockBridge.getMergeCandidates as any).mockResolvedValue({
				groups: [
					{
						sourceIds: ["id1", "id2"],
						memories: [
							{ content: "a", type: "pattern", keywords: ["x"] },
							{ content: "b", type: "pattern", keywords: ["x"] },
						],
						jaccard: 0.5,
					},
				],
			})
			;(mockBridge.validateMerge as any).mockRejectedValue(new Error("validation failed"))
			await manager.runCompaction()
			// Should not throw — errors in individual groups are handled gracefully
		})

		it("returns early when autoSave is disabled", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: () => false,
			} as any)
			;(mockBridge.getMemoryStats as any).mockResolvedValue({ hotCount: 30 })
			await manager.runCompaction()
			expect(mockBridge.getMemoryStats).not.toHaveBeenCalled()
			expect(mockBridge.promoteTiers).not.toHaveBeenCalled()
			// Restore default mock
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: () => true,
			} as any)
		})
	})

	describe("compaction timer", () => {
		it("startCompactionTimer sets a timer", () => {
			vi.useFakeTimers()
			manager.startCompactionTimer()
			manager.cancelCompactionTimer()
			vi.useRealTimers()
		})
	})
})
