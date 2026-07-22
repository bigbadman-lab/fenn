import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deeds",
};

export default function DeedsPage() {
  return (
    <article className="place">
      <h1 className="place__title">DEEDS</h1>
      <div className="place__body">
        <p>the board is empty.</p>
        <p className="muted">work will appear here.</p>
      </div>
    </article>
  );
}
