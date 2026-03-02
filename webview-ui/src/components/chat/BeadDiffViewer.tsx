/**
 * BeadDiffViewer - Collapsible per-file diff viewer for bead review messages.
 *
 * Renders a unified diff for a single file change using react-diff-viewer-continued.
 * Supports three data modes:
 *   1. oldContent/newContent provided directly
 *   2. Per-file unified diff string parsed into old/new
 *   3. Fallback: shows change type badge only (no diff content)
 */

import React, { useMemo, useState } from "react"
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued"

interface BeadDiffViewerProps {
	fileName: string
	changeType: "created" | "modified" | "deleted" | string
	/** Original file content (before change) */
	oldContent?: string
	/** New file content (after change) */
	newContent?: string
	/** Unified diff string as fallback */
	diff?: string
	linesAdded?: number
	linesRemoved?: number
}

const diffStyles = {
	variables: {
		dark: {
			diffViewerBackground: "var(--vscode-editor-background)",
			addedBackground: "rgba(0, 128, 0, 0.15)",
			removedBackground: "rgba(255, 0, 0, 0.15)",
			addedColor: "var(--vscode-editor-foreground)",
			removedColor: "var(--vscode-editor-foreground)",
			wordAddedBackground: "rgba(0, 128, 0, 0.3)",
			wordRemovedBackground: "rgba(255, 0, 0, 0.3)",
			addedGutterBackground: "rgba(0, 128, 0, 0.2)",
			removedGutterBackground: "rgba(255, 0, 0, 0.2)",
			gutterBackground: "var(--vscode-editor-background)",
			gutterColor: "var(--vscode-editorLineNumber-foreground)",
			codeFoldBackground: "var(--vscode-editor-background)",
			codeFoldGutterBackground: "var(--vscode-editor-background)",
			codeFoldContentColor: "var(--vscode-descriptionForeground)",
			emptyLineBackground: "var(--vscode-editor-background)",
		},
	},
	line: {
		fontSize: "12px",
		fontFamily: "var(--vscode-editor-font-family)",
	},
}

/**
 * Parse a unified diff string into old/new content.
 * Strips diff headers (---/+++ and @@ lines) and reconstructs old/new from - and + lines.
 */
function parseUnifiedDiff(diffStr: string): { oldValue: string; newValue: string } {
	const lines = diffStr.split("\n")
	const oldLines: string[] = []
	const newLines: string[] = []

	for (const line of lines) {
		// Skip diff headers
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@") || line.startsWith("diff ")) {
			continue
		}
		if (line.startsWith("-")) {
			oldLines.push(line.slice(1))
		} else if (line.startsWith("+")) {
			newLines.push(line.slice(1))
		} else if (line.startsWith(" ")) {
			// Context line (present in both)
			oldLines.push(line.slice(1))
			newLines.push(line.slice(1))
		} else if (line.length > 0) {
			// Lines without prefix are context
			oldLines.push(line)
			newLines.push(line)
		}
	}

	return {
		oldValue: oldLines.join("\n"),
		newValue: newLines.join("\n"),
	}
}

export const BeadDiffViewer = React.memo(function BeadDiffViewer({
	fileName,
	changeType,
	oldContent,
	newContent,
	diff,
	linesAdded,
	linesRemoved,
}: BeadDiffViewerProps) {
	const [expanded, setExpanded] = useState(false)

	const changeLabel = changeType === "created" ? "Added" : changeType === "deleted" ? "Deleted" : "Modified"
	const changeColor = changeType === "created" ? "#10b981" : changeType === "deleted" ? "#ef4444" : "#f59e0b"

	const hasDiffContent = !!(oldContent !== undefined || newContent !== undefined || diff)

	const { oldValue, newValue } = useMemo(() => {
		// Prefer explicit old/new content
		if (oldContent !== undefined || newContent !== undefined) {
			return {
				oldValue: oldContent ?? "",
				newValue: newContent ?? "",
			}
		}
		// Fall back to parsing the unified diff string
		if (diff) {
			return parseUnifiedDiff(diff)
		}
		return { oldValue: "", newValue: "" }
	}, [oldContent, newContent, diff])

	return (
		<div
			style={{
				marginBottom: 8,
				border: "1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, rgba(255,255,255,0.1)))",
				borderRadius: 4,
				overflow: "hidden",
			}}>
			<button
				onClick={() => hasDiffContent && setExpanded(!expanded)}
				style={{
					width: "100%",
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 10px",
					background: "var(--vscode-editor-background)",
					border: "none",
					color: "var(--vscode-editor-foreground)",
					cursor: hasDiffContent ? "pointer" : "default",
					fontSize: 12,
					textAlign: "left",
				}}>
				{hasDiffContent && (
					<span
						style={{
							transform: expanded ? "rotate(90deg)" : "none",
							transition: "transform 0.15s",
							display: "inline-block",
							fontSize: 10,
						}}>
						&#9654;
					</span>
				)}
				<span
					style={{
						color: changeColor,
						fontWeight: 600,
						fontSize: 11,
						padding: "1px 5px",
						borderRadius: 3,
						border: `1px solid ${changeColor}`,
						flexShrink: 0,
					}}>
					{changeLabel}
				</span>
				<span
					style={{
						fontFamily: "var(--vscode-editor-font-family)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
					}}>
					{fileName}
				</span>
				{(linesAdded !== undefined || linesRemoved !== undefined) && (
					<span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>
						{linesAdded !== undefined && linesAdded > 0 && <span style={{ color: "#10b981" }}>+{linesAdded}</span>}
						{linesAdded !== undefined && linesAdded > 0 && linesRemoved !== undefined && linesRemoved > 0 && " "}
						{linesRemoved !== undefined && linesRemoved > 0 && (
							<span style={{ color: "#ef4444" }}>-{linesRemoved}</span>
						)}
					</span>
				)}
			</button>
			{expanded && hasDiffContent && (
				<div
					style={{
						maxHeight: 400,
						overflow: "auto",
						borderTop: "1px solid var(--vscode-widget-border, rgba(255,255,255,0.1))",
					}}>
					<ReactDiffViewer
						compareMethod={DiffMethod.WORDS}
						newValue={newValue}
						oldValue={oldValue}
						splitView={false}
						styles={diffStyles}
						useDarkTheme={true}
					/>
				</div>
			)}
		</div>
	)
})
