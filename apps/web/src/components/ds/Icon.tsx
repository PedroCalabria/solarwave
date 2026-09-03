import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronsLeft,
  Download,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { IconName as BenefitIconName } from "@/lib/copy";

/**
 * The Soltera bundle pulled Lucide SVGs off a CDN and painted them with
 * `mask-image`. Same icon set, same 2px round-cap stroke, but resolved at build
 * time so nothing is fetched at runtime.
 */
const ICONS = {
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  "arrow-up-right": ArrowUpRight,
  "chevrons-left": ChevronsLeft,
  "key-round": KeyRound,
  "refresh-cw": RefreshCw,
  plus: Plus,
  check: Check,
  download: Download,
  play: Play,
  search: Search,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name = "arrow-right",
  size = 18,
  color = "currentColor",
  style,
}: {
  name?: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      size={size}
      color={color}
      strokeWidth={2}
      absoluteStrokeWidth
      style={{ flex: "0 0 auto", ...style }}
    />
  );
}

/**
 * The four benefit glyphs the design defines inline in its <defs> sprite.
 * Kept verbatim — the `house` path in particular is not the stock Lucide one.
 */
const BENEFIT_PATHS: Record<BenefitIconName, React.ReactNode> = {
  "trending-down": (
    <>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </>
  ),
  house: (
    <>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 1 0-5.4 5.4L2 19l3 3 7.3-7.3a4 4 0 0 0 5.4-5.4l-3-3-3 3z" />,
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 11 13.24 12 11" />
    </>
  ),
};

export function BenefitIcon({
  name,
  size = 22,
  style,
}: {
  name: BenefitIconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", ...style }}
    >
      {BENEFIT_PATHS[name]}
    </svg>
  );
}
