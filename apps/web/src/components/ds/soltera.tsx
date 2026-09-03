"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * React ports of `SolteraDesignSystem_b1d19a`. Styles are transcribed from the
 * published bundle so the token bindings stay identical; only the runtime
 * (React 19 + TS) differs.
 */

type Tone = "dark" | "light";

export function DisplayHeading({
  children,
  size = "var(--display-2)",
  tone = "dark",
  as: Tag = "h2",
  style,
}: {
  children: ReactNode;
  size?: string;
  tone?: Tone;
  as?: "h1" | "h2" | "h3" | "div";
  style?: CSSProperties;
}) {
  return (
    <Tag
      style={{
        margin: 0,
        fontFamily: "var(--font-display)",
        fontWeight: "var(--display-weight)" as CSSProperties["fontWeight"],
        textTransform: "uppercase",
        letterSpacing: "var(--display-tracking)",
        lineHeight: "var(--display-leading)",
        fontSize: size,
        color: tone === "dark" ? "var(--text-strong)" : "var(--text-onDark)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export function Lede({
  strong = "",
  muted = "",
  size = "var(--lede-1)",
  tone = "dark",
  style,
}: {
  strong?: string;
  muted?: string;
  size?: string;
  tone?: Tone;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: "var(--font-ui)",
        fontSize: size,
        lineHeight: "var(--lede-leading)",
        letterSpacing: "var(--lede-tracking)",
        textWrap: "pretty",
        color: tone === "dark" ? "var(--text-strong)" : "var(--text-onDark)",
        ...style,
      }}
    >
      {strong}
      {muted ? " " : null}
      {muted ? (
        <span
          style={{
            color: tone === "dark" ? "var(--text-muted)" : "var(--text-onDark-muted)",
          }}
        >
          {muted}
        </span>
      ) : null}
    </p>
  );
}

export function SectionLabel({
  children,
  marker = true,
  tone = "dark",
  style,
}: {
  children: ReactNode;
  marker?: boolean;
  tone?: Tone;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, ...style }}>
      {marker ? (
        <Icon
          name="chevrons-left"
          size={11}
          color={tone === "dark" ? "var(--ink-400)" : "var(--text-onDark-muted)"}
          style={{ marginTop: 2 }}
        />
      ) : null}
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--label-1)",
          fontWeight: 500,
          letterSpacing: "var(--label-tracking)",
          textTransform: "uppercase",
          lineHeight: 1.25,
          maxWidth: "16ch",
          color: tone === "dark" ? "var(--text-strong)" : "var(--text-onDark)",
        }}
      >
        {children}
      </span>
    </div>
  );
}

export function PillButton({
  children,
  variant = "primary",
  size = "md",
  icon = "arrow-right",
  showKnob = true,
  disabled = false,
  onClick,
  type = "button",
  style,
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "light";
  size?: "md" | "sm";
  icon?: IconName;
  showKnob?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
}) {
  const sm = size === "sm";
  const dark = variant === "primary";
  const light = variant === "light";

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sm ? 10 : 14,
        height: sm ? "var(--control-h-sm)" : "var(--control-h)",
        padding: showKnob ? (sm ? "0 4px 0 16px" : "0 6px 0 22px") : sm ? "0 16px" : "0 22px",
        borderRadius: "var(--radius-pill)",
        border: variant === "ghost" ? "1px solid var(--line-hairline)" : "none",
        fontFamily: "var(--font-ui)",
        fontSize: sm ? "var(--body-3)" : "var(--body-2)",
        fontWeight: 500,
        letterSpacing: ".01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: dark
          ? "var(--action-fill)"
          : light
            ? "var(--action-fill-light)"
            : "transparent",
        color: dark ? "var(--action-fg)" : "var(--action-fg-light)",
        transition:
          "background var(--dur-base) var(--ease-out),transform var(--dur-fast) var(--ease-out)",
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(.98)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "none";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        if (!disabled && dark) e.currentTarget.style.background = "var(--action-fill)";
      }}
      onMouseEnter={(e) => {
        if (!disabled && dark) e.currentTarget.style.background = "var(--action-fill-hover)";
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{children}</span>
      {showKnob ? (
        <span
          style={{
            width: sm ? "26px" : "var(--knob)",
            height: sm ? "26px" : "var(--knob)",
            borderRadius: "999px",
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            background: dark ? "var(--action-knob)" : "var(--action-fill)",
          }}
        >
          {/* The Soltera bundle hardcodes ink-900 on the primary knob, which
              worked when --action-knob was white. This screen's remap flips
              --action-knob to ink-900 and --action-fill to yellow, so the
              literal values would paint dark-on-dark. Colours follow the knob. */}
          <Icon
            name={icon}
            size={sm ? 13 : 15}
            color={dark ? "var(--white)" : "var(--ink-900)"}
          />
        </span>
      ) : null}
    </button>
  );
}

export function MetricCard({
  image,
  metric,
  label,
  children,
  imageWidth = 132,
  height = 200,
  style,
}: {
  image?: string;
  metric: string;
  label: string;
  children: ReactNode;
  imageWidth?: number;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        padding: 6,
        height,
        alignItems: "stretch",
        ...style,
      }}
    >
      <div
        style={{
          width: imageWidth,
          flex: "0 0 auto",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: "var(--ink-200)",
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "16px 22px 18px",
          minWidth: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "var(--display-3)",
              letterSpacing: "-.02em",
              lineHeight: 1,
              color: "var(--text-strong)",
            }}
          >
            {metric}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: "var(--title-2)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "var(--title-tracking)",
              color: "var(--text-strong)",
            }}
          >
            {label}
          </div>
        </div>
        <div
          style={{
            fontSize: "var(--body-3)",
            lineHeight: 1.45,
            color: "var(--text-muted)",
            maxWidth: "42ch",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function StatPill({
  value,
  children,
  align = "center",
  width = 170,
  style,
}: {
  value: string;
  children: ReactNode;
  align?: CSSProperties["textAlign"];
  width?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        padding: "18px 20px 20px",
        borderRadius: "var(--radius-lg)",
        background: "var(--white)",
        boxShadow: "var(--shadow-float)",
        textAlign: align,
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "-.01em",
          lineHeight: 1.05,
          fontSize: "var(--title-2)",
          color: "var(--text-strong)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: "var(--body-3)",
          lineHeight: 1.4,
          color: "var(--text-muted)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function StepRow({
  image,
  step,
  title,
  children,
  height = 230,
  className,
  style,
}: {
  image?: string;
  step: string;
  title: string;
  children: ReactNode;
  height?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        gap: 0,
        background: "var(--surface-card-raised)",
        borderRadius: "var(--radius-xl)",
        padding: 6,
        height,
        alignItems: "stretch",
        ...style,
      }}
    >
      <div
        style={{
          width: "38%",
          flex: "0 0 auto",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: "var(--ink-200)",
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "18px 26px 20px",
          minWidth: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "var(--display-3)",
              letterSpacing: "-.02em",
              lineHeight: 1,
              color: "var(--text-strong)",
            }}
          >
            {step}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: "var(--title-2)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "var(--title-tracking)",
              color: "var(--text-strong)",
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{
            fontSize: "var(--body-3)",
            lineHeight: 1.5,
            color: "var(--text-muted)",
            maxWidth: "62ch",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
