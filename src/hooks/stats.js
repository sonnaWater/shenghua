#!/usr/bin/env node
// shenghua — token stats engine
// Reads REAL token usage from Claude Code session transcripts (.jsonl),
// estimates savings from benchmark-measured compression ratios.
// Invoked by mode-tracker.js when the user types /shenghua-stats;
// can also be run manually: node src/hooks/stats.js [--session-file F] [--all]

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { readFlag, appendFlag, readHistory } = require('./config');

// Mean per-task output-token savings, measured by benchmarks/run.py.
// Only levels with benchmark data get an estimate.
const COMPRESSION = {
  jian: 0.35,
  shenghua: 0.60,
  wenyan: 0.72,
  jiwen: 0.78
};

// USD per 1M output tokens, prefix-matched against model id.
const MODEL_OUTPUT_PRICE_PER_M = [
  ['claude-opus-4', 75],
  ['claude-sonnet-4', 15],
  ['claude-sonnet-5', 15],
  ['claude-haiku-4', 4]
];

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const historyPath = path.join(claudeDir, '.shenghua-history.jsonl');
const flagPath = path.join(claudeDir, '.shenghua-active');

// --session-file may come from hook stdin (transcript_path) or the CLI.
// Only accept .jsonl files inside $CLAUDE_CONFIG_DIR/projects — anything
// else falls back to auto-discovery, so arbitrary file contents can never
// be parsed and echoed into model context.
function isValidSessionFile(p) {
  if (!p || !p.endsWith('.jsonl')) return false;
  const projectsDir = path.resolve(claudeDir, 'projects');
  const resolved = path.resolve(p);
  return resolved.startsWith(projectsDir + path.sep);
}

function findRecentSession() {
  const projectsDir = path.join(claudeDir, 'projects');
  let best = null;
  let bestMtime = 0;
  try {
    for (const proj of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, proj);
      let files;
      try { files = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(dir, f);
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > bestMtime) { bestMtime = m; best = full; }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return best;
}

// Streamed line-by-line so multi-MB transcripts never load whole into memory.
async function parseSession(file) {
  let outputTokens = 0;
  let turns = 0;
  let model = null;
  let sessionId = path.basename(file, '.jsonl');
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, 'utf8'),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }
      if (entry.type === 'assistant' && entry.message && entry.message.usage) {
        outputTokens += entry.message.usage.output_tokens || 0;
        turns += 1;
        if (entry.message.model) model = entry.message.model;
      }
    }
  } catch (e) {
    return null;
  }
  return { sessionId, outputTokens, turns, model };
}

function priceFor(model) {
  if (!model) return null;
  for (const [prefix, price] of MODEL_OUTPUT_PRICE_PER_M) {
    if (model.startsWith(prefix)) return price;
  }
  return null;
}

function formatStats(s, mode) {
  const lines = [];
  lines.push('省話統計(實測,非估算 token 數)');
  lines.push('─'.repeat(40));
  lines.push(`Session: ${s.sessionId}`);
  lines.push(`模式: ${mode || '未啟用'}`);
  lines.push(`回合數: ${s.turns}`);
  lines.push(`實際輸出 tokens: ${s.outputTokens.toLocaleString()}`);

  const ratio = COMPRESSION[mode];
  if (ratio) {
    const estNormal = Math.round(s.outputTokens / (1 - ratio));
    const estSaved = estNormal - s.outputTokens;
    lines.push(`估計未壓縮輸出: ${estNormal.toLocaleString()} tokens`);
    lines.push(`估計節省: ${estSaved.toLocaleString()} tokens(${Math.round(ratio * 100)}%,依 benchmark 實測均值)`);
    const price = priceFor(s.model);
    if (price) {
      lines.push(`估計省下: $${(estSaved / 1e6 * price).toFixed(4)} USD(${s.model})`);
    }
    return { text: lines.join('\n'), estSaved };
  }
  lines.push('此模式無 benchmark 數據,不提供節省估計。');
  return { text: lines.join('\n'), estSaved: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--session-file');
  const requested = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const sessionFile = isValidSessionFile(requested) ? requested : findRecentSession();

  if (args.includes('--all')) {
    const lines = readHistory(historyPath);
    const latest = new Map();
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        latest.set(e.session_id, e);
      } catch (err) {}
    }
    let tokens = 0, saved = 0;
    for (const e of latest.values()) {
      tokens += e.output_tokens || 0;
      saved += e.est_saved || 0;
    }
    process.stdout.write(
      '省話累計統計(' + latest.size + ' sessions)\n' +
      '─'.repeat(40) + '\n' +
      '總輸出 tokens: ' + tokens.toLocaleString() + '\n' +
      '估計累計節省: ' + saved.toLocaleString() + ' tokens\n'
    );
    return;
  }

  if (!sessionFile) {
    process.stdout.write('找不到 session 紀錄檔($CLAUDE_CONFIG_DIR/projects/**/*.jsonl)。');
    return;
  }
  const s = await parseSession(sessionFile);
  if (!s) {
    process.stdout.write('無法讀取 session 檔: ' + sessionFile);
    return;
  }
  const mode = readFlag(flagPath);
  const { text, estSaved } = formatStats(s, mode);

  appendFlag(historyPath, JSON.stringify({
    ts: new Date().toISOString(),
    session_id: s.sessionId,
    mode: mode || 'off',
    output_tokens: s.outputTokens,
    est_saved: estSaved,
    model: s.model
  }));

  process.stdout.write(text);
}

main().catch(() => {
  process.stdout.write('shenghua-stats: 執行失敗。');
});
