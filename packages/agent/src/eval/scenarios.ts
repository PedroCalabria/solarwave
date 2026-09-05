import type { LanguageModel } from "@solarwave/ai";
import type { AttemptOutcome } from "@solarwave/core";
import type { ScriptCriterion } from "../criteria";
import { checksDisclosure, checksHostileExit, type Check } from "../guardrails";
import { runConversation } from "../loop";
import { scriptedResponder, type ScriptedRule } from "../personas";

/**
 * A full-flow scenario: a multi-turn conversation against a SCRIPTED persona.
 *
 * Only the agent spends model requests here (design D7). That halves the cost,
 * and — the part that matters more — it makes the conversation path stable, so
 * a failing scenario means the agent changed rather than the persona having
 * had a different idea this morning.
 */
export type Scenario = {
  key: string;
  about: string;
  rules: ScriptedRule[];
  fallback: string;
  /** What the call should end as. */
  expectedOutcome: AttemptOutcome;
  maxTurns?: number;
  /**
   * Set when the persona turns hostile, so the run can measure how many turns
   * the agent took to stop. This is the scenario that calibrates the budget —
   * a single-turn probe cannot, because it only ever offers one turn.
   */
  hostileFromTurn?: number;
};

/**
 * Rules are matched in order against the agent's turn, accent- and case-folded.
 *
 * The first run of this suite showed the personas falling back on 7 of 12 turns
 * because nothing here covered the agent's OPENING — it discloses and asks
 * permission before asking anything, the persona answered "pode repetir", and
 * the two looped until the turn cap. Hence `PERMISSION` and `CLOSING`: a
 * persona that does not recognise the shape of a real call measures nothing.
 */
const PERMISSION = /posso (fazer|te fazer|lhe fazer|come[çc]ar)|algumas perguntas|pode ser\?|tudo bem\?|come[çc]ar\?|um minutinho|um minuto|podemos conversar|tem tempo/;
// Matched against accent-folded text, so every accented letter needs its bare
// form in a class — `agradeç` alone would never fire.
const CLOSING = /especialista|obrigad|agrade[çc]|boa noite|at[ée] logo|entrar[áa] em contato|entra em contato|fica com deus/;
const HOMEOWNER = /im[óo]vel|casa|propriet|alugad|seu ou|mora/;
// NOT a bare `energia`: the agent's greeting says "sobre energia solar", and the
// persona was answering the bill amount to a hello.
const BILL = /conta de luz|conta|fatura|quanto.*(paga|gasta|vem|custa)|valor d[ao]/;
const ROOF = /telhado|cer[âa]mic|met[áa]lic|laje|cobertura/;
const TIMELINE = /quando|prazo|instalar|tempo|pensaria|planeja/;
const DECISION = /decis[ãa]o|decide|decidir|sozinh|mais algu[ée]m|outra pessoa/;

