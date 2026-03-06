import type {
  RepetitiveReadDetectorConfig,
  WatchdogConfig,
  WatchdogDetector,
  WatchdogFinding,
  WatchdogRuntimeSnapshot,
  WatchdogToolEvent,
} from '../types.js'
import {
  buildChunkKey,
  rangesOverlap,
  readLikeToolName,
  searchLikeToolName,
  takeRecent,
} from '../utils.js'

export const repetitiveReadDetector: WatchdogDetector = {
  id: 'repetitive-read',
  evaluate(snapshot, config) {
    return evaluateRepetitiveRead(snapshot, config.detectors.repetitiveRead)
  },
}

export function evaluateRepetitiveRead(
  snapshot: WatchdogRuntimeSnapshot,
  config: RepetitiveReadDetectorConfig
): WatchdogFinding | null {
  if (!config.enabled) return null
  const candidate = snapshot.candidate

  if (
    !candidate.normalizedPath ||
    !readLikeToolName(candidate.toolName, config.readTools)
  ) {
    return null
  }

  const recent = takeRecent(snapshot.events, config.windowToolCalls)
  const withCandidate = [...recent, candidate]
  const readEvents = withCandidate.filter((event) =>
    readLikeToolName(event.toolName, config.readTools)
  )
  const readSearchEvents = withCandidate.filter(
    (event) =>
      readLikeToolName(event.toolName, config.readTools) ||
      searchLikeToolName(event.toolName, config.searchTools)
  )

  if (readEvents.length < config.minReadCalls) {
    return null
  }

  const byPath = new Map<string, WatchdogToolEvent[]>()
  for (const event of readEvents) {
    if (!event.normalizedPath) continue
    let pathEvents = byPath.get(event.normalizedPath)
    if (!pathEvents) {
      pathEvents = []
      byPath.set(event.normalizedPath, pathEvents)
    }
    pathEvents.push(event)
  }

  const dominantEntry = [...byPath.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0]
  if (!dominantEntry) return null

  const [dominantPath, dominantEvents] = dominantEntry
  if (dominantPath !== candidate.normalizedPath) {
    return null
  }

  if (dominantEvents.length < config.minDominantPathReads) {
    return null
  }

  const uniquePaths = byPath.size
  const topPathShare = dominantEvents.length / readEvents.length
  const readSearchRatio =
    withCandidate.length > 0
      ? readSearchEvents.length / withCandidate.length
      : 0
  const currentChunkKey = buildChunkKey(candidate)
  const exactChunkCount = currentChunkKey
    ? dominantEvents.filter((event) => buildChunkKey(event) === currentChunkKey)
        .length
    : 0
  const exactChunkShare = exactChunkCount / dominantEvents.length
  const overlappingReads = dominantEvents.filter((event) =>
    rangesOverlap(event, candidate)
  ).length
  const overlapShare = overlappingReads / dominantEvents.length
  const restarts = countTopRestarts(dominantEvents)

  const suspiciousScore = computeScore(
    {
      topPathShare,
      exactChunkShare,
      overlapShare,
      readSearchRatio,
      uniquePaths,
      restarts,
    },
    config.suspicious
  )
  const pathologicalScore = computeScore(
    {
      topPathShare,
      exactChunkShare,
      overlapShare,
      readSearchRatio,
      uniquePaths,
      restarts,
    },
    config.pathological
  )

  const severity =
    pathologicalScore >= config.pathological.minScore
      ? 'pathological'
      : suspiciousScore >= config.suspicious.minScore
        ? topPathShare >= config.pathological.topPathShare ||
          restarts >= config.pathological.restarts
          ? 'stuck'
          : 'suspicious'
        : null

  if (!severity) return null

  const dominantSample = dominantEvents
    .slice(-6)
    .map((event) => `${event.offset ?? 1}:${event.limit ?? 'all'}`)

  return {
    detectorId: 'repetitive-read',
    severity,
    score: severity === 'pathological' ? pathologicalScore : suspiciousScore,
    title:
      severity === 'pathological'
        ? 'Pathological repeated read loop detected'
        : severity === 'stuck'
          ? 'Repeated read loop likely stalling progress'
          : 'Repeated read pattern looks suspicious',
    summary: `The agent is repeatedly rereading ${candidate.normalizedPath} across overlapping chunks instead of expanding to new surfaces.`,
    fingerprint: `repetitive-read:${candidate.normalizedPath}`,
    evidence: [
      `${dominantEvents.length} reads of the same path in the last ${withCandidate.length} tool calls`,
      `${Math.round(topPathShare * 100)}% of recent reads target this path`,
      `${Math.round(exactChunkShare * 100)}% of reads hit the exact current chunk`,
      `${Math.round(overlapShare * 100)}% of reads overlap the current chunk`,
      `${restarts} restarts to the top of the file`,
      `Recent chunk sample: ${dominantSample.join(', ')}`,
    ],
    metrics: {
      topPathShare,
      exactChunkShare,
      overlapShare,
      readSearchRatio,
      uniquePaths,
      restarts,
      dominantPathReads: dominantEvents.length,
      readCalls: readEvents.length,
      currentOffset: candidate.offset ?? 1,
      currentLimit: candidate.limit ?? 0,
    },
    subject: {
      toolName: candidate.toolName,
      path: candidate.normalizedPath,
      offset: candidate.offset,
      limit: candidate.limit,
    },
  }
}

function computeScore(
  metrics: {
    topPathShare: number
    exactChunkShare: number
    overlapShare: number
    readSearchRatio: number
    uniquePaths: number
    restarts: number
  },
  thresholds: {
    topPathShare: number
    exactChunkShare: number
    overlapShare: number
    readSearchRatio: number
    maxUniquePaths: number
    restarts: number
    minScore: number
  }
): number {
  let score = 0
  if (metrics.topPathShare >= thresholds.topPathShare) score += 2
  if (metrics.exactChunkShare >= thresholds.exactChunkShare) score += 2
  if (metrics.overlapShare >= thresholds.overlapShare) score += 2
  if (metrics.readSearchRatio >= thresholds.readSearchRatio) score += 1
  if (metrics.uniquePaths <= thresholds.maxUniquePaths) score += 1
  if (metrics.restarts >= thresholds.restarts) score += 2
  return score
}

function countTopRestarts(events: WatchdogToolEvent[]): number {
  let restarts = 0
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]
    const current = events[index]
    const previousOffset = previous.offset ?? 1
    const currentOffset = current.offset ?? 1

    if (previousOffset > currentOffset && currentOffset <= 1) {
      restarts++
    }
  }
  return restarts
}
