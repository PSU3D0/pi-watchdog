import type {
  ToolBudgetDetectorConfig,
  WatchdogConfig,
  WatchdogDetector,
  WatchdogFinding,
  WatchdogRuntimeSnapshot,
} from '../types.js'

export const toolBudgetDetector: WatchdogDetector = {
  id: 'tool-budget',
  evaluate(snapshot, config) {
    return evaluateToolBudget(snapshot, config.detectors.toolBudget)
  },
}

export function evaluateToolBudget(
  snapshot: WatchdogRuntimeSnapshot,
  config: ToolBudgetDetectorConfig
): WatchdogFinding | null {
  if (!config.enabled) return null

  const toolCalls = snapshot.events.length + 1
  const sessionStartedAt =
    snapshot.sessionStartedAt ?? snapshot.candidate.timestamp
  const durationMs = Math.max(
    0,
    snapshot.candidate.timestamp - sessionStartedAt
  )

  if (toolCalls < config.softToolCalls && durationMs < config.softDurationMs) {
    return null
  }

  const pathological =
    toolCalls >= config.hardToolCalls || durationMs >= config.hardDurationMs

  const severity = pathological ? 'pathological' : 'suspicious'
  const score = pathological ? 10 : 5

  return {
    detectorId: 'tool-budget',
    severity,
    score,
    title: pathological
      ? 'Tool-call budget exceeded'
      : 'Tool-call budget entering warning range',
    summary: `This session has used ${toolCalls} tool calls over ${Math.round(durationMs / 60000)} minutes.`,
    fingerprint: 'tool-budget',
    evidence: [
      `${toolCalls} tool calls observed`,
      `${Math.round(durationMs / 60000)} minutes elapsed since first tool call`,
      `Soft budget: ${config.softToolCalls} calls / ${Math.round(config.softDurationMs / 60000)} minutes`,
      `Hard budget: ${config.hardToolCalls} calls / ${Math.round(config.hardDurationMs / 60000)} minutes`,
    ],
    metrics: {
      toolCalls,
      durationMs,
      softToolCalls: config.softToolCalls,
      hardToolCalls: config.hardToolCalls,
      softDurationMs: config.softDurationMs,
      hardDurationMs: config.hardDurationMs,
    },
    subject: {
      toolName: snapshot.candidate.toolName,
      path: snapshot.candidate.normalizedPath,
      offset: snapshot.candidate.offset,
      limit: snapshot.candidate.limit,
    },
  }
}
