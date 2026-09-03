/**
 * Demo data standing in for the database described in
 * `solar-lead-qualification-spec.md` §8. Swap for the `packages/db` queries
 * once the Postgres layer exists — the shapes here mirror those tables.
 */

export type LeadStatus =
  | "new"
  | "calling"
  | "waiting_retry"
  | "no_answer_final"
  | "qualified"
  | "disqualified"
  | "opt_out";

export type StatusStyle = {
  label: LeadStatus;
  bg: string;
  fg: string;
  border: string;
  /** CSS `animation` shorthand for the badge dot. */
  dot: string;
};

const NONE = "none";
const PULSE = "solPulse 1600ms var(--ease-out) infinite";

export const STATUS: Record<LeadStatus, StatusStyle> = {
  new: { label: "new", bg: "var(--ink-100)", fg: "var(--ink-700)", border: "1px solid transparent", dot: NONE },
  calling: { label: "calling", bg: "var(--white)", fg: "var(--ink-900)", border: "1.5px solid var(--ink-900)", dot: PULSE },
  waiting_retry: { label: "waiting_retry", bg: "var(--white)", fg: "var(--ink-700)", border: "1px dashed var(--ink-300)", dot: NONE },
  no_answer_final: { label: "no_answer_final", bg: "var(--ink-050)", fg: "var(--ink-400)", border: "1px solid transparent", dot: NONE },
  qualified: { label: "qualified", bg: "var(--ink-900)", fg: "var(--white)", border: "1px solid var(--ink-900)", dot: NONE },
  disqualified: { label: "disqualified", bg: "var(--ink-200)", fg: "var(--ink-800)", border: "1px solid transparent", dot: NONE },
  opt_out: { label: "opt_out", bg: "transparent", fg: "var(--ink-900)", border: "1px solid var(--ink-900)", dot: NONE },
};

export const STATUS_KEYS = Object.keys(STATUS) as LeadStatus[];

export type CallAttempt = {
  n: string;
  result: string;
  when: string;
  duration: string;
  note: string;
  live?: boolean;
};

export type TranscriptTurn = { who: "ai" | "lead"; text: string };

export type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  score: number | null;
  status: LeadStatus;
  callLang: "pt" | "en";
  created: string;
  city: string;
  source: string;
  bill: string;
  roof: string;
  owner: string;
  timeline: string;
  consent: string;
  reason: string;
  icebreaker: string;
  scoreNote: string;
  attempts: CallAttempt[];
  transcriptMeta: string;
  transcript: TranscriptTurn[] | null;
  noTranscriptNote?: string;
};

