import { expect, test } from 'bun:test'
import { summarizeState } from '../analysis.js'
import { getDefaultConfig } from '../config.js'
import {
  createRuntimeState,
  recordIncident,
  resetActiveRunState,
} from '../state.js'
import { createToolEvent } from '../utils.js'

test('resetActiveRunState clears current-run budget data but keeps recorded incidents', () => {
  const state = createRuntimeState(getDefaultConfig())

  state.events.push(
    createToolEvent({
      index: 0,
      toolName: 'read',
      toolCallId: 'read-1',
      timestamp: 1000,
      cwd: '/repo',
      args: { path: 'src/file.ts', offset: 1, limit: 200 },
    })
  )
  state.sessionStartedAt = 1000
  recordIncident(state, {
    detectorId: 'tool-budget',
    severity: 'pathological',
    fingerprint: 'tool-budget',
    title: 'Tool-call budget exceeded',
    summary: 'This session has used too many tool calls.',
    evidence: ['600 tool calls observed'],
    metrics: { toolCalls: 600 },
    toolIndex: 599,
    timestamp: 2000,
  })

  resetActiveRunState(state)

  expect(state.events).toHaveLength(0)
  expect(state.sessionStartedAt).toBeNull()
  expect(state.incidents).toHaveLength(1)
  expect(summarizeState(state)).toContain('0 current-run tool events')
  expect(summarizeState(state)).toContain('1 recorded incidents')
})
