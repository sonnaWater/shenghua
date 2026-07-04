#!/usr/bin/env node
// shenghua — UserPromptSubmit hook
// Tracks mode switches (/shenghua <level>, natural language on/off),
// intercepts /shenghua-stats, and injects a per-turn reinforcement reminder.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { getDefaultMode, safeWriteFlag, readFlag, VALID_MODES } = require('./config');

const INDEPENDENT_MODES = new Set(['commit', 'review']);

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = path.join(claudeDir, '.shenghua-active');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim().toLowerCase();

    // Natural language activation: 「開啟省話」「省話模式」「講重點」 etc.
    if (/(開啟|啟用|打開|進入|使用).{0,6}省話/.test(prompt) ||
        /省話模式/.test(prompt) ||
        /\b(activate|enable|turn on|start)\b.*\bshenghua\b/i.test(prompt)) {
      if (!/(關閉|停止|取消|退出|不要|別|勿|不想)/.test(prompt) && !/\b(stop|disable|turn off)\b/i.test(prompt)) {
        const mode = getDefaultMode();
        if (mode !== 'off') safeWriteFlag(flagPath, mode);
      }
    }

    // /shenghua-stats — block the prompt, run the stats engine, return output.
    const statsMatch = /^\/shenghua(?::shenghua)?-stats(?:\s+(.*))?$/.exec(prompt);
    if (statsMatch) {
      const tailArgs = (statsMatch[1] || '').trim().split(/\s+/).filter(Boolean);
      try {
        const statsPath = path.join(__dirname, 'stats.js');
        const argv = [statsPath];
        if (data.transcript_path) argv.push('--session-file', data.transcript_path);
        if (tailArgs.includes('--all')) argv.push('--all');
        const out = execFileSync(process.execPath, argv, { encoding: 'utf8', timeout: 5000 });
        process.stdout.write(JSON.stringify({ decision: 'block', reason: out.trim() }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: 'shenghua-stats: 統計腳本執行失敗。手動執行: node src/hooks/stats.js'
        }));
      }
      return;
    }

    // /shenghua commands
    if (prompt.startsWith('/shenghua')) {
      const parts = prompt.split(/\s+/);
      const cmd = parts[0];
      const arg = parts[1] || '';

      let mode = null;

      if (cmd === '/shenghua-commit') {
        mode = 'commit';
      } else if (cmd === '/shenghua-review') {
        mode = 'review';
      } else if (cmd === '/shenghua' || cmd === '/shenghua:shenghua') {
        if (!arg) {
          mode = getDefaultMode();
        } else if (arg === 'off' || arg === 'stop' || arg === '關閉') {
          mode = 'off';
        } else if (VALID_MODES.includes(arg) && !INDEPENDENT_MODES.has(arg)) {
          mode = arg;
        }
        // Unknown arg → flag untouched (no silent overwrite)
      }

      if (mode && mode !== 'off') {
        safeWriteFlag(flagPath, mode);
      } else if (mode === 'off') {
        try { fs.unlinkSync(flagPath); } catch (e) {}
      }
    }

    // Deactivation — natural language
    // 「正常模式」須帶切換動詞或單獨成句,避免一般討論誤觸停用。
    if (/(停止|關閉|取消|退出|不要|別用|勿用).{0,6}省話/.test(prompt) ||
        /(恢復|回到|切換到|改回|換回|回復)正常模式/.test(prompt) ||
        prompt === '正常模式' ||
        /\b(stop|disable|deactivate|turn off)\b.*\bshenghua\b/i.test(prompt)) {
      try { fs.unlinkSync(flagPath); } catch (e) {}
    }

    // Per-turn reinforcement. SessionStart injects the full rules once, but
    // models drift when other plugins inject competing style instructions.
    // readFlag enforces symlink-safe read + size cap + whitelist — untrusted
    // bytes never reach model context.
    const activeMode = readFlag(flagPath);
    if (activeMode && !INDEPENDENT_MODES.has(activeMode)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: '省話模式(' + activeMode + ')。刪語助詞/贅詞/客套/避險語。碎句可。' +
            '程式碼/commit/安全性:正常書寫。'
        }
      }));
    }
  } catch (e) {
    // Silent fail
  }
});
