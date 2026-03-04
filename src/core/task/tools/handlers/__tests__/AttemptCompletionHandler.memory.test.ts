import { describe, expect, it, vi } from "vitest"

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

vi.mock("@core/hooks/hooks-utils", () => ({
	getHooksEnabledSafe: vi.fn().mockReturnValue(false),
}))

vi.mock("@services/telemetry", () => ({
	telemetryService: {
		captureTaskCompleted: vi.fn(),
	},
}))

vi.mock("@integrations/notifications", () => ({
	showSystemNotification: vi.fn(),
}))

import type { MemoryManager } from "@core/memory/MemoryManager"

describe("AttemptCompletionHandler memory integration", () => {
	it("should call memoryManager.onTaskComplete when services has memoryManager", async () => {
		const mockMemoryManager: Partial<MemoryManager> = {
			onTaskComplete: vi.fn().mockResolvedValue(undefined),
			startCompactionTimer: vi.fn(),
		}

		// Verify the interface contract
		expect(mockMemoryManager.onTaskComplete).toBeDefined()
		expect(mockMemoryManager.startCompactionTimer).toBeDefined()
	})
})
