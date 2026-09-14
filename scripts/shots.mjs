/**
 * Portfolio capture. Drives the running app with a real browser and writes
 * retina PNGs of every screen worth showing, plus a contact sheet to pick from.
 *
 *   node scripts/shots.mjs                  # boots the dev server itself, captures, exits
 *   node scripts/shots.mjs --port 3400      # if the default port is taken
 *   node scripts/shots.mjs --base <url>     # capture a server that is already up
 *   node scripts/shots.mjs --only leads     # recapture only the shots whose slug matches
 *
 * Requires: npm i -D playwright && npx playwright install chromium
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// ─── Configure for this project ──────────────────────────────────────────────

const OUT = join(process.cwd(), "shots");
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2; // 2 = retina; the PNGs come out at 2880px wide, plenty for a crop

/** Not the project's usual port — that one is usually already answering. */
const DEFAULT_PORT = 3210;

/**
 * How to start the app.
 *
 * This is a pnpm workspace, so `next` is invoked directly in `apps/web` rather
 * than through the root `dev` script: forwarding `-- -p <port>` down two script
 * layers is exactly the kind of thing that silently starts the server on the
 * default port instead, and then this photographs whatever is already there.
 */
const DEV_CMD = "pnpm";
const devArgs = (port) => ["--filter", "web", "exec", "next", "dev", "-p", String(port)];

/**
 * The portal reads and writes the real Supabase project, so there is no offline
 * mode to switch on: the shots are of seeded demo data. Run `pnpm db:seed`
 * first if an integration suite has truncated the database — it leaves the
 * dashboard empty, which photographs as a working app with nothing in it.
 */
const DEV_ENV = {};

/** Dev-tooling overlays. They belong to the framework, not the product. */
const HIDE = [
  "nextjs-portal",
  "#webpack-dev-server-client-overlay",
  "vite-plugin-checker-error-overlay",
];

/**
 * Panels that scroll inside themselves.
 *
 * A full-page capture does not scroll, so whatever sits below such a panel's
 * own fold is simply absent from the PNG. The lead detail's transcript is
 * capped at 660px above 1100px wide, and the longest seeded conversation was
 * being cut mid-sentence — in the one shot whose whole point is the transcript.
 *
 * Released for the FULL capture only, after the viewport one is already
 * written, so the first-fold image still shows the panel as the product
 * actually behaves.
 *
 * Matched on a class substring because CSS modules hash the class name.
 */
const EXPAND = ['[class*="transcript"]'];

/** Seeded ids are fixed (`packages/db/src/seed/data.ts`), so these links are stable. */
const lead = (n) => `00000001-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ADMIN = { email: "lucas.prado@soltera.com", password: "solarwave-demo-2026" };

/**
 * Signs in once and reuses the session.
 *
 * Idempotent on purpose: every portal shot calls it, so the set can be
 * recaptured in any order or one at a time with `--only`. The proxy redirects
 * an anonymous `/portal/*` request to the login page, which is what this
 * detects — cheaper and steadier than tracking whether a previous shot logged in.
 */
