# 测试与提交记录

按用户要求，每轮测试后提交本地 Git；提交记录以 `git log` 为准，不推送远程。每轮可以包含相关单元测试、类型检查、构建或浏览器检查；失败也如实记录，不能写成通过。

## 检查 0：设计与接口证据基线

- 范围：此前未提交的 Figma 设计源、8 张检验图、测量／审计记录，以及高德脱敏冒烟证据。
- 检查：UTF-8／LF、JSON、相对链接、PNG 尺寸、审计摘要、凭据泄漏与 Git 忽略规则、`git diff --check`。
- 结果：通过。8 个 Figma 交付节点的自动审计均为 0 error / 0 warning；不是浏览器无障碍认证。
- 边界：此时尚无应用代码；高德 5 次真实请求来自已有冒烟测试，不在本轮重复调用。天气仍未实测。

## 检查 1：应用脚手架与首次静态检查

- 已创建：Next.js／React／TypeScript 脚手架，表单和响应式工作台，高德地点／步行适配器、同源 API、地图 Loader 与安全代理，以及离线单元／浏览器测试。
- 依赖：精确版本与锁文件；`npm install --ignore-scripts --no-audit --no-fund` 成功。安装有 peer override 提示；顶层依赖检查正常，仍需实际编译验证。
- 执行：`npm run check && npm run build`。
- 结果：失败。ESLint `react-hooks/purity` 拒绝在页面渲染中直接调用 `Date.now()`；PostCSS 默认匿名导出有 1 条警告。
- 未执行：命令短路，因此类型检查、单元测试与构建尚未运行；没有实际供应商调用。
- 处理：先提交本轮代码与失败证据，下一轮改为请求级服务端日期生成并消除配置警告，再复测。
- 凭据事件：提交前扫描检出 `.env.example` 中出现真实 JS 安全密钥，但组合命令未以失败状态阻断提交，造成一次未推送的本地提交包含凭据。示例已恢复为空值。用户明确授权仅修正该最新提交并清除其旧引用／不可达对象，不改更早的历史；控制台密钥重置由用户处理。后续提交必须使用失败即停止的命令和凭据检查。

## 检查 2：安全清理与静态检查复测

- 安全清理：用户授权后的最新提交为 `4247927`；原含凭据提交已无法读取，扫描全部保留 Git blob（含不可达对象）未发现本地私密凭据。更早的 `1da7c6c`、`054ab16` 保留；未推送。
- 改动：请求级缓存的上海日期、PostCSS 具名导出、工作树／暂存区凭据检查；浏览器测试使用独立端口并清空子进程供应商凭据，避免真实调用。
- 执行：`npm run check`，通过后才运行 `npm run build`。
- 结果：凭据检查、ESLint 通过；类型检查失败，Lucide 不导出 `ArrowClockwise`，高德基础类型未声明插件 `Scale`。
- 未执行：单元测试与构建；没有实际供应商调用。
- 下一步：修正图标名称和插件类型引用，再复测。

## 检查 3：静态检查、单元测试与构建

- 改动：使用实际导出的 Lucide `RotateCw`，移除本轮非必要、基础类型未覆盖的比例尺插件，不捏造第三方类型。
- 执行：`npm run check` 与 `NEXT_TELEMETRY_DISABLED=1 npm run build`。
- 结果：凭据检查、ESLint、TypeScript、4 个测试文件的 28 个离线单元测试全部通过；生产构建成功。
- 警告：Vitest 提示未来原生配置加载器需要 ESM 配置。
- 语义复查发现：构建路由列表没有地图安全代理。Next.js 将 `_AMapService` 目录视为私有目录，实际代理路由没有注册；因此本轮不能判定真实地图已可用。
- 下一步：使用 Next.js 支持的编码目录名注册固定 `/_AMapService` 前缀，添加代理测试并复查实际构建路由；之后执行浏览器检查。

## 检查 4：代理注册与静态验收

- 改动：代理目录使用 `%5FAMapService`，URL 前缀仍为官方要求的 `/_AMapService`；增加代理固定主机、凭据注入、越界路径与跨站测试；声明 ESM 配置；表单空数值不再转成零，补充中文错误信息。
- 执行：`npm run check`、`NEXT_TELEMETRY_DISABLED=1 npm run build`，独立读取 `.next/server/app-paths-manifest.json`。
- 结果：凭据检查、ESLint、TypeScript、5 个文件的 33 个离线单元测试、生产构建全部通过；构建清单实际注册了 `/_AMapService/[...path]`。
- 边界：代理单元测试使用假凭据与 mock upstream，不是 JS 地图实测；浏览器验收与实际 Web 服务联调尚未执行。

## 检查 5：首次浏览器验收

