import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { SiteNav } from "@/components/app/SiteNav";
import { LeadForm } from "@/components/app/LeadForm";
import { BenefitIcon } from "@/components/ds/Icon";
import {
  DisplayHeading,
  Lede,
  MetricCard,
  SectionLabel,
  StepRow,
} from "@/components/ds/soltera";
import { Button, Card } from "@/components/ds/solarvault";
import { COPY } from "@/lib/copy";
import { isLocale } from "@/lib/i18n";
import styles from "./landing.module.css";

const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--label-2)",
  letterSpacing: ".14em",
  textTransform: "uppercase",
};

function PulseDot({
  size = 6,
  color = "var(--white)",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flex: "0 0 auto",
        animation: "solPulse 1800ms var(--ease-out) infinite",
      }}
    />
  );
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = COPY[locale];

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroBg} data-parallax="0.28" />
        <div className={styles.heroScrim} />

        <div className={styles.heroInner}>
          <SiteNav
            locale={locale}
            items={["Home", t.benefitsTitle, t.howTitle]}
            active="Home"
            ctaLabel={t.cta}
          />

          <div className={styles.heroGrid}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  animation: "solRise 800ms var(--ease-out) both",
                }}
              >
                <PulseDot />
                <span
                  style={{
                    ...mono,
                    fontSize: "var(--label-1)",
                    letterSpacing: ".16em",
                    color: "rgba(255,255,255,.72)",
                  }}
                >
                  {t.kicker}
                </span>
              </div>

              <div
                style={{
                  marginTop: "var(--space-5)",
                  animation: "solRise 900ms var(--ease-out) both",
                  animationDelay: "100ms",
                }}
              >
                <DisplayHeading
                  as="h1"
                  tone="light"
                  size="clamp(44px, 5.4vw, 84px)"
                >
                  {t.heroTitle}
                </DisplayHeading>
              </div>

              <p
                style={{
                  fontSize: "var(--body-1)",
                  lineHeight: 1.55,
                  color: "var(--text-onDark-muted)",
                  margin: "var(--space-6) 0 0",
                  maxWidth: "44ch",
                  textWrap: "pretty",
                  animation: "solRise 900ms var(--ease-out) both",
                  animationDelay: "220ms",
                }}
              >
                {t.heroSub}
              </p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-4)",
                  marginTop: "var(--space-8)",
                  flexWrap: "wrap",
                  animation: "solRise 900ms var(--ease-out) both",
                  animationDelay: "320ms",
                }}
              >
                <Button variant="primary" trailingArrow href="#lead-form">
                  {t.cta}
                </Button>
                <span
                  style={{
                    ...mono,
                    fontSize: "var(--label-1)",
                    letterSpacing: ".1em",
                    color: "rgba(255,255,255,.55)",
                  }}
                >
                  {t.ctaNote}
                </span>
              </div>

              <div
                className={styles.heroPills}
                style={{
                  animation: "solRise 900ms var(--ease-out) both",
                  animationDelay: "420ms",
                }}
              >
                <div>
                  <div className={styles.heroPillValue}>{t.heroPillAValue}</div>
                  <div className={styles.heroPillBody}>{t.heroPillABody}</div>
                </div>
                <div>
                  <div className={styles.heroPillValue}>{t.heroPillBValue}</div>
                  <div className={styles.heroPillBody}>{t.heroPillBBody}</div>
                </div>
              </div>
            </div>

            <div className={styles.heroAside}>
              <div className={styles.metricCard}>
                <div style={{ ...mono, color: "var(--text-muted)" }}>
                  {t.metricLabel}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "var(--display-3)",
                    letterSpacing: "-.02em",
                    color: "var(--text-strong)",
                    marginTop: "var(--space-3)",
                  }}
                >
                  {t.metricValue}
                </div>
                <div
                  style={{
                    fontSize: "var(--body-3)",
                    lineHeight: 1.45,
                    color: "var(--text-muted)",
                    marginTop: 6,
                  }}
                >
                  {t.metricBody}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.heroFoot}>
            <div className={styles.watermark}>SolarWave</div>
            <span
              style={{
                ...mono,
                letterSpacing: ".18em",
                color: "rgba(255,255,255,.6)",
                paddingBottom: "var(--space-5)",
                whiteSpace: "nowrap",
                animation: "solHint 2400ms var(--ease-out) infinite",
              }}
            >
              {t.scrollHint}
            </span>
          </div>
        </div>
      </header>

      {/* ---- Benefits ---- */}
      <section className={styles.section}>
        <div className={styles.sectionHead} data-reveal>
          <SectionLabel>{t.benefitsTitle}</SectionLabel>
          <Lede strong={t.benefitsLedeStrong} muted={t.benefitsLedeMuted} />
        </div>

        <div className={styles.benefitGrid} data-reveal>
          {t.benefits.map((b) => (
            <Card key={b.n} title={b.title} style={{ height: "100%" }}>
              <BenefitIcon
                name={b.icon}
                style={{
                  marginBottom: "var(--space-2)",
                  color: "var(--olive-800)",
                }}
              />
              {b.body}
            </Card>
          ))}
        </div>

        <div className={styles.mobileList} data-reveal>
          {t.benefits.map((b) => (
            <div key={b.n} className={styles.mobileRow}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-1)",
                  color: "var(--text-muted)",
                  letterSpacing: ".06em",
                  paddingTop: 2,
                }}
              >
                {b.n}
              </span>
              <div>
                <div
                  style={{
                    fontSize: "var(--title-2)",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "var(--title-tracking)",
                    color: "var(--text-strong)",
                  }}
                >
                  {b.title}
                </div>
                <div
                  style={{
                    fontSize: "var(--body-2)",
                    lineHeight: 1.5,
                    color: "var(--text-muted)",
                    marginTop: 5,
                    textWrap: "pretty",
                  }}
                >
                  {b.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.co2Grid} data-reveal>
          <MetricCard
            image="/assets/imagery/eco-crop.webp"
            metric={t.co2Value}
            label={t.co2Label}
            height={210}
            imageWidth={190}
          >
            {t.co2Body}
          </MetricCard>

          <div className={styles.handoff}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <PulseDot size={7} />
              <span style={{ ...mono, color: "var(--text-onDark-muted)" }}>
                {t.handoffTag}
              </span>
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "-.02em",
                  lineHeight: 1,
                  fontSize: "var(--display-2)",
                  color: "var(--text-onDark)",
                }}
              >
                {t.handoffValue}
              </div>
              <p
                style={{
                  fontSize: "var(--body-3)",
                  lineHeight: 1.5,
                  color: "var(--text-onDark-muted)",
                  margin: "var(--space-3) 0 0",
                  maxWidth: "34ch",
                  textWrap: "pretty",
                }}
              >
                {t.handoffBody}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className={`${styles.section} ${styles.howBand}`}>
        <div className={styles.sectionHead} data-reveal>
          <SectionLabel>{t.howTitle}</SectionLabel>
          <Lede strong={t.howLedeStrong} muted={t.howLedeMuted} />
        </div>

        <div className={styles.steps} data-reveal>
          {t.steps.map((s) => (
            <StepRow
              key={s.step}
              image={s.image}
              step={s.step}
              title={s.title}
              height={216}
            >
              {s.body}
            </StepRow>
          ))}
        </div>

        <div className={styles.mobileSteps} data-reveal>
          {t.steps.map((s) => (
            <div key={s.step} className={styles.mobileStep}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 17,
                  color: "var(--text-onDark)",
                  letterSpacing: "-.02em",
                }}
              >
                {s.step}
              </span>
              <div>
                <div
                  style={{
                    fontSize: "var(--title-2)",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "var(--title-tracking)",
                    color: "var(--text-onDark)",
                  }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    fontSize: "var(--body-2)",
                    lineHeight: 1.5,
                    color: "var(--text-onDark-muted)",
                    marginTop: 5,
                    textWrap: "pretty",
                  }}
                >
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Lead form ---- */}
      <section id="lead-form" className={styles.formBand}>
        <div className={styles.formGrid} data-reveal>
          <div>
            <SectionLabel tone="light">{t.formEyebrow}</SectionLabel>
            <DisplayHeading
              tone="light"
              size="var(--display-2)"
              style={{ marginTop: 18 }}
            >
              {t.formTitle}
            </DisplayHeading>
            <p
              style={{
                fontSize: "var(--body-1)",
                lineHeight: 1.55,
                color: "var(--text-onDark-muted)",
                margin: "var(--space-5) 0 0",
                maxWidth: "44ch",
                textWrap: "pretty",
              }}
            >
              {t.formSub}
            </p>

            <div className={styles.aiNotice}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <PulseDot size={7} />
                <span
                  style={{
                    ...mono,
                    fontSize: "var(--label-1)",
                    color: "var(--white)",
                  }}
                >
                  {t.aiNoticeTitle}
                </span>
              </div>
              <p
                style={{
                  fontSize: "var(--body-2)",
                  lineHeight: 1.55,
                  color: "var(--text-onDark-muted)",
                  margin: "var(--space-3) 0 0",
                  maxWidth: "52ch",
                  textWrap: "pretty",
                }}
              >
                {t.aiNoticeBody}
              </p>
            </div>
          </div>

          <LeadForm t={t} locale={locale} />
        </div>
      </section>

      <footer className={styles.footer}>
        <span
          style={{ ...mono, letterSpacing: ".1em", color: "var(--text-muted)" }}
        >
          © 2026 SolarWave Energia
        </span>
        <span
          style={{ ...mono, letterSpacing: ".1em", color: "var(--text-muted)" }}
        >
          {t.privacy}
        </span>
      </footer>
    </div>
  );
}
