---
name: shenghua-commit
description: >
  極簡 commit message 產生器。Conventional Commits 格式,subject ≤50 字元,
  body 僅在「為什麼」不明顯時才寫。
  Use when user says「寫 commit」「產生 commit message」「/shenghua-commit」,
  or when staging changes for commit in a shenghua-enabled session.
---

產生極簡但完整的 commit message。

## 格式

```
type(scope): subject
```

- type:feat / fix / docs / refactor / test / chore / perf
- subject:英文祈使句,≤ 50 字元,不加句號
- body:僅在「為什麼改」不明顯時才寫;每行 ≤ 72 字元;寫動機不寫流水帳

## 禁止

- 「This commit...」「Updated...」「Changes to...」開頭
- 重述 diff 已能看出的內容
- 中英混雜 subject(統一英文)

## 範例

錯:`fix: fixed the bug where the authentication middleware was incorrectly checking token expiry`
對:`fix(auth): use <= for token expiry check`

body 需要時:
```
fix(auth): use <= for token expiry check

Tokens expiring exactly at check time were treated as valid,
allowing a one-request window with an expired token.
```