export const LEADS: Lead[] = [
  {
    id: "l1",
    name: "Maria Oliveira",
    phone: "+55 11 98842-1170",
    email: "maria.oliveira@email.com",
    score: 87,
    status: "qualified",
    callLang: "pt",
    created: "2 Sep, 09:14",
    city: "São Paulo, SP",
    source: "Landing page — organic",
    bill: "R$ 720 / month",
    roof: "Ceramic tile, ~68 m²",
    owner: "Owns the home (9 years)",
    timeline: "This month",
    consent: "Given on form, 2 Sep 09:14",
    reason:
      "Homeowner, R$ 720/mo bill, ceramic roof with morning sun, wants to install this month",
    icebreaker:
      "Her pool heater pushes the summer bill past R$ 900 — open with pool-load sizing.",
    scoreNote: "Above the 70-point hand-off threshold on 5 of 5 active criteria.",
    attempts: [
      {
        n: "1",
        result: "Completed — qualified",
        when: "2 Sep, 09:18",
        duration: "2m 41s",
        note: "All five criteria answered. Agent confirmed consent and closed with the human-consultant hand-off.",
      },
    ],
    transcriptMeta: "Attempt 1 · 2 Sep 09:18 · 2m 41s · Portuguese",
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
  },
  {
    id: "l2",
    name: "James Whitfield",
    phone: "+1 512 555-0148",
    email: "j.whitfield@email.com",
    score: 74,
    status: "qualified",
    callLang: "en",
    created: "2 Sep, 08:47",
    city: "Austin, TX",
    source: "Landing page — paid search",
    bill: "$210 / month",
    roof: "Asphalt shingle, ~55 m²",
    owner: "Owns the home (3 years)",
    timeline: "2–3 months",
    consent: "Given on form, 2 Sep 08:47",
    reason: "Homeowner, $210/mo utility, wants battery backup after summer outages",
    icebreaker: "Lost power twice in July — lead with the backup story, not the payback math.",
    scoreNote: "Qualified, but timeline pushes him below the fast-track band.",
    attempts: [
      {
        n: "1",
        result: "No answer",
        when: "2 Sep, 08:52",
        duration: "0m 24s",
        note: "Rang out after 6 rings. No voicemail left on first attempt, per policy.",
      },
      {
        n: "2",
        result: "Completed — qualified",
        when: "2 Sep, 11:05",
        duration: "3m 02s",
        note: "Answered on second attempt. Four of five criteria answered; roof area estimated by the agent.",
      },
    ],
    transcriptMeta: "Attempt 2 · 2 Sep 11:05 · 3m 02s · English",
    transcript: [
      { who: "ai", text: "Hi, is this James? This is the Soltera virtual assistant. You asked for a solar assessment on our site — can I ask four quick questions? It takes two minutes." },
      { who: "lead", text: "Sure, go ahead." },
      { who: "ai", text: "Thanks. First, do you own the home or rent it?" },
      { who: "lead", text: "I own it, bought it three years ago." },
      { who: "ai", text: "Great. Roughly what does your monthly electricity bill come to?" },
      { who: "lead", text: "Around two hundred and ten. Honestly the bigger thing is the outages — we lost power twice in July." },
      { who: "ai", text: "Noted, I will flag battery backup for the consultant. What kind of roof do you have?" },
      { who: "lead", text: "Regular asphalt shingle, maybe ten years old." },
      { who: "ai", text: "And if the numbers work, when would you look to install?" },
      { who: "lead", text: "Probably in the next two or three months." },
      { who: "ai", text: "Perfect. A Soltera consultant will call you within one business day with a savings and backup estimate. Thanks for your time, James." },
    ],
  },
  {
    id: "l3",
    name: "Carlos Menezes",
    phone: "+55 21 99135-4402",
    email: "carlos.menezes@email.com",
    score: null,
    status: "calling",
    callLang: "pt",
    created: "2 Sep, 11:41",
    city: "Rio de Janeiro, RJ",
    source: "Landing page — organic",
    bill: "—",
    roof: "—",
    owner: "—",
    timeline: "—",
    consent: "Given on form, 2 Sep 11:41",
    reason: "Qualification in progress — attempt 1 running now",
    icebreaker: "—",
    scoreNote: "Score is computed when the call ends.",
    attempts: [
      {
        n: "1",
        result: "In progress",
        when: "2 Sep, 11:43",
        duration: "0m 38s",
        note: "Call connected. Agent is on criterion 2 of 5.",
        live: true,
      },
    ],
    transcriptMeta: "Live call in progress",
    transcript: null,
    noTranscriptNote: "The transcript appears here about 30 seconds after the call ends.",
  },
  {
    id: "l4",
    name: "Ana Duarte",
    phone: "+55 31 98110-7723",
    email: "ana.duarte@email.com",
    score: 55,
    status: "waiting_retry",
    callLang: "pt",
    created: "1 Sep, 16:20",
    city: "Belo Horizonte, MG",
    source: "Landing page — referral",
    bill: "R$ 410 / month",
    roof: "Not answered",
    owner: "Owns the home",
    timeline: "Not answered",
    consent: "Given on form, 1 Sep 16:20",
    reason: "Answered but asked to be called back after 7pm — 2 of 5 criteria answered",
    icebreaker: "She asked for the callback herself — reference the 7pm request straight away.",
    scoreNote: "Partial score. Retry scheduled for today, 19:10.",
    attempts: [
      {
        n: "1",
        result: "Answered — callback requested",
        when: "1 Sep, 16:24",
        duration: "0m 51s",
        note: "Was at work. Asked to be called after 7pm. Agent recorded the preference and rescheduled.",
      },
      {
        n: "2",
        result: "No answer",
        when: "1 Sep, 19:12",
        duration: "0m 22s",
        note: "Rang out. One attempt left before the lead is closed as no_answer_final.",
      },
    ],
    transcriptMeta: "Attempt 1 · 1 Sep 16:24 · 0m 51s · Portuguese",
    transcript: [
      { who: "ai", text: "Olá, é a Ana? Aqui é o assistente virtual da Soltera, sobre a avaliação que você pediu. Tem dois minutos?" },
      { who: "lead", text: "Agora não dá, estou no trabalho." },
      { who: "ai", text: "Sem problema. Qual o melhor horário para eu retornar?" },
      { who: "lead", text: "Depois das sete da noite." },
      { who: "ai", text: "Combinado, ligo depois das dezenove horas. Só confirmando: o imóvel é seu?" },
      { who: "lead", text: "É meu, sim. Depois a gente fala." },
      { who: "ai", text: "Perfeito, obrigado. Até mais tarde, Ana." },
    ],
  },
  {
    id: "l5",
    name: "Renata Souza",
    phone: "+55 41 99988-2210",
    email: "renata.souza@email.com",
    score: 91,
    status: "qualified",
    callLang: "pt",
    created: "1 Sep, 10:02",
    city: "Curitiba, PR",
    source: "Landing page — paid social",
    bill: "R$ 980 / month",
    roof: "Metal, ~74 m²",
    owner: "Owns the home (12 years)",
    timeline: "Within 2 weeks",
    consent: "Given on form, 1 Sep 10:02",
    reason: "R$ 980/mo bill, 74 m² metal roof, already holding 3 competing quotes",
    icebreaker:
      "Comparing three quotes — open with the 25-year generation guarantee and in-house crew.",
    scoreNote: "Highest score this week. Flagged hot — competitor quotes in play.",
    attempts: [
      {
        n: "1",
        result: "Completed — qualified",
        when: "1 Sep, 10:06",
        duration: "3m 27s",
        note: "Volunteered that she has three quotes. Agent captured competitor names for the consultant.",
      },
    ],
    transcriptMeta: "Attempt 1 · 1 Sep 10:06 · 3m 27s · Portuguese",
    transcript: [
      { who: "ai", text: "Olá, é a Renata? Aqui é o assistente virtual da Soltera. Posso fazer quatro perguntas rápidas sobre a sua avaliação?" },
      { who: "lead", text: "Pode. Já estou olhando isso há um tempo, tenho três orçamentos aqui." },
      { who: "ai", text: "Ótimo saber, vou registrar isso para o consultor. O imóvel é seu?" },
      { who: "lead", text: "Sim, doze anos." },
      { who: "ai", text: "E a conta de luz mensal, mais ou menos?" },
      { who: "lead", text: "Novecentos e oitenta. É uma casa grande, telhado metálico." },
      { who: "ai", text: "Perfeito. E o prazo para decidir?" },
      { who: "lead", text: "Quero fechar em duas semanas." },
      { who: "ai", text: "Entendido. Um consultor liga hoje ainda com a simulação. Obrigado, Renata." },
    ],
  },
  {
    id: "l6",
    name: "Tobias Lang",
    phone: "+1 305 555-0192",
    email: "tobias.lang@email.com",
    score: 42,
    status: "no_answer_final",
    callLang: "en",
    created: "31 Aug, 14:33",
    city: "Miami, FL",
    source: "Landing page — paid search",
    bill: "—",
    roof: "—",
    owner: "—",
    timeline: "—",
    consent: "Given on form, 31 Aug 14:33",
    reason: "3 attempts, never answered. Voicemail left on the final attempt.",
    icebreaker: "—",
    scoreNote: "Form-only score. No criteria answered by phone.",
    attempts: [
      { n: "1", result: "No answer", when: "31 Aug, 14:38", duration: "0m 26s", note: "Rang out." },
      { n: "2", result: "No answer", when: "31 Aug, 18:05", duration: "0m 25s", note: "Rang out. Different time band, per retry policy." },
      { n: "3", result: "Voicemail left", when: "1 Sep, 10:40", duration: "0m 41s", note: "Final attempt. Agent left a callback number and closed the lead as no_answer_final." },
    ],
    transcriptMeta: "No completed conversation",
    transcript: null,
    noTranscriptNote:
      "This lead never answered. Only the voicemail script from attempt 3 was recorded.",
  },
  {
    id: "l7",
    name: "Paulo Ferraz",
    phone: "+55 51 99671-3388",
    email: "paulo.ferraz@email.com",
    score: 18,
    status: "disqualified",
    callLang: "pt",
    created: "31 Aug, 09:11",
    city: "Porto Alegre, RS",
    source: "Landing page — organic",
    bill: "R$ 180 / month",
    roof: "No roof rights (apartment)",
    owner: "Rents",
    timeline: "—",
    consent: "Given on form, 31 Aug 09:11",
    reason: "Rents an apartment with no roof rights — fails the homeowner criterion",
    icebreaker: "—",
    scoreNote: "Disqualified on a blocking criterion, regardless of weight total.",
    attempts: [
      {
        n: "1",
        result: "Completed — disqualified",
        when: "31 Aug, 09:15",
        duration: "1m 08s",
        note: "Agent stopped after criterion 1 (homeowner) failed and offered the community-solar waitlist instead.",
      },
    ],
    transcriptMeta: "Attempt 1 · 31 Aug 09:15 · 1m 08s · Portuguese",
    transcript: [
      { who: "ai", text: "Olá, é o Paulo? Aqui é o assistente virtual da Soltera. Posso fazer algumas perguntas rápidas?" },
      { who: "lead", text: "Claro." },
      { who: "ai", text: "O imóvel é seu ou alugado?" },
      { who: "lead", text: "Alugado, é um apartamento." },
      { who: "ai", text: "Entendi. Para instalar painéis é preciso ter direito sobre o telhado, o que normalmente não é o caso em apartamento alugado. Posso te colocar na lista de energia solar compartilhada?" },
      { who: "lead", text: "Pode sim, obrigado." },
      { who: "ai", text: "Registrado. Obrigado pelo seu tempo, Paulo." },
    ],
  },
  {
    id: "l8",
    name: "Helena Costa",
    phone: "+55 11 97722-0455",
    email: "helena.costa@email.com",
    score: null,
    status: "opt_out",
    callLang: "pt",
    created: "30 Aug, 15:52",
    city: "Santo André, SP",
    source: "Landing page — paid social",
    bill: "—",
    roof: "—",
    owner: "—",
    timeline: "—",
    consent: "Withdrawn on call, 30 Aug 15:56",
    reason: "Asked to be removed from the contact list on attempt 1 — number blocklisted",
    icebreaker: "—",
    scoreNote: "No score. Contact is blocked for all future campaigns.",
    attempts: [
      {
        n: "1",
        result: "Opt-out requested",
        when: "30 Aug, 15:56",
        duration: "0m 33s",
        note: "Agent confirmed removal, added the number to the blocklist and stopped all retries.",
      },
    ],
    transcriptMeta: "Attempt 1 · 30 Aug 15:56 · 0m 33s · Portuguese",
    transcript: [
      { who: "ai", text: "Olá, é a Helena? Aqui é o assistente virtual da Soltera, sobre a avaliação solar que você pediu." },
      { who: "lead", text: "Não quero mais, por favor me tire da lista." },
      { who: "ai", text: "Sem problema. Vou remover o seu número agora e você não recebe mais ligações nossas. Desculpe o incômodo e obrigado." },
    ],
  },
  {
    id: "l9",
    name: "Diego Alcázar",
    phone: "+1 602 555-0173",
    email: "d.alcazar@email.com",
    score: null,
    status: "new",
    callLang: "en",
    created: "2 Sep, 11:52",
    city: "Phoenix, AZ",
    source: "Landing page — organic",
    bill: "—",
    roof: "—",
    owner: "—",
    timeline: "—",
    consent: "Given on form, 2 Sep 11:52",
    reason: "Awaiting first call — queued 4 minutes ago",
    icebreaker: "—",
    scoreNote: "Score is computed when the first call ends.",
    attempts: [],
    transcriptMeta: "Not called yet",
    transcript: null,
    noTranscriptNote:
      "The first call is queued. Transcript appears here once the agent has spoken to the lead.",
  },
];

