# v0.75 网页端交互验收

测试日期：2026-09-27

使用本地 Playwright 浏览器打开 `http://127.0.0.1:4317`，按真实用户路径操作页面。

## 已验证流程

- 初始页面加载成功，页面标题为 `TRIAD · 个人即时决策系统`，终端标识显示 v0.74；
- 提交 `我今天很累，想请一天假` 后，页面进入 `DECISION LOCKED`，三张角色卡显示票型，最终显示 `议案通过` 和 `3 票是｜0 票否`；
- 提交 `我好烦` 后，页面进入 `EMOTION FOUND`，角色卡保持“未表决”，最终显示感受提示，不产生投票；
- 提交 `我想跑步也想游泳` 后，页面进入 `MULTIPLE IDEAS`，角色卡保持“未表决”，最终显示拆分选择提示；
- 点击“查看议案记录”后，历史对话框列出本浏览器会话刚提交的议案；
- 点击 CRT 开关后，按钮从“关闭 CRT 屏幕效果 / ON”变为“开启 CRT 屏幕效果 / OFF”；
- 第二单元后台角色仍为 `guardian`，页面有意显示主题化别名“存续 / CONTINUITY”，与产品的终端世界观一致。

## 页面证据

- [ui-v074-standby.png](/Users/xavier/Desktop/超高智能个人即时决策系统/output/playwright/ui-v074-standby.png)：刷新后的待命页面；
- [ui-v074-multiple.png](/Users/xavier/Desktop/超高智能个人即时决策系统/output/playwright/ui-v074-multiple.png)：多选输入的页面状态。

## 自动检查

- `npm test`：23 / 23 通过；
- 页面快照确认入口、角色卡、最终状态、历史对话框和 CRT 按钮均可访问；
- `/api/health`：`configured: true`，规则版本 v0.74。
