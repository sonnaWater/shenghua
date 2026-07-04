// shenghua hook unit tests — run with: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'src', 'hooks');
const config = require(path.join(HOOKS, 'config.js'));

function tmpConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shenghua-test-'));
}

function runActivate(env) {
  return execFileSync(process.execPath, [path.join(HOOKS, 'activate.js')], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

function runTracker(promptObj, env) {
  return execFileSync(process.execPath, [path.join(HOOKS, 'mode-tracker.js')], {
    encoding: 'utf8',
    input: JSON.stringify(promptObj),
    env: { ...process.env, ...env }
  });
}

// ---------- config.js ----------

test('VALID_MODES contains the four levels plus off/commit/review', () => {
  for (const m of ['off', 'jian', 'shenghua', 'wenyan', 'jiwen', 'commit', 'review']) {
    assert.ok(config.VALID_MODES.includes(m), m);
  }
});

test('getDefaultMode: env var wins', () => {
  const orig = process.env.SHENGHUA_DEFAULT_MODE;
  process.env.SHENGHUA_DEFAULT_MODE = 'wenyan';
  try {
    assert.strictEqual(config.getDefaultMode(), 'wenyan');
  } finally {
    if (orig === undefined) delete process.env.SHENGHUA_DEFAULT_MODE;
    else process.env.SHENGHUA_DEFAULT_MODE = orig;
  }
});

test('getDefaultMode: invalid env value falls through to default', () => {
  const orig = process.env.SHENGHUA_DEFAULT_MODE;
  process.env.SHENGHUA_DEFAULT_MODE = 'bogus-mode';
  try {
    assert.strictEqual(config.getDefaultMode(), 'shenghua');
  } finally {
    if (orig === undefined) delete process.env.SHENGHUA_DEFAULT_MODE;
    else process.env.SHENGHUA_DEFAULT_MODE = orig;
  }
});

test('safeWriteFlag + readFlag round-trip', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'jiwen');
  assert.strictEqual(config.readFlag(flag), 'jiwen');
});

test('readFlag rejects non-whitelisted content', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  fs.writeFileSync(flag, 'rm -rf / #malicious');
  assert.strictEqual(config.readFlag(flag), null);
});

test('readFlag rejects oversized file', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  fs.writeFileSync(flag, 'x'.repeat(1000));
  assert.strictEqual(config.readFlag(flag), null);
});

test('readFlag returns null for missing file', () => {
  assert.strictEqual(config.readFlag(path.join(tmpConfigDir(), 'nope')), null);
});

test('appendFlag + readHistory round-trip', () => {
  const dir = tmpConfigDir();
  const hist = path.join(dir, '.shenghua-history.jsonl');
  config.appendFlag(hist, JSON.stringify({ a: 1 }));
  config.appendFlag(hist, JSON.stringify({ a: 2 }));
  const lines = config.readHistory(hist);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(JSON.parse(lines[1]).a, 2);
});

test('appendFlag rotates history above 1MB, keeping newest lines', () => {
  const dir = tmpConfigDir();
  const hist = path.join(dir, '.shenghua-history.jsonl');
  const bigLine = JSON.stringify({ pad: 'x'.repeat(1000) });
  const filler = (bigLine + '\n').repeat(1100); // ~1.1MB
  fs.writeFileSync(hist, filler);
  config.appendFlag(hist, JSON.stringify({ last: true }));
  const size = fs.statSync(hist).size;
  assert.ok(size <= 1024 * 1024 / 2, `rotated size ${size}`);
  const lines = config.readHistory(hist);
  assert.strictEqual(JSON.parse(lines[lines.length - 1]).last, true);
  for (const l of lines) JSON.parse(l); // no partial lines survive rotation
});

// ---------- activate.js level filtering ----------

test('activate: default level emits only shenghua rows/examples', () => {
  const dir = tmpConfigDir();
  const out = runActivate({ CLAUDE_CONFIG_DIR: dir, SHENGHUA_DEFAULT_MODE: 'shenghua' });
  assert.match(out, /等級: shenghua/);
  assert.match(out, /\| \*\*shenghua\*\* \|/);
  assert.doesNotMatch(out, /\| \*\*wenyan\*\* \|/);
  assert.doesNotMatch(out, /^- jian:/m);
  assert.match(out, /^- shenghua:/m);
});

