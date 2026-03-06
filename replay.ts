import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCandidate, appendEvent } from "./analysis.js";
import { loadConfig, mergeConfig, parseConfigText } from "./config.js";
import { createRuntimeState } from "./state.js";
import type {
  WatchdogConfig,
  WatchdogIncident,
  WatchdogReplaySummary,
} from "./types.js";
import {
  extractToolEventsFromMessages,
  parseSessionJsonl,
  summarizeExactChunks,
  summarizeHotPaths,
} from "./utils.js";

interface SessionJsonlEntry {
  type?: string;
  id?: string;
  message?: any;
}

export interface ReplayRequest {
  sessionPath: string;
  cwd?: string;
  configPath?: string;
  headLine?: number;
  headMessageId?: string;
  subagentLine?: number;
  subagentResultIndex?: number;
}

export function replaySession(request: ReplayRequest): WatchdogReplaySummary {
  const sessionPath = resolve(request.sessionPath);
  const cwd = request.cwd ? resolve(request.cwd) : "";
  const config = loadReplayConfig(cwd, request.configPath);
  const entries = parseSessionJsonl(readFileSync(sessionPath, "utf8"));
  const source = selectReplaySource(entries, request);
  const events = extractToolEventsFromMessages(source.messages, cwd);
  const state = createRuntimeState(config);
  const incidents: WatchdogIncident[] = [];

  for (const event of events) {
    const evaluation = evaluateCandidate(state, event);
    if (evaluation.incident && !evaluation.cooledDown) {
      incidents.push(evaluation.incident);
    }
    appendEvent(state, event);
  }

  const readEvents = events.filter((event) => event.toolName === "read");
  const grepEvents = events.filter((event) => event.toolName === "grep");
  const findEvents = events.filter((event) => event.toolName === "find");

  return {
    source: {
      sessionPath,
      kind: source.kind,
      selectedLine: source.selectedLine,
      headLine: request.headLine,
      headMessageId: request.headMessageId,
      subagentLine: request.subagentLine,
      subagentResultIndex: request.subagentResultIndex ?? 0,
    },
    counts: {
      toolCalls: events.length,
      readCalls: readEvents.length,
      grepCalls: grepEvents.length,
      findCalls: findEvents.length,
      uniqueReadPaths: new Set(
        readEvents.map((event) => event.normalizedPath).filter(Boolean),
      ).size,
      incidents: incidents.length,
    },
    incidents,
    topReadPaths: summarizeHotPaths(readEvents, 20),
    topExactChunks: summarizeExactChunks(readEvents, 20),
  };
}

export function formatReplaySummary(
  summary: WatchdogReplaySummary,
  format: "markdown" | "json" = "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(summary, null, 2);
  }

  const lines: string[] = [];
  lines.push("# Watchdog Replay");
  lines.push("");
  lines.push("## Source");
  lines.push(`- Kind: ${summary.source.kind}`);
  lines.push(`- Session: ${summary.source.sessionPath}`);
  if (summary.source.subagentLine) {
    lines.push(
      `- Embedded subagent: line ${summary.source.subagentLine}, result ${summary.source.subagentResultIndex ?? 0}`,
    );
  } else if (summary.source.selectedLine) {
    lines.push(`- Selected line: ${summary.source.selectedLine}`);
  }
  lines.push("");
  lines.push("## Counts");
  lines.push(`- Tool calls: ${summary.counts.toolCalls}`);
  lines.push(`- Reads: ${summary.counts.readCalls}`);
  lines.push(`- Greps: ${summary.counts.grepCalls}`);
  lines.push(`- Finds: ${summary.counts.findCalls}`);
  lines.push(`- Unique read paths: ${summary.counts.uniqueReadPaths}`);
  lines.push(`- Incidents: ${summary.counts.incidents}`);
  lines.push("");
  lines.push("## Incidents");
  if (summary.incidents.length === 0) {
    lines.push("- None");
  } else {
    for (const incident of summary.incidents.slice(0, 20)) {
      lines.push(
        `- [${incident.severity}] ${incident.detectorId} @ tool ${incident.toolIndex} • ${incident.summary}`,
      );
    }
    if (summary.incidents.length > 20) {
      lines.push(`- ... ${summary.incidents.length - 20} more`);
    }
  }
  lines.push("");
  lines.push("## Top Read Paths");
  if (summary.topReadPaths.length === 0) {
    lines.push("- None");
  } else {
    for (const item of summary.topReadPaths.slice(0, 20)) {
      lines.push(`- ${item.count} • ${item.path}`);
    }
  }
  lines.push("");
  lines.push("## Top Exact Chunks");
  if (summary.topExactChunks.length === 0) {
    lines.push("- None");
  } else {
    for (const item of summary.topExactChunks.slice(0, 20)) {
      lines.push(`- ${item.count} • ${item.key}`);
    }
  }
  return lines.join("\n");
}

function loadReplayConfig(
  cwd: string,
  explicitConfigPath?: string,
): WatchdogConfig {
  if (!explicitConfigPath) {
    return loadConfig(cwd);
  }

  const override = parseConfigText(
    readFileSync(resolve(explicitConfigPath), "utf8"),
  );
  return mergeConfig(loadConfig(cwd), override);
}

function selectReplaySource(
  entries: SessionJsonlEntry[],
  request: ReplayRequest,
): {
  kind: "session" | "embedded-subagent";
  messages: any[];
  selectedLine?: number;
} {
  if (request.subagentLine !== undefined) {
    const entry = entries[request.subagentLine - 1];
    if (!entry) {
      throw new Error(`No session entry at line ${request.subagentLine}`);
    }
    const result =
      entry.message?.details?.results?.[request.subagentResultIndex ?? 0];
    if (!result?.messages) {
      throw new Error(
        `Entry at line ${request.subagentLine} does not contain embedded subagent messages`,
      );
    }
    return {
      kind: "embedded-subagent",
      messages: result.messages,
      selectedLine: request.subagentLine,
    };
  }

  const maxIndex = resolveHeadIndex(entries, request);
  const messages = entries
    .slice(0, maxIndex === undefined ? entries.length : maxIndex + 1)
    .map((entry) => entry.message)
    .filter(Boolean);

  return {
    kind: "session",
    messages,
    selectedLine: maxIndex === undefined ? entries.length : maxIndex + 1,
  };
}

function resolveHeadIndex(
  entries: SessionJsonlEntry[],
  request: ReplayRequest,
): number | undefined {
  if (request.headLine !== undefined) {
    return Math.max(0, request.headLine - 1);
  }

  if (request.headMessageId !== undefined) {
    const index = entries.findIndex(
      (entry) => entry.id === request.headMessageId,
    );
    if (index === -1) {
      throw new Error(`Could not find message id ${request.headMessageId}`);
    }
    return index;
  }

  return undefined;
}
