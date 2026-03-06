import type {
  WatchdogConfig,
  WatchdogIncident,
  WatchdogRuntimeState,
} from './types.js'

export function createRuntimeState(
  config: WatchdogConfig
): WatchdogRuntimeState {
  return {
    config,
    events: [],
    incidents: [],
    lastTriggeredAt: new Map(),
    sessionStartedAt: null,
    lastStatus: undefined,
  }
}

export function resetRuntimeState(
  state: WatchdogRuntimeState,
  config: WatchdogConfig
): void {
  state.config = config
  state.events = []
  state.incidents = []
  state.lastTriggeredAt.clear()
  state.sessionStartedAt = null
  state.lastStatus = undefined
}

export function recordIncident(
  state: WatchdogRuntimeState,
  incident: WatchdogIncident
): void {
  state.incidents.push(incident)
  state.lastTriggeredAt.set(incident.fingerprint, incident.toolIndex)
}

export function shouldCooldown(
  state: WatchdogRuntimeState,
  fingerprint: string,
  currentToolIndex: number
): boolean {
  const previous = state.lastTriggeredAt.get(fingerprint)
  if (previous === undefined) return false
  return currentToolIndex - previous < state.config.actions.cooldownToolCalls
}
