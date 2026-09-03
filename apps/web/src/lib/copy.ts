import type { Locale } from "./i18n";

const IMG = "/assets/imagery/";

export type Benefit = {
  n: string;
  icon: IconName;
  title: string;
  body: string;
};
export type Step = { step: string; image: string; title: string; body: string };
export type NextStep = { n: string; body: string };

/** The four inline <symbol> icons defined in the .dc.html <defs> block. */
export type IconName = "trending-down" | "house" | "wrench" | "leaf";

export type Copy = {
  kicker: string;
  heroTitle: string;
  heroSub: string;
  cta: string;
  ctaNote: string;
  scrollHint: string;
  heroPillAValue: string;
  heroPillABody: string;
  heroPillBValue: string;
  heroPillBBody: string;
  benefitsTitle: string;
  benefitsLedeStrong: string;
  benefitsLedeMuted: string;
  benefits: Benefit[];
  metricValue: string;
  metricLabel: string;
  metricBody: string;
  co2Value: string;
  co2Label: string;
  co2Body: string;
  handoffTag: string;
  handoffValue: string;
  handoffBody: string;
  howTitle: string;
  howLedeStrong: string;
  howLedeMuted: string;
  steps: Step[];
  formEyebrow: string;
  formTitle: string;
  formSub: string;
  labelName: string;
  labelPhone: string;
  labelEmail: string;
  phName: string;
  phPhone: string;
  phEmail: string;
  labelCallLang: string;
  callLangHelp: string;
  aiNoticeTitle: string;
  aiNoticeBody: string;
  submit: string;
  submitNote: string;
  consent: string;
  privacy: string;
  errName: string;
  errPhone: string;
  errEmail: string;
  confirmEyebrow: string;
  confirmTitlePrefix: string;
  confirmTitleFallback: string;
  confirmSub: string;
  confirmAiTag: string;
  confirmAiTitle: string;
  confirmAiBody: string;
  confirmNext: NextStep[];
  confirmBack: string;
  confirmHelp: string;
  rowName: string;
  rowPhone: string;
  rowEmail: string;
  rowLang: string;
  rowWindow: string;
  windowValue: string;
  langPt: string;
  langEn: string;
};

