"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds/solarvault";
import type { Copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { SUBMISSION_KEY, type Submission } from "@/lib/submission";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

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

const fieldStyle = (invalid: boolean): CSSProperties => ({
  width: "100%",
  height: "var(--control-h)",
  border: `1px solid ${invalid ? "var(--ink-900)" : "var(--line-hairline)"}`,
  background: "var(--ink-050)",
  borderRadius: "var(--radius-pill)",
  padding: "0 18px",
  fontSize: "var(--body-2)",
  color: "var(--text-strong)",
  outline: "none",
  transition: "border-color var(--dur-base) var(--ease-out)",
});

const errorStyle: CSSProperties = {
  fontSize: "var(--body-3)",
  color: "var(--ink-900)",
  marginTop: 6,
  paddingLeft: 4,
};

const helpStyle: CSSProperties = {
  fontSize: "var(--body-3)",
  color: "var(--text-muted)",
  marginTop: 6,
  paddingLeft: 4,
};

type Errors = Partial<Record<"name" | "phone" | "email" | "captcha" | "form", string>>;

type IntakeResponse = {
  status?: "created" | "existing";
  lead?: { id: string };
  error?: string;
  code?: string;
  fieldErrors?: Partial<Record<"name" | "phone" | "email", string>>;
};

/** Brazilian numbers only in phase 1: 10 or 11 national digits, optional +55. */
function looksBrazilian(phone: string): boolean {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  const national = digits.replace(/^0+/, "");
  return national.length === 10 || national.length === 11;
}

export function LeadForm({ t, locale }: { t: Copy; locale: Locale }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [callLang, setCallLang] = useState<Locale | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  /** Spec section 3.2: the call language defaults to pt when the visitor does not pick one. */
  const effectiveCallLang: Locale = callLang ?? "pt";

  const validate = (): Errors => {
    const next: Errors = {};
    if (name.trim().length < 3) next.name = t.errName;
    if (!looksBrazilian(phone)) next.phone = t.errPhone;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t.errEmail;
    if (TURNSTILE_SITE_KEY && !turnstileToken) next.captcha = t.errCaptcha;
    return next;
  };

  const submit = async () => {
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);

    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      preferredCallLanguage: effectiveCallLang,
      turnstileToken,
    };

    let leadId: string | null = null;
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as IntakeResponse | null;
      if (!res.ok) {
        if (body?.fieldErrors) {
          setErrors({ ...body.fieldErrors, form: body.error });
        } else if (body?.code === "captcha_missing" || body?.code === "captcha_failed") {
          setErrors({ captcha: t.errCaptcha });
        } else {
          setErrors({ form: body?.error ?? "Something went wrong. Please try again." });
        }
        setPending(false);
        return;
      }
      leadId = body?.lead?.id ?? null;
    } catch {
      setErrors({ form: "Network error. Please try again." });
      setPending(false);
      return;
    }

    const submission: Submission = {
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      callLang: effectiveCallLang,
    };
    try {
      sessionStorage.setItem(SUBMISSION_KEY, JSON.stringify(submission));
    } catch {
      // Private mode: the confirmation page falls back to the lead id in the URL.
    }
    router.push(leadId ? `/${locale}/confirmacao?lead=${leadId}` : `/${locale}/confirmacao`);
  };

  const langOptions: { code: Locale; label: string; note: string }[] = [
    { code: "pt", label: t.langPt, note: "Padrão / default" },
    { code: "en", label: t.langEn, note: "English-speaking agent" },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      style={{
        background: "var(--surface-card-raised)",
        borderRadius: "var(--radius-xl)",
        padding: 30,
      }}
    >
      <div className="leadFormRow">
        <div>
          <label htmlFor="lead-name" style={labelStyle}>
            {t.labelName}
          </label>
          <input
            id="lead-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.phName}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "lead-name-error" : undefined}
            style={fieldStyle(Boolean(errors.name))}
          />
          {errors.name ? (
            <div id="lead-name-error" style={errorStyle}>
              {errors.name}
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor="lead-phone" style={labelStyle}>
            {t.labelPhone}
          </label>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.phPhone}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "lead-phone-error" : "lead-phone-help"}
            style={fieldStyle(Boolean(errors.phone))}
          />
          {errors.phone ? (
            <div id="lead-phone-error" style={errorStyle}>
              {errors.phone}
            </div>
          ) : (
            <div id="lead-phone-help" style={helpStyle}>
              {t.phoneHelp}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <label htmlFor="lead-email" style={labelStyle}>
          {t.labelEmail}
        </label>
        <input
          id="lead-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.phEmail}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "lead-email-error" : undefined}
          style={fieldStyle(Boolean(errors.email))}
        />
        {errors.email ? (
          <div id="lead-email-error" style={errorStyle}>
            {errors.email}
          </div>
        ) : null}
      </div>

      <fieldset style={{ marginTop: "var(--space-6)", border: 0, padding: 0, margin: 0 }}>
        <legend style={{ ...labelStyle, marginTop: "var(--space-6)" }}>{t.labelCallLang}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
          {langOptions.map((option) => {
            const on = effectiveCallLang === option.code;
            return (
              <button
                key={option.code}
                type="button"
                aria-pressed={on}
                onClick={() => setCallLang(option.code)}
                style={{
                  textAlign: "left",
                  border: `1px solid ${on ? "var(--ink-900)" : "var(--line-hairline)"}`,
                  background: on ? "var(--ink-900)" : "var(--white)",
                  color: on ? "var(--white)" : "var(--text-strong)",
                  borderRadius: "var(--radius-md)",
                  padding: "13px 16px",
                  transition: "all var(--dur-base) var(--ease-out)",
                }}
              >
                <div
                  style={{
                    fontSize: "var(--body-2)",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "var(--title-tracking)",
                  }}
                >
                  {option.label}
                </div>
                <div style={{ fontSize: "var(--body-3)", opacity: 0.62, marginTop: 3 }}>{option.note}</div>
              </button>
            );
          })}
        </div>
        <div
          style={{
            fontSize: "var(--body-3)",
            color: "var(--text-muted)",
            marginTop: "var(--space-2)",
            paddingLeft: 4,
          }}
        >
          {t.callLangHelp}
        </div>
      </fieldset>

      {TURNSTILE_SITE_KEY ? (
        <div style={{ marginTop: "var(--space-5)" }}>
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            options={{ language: locale === "pt" ? "pt-br" : "en", theme: "light", size: "flexible" }}
            onSuccess={(token) => {
              setTurnstileToken(token);
              setErrors((prev) => ({ ...prev, captcha: undefined }));
            }}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
          {errors.captcha ? (
            <div role="alert" style={errorStyle}>
              {errors.captcha}
            </div>
          ) : null}
        </div>
      ) : null}

      {errors.form ? (
        <div
          role="alert"
          style={{
            marginTop: "var(--space-5)",
            background: "var(--surface-card)",
            borderLeft: "2px solid var(--ink-900)",
            fontSize: "var(--body-3)",
            color: "var(--text-strong)",
            padding: "10px 14px",
            borderRadius: "var(--radius-xs)",
          }}
        >
          {errors.form}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginTop: "var(--space-8)",
          flexWrap: "wrap",
        }}
      >
        <Button type="submit" variant="primary" trailingArrow disabled={pending}>
          {t.submit}
        </Button>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--label-2)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {t.submitNote}
        </span>
      </div>

      <p
        style={{
          fontSize: "var(--body-3)",
          lineHeight: 1.5,
          color: "var(--text-muted)",
          margin: "var(--space-5) 0 0",
          textWrap: "pretty",
        }}
      >
        {t.consent}
      </p>
    </form>
  );
}
