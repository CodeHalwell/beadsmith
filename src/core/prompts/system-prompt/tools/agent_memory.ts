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
