import { getDb, getLeadById } from "@solarwave/db";
import { notFound } from "next/navigation";
import { ConfirmationView } from "@/components/app/ConfirmationView";
import { COPY } from "@/lib/copy";
import { isLocale } from "@/lib/i18n";
import type { Submission } from "@/lib/submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the created lead by id from the redirect query (design D9). Falls back
 * to the sessionStorage snapshot on the client when the id is missing or the
 * database is unavailable, so the demo path never shows a broken screen.
 */
async function loadSubmission(leadId: string | undefined): Promise<Submission | null> {
  if (!leadId || !UUID.test(leadId)) return null;
  try {
    const lead = await getLeadById(getDb(), leadId);
    if (!lead) return null;
    return { name: lead.name, phone: lead.phone, email: lead.email, callLang: lead.preferredCallLanguage };
  } catch {
    return null;
  }
}

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ lead?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { lead } = await searchParams;
  const initial = await loadSubmission(lead);

  return <ConfirmationView t={COPY[locale]} locale={locale} initial={initial} />;
}
