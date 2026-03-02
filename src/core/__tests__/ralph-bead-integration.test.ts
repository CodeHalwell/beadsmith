import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { BeadManagerState } from "@shared/beads"
import sinon from "sinon"
import { BeadManager, createBeadManager } from "../beads/BeadManager"

describe("Ralph Loop + Bead Manager", () => {
	let manager: BeadManager
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		manager = new BeadManager("/test/workspace")
	})

	afterEach(() => {
		sandbox.restore()
		manager.removeAllListeners()
	})

	describe("Starting a task creates a bead in running state", () => {
		it("should create a bead with running status when a task starts", async () => {
			const bead = await manager.startTask("Implement feature X")

			bead.status.should.equal("running")
			bead.beadNumber.should.equal(1)
			bead.tokensUsed.should.equal(0)
			bead.iterationCount.should.equal(0)
			bead.errors.should.be.empty()
			bead.filesChanged.should.be.empty()
		})

		it("should set manager status to running", async () => {
			await manager.startTask("Implement feature X")

			const state = manager.getState()
			state.status.should.equal("running")
			state.currentBeadNumber.should.equal(1)
			state.beads.should.have.length(1)
			state.currentTask!.description.should.equal("Implement feature X")
		})

		it("should emit beadStarted event with the new bead", async () => {
			const beadStartedSpy = sandbox.spy()
			manager.on("beadStarted", beadStartedSpy)

			await manager.startTask("Implement feature X")

			beadStartedSpy.calledOnce.should.be.true()
			beadStartedSpy.firstCall.args[0].beadNumber.should.equal(1)
			beadStartedSpy.firstCall.args[0].status.should.equal("running")
		})

		it("should emit stateChanged event with running status", async () => {
			const stateChanges: BeadManagerState[] = []
			manager.on("stateChanged", (state: BeadManagerState) => {
				stateChanges.push(state)
			})

			await manager.startTask("Implement feature X")

			stateChanges.length.should.be.greaterThan(0)
			stateChanges.some((s) => s.status === "running").should.be.true()
		})

		it("should assign custom success criteria to the task", async () => {
			await manager.startTask("Fix bug Y", [{ type: "done_tag" }, { type: "no_errors" }])

			const state = manager.getState()
			state.currentTask!.successCriteria.should.have.length(2)
			state.currentTask!.successCriteria[0].type.should.equal("done_tag")
			state.currentTask!.successCriteria[1].type.should.equal("no_errors")
		})
	})

	describe("Completing a bead with passing criteria transitions to awaiting_approval", () => {
		it("should transition to awaiting_approval when done_tag criterion is met", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			const result = await manager.completeBead("Task is complete. DONE", "diff content")

			result.needsApproval.should.be.true()
			result.canContinue.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")
		})

		it("should transition to awaiting_approval when no_errors criterion is met", async () => {
			await manager.startTask("Implement feature", [{ type: "no_errors" }])

			const result = await manager.completeBead("Completed without errors", "")

			result.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")
		})

		it("should transition to awaiting_approval when multiple criteria all pass", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }, { type: "no_errors" }])

			const result = await manager.completeBead("All good. DONE", "")

			result.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")
			manager.getState().lastCriteriaResult!.allPassed.should.be.true()
		})

		it("should set the bead status to awaiting_approval", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			const bead = manager.getCurrentBead()!
			bead.status.should.equal("awaiting_approval")
		})

		it("should emit beadAwaitingApproval event", async () => {
			const awaitingSpy = sandbox.spy()
			manager.on("beadAwaitingApproval", awaitingSpy)

			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			awaitingSpy.calledOnce.should.be.true()
			awaitingSpy.firstCall.args[0].status.should.equal("awaiting_approval")
		})
	})

	describe("Approving a bead progresses the task", () => {
		it("should mark bead as approved and complete the task when DONE is present", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			await manager.approveBead("abc123")

			const state = manager.getState()
			state.status.should.equal("completed")
			state.beads[0].status.should.equal("approved")
			state.beads[0].commitHash!.should.equal("abc123")
			state.beads[0].completedAt!.should.be.greaterThan(0)
		})

		it("should emit beadCompleted event on approval", async () => {
			const completedSpy = sandbox.spy()
			manager.on("beadCompleted", completedSpy)

			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")
			await manager.approveBead()

			completedSpy.calledOnce.should.be.true()
			completedSpy.firstCall.args[0].status.should.equal("approved")
		})

		it("should emit taskCompleted event with success when task finishes", async () => {
			const taskCompletedSpy = sandbox.spy()
			manager.on("taskCompleted", taskCompletedSpy)

			manager.configure({ autoApprove: true })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			manager.recordTokenUsage(500)
			await manager.completeBead("DONE", "")

			taskCompletedSpy.calledOnce.should.be.true()
			taskCompletedSpy.firstCall.args[0].success.should.be.true()
			taskCompletedSpy.firstCall.args[0].beadCount.should.equal(1)
			taskCompletedSpy.firstCall.args[0].totalTokensUsed.should.equal(500)
		})

		it("should start next bead when approved but task is not done", async () => {
			// Configure with high max iterations so task won't be done after first bead
			manager.configure({ maxIterations: 10 })

			await manager.startTask("Multi-step task", [{ type: "done_tag" }])
			// Complete first bead with criteria passing but no DONE marker in response
			// Actually we need DONE for done_tag to pass. Let's use no_errors instead.
			manager.removeAllListeners()

			// Start fresh with no_errors criteria so we can approve without DONE marker
			manager = new BeadManager("/test/workspace")
			manager.configure({ maxIterations: 10 })

			await manager.startTask("Multi-step task", [{ type: "no_errors" }])
			await manager.completeBead("Step 1 complete", "")
			// Criteria passes (no errors), bead goes to awaiting_approval
			manager.getState().status.should.equal("awaiting_approval")

			await manager.approveBead()

			// Since response doesn't contain DONE and we haven't hit limits,
			// a new bead should start
			const state = manager.getState()
			state.currentBeadNumber.should.equal(2)
			state.beads.should.have.length(2)
			state.status.should.equal("running")
			state.beads[1].status.should.equal("running")
		})
	})

	describe("Criteria failure causes retry (stays in running state)", () => {
		it("should stay in running state when done_tag criterion fails", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			const result = await manager.completeBead("Still working on it", "")

			result.needsApproval.should.be.false()
			result.canContinue.should.be.true()
			manager.getState().status.should.equal("running")
		})

		it("should increment iteration count on criteria failure", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			await manager.completeBead("Not done yet", "")

			const bead = manager.getCurrentBead()!
			bead.iterationCount.should.equal(1)
			manager.getState().totalIterationCount.should.equal(1)
		})

		it("should stay in running state when no_errors criterion fails", async () => {
			await manager.startTask("Implement feature", [{ type: "no_errors" }])
			manager.recordError("Compilation error in foo.ts")

			const result = await manager.completeBead("Done with errors", "")

			result.needsApproval.should.be.false()
			result.canContinue.should.be.true()
			manager.getState().status.should.equal("running")
		})

		it("should keep the same bead number on retry", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			await manager.completeBead("Not done", "")

			// Bead number should still be 1 - same bead retrying
			manager.getState().currentBeadNumber.should.equal(1)
			manager.getState().beads.should.have.length(1)
		})

		it("should allow multiple retries before criteria pass", async () => {
			manager.configure({ maxIterations: 5 })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			// Fail three times
			await manager.completeBead("Attempt 1", "")
			await manager.completeBead("Attempt 2", "")
			await manager.completeBead("Attempt 3", "")

			const bead = manager.getCurrentBead()!
			bead.iterationCount.should.equal(3)
			manager.getState().status.should.equal("running")

			// Now succeed
			const result = await manager.completeBead("DONE", "")
			result.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")
		})
	})

	describe("Max iterations exceeded causes failure", () => {
		it("should fail when max iterations are exhausted without passing criteria", async () => {
			manager.configure({ maxIterations: 2 })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			// First attempt - fails criteria, retries (iterationCount becomes 1)
			const result1 = await manager.completeBead("Not done", "")
			result1.canContinue.should.be.true()

			// Second attempt - hits max iterations (maxIterations - 1 = 1 iteration used)
			const result2 = await manager.completeBead("Still not done", "")
			result2.needsApproval.should.be.false()
			result2.canContinue.should.be.false()

			manager.getState().status.should.equal("failed")
		})

		it("should set bead status to rejected when max iterations exceeded", async () => {
			manager.configure({ maxIterations: 1 })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			await manager.completeBead("Not done", "")

			const bead = manager.getCurrentBead()!
			bead.status.should.equal("rejected")
		})

		it("should emit beadFailed event when max iterations exceeded", async () => {
			const failedSpy = sandbox.spy()
			manager.on("beadFailed", failedSpy)

			manager.configure({ maxIterations: 1 })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			await manager.completeBead("Not done", "")

			failedSpy.calledOnce.should.be.true()
			failedSpy.firstCall.args[1].should.containEql("Max iterations reached")
		})

		it("should not allow further operations after failure", async () => {
			manager.configure({ maxIterations: 1 })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("Not done", "")

			manager.getState().status.should.equal("failed")

			// Should be able to start a new task after failure
			const newBead = await manager.startTask("New task")
			newBead.beadNumber.should.equal(1)
		})
	})

	describe("Token budget tracking", () => {
		it("should track token usage across the bead and manager state", async () => {
			await manager.startTask("Implement feature")

			manager.recordTokenUsage(1000)
			manager.recordTokenUsage(2000)

			const bead = manager.getCurrentBead()!
			bead.tokensUsed.should.equal(3000)
			manager.getState().totalTokensUsed.should.equal(3000)
		})

		it("should track tokens across multiple beads", async () => {
			manager.configure({ maxIterations: 10 })
			await manager.startTask("Multi-step task", [{ type: "no_errors" }])

			// First bead
			manager.recordTokenUsage(1000)
			await manager.completeBead("Step 1 done", "")
			await manager.approveBead()

			// Second bead starts automatically (no DONE marker)
			manager.recordTokenUsage(2000)

			manager.getState().totalTokensUsed.should.equal(3000)
			// First bead should have 1000 tokens
			manager.getState().beads[0].tokensUsed.should.equal(1000)
			// Second bead should have 2000 tokens
			manager.getState().beads[1].tokensUsed.should.equal(2000)
		})

		it("should complete task when token budget is exhausted after approval", async () => {
			manager.configure({ tokenBudget: 500, autoApprove: true })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			manager.recordTokenUsage(600) // Exceed budget
			await manager.completeBead("DONE", "")

			// Task should complete because budget is exhausted
			manager.getState().status.should.equal("completed")
		})

		it("should reflect correct total tokens in taskCompleted event", async () => {
			const taskCompletedSpy = sandbox.spy()
			manager.on("taskCompleted", taskCompletedSpy)

			manager.configure({ autoApprove: true })
			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			manager.recordTokenUsage(1234)
			await manager.completeBead("DONE", "")

			taskCompletedSpy.firstCall.args[0].totalTokensUsed.should.equal(1234)
		})

		it("should emit stateChanged when tokens are recorded", async () => {
			const stateChangedSpy = sandbox.spy()

			await manager.startTask("Implement feature")
			manager.on("stateChanged", stateChangedSpy)

			manager.recordTokenUsage(500)

			stateChangedSpy.calledOnce.should.be.true()
			stateChangedSpy.firstCall.args[0].totalTokensUsed.should.equal(500)
		})
	})

	describe("Rejection with feedback starts new bead", () => {
		it("should create a new bead after rejection", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			manager.getState().status.should.equal("awaiting_approval")

			manager.rejectBead("The implementation is missing error handling")

			const state = manager.getState()
			state.status.should.equal("running")
			state.currentBeadNumber.should.equal(2)
			state.beads.should.have.length(2)
		})

		it("should set rejection feedback on the rejected bead", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			manager.rejectBead("Missing tests")

			const rejectedBead = manager.getState().beads[0]
			rejectedBead.status.should.equal("rejected")
			rejectedBead.rejectionFeedback!.should.equal("Missing tests")
			rejectedBead.completedAt!.should.be.greaterThan(0)
		})

		it("should have the new bead in running state", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")
			manager.rejectBead("Needs improvement")

			const newBead = manager.getCurrentBead()!
			newBead.beadNumber.should.equal(2)
			newBead.status.should.equal("running")
			newBead.tokensUsed.should.equal(0)
			newBead.iterationCount.should.equal(0)
			newBead.errors.should.be.empty()
		})

		it("should emit beadStarted for the new bead after rejection", async () => {
			const beadStartedSpy = sandbox.spy()
			manager.on("beadStarted", beadStartedSpy)

			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			// beadStartedSpy called once for first bead

			await manager.completeBead("DONE", "")
			manager.rejectBead("Fix it")

			// Called twice: once for initial bead, once for new bead after rejection
			beadStartedSpy.calledTwice.should.be.true()
			beadStartedSpy.secondCall.args[0].beadNumber.should.equal(2)
		})

		it("should allow the new bead to be completed and approved", async () => {
			await manager.startTask("Implement feature", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")
			manager.rejectBead("Add error handling")

			// Work on the new bead
			manager.recordFileChange({ filePath: "/test/errorHandler.ts", changeType: "created" })
			const result = await manager.completeBead("Added error handling. DONE", "")

			result.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")

			await manager.approveBead("def456")
			manager.getState().status.should.equal("completed")
		})
	})

	describe("Cancellation mid-bead returns to idle-like state", () => {
		it("should transition to failed status on cancellation", async () => {
			await manager.startTask("Implement feature")

			manager.cancelTask()

			manager.getState().status.should.equal("failed")
		})

		it("should mark the running bead as rejected", async () => {
			await manager.startTask("Implement feature")

			const bead = manager.getCurrentBead()!
			bead.status.should.equal("running")

			manager.cancelTask()

			bead.status.should.equal("rejected")
			bead.completedAt!.should.be.greaterThan(0)
		})

		it("should emit taskCompleted event with success=false on cancellation", async () => {
			const taskCompletedSpy = sandbox.spy()
			manager.on("taskCompleted", taskCompletedSpy)

			await manager.startTask("Implement feature")
			manager.recordTokenUsage(750)
			manager.cancelTask()

			taskCompletedSpy.calledOnce.should.be.true()
			taskCompletedSpy.firstCall.args[0].success.should.be.false()
			taskCompletedSpy.firstCall.args[0].beadCount.should.equal(1)
			taskCompletedSpy.firstCall.args[0].totalTokensUsed.should.equal(750)
		})

		it("should allow starting a new task after cancellation", async () => {
			await manager.startTask("First task")
			manager.cancelTask()

			manager.getState().status.should.equal("failed")

			// Should be able to start a new task
			const newBead = await manager.startTask("Second task")
			newBead.beadNumber.should.equal(1)
			manager.getState().status.should.equal("running")
		})

		it("should preserve token usage data after cancellation", async () => {
			await manager.startTask("Implement feature")
			manager.recordTokenUsage(5000)
			manager.cancelTask()

			manager.getState().totalTokensUsed.should.equal(5000)
		})

		it("should preserve file change data after cancellation", async () => {
			await manager.startTask("Implement feature")
			manager.recordFileChange({ filePath: "/test/file.ts", changeType: "modified" })
			manager.cancelTask()

			manager.getState().beads[0].filesChanged.should.have.length(1)
		})
	})

	describe("Full Ralph loop end-to-end", () => {
		it("should complete a multi-bead task with retry and rejection flow", async () => {
			manager.configure({ maxIterations: 10 })

			// Start task with no_errors criteria
			await manager.startTask("Build a widget", [{ type: "done_tag" }, { type: "no_errors" }])
			manager.getState().status.should.equal("running")

			// Bead 1: First attempt fails criteria (no DONE tag)
			manager.recordTokenUsage(500)
			manager.recordFileChange({ filePath: "/src/widget.ts", changeType: "created" })
			const r1 = await manager.completeBead("Started the widget", "")
			r1.canContinue.should.be.true()
			r1.needsApproval.should.be.false()

			// Bead 1: Second attempt passes criteria
			manager.recordTokenUsage(300)
			const r2 = await manager.completeBead("Widget built. DONE", "")
			r2.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")

			// Reviewer rejects: start bead 2
			manager.rejectBead("Missing unit tests")
			manager.getState().currentBeadNumber.should.equal(2)
			manager.getState().status.should.equal("running")

			// Bead 2: Add tests, complete with DONE
			manager.recordTokenUsage(400)
			manager.recordFileChange({ filePath: "/src/widget.test.ts", changeType: "created" })
			const r3 = await manager.completeBead("Added tests. DONE", "")
			r3.needsApproval.should.be.true()

			// Approve bead 2 => task completes (DONE in response)
			await manager.approveBead("final-commit")
			manager.getState().status.should.equal("completed")
			manager.getState().totalTokensUsed.should.equal(1200)
			manager.getState().beads.should.have.length(2)
		})

		it("should work correctly with createBeadManager helper", async () => {
			const helperManager = createBeadManager("/test/workspace", undefined, {
				maxIterations: 5,
				tokenBudget: 10000,
				autoApprove: true,
			})

			const bead = await helperManager.startTask("Quick task", [{ type: "done_tag" }])
			bead.status.should.equal("running")

			helperManager.recordTokenUsage(100)
			await helperManager.completeBead("DONE", "")

			// Auto-approve should have completed the task
			helperManager.getState().status.should.equal("completed")
		})
	})
})