async function signIn(page) {
  await page.goto(`${base}/portal/leads`, { waitUntil: "domcontentloaded" });
  if (!page.url().includes("/portal/login")) return;

  await page.fill("#l-email", ADMIN.email);
  await page.fill("#l-pass", ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Leaving the login page is the ONLY honest success signal: the server action
  // redirects on success and re-renders the same form with an error on failure.
  //
  // Learned the expensive way — an earlier version waited on `/\/portal\/(leads|)/`,
  // whose empty alternation matches `/portal/login` too. It resolved instantly,
  // the next `goto` cancelled the sign-in POST mid-flight, and twelve byte-identical
  // captures of the login screen were written with an exit code of 0.
  await page.waitForURL((url) => !url.pathname.startsWith("/portal/login"), { timeout: 30_000 });
}

/** Signed-in navigation: authenticate, then deep-link. */
function portal(path) {
  return async (page) => {
    await signIn(page);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await settle(page);

    // Fail loudly rather than photographing the login screen. A capture run
    // that quietly writes the wrong image is worse than one that stops: the
    // exit code says nothing about what is in the frame.
    if (page.url().includes("/portal/login")) {
      throw new Error(`${path} bounced to the login page — the session did not stick.`);
    }
  };
}

/**
 * One entry per image.
 *
 * Ordered as the product reads: the public capture path first, then the console
 * that acts on it. The four lead-detail shots are the point of the set — they
 * are the same screen showing four different judgements the system reached, and
 * that range says more about the work than four views of a qualified lead.
 */
const SHOTS = [
  {
    slug: "01-landing-pt",
    title: "Landing (PT)",
    note: "Onde o lead chega. O formulário de contato é o único caminho de entrada do sistema.",
    arrange: goto("/pt"),
  },
  {
    slug: "02-landing-en",
    title: "Landing (EN)",
    note: "A mesma página no segundo idioma — a escolha aqui define o idioma da ligação.",
    arrange: goto("/en"),
  },
  {
    slug: "03-confirmacao",
    title: "Confirmação pós-envio",
    note: "O que o lead vê depois de enviar: a confirmação lê o registro recém-criado.",
    arrange: goto(`/pt/confirmacao?lead=${lead(1)}`),
  },
  {
    slug: "04-portal-login",
    title: "Entrada do console",
    note: "Autenticação de funcionário (Supabase Auth), com papéis agent e admin.",
    arrange: async (page) => {
      await page.goto(`${base}/portal/login`, { waitUntil: "domcontentloaded" });
      await settle(page);
    },
  },
  {
    slug: "05-leads",
    title: "Painel de leads",
    note: "A lista completa com indicadores no topo. Atualiza sozinha enquanto houver ligação em curso.",
    arrange: portal("/portal/leads"),
  },
  {
    slug: "06-leads-qualified",
    title: "Painel — filtrado por qualificados",
    note: "O mesmo painel recortado pelo estado que interessa a quem vende.",
    arrange: portal("/portal/leads?status=qualified"),
  },
  {
    slug: "07-lead-qualified",
    title: "Lead qualificado",
    note: "O caso completo: nota, motivo, quebra-gelo, respostas por critério com evidência citada e a transcrição.",
    arrange: portal(`/portal/leads/${lead(2)}`),
  },
  {
    slug: "08-lead-disqualified",
    title: "Lead desqualificado",
    note: "A mesma tela quando o sistema decide NÃO passar adiante — e diz por quê.",
    arrange: portal(`/portal/leads/${lead(7)}`),
  },
  {
    slug: "09-lead-optout",
    title: "Lead que pediu para não ser contatado",
    note: "Estado terminal. A partir daqui todo contato é recusado, inclusive simulado.",
    arrange: portal(`/portal/leads/${lead(8)}`),
  },
  {
    slug: "10-lead-calling",
    title: "Lead em ligação",
    note: "Tentativa em andamento, antes de existir desfecho ou nota.",
    arrange: portal(`/portal/leads/${lead(3)}`),
  },
  {
    slug: "11-criteria",
    title: "Critérios de qualificação",
    note: "O que a IA pergunta é montado daqui. Inclui a ordem real da ligação e o orçamento de perguntas.",
    arrange: portal("/portal/criteria"),
  },
  {
    slug: "12-operations",
    title: "Operações",
    note: "O freio: disparo automático, orçamento diário de ligações e de minutos, com o consumo à vista.",
    arrange: portal("/portal/operations"),
  },
  {
    slug: "13-violations",
    title: "Guardrails",
    note:
      "O estado vazio, que é o estado real do seed: o juiz pós-ligação auditou todas as transcrições e não "
      + "achou violação. Uma violação de alta severidade não revisada BLOQUEIA novas ligações para aquele lead.",
    arrange: portal("/portal/violations"),
  },
  {
    slug: "14-audit",
    title: "Histórico de auditoria",
    note: "Toda mudança de critério e de configuração, com autor, valor anterior e novo.",
    arrange: portal("/portal/audit"),
  },
  {
    slug: "15-harness",
    title: "Bancada de voz",
    note: "Conversa real com o agente pelo microfone, sem telefonia e sem gravar nada.",
    arrange: portal("/portal/harness"),
  },
];

/** Contact-sheet copy. Write it in whatever language its reader uses. */
const COPY = {
  title: "SolarWave — telas para portfólio",
  lede: (w, h) =>
    `Capturas em 2x (retina) de ${w}×${h}. Cada miniatura mostra a tela como ela aparece na ` +
    `primeira dobra; clique nela para abrir a captura da página inteira, de onde dá para ` +
    `recortar qualquer seção sem perder resolução.`,
  footnote:
    "Dados fictícios — nenhuma empresa ou pessoa real aparece aqui. Nomes, telefones e " +
    "transcrições são fixtures do seed de demonstração.",
};

// ─── Machinery — no need to touch below here ─────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? "");
};
const only = flag("only");
const externalBase = flag("base");
const port = Number(flag("port") ?? DEFAULT_PORT);
const base = externalBase || `http://localhost:${port}`;

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

