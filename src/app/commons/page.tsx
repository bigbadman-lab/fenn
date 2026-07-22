import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Commons",
};

export default function CommonsPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE COMMONS</h1>
      <div className="place__body">
        <p>value that is meant to move will be named here.</p>
        <p className="muted">nothing has been committed yet.</p>
        <p className="muted">do not invent a hoard where there is none.</p>
      </div>
    </article>
  );
}
