import { expect, test } from "bun:test";
import { evaluateRepetitiveRead } from "../detectors/repetitive-read.js";
import { getDefaultConfig } from "../config.js";
import { createToolEvent } from "../utils.js";
import type { WatchdogRuntimeSnapshot, WatchdogToolEvent } from "../types.js";

function makeRead(
  index: number,
  path: string,
  offset: number,
  limit: number,
): WatchdogToolEvent {
  return createToolEvent({
    index,
    toolName: "read",
    toolCallId: `read-${index}`,
    timestamp: index * 1000,
    cwd: "/repo",
    args: { path, offset, limit },
  });
}

function makeGrep(index: number, path: string): WatchdogToolEvent {
  return createToolEvent({
    index,
    toolName: "grep",
    toolCallId: `grep-${index}`,
    timestamp: index * 1000,
    cwd: "/repo",
    args: { path, pattern: "foo" },
  });
}

function buildSnapshot(
  events: WatchdogToolEvent[],
  candidate: WatchdogToolEvent,
): WatchdogRuntimeSnapshot {
  return {
    events,
    candidate,
    now: candidate.timestamp,
    sessionStartedAt: events[0]?.timestamp ?? candidate.timestamp,
  };
}

test("repetitive-read detector flags repeated overlapping rereads of one hot file", () => {
  const config = getDefaultConfig().detectors.repetitiveRead;
  const events: WatchdogToolEvent[] = [];
  let index = 0;

  for (let cycle = 0; cycle < 12; cycle++) {
    events.push(makeRead(index++, "src/core/session.rs", 1, 110));
    events.push(makeRead(index++, "src/core/session.rs", 329, 120));
    events.push(makeRead(index++, "src/core/session.rs", 470, 170));
    events.push(makeRead(index++, "src/core/session.rs", 778, 150));
    events.push(makeGrep(index++, "src"));
  }

  const candidate = makeRead(index, "src/core/session.rs", 1, 110);
  const finding = evaluateRepetitiveRead(
    buildSnapshot(events, candidate),
    config,
  );

  expect(finding).not.toBeNull();
  const nonNullFinding = finding!;
  expect(nonNullFinding.detectorId).toBe("repetitive-read");
  expect(["stuck", "pathological"]).toContain(nonNullFinding.severity);
  expect(nonNullFinding.metrics.topPathShare).toBeGreaterThan(0.5);
  expect(nonNullFinding.metrics.restarts).toBeGreaterThanOrEqual(5);
});

test("repetitive-read detector does not flag a clean one-pass paged file read", () => {
  const config = getDefaultConfig().detectors.repetitiveRead;
  const events: WatchdogToolEvent[] = [];

  for (let index = 0; index < 20; index++) {
    events.push(makeRead(index, "src/huge-file.rs", 1 + index * 200, 200));
  }

  const candidate = makeRead(20, "src/huge-file.rs", 4001, 200);
  const finding = evaluateRepetitiveRead(
    buildSnapshot(events, candidate),
    config,
  );

  expect(finding).toBeNull();
});

test("repetitive-read detector does not flag broad exploration across many files", () => {
  const config = getDefaultConfig().detectors.repetitiveRead;
  const events: WatchdogToolEvent[] = [];
  const paths = [
    "README.md",
    "docs/architecture.md",
    "src/lib.rs",
    "src/runtime.rs",
    "src/server.rs",
    "src/sdk.ts",
    "src/wasm.ts",
    "tickets/43.md",
    "tickets/44.md",
    "tickets/45.md",
  ];

  let index = 0;
  for (const path of paths) {
    events.push(makeRead(index++, path, 1, 200));
    events.push(makeGrep(index++, "."));
  }

  const candidate = makeRead(index, "src/runtime.rs", 201, 200);
  const finding = evaluateRepetitiveRead(
    buildSnapshot(events, candidate),
    config,
  );

  expect(finding).toBeNull();
});
