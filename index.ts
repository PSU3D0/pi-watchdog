import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  evaluateCandidate,
  appendEvent,
  formatFindingStatus,
  formatSteerMessage,
  summarizeState,
} from './analysis.js'
import { loadConfig } from './config.js'
import { createRuntimeState, resetRuntimeState } from './state.js'
import type {
  WatchdogConfig,
  WatchdogIncident,
  WatchdogRuntimeState,
} from './types.js'
import {
  createToolEvent,
  extractToolEventsFromSessionEntries,
} from './utils.js'

const INCIDENT_CUSTOM_TYPE = 'watchdog-incident'

export default function watchdogExtension(pi: ExtensionAPI) {
  let state = createRuntimeState(loadConfig(process.cwd()))

  const rebuild = (ctx: ExtensionContext) => {
    const config = loadConfig(ctx.cwd ?? process.cwd())
    resetRuntimeState(state, config)

    if (config.rebuildHistoryOnSessionStart) {
      const branch = ctx.sessionManager.getBranch()
      state.events = extractToolEventsFromSessionEntries(
        branch as any[],
        ctx.cwd ?? process.cwd()
      )
      state.sessionStartedAt = state.events[0]?.timestamp ?? null
      state.incidents = branch
        .filter(
          (entry: any) =>
            entry.type === 'custom' && entry.customType === INCIDENT_CUSTOM_TYPE
        )
        .map((entry: any) => entry.data as WatchdogIncident)
        .filter(Boolean)
      for (const incident of state.incidents) {
        state.lastTriggeredAt.set(incident.fingerprint, incident.toolIndex)
      }
    }

    if (config.debug && ctx.hasUI) {
      ctx.ui.setStatus('watchdog', `🛟 Watchdog: ${summarizeState(state)}`)
    } else if (ctx.hasUI) {
      ctx.ui.setStatus('watchdog', undefined)
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    rebuild(ctx)
  })

  pi.on('session_switch', async (_event, ctx) => {
    rebuild(ctx)
  })

  pi.on('session_tree', async (_event, ctx) => {
    rebuild(ctx)
  })

  pi.on('tool_call', async (event, ctx) => {
    const config = state.config
    if (!config.enabled) return undefined

    const candidate = createToolEvent({
      index: state.events.length,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      timestamp: Date.now(),
      cwd: ctx.cwd ?? process.cwd(),
      args: event.input,
      messageIndex: state.events.length,
    })

    const evaluation = evaluateCandidate(state, candidate, config)
    appendEvent(state, {
      ...candidate,
      blocked: evaluation.actions.includes('block'),
    })

    if (!evaluation.finding) {
      if (config.debug && ctx.hasUI) {
        ctx.ui.setStatus('watchdog', `🛟 Watchdog: ${summarizeState(state)}`)
      }
      return undefined
    }

    const finding = evaluation.finding
    const status = formatFindingStatus(finding)
    state.lastStatus = status

    if (ctx.hasUI && evaluation.actions.includes('status')) {
      ctx.ui.setStatus('watchdog', status)
    }

    if (evaluation.incident && evaluation.actions.includes('persist')) {
      pi.appendEntry(INCIDENT_CUSTOM_TYPE, evaluation.incident)
    }

    if (ctx.hasUI && evaluation.actions.includes('notify')) {
      ctx.ui.notify(`${finding.title}: ${finding.summary}`, 'warning')
    }

    if (evaluation.actions.includes('steer')) {
      const steerText = formatSteerMessage(finding)
      if (config.actions.delivery === 'user') {
        pi.sendUserMessage(steerText, { deliverAs: 'steer' })
      } else {
        pi.sendMessage(
          {
            customType: config.actions.customMessageType,
            content: steerText,
            display: config.actions.displayMessages,
            details: {
              detectorId: finding.detectorId,
              severity: finding.severity,
              metrics: finding.metrics,
              evidence: finding.evidence,
            },
          },
          {
            deliverAs: 'steer',
            triggerTurn: config.actions.triggerTurn,
          }
        )
      }
    }

    if (evaluation.actions.includes('block')) {
      return {
        block: true,
        reason: `${finding.title}. ${finding.summary}`,
      }
    }

    return undefined
  })

  pi.registerCommand('watchdog', {
    description: 'Show current watchdog runtime state',
    handler: async (_args, ctx: ExtensionCommandContext) => {
      rebuild(ctx)
      const lines = [`Watchdog status`, `- ${summarizeState(state)}`]
      const last = state.incidents.at(-1)
      if (last) {
        lines.push(
          `- last incident: [${last.severity}] ${last.detectorId} @ tool ${last.toolIndex}`
        )
        lines.push(`- summary: ${last.summary}`)
      }

      if (ctx.hasUI) {
        ctx.ui.notify(lines.join('\n'), 'info')
      }
    },
  })
}
