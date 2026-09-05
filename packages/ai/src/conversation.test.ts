import { tool, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateTurn } from "./conversation";
import { isRetryable, needsOperatorAction } from "./generate";
import { fakeToolCallingModel, failingModel, type FakeCall } from "./testing";

/** Tools carry no `execute`: the loop interprets the calls itself (design D1). */
const tools = {
  record_answer: tool({
    description: "Record what the lead answered.",
    inputSchema: z.object({ criterion_key: z.string(), value: z.string() }),
  }),
  end_call: tool({
    description: "End the call.",
    inputSchema: z.object({ reason: z.string() }),
  }),
};

const history: ModelMessage[] = [
  { role: "assistant", content: "Olá, sou o assistente virtual da Soltera." },
  { role: "user", content: "Pode falar." },
];

describe("generateTurn", () => {
  it("returns what the model said", async () => {
    const result = await generateTurn({
      model: fakeToolCallingModel([{ text: "O imóvel é seu ou alugado?" }]),
      system: "s",
      messages: history,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("O imóvel é seu ou alugado?");
      expect(result.value.toolCalls).toEqual([]);
    }
  });

  it("surfaces tool calls flattened to name and input", async () => {
    const result = await generateTurn({
      model: fakeToolCallingModel([
        {
          text: "Entendi, obrigado.",
          toolCalls: [{ name: "record_answer", input: { criterion_key: "homeowner", value: "true" } }],
        },
      ]),
      system: "s",
      messages: history,
      tools,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolCalls).toEqual([
        { name: "record_answer", input: { criterion_key: "homeowner", value: "true" }, id: expect.any(String) },
      ]);
    }
  });

  it("surfaces several tool calls from one turn", async () => {
    const result = await generateTurn({
      model: fakeToolCallingModel([
        {
          toolCalls: [
            { name: "record_answer", input: { criterion_key: "homeowner", value: "true" } },
            { name: "end_call", input: { reason: "enough_information" } },
          ],
        },
      ]),
      system: "s",
      messages: history,
      tools,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toolCalls.map((c) => c.name)).toEqual(["record_answer", "end_call"]);
  });

  it("returns the turn as messages, so the caller's history keeps the tool calls", async () => {
    // Without these, the model has no record that it already called anything
    // and repeats the same call in silence until the caller's cap runs out.
    const result = await generateTurn({
      model: fakeToolCallingModel([
        { text: "Certo.", toolCalls: [{ name: "end_call", input: { reason: "opt_out" } }] },
      ]),
      system: "s",
      messages: history,
      tools,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.value.messages)).toContain("end_call");
    expect(result.value.toolCalls[0]?.id).toBeTruthy();
  });

  it("returns empty text for a turn that is nothing but tool calls", async () => {
    const result = await generateTurn({
      model: fakeToolCallingModel([{ toolCalls: [{ name: "end_call", input: { reason: "opt_out" } }] }]),
      system: "s",
      messages: history,
      tools,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("");
  });

  it("passes the whole message history through to the model", async () => {
    const calls: FakeCall[] = [];
    await generateTurn({
      model: fakeToolCallingModel([{ text: "ok" }], calls),
      system: "s",
      messages: history,
    });

    // The caller owns the history; the adapter must not trim or reorder it.
    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("assistente virtual da Soltera");
    expect(sent).toContain("Pode falar");
  });

  it("advances through the scripted turns and repeats the last one", async () => {
    const model = fakeToolCallingModel([{ text: "first" }, { text: "second" }]);
    const call = () => generateTurn({ model, system: "s", messages: history });

    const a = await call();
    const b = await call();
    const c = await call();

    expect(a.ok && a.value.text).toBe("first");
    expect(b.ok && b.value.text).toBe("second");
    expect(c.ok && c.value.text).toBe("second");
  });

  it("honours an explicit temperature", async () => {
    const calls: FakeCall[] = [];
    // The default is 0.6 for conversation and persona; the linter passes 0.
    // Nothing observable changes in the fake, so this asserts the call is made
    // and accepted rather than the provider's behaviour.
    const result = await generateTurn({
      model: fakeToolCallingModel([{ text: "ok" }], calls),
      system: "s",
      messages: history,
      temperature: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("maps 429 to a retryable rate_limited error", async () => {
    const result = await generateTurn({
      model: failingModel(429),
      system: "s",
      messages: history,
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate_limited");
      expect(isRetryable(result.error)).toBe(true);
    }
  });

  it("maps a quota message to rate_limited rather than an account problem", async () => {
    const result = await generateTurn({
      model: failingModel(400, "You exceeded your current quota, check your plan and billing details"),
      system: "s",
      messages: history,
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate_limited");
      expect(needsOperatorAction(result.error)).toBe(false);
    }
  });

  it("maps 503 to a retryable unavailable error", async () => {
    const result = await generateTurn({
      model: failingModel(503),
      system: "s",
      messages: history,
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unavailable");
  });

  it("maps a card-on-file refusal to an account error a retry cannot fix", async () => {
    const result = await generateTurn({
      model: failingModel(403, "requires a valid credit card on file to service requests"),
      system: "s",
      messages: history,
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("account");
      expect(needsOperatorAction(result.error)).toBe(true);
      expect(isRetryable(result.error)).toBe(false);
    }
  });
});
