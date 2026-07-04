#!/usr/bin/env node
// shenghua — Claude Code SessionStart activation hook
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.shenghua-active
//   2. Reads skills/shenghua/SKILL.md (single source of truth), strips
//      frontmatter, filters the level table + example lines to the active
//      level, and emits the result as hidden SessionStart context.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultMode, safeWriteFlag } = require('./config');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.shenghua-active');

// Modes with their own independent skills — not intensity levels.
const INDEPENDENT_MODES = new Set(['commit', 'review']);

const mode = getDefaultMode();

if (mode === 'off') {
  try { fs.unlinkSync(flagPath); } catch (e) {}
  process.stdout.write('OK');
  process.exit(0);
}

safeWriteFlag(flagPath, mode);

if (INDEPENDENT_MODES.has(mode)) {
  process.stdout.write('省話模式啟用 — 等級: ' + mode + '。行為由 /shenghua-' + mode + ' skill 定義。');
  process.exit(0);
}

// Read SKILL.md at runtime so edits propagate automatically — no hardcoded
// duplication to go stale. Falls back to a minimal ruleset for standalone
// installs without the skills directory.
let skillContent = '';
try {
  skillContent = fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'shenghua', 'SKILL.md'), 'utf8'
  );
} catch (e) { /* standalone install — fallback below */ }

let output;

if (skillContent) {
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, '');

  // Keep only the active level's table row and example lines.
  const filtered = body.split('\n').reduce((acc, line) => {
    const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
    if (tableRowMatch) {
      if (tableRowMatch[1] === mode) acc.push(line);
      return acc;
    }
    const exampleMatch = line.match(/^- (\S+?):\s/);
    if (exampleMatch) {
      if (exampleMatch[1] === mode) acc.push(line);
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);

  output = '省話模式啟用 — 等級: ' + mode + '\n\n' + filtered.join('\n');
} else {
  output =
    '省話模式啟用 — 等級: ' + mode + '\n\n' +
    '以聰明省話一哥風格回應。技術內容全留,冗詞全刪。\n\n' +
    '## 規則\n\n' +
    '刪除:語助詞(的/了/呢/吧/喔/啊)、贅詞(其實/基本上/大概/就是/那個)、' +
    '客套(好的/沒問題/很高興/當然可以)、避險語。碎句可。短同義詞。' +
    '技術名詞精確。程式碼區塊原樣。錯誤訊息逐字引用。\n\n' +
    '句型:`[對象] [動作] [原因]。[下一步]。`\n\n' +
    '## 邊界\n\n' +
    '程式碼/commit/PR:正常書寫。安全警告、不可逆操作確認、多步驟指示:恢復白話。' +
    '「停止省話」或「正常模式」:關閉。';
}

process.stdout.write(output);