- 环境：Playwright Headless Shell 安装在项目 `node_modules` 内；测试服务器端口 3100，子进程三个高德凭据均为空，HTTP 响应由明确标为 fixture 的测试拦截提供。没有调用真实高德服务。
- 执行：`npm run e2e`，桌面 1440 × 1000 与窄屏 390 × 844，共 6 个用例。
- 结果：4 通过、2 失败。表单验证／焦点、生成草稿、选中详情、移动端弹窗／Esc、地图未配置、日期切换、新建清空确认，以及深浅色和无水平溢出检查通过。
- 失败证据：错误重试用例的 `getByRole('alert')` 同时匹配业务错误与 Next.js 路由播报器，产生 strict mode violation；不能据此宣称重试已通过。
- 已逐张检查桌面／窄屏、浅色／深色 PNG。截图与 trace 在被忽略的 `test-results/`，不是实际地图实测证据。
- 下一步：为业务错误增加明确可访问名称并修正测试定位，再复测。

## 检查 6：完整离线复测

- 改动：业务错误命名、窄屏地图视图按需挂载、精确解析整数分金额与金额回归测试；忽略并保留本地自动生成的 `next-env.d.ts`，类型检查先运行 `next typegen`；读取并保留 Next.js 自动写入根 `AGENTS.md` 的当前版本提示。
- 执行：`npm run check`、`npm run build`、`npm run e2e`。
- 结果：凭据、lint、类型检查、6 个文件的 35 个单元测试、生产构建、8 个桌面／窄屏浏览器用例全部通过；错误重试与空金额／小数金额验证已补验。
- 观察到的警告：初始表单截图默认隐藏光标，向输入框注入 `caret-color: transparent`，在 hydration 前产生 DOM 属性差异，React 报 hydration warning。测试结果通过不代表可忽略这条告警。
- 下一步：截图保留原始光标样式并显式捕获 hydration 告警，再复测；所有浏览器数据仍为明确标注的 fixture，真实地图未实测。

## 检查 7：无 hydration 告警的浏览器复测

- 改动：初始截图使用 `caret: initial`，不向未 hydration 的 DOM 写光标样式；浏览器用例显式捕获 hydration console error，不用 `suppressHydrationWarning` 隐藏问题。
- 执行：`npm run check`、`npm run e2e`。
- 结果：凭据检查、ESLint、类型检查、35 个单元测试及 8 个 E2E 用例全部通过，复测无 hydration 告警；首个用例同时验证无 pageerror。
- 构建：应用代码未在本轮变更，沿用检查 6 的通过结果；本轮没有重新运行构建。
- 边界：仍是离线 fixture 浏览器验收。下一步以最小次数验证实际应用 Web 服务接口；不调用尚待用户控制台重置确认的 JS 安全密钥。

## 检查 8：实际 HTTP 联调发现同源别名问题

- 已启动：本地开发服务器 `http://127.0.0.1:3000`，健康探测 HTTP 200 且项目标题正确。
- 执行：`npm run check`（含脚本 lint）通过，随后 `npm run smoke:live`。
- 结果：真实应用 POST 返回 HTTP 400，未生成实测证据。用空 JSON 进行两次不触发供应商的诊断：Origin 为 `127.0.0.1:3000` 时返回 `invalid_request`，为 `localhost:3000` 时通过同源门禁并返回 `invalid_input`。
- 原因：Next.js 将内部请求 URL 归一化为 localhost，而用户页面使用 127.0.0.1；直接比对字符串误拒绝同端口回环别名。
- 配额：此轮未进入供应商适配器，没有实际高德调用。
- 下一步：仅允许相同协议、端口的两个明确回环别名，不放开任意 Origin；补充真实 HTTP 层回归，并按用户新要求展开代码和增加格式检查。

## 检查 9：代码规范化与同源修复，浏览器启动遇锁

- 改动：应用、配置、脚本与测试统一 Prettier 3.9.10 格式；两空格／UTF-8／LF，控制流强制完整大括号；加入 `format`、`format:check` 与 EditorConfig，并记录用户不压行偏好。忽略凭据和 Figma 生成稿。
- 同源修复：只接受相同协议与端口的 localhost／127.0.0.1 别名，仍拒绝异域、异端口、异协议及畸形 Origin；增加单元测试和真正进入 Route Handler 的离线 HTTP 回归用例。
- 依赖：锁定 ESLint 9.39.5 以满足 Next lint 插件的 peer 范围，安装不再有 peer override；npm 提示此 ESLint 主版本不再受官方支持，这是开发工具维护风险，后续须随插件兼容升级，并非已消除的风险。
- 执行：`npm run check`（含格式校验）、`npm run build` 全通过，37 个单元测试通过。
- E2E：未能启动，0 个用例执行；Next.js 拒绝同仓库同时运行两个 dev server，3000 上已有本助手启动的服务器（PID 24072），3100 无法取得 `.next/dev` 锁。
- 实测：因命令链在 E2E 启动中止，本轮 `smoke:live` 未执行，没有新增高德调用。
- 下一步：确认并停掉本助手启动的 3000 进程，完成隔离 E2E 后再启动 3000 做最小真实 API 联调；不复用带真实凭据的服务器运行离线 E2E。

## 检查 10：隔离构建目录、完整复测与真实应用冒烟

