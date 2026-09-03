"use client";

import { useEffect } from "react";

/**
 * Port of the `componentDidMount` behaviour in `Soltera Lead Platform.dc.html`:
 * a rAF-throttled parallax on [data-parallax] and a one-shot reveal on
 * [data-reveal]. Elements already in view on first paint are revealed without
 * animating, so the fold never flashes empty.
 */
export function ScrollEffects() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Opt into the hidden-until-revealed styling only now that JS is running.
    const root = document.documentElement;
    if (!reduced) root.classList.add("js-reveal");

    const parallax = () => {
      document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const rate = Number.parseFloat(el.dataset.parallax ?? "") || 0.28;
        el.style.transform = `translate3d(0,${(-rect.top * rate).toFixed(1)}px,0)`;
      });
    };

    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        parallax();
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "1";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    const seen = new WeakSet<Element>();
    const sweep = () => {
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        if (el.dataset.revealed === "1" || seen.has(el)) return;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const visible = rect.top < window.innerHeight * 0.94 && rect.bottom > 0;
        if (visible || reduced) {
          el.dataset.revealed = "1";
          return;
        }
        observer.observe(el);
      });
    };

    sweep();
    if (!reduced) parallax();

    const mutations = new MutationObserver(() => {
      sweep();
      if (!reduced) parallax();
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    if (!reduced) {
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
    }

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);

  return null;
}
