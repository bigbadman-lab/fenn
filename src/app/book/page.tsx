import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Book",
};

export default function BookPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE BOOK</h1>
      <div className="place__body">
        <p>pages will accumulate here.</p>
        <p className="muted">lore, fragments, older stories.</p>
        <p className="muted">for now the binding is empty.</p>
      </div>
    </article>
  );
}
