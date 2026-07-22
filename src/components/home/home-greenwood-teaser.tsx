import Link from "next/link";

export function HomeGreenwoodTeaser() {
  return (
    <section
      className="home-section home-greenwood"
      aria-labelledby="home-greenwood-title"
    >
      <h2 id="home-greenwood-title" className="place__title">
        THE GREENWOOD
      </h2>
      <div className="place__body">
        <p>the path continues beyond this point.</p>
        <p>the wood has not opened this gate yet.</p>
        <p>access is earned.</p>
        <p>
          <Link href="/greenwood?crossing=1">[ go to the greenwood ]</Link>
        </p>
      </div>
    </section>
  );
}
