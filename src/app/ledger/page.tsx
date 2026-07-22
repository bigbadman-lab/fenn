import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Ledger",
};

export default function LedgerPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE LEDGER</h1>
      <div className="place__body">
        <p>the books are open in principle.</p>
        <p className="muted">no circulations have been recorded.</p>
        <p className="muted">history starts when something actually moves.</p>
      </div>
    </article>
  );
}
