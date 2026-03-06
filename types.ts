export type WatchdogSeverity = "suspicious" | "stuck" | "pathological";

export type WatchdogAction =
  | "status"
  | "persist"
  | "notify"
  | "steer"
  | "block";

export type SteerDelivery = "custom" | "user";

export type WatchdogToolName = string;

export interface WatchdogToolEvent {
  index: number;
  toolName: WatchdogToolName;
  toolCallId?: string;
  timestamp: number;
  path?: string;
  normalizedPath?: string;
  offset?: number;
  limit?: number;
  command?: string;
  blocked?: boolean;
  messageIndex?: number;
  metadata?: Record<string, unknown>;
}

export interface WatchdogRuntimeSnapshot {
  events: WatchdogToolEvent[];
  candidate: WatchdogToolEvent;
  now: number;
  sessionStartedAt: number | null;
}

export interface WatchdogFinding {
  detectorId: string;
  severity: WatchdogSeverity;
  score: number;
  title: string;
  summary: string;
  fingerprint: string;
  evidence: string[];
  metrics: Record<string, number | string | boolean | null>;
  subject?: {
    toolName: string;
    path?: string;
    offset?: number;
    limit?: number;
  };
}

export interface WatchdogDetector {
  id: string;
  evaluate(
    snapshot: WatchdogRuntimeSnapshot,
    config: WatchdogConfig,
  ): WatchdogFinding | null;
}

export interface DetectorActionOverrides {
  suspicious?: WatchdogAction[];
  stuck?: WatchdogAction[];
  pathological?: WatchdogAction[];
}

export interface RepetitiveReadDetectorConfig {
  enabled: boolean;
  readTools: string[];
  searchTools: string[];
  windowToolCalls: number;
  minReadCalls: number;
  minDominantPathReads: number;
  suspicious: {
    topPathShare: number;
    exactChunkShare: number;
    overlapShare: number;
    readSearchRatio: number;
    maxUniquePaths: number;
    restarts: number;
    minScore: number;
  };
  pathological: {
    topPathShare: number;
    exactChunkShare: number;
    overlapShare: number;
    readSearchRatio: number;
    maxUniquePaths: number;
    restarts: number;
    minScore: number;
  };
  actions?: DetectorActionOverrides;
}

export interface ToolBudgetDetectorConfig {
  enabled: boolean;
  softToolCalls: number;
  hardToolCalls: number;
  softDurationMs: number;
  hardDurationMs: number;
  actions?: DetectorActionOverrides;
}

export interface WatchdogActionsConfig {
  suspicious: WatchdogAction[];
  stuck: WatchdogAction[];
  pathological: WatchdogAction[];
  cooldownToolCalls: number;
  delivery: SteerDelivery;
  customMessageType: string;
  displayMessages: boolean;
  triggerTurn: boolean;
}

export interface WatchdogConfig {
  enabled: boolean;
  debug: boolean;
  maxHistoryEvents: number;
  rebuildHistoryOnSessionStart: boolean;
  detectors: {
    repetitiveRead: RepetitiveReadDetectorConfig;
    toolBudget: ToolBudgetDetectorConfig;
  };
  actions: WatchdogActionsConfig;
}

export interface WatchdogIncident {
  detectorId: string;
  severity: WatchdogSeverity;
  fingerprint: string;
  title: string;
  summary: string;
  evidence: string[];
  metrics: Record<string, number | string | boolean | null>;
  toolIndex: number;
  timestamp: number;
  subject?: WatchdogFinding["subject"];
}

export interface WatchdogRuntimeState {
  config: WatchdogConfig;
  events: WatchdogToolEvent[];
  incidents: WatchdogIncident[];
  lastTriggeredAt: Map<string, number>;
  sessionStartedAt: number | null;
  lastStatus?: string;
}

export interface WatchdogReplaySummary {
  source: {
    sessionPath: string;
    kind: "session" | "embedded-subagent";
    selectedLine?: number;
    headLine?: number;
    headMessageId?: string;
    subagentLine?: number;
    subagentResultIndex?: number;
  };
  counts: {
    toolCalls: number;
    readCalls: number;
    grepCalls: number;
    findCalls: number;
    uniqueReadPaths: number;
    incidents: number;
  };
  incidents: WatchdogIncident[];
  topReadPaths: Array<{ path: string; count: number }>;
  topExactChunks: Array<{ key: string; count: number }>;
}
