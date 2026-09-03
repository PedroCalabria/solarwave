import type { Metadata } from "next";
import { Poppins, Roboto } from "next/font/google";
import "./globals.css";

/* The design systems load these via @import url(fonts.googleapis.com); next/font
   self-hosts them instead and exposes the families as CSS variables that
   globals.css binds onto --font-ui / --font-hero. */
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SolarWave — Avaliação solar residencial",
  description:
    "Peça uma avaliação solar gratuita. Um agente de IA liga em até 5 minutos para qualificar o seu telhado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${roboto.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
