import { describe, expect, it } from "vitest"
import { isValidMemoryType, MemoryType } from "../memory-types"

describe("MemoryType", () => {
	it("defines all expected memory types", () => {
		expect(MemoryType.PATTERN).toBe("pattern")
		expect(MemoryType.ERROR_FIX).toBe("error_fix")
		expect(MemoryType.PREFERENCE).toBe("preference")
		expect(MemoryType.FILE_RELATIONSHIP).toBe("file_relationship")
		expect(MemoryType.STRATEGY).toBe("strategy")
		expect(MemoryType.FACT).toBe("fact")
	})

	it("validates known types", () => {
		expect(isValidMemoryType("pattern")).toBe(true)
		expect(isValidMemoryType("error_fix")).toBe(true)
		expect(isValidMemoryType("unknown")).toBe(false)
		expect(isValidMemoryType("")).toBe(false)
	})
})
