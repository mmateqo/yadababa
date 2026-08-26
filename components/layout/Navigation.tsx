"use client";

/* ============================================================================
   The menu is a place, not a dropdown: the world is covered by a single sheet
   that arrives from the top edge, three destinations set at display scale, and
   nothing else competing for attention.
   ========================================================================== */

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import Logo from "@/components/ui/Logo";
import s from "./Navigation.module.css";

/* Placeholders. This build is a single cinematic hero and there is nowhere for
   these to go yet; they are here because the brief asks for a menu and because
   the sheet is part of the identity, not because they navigate. */
const ITEMS = [
  { label: "Explore", idx: "01" },
  { label: "Discover", idx: "02" },
  { label: "Contact", idx: "03" },
] as const;

export default function Navigation({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = root.current;
    if (!el) return;

    const ctx = gsap.context(() => {
      // same normalisation as TextReveal: CSS percentages read back as pixels
      gsap.set(`.${s.itemLabel}`, { yPercent: 110, y: 0 });
      const t = gsap
        .timeline({ paused: true })
        .to(`.${s.sheet}`, {
          clipPath: "inset(0% 0% 0% 0%)",
          duration: 0.92,
          ease: "expo.inOut",
        })
        .to(
          `.${s.itemLabel}`,
          { yPercent: 0, duration: 1.0, stagger: 0.065, ease: "expo.out" },
          0.34
        )
        .to(`.${s.rule}`, { scaleX: 1, duration: 0.9, ease: "expo.out" }, 0.42)
        .to(`.${s.foot}`, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.52);
      tl.current = t;
    }, el);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const t = tl.current;
    if (!t) return;
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement;
      t.timeScale(1).play();
      root.current?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });
    } else {
      t.timeScale(1.55).reverse();
      returnFocus.current?.focus?.({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      ref={root}
      id="selora-menu"
      className={`${s.root} ${open ? s.open : ""}`}
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      <div className={s.sheet} />
      <div className={s.inner}>
        <ul className={s.list}>
          {ITEMS.map((it) => (
            <li key={it.label}>
              <a
                className={s.item}
                href="#"
                data-cursor="link"
                tabIndex={open ? 0 : -1}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                }}
              >
                <span className={`t-label ${s.idx}`}>{it.idx}</span>
                <span className={s.mask}>
                  <span className={s.itemLabel}>{it.label}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <div className={s.foot}>
          <i className={s.rule} />
          <p className={`t-body ${s.footNote}`}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
            eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </p>
          {/* No socials, no contact, no legal. v6 removed every destination
              from the site, and a menu that offers links to nothing is worse
              than a menu that offers none. */}
          <div className={`t-nav ${s.footLinks}`}>
            <Logo size={12} markSize={16} gap={9} />
          </div>
        </div>
      </div>
    </div>
  );
}
