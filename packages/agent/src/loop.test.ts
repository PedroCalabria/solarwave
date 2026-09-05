import { fakeToolCallingModel, failingModel, type FakeTurn } from "@solarwave/ai";
import { describe, expect, it } from "vitest";
import type { ScriptCriterion } from "./criteria";
import { runConversation, type Responder } from "./loop";

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

/** A lead that says the same thing to everything, so tests drive the agent only. */
const alwaysReplies = (text = "Sim."): Responder => async () => text;
const hangsUp: Responder = async () => null;

const run = (turns: FakeTurn[], respond: Responder = alwaysReplies(), over = {}) =>
  runConversation({
    model: fakeToolCallingModel(turns),
    criteria: CRITERIA,
    language: "pt",
    respond,
    ...over,
  });

const answerAll: FakeTurn = {
  text: "Obrigado pelas respostas.",
  toolCalls: [
    { name: "record_answer", input: { criterion_key: "homeowner", value: "true" } },
    { name: "record_answer", input: { criterion_key: "monthly_bill", value: "480" } },
    { name: "record_answer", input: { criterion_key: "roof_type", value: "ceramic" } },
  ],
};

describe("runConversation", () => {
  it("accumulates both sides in the transcript shape scoring already consumes", async () => {
    const result = await run(
      [{ text: "Olá, sou o assistente virtual da Soltera." }, { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] }],
      alwaysReplies("Pode falar."),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transcript).toEqual([
      { who: "ai", text: "Olá, sou o assistente virtual da Soltera." },
      { who: "lead", text: "Pode falar." },
    ]);
  });

  it("records live answers and reports them as advisory", async () => {
    const result = await run([answerAll, { toolCalls: [{ name: "end_call", input: { reason: "enough_information" } }] }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.liveAnswers).toEqual([
      { criterionKey: "homeowner", value: "true" },
      { criterionKey: "monthly_bill", value: "480" },
      { criterionKey: "roof_type", value: "ceramic" },
    ]);
  });

  it("ignores a malformed record_answer rather than guessing at it", async () => {
    const result = await run([
      { toolCalls: [{ name: "record_answer", input: { value: "true" } }] },
      { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] },
    ]);

    expect(result.ok && result.value.liveAnswers).toEqual([]);
  });

  describe("outcome mapping", () => {
    it("maps a complete answered call to answered_complete", async () => {
      const result = await run([answerAll, { toolCalls: [{ name: "end_call", input: { reason: "enough_information" } }] }]);

      expect(result.ok && result.value.outcome).toBe("answered_complete");
    });

    it("maps an incomplete call to answered_incomplete, which retries like no answer", async () => {
      const result = await run([{ text: "Alô?" }, { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] }]);

      expect(result.ok && result.value.outcome).toBe("answered_incomplete");
    });

    it("maps a failed blocking criterion to answered_complete, not to a retry", async () => {
      // A renter is disqualified whatever the other answers say, exactly as
      // scoreLead treats failedBlocking. Retrying would call them back to
      // confirm they still rent.
      const result = await run([
        {
          text: "Entendo, obrigado.",
          toolCalls: [
            { name: "record_answer", input: { criterion_key: "homeowner", value: "false" } },
            { name: "end_call", input: { reason: "blocking_failed" } },
          ],
        },
      ]);

      expect(result.ok && result.value.outcome).toBe("answered_complete");
    });

    it("maps a hostile lead to abusive, which disqualifies without retry", async () => {
      const result = await run([{ text: "Peço desculpas, vou encerrar." , toolCalls: [{ name: "end_call", input: { reason: "hostile" } }] }]);

      expect(result.ok && result.value.outcome).toBe("abusive");
    });

    it("maps a minor to minor_answered, which retries", async () => {
      const result = await run([{ toolCalls: [{ name: "flag_minor", input: {} }, { name: "end_call", input: { reason: "minor" } }] }]);

      expect(result.ok && result.value.outcome).toBe("minor_answered");
      expect(result.ok && result.value.minorFlagged).toBe(true);
    });

    it("ends on flag_minor even when the agent forgets to end the call", async () => {
      const result = await run([{ text: "Obrigado, vou encerrar.", toolCalls: [{ name: "flag_minor", input: {} }] }]);

      expect(result.ok && result.value.outcome).toBe("minor_answered");
      expect(result.ok && result.value.turnsUsed).toBe(1);
    });

    it("maps a requested callback to answered_incomplete and keeps the time verbatim", async () => {
      const result = await run([
        {
          toolCalls: [
            { name: "request_callback", input: { preferred_time: "depois das 18h" } },
            { name: "end_call", input: { reason: "callback_requested" } },
          ],
        },
      ]);

      expect(result.ok && result.value.outcome).toBe("answered_incomplete");
      expect(result.ok && result.value.requestedCallback).toBe("depois das 18h");
    });

    it("treats a lead who hangs up as an incomplete call", async () => {
      const result = await run([{ text: "Olá!" }], hangsUp);

      expect(result.ok && result.value.outcome).toBe("answered_incomplete");
      expect(result.ok && result.value.endedReason).toBe("lead_declined");
    });
  });

  describe("opt-out", () => {
    it("ends the call the moment mark_opt_out is called", async () => {
      const result = await run([
        { text: "Entendido, não ligaremos mais.", toolCalls: [{ name: "mark_opt_out", input: {} }] },
        { text: "E sobre o telhado?" },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.outcome).toBe("opt_out");
      expect(result.value.optedOut).toBe(true);
      expect(result.value.turnsUsed).toBe(1);
    });

    it("asks no further question after an opt-out", async () => {
      const result = await run([
        { text: "Certo, retiro o senhor da lista.", toolCalls: [{ name: "mark_opt_out", input: {} }] },
        { text: "Só mais uma pergunta rápida?" },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transcript.filter((t) => t.who === "ai")).toHaveLength(1);
      expect(result.value.transcript.map((t) => t.text).join(" ")).not.toContain("mais uma pergunta");
    });

    it("outranks an unanswered blocking criterion", async () => {
      // Nothing was answered, so the call is materially incomplete — and it is
      // still terminal, never a retry (spec section 6).
      const result = await run([{ toolCalls: [{ name: "mark_opt_out", input: {} }] }]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.liveAnswers).toEqual([]);
      expect(result.value.outcome).toBe("opt_out");
    });

    it("outranks a different reason the agent gave in the same turn", async () => {
      const result = await run([
        {
          toolCalls: [
            { name: "mark_opt_out", input: {} },
            { name: "end_call", input: { reason: "enough_information" } },
          ],
        },
      ]);

      expect(result.ok && result.value.endedReason).toBe("opt_out");
      expect(result.ok && result.value.outcome).toBe("opt_out");
    });
  });

  describe("the turn budget", () => {
    it("caps a conversation that never ends", async () => {
      const result = await run([{ text: "E mais uma coisa..." }], alwaysReplies(), { maxTurns: 4 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.turnsUsed).toBe(4);
      expect(result.value.cappedOut).toBe(true);
      expect(result.value.outcome).toBe("answered_incomplete");
    });

    it("injects the wrap-up before the cap rather than cutting the call off", async () => {
      const result = await run([{ text: "Falando sem parar." }], alwaysReplies(), { maxTurns: 3 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The wrap-up turn consumes no lead reply, so the lead speaks once fewer
      // than the agent did.
      const leadTurns = result.value.transcript.filter((t) => t.who === "lead").length;
      const agentTurns = result.value.transcript.filter((t) => t.who === "ai").length;
      expect(agentTurns - leadTurns).toBe(2);
    });

    it("wraps up as soon as there is nothing left worth asking", async () => {
      const result = await run([answerAll, { text: "Obrigado, um especialista entra em contato." }], alwaysReplies(), {
        maxTurns: 12,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Everything was recorded on turn 1, so the loop wrapped up immediately
      // instead of spending the remaining ten turns.
      expect(result.value.turnsUsed).toBeLessThanOrEqual(3);
    });

    it("reports a capped call with everything answered as complete", async () => {
      const result = await run([answerAll, { text: "..." }, { text: "..." }], alwaysReplies(), { maxTurns: 3 });

      expect(result.ok && result.value.cappedOut).toBe(true);
      expect(result.ok && result.value.outcome).toBe("answered_complete");
    });
  });

  describe("a turn that says nothing out loud", () => {
    it("does not consume a lead reply", async () => {
      // Found by the first real eval run: a tool-call-only turn was still
      // asking the persona for a reply, so the transcript grew two lead turns
      // in a row and the agent, reading it back, repeated its own greeting.
      let asked = 0;
      const respond: Responder = async () => {
        asked += 1;
        return "Sim.";
      };

      const result = await run(
        [
          { toolCalls: [{ name: "record_answer", input: { criterion_key: "homeowner", value: "true" } }] },
          { text: "Obrigado. Qual o valor da conta?" },
          { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] },
        ],
        respond,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(asked).toBe(1);
    });

    it("never puts two lead turns next to each other", async () => {
      const result = await run(
        [
          { toolCalls: [{ name: "record_answer", input: { criterion_key: "homeowner", value: "true" } }] },
          { text: "E o telhado?" },
          { toolCalls: [{ name: "end_call", input: { reason: "incomplete" } }] },
        ],
        alwaysReplies("Sim."),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const turns = result.value.transcript;
      for (let i = 1; i < turns.length; i += 1) {
        expect(turns[i]!.who).not.toBe(turns[i - 1]!.who);
      }
    });

    it("still counts the turn, so a silent model stays bounded by the cap", async () => {
      const result = await run([{ toolCalls: [] }], alwaysReplies(), { maxTurns: 3 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.turnsUsed).toBe(3);
      expect(result.value.transcript).toEqual([]);
    });
  });

  it("returns the model error with whatever transcript it had", async () => {
    const result = await runConversation({
      model: failingModel(429),
      criteria: CRITERIA,
      language: "pt",
      respond: alwaysReplies(),
      maxTurns: 3,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("model");
    expect(result.error.error.kind).toBe("rate_limited");
    expect(result.error.transcript).toEqual([]);
  });
});