- 调整路径：读取当前 Next.js `distDir` 文档，使用只属于 Next.js 的固定 `.next-e2e` 目录；测试子进程显式设置 `TRAVEL_E2E=1`，生产／普通开发仍使用 `.next`。因此无需停掉已启动的 3000 开发服务，也没有复用其真实凭据。
- 执行：`npm run check`、`npm run build`、`npm run e2e`、`npm run smoke:live`。
- 结果：格式、凭据、ESLint、类型检查、37 个单元测试、生产构建、10 个 E2E 检查全部通过，浏览器无 hydration 告警。10 项中 8 项为桌面／窄屏 fixture UI 流程，2 项真正通过 HTTP 进入 Route Handler，使用空供应商 Key 返回明确的 `not_configured`。
- 实际应用：`POST /api/plans` 返回 HTTP 200，3 次高德地点查询＋1 次步行查询，3 个地点、1 条路线；4,494 米、3,595 秒、12 段 geometry。证据回读确认，见 `docs/evidence/app-smoke-2026-10-13.json`。
- 独立安全检查：读取生产与 E2E 客户端 JS、实际 3000 服务 HTML，与本地两项私密凭据比较，未发现私密值；未打印凭据。开发服务健康 HTTP 200，仍保留供本地查看。
- 边界：JS 底图、天气、完整餐饮／预算／预约／返程与 AI 等没有通过本轮验收；草稿仍未验证可执行，不扩大为生产上线承诺。JS 安全码需用户确认控制台重置后才继续底图实测。

## 检查 11：地图加载路径修正，lint 未通过

- 用户反馈：配色不满意、地图未加载，希望自定义地点与智能推荐并存。结构化选择未收到回答，本轮只推进不依赖偏好的地图排查；没有擅自更换配色或推荐技术。
- 代码检查发现：地图代理仍直接比对 Next 内部 URL Origin，未应用已验证的回环别名策略；地图构造对象后直接解除加载态，没有等待地图资源 `complete` 事件，也没有初始化超时。
- 待验证修复：代理复用同源门禁；初始化等待 complete，20 秒有界超时、区分 SDK／底图失败、卸载取消与一次性销毁；避免清理已销毁实例，并以首个地点作为初始地图中心。新增 6 个生命周期、2 个代理回归测试。
- 执行：`npm run check`，凭据与格式检查通过，ESLint 未通过：`route-map.tsx:44` 声明 `module` 变量触发 `@next/next/no-assign-module-variable`。
- 中止：类型检查、单元测试、构建与 E2E 未执行；没有真实高德请求，不能声称用户看到的地图问题已解决。
- 下一步：只修正 Loader 局部变量命名后复测；真实底图仍待安全码重置确认，配色／自定义范围／推荐方式待用户选择。

## 检查 12：地图生命周期与代理离线复测

- 修正：Loader 局部变量改为 `loaderModule`，未绕过 lint 规则。
- 执行：`npm run check`、`npm run build`、`npm run e2e` 全通过；7 个文件的 45 个单元测试、10 项 E2E 检查通过。
- 新增验证：模拟 SDK 的 complete 后才就绪、SDK 超时、底图超时、原始错误不暴露、卸载后迟到结果忽略、构造失败，以及地图代理同端口回环别名与跨端口／协议／站点拒绝。
- 边界：新增地图成功／失败路径是离线 SDK 模拟，不是实际底图证据；E2E 仍验证 fixture UI 和无配置状态。本轮没有真实供应商请求，尚不能断言用户的具体地图加载失败已经消失。
- 待输入：配色方向、自定义地点是否需要地图点选、推荐采用真实 AI 还是规则筛选，以及安全码控制台重置状态。未收到选择，不擅自增加模型供应商或将规则伪装成 AI。

## 检查 13：Figma Light 还原与真实 AI 后端准备

