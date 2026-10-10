#!/usr/bin/env bash
# e2e suite: user-scope Claude MCPs go through `claude mcp add`. Regression for
# the variadic-flag trap: `--env`/`--header` swallow a following server name, so
# the name must come right after `add` (fake CLI in test/fixtures/bin mimics the
# real parser). Sourced by scripts/ci-e2e.sh.

CLAUDE_BIN="$(mktemp -d)"
cp "$E2E_FIXTURES/bin/fake-claude.mjs" "$E2E_FIXTURES/bin/claude" "$E2E_FIXTURES/bin/claude.cmd" "$CLAUDE_BIN/" && chmod +x "$CLAUDE_BIN/claude"
CLAUDE_CLI_PATH="$CLAUDE_BIN:/usr/bin:/bin:$(dirname "$(command -v node)")"

LOG_CS="$(mktemp)"
FAKE_CLAUDE_LOG="$LOG_CS" FAKE_CLAUDE_EXPECT_NAME=stitch PATH="$CLAUDE_CLI_PATH" harness "$(fresh_home)" init -y -a claude-code --mcp stitch >/dev/null
chk "claude mcp add: http+header keeps the server name" 'grep -q "^ok argv=mcp add" "$LOG_CS"'

LOG_CE="$(mktemp)"
FAKE_CLAUDE_LOG="$LOG_CE" FAKE_CLAUDE_EXPECT_NAME=fixture-private-mcp PATH="$CLAUDE_CLI_PATH" harness "$(fresh_home)" init -y -a claude-code --overlay "$E2E_FIXTURES/overlay" --mcp fixture-private-mcp >/dev/null
chk "claude mcp add: stdio+env keeps the server name"  'grep -q "^ok argv=mcp add" "$LOG_CE"'
chk "claude mcp add: env passed by reference only"      'grep -qF "FIXTURE_PRIVATE_TOKEN=\${FIXTURE_PRIVATE_TOKEN}" "$LOG_CE"'
