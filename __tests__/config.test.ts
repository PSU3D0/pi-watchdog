import { expect, test } from 'bun:test'
import {
  getConfigSearchPaths,
  mergeConfig,
  parseConfigText,
} from '../config.js'

test('parseConfigText accepts JSONC comments and trailing commas', () => {
  const parsed = parseConfigText(`
    {
      // Keep watchdog on.
      "enabled": true,
      "detectors": {
        "toolBudget": {
          "hardToolCalls": 900,
        },
      },
    }
  `)

  expect(parsed.enabled).toBe(true)
  expect(parsed.detectors?.toolBudget?.hardToolCalls).toBe(900)
})

test('mergeConfig applies deep overrides without mutating defaults', () => {
  const merged = mergeConfig({
    detectors: {
      repetitiveRead: {
        pathological: {
          restarts: 12,
        },
      },
    },
  })

  expect(merged.detectors.repetitiveRead.pathological.restarts).toBe(12)
  expect(merged.detectors.repetitiveRead.suspicious.restarts).toBe(5)
})

test('getConfigSearchPaths returns global then local json/jsonc paths', () => {
  const paths = getConfigSearchPaths('/repo/project', '/home/tester')
  expect(paths).toEqual([
    '/home/tester/.pi/agent/watchdog.json',
    '/home/tester/.pi/agent/watchdog.jsonc',
    '/repo/project/.pi/watchdog.json',
    '/repo/project/.pi/watchdog.jsonc',
  ])
})
