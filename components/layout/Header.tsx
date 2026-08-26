"use client";

/* ============================================================================
   The only interface in the film.

   Who this is, and the menu. No container, no bar, no card, no rule, no glass:
   it sits directly on the world and its ink crosses from white to near-black as
   the sky does — driven by the same clock as everything else, so the change is
   part of the shot rather than a theme switching under it.
   ========================================================================== */

import { useRef, useState } from "react";
import Link from "next/link";
import { at, NAV_DARK } from "@/lib/cinematic";
import { clock, onFrame } from "@/lib/clock";
import Logo from "@/components/ui/Logo";
import Navigation from "./Navigation";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import s from "./Header.module.css";

export default function Header() {
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  /* Ink. The nav is white against space and near-black against a daylight sky,
     and it crosses over between eleven and twelve and a half seconds — while
     the sky itself is crossing, so the two are one event. Interpolated, never
     switched: a boolean flip at some threshold is visible as a flicker on every
     glyph at once. */
  useIsomorphicLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let last = -1;
    return onFrame(() => {
      const k = at(NAV_DARK, clock.time);
      if (Math.abs(k - last) < 0.002) return;
      last = k;
      const c = Math.round(255 + (17 - 255) * k);
      const g = Math.round(255 + (19 - 255) * k);
      const b = Math.round(255 + (21 - 255) * k);
      el.style.setProperty("--nav-ink", `rgb(${c},${g},${b})`);
      /* A very soft halo in the opposite tone, strongest exactly through the
         middle of the crossing, so the type stays legible while it is passing
         through the values that have least contrast with the sky behind it. */
      const halo = 1 - Math.abs(k - 0.5) * 2;
      el.style.setProperty(
        "--nav-halo",
        k > 0.5
          ? `0 1px 22px rgba(8,20,32,${(0.06 + halo * 0.16).toFixed(2)})`
          : `0 1px 22px rgba(6,16,28,${(0.24 + halo * 0.2).toFixed(2)})`
      );
    });
  }, []);

  return (
    <>
      <header ref={root} className={`${s.root} ${open ? s.overMenu : ""}`}>
        <Link className={s.brand} href="/" aria-label="Selora" data-cursor="link">
          <span className={s.markWrap} data-shark-origin>
            <Logo markOnly markSize={26} />
          </span>
          <span className={s.word}>
            <span data-logo-word>Selora</span>
          </span>
        </Link>

        {/* Brand and menu. Nothing else — the one other control in the site is
            Explore, and it belongs to the composition it launches, not to a
            persistent bar. */}
        <nav className={s.actions} aria-label="Primary">
          <button
            type="button"
            className={`${s.menuBtn} ${open ? s.open : ""} t-nav`}
            aria-expanded={open}
            aria-controls="selora-menu"
            onClick={() => setOpen((v) => !v)}
            data-cursor="link"
          >
            <span>{open ? "Close" : "Menu"}</span>
            <span className={s.bars} aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </nav>
      </header>

      <Navigation open={open} onClose={() => setOpen(false)} />
    </>
  );
}
