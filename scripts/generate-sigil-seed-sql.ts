/**
 * Print SQL value tuples for greenwood_sigil_catalogue seed.
 * Run: npx tsx --conditions=react-server scripts/generate-sigil-seed-sql.ts
 */
import {
  ALL_GREENWOOD_SIGIL_DEFINITIONS,
  assertSigilGeometry,
} from "../src/lib/greenwood/sigil/catalogue";

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function dollarQuote(value: string, tag: string): string {
  const safeTag = tag.replace(/[^a-z0-9]/gi, "");
  return `$${safeTag}$${value}$${safeTag}$`;
}

const errors = ALL_GREENWOOD_SIGIL_DEFINITIONS.map(assertSigilGeometry).filter(
  Boolean,
);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const rows = ALL_GREENWOOD_SIGIL_DEFINITIONS.map((sigil, index) => {
  return `(
  ${sqlString(sigil.id)}::uuid,
  ${sqlString(sigil.slug)},
  ${dollarQuote(sigil.asciiBody, `s${index}`)},
  ${sqlString(sigil.a11yLabel)},
  ${sigil.width},
  ${sigil.height},
  'active',
  ${sigil.isFallback},
  ${sigil.sortOrder}
)`;
}).join(",\n");

console.log(rows);
