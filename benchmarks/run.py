#!/usr/bin/env python3
"""shenghua benchmark harness.

Measures output-token savings of each shenghua level against a normal
assistant baseline, using real Anthropic API token counts.

Usage:
    export ANTHROPIC_API_KEY=sk-...
    python benchmarks/run.py [--trials 3] [--model claude-sonnet-5]
                             [--levels shenghua wenyan] [--dry-run]

Method:
  * Each prompt in prompts.json is run against:
      - baseline system prompt ("你是一位樂於助人的軟體工程助理。")
      - shenghua system prompt = skills/shenghua/SKILL.md filtered to <level>
  * temperature=0, max_tokens=4096, N trials per (prompt, system) pair.
  * Reported number per pair = median output_tokens across trials.
  * savings(level) = 1 - median_level / median_baseline, macro-averaged
    over prompts.
  * Results written to benchmarks/results/benchmark_<timestamp>.json with
    the SKILL.md sha256 for reproducibility.
"""

import argparse
import hashlib
import json
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_PATH = ROOT / "skills" / "shenghua" / "SKILL.md"
PROMPTS_PATH = Path(__file__).resolve().parent / "prompts.json"
RESULTS_DIR = Path(__file__).resolve().parent / "results"

BASELINE_SYSTEM = "你是一位樂於助人的軟體工程助理。"
LEVELS = ["jian", "shenghua", "wenyan", "jiwen"]


def load_skill_for_level(level: str) -> str:
    """Read SKILL.md, strip frontmatter, keep only the given level's
    table row and example lines — same filtering as src/hooks/activate.js."""
    text = SKILL_PATH.read_text(encoding="utf-8")
    body = re.sub(r"^---[\s\S]*?---\s*", "", text)
    out = []
    for line in body.splitlines():
        m = re.match(r"^\|\s*\*\*(\S+?)\*\*\s*\|", line)
        if m:
            if m.group(1) == level:
                out.append(line)
            continue
        m = re.match(r"^- (\S+?):\s", line)
        if m:
            if m.group(1) == level:
                out.append(line)
            continue
        out.append(line)
    return f"省話模式啟用 — 等級: {level}\n\n" + "\n".join(out)


def run_pair(client, model: str, system: str, prompt: str, trials: int) -> int:
    counts = []
    for _ in range(trials):
        resp = client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        counts.append(resp.usage.output_tokens)
        time.sleep(1)
    return int(statistics.median(counts))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--model", default="claude-sonnet-5")
    ap.add_argument("--levels", nargs="+", default=LEVELS, choices=LEVELS)
    ap.add_argument("--dry-run", action="store_true",
                    help="驗證 prompts/SKILL.md 載入與過濾邏輯,不呼叫 API")
    args = ap.parse_args()

    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))["prompts"]
    skill_sha = hashlib.sha256(SKILL_PATH.read_bytes()).hexdigest()

    if args.dry_run:
        for level in args.levels:
            filtered = load_skill_for_level(level)
            others = [lv for lv in LEVELS if lv != level]
            assert f"**{level}**" in filtered, f"missing own row: {level}"
            for o in others:
                assert f"| **{o}** |" not in filtered, f"leaked row {o} in {level}"
                assert f"\n- {o}: " not in filtered, f"leaked example {o} in {level}"
        print(f"dry-run OK: {len(prompts)} prompts, "
              f"{len(args.levels)} levels filtered correctly, "
              f"skill sha256={skill_sha[:12]}")
        return 0

    try:
        import anthropic
    except ImportError:
        print("需要 anthropic 套件:pip install -r benchmarks/requirements.txt",
              file=sys.stderr)
        return 1

    client = anthropic.Anthropic()
    results = {"model": args.model, "trials": args.trials,
               "skill_md_sha256": skill_sha,
               "timestamp": datetime.now(timezone.utc).isoformat(),
               "prompts": {}}

    level_savings = {lv: [] for lv in args.levels}
    for p in prompts:
        pid, prompt = p["id"], p["prompt"]
        print(f"[{pid}] baseline...", flush=True)
        base = run_pair(client, args.model, BASELINE_SYSTEM, prompt, args.trials)
        entry = {"baseline_output_tokens": base, "levels": {}}
        for level in args.levels:
            print(f"[{pid}] {level}...", flush=True)
            tok = run_pair(client, args.model, load_skill_for_level(level),
                           prompt, args.trials)
            saving = 1 - tok / base if base else 0.0
            entry["levels"][level] = {"output_tokens": tok,
                                      "savings": round(saving, 4)}
            level_savings[level].append(saving)
        results["prompts"][pid] = entry

    results["summary"] = {
        lv: {"mean_savings": round(statistics.mean(v), 4),
             "median_savings": round(statistics.median(v), 4)}
        for lv, v in level_savings.items() if v
    }

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"benchmark_{int(time.time())}.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(f"\n寫入 {out}")
    for lv, s in results["summary"].items():
        print(f"  {lv}: mean {s['mean_savings']:.1%}  median {s['median_savings']:.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
