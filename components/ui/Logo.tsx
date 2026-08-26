"use client";

import { SHARK_PATH, SHARK_VIEWBOX } from "./sharkPaths";
import s from "./Logo.module.css";

/**
 * The lockup. The mark carries the identity, the wordmark is deliberately
 * quiet — tracked out, medium weight, never bold.
 */
export default function Logo({
  size = 15,
  markSize = 22,
  gap = 11,
  tracking = "0.2em",
  className,
  markOnly = false,
  as = "span",
}: {
  size?: number;
  markSize?: number;
  gap?: number;
  tracking?: string;
  className?: string;
  markOnly?: boolean;
  as?: "span" | "div";
}) {
  const Tag = as;
  return (
    <Tag
      className={[s.root, className].filter(Boolean).join(" ")}
      style={
        {
          "--logo-size": `${size}px`,
          "--logo-mark": `${markSize}px`,
          "--logo-gap": `${gap}px`,
          "--logo-tracking": tracking,
        } as React.CSSProperties
      }
    >
      <svg className={s.mark} viewBox={SHARK_VIEWBOX} aria-hidden="true">
        <path d={SHARK_PATH} />
      </svg>
      {!markOnly && (
        <span className={s.word}>
          <span>Selora</span>
        </span>
      )}
      <span className="u-sr">Selora</span>
    </Tag>
  );
}
