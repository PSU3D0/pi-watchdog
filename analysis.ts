import type {
  WatchdogConfig,
  WatchdogDetector,
  WatchdogFinding,
  WatchdogIncident,
  WatchdogRuntimeSnapshot,
  WatchdogRuntimeState,
  WatchdogToolEvent,
} from './types.js'
import { repetitiveReadDetector } from './detectors/repetitive-read.js'
import { toolBudgetDetector } from './detectors/tool-budget.js'
import { recordIncident, shouldCooldown } from './state.js'
import { takeRecent } from './utils.js'

const DEFAULT_DETECTORS: WatchdogDetector[] = [
  repetitiveReadDetector,
  toolBudgetDetector,
]

export function evaluateCandidate(
  state: WatchdogRuntimeState,
  candidate: WatchdogToolEvent,
  config = state.config,
  detectors = DEFAULT_DETECTORS
): {
  finding: WatchdogFinding | null
  incident: WatchdogIncident | null
  actions: string[]
  cooledDown: boolean
} {
  if (state.sessionStartedAt === null) {
    state.sessionStartedAt = candidate.timestamp
  }

  const snapshot: WatchdogRuntimeSnapshot = {
    events: state.events,
    candidate,
    now: candidate.timestamp,
    sessionStartedAt: state.sessionStartedAt,
  }

  const findings = detectors
    .map((detector) => detector.evaluate(snapshot, config))
    .filter((finding): finding is WatchdogFinding => finding !== null)

  const finding = selectMostSevere(findings)
  if (!finding) {
    return {
      finding: null,
      incident: null,
      actions: [],
      cooledDown: false,
    }
  }

  const cooledDown = shouldCooldown(state, finding.fingerprint, candidate.index)
  const incident: WatchdogIncident = {
    detectorId: finding.detectorId,
    severity: finding.severity,
    fingerprint: finding.fingerprint,
    title: finding.title,
    summary: finding.summary,
    evidence: [...finding.evidence],
    metrics: { ...finding.metrics },
    toolIndex: candidate.index,
    timestamp: candidate.timestamp,
    subject: finding.subject ? { ...finding.subject } : undefined,
  }

  if (!cooledDown) {
    recordIncident(state, incident)
  }

  return {
    finding,
    incident,
    actions: cooledDown ? ['status'] : resolveActions(config, finding),
    cooledDown,
  }
}

export function appendEvent(
  state: WatchdogRuntimeState,
  event: WatchdogToolEvent
): void {
  state.events.push(event)
  state.events = takeRecent(state.events, state.config.maxHistoryEvents)
}

export function formatFindingStatus(finding: WatchdogFinding): string {
  const path = finding.subject?.path
  const suffix = path ? ` • ${path}` : ''
  return `🛟 Watchdog: ${finding.severity} ${finding.detectorId}${suffix}`
}

export function formatSteerMessage(finding: WatchdogFinding): string {
  const lines = [
    `[Watchdog] ${finding.title}`,
    finding.summary,
    ...finding.evidence.slice(0, 4).map((line) => `- ${line}`),
    'Please summarize what you know, switch surfaces, or justify why this next tool call is still necessary before continuing.',
  ]
  return lines.join('\n')
}

export function summarizeState(state: WatchdogRuntimeState): string {
  const last = state.incidents.at(-1)
  if (!last) {
    return `watchdog enabled • ${state.events.length} current-run tool events • no recorded incidents`
  }

  return `${state.events.length} current-run tool events • ${state.incidents.length} recorded incidents • last=${last.severity} ${last.detectorId}`
}

function resolveActions(
  config: WatchdogConfig,
  finding: WatchdogFinding
): string[] {
  const detectorOverrides = getDetectorActionOverrides(
    config,
    finding.detectorId
  )
  if (detectorOverrides) {
    const override = detectorOverrides[finding.severity]
    if (override) return [...override]
  }
  return [...config.actions[finding.severity]]
}

function getDetectorActionOverrides(
  config: WatchdogConfig,
  detectorId: string
): Record<string, string[] | undefined> | undefined {
  if (detectorId === 'repetitive-read') {
    return config.detectors.repetitiveRead.actions as
      | Record<string, string[] | undefined>
      | undefined
  }
  if (detectorId === 'tool-budget') {
    return config.detectors.toolBudget.actions as
      | Record<string, string[] | undefined>
      | undefined
  }
  return undefined
}

function selectMostSevere(findings: WatchdogFinding[]): WatchdogFinding | null {
  if (findings.length === 0) return null

  const ranking: Record<WatchdogFinding['severity'], number> = {
    suspicious: 0,
    stuck: 1,
    pathological: 2,
  }

  return findings
    .slice()
    .sort(
      (a, b) => ranking[b.severity] - ranking[a.severity] || b.score - a.score
    )[0]
}
