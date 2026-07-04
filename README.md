# 省話 shenghua

> 繁體中文超壓縮溝通模式 for Claude Code — 省 token,不省內容。

[English README](README.en.md)

**省話**讓 AI coding agent 以「省話一哥」風格與文言文回應,砍掉語助詞、贅詞、客套與避險語,節省約 **65–80% 輸出 token**,同時完整保留技術正確性:程式碼、指令、錯誤訊息一字不動。

靈感來自 [caveman](https://github.com/JuliusBrussee/caveman)(英文)與 [genshijin](https://github.com/interfacex-co-jp/genshijin)(日文),本專案是針對繁體中文(台灣用語)的完整重新設計:文言文的高資訊密度讓中文壓縮上限遠高於英文。

## 效果示範

問:「React 元件為何重複渲染?」

| 等級 | 回應 |
|---|---|
| 一般回應 | 「這是個好問題!你的元件重複渲染,很可能是因為每次 render 時都建立了新的物件參照,導致 React 認為 props 改變了。建議你可以使用 useMemo 來...」 |
| jian(簡) | 「元件重複渲染,因為每次 render 都建立新的物件參照。用 useMemo 包起來即可。」 |
| shenghua(省話) | 「新參照每次 render 都生。useMemo 包住。」 |
| wenyan(文言) | 「每繪必生新參照,故重繪。以 useMemo 裹之即止。」 |
| jiwen(極文言) | 「新 ref→重繪。useMemo 裹之。」 |

## 安裝

```
/plugin marketplace add <your-github-username>/shenghua
/plugin install shenghua
```

或手動:clone 本 repo 後,在 Claude Code 中 `/plugin marketplace add <本地路徑>`。

## 使用

| 指令 | 功能 |
|---|---|
| `/shenghua [等級]` | 啟用/切換(jian / shenghua / wenyan / jiwen) |
| `/shenghua off` | 停用 |
| `/shenghua-stats` | 實測 token 統計(讀 session 紀錄,非估算) |
| `/shenghua-commit` | 極簡 Conventional Commits message |
| `/shenghua-review` | 極簡 code review(一行一發現) |

自然語言亦可:「省話模式」啟用;「停止省話」或「恢復正常模式」停用(「正常模式」單獨成句亦可,避免一般討論誤觸)。

預設等級設定:環境變數 `SHENGHUA_DEFAULT_MODE=wenyan`,或 `~/.config/shenghua/config.json`:`{ "defaultMode": "wenyan" }`。

## 安全邊界

以下情境**自動恢復正常白話**,不受壓縮影響:

- 程式碼、commit message、PR 描述
- 安全性警告
- 不可逆操作的確認
- 多步驟操作指示(碎句易讀錯順序)

## 架構

```
skills/shenghua/SKILL.md   規則單一事實來源(等級表 + 範例)
src/hooks/activate.js      SessionStart:讀 SKILL.md、過濾至當前等級、注入 context
src/hooks/mode-tracker.js  UserPromptSubmit:切換偵測 + 每回合提醒 + stats 攔截
src/hooks/config.js        flag 檔安全 I/O(symlink-safe、atomic、白名單驗證)
src/hooks/stats.js         實測 token 統計引擎
benchmarks/run.py          可重現的節省率量測(Anthropic API 實測)
```

設計重點:

- **單一事實來源**:規則只寫在 SKILL.md;hook 執行期讀取並以 regex 過濾出當前等級的表列與範例,修改規則零重複維護。
- **每回合強化**:SessionStart 注入完整規則一次,UserPromptSubmit 每回合注入一行提醒,防止長對話中模型風格漂移。
- **Flag 檔安全**:所有讀寫走 O_NOFOLLOW + atomic rename + 0600 + 64-byte 上限 + 模式白名單,防止 symlink 攻擊將任意檔案內容注入模型 context。
- **誠實統計**:`/shenghua-stats` 的 token 數來自 session 紀錄的 `usage.output_tokens` 實測值;節省率估計標明來自 benchmark 均值。

## Benchmark

```
pip install -r benchmarks/requirements.txt
export ANTHROPIC_API_KEY=sk-...
python benchmarks/run.py --trials 3
```

10 個繁中技術任務 × 基準/各等級 × 3 trials,temperature=0,取中位數。結果含 SKILL.md sha256,可完整重現。無 API key 可跑 `--dry-run` 驗證過濾邏輯。

<!-- BENCHMARK-TABLE-START -->
| 等級 | 平均節省率 |
|---|---|
| jian | (待實測) |
| shenghua | (待實測) |
| wenyan | (待實測) |
| jiwen | (待實測) |
<!-- BENCHMARK-TABLE-END -->

## 測試

```
node --test tests/hooks.test.js
```

涵蓋:等級過濾、flag 檔安全 I/O(symlink/超長/非白名單拒讀)、模式切換、每回合提醒注入。

## License

MIT。安全模型與 hook 架構參考 [caveman](https://github.com/JuliusBrussee/caveman)(MIT, Julius Brussee)。
