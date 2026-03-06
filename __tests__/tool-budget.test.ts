import { expect, test } from 'bun:test'
import { evaluateToolBudget } from '../detectors/tool-budget.js'
import { getDefaultConfig } from '../config.js'
import { createToolEvent } from '../utils.js'
import type { WatchdogRuntimeSnapshot, WatchdogToolEvent } from '../types.js'

function makeRead(index: number, timestamp: number): WatchdogToolEvent {
  return createToolEvent({
    index,
    toolName: 'read',
    toolCallId: `read-${index}`,
    timestamp,
    cwd: '/repo',
    args: { path: 'src/file.ts', offset: 1, limit: 200 },
  })
}

function snapshot(
  events: WatchdogToolEvent[],
  candidate: WatchdogToolEvent
): WatchdogRuntimeSnapshot {
  return {
    events,
    candidate,
    now: candidate.timestamp,
    sessionStartedAt: events[0]?.timestamp ?? candidate.timestamp,
  }
}

test('tool-budget detector warns at soft thresholds', () => {
  const config = getDefaultConfig().detectors.toolBudget
  const events = Array.from({ length: config.softToolCalls - 1 }, (_, index) =>
    makeRead(index, index * 1000)
  )
  const candidate = makeRead(config.softToolCalls, config.softDurationMs + 1000)
  const finding = evaluateToolBudget(snapshot(events, candidate), config)

  expect(finding).not.toBeNull()
  expect(finding?.severity).toBe('suspicious')
})

test('tool-budget detector escalates to pathological at hard thresholds', () => {
  const config = getDefaultConfig().detectors.toolBudget
  const events = Array.from({ length: config.hardToolCalls }, (_, index) =>
    makeRead(index, index * 1000)
  )
  const candidate = makeRead(
    config.hardToolCalls + 1,
    config.hardDurationMs + 1000
  )
  const finding = evaluateToolBudget(snapshot(events, candidate), config)

  expect(finding).not.toBeNull()
  expect(finding?.severity).toBe('pathological')
})
