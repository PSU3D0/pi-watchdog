import { resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { WatchdogToolEvent } from "./types.js";

interface SessionEntry {
  type: string;
  id?: string;
  timestamp?: string;
  message?: AgentMessage;
}

export function normalizeToolPath(
  pathValue: unknown,
  cwd: string,
): string | undefined {
  if (typeof pathValue !== "string" || pathValue.trim().length === 0)
    return undefined;
  if (!cwd) return pathValue;
  try {
    return resolve(cwd, pathValue);
  } catch {
    return pathValue;
  }
}

export function createToolEvent(input: {
  index: number;
  toolName: string;
  toolCallId?: string;
  timestamp?: number;
  cwd: string;
  args?: any;
  blocked?: boolean;
  messageIndex?: number;
}): WatchdogToolEvent {
  const args = input.args ?? {};
  return {
    index: input.index,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    timestamp: input.timestamp ?? Date.now(),
    path: getPrimaryPath(input.toolName, args),
    normalizedPath: normalizeToolPath(
      getPrimaryPath(input.toolName, args),
      input.cwd,
    ),
    offset: asOptionalNumber(args.offset),
    limit: asOptionalNumber(args.limit),
    command: typeof args.command === "string" ? args.command : undefined,
    blocked: input.blocked,
    messageIndex: input.messageIndex,
    metadata: args && typeof args === "object" ? { args } : undefined,
  };
}

export function extractToolEventsFromMessages(
  messages: AgentMessage[],
  cwd: string,
): WatchdogToolEvent[] {
  const events: WatchdogToolEvent[] = [];

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;

    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      events.push(
        createToolEvent({
          index: events.length,
          toolName: block.name,
          toolCallId: block.id,
          timestamp: message.timestamp,
          cwd,
          args: block.arguments,
          messageIndex,
        }),
      );
    }
  }

  return events;
}

export function extractToolEventsFromSessionEntries(
  entries: SessionEntry[],
  cwd: string,
): WatchdogToolEvent[] {
  const messages = entries
    .filter(
      (entry): entry is SessionEntry & { message: AgentMessage } =>
        entry.type === "message" && Boolean(entry.message),
    )
    .map((entry) => entry.message);
  return extractToolEventsFromMessages(messages, cwd);
}

export function parseSessionJsonl(text: string): SessionEntry[] {
  const entries: SessionEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries.push(JSON.parse(trimmed) as SessionEntry);
  }

  return entries;
}

export function readLikeToolName(
  toolName: string,
  readTools: string[],
): boolean {
  return readTools.includes(toolName);
}

export function searchLikeToolName(
  toolName: string,
  searchTools: string[],
): boolean {
  return searchTools.includes(toolName);
}

export function buildChunkKey(
  event: Pick<WatchdogToolEvent, "normalizedPath" | "offset" | "limit">,
): string | null {
  if (!event.normalizedPath) return null;
  return JSON.stringify({
    path: event.normalizedPath,
    offset: event.offset ?? 1,
    limit: event.limit ?? null,
  });
}

export function rangesOverlap(
  a: Pick<WatchdogToolEvent, "offset" | "limit">,
  b: Pick<WatchdogToolEvent, "offset" | "limit">,
): boolean {
  const aStart = a.offset ?? 1;
  const bStart = b.offset ?? 1;
  const aEnd = getRangeEnd(aStart, a.limit);
  const bEnd = getRangeEnd(bStart, b.limit);

  return aStart <= bEnd && bStart <= aEnd;
}

export function summarizeHotPaths(
  events: WatchdogToolEvent[],
  topN = 10,
): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.normalizedPath) continue;
    counts.set(
      event.normalizedPath,
      (counts.get(event.normalizedPath) ?? 0) + 1,
    );
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([path, count]) => ({ path, count }));
}

export function summarizeExactChunks(
  events: WatchdogToolEvent[],
  topN = 10,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = buildChunkKey(event);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({ key, count }));
}

export function takeRecent<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}

function getPrimaryPath(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  if (
    toolName === "read" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "find" ||
    toolName === "grep"
  ) {
    return typeof args.path === "string" ? args.path : undefined;
  }

  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getRangeEnd(start: number, limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return start + limit - 1;
}
