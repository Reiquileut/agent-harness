// Fake `twg` (Atlassian Teamwork Graph CLI) for scripts/e2e/88-twg.sh. Records
// how the harness called it; the real CLI would install Atlassian-licensed
// skills, which this public repo must never bundle or download in a test.
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const argv = process.argv.slice(2);
if (process.env.FAKE_TWG_LOG) appendFileSync(process.env.FAKE_TWG_LOG, `argv=${argv.join(' ')}\n`);