export type CriterionType = "boolean" | "numeric" | "enum" | "free_text";

export type Criterion = {
  id: string;
  name: string;
  question: string;
  type: CriterionType;
  weight: number;
  active: boolean;
};

export const CRITERIA: Criterion[] = [
  { id: "c1", name: "Homeowner verification", question: "Do you own the property or rent it?", type: "boolean", weight: 30, active: true },
  { id: "c2", name: "Monthly electricity bill", question: "Roughly what is your monthly electricity bill?", type: "numeric", weight: 25, active: true },
  { id: "c3", name: "Purchase timeline", question: "If the numbers work, when would you install?", type: "enum", weight: 20, active: true },
  { id: "c4", name: "Roof type", question: "Is the roof ceramic tile, metal or concrete slab?", type: "enum", weight: 15, active: true },
  { id: "c5", name: "Roof usable area", question: "Do you know roughly how large the roof area is?", type: "numeric", weight: 10, active: true },
  { id: "c6", name: "Credit pre-check", question: "Would you want financing quoted alongside cash?", type: "boolean", weight: 10, active: false },
];

export type AuditEntry = {
  id: string;
  employee: string;
  when: string;
  criterion: string;
  field: string;
  oldValue: string;
  newValue: string;
};

export const AUDIT: AuditEntry[] = [
  { id: "a1", employee: "Lucas Prado", when: "28 Aug 2026, 14:12", criterion: "Monthly electricity bill", field: "weight", oldValue: "20", newValue: "25" },
  { id: "a2", employee: "Aline Ribeiro", when: "26 Aug 2026, 09:40", criterion: "Credit pre-check", field: "active", oldValue: "true", newValue: "false" },
  { id: "a3", employee: "Lucas Prado", when: "21 Aug 2026, 17:05", criterion: "Purchase timeline", field: "threshold", oldValue: "6 months", newValue: "3 months" },
  { id: "a4", employee: "Mei Tanaka", when: "14 Aug 2026, 11:22", criterion: "Roof usable area", field: "created", oldValue: "—", newValue: "numeric, weight 10" },
  { id: "a5", employee: "Aline Ribeiro", when: "2 Aug 2026, 08:15", criterion: "Homeowner verification", field: "weight", oldValue: "25", newValue: "30" },
  { id: "a6", employee: "Mei Tanaka", when: "29 Jul 2026, 16:48", criterion: "Roof type", field: "question", oldValue: "What is your roof made of?", newValue: "Is the roof ceramic tile, metal or concrete slab?" },
];

