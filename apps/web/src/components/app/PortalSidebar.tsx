"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AUDIT, CRITERIA, LEADS } from "@/lib/leads";
import styles from "@/app/portal/portal.module.css";

const NAV = [
  { href: "/portal/leads", label: "Leads", count: String(LEADS.length) },
  {
    href: "/portal/criteria",
    label: "Criteria",
    count: String(CRITERIA.filter((c) => c.active).length),
  },
  { href: "/portal/audit", label: "Audit history", count: String(AUDIT.length) },
];

export function PortalSidebar() {
  const pathname = usePathname();
  const router = useRouter();

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
          {NAV.map((item) => {
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
          LP
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--body-2)", fontWeight: 500, color: "var(--text-strong)" }}>
            Lucas Prado
          </div>
          <div style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>Sales ops</div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/portal/login")}
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
          }}
        >
          Exit
        </button>
      </div>
    </div>
  );
}
