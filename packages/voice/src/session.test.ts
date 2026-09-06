import type { ScriptCriterion } from "@solarwave/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CALL_SECONDS,
  DEFAULT_WRAP_UP_SECONDS,
  OPENING_CUE,
  WRAP_UP_INSTRUCTION,
  startVoiceSession,
  type VoiceCallResult,
  type VoiceSessionEvent,
} from "./session";
import type { LiveConnection, LiveEvent, LiveTransport } from "./transport";

const criterion = (over: Partial<ScriptCriterion> & { key: string }): ScriptCriterion => ({
  label: over.key,
  questionPt: `pergunta ${over.key}`,
  questionEn: `question ${over.key}`,
  type: "boolean",
  options: null,
  expectedValue: "true",
  weight: 10,
  blocking: false,
  active: true,
  sortOrder: 0,
  ...over,
});

const CRITERIA: ScriptCriterion[] = [
  criterion({ key: "homeowner", weight: 30, blocking: true }),
  criterion({ key: "monthly_bill", type: "numeric", expectedValue: ">= 300", weight: 25 }),
  criterion({ key: "roof_type", type: "enum", options: "ceramic|metal", expectedValue: "ceramic", weight: 20 }),
];

/**
 * A Live socket that does nothing until a test tells it to
 * (voice-bridge task 6.6).
 *
 * The whole point of the transport interface is that the parts worth testing —
 * timers, transcript accumulation, tool precedence, the end reason — can be
 * driven deterministically. Nothing here touches a network.
 */
function fakeTransport() {
  const sentText: string[] = [];
  const sentHistory: { role: string; text: string }[][] = [];
  const sentAudio: Int16Array[] = [];
  const toolResponses: { id?: string; name: string; output: Record<string, unknown> }[] = [];
  const captured = { systemInstruction: "", functionDeclarations: [] as { name: string }[] };
  let closed = false;
  let emit: ((event: LiveEvent) => void) | null = null;

  const transport: LiveTransport = async ({ onEvent, systemInstruction, functionDeclarations }) => {
    emit = onEvent;
    captured.systemInstruction = systemInstruction;
    captured.functionDeclarations = functionDeclarations;
    const connection: LiveConnection = {
      sendAudio: (pcm) => sentAudio.push(pcm),
      sendText: (text) => sentText.push(text),
      sendHistory: (turns) => sentHistory.push(turns),
      sendToolResponse: (calls) => toolResponses.push(...calls),
      close: () => {
        closed = true;
      },
    };
    return connection;
  };

  return Object.assign(transport, {
    sentText,
    sentHistory,
    sentAudio,
    toolResponses,
    // A method, not a getter: Object.assign copies a getter's VALUE, so
    // `get closed()` here would freeze at false and quietly pass.
    isClosed: () => closed,
    emit(event: LiveEvent) {
      if (!emit) throw new Error("the session has not connected yet");
      emit(event);
    },
    captured,
  });
}

async function start(over: Partial<Parameters<typeof startVoiceSession>[0]> = {}) {
  const transport = fakeTransport();
  const events: VoiceSessionEvent[] = [];
  const session = await startVoiceSession({
    transport,
    model: "test-model",
    criteria: CRITERIA,
    language: "pt",
    leadName: "Ana",
    onEvent: (e) => events.push(e),
    ...over,
  });
  transport.emit({ type: "open" });
  transport.emit({ type: "setup_complete" });
  return { transport, events, session };
}

const ended = (events: VoiceSessionEvent[]): VoiceCallResult | undefined =>
  events.find((e): e is Extract<VoiceSessionEvent, { type: "ended" }> => e.type === "ended")?.result;

const latestTranscript = (events: VoiceSessionEvent[]) =>
  [...events].reverse().find((e): e is Extract<VoiceSessionEvent, { type: "transcript" }> => e.type === "transcript")
    ?.turns ?? [];