- 用户确认：先按 Figma 稿，自定义搜索＋地图点选，真实 AI、OpenAI 兼容格式、默认 DeepSeek。只检查变量是否存在：模型 Key 在进程环境 `DEEPSEEK_API_KEY`，三个高德变量在 `.env.local`，未输出值；安全码是否重置仍待确认。
- 视觉：固定已批准的 Figma Light tokens，移除自动应用未批准 Dark 候选值；还原 36px 品牌图标块、22px 品牌字、32px 页面标题、36px 顶部留白与 24px 分栏间距，保留有效操作，不加入未实现的导航／保存按钮。E2E 在深色系统偏好下验证仍是 Figma Light。
- 后端：新增 `POST /api/recommendations`，最多 3 次兴趣 POI 搜索及 1 次模型请求，从真实候选中选择，拒绝模型编造／重复 ID；30 秒模型超时、1200 输出 token、无自动重试，进程级 3 次／分钟与单并发。默认模型 `deepseek-flash`、官方主机，允许服务端 OpenAI 兼容配置。
- 数据：地点选择可携带搜索关键词与明确 POI ID，服务端重新搜索核对 ID，不替换成首个结果；支持显式用户点位，保持 user 来源、未知地址／营业／费用。仅公开候选发送模型，不发自定义点位或完整商家数据。
- 凭据：增加空白模型环境模板；扫描进程中的模型 Key；模型地址／名称不是密钥。离线测试子进程同时清空地图与模型所有支持的凭据。
- 文档核对：[DeepSeek 首次调用](https://api-docs.deepseek.com/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。文档当前为 deepseek-flash，禁用默认 thinking，使用 OpenAI Chat Completions JSON 模式；文档确认不等于账号实测。
- 执行：`npm run check`、`npm run build`、`npm run e2e` 全通过；8 个文件的 56 个单元测试、10 项离线 E2E 通过。
- 边界：本轮没有真实模型或地图请求；推荐与地图点选的前端交互还未接好，不能把后端准备写成完整功能完成。下一步接 UI，并用明确 fixture 验证搜索／推荐／用户点位，再进行有界真实联调。

## 检查 14：搜索／推荐／地图点选 UI 首轮，焦点回归未过

- 已接：搜索真实候选的明确添加／移除与防重复、搜索与 AI 混合清单、兴趣选择、模型请求／错误／重试、地图选点原生弹窗与用户来源、换城市确认及失效候选隐藏。模型请求不含当前自定义清单，推荐不会自动覆盖清单。
- 执行：凭据／格式／类型检查、59 个单元测试、生产构建通过；lint 有 1 条未使用 fixture import warning。20 项离线 E2E 中 18 通过、2 失败。
- 失败证据：桌面与窄屏 `place-picker.spec.ts:133`，Esc 后 dialog 已隐藏，但 `地图选点`按钮为 inactive，`toBeFocused()` 失败；无 pageerror／hydration warning。trace／截图在忽略的 `test-results`。
- 原因路径：原生 dialog 在 React 条件卸载的 effect cleanup 中关闭，发生在节点移除后，未恢复触发按钮焦点。下一步在关闭／Esc／确认事件中先关闭原生 dialog，再卸载；保留焦点断言，不修改测试绕过失败。
- 本轮无真实模型或 JS 底图请求；不能宣称点选与推荐实测已完成。

## 检查 15：关闭顺序修复与混合地点清单离线验收

- 修复：关闭／Esc／确认事件先调用原生 dialog.close，再让父组件卸载；保留原焦点断言，桌面与窄屏均恢复到地图选点按钮。地图卸载先解绑 click，再销毁；已加载与底图 complete 沿用有界初始化策略。删除未使用 import，无 lint warning。
- 执行：`npm run check`、`npm run build`、`npm run e2e` 全通过。9 个文件 59 个单元测试；20 项离线 E2E（18 项 fixture UI＋2 项实际无配置 HTTP 路径）通过，无捕获到的 pageerror／hydration warning。
- 新验收：明确选择 POI ID／用户顺序、防重复、移除再添加、兴趣推荐与搜索混合、推荐不自动覆盖／插入、AI 错误无假回退、显式重试、换城市接受／取消、失效候选隐藏、点选未配置状态、禁用伪造坐标、Esc／返回焦点、整数分预算。实际 HTTP 同时验证计划与模型未配置，不消耗供应商。
- 截图：逐张查看桌面 AI 候选与窄屏地图弹窗，并确认布局／Figma Light。fixture 候选与已选项显式标注；所有测试同时清空真实模型与高德凭据。
- 边界：真实 SDK click 添加点位尚未浏览器验证，底图仍待安全码重置确认；AI HTTP 适配与浏览器仅 mock，待一次有界真实推荐联调。完整排程、餐饮与费用仍不在本轮范围。

## 检查 16：用户授权的真实 AI 成功，地图空画布阻塞

- 用户明确允许一次有界真实 AI 请求，并确认高德安全码已在控制台重置、更新 `.env.local`，允许少量底图与点选验证；未索要／输出密钥。
- 新增显式 `npm run smoke:recommendation`，只通过真实浏览器点击调用应用 API：博物馆单一兴趣，最多 1 次高德搜索＋1 次模型；模型不自动重试，单日 attempt marker 防重复。脚本不属于离线 check／E2E，保存后独立回读。
- `npm run check` 通过（59 单元测试），此前构建和 20 项离线 E2E 未改应用代码，未重复运行。
- AI：应用 HTTP 200，约 1656 ms，`deepseek-flash` 返回 4 个真实高德候选，GCJ-02、POI ID 校验有效；浏览器手动加入两个，未自动覆盖清单。查看真实 AI 截图，不是 fixture。此次模型推荐达到代表性 A，不等于 P。
- 地图：SDK 4 个响应、代理 2 个 HTTP 200、其他地图供应商 13 个响应，无网络 failed 或 pageerror；UI 已收到 complete、同源 serviceHost 配置正确且未传 securityJsCode。然而局部 PNG 是纯空画布（710×360），点击后五秒内未出现 GCJ-02 点位，整轮 smoke 失败。不能把 HTTP 200／complete 写成真实底图成功。
- 证据：`docs/evidence/recommendation-map-smoke-2026-10-13.json`，首次脚本的 map 状态未及时更新，回读后按截图／执行位置补记实际失败；未改整体 failed。真实截图只保留忽略目录；HTML、AI 响应与已检查 SDK／代理文本未发现私密值。
- 停止当前真实路径，不重新调用模型或地图。可能原因是 SDK 改写容器定位后，原 `.map-canvas` 仅 inset、未指定宽高，导致画布坍缩；这是待验证推测。先明确 CSS 尺寸并离线模拟供应商定位覆写，新的地图请求需用户许可。

## 检查 17：空画布尺寸风险的离线复现（预期失败）

- 新增 `map-size.spec.ts`：在无真实 Key 的点选弹窗中，仅模拟 SDK 将容器 position 改成 relative，不加载 SDK、不触发供应商。
- 执行 `npm run e2e -- --grep "map container retains"`，桌面／窄屏 2 项均失败：容器宽度正常、height 实测为 0，原尺寸断言要求大于 100。记录失败，不改断言；下一步给共享 `.map-canvas` 明确 100% 宽高。
- 这证明定位覆写能复现坍缩风险，不等于已经捕获真实 SDK 的 DOM 样本；真实空画布的最终根因仍需单独授权地图复验。

## 检查 18：明确地图容器尺寸；一项导航资源等待超时

- 共享 `.map-canvas` 新增 `width: 100%`／`height: 100%`，同时用于工作台与点选，防止 SDK 定位覆写造成零高度。
- check、59 单测与构建通过；22 项 E2E 中 21 通过，新增尺寸回归两端均通过。唯一失败是原窄屏弹窗用例在 `page.goto` 等 load 时 30 秒超时，尚未进入地图或表单操作；不把这一轮记为全部通过。
- 独立读 trace：HTML 与 22 项本地脚本／CSS 响应 HTTP 200，但多项本地 Noto Sans 字体及 HMR 资源处于未完成（status=-1／time=-1）状态；没有真实供应商调用。尚不能确定资源等待的根因，与零高度回归不同。
- 下一步仅原样复跑一次离线 E2E，不增加超时、不删断言、不重新调用 AI／地图；若仍失败，停止报告资源加载阻塞。

## 检查 19：原样离线复跑通过，真实地图仍待复验

- 应用与测试代码没有继续改变，不增加等待时间或 retry；`npm run e2e` 原样复跑，22 项全部通过。尺寸覆写回归两端通过，原超时用例也通过；未再次观察到资源等待超时，不代表已修复／确定字体加载的根因。
- 当前静态检查、59 单测、生产构建与最新 22 项 E2E 均通过，真实模型已有单次成功证据；真实地图仍不能验收。需用户允许一次仅地图复验（1 次地点搜索＋1 次 JS 地图初始化，不再调用模型），读取实际容器尺寸、检查底图截图与用户点位添加。

## 检查 20：单独授权地图复验成功

- 用户允许一次仅地图复验。`npm run smoke:map` 使用独立当天 attempt，实际执行 1 次地点搜索与 1 次 JS 地图初始化；主动拦截模型 API，模型请求为 0，未重跑检查 16 的 AI 请求、未自动重试。
- `npm run check` 通过，59 单测；应用代码仅检查 18 的 CSS 两个尺寸已改，最新构建与 22 E2E 均通过，本轮只增加验证脚本模式，未重复浏览器离线用例。
- 真实地图：complete 触发，实际 SDK 容器带 amap-container、computed position 为 relative、尺寸 710×360、内部 1 个 canvas；两条代理 HTTP 200，底图 PNG 可见西湖／街道／地名及原生高德署名。已独立查看底图与点选弹窗截图，不以 complete 单独作为成功证据。
- 点击真实底图产生 GCJ-02 坐标与原生 marker；输入公开测试名称后确认，已选清单变成 1，显示用户地图选点、未核实。无 pageerror／hydration error、failed 网络请求；私密值未见于检查过的 HTML／SDK／代理文本，securityJsCode 不在浏览器配置。
- 额外独立检查生产的 14 个客户端 JS 文件及当前 HTTP 200 HTML，对四类已配置私密值做精确比较，无命中；未将私密值传入浏览器 evaluate 或打印。
- 证据：`docs/evidence/amap-js-smoke-2026-10-13.json` 写后回读通过，截图在忽略目录 `test-results/live-basemap.png`／`live-point-picker.png`；不提交完整商家数据。前轮空白证据保留，未改历史。
- 结论：明确宽高消除了本例中 SDK relative 定位的容器坍缩，桌面真实底图／点选添加代表性验收通过。真实窄屏 SDK、工作台 marker／polyline 联动尚未另行实测；不等于所有城市／设备覆盖或 P，上线权益、完整费用、餐饮、天气与持久化仍待实现／确认。

## 检查 21：面向旅行的文案与实时摘要

- 按用户要求，移除表单侧栏“本轮已经能做”、工作台待开发功能、天气未接入占位及地图环境配置教程。改为目的地／日期／人数／预算目标的实时摘要与每日地点预览；分组复用 `groupPlaces`，不产生新的地点、模型或路线调用，也不预测未知的行程时间。
- 保留 fixture 醒目标识、用户点未核实、预约／门票未知、午晚餐待安排、预算非报价与刷新丢失提醒。地图未配置仍不加载 SDK、不造底图，错误显示用户可以采取的操作；未配置与加载失败在内部和界面分支仍独立。
- 修复 AI 模式提交空清单时焦点找不到搜索输入的问题：聚焦带错误说明的已选清单区域；修改清单后清理过时的清单错误。原有地图 dialog 的 Esc／焦点断言保留。
- `npm run format`、`npm run check`（59 单测）、`NEXT_TELEMETRY_DISABLED=1 npm run build` 和 `npm run e2e` 全部通过；26 项 E2E、单 worker、0 retry。新增两端摘要输入联动／2-3 天分组／移除地点／空预算人数，以及无开发进度文案／AI 模式清单校验焦点的回归。
- 独立查看桌面初始表单、桌面／窄屏已选摘要及桌面工作台 PNG：沿用 Figma Light，摘要和错误文本正常、无横向溢出。新增摘要用例捕获 pageerror／hydration error，结果为空；既有相应检查未删除。
- 3100 离线服务清空全部地图／模型凭据，地点与推荐均用标注 fixture；没有运行真实 smoke、没有新的供应商实测或核验等级升级。真实窄屏地图与工作台路线专项验证仍待单独授权。

## 检查 22：未保存草稿的编辑、锁定、局部路线与撤销

- 新增纯领域编辑器与页面内会话版本：顺序／跨天／单点停留预览，确认重新计算，不信任被修改的预览对象；过期版本和不同新计划会话拒绝覆盖。位置锁固定当天与顺序，时间锁固定日期与开始时间；早到等待，晚到／未知交通不能保证锁定时拒绝确认。不自动均衡用户调整后的天数分组。
- 增量路线按有向相邻地点识别，只查新增路段。预览不调用供应商，用户显式查询后才请求现有服务端 `/api/routes`；查询失败不改当前行程，部分成功的结果在当前弹窗内保留，显式重试只补剩余路段。不绘制虚构连线，不编造预算节省。
- 桌面原生拖动与两端键盘按钮都进入预览，Esc／确认先原生关闭再卸载；关闭中止浏览器请求，迟到结果不覆盖。不能由此保证已开始的服务端供应商请求停止或免计费。单步撤销恢复上次页面快照并递增版本，不是完整数据库历史。
- 首次 format、check（81 单测）、build 与 38 E2E 全通过，但独立 PNG 检查发现桌面预览宽度被后声明的通用 dialog 样式覆盖成 420px；已有绿色断言未覆盖此布局缺口。
- 改为 `.details-dialog.edit-dialog` 精确覆盖，新增桌面宽度 >600px、窄屏 ≤390px 的断言；未删除原断言或增加 retry。再次完整运行 format、check（10 文件／81 单测）、build、38 E2E 均通过，1 worker／0 retry。
- 回读源码与两端 PNG：桌面实际 720px、前后对比清晰；窄屏单列、内容滚动，确认按钮可访问；新增 12 项两端编辑 E2E 与 21 个领域用例、1 个客户端取消用例。pageerror／hydration 检查为空。全部供应商请求为标注 fixture 或无配置 HTTP，未运行真实 smoke。
- 完成范围仅为页面内未保存草稿的编辑。服务端所有权／复验／事务、持久化／分享、餐饮、公交、天气、完整预算与跨城仍未完成；已建立 `docs/goal-checklist.md`，活跃目标不标记 complete。

## 检查 23：分类费用估算 WIP，原生构建 worker 失败

- 实现五类手动全程估算（跨城、市内交通、住宿、餐饮、门票）、每人／全体口径、未知与明确零、整数分汇总、可排除跨城、费用预览／确认／撤销、超额提醒与确认前知情勾选。手动来源／记录时间在数据中保留，不冒充实时价格，不让未知费用显示预算达标。
- `npm run format` 与 `npm run check` 通过：11 文件、97 单测（新增 16 个预算领域／版本与 schema 用例）；已有编辑断言保留。构建编译与 TypeScript 通过，但静态页面生成（2/6）时原生 Next worker 退出：`code: 3221226505, signal: null`，命令最终非零。不是成功构建。
- 命令链在 build 停止，新增 6 项预算 E2E 尚未执行，不能引用上轮 38 项通过推定预算界面可用；当前 UI 与本轮完整检查未验收。
- 只读环境复核：Node v24.15.0、win32/x64、availableParallelism=20、总内存 16069 MiB、当时空闲 1228 MiB，多个 node 进程仍在运行。低空闲内存是线索，不是已证明崩溃根因；未输出进程环境／凭据，未关闭用户进程。
- 先提交本次失败，再原样重跑一次 build；不改测试 retry／断言、不跳过静态页生成、不运行真实供应商。若同类失败重现，停止当前路径，按官方支持的有界构建资源配置或用户环境决定处理，不反复盲跑。

## 检查 24：原样复跑出现明确内存分配失败

- 代码与配置未修改，原样执行 `NEXT_TELEMETRY_DISABLED=1 npm run build && npm run e2e`。编译与 TypeScript 通过，在 9 workers 收集页面数据时失败：`FATAL ERROR: Zone Allocation failed - process out of memory`，随后 `uncaughtException Error: spawn UNKNOWN`／errno=-4094。E2E 再次未执行，没有把本轮写成通过。
- Windows 只读内存复核显示 FreePhysicalMemory=1662372 KiB、FreeVirtualMemory=1261424 KiB、TotalVirtualMemorySize=53425808 KiB；属于明显资源压力线索。此次 V8 明确报告内存分配失败，但不据此断定检查 23 的全部崩溃根因。
- 已停止无修改重跑。当前 Next 16.4.0 自带类型 `ExperimentalConfig.cpus`、配置默认值及 `build/index.js:getNumberOfWorkers` 均支持限制构建 worker，非凭旧版记忆设置。下一条有依据的替代路径仅限制为 2 workers，保留所有生成步骤与测试；若仍失败，停止并请求释放系统内存，不再盲试或关闭用户进程。

## 检查 25：有界构建恢复，但费用预览窄屏滚动待修

- 只调整 `next.config.ts:experimental.cpus=2`。读取当前 Next 内存指南／类型与源码后实施，回读配置，并从实际日志独立确认页面收集及静态生成使用 2 workers（6/6 完成）。未更换构建器、未跳过类型／页面、未关闭用户进程、未扩大 retry／timeout。
- format／check 通过，11 文件 97 单测通过，生产 build 完成；3100 空凭据隔离 E2E 44/44 通过，1 worker、0 retry，捕获 pageerror／hydration。预算新增 6 用例验证五类口径、预览保持原值、确认／单步撤销、显式未知与零、1.10 精度、超额知情／取消跨城、关闭焦点恢复；未调用真实供应商。
- 独立读取桌面／窄屏费用 PNG。桌面两列可读，窄屏单列无横向溢出；但窄屏由长录入表单切到预览时保留旧 dialog.scrollTop，标题和前几项被卷走。测试绿不代表此视觉项已通过，预算 UI 仍待修复滚动／焦点并补断言。
- Windows 两次失败记录与 WIP 提交保留；限制 worker 在本次环境有效，不宣称证明所有历史异常根因或解决普遍内存问题。

## 检查 26：费用预览滚动／焦点修复通过

- 费用录入／预览切换后重置原生 dialog.scrollTop，并聚焦可程序化聚焦的标题，不新增 Tab 停靠点；返回填写保留已输值，Esc／确认恢复触发按钮焦点。
- 预算 E2E 新增双端标题在 viewport 内／获得焦点、scrollTop=0、返回再预览与住宿输入保留断言；截图改为实际 viewport，避免 fullPage 放大页面影响 fixed dialog 的位置观察。
- format／check 通过，11 文件 97 单测通过；生产 build 2 workers、静态生成 6/6 完成；隔离 E2E 44/44 通过，1 worker、0 retry，未修改 timeout／降低断言，新增流程无 pageerror／hydration。
- 写后回读及桌面／窄屏 PNG 独立复核：桌面 720px 两列、窄屏 354px 单列，标题／关闭按钮及当前费用从顶部可见；长对比仍需纵向滚动，但无横向溢出，确认按钮可访问。本轮未运行真实／计费接口。
- 五类手动费用估算的页面内预览、确认、知情超额、撤销闭环通过；仍不是实时报价、自动联动费用或持久化，全部目标仍未完成。

## 检查 27：获授权的数据库依赖，功能回归通过／开发依赖审计未清零

- 用户明确选择授权安装数据库依赖并提供本地 PostgreSQL；天气继续离线适配与界面，不授权新增真实天气／模型／地图测试。后续不再重复询问该选型。
- 读取 npm registry 与 Drizzle 官方入门／约束／事务资料后，以 `--ignore-scripts --save-exact` 安装 drizzle-orm 0.45.4、pg 8.23.1、drizzle-kit 0.31.11、@types/pg 8.23.1；package.json、锁文件及 npm ls 独立核对版本／integrity。未启动 Studio、数据库或远程服务，未运行生命周期脚本／迁移，没有覆盖 .env.local。
- .env.example 只增 DATABASE_URL 空占位；process.env 凭据扫描加入数据库、高德私密变量及后续天气私密变量，已有 .env.local 全私密扫描保留；写后回读，无值输出。
- `npm audit` 报 9 项（5 high、4 moderate），不是审计通过。5 high 来自既有 eslint-config-next／Next ESLint plugin→fast-glob→micromatch→braces（HEAD 锁文件已含对应版本）；新增 4 moderate 来自 drizzle-kit→已弃用 esbuild-kit loader/core-utils→嵌套 esbuild 的开发 HTTP server 跨站读取公告 GHSA-67mh-4wv8-2f99。`npm audit --omit=dev` 实际为 0；这不等于开发依赖风险已解除。
- 未采用 audit 建议的 `--force` 旧版降级（Next config 14.2.35／drizzle-kit 0.18.1），也未擅自改 beta 栈或跨版本 override。暂不运行该工具的 HTTP server／Studio，依赖告警仍是后续风险项，不能写成已修复。
- format／check、97 单测、生产 build（2 workers）及隔离 44 E2E 全通过，1 worker、0 retry；供应商 0 新真实调用。此轮仅依赖／凭据保护回归，不证明 PostgreSQL 连接、表结构、事务、保存或分享实现完成。

## 检查 28：数据库结构生成成功，静态测试类型失败

- 新增 schema.ts 五表（匿名会话、计划、版本、提案、独立分享），摘要 token、版本复合键／外键、显式过期与 timestamptz、Asia/Shanghai、对象快照约束。分享快照不得复用完整编辑内容；来源许可必须在应用层写入前检查。仅声明结构，没有实现所有权／事务或插入真实数据。
- 无凭据 drizzle.config.ts 与 `db:generate` 生成 0000 SQL、journal／snapshot；回读 SQL 独立确认 5 CREATE TABLE、4 FK、摘要 unique/check 和版本复合 PK 存在。未连接数据库、未 push／migrate、未创建真实表，CLI 成功不代表持久化完成。
- E2E 服务环境补清空 DATABASE_URL 与后续天气配置，避免未来模块误接用户数据库；仍保留地图／模型空配置和 .next-e2e 隔离。
- format、凭据／格式／lint 通过，typecheck 失败：新增测试直接读 column.withTimezone，当前 Drizzle 声明将该属性擦除为 PgColumn，TS2339 两处。单测、build、E2E 尚未执行，不引用上轮通过推定本轮成功。
- 保存此失败后修正为公开 getSQLType() 与已生成 SQL 的语义断言，不用 any 或删时区检查；后续复测再记录。

## 检查 29：结构定义／迁移幂等复核通过（非数据库集成）

- 替换无法从 PgColumn 类型读取的内部属性断言，改用公开 getSQLType() 精确比较 timestamp with time zone；不删时区检查，不用 any／断言类型绕过契约。
- format／check 通过，12 文件 101 单测（新增 4 个 schema／SQL 静态用例）通过；实际核对摘要列无原 token、非空唯一、强制显式 expiry、时区、复合 PK／FK、恢复版本顺序与生成 SQL 未 DROP。单测名称明确不是 PostgreSQL integration，不能据此声称权限／事务已通过。
- 生产 build（2 workers，6/6）与隔离 44 E2E 全通过，1 worker、0 retry，无新增真实供应商调用。此轮没有 UI 功能变化，不重复做真实 SDK 验收。
- 再执行 db:generate，实际为 No schema changes, nothing to migrate，未改变 SQL／snapshot／journal；不存在数据库连接或 DDL 执行。生成元数据仅描述表，不含用户记录或凭据。
- 下一步是匿名权限、来源许可门禁、事务 repository／应用 API 与隔离数据库测试；完整保存／分享尚无实现，数据库是否准备就绪仅检查配置存在性，不打印连接串。开发依赖 9 项告警仍保留，未声称审计清零。

## 检查 30：安全辅助模块通过单测／构建，E2E 服务原生启动失败

- 新增 256-bit 随机规范 base64url 凭证、guest/share 域分离 SHA-256 摘要与恒时比较、HttpOnly／SameSite／生产 Secure Cookie 参数；不代表已发 Cookie 或实现会话所有权。
- 新增保存许可默认拒绝门禁：供应商未有可信许可则拒绝；地点／路线分别许可；TTL 锚定原查询时间，版本变更不延长；生产 fixture 默认拒绝；显式有界用户数据可通过。测试许可文字明确是 test-only，不升级供应商到 P。
- 独立严格分享 DTO 默认不复制名称、城市自由文本、地址／坐标、ID、预算、锁或选择；仅显式白名单的公共名称可出现，用户点始终隐藏；保留 fixture、未知／冲突状态及非报价说明。尚未建分享链接／页面。
- format／check 通过，13 文件 118 单测（新增 17 个安全辅助用例）通过，生产 build 完成（2 workers，6/6）。E2E 服务启动失败：Process from config.webServer was not able to start, Exit code: 3221226505。浏览器用例执行 0 项，不是 44 项通过。
- 随后只读复核显示空闲物理 6808580 KiB、虚拟 21863408 KiB，Node v24.15.0；此时资源比此前充足，不据此判断失败当时状态或将原生退出一概归于内存。未关闭用户进程、未连接数据库／供应商。
- 先提交该失败，再在不改代码／timeout／retry 的前提下，带 pw:webserver 启动日志复验一次；如重现再依据日志选择一条有界替代路径，不能盲跑。

## 检查 31：原样 E2E 服务复验通过，历史原生退出未定位

- 不修改代码、retry 或 timeout，执行 `DEBUG=pw:webserver npm run e2e`；新服务启动 Ready in 524ms，实际 GET / 200 后完整 44/44 通过，1 worker、0 retry。结束时由 Playwright 正常终止隔离服务。
- 初次 availability 检查 HTTP 502 后启动新服务，随后 200；没有用 reuseExistingServer 替代启动验证。无新增真实模型／地图／天气／数据库调用。
- 当前安全辅助模块 118 单测／生产 build 已于检查 30 通过，此次独立补回浏览器回归；保留 30 的启动失败，不宣称原生退出根因已定位或以后不会复现。
- 辅助模块不等于匿名所有权／服务端事务／分享链接。数据库配置仍未提供、来源许可仍未确认；先保持该实测路径阻塞，继续已获授权的离线天气模块。
