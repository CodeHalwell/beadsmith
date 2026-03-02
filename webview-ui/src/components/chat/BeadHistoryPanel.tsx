/**
 * BeadHistoryPanel - Vertical timeline showing all beads in the current task.
 *
 * Fetches bead history from BeadServiceClient and renders a scrollable timeline
 * with status-colored dots, connecting lines, and expandable detail sections.
 */

import { BeadHistoryResponse, BeadStatus, BeadTaskSummary, Bead as ProtoBead } from "@shared/proto/beadsmith/bead"
import { StringRequest } from "@shared/proto/beadsmith/common"
import {
	AlertCircleIcon,
	ArrowRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	FileIcon,
	GitCommitIcon,
	LoaderCircleIcon,
	MessageSquareIcon,
	XIcon,
	ZapIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { BeadServiceClient } from "@/services/grpc-client"

interface BeadHistoryPanelProps {
	/** Callback when user clicks to scroll to a specific bead in the chat */
	onScrollToBead?: (beadNumber: number) => void
	className?: string
}

/** Maps BeadStatus enum to a human-readable label */
function getBeadStatusLabel(status: BeadStatus): string {
	switch (status) {
		case BeadStatus.BEAD_STATUS_APPROVED:
			return "Approved"
		case BeadStatus.BEAD_STATUS_REJECTED:
			return "Rejected"
		case BeadStatus.BEAD_STATUS_SKIPPED:
			return "Skipped"
		case BeadStatus.BEAD_STATUS_RUNNING:
			return "Running"
		case BeadStatus.BEAD_STATUS_AWAITING_APPROVAL:
			return "Awaiting Approval"
		default:
			return "Unknown"
	}
}

/** Maps BeadStatus enum to a hex color */
function getBeadStatusColor(status: BeadStatus): string {
	switch (status) {
		case BeadStatus.BEAD_STATUS_APPROVED:
			return "#10b981"
		case BeadStatus.BEAD_STATUS_REJECTED:
			return "#ef4444"
		case BeadStatus.BEAD_STATUS_SKIPPED:
			return "#6b7280"
		case BeadStatus.BEAD_STATUS_RUNNING:
			return "#3b82f6"
		case BeadStatus.BEAD_STATUS_AWAITING_APPROVAL:
			return "#f59e0b"
		default:
			return "#6b7280"
	}
}

/** Returns the appropriate icon for a bead status */
function getBeadStatusIcon(status: BeadStatus) {
	const color = getBeadStatusColor(status)
	const style = { color }
	switch (status) {
		case BeadStatus.BEAD_STATUS_APPROVED:
			return <CheckIcon className="size-3" style={style} />
		case BeadStatus.BEAD_STATUS_REJECTED:
			return <XIcon className="size-3" style={style} />
		case BeadStatus.BEAD_STATUS_SKIPPED:
			return <ArrowRightIcon className="size-3" style={style} />
		case BeadStatus.BEAD_STATUS_RUNNING:
			return <LoaderCircleIcon className="size-3 animate-spin" style={style} />
		case BeadStatus.BEAD_STATUS_AWAITING_APPROVAL:
			return <CircleDotIcon className="size-3" style={style} />
		default:
			return <AlertCircleIcon className="size-3" style={style} />
	}
}

/** A single expandable bead entry in the timeline */
const BeadTimelineEntry = memo<{
	bead: ProtoBead
	isLast: boolean
	onScrollToBead?: (beadNumber: number) => void
}>(({ bead, isLast, onScrollToBead }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const statusColor = getBeadStatusColor(bead.status)

	const toggleExpand = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	const handleScrollClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onScrollToBead?.(bead.beadNumber)
		},
		[bead.beadNumber, onScrollToBead],
	)

	const filesChangedCount = bead.filesChanged?.length ?? 0

	return (
		<div className="flex gap-3">
			{/* Timeline column: dot + connecting line */}
			<div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
				{/* Status dot */}
				<div
					className="flex items-center justify-center rounded-full border-2 flex-shrink-0"
					style={{
						width: 20,
						height: 20,
						borderColor: statusColor,
						backgroundColor: `${statusColor}20`,
					}}>
					{getBeadStatusIcon(bead.status)}
				</div>
				{/* Connecting line to next entry */}
				{!isLast && <div className="flex-1 w-px min-h-[16px]" style={{ backgroundColor: `${statusColor}40` }} />}
			</div>

			{/* Content column */}
			<div className={cn("flex-1 min-w-0 pb-3", { "pb-0": isLast })}>
				{/* Header row: clickable to expand */}
				<button
					className="w-full flex items-center justify-between gap-2 cursor-pointer hover:opacity-80 transition-opacity text-left"
					onClick={toggleExpand}
					type="button">
					<div className="flex items-center gap-2 min-w-0">
						<span className="text-xs font-semibold" style={{ color: statusColor }}>
							Bead {bead.beadNumber}
						</span>
						<span className="text-[10px] opacity-60">{getBeadStatusLabel(bead.status)}</span>
					</div>
					<div className="flex items-center gap-1.5 flex-shrink-0">
						{filesChangedCount > 0 && (
							<span className="flex items-center gap-0.5 text-[10px] opacity-60">
								<FileIcon className="size-2.5" />
								{filesChangedCount}
							</span>
						)}
						{bead.tokensUsed > 0 && (
							<span className="flex items-center gap-0.5 text-[10px] opacity-60">
								<ZapIcon className="size-2.5" />
								{bead.tokensUsed.toLocaleString()}
							</span>
						)}
						{isExpanded ? (
							<ChevronDownIcon className="size-3 opacity-50" />
						) : (
							<ChevronRightIcon className="size-3 opacity-50" />
						)}
					</div>
				</button>

				{/* Expanded details */}
				{isExpanded && (
					<div className="mt-1.5 rounded-sm border border-foreground/10 bg-foreground/5 text-xs">
						<div className="p-2 space-y-1.5">
							{/* Commit hash */}
							{bead.commitHash && (
								<div className="flex items-center gap-1.5 opacity-80">
									<GitCommitIcon className="size-3 flex-shrink-0" />
									<span className="font-mono text-[10px] truncate">{bead.commitHash}</span>
								</div>
							)}

							{/* Rejection feedback */}
							{bead.rejectionFeedback && (
								<div className="flex items-start gap-1.5">
									<MessageSquareIcon className="size-3 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
									<span className="opacity-80 break-words">{bead.rejectionFeedback}</span>
								</div>
							)}

							{/* Errors */}
							{bead.errors?.length > 0 && (
								<div className="flex items-start gap-1.5">
									<AlertCircleIcon className="size-3 flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
									<div className="space-y-0.5">
										{bead.errors.map((err, i) => (
											<div className="opacity-80 break-words text-[10px]" key={i}>
												{err}
											</div>
										))}
									</div>
								</div>
							)}

							{/* Files changed list */}
							{filesChangedCount > 0 && (
								<div className="pt-1 border-t border-foreground/10">
									<div className="opacity-60 mb-1">Files changed:</div>
									{bead.filesChanged.map((fc, i) => (
										<div className="flex items-center gap-1 text-[10px] opacity-70 truncate" key={i}>
											<FileIcon className="size-2.5 flex-shrink-0" />
											<span className="truncate">{fc.filePath}</span>
										</div>
									))}
								</div>
							)}

							{/* Scroll-to-bead link */}
							{onScrollToBead && (
								<button
									className="text-[10px] text-link hover:underline cursor-pointer mt-1"
									onClick={handleScrollClick}
									type="button">
									Scroll to bead in chat
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	)
})

BeadTimelineEntry.displayName = "BeadTimelineEntry"

/** Main panel showing the full bead history timeline */
export const BeadHistoryPanel = memo<BeadHistoryPanelProps>(({ onScrollToBead, className }) => {
	const { currentTaskItem } = useExtensionState()
	const [beads, setBeads] = useState<ProtoBead[]>([])
	const [summary, setSummary] = useState<BeadTaskSummary | undefined>(undefined)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchHistory = useCallback(async () => {
		const taskId = currentTaskItem?.id
		if (!taskId) {
			setBeads([])
			setSummary(undefined)
			setIsLoading(false)
			return
		}

		setIsLoading(true)
		setError(null)

		try {
			const response: BeadHistoryResponse = await BeadServiceClient.getBeadHistory(StringRequest.create({ value: taskId }))
			setBeads(response.beads ?? [])
			setSummary(response.summary)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setBeads([])
			setSummary(undefined)
		} finally {
			setIsLoading(false)
		}
	}, [currentTaskItem?.id])

	useEffect(() => {
		fetchHistory()
	}, [fetchHistory])

	// Loading state
	if (isLoading) {
		return (
			<div className={cn("flex items-center justify-center gap-2 py-4 text-xs opacity-60", className)}>
				<LoaderCircleIcon className="size-3.5 animate-spin" />
				<span>Loading bead history...</span>
			</div>
		)
	}

	// Error state
	if (error) {
		return (
			<div className={cn("flex items-center gap-2 py-3 px-2 text-xs", className)}>
				<AlertCircleIcon className="size-3.5 text-error flex-shrink-0" />
				<span className="text-error opacity-80">Failed to load history: {error}</span>
			</div>
		)
	}

	// Empty state
	if (beads.length === 0) {
		return (
			<div className={cn("py-4 text-center text-xs opacity-50", className)}>
				<div>No beads yet</div>
				<div className="mt-1 text-[10px]">Beads will appear here as they are completed</div>
			</div>
		)
	}

	return (
		<div className={cn("py-2 px-1", className)}>
			{/* Summary bar */}
			{summary && (
				<div className="flex items-center justify-between text-[10px] opacity-60 mb-2 px-1">
					<span>
						{summary.beadCount} bead{summary.beadCount !== 1 ? "s" : ""}
					</span>
					{summary.totalTokensUsed > 0 && (
						<span className="flex items-center gap-0.5">
							<ZapIcon className="size-2.5" />
							{summary.totalTokensUsed.toLocaleString()} tokens
						</span>
					)}
				</div>
			)}

			{/* Timeline */}
			<div className="space-y-0">
				{beads.map((bead, index) => (
					<BeadTimelineEntry
						bead={bead}
						isLast={index === beads.length - 1}
						key={bead.id || index}
						onScrollToBead={onScrollToBead}
					/>
				))}
			</div>
		</div>
	)
})

BeadHistoryPanel.displayName = "BeadHistoryPanel"

export default BeadHistoryPanel
