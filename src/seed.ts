import { parseSeedFiles } from './dedup';
import raw from './seed.json';

// Snapshot of the old bot's noted_cases.txt / noted_orders.txt. Regenerate with scripts/make-seed.mjs.
export const seed = parseSeedFiles(raw.casesTxt, raw.ordersTxt);
