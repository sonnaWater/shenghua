# shenghua (省話)

> Ultra-compressed Traditional Chinese communication mode for Claude Code — save tokens, not substance.

[繁體中文 README](README.md)

**shenghua** ("terse-talker", from Taiwanese slang 省話一哥 — "the man of few words") makes AI coding agents respond in telegraphic Mandarin and Classical Chinese (文言文), cutting particles, filler, pleasantries, and hedging for roughly **65–80% output-token savings** — while keeping technical content byte-exact: code, commands, and error messages are never altered.

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) (English) and [genshijin](https://github.com/interfacex-co-jp/genshijin) (Japanese). This is a ground-up redesign for Traditional Chinese: Classical Chinese's extreme information density gives Chinese a far higher compression ceiling than English.

## Example

Q: "Why does my React component keep re-rendering?"

| Level | Response |
|---|---|
| normal | "Great question! Your component is probably re-rendering because a new object reference is created on every render, so React thinks props changed. You could consider using useMemo to..." |
| jian | 「元件重複渲染,因為每次 render 都建立新的物件參照。用 useMemo 包起來即可。」 |
| shenghua | 「新參照每次 render 都生。useMemo 包住。」 |
| wenyan | 「每繪必生新參照,故重繪。以 useMemo 裹之即止。」 |
| jiwen | 「新 ref→重繪。useMemo 裹之。」 |

## Install

```
/plugin marketplace add <your-github-username>/shenghua
/plugin install shenghua
```

## Usage

| Command | Effect |
|---|---|
| `/shenghua [level]` | Activate / switch level (jian / shenghua / wenyan / jiwen) |
| `/shenghua off` | Deactivate |
| `/shenghua-stats` | Real token stats (read from session logs, not estimated) |
| `/shenghua-commit` | Terse Conventional Commits message |
| `/shenghua-review` | Terse code review (one line per finding) |

Default level: env `SHENGHUA_DEFAULT_MODE=wenyan` or `~/.config/shenghua/config.json` `{ "defaultMode": "wenyan" }`.

## Safety boundaries

Always written in plain, uncompressed language: code, commit messages, PRs, security warnings, irreversible-action confirmations, multi-step instructions.

## Architecture

- **Single source of truth** — rules live only in `skills/shenghua/SKILL.md`; the SessionStart hook reads it at runtime and regex-filters the level table + examples to the active level.
- **Per-turn reinforcement** — a UserPromptSubmit hook injects a one-line reminder every turn, preventing style drift in long conversations.
- **Symlink-safe flag I/O** — O_NOFOLLOW, atomic temp+rename, 0600, 64-byte cap, mode whitelist; a planted symlink can never leak file contents into model context.
- **Honest stats** — `/shenghua-stats` sums real `usage.output_tokens` from session transcripts; savings estimates cite benchmark-measured means.

## Benchmark

```
pip install -r benchmarks/requirements.txt
export ANTHROPIC_API_KEY=sk-...
python benchmarks/run.py --trials 3
```

10 Traditional Chinese engineering tasks × baseline/each level × 3 trials, temperature=0, median. Results include the SKILL.md sha256 for reproducibility. Without an API key, `--dry-run` validates the filtering logic.

## Tests

```
node --test tests/hooks.test.js
```

## License

MIT. Security model and hook architecture adapted from [caveman](https://github.com/JuliusBrussee/caveman) (MIT, Julius Brussee).
