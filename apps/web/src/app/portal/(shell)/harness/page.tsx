import { hasApiKey } from "@solarwave/ai";
import { getDb, listActiveCriteria } from "@solarwave/db";
import { callOrder } from "@solarwave/agent/criteria";
import { VoiceHarness } from "@/components/app/VoiceHarness";
import { getCurrentEmployee } from "@/lib/auth";
import { redirect } from "next/navigation";
import styles from "@/app/portal/portal.module.css";

export const dynamic = "force-dynamic";

/**
 * The browser microphone harness (voice-bridge task 7).
 *
 * Admin-only, because a session spends realtime model quota. It writes nothing:
 * no attempt, no lead transition, no scoring — which is what separates it from
 * the simulated call on the lead detail, and what makes it safe to run as often
 * as debugging needs.
 */
export default async function HarnessPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/portal/login?error=not_employee");
  if (employee.role !== "admin") redirect("/portal/leads?error=admin_only");

  const criteria = callOrder(await listActiveCriteria(getDb()));

  return (
    <div style={{ display: "grid", gap: "var(--space-5)", padding: "var(--space-5)" }}>
      <header>
        <h1 style={{ fontSize: "var(--title-2)", margin: 0 }}>Voice harness</h1>
        <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)", margin: "var(--space-2) 0 0", maxWidth: "62ch", textWrap: "pretty" }}>
          The realtime agent, driven by your microphone. Same script, same tools, same 90-second wrap-up and
          three-minute stop as a telephone call — without one. Needs <span className={styles.mono}>pnpm dev:voice</span>{" "}
          locally: <span className={styles.mono}>next dev</span> does not perform the WebSocket upgrade.
        </p>
      </header>

      {!hasApiKey() ? (
        <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
          No model API key is configured, so a session cannot start.
        </p>
      ) : null}

      {criteria.length === 0 ? (
        <p style={{ fontSize: "var(--body-3)", color: "var(--text-muted)" }}>
          No criterion is active, so there is nothing to ask. Activate one first.
        </p>
      ) : (
        <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", padding: 22 }}>
          <div className={styles.mono}>The agent will ask, in this order</div>
          <ol style={{ margin: "var(--space-3) 0 0", paddingLeft: 20, fontSize: "var(--body-3)", lineHeight: 1.6 }}>
            {criteria.map((c) => (
              <li key={c.key}>
                {c.label}
                {c.blocking ? (
                  <span className={styles.mono} style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                    blocking
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      <VoiceHarness />
    </div>
  );
}
