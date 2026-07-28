/**
 * Static Book lore fragments — retired from /book rendering.
 * Living chronicle is now DB-backed via chronicle_entries.
 * Doctrine lives on /oak.
 */
export type BookEntry = {
  id: string;
  title: string;
  body: string;
};

/** @deprecated Prefer Oak doctrine + Living Book chronicle entries. */
export const BOOK_ENTRIES: BookEntry[] = [];
