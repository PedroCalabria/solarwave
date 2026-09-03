"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { DisplayHeading, PillButton, SectionLabel } from "@/components/ds/soltera";
import type { Copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { useSubmission } from "@/lib/useSubmission";
import styles from "@/app/[locale]/confirmacao/confirm.module.css";

const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--label-2)",
  letterSpacing: ".12em",
  textTransform: "uppercase",
};

export function ConfirmationView({ t, locale }: { t: Copy; locale: Locale }) {
  const router = useRouter();
  // Null until hydration, which just means the em-dash placeholders show first.
  const submission = useSubmission();

  const firstName = submission?.name?.split(" ")[0];
  const title = firstName ? `${t.confirmTitlePrefix}${firstName}` : t.confirmTitleFallback;

  const rows = [
    { label: t.rowName, value: submission?.name || "—" },
    { label: t.rowPhone, value: submission?.phone || "—" },
    { label: t.rowEmail, value: submission?.email || "—" },
    { label: t.rowLang, value: submission?.callLang === "en" ? t.langEn : t.langPt },
    { label: t.rowWindow, value: t.windowValue },
  ];

  return (
    <div className={styles.screen}>
      <aside className={styles.aside}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/imagery/turbine-coast-crop.png"
          alt=""
          className={styles.asideImg}
        />
        <div className={styles.asideScrim} />
        <div className={styles.asideInner}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--text-onDark)",
            }}
          >
            SolarWave
          </span>
          <div style={{ animation: "solRise 800ms var(--ease-out) both", animationDelay: "120ms" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--white)",
                  animation: "solPulse 1800ms var(--ease-out) infinite",
                }}
              />
              <span style={{ ...mono, fontSize: "var(--label-1)", letterSpacing: ".14em", color: "var(--white)" }}>
                {t.confirmAiTag}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--lede-2)",
                lineHeight: "var(--lede-leading)",
                letterSpacing: "var(--lede-tracking)",
                color: "var(--text-onDark)",
                margin: "var(--space-4) 0 0",
                maxWidth: "24ch",
                textWrap: "pretty",
              }}
            >
              {t.confirmAiTitle}
            </p>
            <p
              style={{
                fontSize: "var(--body-2)",
                lineHeight: 1.55,
                color: "var(--text-onDark-muted)",
                margin: "var(--space-4) 0 0",
                maxWidth: "46ch",
                textWrap: "pretty",
              }}
            >
              {t.confirmAiBody}
            </p>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainInner}>
          <SectionLabel>{t.confirmEyebrow}</SectionLabel>
          <DisplayHeading as="h1" size="var(--display-2)" style={{ marginTop: 18 }}>
            {title}
          </DisplayHeading>
          <p
            style={{
              fontSize: "var(--body-1)",
              lineHeight: 1.55,
              color: "var(--text-body)",
              margin: "var(--space-5) 0 0",
              textWrap: "pretty",
            }}
          >
            {t.confirmSub}
          </p>

          <dl className={styles.rows}>
            {rows.map((row) => (
              <div key={row.label} className={styles.row}>
                <dt style={{ ...mono, color: "var(--text-muted)", margin: 0 }}>{row.label}</dt>
                <dd
                  style={{
                    fontSize: "var(--body-2)",
                    fontWeight: 500,
                    color: "var(--text-strong)",
                    textAlign: "right",
                    margin: 0,
                  }}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <ol className={styles.next}>
            {t.confirmNext.map((step) => (
              <li key={step.n} className={styles.nextItem}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--label-1)",
                    color: "var(--text-muted)",
                    letterSpacing: ".06em",
                  }}
                >
                  {step.n}
                </span>
                <span style={{ fontSize: "var(--body-2)", lineHeight: 1.55, color: "var(--text-body)", textWrap: "pretty" }}>
                  {step.body}
                </span>
              </li>
            ))}
          </ol>

          <div className={styles.actions}>
            <PillButton variant="ghost" icon="arrow-left" onClick={() => router.push(`/${locale}`)}>
              {t.confirmBack}
            </PillButton>
            <span style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", maxWidth: "30ch" }}>
              {t.confirmHelp}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
