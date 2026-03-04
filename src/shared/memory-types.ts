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
	readonly topKeywords: readonly string[]
}

export interface MergeCandidate {
	readonly sourceIds: readonly string[]
	readonly memories: readonly MemoryRecord[]
	readonly jaccard: number
}

export interface MergeCandidatesResponse {
	readonly groups: readonly MergeCandidate[]
}

export interface MergeValidationResult {
	readonly valid: boolean
	readonly score: number
}

export interface PolicyLogEntry {
	readonly id: number
}
