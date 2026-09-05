import type { AttemptOutcome, CriterionType, LeadStatus } from "@solarwave/core";
import type { CallLanguage, TranscriptTurn } from "../schema";

/**
 * Demo fixtures ported from the original `apps/web/src/lib/leads.ts`.
 * Ids are fixed so re-running the seed is idempotent and links stay stable.
 * Every number is Brazilian (+55) per the phase-1 scope; the two English
 * speakers keep `callLanguage: "en"` so the EN call path shows in the portal.
 */

const id = (n: number, kind: number) => `0000000${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const leadId = (n: number) => id(n, 1);
export const attemptId = (lead: number, attempt: number) => id(lead * 10 + attempt, 2);
export const criterionId = (n: number) => id(n, 3);
export const auditId = (n: number) => id(n, 4);
export const employeeId = (n: number) => id(n, 5);

export const EMPLOYEES = [
  { id: employeeId(1), name: "Lucas Prado", email: "lucas.prado@soltera.com", role: "admin" as const, auth: true },
  { id: employeeId(2), name: "Aline Ribeiro", email: "aline.ribeiro@soltera.com", role: "agent" as const, auth: true },
  { id: employeeId(3), name: "Mei Tanaka", email: "mei.tanaka@soltera.com", role: "admin" as const, auth: false },
];

export type SeedCriterion = {
  id: string;
  key: string;
  label: string;
  questionPt: string;
  questionEn: string;
  type: CriterionType;
  options: string | null;
  expectedValue: string | null;
  weight: number;
  blocking: boolean;
  active: boolean;
  sortOrder: number;
};

export const CRITERIA: SeedCriterion[] = [
  {
    id: criterionId(1),
    key: "homeowner",
    label: "Homeowner verification",
    questionPt: "O imóvel é seu ou alugado?",
    questionEn: "Do you own the property or rent it?",
    type: "boolean",
    options: null,
    expectedValue: "true",
    weight: 30,
    blocking: true,
    active: true,
    sortOrder: 1,
  },
  {
    id: criterionId(2),
    key: "monthly_bill",
    label: "Monthly electricity bill",
    questionPt: "Qual foi o valor aproximado da última conta de luz?",
    questionEn: "Roughly what is your monthly electricity bill?",
    type: "numeric",
    options: null,
    expectedValue: ">= 300",
    weight: 25,
    blocking: false,
    active: true,
    sortOrder: 2,
  },
  {
    id: criterionId(3),
    key: "purchase_timeline",
    label: "Purchase timeline",
    questionPt: "Se a proposta fizer sentido, em quanto tempo você pensaria em instalar?",
    questionEn: "If the numbers work, when would you look to install?",
    type: "enum",
    options: "this_month|within_3_months|within_6_months|not_sure",
    expectedValue: "this_month|within_3_months",
    weight: 20,
    blocking: false,
    active: true,
    sortOrder: 3,
  },
  {
    id: criterionId(4),
    key: "roof_type",
    label: "Roof type",
    questionPt: "O telhado é de telha cerâmica, metálico ou laje?",
    questionEn: "Is the roof ceramic tile, metal or concrete slab?",
    type: "enum",
    options: "ceramic|metal|slab|fiber_cement",
    expectedValue: "ceramic|metal",
    weight: 15,
    blocking: false,
    active: true,
    sortOrder: 4,
  },
  {
    id: criterionId(5),
    key: "roof_area",
    label: "Roof usable area",
    questionPt: "Você sabe mais ou menos qual é a área do telhado, em metros quadrados?",
    questionEn: "Do you know roughly how large the roof area is, in square metres?",
    type: "numeric",
    options: null,
    expectedValue: ">= 30",
    weight: 10,
    blocking: false,
    active: true,
    sortOrder: 5,
  },
  {
    id: criterionId(6),
    key: "credit_precheck",
    label: "Credit pre-check",
    questionPt: "Você gostaria de receber também uma simulação de financiamento?",
    questionEn: "Would you want financing quoted alongside cash?",
    type: "boolean",
    options: null,
    expectedValue: "true",
    weight: 10,
    blocking: false,
    active: false,
    sortOrder: 6,
  },
];

export const SETTINGS = { handoffThreshold: 70, minAnsweredWeightShare: 0.6 };

export type SeedAttempt = {
  n: number;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  outcome: AttemptOutcome | null;
  endedReason: string;
  transcript: TranscriptTurn[] | null;
  /** Answers extracted from this attempt, keyed by criterion key. */
  answers?: Record<string, { value: boolean | number | string; extracted: string; evidence?: string }>;
};

export type SeedLead = {
  n: number;
  name: string;
  phone: string;
  email: string;
  status: LeadStatus;
  callLanguage: CallLanguage;
  createdAt: string;
  source: string;
  reason: string | null;
  icebreaker: string | null;
  nextCallAt: string | null;
  optOutAt: string | null;
  attempts: SeedAttempt[];
};

const SP = "-03:00";

export const LEADS: SeedLead[] = [
  {
    n: 1,
    name: "Maria Oliveira",
    phone: "+5511988421170",
    email: "maria.oliveira@email.com",
    status: "qualified",
    callLanguage: "pt",
    createdAt: `2026-09-02T09:14:00${SP}`,
    source: "landing_page:organic",
    reason: "Homeowner, R$ 720/mo bill, ceramic roof with morning sun, wants to install this month",
    icebreaker: "Her pool heater pushes the summer bill past R$ 900 — open with pool-load sizing.",
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-09-02T09:14:00${SP}`,
        startedAt: `2026-09-02T09:18:00${SP}`,
        endedAt: `2026-09-02T09:20:41${SP}`,
        outcome: "answered_complete",
        endedReason: "All criteria answered. Agent confirmed consent and closed with the human-consultant hand-off.",
        transcript: [
          { who: "ai", text: "Olá, é a Maria? Aqui é o assistente virtual da Soltera. Você pediu uma avaliação no nosso site — posso fazer quatro perguntas rápidas? Leva dois minutos." },
          { who: "lead", text: "Pode falar, sim." },
          { who: "ai", text: "Obrigado. Primeiro: o imóvel é seu ou alugado?" },
          { who: "lead", text: "É meu, moro aqui há nove anos." },
          { who: "ai", text: "Perfeito. Qual foi o valor aproximado da última conta de luz?" },
          { who: "lead", text: "Veio setecentos e vinte. No verão passa de novecentos por causa do aquecedor da piscina." },
          { who: "ai", text: "Entendi. E o telhado é de telha cerâmica, metálico ou laje?" },
          { who: "lead", text: "Cerâmica, e pega bastante sol de manhã." },
          { who: "ai", text: "Última pergunta: se a proposta fizer sentido, em quanto tempo você pensaria em instalar?" },
          { who: "lead", text: "Se o número fechar, esse mês mesmo." },
          { who: "ai", text: "Ótimo. Um consultor da Soltera vai te ligar em até um dia útil com a simulação de economia. Obrigado pelo seu tempo, Maria." },
        ],
        answers: {
          homeowner: { value: true, extracted: "Owns the home (9 years)", evidence: "É meu, moro aqui há nove anos." },
          monthly_bill: { value: 720, extracted: "R$ 720 / month", evidence: "Veio setecentos e vinte." },
          purchase_timeline: { value: "this_month", extracted: "This month", evidence: "Se o número fechar, esse mês mesmo." },
          roof_type: { value: "ceramic", extracted: "Ceramic tile", evidence: "Cerâmica, e pega bastante sol de manhã." },
        },
      },
    ],
  },
  {
    n: 2,
    name: "James Whitfield",
    phone: "+5511976543210",
    email: "j.whitfield@email.com",
    status: "qualified",
    callLanguage: "en",
    createdAt: `2026-09-02T08:47:00${SP}`,
    source: "landing_page:paid_search",
    reason: "Homeowner, R$ 340/mo bill, metal roof, wants battery backup after summer outages",
    icebreaker: "Lost power twice in July — lead with the backup story, not the payback math.",
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-09-02T08:47:00${SP}`,
        startedAt: `2026-09-02T08:52:00${SP}`,
        endedAt: `2026-09-02T08:52:24${SP}`,
        outcome: "no_answer",
        endedReason: "Rang out after 6 rings. No voicemail left on first attempt, per policy.",
        transcript: null,
      },
      {
        n: 2,
        scheduledAt: `2026-09-02T09:07:24${SP}`,
        startedAt: `2026-09-02T11:05:00${SP}`,
        endedAt: `2026-09-02T11:08:02${SP}`,
        outcome: "answered_complete",
        endedReason: "Answered on second attempt. Four of five criteria answered; roof area estimated by the lead.",
        transcript: [
          { who: "ai", text: "Hi, is this James? This is the Soltera virtual assistant. You asked for a solar assessment on our site — can I ask four quick questions? It takes two minutes." },
          { who: "lead", text: "Sure, go ahead." },
          { who: "ai", text: "Thanks. First, do you own the home or rent it?" },
          { who: "lead", text: "I own it, bought it three years ago." },
          { who: "ai", text: "Great. Roughly what does your monthly electricity bill come to?" },
          { who: "lead", text: "Around three hundred and forty. Honestly the bigger thing is the outages — we lost power twice in July." },
          { who: "ai", text: "Noted, I will flag battery backup for the consultant. What kind of roof do you have?" },
          { who: "lead", text: "Metal roof, maybe ten years old. Around fifty-five square metres." },
          { who: "ai", text: "And if the numbers work, when would you look to install?" },
          { who: "lead", text: "Probably in the next four to six months." },
          { who: "ai", text: "Perfect. A Soltera consultant will call you within one business day with a savings and backup estimate. Thanks for your time, James." },
        ],
        answers: {
          homeowner: { value: true, extracted: "Owns the home (3 years)", evidence: "I own it, bought it three years ago." },
          monthly_bill: { value: 340, extracted: "R$ 340 / month", evidence: "Around three hundred and forty." },
          purchase_timeline: { value: "within_6_months", extracted: "4–6 months", evidence: "Probably in the next four to six months." },
          roof_type: { value: "metal", extracted: "Metal", evidence: "Metal roof, maybe ten years old." },
          roof_area: { value: 55, extracted: "~55 m²", evidence: "Around fifty-five square metres." },
        },
      },
    ],
  },
  {
    n: 3,
    name: "Carlos Menezes",
    phone: "+5521991354402",
    email: "carlos.menezes@email.com",
    status: "calling",
    callLanguage: "pt",
    createdAt: `2026-09-02T11:41:00${SP}`,
    source: "landing_page:organic",
    reason: null,
    icebreaker: null,
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-09-02T11:41:00${SP}`,
        startedAt: `2026-09-02T11:43:00${SP}`,
        endedAt: null,
        outcome: null,
        endedReason: "Call connected. Agent is on criterion 2 of 5.",
        transcript: null,
      },
    ],
  },
  {
    n: 4,
    name: "Ana Duarte",
    phone: "+5531981107723",
    email: "ana.duarte@email.com",
    status: "waiting_retry",
    callLanguage: "pt",
    createdAt: `2026-09-01T16:20:00${SP}`,
    source: "landing_page:referral",
    reason: "Answered but asked to be called back after 7pm — 2 of 5 criteria answered",
    icebreaker: "She asked for the callback herself — reference the 7pm request straight away.",
    nextCallAt: `2026-09-03T19:10:00${SP}`,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-09-01T16:20:00${SP}`,
        startedAt: `2026-09-01T16:24:00${SP}`,
        endedAt: `2026-09-01T16:24:51${SP}`,
        outcome: "answered_incomplete",
        endedReason: "Was at work. Asked to be called after 7pm. Agent recorded the preference and rescheduled.",
        transcript: [
          { who: "ai", text: "Olá, é a Ana? Aqui é o assistente virtual da Soltera, sobre a avaliação que você pediu. Tem dois minutos?" },
          { who: "lead", text: "Agora não dá, estou no trabalho." },
          { who: "ai", text: "Sem problema. Qual o melhor horário para eu retornar?" },
          { who: "lead", text: "Depois das sete da noite." },
          { who: "ai", text: "Combinado, ligo depois das dezenove horas. Só confirmando: o imóvel é seu?" },
          { who: "lead", text: "É meu, sim. A conta vem uns quatrocentos e dez. Depois a gente fala." },
          { who: "ai", text: "Perfeito, obrigado. Até mais tarde, Ana." },
        ],
        answers: {
          homeowner: { value: true, extracted: "Owns the home", evidence: "É meu, sim." },
          monthly_bill: { value: 410, extracted: "R$ 410 / month", evidence: "A conta vem uns quatrocentos e dez." },
        },
      },
      {
        n: 2,
        scheduledAt: `2026-09-01T19:00:00${SP}`,
        startedAt: `2026-09-01T19:12:00${SP}`,
        endedAt: `2026-09-01T19:12:22${SP}`,
        outcome: "no_answer",
        endedReason: "Rang out. One attempt left before the lead is closed as no_answer_final.",
        transcript: null,
      },
    ],
  },
  {
    n: 5,
    name: "Renata Souza",
    phone: "+5541999882210",
    email: "renata.souza@email.com",
    status: "qualified",
    callLanguage: "pt",
    createdAt: `2026-09-01T10:02:00${SP}`,
    source: "landing_page:paid_social",
    reason: "R$ 980/mo bill, 74 m² metal roof, already holding 3 competing quotes",
    icebreaker: "Comparing three quotes — open with the 25-year generation guarantee and in-house crew.",
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-09-01T10:02:00${SP}`,
        startedAt: `2026-09-01T10:06:00${SP}`,
        endedAt: `2026-09-01T10:09:27${SP}`,
        outcome: "answered_complete",
        endedReason: "Volunteered that she has three quotes. Agent captured competitor names for the consultant.",
        transcript: [
          { who: "ai", text: "Olá, é a Renata? Aqui é o assistente virtual da Soltera. Posso fazer quatro perguntas rápidas sobre a sua avaliação?" },
          { who: "lead", text: "Pode. Já estou olhando isso há um tempo, tenho três orçamentos aqui." },
          { who: "ai", text: "Ótimo saber, vou registrar isso para o consultor. O imóvel é seu?" },
          { who: "lead", text: "Sim, doze anos." },
          { who: "ai", text: "E a conta de luz mensal, mais ou menos?" },
          { who: "lead", text: "Novecentos e oitenta. É uma casa grande, telhado metálico, uns setenta e quatro metros." },
          { who: "ai", text: "Perfeito. E o prazo para decidir?" },
          { who: "lead", text: "Quero fechar em duas semanas." },
          { who: "ai", text: "Entendido. Um consultor liga hoje ainda com a simulação. Obrigado, Renata." },
        ],
        answers: {
          homeowner: { value: true, extracted: "Owns the home (12 years)", evidence: "Sim, doze anos." },
          monthly_bill: { value: 980, extracted: "R$ 980 / month", evidence: "Novecentos e oitenta." },
          purchase_timeline: { value: "this_month", extracted: "Within 2 weeks", evidence: "Quero fechar em duas semanas." },
          roof_type: { value: "metal", extracted: "Metal", evidence: "telhado metálico" },
          roof_area: { value: 74, extracted: "~74 m²", evidence: "uns setenta e quatro metros" },
        },
      },
    ],
  },
  {
    n: 6,
    name: "Tobias Lang",
    phone: "+5561998765432",
    email: "tobias.lang@email.com",
    status: "no_answer_final",
    callLanguage: "en",
    createdAt: `2026-08-31T14:33:00${SP}`,
    source: "landing_page:paid_search",
    reason: "3 attempts, never answered. Voicemail left on the final attempt.",
    icebreaker: null,
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      { n: 1, scheduledAt: `2026-08-31T14:33:00${SP}`, startedAt: `2026-08-31T14:38:00${SP}`, endedAt: `2026-08-31T14:38:26${SP}`, outcome: "no_answer", endedReason: "Rang out.", transcript: null },
      { n: 2, scheduledAt: `2026-08-31T14:53:26${SP}`, startedAt: `2026-08-31T18:05:00${SP}`, endedAt: `2026-08-31T18:05:25${SP}`, outcome: "no_answer", endedReason: "Rang out. Different time band, per retry policy.", transcript: null },
      { n: 3, scheduledAt: `2026-09-02T18:05:25${SP}`, startedAt: `2026-09-02T18:10:00${SP}`, endedAt: `2026-09-02T18:10:41${SP}`, outcome: "voicemail", endedReason: "Final attempt. Agent left a callback number and closed the lead as no_answer_final.", transcript: null },
    ],
  },
  {
    n: 7,
    name: "Paulo Ferraz",
    phone: "+5551996713388",
    email: "paulo.ferraz@email.com",
    status: "disqualified",
    callLanguage: "pt",
    createdAt: `2026-08-31T09:11:00${SP}`,
    source: "landing_page:organic",
    reason: "Rents an apartment with no roof rights — fails the homeowner criterion",
    icebreaker: null,
    nextCallAt: null,
    optOutAt: null,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-08-31T09:11:00${SP}`,
        startedAt: `2026-08-31T09:15:00${SP}`,
        endedAt: `2026-08-31T09:16:08${SP}`,
        outcome: "answered_complete",
        endedReason: "Agent stopped after criterion 1 (homeowner) failed and offered the community-solar waitlist instead.",
        transcript: [
          { who: "ai", text: "Olá, é o Paulo? Aqui é o assistente virtual da Soltera. Posso fazer algumas perguntas rápidas?" },
          { who: "lead", text: "Claro." },
          { who: "ai", text: "O imóvel é seu ou alugado?" },
          { who: "lead", text: "Alugado, é um apartamento. A conta é baixa, uns cento e oitenta." },
          { who: "ai", text: "Entendi. Para instalar painéis é preciso ter direito sobre o telhado, o que normalmente não é o caso em apartamento alugado. Posso te colocar na lista de energia solar compartilhada?" },
          { who: "lead", text: "Pode sim, obrigado." },
          { who: "ai", text: "Registrado. Obrigado pelo seu tempo, Paulo." },
        ],
        answers: {
          homeowner: { value: false, extracted: "Rents (apartment)", evidence: "Alugado, é um apartamento." },
          monthly_bill: { value: 180, extracted: "R$ 180 / month", evidence: "uns cento e oitenta" },
        },
      },
    ],
  },
  {
    n: 8,
    name: "Helena Costa",
    phone: "+5511977220455",
    email: "helena.costa@email.com",
    status: "opt_out",
    callLanguage: "pt",
    createdAt: `2026-08-30T15:52:00${SP}`,
    source: "landing_page:paid_social",
    reason: "Asked to be removed from the contact list on attempt 1 — number blocklisted",
    icebreaker: null,
    nextCallAt: null,
    optOutAt: `2026-08-30T15:56:33${SP}`,
    attempts: [
      {
        n: 1,
        scheduledAt: `2026-08-30T15:52:00${SP}`,
        startedAt: `2026-08-30T15:56:00${SP}`,
        endedAt: `2026-08-30T15:56:33${SP}`,
        outcome: "opt_out",
        endedReason: "Agent confirmed removal, added the number to the blocklist and stopped all retries.",
        transcript: [
          { who: "ai", text: "Olá, é a Helena? Aqui é o assistente virtual da Soltera, sobre a avaliação solar que você pediu." },
          { who: "lead", text: "Não quero mais, por favor me tire da lista." },
          { who: "ai", text: "Sem problema. Vou remover o seu número agora e você não recebe mais ligações nossas. Desculpe o incômodo e obrigado." },
        ],
      },
    ],
  },
  {
    n: 9,
    name: "Diego Alcázar",
    phone: "+5571987654321",
    email: "d.alcazar@email.com",
    status: "new",
    callLanguage: "en",
    createdAt: `2026-09-02T11:52:00${SP}`,
    source: "landing_page:organic",
    reason: null,
    icebreaker: null,
    nextCallAt: `2026-09-02T11:52:00${SP}`,
    optOutAt: null,
    attempts: [],
  },
];

export type SeedAudit = {
  id: string;
  employee: number;
  criterion: number | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

export const AUDIT: SeedAudit[] = [
  { id: auditId(1), employee: 1, criterion: 2, field: "weight", oldValue: "20", newValue: "25", changedAt: `2026-08-28T14:12:00${SP}` },
  { id: auditId(2), employee: 2, criterion: 6, field: "active", oldValue: "true", newValue: "false", changedAt: `2026-08-26T09:40:00${SP}` },
  { id: auditId(3), employee: 1, criterion: 3, field: "expectedValue", oldValue: "this_month|within_3_months|within_6_months", newValue: "this_month|within_3_months", changedAt: `2026-08-21T17:05:00${SP}` },
  { id: auditId(4), employee: 3, criterion: 5, field: "created", oldValue: null, newValue: "roof_area: numeric, weight 10", changedAt: `2026-08-14T11:22:00${SP}` },
  { id: auditId(5), employee: 2, criterion: 1, field: "weight", oldValue: "25", newValue: "30", changedAt: `2026-08-02T08:15:00${SP}` },
  { id: auditId(6), employee: 3, criterion: 4, field: "questionEn", oldValue: "What is your roof made of?", newValue: "Is the roof ceramic tile, metal or concrete slab?", changedAt: `2026-07-29T16:48:00${SP}` },
];