/** Hand-off threshold is 70 points; the two bands below it read progressively quieter. */
export function scoreColor(score: number | null): string {
  if (score === null || score === undefined) return "var(--ink-400)";
  if (score >= 70) return "var(--ink-900)";
  if (score >= 45) return "var(--ink-700)";
  return "var(--ink-400)";
}

export function statusCounts(leads: Lead[] = LEADS): Record<string, number> {
  const counts: Record<string, number> = { all: leads.length };
  for (const key of STATUS_KEYS) {
    counts[key] = leads.filter((l) => l.status === key).length;
  }
  return counts;
}

export function filterLeads(
  leads: Lead[],
  statusFilter: string,
  query: string,
): Lead[] {
  const q = query.trim().toLowerCase();
  return leads.filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (!q) return true;
    return `${l.name} ${l.phone} ${l.email}`.toLowerCase().includes(q);
  });
}

export function getLead(id: string): Lead | undefined {
  return LEADS.find((l) => l.id === id);
}

export const KPIS = [
  { label: "New today", value: "14", delta: "+3 vs yest." },
  { label: "Qualified", value: "6", delta: "43% rate" },
  { label: "Awaiting retry", value: "2", delta: "next 19:10" },
  { label: "Median score", value: "61", delta: "−4 this week" },
];

export const LOGIN_STATS = [
  { value: "312", label: "calls this week" },
  { value: "41%", label: "qualified rate" },
  { value: "4m 12s", label: "median first call" },
];

/** Spec §4.5 allows 1 first call + 2 retries. */
export const MAX_ATTEMPTS = 3;
