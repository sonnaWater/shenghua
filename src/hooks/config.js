#!/usr/bin/env node
// shenghua — shared configuration resolver & symlink-safe flag I/O
// Security model adapted from the caveman project (MIT, Julius Brussee):
// the flag file lives at a predictable path, so all reads/writes must refuse
// symlinks, cap sizes, and whitelist-validate content before it can reach
// the terminal or model context.
//
// Default mode resolution order:
//   1. SHENGHUA_DEFAULT_MODE environment variable
//   2. Config file defaultMode field:
//      - $XDG_CONFIG_HOME/shenghua/config.json
//      - %APPDATA%\shenghua\config.json (Windows)
//      - ~/.config/shenghua/config.json (macOS / Linux)
//   3. 'shenghua'

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_MODES = [
  'off', 'jian', 'shenghua', 'wenyan', 'jiwen',
  'commit', 'review'
];

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'shenghua');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'shenghua'
    );
  }
  return path.join(os.homedir(), '.config', 'shenghua');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getDefaultMode() {
  const envMode = process.env.SHENGHUA_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode.toLowerCase())) {
      return config.defaultMode.toLowerCase();
    }
  } catch (e) {
    // Config file doesn't exist or is invalid — fall through
  }
  return 'shenghua';
}

// Symlink-safe atomic flag write: O_NOFOLLOW + O_EXCL temp file + rename, 0600.
// If the parent dir is a symlink (legitimate: ~/.claude relocated to another
// drive), resolve it and verify ownership (uid on Unix, home-prefix on Windows).
// The flag file itself must never be a symlink — that is the clobber vector.
// Silent-fails: the flag is best-effort.
function safeWriteFlag(flagPath, content) {
  const debug = process.env.SHENGHUA_DEBUG === '1';
  try {
    const flagDir = path.dirname(flagPath);
    fs.mkdirSync(flagDir, { recursive: true });

    let realFlagDir;
    try {
      const lstat = fs.lstatSync(flagDir);
      if (lstat.isSymbolicLink()) {
        realFlagDir = fs.realpathSync(flagDir);
        const realStat = fs.statSync(realFlagDir);
        if (!realStat.isDirectory()) return;
        if (typeof process.getuid === 'function') {
          if (realStat.uid !== process.getuid()) {
            if (debug) process.stderr.write(`[shenghua] safeWriteFlag: symlink target owned by uid ${realStat.uid}\n`);
            return;
          }
        } else {
          const home = path.resolve(os.homedir()).toLowerCase();
          const real = path.resolve(realFlagDir).toLowerCase();
          if (!real.startsWith(home + path.sep) && real !== home) return;
        }
      } else {
        realFlagDir = flagDir;
      }
    } catch (e) {
      return;
    }

    const realFlagPath = path.join(realFlagDir, path.basename(flagPath));
    try {
      if (fs.lstatSync(realFlagPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const tempPath = path.join(realFlagDir, `.shenghua-active.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realFlagPath);
  } catch (e) {
    // Silent fail — flag is best-effort
  }
}

// Symlink-safe, size-capped, whitelist-validated read. Returns null on any
// anomaly, so untrusted bytes can never be injected into model context.
const MAX_FLAG_BYTES = 64;

function readFlag(flagPath) {
  try {
    let st;
    try {
      st = fs.lstatSync(flagPath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_FLAG_BYTES) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    let fd;
    let out;
    try {
      fd = fs.openSync(flagPath, fs.constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(MAX_FLAG_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0);
      out = buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const raw = out.trim().toLowerCase();
    if (!VALID_MODES.includes(raw)) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

// History file grows one line per /shenghua-stats run and is fully parsed
// on --all, so cap it: reads only take the last MAX_HISTORY_BYTES, and
// appends rotate the file down to half the cap once it exceeds the cap.
const MAX_HISTORY_BYTES = 1024 * 1024;

// Read at most the last `maxBytes` of an already-opened fd, dropping the
// leading partial line when the file was truncated mid-line.
function readTail(fd, size, maxBytes) {
  const start = size > maxBytes ? size - maxBytes : 0;
  const buf = Buffer.alloc(Math.min(size, maxBytes));
  const n = fs.readSync(fd, buf, 0, buf.length, start);
  let raw = buf.slice(0, n).toString('utf8');
  if (start > 0) {
    const nl = raw.indexOf('\n');
    raw = nl === -1 ? '' : raw.slice(nl + 1);
  }
  return raw;
}

// Symlink-safe append (O_APPEND) for the lifetime stats log.
function appendFlag(filePath, line) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    let realDir;
    try {
      const lstat = fs.lstatSync(dir);
      if (lstat.isSymbolicLink()) {
        realDir = fs.realpathSync(dir);
        const realStat = fs.statSync(realDir);
        if (!realStat.isDirectory()) return;
        if (typeof process.getuid === 'function') {
          if (realStat.uid !== process.getuid()) return;
        } else {
          const home = path.resolve(os.homedir()).toLowerCase();
          const real = path.resolve(realDir).toLowerCase();
          if (!real.startsWith(home + path.sep) && real !== home) return;
        }
      } else {
        realDir = dir;
      }
    } catch (e) {
      return;
    }

    const realPath = path.join(realDir, path.basename(filePath));
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(realPath, flags, 0o600);
      fs.writeSync(fd, String(line).replace(/\n$/, '') + '\n');
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    // Rotate: keep only the newest half-cap once the file exceeds the cap.
    const st = fs.lstatSync(realPath);
    if (st.isFile() && !st.isSymbolicLink() && st.size > MAX_HISTORY_BYTES) {
      let rfd;
      let tail;
      try {
        rfd = fs.openSync(realPath, fs.constants.O_RDONLY | O_NOFOLLOW);
        tail = readTail(rfd, st.size, MAX_HISTORY_BYTES / 2);
      } finally {
        if (rfd !== undefined) fs.closeSync(rfd);
      }
      const tempPath = realPath + `.${process.pid}.${Date.now()}`;
      const wflags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
      let wfd;
      try {
        wfd = fs.openSync(tempPath, wflags, 0o600);
        fs.writeSync(wfd, tail);
      } finally {
        if (wfd !== undefined) fs.closeSync(wfd);
      }
      fs.renameSync(tempPath, realPath);
    }
  } catch (e) {
    // Silent fail — history is best-effort
  }
}

function readHistory(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    let fd;
    let raw;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
      raw = readTail(fd, st.size, MAX_HISTORY_BYTES);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return raw.split('\n').filter(line => line.trim());
  } catch (e) {
    return [];
  }
}

module.exports = { getDefaultMode, getConfigDir, getConfigPath, VALID_MODES, safeWriteFlag, readFlag, appendFlag, readHistory };
