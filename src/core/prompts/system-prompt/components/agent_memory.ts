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

export async function getAgentMemorySection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (!context.memoryEnabled) {
		return ""
	}

	const template = variant.componentOverrides?.[SystemPromptSection.AGENT_MEMORY]?.template || AGENT_MEMORY_TEMPLATE

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