export const COPY: Record<Locale, Copy> = {
  pt: {
    kicker: "Energia solar residencial",
    heroTitle: "Sua casa gerando a própria energia",
    heroSub:
      "Descubra em minutos se o seu telhado tem potencial. Avaliação gratuita, sem compromisso e sem visita técnica para começar.",
    cta: "Quero minha avaliação",
    ctaNote: "30 segundos para pedir",
    scrollHint: "Role para ver",
    heroPillAValue: "-72% na conta",
    heroPillABody:
      "Redução média na conta de luz dos nossos clientes residenciais.",
    heroPillBValue: "25 anos",
    heroPillBBody:
      "Garantia de geração dos painéis, com monitoramento incluído.",
    benefitsTitle: "Por que agora",
    benefitsLedeStrong:
      "Você troca uma tarifa que sobe todo ano por um sistema já pago.",
    benefitsLedeMuted:
      "E descobre isso numa ligação de dois minutos, sem visita e sem vendedor insistente.",
    benefits: [
      {
        n: "01",
        icon: "trending-down",
        title: "A conta para de subir",
        body: "A tarifa reajusta todo ano. A sua geração, não — ela já está paga.",
      },
      {
        n: "02",
        icon: "house",
        title: "O imóvel vale mais",
        body: "Casas com geração própria são anunciadas com valor mais alto na região.",
      },
      {
        n: "03",
        icon: "wrench",
        title: "Instalação em um dia",
        body: "Projeto, homologação na distribuidora e instalação com a nossa equipe.",
      },
      {
        n: "04",
        icon: "leaf",
        title: "Energia limpa",
        body: "Um sistema residencial evita cerca de 1,8 tonelada de CO₂ por ano.",
      },
    ],
    metricValue: "4 anos",
    metricLabel: "Retorno médio",
    metricBody:
      "Tempo médio de retorno do investimento nos casos residenciais avaliados em 2025.",
    co2Value: "1,8 t",
    co2Label: "CO₂ evitado / ano",
    co2Body:
      "Emissão evitada por um sistema residencial médio, equivalente a 9 mil km de carro.",
    handoffTag: "Passagem para humano",
    handoffValue: "1 dia útil",
    handoffBody:
      "Prazo máximo para um consultor humano ligar com a simulação, quando o lead é qualificado.",
    howTitle: "Como funciona",
    howLedeStrong:
      "Quatro etapas, e você só fala com um vendedor quando faz sentido.",
    howLedeMuted:
      "A primeira conversa é conduzida por um agente de IA, com perguntas objetivas.",
    steps: [
      {
        step: "01",
        image: IMG + "fill-form-crop.webp",
        title: "Você preenche o formulário",
        body: "Só os dados de contato e o idioma em que prefere ser atendido. Nada de simulação longa nem upload de conta de luz.",
      },
      {
        step: "02",
        image: IMG + "agent-call-crop.webp",
        title: "O agente de IA liga",
        body: "Em até 5 minutos no horário comercial. A voz é sintética, a ligação é gravada e avisamos isso no início da conversa.",
      },
      {
        step: "03",
        image: IMG + "answer-questions-crop.webp",
        title: "Algumas perguntas rápidas",
        body: "Conta de luz, tipo de telhado, se o imóvel é seu e prazo de decisão. Dois minutos, e você pode encerrar quando quiser.",
      },
      {
        step: "04",
        image: IMG + "human-especialist-crop.webp",
        title: "Um especialista humano assume",
        body: "Se houver potencial, um consultor liga em até um dia útil com a simulação de economia feita para o seu telhado.",
      },
    ],
    formEyebrow: "Solicite sua avaliação",
    formTitle: "Receba a ligação hoje",
    formSub:
      "Sem custo e sem obrigação de contratar. Você escolhe o idioma da ligação.",
    labelName: "Nome completo",
    labelPhone: "Telefone com DDD",
    labelEmail: "E-mail",
    phName: "Maria Oliveira",
    phPhone: "(11) 98842-1170",
    phEmail: "maria@email.com",
    labelCallLang: "Idioma preferido para a ligação",
    callLangHelp: "O agente de IA conduz toda a conversa neste idioma.",
    aiNoticeTitle: "A ligação é feita por uma IA",
    aiNoticeBody:
      "Quem liga é um agente de inteligência artificial, não uma pessoa. Ele faz perguntas objetivas, a conversa é gravada para análise e você pode encerrar ou pedir para falar com um humano a qualquer momento.",
    submit: "Enviar e receber a ligação",
    submitNote: "Ligamos em até 5 min",
    consent:
      "Ao enviar, você autoriza o contato telefônico automatizado e o tratamento dos seus dados conforme a LGPD. Você pode pedir a remoção do seu número na própria ligação.",
    privacy: "Privacidade",
    errName: "Informe seu nome completo.",
    errPhone: "Informe um telefone válido com DDD.",
    errEmail: "Informe um e-mail válido.",
    confirmEyebrow: "Formulário recebido",
    confirmTitlePrefix: "Recebemos seus dados, ",
    confirmTitleFallback: "Recebemos seus dados",
    confirmSub:
      "Agora é com a gente: a ligação de qualificação é o próximo passo e não precisa de nada da sua parte.",
    confirmAiTag: "Você vai receber uma ligação de IA",
    confirmAiTitle:
      "Quem vai ligar é um agente de inteligência artificial — não uma pessoa.",
    confirmAiBody:
      "A voz é sintética e a conversa é gravada. São cerca de quatro perguntas sobre o seu consumo e o seu telhado, em dois minutos. Se preferir, você pode pedir para falar com um consultor humano durante a própria ligação.",
    confirmNext: [
      {
        n: "01",
        body: "Ligamos em até 5 minutos dentro do horário comercial. Fora dele, na abertura do próximo dia útil.",
      },
      {
        n: "02",
        body: "Se você não puder atender, tentamos até 3 vezes em horários diferentes e deixamos um recado.",
      },
      {
        n: "03",
        body: "Se o seu caso tiver potencial, um consultor humano liga em até 1 dia útil com a simulação de economia.",
      },
    ],
    confirmBack: "Voltar ao início",
    confirmHelp: "Precisa mudar algum dado? Responda o e-mail de confirmação.",
    rowName: "Nome",
    rowPhone: "Telefone",
    rowEmail: "E-mail",
    rowLang: "Idioma da ligação",
    rowWindow: "Previsão da ligação",
    windowValue: "Hoje, em até 5 minutos",
    langPt: "Português",
    langEn: "Inglês",
  },
  en: {
    kicker: "Residential solar",
    heroTitle: "Your home making its own power",
    heroSub:
      "Find out in minutes whether your roof has potential. Free assessment, no commitment, no site visit needed to start.",
    cta: "Get my assessment",
    ctaNote: "30 seconds to request",
    scrollHint: "Scroll to explore",
    heroPillAValue: "-72% on bills",
    heroPillABody:
      "Average power bill reduction across our residential customers.",
    heroPillBValue: "25 years",
    heroPillBBody: "Generation warranty on every panel, monitoring included.",
    benefitsTitle: "Why now",
    benefitsLedeStrong:
      "You swap a tariff that climbs every year for a system already paid for.",
    benefitsLedeMuted:
      "And you find out in a two-minute call — no site visit, no pushy salesperson.",
    benefits: [
      {
        n: "01",
        icon: "trending-down",
        title: "Your bill stops climbing",
        body: "Tariffs rise every year. Your own generation does not — it is already paid for.",
      },
      {
        n: "02",
        icon: "house",
        title: "Your home is worth more",
        body: "Homes that generate their own power list higher in most neighbourhoods.",
      },
      {
        n: "03",
        icon: "wrench",
        title: "Installed in a day",
        body: "Design, utility paperwork and installation are handled by our own crew.",
      },
      {
        n: "04",
        icon: "leaf",
        title: "Genuinely clean",
        body: "One residential system avoids roughly 1.8 tonnes of CO₂ every year.",
      },
    ],
    metricValue: "4 years",
    metricLabel: "Average payback",
    metricBody:
      "Median payback period across residential assessments completed in 2025.",
    co2Value: "1.8 t",
    co2Label: "CO₂ avoided / year",
    co2Body:
      "Emissions avoided by an average residential system — about 9,000 km of driving.",
    handoffTag: "Human hand-off",
    handoffValue: "1 day",
    handoffBody:
      "Maximum time for a human consultant to call with the savings estimate once a lead qualifies.",
    howTitle: "How it works",
    howLedeStrong:
      "Four steps, and you only speak to a salesperson when it makes sense.",
    howLedeMuted:
      "The first conversation is run by an AI agent asking short, factual questions.",
    steps: [
      {
        step: "01",
        image: IMG + "fill-form-crop.webp",
        title: "You fill in the form",
        body: "Just contact details and the language you prefer to be called in. No long simulator, no bill upload.",
      },
      {
        step: "02",
        image: IMG + "agent-call-crop.webp",
        title: "The AI agent calls",
        body: "Within 5 minutes during business hours. The voice is synthetic, the call is recorded, and we say so at the start.",
      },
      {
        step: "03",
        image: IMG + "answer-questions-crop.webp",
        title: "A few quick questions",
        body: "Power bill, roof type, whether you own the home, and your timeline. Two minutes, and you can end it whenever you like.",
      },
      {
        step: "04",
        image: IMG + "human-especialist-crop.webp",
        title: "A human specialist takes over",
        body: "If there is potential, a consultant calls within one working day with a savings estimate built for your roof.",
      },
    ],
    formEyebrow: "Request your assessment",
    formTitle: "Get the call today",
    formSub:
      "Free, with no obligation to buy. You choose the language of the call.",
    labelName: "Full name",
    labelPhone: "Phone number",
    labelEmail: "Email",
    phName: "James Whitfield",
    phPhone: "(512) 555-0148",
    phEmail: "james@email.com",
    labelCallLang: "Preferred language for the call",
    callLangHelp: "The AI agent runs the whole conversation in this language.",
    aiNoticeTitle: "The call is made by an AI",
    aiNoticeBody:
      "The caller is an artificial-intelligence agent, not a person. It asks a short set of factual questions, the call is recorded for review, and you can end it or ask for a human at any point.",
    submit: "Submit and get the call",
    submitNote: "We call within 5 min",
    consent:
      "By submitting you agree to be contacted by an automated call and to your data being processed under GDPR/LGPD. You can ask to be removed during the call itself.",
    privacy: "Privacy",
    errName: "Please enter your full name.",
    errPhone: "Please enter a valid phone number.",
    errEmail: "Please enter a valid email.",
    confirmEyebrow: "Form received",
    confirmTitlePrefix: "We have your details, ",
    confirmTitleFallback: "We have your details",
    confirmSub:
      "We take it from here: the qualification call is the next step and needs nothing from you.",
    confirmAiTag: "You will get a call from an AI",
    confirmAiTitle:
      "The caller is an artificial-intelligence agent — not a person.",
    confirmAiBody:
      "The voice is synthetic and the call is recorded. It is about four questions on your power use and your roof, in two minutes. You can ask to be transferred to a human consultant during the call.",
    confirmNext: [
      {
        n: "01",
        body: "We call within 5 minutes during business hours — otherwise first thing on the next working day.",
      },
      {
        n: "02",
        body: "If you cannot pick up, we try up to 3 times at different hours and leave a voicemail.",
      },
      {
        n: "03",
        body: "If your home has potential, a human consultant calls within 1 working day with the savings estimate.",
      },
    ],
    confirmBack: "Back to start",
    confirmHelp: "Need to change something? Reply to the confirmation email.",
    rowName: "Name",
    rowPhone: "Phone",
    rowEmail: "Email",
    rowLang: "Call language",
    rowWindow: "Call expected",
    windowValue: "Today, within 5 minutes",
    langPt: "Portuguese",
    langEn: "English",
  },
};
