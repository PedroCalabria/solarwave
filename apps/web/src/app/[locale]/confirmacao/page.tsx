import { notFound } from "next/navigation";
import { ConfirmationView } from "@/components/app/ConfirmationView";
import { COPY } from "@/lib/copy";
import { isLocale } from "@/lib/i18n";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <ConfirmationView t={COPY[locale]} locale={locale} />;
}
