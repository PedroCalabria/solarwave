"use client";

import { useActionState, type CSSProperties } from "react";
import { DisplayHeading, PillButton } from "@/components/ds/soltera";
import { signInAction, type SignInState } from "./actions";
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

export function LoginForm({ initialError, next }: { initialError: string | null; next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, { error: initialError });

  return (
    <form className={styles.form} action={action}>
      <DisplayHeading size="var(--display-3)">Sign in</DisplayHeading>
      <p style={{ fontSize: "var(--body-2)", color: "var(--text-muted)", margin: "var(--space-3) 0 0" }}>
        Use your Soltera work account.
      </p>

      <input type="hidden" name="next" value={next} />

      <div className={styles.fields}>
        <div>
          <label htmlFor="l-email" style={labelStyle}>
            Work email
          </label>
          <input
            id="l-email"
            name="email"
            type="email"
            autoComplete="username"
            required
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
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••••"
            style={inputStyle}
          />
        </div>

        {state.error ? (
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
            {state.error}
          </div>
        ) : null}

        <div style={{ marginTop: "var(--space-2)" }}>
          <PillButton
            type="submit"
            variant="primary"
            disabled={pending}
            style={{ width: "100%", justifyContent: "space-between" }}
          >
            {pending ? "Signing in…" : "Sign in"}
          </PillButton>
        </div>
      </div>

      <p style={{ fontSize: "var(--body-3)", lineHeight: 1.5, color: "var(--text-muted)", margin: "var(--space-8) 0 0" }}>
        Access is logged. Lead data is confidential and covered by LGPD/GDPR handling rules.
      </p>
    </form>
  );
}