const answerAll = (transport: ReturnType<typeof fakeTransport>) => {
  for (const c of CRITERIA) {
    transport.emit({ type: "tool_call", id: c.key, name: "record_answer", input: { criterion_key: c.key, value: "true" } });
  }
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("session setup", () => {
  it("configures the voice script and the registry tools", async () => {
    const { transport } = await start();
    expect(transport.captured.systemInstruction).toContain("This is a live phone call");
    expect(transport.captured.functionDeclarations.map((d) => d.name)).toEqual([
      "record_answer",
      "request_callback",
      "mark_opt_out",
      "flag_minor",
      "end_call",
    ]);
  });

  it("cues the agent to open the call", async () => {
    // The frame tells it to speak first, but a Live session generates nothing
    // until something arrives — measured in the change 4 spike.
    const { transport } = await start();
    expect(transport.sentText).toEqual([OPENING_CUE]);
  });

  it("forwards lead audio at the configured rate", async () => {
    const { transport, session } = await start();
    session.sendAudio(Int16Array.of(1, 2, 3));
    expect(transport.sentAudio).toHaveLength(1);
  });
});

describe("transcript", () => {
  it("accumulates fragments into one turn per speaker", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "Olá, " });
    transport.emit({ type: "agent_said", text: "aqui é a Ana." });
    transport.emit({ type: "lead_said", text: "Oi." });
    expect(latestTranscript(events)).toEqual([
      { who: "ai", text: "Olá, aqui é a Ana." },
      { who: "lead", text: "Oi." },
    ]);
  });

  it("starts a new turn after the model finishes one", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "Primeira." });
    transport.emit({ type: "turn_complete" });
    transport.emit({ type: "agent_said", text: "Segunda." });
    expect(latestTranscript(events).map((t) => t.text)).toEqual(["Primeira.", "Segunda."]);
  });

  it("ignores an empty fragment", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "" });
    expect(latestTranscript(events)).toEqual([]);
  });
});

describe("barge-in", () => {
  it("keeps the interrupted turn in full and marks it", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "O preço médio de um sistema é" });
    transport.emit({ type: "interrupted" });

    const turns = latestTranscript(events);
    // Kept, not truncated: the judge has to be able to see what the model said.
    expect(turns).toEqual([{ who: "ai", text: "O preço médio de um sistema é", interrupted: true }]);
    expect(events.some((e) => e.type === "interrupted")).toBe(true);
  });

  it("does not fold the next agent turn into the interrupted one", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "Uma frase cortada" });
    transport.emit({ type: "interrupted" });
    transport.emit({ type: "agent_said", text: "Desculpe, pode repetir?" });
    expect(latestTranscript(events)).toHaveLength(2);
  });
});

describe("tool calls", () => {
  it("answers every tool call so the model does not reissue it", async () => {
    const { transport } = await start();
    transport.emit({ type: "tool_call", id: "c1", name: "record_answer", input: { criterion_key: "homeowner", value: "true" } });
    expect(transport.toolResponses).toEqual([{ id: "c1", name: "record_answer", output: { ok: true } }]);
  });

  it("records answers and reports them when the call ends", async () => {
    const { transport, events } = await start();
    answerAll(transport);
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "enough_information" } });
    expect(ended(events)?.liveAnswers.map((a) => a.criterionKey)).toEqual([
      "homeowner",
      "monthly_bill",
      "roof_type",
    ]);
    expect(ended(events)?.outcome).toBe("answered_complete");
  });

  it("tolerates a tool call missing its required argument", async () => {
    // Measured: the model calls end_call with no arguments at all.
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "end_call", input: {} });
    expect(ended(events)?.endedReason).toBe("incomplete");
    expect(ended(events)?.outcome).toBe("answered_incomplete");
  });

  it("lets opt-out outrank a stated end reason", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "mark_opt_out", input: {} });
    const result = ended(events);
    expect(result?.endedReason).toBe("opt_out");
    expect(result?.outcome).toBe("opt_out");
    expect(result?.optedOut).toBe(true);
  });

  it("ends the call when a minor is flagged", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "flag_minor", input: {} });
    expect(ended(events)?.outcome).toBe("minor_answered");
  });

  it("ends without escalation when the agent reports a hostile lead", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "hostile" } });
    expect(ended(events)?.outcome).toBe("abusive");
  });

  it("captures a requested callback without ending the call", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "request_callback", input: { preferred_time: "depois das 18h" } });
    expect(ended(events)).toBeUndefined();
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "callback_requested" } });
    expect(ended(events)?.requestedCallback).toBe("depois das 18h");
    expect(ended(events)?.outcome).toBe("answered_incomplete");
  });

  it("closes the provider connection when the call ends", async () => {
    const { transport } = await start();
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "enough_information" } });
    expect(transport.isClosed()).toBe(true);
  });
});

