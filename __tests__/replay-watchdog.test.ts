import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatReplaySummary, replaySession } from '../replay.js'

function writeTempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'watchdog-replay-'))
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

const SESSION_TEXT = [
  JSON.stringify({
    type: 'message',
    id: 'subagent-wrapper',
    message: {
      role: 'toolResult',
      toolName: 'subagent',
      toolCallId: 'subagent-1',
      content: [{ type: 'text', text: 'done' }],
      details: {
        results: [
          {
            messages: buildEmbeddedMessages(),
          },
        ],
      },
    },
  }),
].join('\n')

function buildEmbeddedMessages() {
  const messages: any[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'inspect deeply' }],
      timestamp: 0,
    },
  ]

  let ts = 1
  let id = 0
  for (let cycle = 0; cycle < 12; cycle++) {
    for (const [offset, limit] of [
      [1, 110],
      [329, 120],
      [470, 170],
      [778, 150],
    ]) {
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: `read-${id}`,
            name: 'read',
            arguments: {
              path: 'src/core/session.rs',
              offset,
              limit,
            },
          },
        ],
        timestamp: ts++,
      })
      messages.push({
        role: 'toolResult',
        toolCallId: `read-${id}`,
        toolName: 'read',
        content: [{ type: 'text', text: 'content' }],
        timestamp: ts++,
      })
      id++
    }
  }

  return messages
}

test('replaySession reports incidents for an embedded pathological read loop', () => {
  const sessionPath = writeTempFile('session.jsonl', SESSION_TEXT)
  const summary = replaySession({
    sessionPath,
    subagentLine: 1,
  })

  expect(summary.counts.toolCalls).toBeGreaterThan(40)
  expect(summary.incidents.length).toBeGreaterThan(0)
  expect(summary.topReadPaths[0]?.path).toContain('src/core/session.rs')
})

test('formatReplaySummary emits incident and path sections', () => {
  const sessionPath = writeTempFile('session.jsonl', SESSION_TEXT)
  const summary = replaySession({
    sessionPath,
    subagentLine: 1,
  })
  const markdown = formatReplaySummary(summary)

  expect(markdown).toContain('# Watchdog Replay')
  expect(markdown).toContain('## Incidents')
  expect(markdown).toContain('## Top Read Paths')
})
