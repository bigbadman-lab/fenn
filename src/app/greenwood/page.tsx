import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Greenwood",
};

export default function GreenwoodPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE GREENWOOD</h1>
      <div className="place__body">
        <p>the path continues without ceremony.</p>
        <p className="muted">the gate is not installed.</p>
        <p className="muted">standing means nothing here yet.</p>
      </div>
    </article>
  );
}
