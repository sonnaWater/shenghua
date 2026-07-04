---
name: shenghua-stats
description: >
  顯示本 session 實測 token 用量與估計節省。數據由 hook 直接讀取
  Claude Code session 紀錄(.jsonl)計算,模型本身不估算數字。
  Use when user types /shenghua-stats or asks「省了多少 token」.
---

此 skill 的行為由 `src/hooks/mode-tracker.js` 攔截 `/shenghua-stats` 實現:
hook 以 `decision: "block"` 回傳格式化統計,使用者立即看到結果。

**模型不需(也不應)自行計算任何數字** — 所有 token 數來自
session 紀錄檔中的 `usage.output_tokens` 實測值;節省率來自
`benchmarks/` 實測均值。

參數:
- `/shenghua-stats` — 當前 session 統計
- `/shenghua-stats --all` — 歷史累計(讀 `.shenghua-history.jsonl`)

若 hook 未生效(手動安裝缺 hook),可直接執行:
`node src/hooks/stats.js`
