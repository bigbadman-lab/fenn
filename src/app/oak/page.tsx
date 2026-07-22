import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Oak",
};

const OAK = [
  "        .",
  "       /|\\",
  "      / | \\",
  "     /  |  \\",
  "    .   |   .",
  "        |",
  "        |",
].join("\n");

export default function OakPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE OAK</h1>
      <div className="place__body">
        <pre className="ascii" aria-hidden="true">
          {OAK}
        </pre>
        <p>a place with little immediate use.</p>
        <p className="muted">that is intentional.</p>
        <p className="muted">come back when the wood decides to speak.</p>
      </div>
    </article>
  );
}
