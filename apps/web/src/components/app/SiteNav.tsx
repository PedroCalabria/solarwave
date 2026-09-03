"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PillButton } from "@/components/ds/soltera";
import { LOCALES, type Locale } from "@/lib/i18n";
import styles from "./SiteNav.module.css";

/**
 * Soltera's TopNav, minus the SearchPill it hardcodes — there is nothing to
 * search on a lead-capture page, and the design never wired it to anything.
 */
export function SiteNav({
  locale,
  items,
  active,
  ctaLabel,
}: {
  locale: Locale;
  items: string[];
  active: string;
  ctaLabel: string;
}) {
  const pathname = usePathname();
  const fg = "var(--text-onDark)";
  const dim = "rgba(255,255,255,.62)";

  const scrollToForm = () => {
    document.getElementById("lead-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Swap only the locale segment so the language toggle keeps the current screen. */
  const withLocale = (next: Locale) => {
    const rest = pathname.split("/").slice(2).join("/");
    return `/${next}${rest ? `/${rest}` : ""}`;
  };

  return (
    <nav className={styles.nav}>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: fg,
        }}
      >
        SolarWave
      </span>

      <span className={styles.langs}>
        {LOCALES.map((code) => (
          <Link
            key={code}
            href={withLocale(code)}
            aria-current={code === locale ? "true" : undefined}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--label-1)",
              letterSpacing: "var(--label-tracking)",
              textTransform: "uppercase",
              color: code === locale ? fg : dim,
            }}
          >
            {code}
          </Link>
        ))}
      </span>

      <span className={styles.links}>
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={scrollToForm}
            className={styles.link}
            style={{ color: item === active ? fg : dim }}
          >
            {item}
          </button>
        ))}
      </span>

      <span className={styles.cta}>
        <PillButton size="md" onClick={scrollToForm}>
          {ctaLabel}
        </PillButton>
      </span>
    </nav>
  );
}
