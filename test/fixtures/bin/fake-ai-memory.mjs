// Fake `ai-memory` CLI for scripts/e2e/50-integrations.sh. It records how the
// harness called it (argv + whether the token reached it — never the token
// itself) and mimics `install-instructions` by merging a marker block into the
// target file, so the e2e can assert ordering and idempotency.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const START = '<!-- ai-memory:start -->';
const END = '<!-- ai-memory:end -->';
const argv = process.argv.slice(2);

function recordFakeAiMemoryCall(extra) {
  const logFile = process.env.FAKE_AI_MEMORY_LOG;
  if (!logFile) return;
  const token = process.env.AI_MEMORY_AUTH_TOKEN ? 'set' : 'unset';
  appendFileSync(logFile, `argv=${argv.join(' ')} token=${token}${extra}\n`);
}

function mergeFakeInstructionsBlock(target) {
  const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const hadTemplate = before.split('\n')[0].includes('Clean Code for Agents');
  const block = `${START}\nfake ai-memory routing block\n${END}\n`;
  const start = before.indexOf(START);
  const end = before.indexOf(END);
  const after = start !== -1 && end !== -1
    ? `${before.slice(0, start)}${block}${before.slice(end + END.length).replace(/^\r?\n/, '')}`
    : `${before}${before.endsWith('\n') || !before ? '' : '\n'}\n${block}`;
  writeFileSync(target, after);
  return hadTemplate;
}

if (process.env.FAKE_AI_MEMORY_FAIL && argv[0] === process.env.FAKE_AI_MEMORY_FAIL) {
  recordFakeAiMemoryCall(' result=simulated-failure');
  process.stderr.write(`simulated failure for ${argv[0]}\n`);
  process.exit(3);
}
if (argv[0] === 'install-instructions') {
  const target = argv[argv.indexOf('--target') + 1];
  recordFakeAiMemoryCall(` target-had-template=${mergeFakeInstructionsBlock(target) ? 'yes' : 'no'}`);
} else {
  recordFakeAiMemoryCall('');
}
