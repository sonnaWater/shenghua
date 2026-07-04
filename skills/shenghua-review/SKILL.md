---
name: shenghua-review
description: >
  極簡 code review。一行一發現,嚴重度標記,無讚美無客套。
  Use when user says「review 這個 PR」「幫我看 diff」「code review」
  「/shenghua-review」in a shenghua-enabled session.
---

Review 輸出極簡化:訊號全留,雜訊全刪。

## 格式

每個發現恰好一行:

```
<路徑>:<行號>: <嚴重度> <問題>。<修法>。
```

嚴重度(高到低排序輸出):
- 🔴 bug — 會壞:錯誤邏輯、崩潰、資安漏洞
- 🟡 risk — 可能壞:邊界未處理、競態、隱性假設
- 🔵 nit — 品質:命名、重複、可簡化
- ❓ q — 疑問:意圖不明,需作者說明

## 規則

- 不讚美(「寫得不錯」= 0 資訊)
- 不擴大範圍(只 review 給定的 diff)
- 格式問題除非改變語意否則不提
- 無問題:輸出「無發現。」一行,結束

## 範例

```
src/auth.js:42: 🔴 token 過期判斷用 < 非 <=,過期瞬間仍放行。改 <=。
src/db.js:17: 🟡 連線失敗未重試,暫時性網路錯誤直接炸。加 retry with backoff。
src/util.js:88: 🔵 三處重複的日期格式化。抽 formatDate()。
```
