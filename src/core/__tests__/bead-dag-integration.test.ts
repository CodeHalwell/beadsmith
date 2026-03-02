import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { DagBridge } from "@services/dag/DagBridge"
import type { ImpactReport } from "@services/dag/types"
import type { BeadImpactSummary } from "@shared/beads"
import sinon from "sinon"
import { BeadManager } from "../beads/BeadManager"

/**
 * Creates a fake DagBridge with a stubbed getImpact method.
 * We only need to satisfy the interface used by BeadManager, which calls
 * dagBridge.getImpact(filePath) during completeBead().
 */
function createFakeDagBridge(sandbox: sinon.SinonSandbox, impactReport: ImpactReport): DagBridge {
	return {
		getImpact: sandbox.stub().resolves(impactReport),
	} as unknown as DagBridge
}

/**
 * Creates a default ImpactReport for use in tests.
 */
function createDefaultImpactReport(overrides?: Partial<ImpactReport>): ImpactReport {
	return {
		changedFile: "/test/workspace/src/utils.ts",
		affectedFiles: ["/test/workspace/src/handler.ts", "/test/workspace/src/controller.ts"],
		affectedFunctions: ["handleRequest", "processInput"],
		suggestedTests: ["/test/workspace/src/__tests__/handler.test.ts"],
		confidenceBreakdown: {
			high: 3,
			medium: 1,
			low: 0,
			unsafe: 0,
		},
		impactDepth: 2,
		hasCircularDependencies: false,
		...overrides,
	}
}

