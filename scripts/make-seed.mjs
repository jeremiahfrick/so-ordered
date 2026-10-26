// Usage: node scripts/make-seed.mjs <noted_cases.txt> <noted_orders.txt>
// Wraps the old bot's dedup files into src/seed.json; src/seed.ts does the parsing.
import { readFileSync, writeFileSync } from 'node:fs';

const [casesPath, ordersPath] = process.argv.slice(2);
if (!casesPath || !ordersPath) {
  console.error('usage: node scripts/make-seed.mjs <noted_cases.txt> <noted_orders.txt>');
  process.exit(2);
}
const casesTxt = readFileSync(casesPath, 'utf8');
const ordersTxt = readFileSync(ordersPath, 'utf8');
writeFileSync(new URL('../src/seed.json', import.meta.url), JSON.stringify({ casesTxt, ordersTxt }, null, 1) + '\n');
const count = (t) => t.split('\n').filter((l) => l.trim()).length;
console.log(`seed.json written: ${count(casesTxt)} cases, ${count(ordersTxt)} orders`);
