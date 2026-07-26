/**
 * Trusted ops: verify FENN_X_USER_ID belongs to @askfenn.
 *
 * Usage:
 *   npm run x:verify-account
 *
 * Does not print tokens.
 */

import {
  formatAccountVerification,
  verifyFennXAccount,
} from "@/lib/x/account";

async function main() {
  const result = await verifyFennXAccount();
  console.log(formatAccountVerification(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[x:verify-account] failed",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
