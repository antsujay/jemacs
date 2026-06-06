# packages-test/

Tests for plugins that live in the **sibling** `jemacs-packages` repo (Stephen's split).

These import `../../../jemacs-packages/...` so they only work when that repo is checked out alongside this one. They are deliberately **outside** `test/` so `bun test` doesn't pick them up by default.

Run explicitly:
```
bun test packages-test/projectile.ts packages-test/file-sidebar.ts
```
