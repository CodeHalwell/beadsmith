import * as vscode from "vscode"
import type { ApiHandler } from "@core/api"
import type { ApiStream } from "@core/api/transform/stream"
import type { DagBridge } from "@services/dag/DagBridge"
import { isValidMemoryType } from "@shared/memory-types"
import { Logger } from "@shared/services/Logger"

const MAX_MEMORIES_PER_TASK = 5
const MIN_MESSAGES_FOR_EXTRACTION = 5
const LAST_N_MESSAGES = 20
const COMPACTION_IDLE_MS = 5 * 60 * 1000 // 5 minutes
const MIN_HOT_FOR_COMPACTION = 20

const EXTRACTION_PROMPT = `Analyze this task conversation and extract reusable learnings. For each:
- type: one of pattern, error_fix, preference, file_relationship, strategy, fact
- content: the learning in 1-2 sentences
- keywords: 3-5 relevant keywords

Only extract things useful in future tasks. Skip task-specific details.
Return a JSON array: [{"type": "...", "content": "...", "keywords": ["..."]}]
Return an empty array [] if no learnings are worth saving.`

interface ExtractedMemory {
	type: string
	content: string
	keywords: string[]
}

/**
 * Collect all text content from an ApiStream into a single string.
 */
async function collectStreamText(stream: ApiStream): Promise<string> {
	let text = ""
	for await (const chunk of stream) {
		if (chunk.type === "text") {
			text += chunk.text
		}
	}
	return text
}

export class MemoryManager {
	private bridge: DagBridge
	private api: ApiHandler
	private compactionTimer: ReturnType<typeof setTimeout> | undefined

	constructor(bridge: DagBridge, api: ApiHandler) {
		this.bridge = bridge
		this.api = api
	}

	async onTaskComplete(
		taskId: string,
		messages: Array<{ role: string; content: string }>,
		changedFiles: string[],
	): Promise<void> {
		const autoSave = vscode.workspace.getConfiguration("beadsmith.memory").get("autoSave", true)
		if (!autoSave) {
			return
		}

		try {
			if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) {
				Logger.info("[MemoryManager] Skipping extraction — too few messages", messages.length)
				return
			}

			const memories = await this.extractLearnings(messages)
			const toSave = memories.slice(0, MAX_MEMORIES_PER_TASK)

			for (const mem of toSave) {
				// Dedup check: skip if a highly similar memory already exists
				const existing = await this.bridge.recallMemory(mem.content)
				if (existing.results.some((r: any) => r.score > 0.9)) {
					continue
				}

				try {
					await this.bridge.saveMemory({
						content: mem.content,
						type: mem.type,
						keywords: mem.keywords,
						sourceTask: taskId,
					})
					await this.bridge.logPolicy({
						decision: "save",
						context: `Auto-extracted from task ${taskId}: ${mem.content.slice(0, 80)}`,
					})
				} catch (e) {
					Logger.warn("[MemoryManager] Failed to save memory", e)
				}
			}

			if (changedFiles.length >= 2) {
				try {
					await this.bridge.recordCoChange(changedFiles)
				} catch (e) {
					Logger.warn("[MemoryManager] Failed to record co-changes", e)
				}
			}

			Logger.info("[MemoryManager] Task complete processing done", {
				taskId,
				memoriesSaved: toSave.length,
				changedFiles: changedFiles.length,
			})
		} catch (error) {
			Logger.error("[MemoryManager] onTaskComplete failed (non-fatal)", error)
		}
	}

	private async extractLearnings(messages: Array<{ role: string; content: string }>): Promise<ExtractedMemory[]> {
		const recent = messages.slice(-LAST_N_MESSAGES)
		const conversationText = recent.map((m) => `${m.role}: ${m.content}`).join("\n\n")

		const stream = this.api.createMessage("", [
			{ role: "user", content: `${EXTRACTION_PROMPT}\n\n---\n\n${conversationText}` },
		])

		const responseText = await collectStreamText(stream)

		try {
			const parsed = JSON.parse(responseText)
			if (!Array.isArray(parsed)) {
				return []
			}
			return parsed.filter(
				(m: any) =>
					typeof m.content === "string" &&
					typeof m.type === "string" &&
					isValidMemoryType(m.type) &&
					Array.isArray(m.keywords),
			)
		} catch {
			Logger.warn("[MemoryManager] Failed to parse LLM extraction response")
			return []
		}
	}

	startCompactionTimer(): void {
		this.cancelCompactionTimer()
		this.compactionTimer = setTimeout(() => {
			this.runCompaction().catch((e) => Logger.error("[MemoryManager] Compaction failed", e))
		}, COMPACTION_IDLE_MS)
	}

	cancelCompactionTimer(): void {
		if (this.compactionTimer) {
			clearTimeout(this.compactionTimer)
			this.compactionTimer = undefined
		}
	}

	async runCompaction(): Promise<void> {
		const autoSave = vscode.workspace.getConfiguration("beadsmith.memory").get("autoSave", true)
		if (!autoSave) {
			return
		}

		try {
			const stats = await this.bridge.getMemoryStats()
			if (stats.hotCount < MIN_HOT_FOR_COMPACTION) {
				Logger.info("[MemoryManager] Skipping compaction — too few hot memories", stats.hotCount)
				return
			}

			const tierResult = await this.bridge.promoteTiers()
			Logger.info("[MemoryManager] Tier promotion", tierResult)

			const decayResult = await this.bridge.applyDecay()
			Logger.info("[MemoryManager] Decay applied", decayResult)

			const candidates = await this.bridge.getMergeCandidates()
			if (candidates.groups.length === 0) {
				Logger.info("[MemoryManager] No merge candidates")
				return
			}

			for (const group of candidates.groups) {
				try {
					await this.processCompactionGroup(group)
				} catch (e) {
					Logger.warn("[MemoryManager] Failed to process merge group", e)
				}
			}
		} catch (error) {
			Logger.error("[MemoryManager] Compaction pipeline failed", error)
		}
	}

	private async processCompactionGroup(group: {
		sourceIds: readonly string[]
		memories: readonly any[]
		jaccard: number
	}): Promise<void> {
		const sourceTexts = group.memories.map((m: any, i: number) => `Memory ${i + 1}: ${m.content}`).join("\n")

		const mergePrompt = `Merge these related memories into a single, concise memory that preserves all key information:\n\n${sourceTexts}\n\nOutput the merged memory as a single paragraph.`

		const stream = this.api.createMessage("", [{ role: "user", content: mergePrompt }])

		const mergedContent = (await collectStreamText(stream)).trim()
		if (!mergedContent) {
			return
		}

		const mutableSourceIds = [...group.sourceIds]

		const validation = await this.bridge.validateMerge(mergedContent, mutableSourceIds)
		if (!validation.valid) {
			Logger.info("[MemoryManager] Merge rejected — quality drop", validation)
			await this.bridge.logPolicy({
				decision: "compact",
				context: `Merge rejected (score=${validation.score}): ${mergedContent.slice(0, 80)}`,
			})
			return
		}

		const allKeywords = [...new Set(group.memories.flatMap((m: any) => m.keywords ?? []))]
		const memoryType = group.memories[0]?.type ?? "fact"

		await this.bridge.commitMerge({
			mergedContent,
			sourceIds: mutableSourceIds,
			keywords: allKeywords,
			type: memoryType,
		})

		await this.bridge.logPolicy({
			decision: "compact",
			context: `Merged ${mutableSourceIds.length} memories: ${mergedContent.slice(0, 80)}`,
		})
	}

	dispose(): void {
		this.cancelCompactionTimer()
	}
}
