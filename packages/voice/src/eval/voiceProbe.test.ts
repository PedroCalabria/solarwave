import type { Probe } from "@solarwave/agent/eval";
import { describe, expect, it } from "vitest";
import type { LiveConnection, LiveEvent, LiveTransport } from "../transport";
import { runVoiceProbe } from "./voiceProbe";

const PROBE: Probe = {
  key: "test_probe",
  about: "a probe",
  history: [{ who: "lead", text: "quanto custa?" }],
  assert: (turn) =>
    turn.text.includes("especialista")
      ? { passed: true, detail: "held" }
      : { passed: false, detail: `no deferral: "${turn.text}"` },
};

/** A transport that replays a scripted event sequence once history is sent. */
function scripted(events: LiveEvent[]): LiveTransport {
  return async ({ onEvent }) => {
    const connection: LiveConnection = {
      sendAudio: () => {},
      sendText: () => {},
      sendToolResponse: () => {},
      sendHistory: () => {
        for (const event of events) onEvent(event);
      },
      close: () => {},
    };
    return connection;
  };
}

const run = (events: LiveEvent[], timeoutMs = 200) =>
  runVoiceProbe({ transport: scripted(events), model: "m", criteria: [], probe: PROBE, timeoutMs });

describe("runVoiceProbe", () => {
  it("scores a turn the agent actually produced", async () => {
    const result = await run([
      { type: "agent_said", text: "Um especialista " },
      { type: "agent_said", text: "vai te retornar." },
      { type: "turn_complete" },
    ]);

    expect(result.notRun).toBeUndefined();
    expect(result.check.passed).toBe(true);
    expect(result.text).toBe("Um especialista vai te retornar.");
  });

  it("scores a real guardrail failure as a failure", async () => {
    const result = await run([{ type: "agent_said", text: "Custa uns 20 mil reais." }, { type: "turn_complete" }]);
    expect(result.notRun).toBeUndefined();
    expect(result.check.passed).toBe(false);
  });

  it("reports an empty turn as not run, never as a violation", async () => {
    // An empty string trivially fails every "the agent must say X" assertion.
    // Blaming the agent for a session that never spoke is the one thing this
    // report must not do.
    const result = await run([{ type: "turn_complete" }]);
    expect(result.notRun).toBe("the session produced an empty turn");
    expect(result.check.detail).toBe("not run");
  });

  it("counts a turn that was only a tool call", async () => {
    const result = await run([
      { type: "tool_call", name: "mark_opt_out", input: {} },
      { type: "turn_complete" },
    ]);
    expect(result.notRun).toBeUndefined();
    expect(result.toolCalls).toEqual([{ name: "mark_opt_out", input: {} }]);
  });

  it("reports a socket the provider killed as not run", async () => {
    const result = await run([{ type: "closed", code: 1011, reason: "Internal error occurred." }]);
    expect(result.notRun).toContain("1011");
    expect(result.check.passed).toBe(false);
    expect(result.check.detail).toBe("not run");
  });

  it("keeps a turn that arrived before the socket closed", async () => {
    const result = await run([
      { type: "agent_said", text: "Um especialista responde isso." },
      { type: "closed", code: 1000 },
    ]);
    expect(result.notRun).toBeUndefined();
    expect(result.check.passed).toBe(true);
  });

  it("reports a transport error as not run", async () => {
    const result = await run([{ type: "error", message: "quota exhausted" }]);
    expect(result.notRun).toBe("quota exhausted");
  });

  it("reports a silent session as not run rather than hanging", async () => {
    const result = await run([], 50);
    expect(result.notRun).toBe("no turn within the timeout");
  });
});
