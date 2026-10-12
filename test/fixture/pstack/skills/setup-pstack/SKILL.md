---
name: setup-pstack
description: fixture
---

### 5. Write the rule

Write `~/.cursor/rules/pstack-models.mdc`. Shape:

```
---
description: pstack per-role model choices
alwaysApply: true
---
# budget: large (xhigh)
feature, refactoring: grok-4.7-xhigh-fast
judgment and prose: claude-opus-5-5-xhigh
arena runners: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast
```
