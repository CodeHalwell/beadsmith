import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { isValidMemoryType, MemoryType } from "@shared/memory-types"
import { Logger } from "@shared/services/Logger"
import { BeadsmithDefaultTool } from "@shared/tools"
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

		if (!isValidMemoryType(type)) {
			config.taskState.consecutiveMistakeCount++
			const validTypes = Object.values(MemoryType).join(", ")
			return formatResponse.toolError(
				`Invalid memory type: "${type}". Must be one of: ${validTypes}.`,
			)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse comma-separated keywords
		const keywords = keywordsRaw
			? keywordsRaw
					.split(",")
					.map((k) => k.trim())
					.filter(Boolean)
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

/**
 * Lightweight alias handler that delegates to AgentMemoryToolHandler
 * but registers under the RECALL_MEMORY tool name.
 */
export class RecallMemoryAliasHandler implements IToolHandler {
	readonly name = BeadsmithDefaultTool.RECALL_MEMORY

	constructor(private baseHandler: AgentMemoryToolHandler) {}

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		return this.baseHandler.execute(config, block)
	}
}