test('activate: wenyan level filtering', () => {
  const dir = tmpConfigDir();
  const out = runActivate({ CLAUDE_CONFIG_DIR: dir, SHENGHUA_DEFAULT_MODE: 'wenyan' });
  assert.match(out, /\| \*\*wenyan\*\* \|/);
  assert.doesNotMatch(out, /\| \*\*jiwen\*\* \|/);
  assert.match(out, /^- wenyan:/m);
  assert.doesNotMatch(out, /^- shenghua:/m);
});

test('activate: off mode writes no flag, emits OK', () => {
  const dir = tmpConfigDir();
  const out = runActivate({ CLAUDE_CONFIG_DIR: dir, SHENGHUA_DEFAULT_MODE: 'off' });
  assert.strictEqual(out, 'OK');
  assert.ok(!fs.existsSync(path.join(dir, '.shenghua-active')));
});

test('activate: writes flag file with active mode', () => {
  const dir = tmpConfigDir();
  runActivate({ CLAUDE_CONFIG_DIR: dir, SHENGHUA_DEFAULT_MODE: 'jiwen' });
  assert.strictEqual(config.readFlag(path.join(dir, '.shenghua-active')), 'jiwen');
});

// ---------- mode-tracker.js ----------

test('tracker: /shenghua wenyan switches flag', () => {
  const dir = tmpConfigDir();
  runTracker({ prompt: '/shenghua wenyan' }, { CLAUDE_CONFIG_DIR: dir });
  assert.strictEqual(config.readFlag(path.join(dir, '.shenghua-active')), 'wenyan');
});

test('tracker: /shenghua off removes flag', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'shenghua');
  runTracker({ prompt: '/shenghua off' }, { CLAUDE_CONFIG_DIR: dir });
  assert.ok(!fs.existsSync(flag));
});

test('tracker: unknown arg leaves flag untouched', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'wenyan');
  runTracker({ prompt: '/shenghua bogus' }, { CLAUDE_CONFIG_DIR: dir });
  assert.strictEqual(config.readFlag(flag), 'wenyan');
});

test('tracker: 「停止省話」 removes flag', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'shenghua');
  runTracker({ prompt: '停止省話' }, { CLAUDE_CONFIG_DIR: dir });
  assert.ok(!fs.existsSync(flag));
});

test('tracker: 「請不要使用省話模式」does not activate, removes existing flag', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'shenghua');
  runTracker({ prompt: '請不要使用省話模式' }, { CLAUDE_CONFIG_DIR: dir });
  assert.ok(!fs.existsSync(flag));
});

test('tracker: mentioning 正常模式 in discussion keeps flag', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'wenyan');
  runTracker({ prompt: '文件裡提到正常模式的定義是什麼?' }, { CLAUDE_CONFIG_DIR: dir });
  assert.strictEqual(config.readFlag(flag), 'wenyan');
});

test('tracker: 「恢復正常模式」removes flag', () => {
  const dir = tmpConfigDir();
  const flag = path.join(dir, '.shenghua-active');
  config.safeWriteFlag(flag, 'shenghua');
  runTracker({ prompt: '恢復正常模式' }, { CLAUDE_CONFIG_DIR: dir });
  assert.ok(!fs.existsSync(flag));
});

test('tracker: active flag emits per-turn additionalContext', () => {
  const dir = tmpConfigDir();
  config.safeWriteFlag(path.join(dir, '.shenghua-active'), 'jian');
  const out = runTracker({ prompt: '請解釋這段程式碼' }, { CLAUDE_CONFIG_DIR: dir });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /省話模式\(jian\)/);
});

test('tracker: no flag → no output', () => {
  const dir = tmpConfigDir();
  const out = runTracker({ prompt: '你好' }, { CLAUDE_CONFIG_DIR: dir });
  assert.strictEqual(out, '');
});