function goto(path) {
  return async (page) => {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await settle(page);
  };
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startDevServer() {
  if (await waitForServer(base, 1000)) {
    throw new Error(
      `port ${port} is already answering — that server is probably another project. ` +
        `Pass --port <free port>, or --base <url> to capture a server you started yourself.`,
    );
  }
  console.log(`starting the dev server on :${port} …`);
  const proc = spawn(DEV_CMD, devArgs(port), {
    stdio: "ignore",
    shell: true,
    env: { ...process.env, ...DEV_ENV },
  });
  if (!(await waitForServer(base, 90_000))) {
    proc.kill();
    throw new Error(`dev server never answered on ${base}`);
  }
  return proc;
}

/** npm sits under a shell wrapper, so killing the pid leaves the server running. */
function stopDevServer(proc) {
  if (!proc?.pid) return;
  if (process.platform === "win32") {
    // Synchronous: an async kill would not outlive the process.exit() below.
    spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill();
  }
}

function contactSheet(shots) {
  const cards = shots
    .map(
      (s, i) => `
      <figure>
        <a href="${s.slug}-${s.viewportOnly ? "viewport" : "full"}.png"><img src="${s.slug}-viewport.png" alt="${s.title}"></a>
        <figcaption>
          <span class="n">${String(i + 1).padStart(2, "0")}</span>
          <strong>${s.title}</strong>
          <p>${s.note}</p>
          <code>${s.slug}-viewport.png${s.viewportOnly ? "" : ` · ${s.slug}-full.png`}</code>
        </figcaption>
      </figure>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${COPY.title}</title>
<style>
  :root { color-scheme: light; --ink:#1a1c1c; --dim:#5f6a68; --line:#e3e7e6; --accent:#1f6b5c; }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 40px 80px; background:#f7f8f8; color:var(--ink);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif; }
  header { max-width:760px; margin-bottom:40px; }
  h1 { font-size:30px; letter-spacing:-.01em; margin:0 0 10px; }
  header p { color:var(--dim); margin:0 0 6px; }
  .grid { display:grid; gap:28px; grid-template-columns:repeat(auto-fill,minmax(420px,1fr)); }
  figure { margin:0; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  figure img { display:block; width:100%; border-bottom:1px solid var(--line); }
  figcaption { padding:16px 18px 18px; }
  .n { font:500 12px/1 ui-monospace,SFMono-Regular,monospace; color:var(--accent); margin-right:8px; }
  figcaption strong { font-weight:600; }
  figcaption p { color:var(--dim); font-size:13.5px; margin:8px 0 10px; }
  figcaption code { font:11.5px/1.4 ui-monospace,SFMono-Regular,monospace; color:#8a9793; word-break:break-all; }
</style></head>
<body>
  <header>
    <h1>${COPY.title}</h1>
    <p>${COPY.lede(VIEWPORT.width, VIEWPORT.height)}</p>
    <p>${COPY.footnote}</p>
  </header>
  <div class="grid">${cards}</div>
</body></html>`;
}

async function main() {
  const shots = only ? SHOTS.filter((s) => s.slug.includes(only)) : SHOTS;
  if (!shots.length) throw new Error(`no shot matches --only ${only}`);

  const dev = externalBase ? null : await startDevServer();

  // A partial run tops up an existing capture set; a full run replaces it.
  if (!only) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    // Scroll-reveal sections would otherwise be photographed at opacity 0 in a
    // full-page capture, which never scrolls. Reduced motion also lands every
    // entrance animation on its final frame, so no shot catches a half-fade.
    reducedMotion: "reduce",
  });

  try {
    for (const shot of shots) {
      const page = await context.newPage();

      // A page that threw during render still screenshots — as a framework
      // error boundary, which is a perfectly valid PNG of a broken product.
      // The exit code says nothing about what is in the frame, so the crash has
      // to stop the run. This is how the Operations page was caught rendering
      // "This page couldn't load" after a clean build and a green test suite.
      const crashes = [];
      page.on("pageerror", (error) => crashes.push(error.message));

      await shot.arrange(page);
      if (crashes.length > 0) {
        throw new Error(`${shot.slug}: uncaught error while rendering — ${crashes[0]}`);
      }
      await page.addStyleTag({ content: `${HIDE.join(",")} { display: none !important }` });
      await page.screenshot({ path: join(OUT, `${shot.slug}-viewport.png`) });
      if (!shot.viewportOnly) {
        if (EXPAND.length > 0) {
          await page.addStyleTag({
            content: `${EXPAND.join(",")} { max-height: none !important; overflow: visible !important }`,
          });
        }
        await page.screenshot({ path: join(OUT, `${shot.slug}-full.png`), fullPage: true });
      }
      await page.close();
      console.log(`  ${shot.slug}`);
    }
    await writeFile(join(OUT, "index.html"), contactSheet(SHOTS), "utf8");
  } finally {
    await browser.close();
    stopDevServer(dev);
  }

  console.log(`\n${shots.length} shots in shots/ — open shots/index.html to pick.`);
  process.exit(0); // a dev server's children can outlive a plain kill()
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
