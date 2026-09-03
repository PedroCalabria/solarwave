"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import { LOGIN_STATS } from "@/lib/leads";
import styles from "./login.module.css";

const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--label-1)",
  fontWeight: 500,
  letterSpacing: "var(--label-tracking)",
  textTransform: "uppercase",
  color: "var(--text-strong)",
  marginBottom: "var(--space-2)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: "var(--control-h)",
  border: "1px solid var(--line-hairline)",
  background: "var(--white)",
  borderRadius: "var(--radius-pill)",
  padding: "0 18px",
  fontSize: "var(--body-2)",
  color: "var(--text-strong)",
  outline: "none",
};

/**
 * Sign-in screen. Auth is not wired yet — the spec leaves the employee identity
 * provider open — so any non-empty work email lands on the dashboard.
 */
export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("lucas.prado@soltera.com");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const signIn = () => {
    if (!email.trim()) {
      setError("Enter your work email to continue.");
      return;
    }
    setError(null);
    router.push("/portal/leads");
  };

  return (
    <div className={styles.screen}>
      <aside className={styles.aside}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/imagery/human-especialist-crop.webp"
          alt=""
          className={styles.asideImg}
        />
        <div className={styles.asideScrim} />
        <div className={styles.asideInner}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
            }}
          >
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
            <DisplayHeading
              as="h1"
              tone="light"
              size="clamp(40px, 4.4vw, 64px)"
            >
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
              Every inbound lead is called by the AI agent, scored against your
              criteria and handed to sales with an icebreaker. You pick up where
              the call left off.
            </p>

            <div className={styles.stats}>
              {LOGIN_STATS.map((stat) => (
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
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            signIn();
          }}
          noValidate
        >
          <DisplayHeading size="var(--display-3)">Sign in</DisplayHeading>
          <p
            style={{
              fontSize: "var(--body-2)",
              color: "var(--text-muted)",
              margin: "var(--space-3) 0 0",
            }}
          >
            Use your Soltera work account.
          </p>

          <div className={styles.fields}>
            <div>
              <label htmlFor="l-email" style={labelStyle}>
                Work email
              </label>
              <input
                id="l-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@soltera.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="l-pass" style={labelStyle}>
                Password
              </label>
              <input
                id="l-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                style={inputStyle}
              />
            </div>

            {error ? (
              <div
                role="alert"
                style={{
                  background: "var(--surface-card)",
                  borderLeft: "2px solid var(--ink-900)",
                  fontSize: "var(--body-3)",
                  color: "var(--text-strong)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-xs)",
                }}
              >
                {error}
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  fontSize: "var(--body-3)",
                  color: "var(--text-body)",
                }}
              >
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={() => setRemember((v) => !v)}
                  style={{
                    width: 15,
                    height: 15,
                    accentColor: "var(--ink-900)",
                  }}
                />
                Keep me signed in
              </label>
              <a
                href="#reset"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-2)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                }}
              >
                Forgot password
              </a>
            </div>

            <div style={{ marginTop: "var(--space-2)" }}>
              <PillButton
                type="submit"
                variant="primary"
                style={{ width: "100%", justifyContent: "space-between" }}
              >
                Sign in
              </PillButton>
            </div>

            <div className={styles.divider}>
              <div className={styles.dividerLine} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--label-2)",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                or
              </span>
              <div className={styles.dividerLine} />
            </div>

            <PillButton
              variant="ghost"
              icon="key-round"
              onClick={signIn}
              style={{ width: "100%", justifyContent: "space-between" }}
            >
              Continue with company SSO
            </PillButton>
          </div>

          <p
            style={{
              fontSize: "var(--body-3)",
              lineHeight: 1.5,
              color: "var(--text-muted)",
              margin: "var(--space-8) 0 0",
            }}
          >
            Access is logged. Lead data is confidential and covered by LGPD/GDPR
            handling rules.
          </p>
        </form>
      </main>
    </div>
  );
}
