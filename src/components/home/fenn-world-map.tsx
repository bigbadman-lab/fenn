import Link from "next/link";

import {
  FENN_WORLD_MAP_DESKTOP,
  FENN_WORLD_MAP_MOBILE,
  type MapFrag,
  type MapRow,
} from "@/content/home-world-map";

function fragClass(frag: MapFrag, linked: boolean): string {
  return [
    "fenn-map__frag",
    `fenn-map__frag--${frag.c ?? "bone"}`,
    linked ? "fenn-map__link" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function MapFragment({ frag }: { frag: MapFrag }) {
  const className = fragClass(frag, Boolean(frag.href));

  if (frag.href) {
    return (
      <Link href={frag.href} className={className}>
        {frag.t}
      </Link>
    );
  }

  return <span className={className}>{frag.t}</span>;
}

function MapLine({ row, rowKey }: { row: MapRow; rowKey: string }) {
  if (row.length === 0 || (row.length === 1 && row[0]?.t === "")) {
    return <div className="fenn-map__line fenn-map__line--blank">&nbsp;</div>;
  }

  return (
    <div className="fenn-map__line">
      {row.map((frag, index) => (
        <MapFragment key={`${rowKey}-${index}`} frag={frag} />
      ))}
    </div>
  );
}

function MapArt({
  rows,
  variant,
}: {
  rows: readonly MapRow[];
  variant: "desktop" | "mobile";
}) {
  return (
    <div className={`ascii fenn-map__art fenn-map__art--${variant}`}>
      {rows.map((row, index) => (
        <MapLine
          key={`${variant}-${index}`}
          row={row}
          rowKey={`${variant}-${index}`}
        />
      ))}
    </div>
  );
}

/**
 * Homepage world map — geography + primary Stage 5 navigation.
 * Desktop: centred landscape canvas.
 * Mobile: horizontal landscape inside a native scroll viewport.
 */
export function FennWorldMap() {
  return (
    <nav className="fenn-map" aria-label="map of fenn">
      <div className="fenn-map__desktop">
        <MapArt rows={FENN_WORLD_MAP_DESKTOP} variant="desktop" />
      </div>

      <div className="fenn-map__mobile">
        <div className="fenn-map__viewport">
          <MapArt rows={FENN_WORLD_MAP_MOBILE} variant="mobile" />
        </div>
        <p className="fenn-map__hint muted">&lt; the road continues &gt;</p>
      </div>
    </nav>
  );
}