describe("the call budget", () => {
  it("waits for the turn to finish before injecting the wrap-up", async () => {
    // Measured: pushing client content mid-generation kills the socket with a
    // 1011, so the timer may not send on its own.
    const { transport } = await start();
    transport.emit({ type: "agent_said", text: "ainda falando" });
    vi.advanceTimersByTime(DEFAULT_WRAP_UP_SECONDS * 1000);
    expect(transport.sentText).toEqual([OPENING_CUE]);

    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(1000);
    expect(transport.sentText).toEqual([OPENING_CUE, WRAP_UP_INSTRUCTION]);
  });

  it("injects the wrap-up immediately when the model is idle", async () => {
    const { transport } = await start();
    transport.emit({ type: "agent_said", text: "pergunta" });
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(DEFAULT_WRAP_UP_SECONDS * 1000 + 1000);
    expect(transport.sentText).toEqual([OPENING_CUE, WRAP_UP_INSTRUCTION]);
  });

  it("injects it exactly once", async () => {
    const { transport } = await start();
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(DEFAULT_WRAP_UP_SECONDS * 1000 + 1000);
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(DEFAULT_WRAP_UP_SECONDS * 1000 + 1000);
    expect(transport.sentText.filter((t) => t === WRAP_UP_INSTRUCTION)).toHaveLength(1);
  });

  it("wraps up early once there is enough information", async () => {
    const { transport } = await start();
    answerAll(transport);
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(1000);
    // The wrap-up timer never fired; the budget was closed by the answers.
    expect(transport.sentText).toEqual([OPENING_CUE, WRAP_UP_INSTRUCTION]);
  });

  it("does not wrap up early while a blocking criterion is unanswered", async () => {
    const { transport } = await start();
    transport.emit({ type: "tool_call", name: "record_answer", input: { criterion_key: "monthly_bill", value: "450" } });
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(1000);
    expect(transport.sentText).toEqual([OPENING_CUE]);
  });

  it("hard-stops a call the agent never closed", async () => {
    const { transport, events } = await start();
    vi.advanceTimersByTime(DEFAULT_MAX_CALL_SECONDS * 1000);
    const result = ended(events);
    expect(result?.endedReason).toBe("incomplete");
    expect(result?.outcome).toBe("answered_incomplete");
    expect(result?.cutOff).toBe(true);
    expect(transport.isClosed()).toBe(true);
  });

  it("reports enough_information when the hard stop hits a satisfied call", async () => {
    const { transport, events } = await start({ wrapUpSeconds: 1000 });
    answerAll(transport);
    vi.advanceTimersByTime(DEFAULT_MAX_CALL_SECONDS * 1000);
    expect(ended(events)?.outcome).toBe("answered_complete");
  });

  it("still honours an opt-out when the hard stop fires", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "tool_call", name: "mark_opt_out", input: {} });
    expect(ended(events)?.endedReason).toBe("opt_out");
  });

  it("honours configured timers", async () => {
    const { transport, events } = await start({ wrapUpSeconds: 5, maxCallSeconds: 10 });
    transport.emit({ type: "turn_complete" });
    vi.advanceTimersByTime(5000 + 1000);
    expect(transport.sentText).toContain(WRAP_UP_INSTRUCTION);
    vi.advanceTimersByTime(5000);
    expect(ended(events)).toBeDefined();
  });
});

describe("losing the transport", () => {
  it("ends the call with what it had earned when the socket errors", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "meia frase" });
    transport.emit({ type: "error", message: "1011 Internal error occurred." });
    const result = ended(events);
    expect(result?.cutOff).toBe(true);
    expect(result?.outcome).toBe("answered_incomplete");
    // The conversation so far survives the failure.
    expect(result?.transcript).toHaveLength(1);
  });

  it("keeps a resolved ending when the socket closes after end_call", async () => {
    const { transport, events } = await start();
    answerAll(transport);
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "enough_information" } });
    transport.emit({ type: "closed", code: 1000 });
    // One ending, not two, and it is the agent's.
    expect(events.filter((e) => e.type === "ended")).toHaveLength(1);
    expect(ended(events)?.cutOff).toBe(false);
  });

  it("closes the attempt when the phone hangs up", async () => {
    const { transport, events } = await start();
    transport.emit({ type: "agent_said", text: "alô?" });
    transport.emit({ type: "closed", code: 1006 });
    expect(ended(events)?.outcome).toBe("answered_incomplete");
  });

  it("ignores audio sent after the call ended", async () => {
    const { transport, session } = await start();
    transport.emit({ type: "tool_call", name: "end_call", input: { reason: "enough_information" } });
    session.sendAudio(Int16Array.of(1, 2, 3));
    expect(transport.sentAudio).toHaveLength(0);
  });
});
