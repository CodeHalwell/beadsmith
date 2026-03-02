import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Bead Workflow - extension loads and renders without bead-related errors", async ({ page, sidebar }) => {
	// Verify the sidebar has loaded by checking for a known UI element.
	// The chat input is present on all main views (welcome and chat).
	const chatInput = sidebar.getByTestId("chat-input")
	await expect(chatInput).toBeVisible({ timeout: 10000 })

	// Collect any console errors related to bead components during a short observation window.
	const consoleErrors: string[] = []
	page.on("console", (msg) => {
		if (msg.type() === "error" && msg.text().toLowerCase().includes("bead")) {
			consoleErrors.push(msg.text())
		}
	})

	// Allow time for any async rendering or error logging to occur.
	await sidebar.waitForTimeout(2000)

	// There should be no bead-related console errors.
	expect(consoleErrors).toHaveLength(0)
})
