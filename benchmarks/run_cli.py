#!/usr/bin/env python3
"""shenghua benchmark via Claude Code CLI (subscription; no API key).

Same method as run.py but each (prompt, system) pair runs through
`claude -p` headless mode, so it consumes Claude Pro/Max quota instead of
API credits. Trade-offs vs run.py, disclose alongside results:

  * temperature is not controllable (no temperature=0) — use >=3 trials
    or expect noisier medians.
  * The Claude Code system prompt underlies both baseline and levels;
    level rules are injected with --append-system-prompt.
  * --settings '{"disableAllHooks":true}' isolates runs from local plugins
    (a style-compression hook would otherwise contaminate the baseline).

Usage:
    python benchmarks/run_cli.py [--trials 1] [--model sonnet]
                                 [--levels shenghua wenyan]

Progress is written incrementally to benchmarks/results/cli_progress.json
after every call; rerunning skips completed (prompt, system, trial) cells.
"""

import argparse
import hashlib
import json
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import load_skill_for_level, LEVELS, BASELINE_SYSTEM, SKILL_PATH, PROMPTS_PATH, RESULTS_DIR

PROGRESS_PATH = RESULTS_DIR / "cli_progress.json"


# 打一次 claude CLI,回傳這次回答花掉的 output token 數。
# 原理:`claude -p "問題"` 是無互動模式 — 問一題、答完就退出,
# `--output-format json` 讓它把回答連同 usage(token 統計)以 JSON 印出,
# 我們只取 usage.output_tokens 這個數字。
def call_cli(model: str, append_system: str, prompt: str) -> int:
    cmd = [
        "claude", "-p", prompt,
        "--output-format", "json",
        "--model", model,
        # 關掉本機所有 hooks:你裝的 caveman/shenghua 外掛也會在
        # headless session 注入壓縮規則,不關的話「基準組」也被壓縮,
        # 節省率就會被低估 — 實驗組和對照組必須只差一個變因。
        "--settings", '{"disableAllHooks":true}',
        # 把該等級的省話規則附加到 system prompt;baseline 組附加的
        # 則是一句普通助理描述,兩組唯一差異就是這段規則。
        "--append-system-prompt", append_system,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                         timeout=300, shell=(sys.platform == "win32"))
    if out.returncode != 0:
        raise RuntimeError(f"claude CLI exit {out.returncode}: {out.stderr[:300]}")
    # stdout 最後一行才是結果 JSON(前面可能有雜訊行)。
    data = json.loads(out.stdout.strip().splitlines()[-1])
    if data.get("is_error"):
        raise RuntimeError(f"claude CLI error result: {data.get('result', '')[:300]}")
    return int(data["usage"]["output_tokens"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--levels", nargs="+", default=LEVELS, choices=LEVELS)
    args = ap.parse_args()

    prompts = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))["prompts"]
    skill_sha = hashlib.sha256(SKILL_PATH.read_bytes()).hexdigest()

    RESULTS_DIR.mkdir(exist_ok=True)
    # cells = 進度表:每格 key 是 "題目|組別|第幾次",value 是 token 數。
    # 每打完一次 API 就整份寫回 cli_progress.json,所以中途被中斷,
    # 重跑時已完成的格子直接跳過,不會浪費額度重打。
    cells = {}
    if PROGRESS_PATH.exists():
        cells = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))

    # 受測組別:baseline(普通助理)+ 使用者指定的各省話等級。
    # 每個等級的 system prompt 由 run.py 的 load_skill_for_level 產生
    # (讀 SKILL.md、過濾出該等級的規則列)。
    systems = {"baseline": BASELINE_SYSTEM}
    for lv in args.levels:
        systems[lv] = load_skill_for_level(lv)

    total = len(prompts) * len(systems) * args.trials
    done = 0
    for p in prompts:
        pid, prompt = p["id"], p["prompt"]
        for name, system in systems.items():
            for t in range(args.trials):
                key = f"{pid}|{name}|{t}"
                done += 1
                if key in cells:
                    continue
                print(f"[{done}/{total}] {pid} {name} trial {t}...", flush=True)
                try:
                    cells[key] = call_cli(args.model, system, prompt)
                except Exception as e:
                    print(f"  FAILED: {e}", flush=True)
                    continue
                PROGRESS_PATH.write_text(json.dumps(cells, ensure_ascii=False),
                                         encoding="utf-8")
                time.sleep(1)

    results = {"method": "claude-code-cli", "model": args.model,
               "trials": args.trials, "skill_md_sha256": skill_sha,
               "timestamp": datetime.now(timezone.utc).isoformat(),
               "prompts": {}}
    # 統計:同一格若跑多次(trials>1),取中位數壓掉離群值;
    # 節省率 = 1 - 該等級 token / baseline token。
    # 例:baseline 500 tokens、wenyan 150 tokens → 節省 1-150/500 = 70%。
    level_savings = {lv: [] for lv in args.levels}
    for p in prompts:
        pid = p["id"]
        def med(name):
            vals = [cells[f"{pid}|{name}|{t}"] for t in range(args.trials)
                    if f"{pid}|{name}|{t}" in cells]
            return int(statistics.median(vals)) if vals else None
        base = med("baseline")
        entry = {"baseline_output_tokens": base, "levels": {}}
        for lv in args.levels:
            tok = med(lv)
            # 該題 baseline 或該等級呼叫失敗 → 缺資料,這題不列入該等級平均。
            if base and tok is not None:
                saving = 1 - tok / base
                entry["levels"][lv] = {"output_tokens": tok,
                                       "savings": round(saving, 4)}
                level_savings[lv].append(saving)
        results["prompts"][pid] = entry

    results["summary"] = {
        lv: {"mean_savings": round(statistics.mean(v), 4),
             "median_savings": round(statistics.median(v), 4)}
        for lv, v in level_savings.items() if v
    }

    out = RESULTS_DIR / f"benchmark_cli_{int(time.time())}.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(f"\n寫入 {out}")
    for lv, s in results["summary"].items():
        print(f"  {lv}: mean {s['mean_savings']:.1%}  median {s['median_savings']:.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
