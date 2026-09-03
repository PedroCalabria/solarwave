# Imagery

Paths mirror the Claude Design project (*Plataforma de qualificação de leads
solar*, `8614e0fd-307a-44ea-abb1-6e3c8a3941eb`), so an export can be dropped in
without touching code.

## In use

| File | Used by |
| --- | --- |
| `imagery/cta-rooftop.webp` | Landing hero (parallax background) |
| `imagery/eco-crop.webp` | CO₂ metric card |
| `imagery/fill-form-crop.webp` | "How it works" step 01 |
| `imagery/agent-call-crop.webp` | "How it works" step 02 |
| `imagery/answer-questions-crop.webp` | "How it works" step 03 |
| `imagery/human-especialist-crop.webp` | "How it works" step 04, portal login panel |
| `imagery/turbine-coast-crop.png` | Confirmation screen panel — **still a placeholder** |

Everything is served through a plain `<img>` / `background-image` rather than
`next/image`, matching how the design system's own components render. That means
no automatic `srcset` or format negotiation: what ships is what is in this
folder.

## Unreferenced

These are leftover generated placeholders (flat gradients) that nothing points
at any more. Safe to delete:

`imagery/answer-questions-crop.png`, `imagery/consultation-crop.png`,
`imagery/turbine-nacelle-crop.png`, `imagery/turbine-ridge-crop.png`,
`img/cta-rooftop.png`

## Sizing

Every image is cropped with `cover`, so the source aspect ratio does not have to
match its box — but the subject has to survive the crop. Rendered sizes at the
1360px page max:

| Box | Size (CSS px) | Ratio |
| --- | --- | --- |
| Hero background | viewport width × 132% of hero height | free |
| Step row | 482 × 204 | ~2.36:1 |
| CO₂ metric card | 190 × 198 | ~1:1 |
| Confirmation / login panel | ~740 × 1000 | portrait |

`human-especialist-crop.webp` is the one to watch: it feeds both a wide step row
and a full-height portrait panel. If the framing breaks in one of them, split it
into two files.
