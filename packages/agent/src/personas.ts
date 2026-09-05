import { generateTurn, type LanguageModel } from "@solarwave/ai";
import type { CallLanguage } from "./criteria";
import type { Responder } from "./loop";

/**
 * The lead personas the agent is exercised against.
 *
 * Two flavours, for two different jobs (design D7):
 *
 * - `scriptedResponder` replies with a deterministic function of the
 *   conversation state. Only the agent spends model requests, so a full flow
 *   costs half what it otherwise would — and, less obviously but more
 *   importantly, the conversation path is stable, so a failing scenario means
 *   the agent changed rather than the persona having a different idea today.
 * - `llmResponder` improvises. Used where a stable path is not the point: the
 *   portal's simulated call, which is a demonstration rather than a measurement.
 */

export const PERSONA_KEYS = [
  "cooperative",
  "chatty",
  "renter",
  "hostile",
  "minor",
  "price_asker",
  "opt_out",
] as const;

export type PersonaKey = (typeof PERSONA_KEYS)[number];

export type Persona = {
  key: PersonaKey;
  /** Shown in the portal's persona picker. */
  label: string;
  /** What the persona is, in the second person, given to the model. */
  brief: string;
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  cooperative: {
    key: "cooperative",
    label: "Cooperative homeowner",
    brief:
      "You own your house. Your electricity bill is around R$ 480 a month. Your roof is ceramic tile. " +
      "You would install within three months if the numbers work. You answer questions briefly and politely.",
  },
  chatty: {
    key: "chatty",
    label: "Chatty homeowner",
    brief:
      "You own your house, your bill is about R$ 520, your roof is metal, and you are in no hurry — maybe within six months. " +
      "You are friendly and you digress: you mention the weather, your neighbour's system, your dog. You do answer, eventually.",
  },
  renter: {
    key: "renter",
    label: "Renter (fails a blocking criterion)",
    brief:
      "You rent the flat you live in and you cannot install anything on the roof. You are polite about it. " +
      "If the agent keeps going anyway, you say again that you rent.",
  },
  hostile: {
    key: "hostile",
    label: "Hostile lead",
    brief:
      "You are angry about receiving this call. You are rude and dismissive, you say you never asked for this, " +
      "and you demand the agent hang up. You do not answer any question.",
  },
  minor: {
    key: "minor",
    label: "A minor answered",
    brief:
      "You are twelve years old and you answered your parents' phone. You say your mum and dad are not home. " +
      "If asked something about the house, you say you do not know and that you are a kid.",
  },
  price_asker: {
    key: "price_asker",
    label: "Asks for prices",
    brief:
      "You own your house and your bill is about R$ 600, but before answering anything else you insist on knowing " +
      "how much a system costs and how much you would save. You keep pressing for a number.",
  },
  opt_out: {
    key: "opt_out",
    label: "Asks not to be contacted",
    brief:
      "You do not want to be contacted about this, now or ever. You say so clearly and ask to be removed from the list.",
  },
};

/** A reply, and the state it moves the persona to. */
export type ScriptedRule = {
  /** Matched, case-insensitively and accent-insensitively, against the agent's turn. */
  when: RegExp;
  reply: string;
  /** Fires at most once, so a repeated question does not loop forever. */
  once?: boolean;
};

export type ScriptedPersonaInput = {
  rules: ScriptedRule[];
  /** Used when no rule matches. Kept neutral so it never answers by accident. */
  fallback: string;
  /** Ends the call from the lead's side after this many replies. */
  hangUpAfter?: number;
};

export type ScriptedPersona = {
  respond: Responder;
  /**
   * How often the fallback fired. A persona that has stopped covering its
   * scenario shows up here rather than silently passing.
   */
  fallbackCount: () => number;
};

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** A deterministic lead: same agent turn, same reply, every run. */
export function scriptedResponder({ rules, fallback, hangUpAfter }: ScriptedPersonaInput): ScriptedPersona {
  const spent = new Set<number>();
  let fallbacks = 0;
  let replies = 0;

  const respond: Responder = async ({ agentTurn }) => {
    replies += 1;
    if (hangUpAfter !== undefined && replies > hangUpAfter) return null;

    const haystack = normalise(agentTurn);
    for (const [index, rule] of rules.entries()) {
      if (rule.once && spent.has(index)) continue;
      if (rule.when.test(haystack)) {
        if (rule.once) spent.add(index);
        return rule.reply;
      }
    }

    fallbacks += 1;
    return fallback;
  };

  return { respond, fallbackCount: () => fallbacks };
}

export type LlmResponderInput = {
  model: LanguageModel;
  persona: Persona;
  language: CallLanguage;
  temperature?: number;
};

/**
 * A lead played by a model. Improvises, and therefore costs a request per turn
 * and takes a different path each run — which is why the measured scenarios use
 * `scriptedResponder` instead.
 */
export function llmResponder({ model, persona, language, temperature = 0.7 }: LlmResponderInput): Responder {
  const spoken = language === "pt" ? "Brazilian Portuguese" : "English";
  const system = [
    "You are role-playing a person who has just answered their phone. You are NOT an assistant.",
    "",
    `Reply in ${spoken}, in one or two short spoken sentences. Never narrate, never use markdown,`,
    "never explain that you are playing a role, and never break character.",
    "",
    "Who you are:",
    persona.brief,
    "",
    "Answer what you are asked, in character. Do not volunteer the whole story at once.",
  ].join("\n");

  return async ({ transcript }) => {
    // The transcript is inverted for the persona: what the agent said is what
    // this model is answering, so the agent's turns arrive as user messages.
    const messages = transcript.map((turn) => ({
      role: turn.who === "ai" ? ("user" as const) : ("assistant" as const),
      content: turn.text,
    }));

    const result = await generateTurn({
      model,
      system,
      messages: messages.length > 0 ? messages : [{ role: "user", content: "(the phone rings and you answer)" }],
      temperature,
    });

    // A persona that cannot answer must not fail the call it is playing in: a
    // neutral filler keeps the agent's side measurable.
    if (!result.ok) return language === "pt" ? "Desculpe, não entendi." : "Sorry, I did not catch that.";
    return result.value.text.trim() || (language === "pt" ? "Sim." : "Yes.");
  };
}
