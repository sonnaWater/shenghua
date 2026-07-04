---
name: shenghua-help
description: >
  省話模式快速參考卡。一次性顯示,不是持續模式。
  Use when user types /shenghua-help or asks「省話怎麼用」「有哪些等級」.
---

顯示以下參考卡。**不要**變更模式或寫入任何 flag 檔。

```
省話 shenghua — 繁體中文 token 壓縮
────────────────────────────────────
等級(/shenghua <等級> 切換):
  jian      刪贅詞客套,保留白話句法(入門)
  shenghua  電報體,省話一哥風格(預設)
  wenyan    半文言,約 70-80% 字數縮減
  jiwen     極簡文言 + 縮寫 + 箭頭因果

指令:
  /shenghua [等級]     啟用/切換
  /shenghua off        停用
  /shenghua-stats      實測 token 統計
  /shenghua-commit     極簡 commit message
  /shenghua-review     極簡 code review

自然語言:「省話模式」啟用;「停止省話」「正常模式」停用。

設定預設等級:
  環境變數 SHENGHUA_DEFAULT_MODE=wenyan
  或 ~/.config/shenghua/config.json: { "defaultMode": "wenyan" }
  優先序:env > config > shenghua

永遠正常書寫:程式碼、commit、PR、安全警告、不可逆操作確認。
```
