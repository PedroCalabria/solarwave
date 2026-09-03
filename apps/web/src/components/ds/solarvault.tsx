import type { CSSProperties, ReactNode } from "react";

/**
 * React ports of `SolarVaultDesignSystem_2c7141`. Only the two components the
 * lead platform actually imports — Button and Card — transcribed from the
 * published bundle.
 */

const SIZES = {
  sm: { h: 32, px: 16, fs: 12 },
  md: { h: 40, px: 22, fs: 13 },
  lg: { h: 64, px: 28, fs: 34 },
} as const;

const LOOKS = {
  primary: {
    background: "var(--action-primary)",
    color: "var(--text-on-accent)",
    border: "1px solid transparent",
  },
  dark: {
    background: "var(--action-dark)",
    color: "var(--white)",
    border: "1px solid transparent",
  },
  outline: {
    background: "transparent",
    color: "var(--text-strong)",
    border: "1px solid var(--border-subtle)",
  },
  glass: {
    background: "var(--surface-glass)",
    color: "var(--white)",
    border: "1px solid var(--border-glass)",
    backdropFilter: "var(--blur-glass)",
  },
  link: {
    background: "transparent",
    color: "var(--text-link)",
    border: "1px solid transparent",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
} as const;

function Glyph({ s }: { s: number }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13M12 5l7 7-7 7" />
    </svg>
  );
}

function Arrow({ size }: { size: keyof typeof SIZES }) {
  if (size === "lg") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "54px",
          height: "54px",
          borderRadius: "var(--radius-circle)",
          background: "var(--action-dark)",
          color: "var(--white)",
          flex: "0 0 auto",
        }}
      >
        <Glyph s={22} />
      </span>
    );
  }
  return <Glyph s={14} />;
}

export function Button({
  variant = "primary",
  size = "md",
  trailingArrow = false,
  fullWidth = false,
  disabled = false,
  children,
  onClick,
  href,
  type = "button",
  style,
}: {
  variant?: keyof typeof LOOKS;
  size?: keyof typeof SIZES;
  trailingArrow?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  /** Renders an <a> instead of a <button>, as the source component does. */
  href?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
}) {
  const s = SIZES[size] ?? SIZES.md;
  const look = LOOKS[variant] ?? LOOKS.primary;
  const isLink = variant === "link";
  const Tag = href ? "a" : "button";

  return (
    <Tag
      href={href}
      type={href ? undefined : type}
      onClick={onClick}
      disabled={href ? undefined : disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: size === "lg" ? "var(--space-6)" : "var(--space-2)",
        height: isLink ? "auto" : `${s.h}px`,
        padding: isLink ? 0 : `0 ${s.px}px`,
        fontFamily: "var(--font-ui)",
        fontSize: `${s.fs}px`,
        fontWeight: "var(--fw-bold)" as CSSProperties["fontWeight"],
        lineHeight: 1,
        letterSpacing: 0,
        borderRadius: size === "lg" ? "var(--radius-xs)" : "var(--radius-button)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        width: fullWidth ? "100%" : "auto",
        textDecoration: "textDecoration" in look ? look.textDecoration : "none",
        whiteSpace: "nowrap",
        transition: "var(--transition-ui)",
        ...look,
        ...style,
      }}
    >
      {children}
      {trailingArrow ? <Arrow size={size} /> : null}
    </Tag>
  );
}

export function Card({
  tone = "light",
  padding = "var(--pad-card)",
  eyebrow,
  title,
  children,
  footer,
  style,
}: {
  tone?: "light" | "dark";
  padding?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  style?: CSSProperties;
}) {
  const dark = tone === "dark";
  return (
    <div
      style={{
        background: dark ? "var(--surface-card-dark)" : "var(--surface-card)",
        border: `1px solid ${dark ? "var(--border-dark)" : "transparent"}`,
        borderRadius: "var(--radius-card)",
        padding,
        boxShadow: dark ? "none" : "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        ...style,
      }}
    >
      {eyebrow ? (
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-eyebrow-size)",
            letterSpacing: "var(--type-eyebrow-track)",
            textTransform: "uppercase",
            fontWeight: "var(--fw-bold)" as CSSProperties["fontWeight"],
            color: dark ? "var(--yellow-400)" : "var(--text-accent)",
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      {title ? (
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-h4-size)",
            lineHeight: "var(--type-h4-lh)",
            fontWeight: "var(--fw-bold)" as CSSProperties["fontWeight"],
            color: dark ? "var(--text-on-dark)" : "var(--text-heading)",
          }}
        >
          {title}
        </h3>
      ) : null}
      {children ? (
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--type-body-sm-size)",
            lineHeight: "var(--type-body-sm-lh)",
            color: dark ? "var(--text-body-on-dark)" : "var(--text-body)",
          }}
        >
          {children}
        </div>
      ) : null}
      {footer ? <div style={{ marginTop: "var(--space-2)" }}>{footer}</div> : null}
    </div>
  );
}