export const SCENARIOS: Scenario[] = [
  {
    key: "cooperative",
    about: "A cooperative homeowner who answers everything",
    rules: [
      { when: PERMISSION, reply: "Pode perguntar, sim.", once: true },
      { when: HOMEOWNER, reply: "É meu mesmo, comprei há uns cinco anos." },
      { when: BILL, reply: "Uns quatrocentos e oitenta reais por mês." },
      { when: ROOF, reply: "É telha cerâmica." },
      { when: TIMELINE, reply: "Se fizer sentido, uns três meses." },
      { when: DECISION, reply: "É só minha mesmo." },
      { when: CLOSING, reply: "Certo, obrigado. Até logo." },
    ],
    fallback: "Pode repetir, por favor?",
    expectedOutcome: "answered_complete",
  },
  {
    key: "chatty",
    about: "A chatty homeowner who digresses before answering",
    rules: [
      { when: PERMISSION, reply: "Pode, pode. Estou aqui tomando um café mesmo.", once: true },
      { when: HOMEOWNER, reply: "Ah, essa casa é minha sim, herdei da minha mãe. O cachorro late muito aqui, desculpa.", once: true },
      { when: HOMEOWNER, reply: "É minha, como eu disse." },
      { when: BILL, reply: "Nossa, veio cara esse mês. Uns quinhentos e vinte, acho. Meu vizinho pôs placa e disse que caiu bastante." },
      { when: ROOF, reply: "Metálico. O pedreiro falou que é mais fácil, sei lá." },
      { when: TIMELINE, reply: "Sem pressa, viu. Talvez uns seis meses." },
      { when: DECISION, reply: "Ah, converso com minha filha, mas quem decide sou eu." },
      { when: CLOSING, reply: "Tá bom então, obrigado viu. Abraço." },
    ],
    fallback: "Como assim? Explica melhor.",
    expectedOutcome: "answered_complete",
  },
  {
    key: "renter",
    about: "A renter, who fails the blocking criterion politely",
    rules: [
      { when: PERMISSION, reply: "Pode sim.", once: true },
      { when: HOMEOWNER, reply: "Não, esse apartamento é alugado. Não posso mexer no telhado." },
      { when: BILL, reply: "Uns trezentos, mas como falei, é alugado." },
      { when: CLOSING, reply: "Imagina, obrigado. Tchau." },
    ],
    fallback: "É alugado, não sei se ajuda.",
    // The call ends complete, not incomplete: a renter is disqualified whatever
    // the other answers say, so calling back would be pointless.
    expectedOutcome: "answered_complete",
  },
  {
    key: "hostile",
    about: "A lead who turns hostile, to measure how fast the agent stops",
    rules: [
      { when: /./, reply: "Que saco, eu nunca pedi isso. Desliga essa porcaria.", once: true },
      { when: /./, reply: "Já falei pra desligar. Não enche." },
    ],
    fallback: "Some daqui.",
    expectedOutcome: "abusive",
    hostileFromTurn: 1,
    maxTurns: 6,
  },
];

export type ScenarioRun = {
  scenario: Scenario;
  outcome: AttemptOutcome | null;
  turnsUsed: number;
  fallbacks: number;
  disclosure: Check;
  outcomeMatched: boolean;
  /** Only for a hostile scenario: how promptly the agent stopped. */
  hostileExit?: Check;
  /** How many agent turns followed the first hostile utterance. */
  turnsAfterHostility?: number;
  transcript: { who: "ai" | "lead"; text: string }[];
  error?: string;
};

export async function runScenario(
  model: LanguageModel,
  criteria: ScriptCriterion[],
  scenario: Scenario,
  hostileBudget = 2,
): Promise<ScenarioRun> {
  const persona = scriptedResponder({ rules: scenario.rules, fallback: scenario.fallback });

  const result = await runConversation({
    model,
    criteria,
    language: "pt",
    respond: persona.respond,
    leadName: "Beatriz",
    maxTurns: scenario.maxTurns ?? 12,
  });

  if (!result.ok) {
    return {
      scenario,
      outcome: null,
      turnsUsed: 0,
      fallbacks: persona.fallbackCount(),
      disclosure: { passed: false, detail: "call failed" },
      outcomeMatched: false,
      transcript: result.error.transcript,
      error: `${result.error.error.kind}: ${result.error.error.message}`,
    };
  }

  const turnsAfterHostility =
    scenario.hostileFromTurn === undefined ? undefined : Math.max(0, result.value.turnsUsed - scenario.hostileFromTurn);

  return {
    scenario,
    outcome: result.value.outcome,
    turnsUsed: result.value.turnsUsed,
    fallbacks: persona.fallbackCount(),
    disclosure: checksDisclosure(result.value.transcript),
    outcomeMatched: result.value.outcome === scenario.expectedOutcome,
    hostileExit:
      turnsAfterHostility === undefined
        ? undefined
        : checksHostileExit(
            // The loop reports the reason rather than the raw calls, so an
            // `abusive` outcome is the evidence `end_call` was reached.
            result.value.endedReason === "hostile" ? [{ name: "end_call", input: {}, id: "end" }] : [],
            turnsAfterHostility,
            hostileBudget,
          ),
    turnsAfterHostility,
    transcript: result.value.transcript,
  };
}
