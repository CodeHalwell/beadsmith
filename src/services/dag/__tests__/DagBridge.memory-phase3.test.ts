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

describe("DagBridge memory Phase 3 methods", () => {
	let bridge: DagBridge

	beforeEach(() => {
		bridge = new DagBridge("python3", "/fake/path", {
			autoRestart: false,
			enableHealthChecks: false,
		})
		vi.spyOn(bridge as any, "call").mockResolvedValue({})
	})

	it("promoteTiers calls memory.promote_tiers", async () => {
		const mockResult = { promoted: 3 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.promoteTiers()
		expect((bridge as any).call).toHaveBeenCalledWith("memory.promote_tiers", {})
		expect(result).toEqual(mockResult)
	})

	it("applyDecay calls memory.apply_decay", async () => {
		const mockResult = { updated: 5 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.applyDecay()
		expect((bridge as any).call).toHaveBeenCalledWith("memory.apply_decay", {})
		expect(result).toEqual(mockResult)
	})

	it("getMergeCandidates calls with params", async () => {
		const mockResult = { groups: [] }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.getMergeCandidates(0.5)
		expect((bridge as any).call).toHaveBeenCalledWith("memory.get_merge_candidates", { min_jaccard: 0.5 })
		expect(result).toEqual(mockResult)
	})

	it("getMergeCandidates uses default minJaccard when omitted", async () => {
		const mockResult = { groups: [] }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.getMergeCandidates()
		expect((bridge as any).call).toHaveBeenCalledWith("memory.get_merge_candidates", { min_jaccard: 0.4 })
		expect(result).toEqual(mockResult)
	})

	it("validateMerge calls memory.validate_merge", async () => {
		const mockResult = { valid: true, score: 1.0 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.validateMerge("merged content", ["id1", "id2"])
		expect((bridge as any).call).toHaveBeenCalledWith("memory.validate_merge", {
			merged_content: "merged content",
			source_ids: ["id1", "id2"],
		})
		expect(result).toEqual(mockResult)
	})

	it("commitMerge calls memory.commit_merge", async () => {
		const mockResult = { id: "merged-id", generation: 2 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.commitMerge({
			mergedContent: "combined",
			sourceIds: ["id1", "id2"],
			keywords: ["test"],
			type: "pattern",
		})
		expect((bridge as any).call).toHaveBeenCalledWith("memory.commit_merge", {
			merged_content: "combined",
			source_ids: ["id1", "id2"],
			keywords: ["test"],
			type: "pattern",
		})
		expect(result).toEqual(mockResult)
	})

	it("logPolicy calls memory.log_policy", async () => {
		const mockResult = { id: 42 }
		vi.spyOn(bridge as any, "call").mockResolvedValue(mockResult)
		const result = await bridge.logPolicy({
			decision: "save",
			memoryId: "mem-1",
			context: "Task completed",
		})
		expect((bridge as any).call).toHaveBeenCalledWith("memory.log_policy", {
			decision: "save",
			memory_id: "mem-1",
			context: "Task completed",
		})
		expect(result).toEqual(mockResult)
	})

	it("updatePolicyOutcome calls memory.update_policy_outcome", async () => {
		vi.spyOn(bridge as any, "call").mockResolvedValue(null)
		await bridge.updatePolicyOutcome(42, "useful")
		expect((bridge as any).call).toHaveBeenCalledWith("memory.update_policy_outcome", {
			log_id: 42,
			outcome: "useful",
		})
	})
})
