import type { ReactNode } from "react";

import {
  PAGE_ASCII_MARKS,
  renderAsciiMark,
  type AsciiTitleAccent,
  type PageAsciiMarkKey,
} from "@/content/ascii-page-titles";

type AsciiPageTitleProps = {
  /** Semantic page title for the h1 (assistive tech). */
  title: string;
  /**
   * Decorative ASCII source. Prefer a known mark key, or pass raw text
   * to render via the shared glyph set. Omit to derive from `title`.
   */
  mark?: PageAsciiMarkKey | string;
  /** Optional raw ASCII override (e.g. locked CAMP art). */
  ascii?: string;
  /** Small environmental line under the mark. */
  subtitle?: ReactNode;
  accent?: AsciiTitleAccent;
  className?: string;
};

function resolveAscii(
  title: string,
  mark?: PageAsciiMarkKey | string,
  ascii?: string,
): string {
  if (ascii) return ascii;
  if (mark && mark in PAGE_ASCII_MARKS) {
    return PAGE_ASCII_MARKS[mark as PageAsciiMarkKey];
  }
  if (mark) return renderAsciiMark(mark);
  return renderAsciiMark(title);
}

/**
 * Shared inner-page title: decorative block ASCII + semantic h1.
 * Homepage identity is intentionally separate.
 */
export function AsciiPageTitle({
  title,
  mark,
  ascii,
  subtitle,
  accent = "book",
  className,
}: AsciiPageTitleProps) {
  const art = resolveAscii(title, mark, ascii);
  const rootClass = [
    "ascii-page-title",
    `ascii-page-title--${accent}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <h1 className="visually-hidden">{title}</h1>
      <pre className="ascii ascii-page-title__mark" aria-hidden="true">
        {art}
      </pre>
      {subtitle ? (
        <div className="ascii-page-title__subtitle">{subtitle}</div>
      ) : null}
    </div>
  );
}
