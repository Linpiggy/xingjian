# 项目 Agent 规范

## 项目与范围

- “传智杯”AI Web 赛道作品：AI 旅行规划 Agent。用户输入需求，Agent 通过工具调用与 RAG 生成完整多日行程（景点、三餐、交通、时刻、预算），支持对话式调整与撤销。
- 单城市 1—7 天、1—20 人；数据源仅限高德开放平台官方接口与本地知识库。不做抓取、逆向第三方平台、出票支付或账号体系。
- 不擅自安装依赖、注册账号、购买接口、推送远程或部署。

## 架构约束

- Next.js App Router + React + TypeScript，依赖版本锁定；Next 16 有破坏性变更，写代码前查 `node_modules/next/dist/docs/`。
- `src/lib` 为前后端共享的纯 TypeScript（契约、排程、空间算法），不依赖 React、Next 或网络。
- `src/server` 只在服务端运行：Route Handler 只做同源、输入校验、限流与错误映射；Agent 编排在 `server/agent`；外部请求只经 `server/providers` 与 `server/llm`。
- 前端状态统一放在 `src/store`（Zustand），Agent 流事件只经 `applyEvent` 写入。
- Zod 校验表单、HTTP、模型工具参数与供应商响应；不用 `any` 绕过契约。

## 事实与安全不变量

- 模型只能使用本次会话工具返回的地点 ID；知识引用须是已检索条目。新增工具必须同样校验。
- 时刻由确定性排程器计算；冲突以警告呈现，不静默删除站点。
- 未知价格为 `null`，不是 0；天气超出预报范围显示未知；缺失路线不补直线。
- 模型文本经 `cleanText` 清理，不允许外链；用户输入视为数据。
- 凭据只在 `.env.local`；`NEXT_PUBLIC_*` 只放可公开的 JS Key。

## 界面

- 设计变量只在 `src/app/globals.css` 的 `@theme` 中定义，组件使用语义类（paper / ink / pine / clay / sky / amber），不写零散色值。
- 交互基础组件在 `src/components/ui.tsx`，新增同类控件先复用。
- 加载、空态、错误、未配置、未知、冲突都要可见；控件可键盘操作并有可访问名称；尊重 reduced motion。
- 网页不写开发进度或环境配置教程。

## 执行与验收

- 改动后运行相关检查：`npm run check`（含 secrets / format / lint / typecheck / test），UI 或流程变化再跑 `npm run e2e`；只汇报实际执行结果。
- 真实模型 / 高德调用会消耗额度，验证时控制次数；`npm run evaluate` 一次约数百次高德调用，需要时才运行。
- 修改 `tripSchema` 等持久化结构时，新字段给默认值并在 `src/store/trips.ts` 的 `migrate` 中处理旧数据。
- 每轮测试后本地提交 Git；不推送、不改全局配置、不重写历史。
