import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Camp",
};

export default function CampPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE CAMP</h1>
      <div className="place__body">
        <p>the clearing is marked.</p>
        <p className="muted">no one is speaking here yet.</p>
        <p className="muted">the camp is not listening yet.</p>
      </div>
    </article>
  );
}
