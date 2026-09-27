# v0.74 第一版冻结基线

冻结日期：2026-09-27

这是 TRIAD 第一版规则与人格配置的冻结基线。后续规则、角色或入口行为改动应使用新的版本记录，不直接改写本文件所描述的行为。

## 冻结内容

- 入口把用户输入分为 `agenda`、`emotion`、`multiple`、`fact`、`self_worth`、`crisis`、`violence` 和 `unclear`。
- 只有 `agenda` 进入三角色投票；其他类别直接返回对应状态，不产生虚假的角色票。
- 理性、守护、自我由同一 Jev 模型独立调用，至少两票是才通过；角色思考过程不返回浏览器。
- 页面第二单元后台角色为 `guardian`，界面有意使用主题化别名“存续 / CONTINUITY”。
- 入口属性包含个人方向、主体、选择数量、活动场景、安全情境、压力性质、议案清晰度和决策画像。
- 深夜非紧急户外/出行、威胁或胁迫、影响基本生活的财务风险由结构化约束保护；急诊等必要医疗行动不被非紧急夜间规则拦截。
- 短句规则支持省略主语的明确行动、具体个人边界、“我可以……”行动问句和“想 A 也想 B”多选结构；泛化对象缺失仍保持 `unclear`。
- 页面提供一句话输入、角色卡、最终多数结果、情绪/事实/多选/照护状态、会话历史和 CRT 开关。

## 验收证据

- `npm test`：23 / 23 通过。
- `node --check decision.mjs`：通过。
- `node --check server.mjs`：通过。
- `git diff --check`：通过。
- `/api/health`：`configured: true`，`version: 0.74`。
- [E2E-ACCEPTANCE-v0.75.md](/Users/xavier/Desktop/超高智能个人即时决策系统/E2E-ACCEPTANCE-v0.75.md)：60 条 × 3 次，共 180 次真实 Jev 请求，第二次完整复跑无错误、路线和票型均稳定。
- [UI-ACCEPTANCE-v0.75.md](/Users/xavier/Desktop/超高智能个人即时决策系统/UI-ACCEPTANCE-v0.75.md)：正常议案、情绪、多选、历史记录和 CRT 开关已完成浏览器验收。
- 视口检查：390×844、768×1024、1440×900 均无横向或纵向溢出。
- [ui-v074-mobile-390.png](/Users/xavier/Desktop/超高智能个人即时决策系统/output/playwright/ui-v074-mobile-390.png) 和 [ui-v074-desktop-1440.png](/Users/xavier/Desktop/超高智能个人即时决策系统/output/playwright/ui-v074-desktop-1440.png)：冻结时的视觉快照。

## 发布边界

当前仍是本地原型。正式公开前需要在目标服务器上配置真实 Key、HTTPS、Nginx/PM2 或 Windows 服务，并按 [deploy/DEPLOY.md](/Users/xavier/Desktop/超高智能个人即时决策系统/deploy/DEPLOY.md) 完成部署后的健康检查。冻结不代表已经完成公网部署。
