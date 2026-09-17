// Runs every suite and exits non-zero if any fails.
import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => /\.test\.(js|mjs)$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  process.stdout.write(f.padEnd(26));
  try {
    const out = execFileSync('node', [join(here, f)], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    const line = (out.match(/^\d+ passed.*$/m) || ['(no summary)'])[0];
    console.log(line);
    if (/FAIL/.test(out)) failed++;
  } catch (e) {
    console.log('CRASHED');
    console.log((e.stdout || '') + (e.stderr || ''));
    failed++;
  }
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
