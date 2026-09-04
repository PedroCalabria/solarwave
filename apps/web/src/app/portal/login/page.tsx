import { DisplayHeading } from "@/components/ds/soltera";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata = { title: "Sign in · SolarWave console" };

const STATS = [
  { value: "2 min", label: "target call length" },
  { value: "3", label: "attempts per lead" },
  { value: "08–22h", label: "calling window" },
];

const ERRORS: Record<string, string> = {
  not_employee: "Your account is not an active SolarWave employee.",
  auth_not_configured: "Authentication is not configured on this deployment.",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className={styles.screen}>
      <aside className={styles.aside}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/imagery/human-especialist-crop.webp" alt="" className={styles.asideImg} />
        <div className={styles.asideScrim} />
        <div className={styles.asideInner}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
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
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--label-2)",
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.6)",
              }}
            >
              internal
            </span>
          </div>

          <div style={{ animation: "solRise 800ms var(--ease-out) both" }}>
            <DisplayHeading as="h1" tone="light" size="clamp(40px, 4.4vw, 64px)">
              Lead qualification console
            </DisplayHeading>
            <p
              style={{
                fontSize: "var(--body-1)",
                lineHeight: 1.55,
                color: "var(--text-onDark-muted)",
                margin: "var(--space-5) 0 0",
                maxWidth: "46ch",
                textWrap: "pretty",
              }}
            >
              Every inbound lead is called by the AI agent, scored against your criteria and handed to sales
              with an icebreaker. You pick up where the call left off.
            </p>

            <div className={styles.stats}>
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                      fontSize: "var(--display-3)",
                      letterSpacing: "-.02em",
                      color: "var(--text-onDark)",
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--label-2)",
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,.6)",
                      marginTop: 6,
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <LoginForm initialError={error ? (ERRORS[error] ?? null) : null} next={next ?? ""} />
      </main>
    </div>
  );
}
