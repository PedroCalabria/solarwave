import { buildCallScript, toFunctionDeclarations, type ScriptCriterion } from "@solarwave/agent";
import type { Check, Probe } from "@solarwave/agent/eval";
import type { LiveEvent, LiveTransport } from "../transport";

/**
 * One guardrail probe, run against the model that will actually speak
 * (voice-bridge task 12).
 *
 * Change 3 said plainly that a green text suite does not certify the voice
 * agent, and left the gap open. This closes it as far as it can be closed
 * cheaply: the probes run against the native-audio model, with the voice frame
 * and the real tool declarations, and the assertions read the model's own
 * output transcription.
 *
 * Deliberately driven by TEXT turns rather than synthesised speech. The probes
 * test what the agent SAYS when provoked, not whether a microphone was heard,
 * and text keeps the pass free of the acoustic variables that make an audio
 * session flaky. What it therefore does NOT cover is stated rather than
 * papered over: prosody, latency, and anything that only goes wrong once real
 * audio is involved.
 */

export type VoiceProbeRun = {
  probe: Probe;
  check: Check;
  text: string;
  toolCalls: { name: string; input: unknown }[];
  /** Set when the probe could not be run at all, so it is not scored as a failure. */
  notRun?: string;
  /** Wall-clock cost, for the budget line in the report. */
  seconds: number;
};

export type RunVoiceProbeInput = {
  transport: LiveTransport;
  model: string;
  criteria: ScriptCriterion[];
  probe: Probe;
  /** A session that produces nothing by here is reported as not run. */
  timeoutMs?: number;
};

export async function runVoiceProbe({
  transport,
  model,
  criteria,
  probe,
  timeoutMs = 45_000,
}: RunVoiceProbeInput): Promise<VoiceProbeRun> {
  const startedAt = Date.now();
  const script = buildCallScript({ criteria, language: "pt", leadName: "Beatriz", medium: "voice" });

  let text = "";
  const toolCalls: { name: string; input: unknown }[] = [];
  let settle: (outcome: { notRun?: string }) => void;
  const finished = new Promise<{ notRun?: string }>((resolve) => {
    settle = resolve;
  });

  const timer = setTimeout(() => settle({ notRun: "no turn within the timeout" }), timeoutMs);

  const handle = (event: LiveEvent) => {
    switch (event.type) {
      case "setup_complete":
        break;
      case "agent_said":
        text += event.text;
        break;
      case "tool_call":
        toolCalls.push({ name: event.name, input: event.input });
        break;
      case "turn_complete":
        // A turn that produced nothing is not a guardrail failure. The
        // assertions read the agent's words, and an empty string trivially
        // "contains no disclosure" — reporting that as a violation blames the
        // agent for a session that never spoke. Measured: on a back-to-back
        // pass, several sessions completed a turn in under two seconds with no
        // text and no tool call at all.
        settle(text.length > 0 || toolCalls.length > 0 ? {} : { notRun: "the session produced an empty turn" });
        break;
      case "error":
        settle({ notRun: event.message });
        break;
      case "closed":
        // A close before a turn is a refusal, not a guardrail failure. A close
        // after one is just the socket going away, and the turn still counts.
        settle(text.length > 0 || toolCalls.length > 0 ? {} : { notRun: closeReason(event) });
        break;
      default:
        break;
    }
  };

  let connection;
  try {
    connection = await transport({
      model,
      systemInstruction: script.system,
      functionDeclarations: toFunctionDeclarations(script.order.map((c) => c.key)),
      onEvent: handle,
    });
  } catch (error) {
    clearTimeout(timer);
    return {
      probe,
      check: { passed: false, detail: "not run" },
      text: "",
      toolCalls: [],
      notRun: error instanceof Error ? error.message : String(error),
      seconds: elapsed(startedAt),
    };
  }

  // The whole provocation goes in one turn list, so the agent answers the last
  // lead line with everything before it already in context.
  connection.sendHistory(
    probe.history.length > 0
      ? probe.history.map((turn) => ({ role: turn.who === "ai" ? ("model" as const) : ("user" as const), text: turn.text }))
      : [{ role: "user" as const, text: "(the lead has answered the phone)" }],
  );

  const outcome = await finished;
  clearTimeout(timer);
  connection.close();

  if (outcome.notRun) {
    return {
      probe,
      check: { passed: false, detail: "not run" },
      text,
      toolCalls,
      notRun: outcome.notRun,
      seconds: elapsed(startedAt),
    };
  }

  return {
    probe,
    // The assertions were written against a text turn and read only `text` and
    // `toolCalls`, which is exactly what a transcribed voice turn provides.
    check: probe.assert({ text, toolCalls: toolCalls.map((c) => ({ ...c, id: "" })) }),
    text,
    toolCalls,
    seconds: elapsed(startedAt),
  };
}

function closeReason(event: Extract<LiveEvent, { type: "closed" }>): string {
  return `socket closed ${event.code ?? "?"} ${event.reason ?? ""}`.trim();
}

function elapsed(startedAt: number): number {
  return Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
}
