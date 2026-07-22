import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deeds",
};

export default function DeedsPage() {
  return (
    <article className="place">
      <h1 className="place__title">DEEDS</h1>
      <div className="place__body">
        <p>work will be posted here.</p>
        <p className="muted">nothing is asked of you yet.</p>
        <p className="muted">the list is empty on purpose.</p>
      </div>
    </article>
  );
}
