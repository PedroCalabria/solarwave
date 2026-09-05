"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/portal/login/actions";
import styles from "@/app/portal/portal.module.css";

type Props = {
  employee: { name: string; role: "agent" | "admin" };
  counts: { leads: number; criteria: number; audit: number; violations: number };
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PortalSidebar({ employee, counts }: Props) {
  const pathname = usePathname();

  const nav = [
    { href: "/portal/leads", label: "Leads", count: String(counts.leads) },
    { href: "/portal/criteria", label: "Criteria", count: String(counts.criteria) },
    { href: "/portal/violations", label: "Guardrails", count: String(counts.violations) },
    { href: "/portal/audit", label: "Audit history", count: String(counts.audit) },
  ];

  return (
    <div className={styles.sidebar}>
      <div>
        <div className={styles.brand}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--text-strong)",
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
              color: "var(--text-muted)",
            }}
          >
            console
          </span>
        </div>

        <nav className={styles.navList}>
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navItem}
                aria-current={active ? "page" : undefined}
                style={{
                  background: active ? "var(--ink-900)" : "transparent",
                  color: active ? "var(--white)" : "var(--text-body)",
                }}
              >
                <span>{item.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--label-2)", opacity: 0.6 }}>
                  {item.count}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className={styles.account}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--ink-900)",
            color: "var(--white)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--label-1)",
            flex: "0 0 auto",
          }}
        >
          {initials(employee.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className={styles.truncate}
            style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}
          >
            {employee.name}
          </div>
          <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", textTransform: "capitalize" }}>
            {employee.role}
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            style={{
              border: "1px solid var(--line-hairline)",
              background: "transparent",
              borderRadius: "var(--radius-pill)",
              padding: "5px 11px",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--label-2)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            Exit
          </button>
        </form>
      </div>
    </div>
  );
}
