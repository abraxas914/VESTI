# 捕获问题诊断

## 问题 1: Gemini 标题捕获

### 当前行为
- 使用对话开头部分作为标题
- 无法捕获原始对话标题

### 当前选择器
```typescript
title: ["[role='heading']", "main h1", "header h1", "title"]
```

### 诊断步骤
1. 打开 Gemini 对话页面
2. 在控制台运行：
```javascript
// 检查标题元素
document.querySelector("[role='heading']")?.textContent
document.querySelector("main h1")?.textContent
document.querySelector("header h1")?.textContent

// 检查所有可能的标题位置
document.querySelectorAll("h1, h2, [role='heading']").forEach(el => {
  console.log(el.textContent, el.className, el.getAttribute('data-testid'));
});
```

### 可能的修复
需要找到 Gemini 实际的标题选择器。

---

## 问题 2: Claude 捕获问题

### 症状
1. 只捕获第一个对话
2. 其余对话无法捕获
3. 标题无法正常捕获

### 可能原因
1. **选择器失效** - Claude 更新了 DOM 结构
2. **去重逻辑过激** - 误判为重复消息
3. **角色推断失败** - 无法识别用户/AI 角色

### 诊断步骤

---

## 问题 3: 元宝 (Yuanbao) 无法捕获 — 已修复 (feat/debug-and-enhancement)

### 症状
- 在 yuanbao.tencent.com 打开对话后，扩展不归档任何内容。

### 根因分析
1. **缺少初始捕获触发** — `frontend/src/contents/yuanbao.ts` 只依赖
   `MutationObserver`，没有 chatgpt.ts 里的 `setTimeout(capture)` 初始触发。
   对于打开即已渲染完毕、之后不再产生 DOM 变更的对话，observer 永不触发，
   导致从不捕获。
2. **`isGenerating()` 选择器过宽** — `[class*='stream'|'typing'|'generating']`
   未限定作用域，可能命中页面常驻元素，使 `isGenerating()` 永远为真，
   从而每次捕获都因 `still_generating` 被跳过。

### 修复
- 在 `contents/yuanbao.ts` 增加错峰初始捕获 (1500ms / 4000ms) 与一次性
  诊断日志（URL / sessionUUID / isGenerating / bubble 计数）。
- 在 `YuanbaoParser` 将 streaming 类选择器限定到 `.agent-chat__bubble--ai`
  内部，并在 `isGenerating()` 命中时输出 `logger.debug` 以便定位。
- 在共享的 `capturePipeline` 为零消息提前返回补充 `no_messages` info 日志，
  使后续“无法捕获”反馈可自诊断。

### 验证方式
重新加载扩展 → 打开元宝对话 → 控制台过滤 `[Vesti]`，查看
`Yuanbao capture diagnostic` 与 `Capture processed/skipped` 日志确认链路。

---

## 问题 4: chrome://extensions 错误面板被解析器告警污染 — 已修复

### 症状
- 扩展的“错误”面板出现 `ChatGPT parser captured only one role` 等告警
  （见 bug 截图），使扩展看起来在报错。

### 根因
- Chrome 错误面板会收集扩展上下文的 `console.warn` / `console.error`。
  解析器把“只捕获到一种角色 / 零消息 / AST 性能模式切换 / anchor 回退”等
  **可观测性启发式**用 `logger.warn` 输出，这些并非可由用户处理的错误。

### 修复
- 在 `logger.ts` 新增 `debug` 级别（走 `console.debug`，错误面板不收集）。
- 将 7 个解析器中 25 处启发式 `logger.warn("parser", …)` 统一降级为
  `logger.debug`，`warn`/`error` 仅保留真正可处置的失败。
