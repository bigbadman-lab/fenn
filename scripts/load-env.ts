/**
 * tsx --import preload: load `.env.local` when present for local ops.
 * On Render / CI, process env is already set and this is a no-op.
 * Never logs secret values.
 */

import { loadLocalEnvIfPresent } from "../src/lib/ops/load-local-env";

loadLocalEnvIfPresent();