describe("Bead + DAG Impact", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("File change recording during bead completion", () => {
		it("should record file changes in the bead state", async () => {
			const manager = new BeadManager("/test/workspace")
			manager.configure({ autoApprove: false })

			await manager.startTask("Implement feature", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/utils.ts",
				changeType: "modified",
				linesAdded: 10,
				linesRemoved: 3,
			})
			manager.recordFileChange({
				filePath: "/test/workspace/src/new-helper.ts",
				changeType: "created",
				linesAdded: 25,
				linesRemoved: 0,
			})
			manager.recordFileChange({
				filePath: "/test/workspace/src/old-file.ts",
				changeType: "deleted",
				linesAdded: 0,
				linesRemoved: 40,
			})

			const bead = manager.getCurrentBead()!
			bead.filesChanged.should.have.length(3)
			bead.filesChanged[0].filePath.should.equal("/test/workspace/src/utils.ts")
			bead.filesChanged[0].changeType.should.equal("modified")
			bead.filesChanged[0].linesAdded!.should.equal(10)
			bead.filesChanged[0].linesRemoved!.should.equal(3)

			bead.filesChanged[1].filePath.should.equal("/test/workspace/src/new-helper.ts")
			bead.filesChanged[1].changeType.should.equal("created")

			bead.filesChanged[2].filePath.should.equal("/test/workspace/src/old-file.ts")
			bead.filesChanged[2].changeType.should.equal("deleted")
		})

		it("should persist file changes through bead completion", async () => {
			const manager = new BeadManager("/test/workspace")
			manager.configure({ autoApprove: false })

			await manager.startTask("Fix bug", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/bugfix.ts",
				changeType: "modified",
				diff: "@@ -10,3 +10,5 @@\n-old line\n+new line\n+another line",
			})

			await manager.completeBead("Fixed the bug. DONE", "some-diff")

			const bead = manager.getCurrentBead()!
			bead.status.should.equal("awaiting_approval")
			bead.filesChanged.should.have.length(1)
			bead.filesChanged[0].filePath.should.equal("/test/workspace/src/bugfix.ts")
			bead.filesChanged[0].diff!.should.containEql("-old line")
		})

		it("should not record file changes when no bead is active", () => {
			const manager = new BeadManager("/test/workspace")

			// No task started, so no bead is active
			manager.recordFileChange({
				filePath: "/test/workspace/src/orphan.ts",
				changeType: "created",
			})

			const bead = manager.getCurrentBead()
			;(bead === null).should.be.true()
		})

		it("should record file changes with impactedNodes metadata", async () => {
			const manager = new BeadManager("/test/workspace")
			await manager.startTask("Refactor", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/refactored.ts",
				changeType: "modified",
				impactedNodes: ["src/refactored.ts:processData", "src/refactored.ts:validateInput"],
			})

			const bead = manager.getCurrentBead()!
			bead.filesChanged[0].impactedNodes!.should.have.length(2)
			bead.filesChanged[0].impactedNodes![0].should.equal("src/refactored.ts:processData")
		})
	})

	describe("DAG impact analysis on bead completion", () => {
		it("should populate impact summary when DAG bridge is available and files are changed", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			manager.configure({ autoApprove: false })

			await manager.startTask("Add feature", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/utils.ts",
				changeType: "modified",
			})

			await manager.completeBead("Feature added. DONE", "diff-content")

			const bead = manager.getCurrentBead()!
			const impact = bead.impactSummary as BeadImpactSummary
			impact.should.be.an.Object()
			impact.affectedFiles.should.deepEqual(["/test/workspace/src/handler.ts", "/test/workspace/src/controller.ts"])
			impact.affectedFunctions.should.deepEqual(["handleRequest", "processInput"])
			impact.suggestedTests.should.deepEqual(["/test/workspace/src/__tests__/handler.test.ts"])
			impact.confidenceBreakdown.high.should.equal(3)
			impact.confidenceBreakdown.medium.should.equal(1)
			impact.confidenceBreakdown.low.should.equal(0)
			impact.confidenceBreakdown.unsafe.should.equal(0)
		})

		it("should call getImpact with the first changed file path", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			await manager.startTask("Multi-file change", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/first.ts",
				changeType: "modified",
			})
			manager.recordFileChange({
				filePath: "/test/workspace/src/second.ts",
				changeType: "created",
			})

			await manager.completeBead("DONE", "diff")

			const getImpactStub = fakeDag.getImpact as sinon.SinonStub
			getImpactStub.calledOnce.should.be.true()
			getImpactStub.firstCall.args[0].should.equal("/test/workspace/src/first.ts")
		})

		it("should not populate impact summary when no files are changed", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			await manager.startTask("No-op task", [{ type: "done_tag" }])

			// Do not record any file changes
			await manager.completeBead("Nothing changed. DONE", "")

			const bead = manager.getCurrentBead()!
			;(bead.impactSummary === undefined).should.be.true()

			const getImpactStub = fakeDag.getImpact as sinon.SinonStub
			getImpactStub.called.should.be.false()
		})

		it("should not populate impact summary when no DAG bridge is provided", async () => {
			const manager = new BeadManager("/test/workspace") // No dagBridge
			await manager.startTask("Task without DAG", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/file.ts",
				changeType: "modified",
			})

			await manager.completeBead("DONE", "diff")

			const bead = manager.getCurrentBead()!
			;(bead.impactSummary === undefined).should.be.true()
		})

		it("should handle DAG impact analysis failure gracefully", async () => {
			const fakeDag = {
				getImpact: sandbox.stub().rejects(new Error("DAG engine crashed")),
			} as unknown as DagBridge

			const manager = new BeadManager("/test/workspace", fakeDag)
			await manager.startTask("Task with DAG failure", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/broken.ts",
				changeType: "modified",
			})

			// Should not throw even though DAG analysis fails
			await manager.completeBead("DONE", "diff")

			const bead = manager.getCurrentBead()!
			bead.status.should.equal("awaiting_approval")
			// Impact summary should be absent since the DAG call failed
			;(bead.impactSummary === undefined).should.be.true()
		})

		it("should map confidence breakdown with zero defaults for missing levels", async () => {
			const impactReport = createDefaultImpactReport({
				confidenceBreakdown: {
					high: 5,
					medium: 0,
					low: 0,
					unsafe: 0,
				},
			})
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			await manager.startTask("High confidence task", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/clean.ts",
				changeType: "modified",
			})

			await manager.completeBead("DONE", "diff")

			const bead = manager.getCurrentBead()!
			const breakdown = bead.impactSummary!.confidenceBreakdown
			breakdown.high.should.equal(5)
			breakdown.medium.should.equal(0)
			breakdown.low.should.equal(0)
			breakdown.unsafe.should.equal(0)
		})
	})

	describe("End-to-end bead lifecycle with DAG integration", () => {
		it("should carry impact summary through to approval", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			manager.configure({ autoApprove: false })

			await manager.startTask("Full lifecycle", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/feature.ts",
				changeType: "created",
				linesAdded: 50,
			})

			await manager.completeBead("Feature implemented. DONE", "diff")

			// Impact summary should be present before approval
			const beadBefore = manager.getCurrentBead()!
			beadBefore.impactSummary!.affectedFiles.should.have.length(2)

			// Approve the bead
			await manager.approveBead("abc123")

			// After approval, the bead should retain its impact summary
			const state = manager.getState()
			const approvedBead = state.beads[0]
			approvedBead.status.should.equal("approved")
			approvedBead.commitHash!.should.equal("abc123")
			approvedBead.impactSummary!.affectedFiles.should.have.length(2)
			approvedBead.impactSummary!.suggestedTests.should.have.length(1)
		})

		it("should produce impact summary on auto-approve flow", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			manager.configure({ autoApprove: true })

			await manager.startTask("Auto-approve with DAG", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/auto.ts",
				changeType: "modified",
			})

			await manager.completeBead("DONE", "diff")

			const state = manager.getState()
			state.status.should.equal("completed")
			const bead = state.beads[0]
			bead.status.should.equal("approved")
			bead.impactSummary!.should.be.an.Object()
			bead.impactSummary!.affectedFunctions.should.deepEqual(["handleRequest", "processInput"])
		})

		it("should include impact summary in beadAwaitingApproval event", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)

			const awaitingApprovalSpy = sandbox.spy()
			manager.on("beadAwaitingApproval", awaitingApprovalSpy)

			await manager.startTask("Event test", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/event-file.ts",
				changeType: "modified",
			})

			await manager.completeBead("DONE", "diff")

			awaitingApprovalSpy.calledOnce.should.be.true()
			const emittedBead = awaitingApprovalSpy.firstCall.args[0]
			emittedBead.impactSummary.should.be.an.Object()
			emittedBead.impactSummary.affectedFiles.should.have.length(2)
		})

		it("should still complete bead when criteria fail even with DAG available", async () => {
			const impactReport = createDefaultImpactReport()
			const fakeDag = createFakeDagBridge(sandbox, impactReport)

			const manager = new BeadManager("/test/workspace", fakeDag)
			manager.configure({ maxIterations: 3 })

			await manager.startTask("Retry task", [{ type: "done_tag" }])

			manager.recordFileChange({
				filePath: "/test/workspace/src/attempt.ts",
				changeType: "modified",
			})

			// First attempt: criteria not met (no DONE tag) but can retry
			const result = await manager.completeBead("In progress", "diff")
			result.needsApproval.should.be.false()
			result.canContinue.should.be.true()

			// Impact was still computed for the first attempt
			const getImpactStub = fakeDag.getImpact as sinon.SinonStub
			getImpactStub.calledOnce.should.be.true()
		})
	})
})
