# 持续开发目标与验收台账

活跃目标：按照项目规划持续开发、测试、修复、再开发，直到所有目标有实际证据。依据 README 第 1、4、7、8 节及 `.pi/AGENTS.md`，不是以全部测试变绿作为全部功能完成。

## 成功标准与边界

- 核心交付：真实地点与交通、天气范围判断、景点与正式午晚餐排程、可访问的编辑／锁定、AI 提案、差异预览／确认／撤销、完整预算、手动跨城班次、权限保护的保存及可撤销只读分享。
- 验证：每项检查实际源码／接口／UI、相应离线断言及必要的脱敏真实证据；主线按 README 的生成两日游、锁定、天气风险、室内／餐饮预览、确认、撤销、分享逐步验收。
- 保留：Figma Light、代码规整、网页不写开发进度、未知不编造、强约束不删、凭据不泄漏。只在仓库内工作，不推送、部署、购买或注册账号，不自行委派。
- 每轮选择最早的可实施缺项，开发后运行 format、check、build、离线 E2E，写回实际结果并本地提交；失败先记录再修复，不删断言或增加 retry。
- 若关键配置、预算、许可或技术决策阻塞下一项，停止该路径并说明证据、尝试、阻塞及所需输入。不得删除真实 smoke 的 attempt 绕过调用保护。

## 要求到产物／证据的映射

| 规划要求 | 当前产物或证据 | 验收缺口／状态 |
| --- | --- | --- |
| 阶段 0：城市、人工资料、凭据与许可 | 可修改城市；docs/api-verification.md；docs/evidence/amap-smoke-2026-10-12.json | 正式城市／人工资料、天气账号、预算及所有 P 权益未确认 |
| 阶段 1：表单→地点→交通→天气→日程 | src/features/trip-form；src/server/services/create-draft.ts；src/domain/draft.ts；app-smoke-2026-10-13.json | 草稿含景点与步行；天气已有离线适配／辅助面板与一致性回归（检查 32—34），仍待账号／许可与排程替代；午晚餐手动选择／完整活动工作台已接（检查 50—51）；餐厅营业／预约人工编辑已接（检查 53），自动餐次生成及景点规则录入仍缺；手工跨城返程边界仅离线通过 |
| 正式午晚餐、营业／预约窗口与饮食限制 | domain/meal-planning.ts、meals.ts、meal-reservations.ts；meal 契约；editing.ts／store；meal 单测 | 检查 55 通过：247 单测／104 E2E／build；已接餐厅选择、完整实例投影、局部路线／换店／重排、预览／确认／撤销与全程午晚餐费显式预填。餐厅人工营业／预约、独立来源、闭店／完整停留／半开预约窗、详情及后续编辑冲突已验（六项新增单测、三项×双端 E2E）。检查 54 的三项原始 setup 清预约／移除餐次／篡改报告红色回归已修复；本地提案携带按实际前后预约绑定的核对信息，预览／合并／确认重算（共十二项新增领域回归），核对字段变动重置勾选。服务端所有权／事务／提案消费、景点规则、自动餐次／顺路候选及真实 SDK／餐厅专项仍缺，属部分完成 |
| 天气日级范围、来源、未知与风险 | domain/weather.ts；providers/qweather.ts；services/get-weather.ts；api/weather；weather-panel.tsx；weather 单测／E2E | 147 单测／60 E2E／build 通过；仅离线／无配置 HTTP，日期／粒度／昼夜跨午夜／地点错配已补拒绝回归；真实天气、许可与室内替代尚未验收 |
| 真实地图与详情联动 | src/features/map；amap-js-smoke-2026-10-13.json；tests/unit/map-lifecycle.test.ts | 桌面点选 A；真实窄屏与工作台线路专项实测缺失 |
| 阶段 2：拖拽／按钮、地点与时间锁、局部刷新 | src/domain/editing.ts；features/planner/edit-dialog.tsx、editor-store.ts；tests/unit/editing.test.ts；tests/e2e/editing.spec.ts | 未保存草稿顺序／跨天／停留编辑、桌面拖动／按钮、位置／时间锁及局部路段请求离线通过；餐饮手动替换／混合邻段编辑双端离线通过（检查 51）；交通替换和真实编辑联调未验 |
| 修改预览、确认、baseVersion、撤销新版本 | editing.ts；editor-store.ts；编辑 E2E（确认前不改、取消、重试、单步撤销）；单测（过期／跨会话拒绝） | 本地会话版本＋确认重算＋单步撤销已实现，餐次快照也纳入（检查 45）；不能替代持久化服务端所有权／复验／事务与完整版本历史 |
| 完整预算（跨城、市内、住宿、餐饮、门票） | src/domain/budget.ts；budget-panel.tsx；budgetEstimateSchema；tests/unit/budget.test.ts；tests/e2e/budget.spec.ts | 五类手动估算、口径、未知／零、超额知情、预览／确认／撤销通过；两程票价显式预填、替换不重复累加、范围不变及未知／0／限额回归通过（175 单测／78 E2E／build，检查 40）；全程午晚餐费已接显式预填，仅在各天两餐与价格齐全时启用；替换不加总、保留其他费用／范围、未知／0／合计上限与不自动同步已验（检查 52，229 单测／98 E2E／build）。非动态绑定或实时报价；早餐／零食饮品需人工补齐，市内交通等数据关联仍缺 |
| 跨城手动录入、Asia/Shanghai、跨午夜及接驳 | domain/intercity.ts；intercity-contracts.ts；planner/intercity-form.ts、intercity-panel.tsx；editing.ts；intercity 单测／E2E | 175 单测／78 E2E／build；人工录入、前后预览、确认／移除／本地撤销、编辑复验强约束与端点失效及票价显式预填离线通过（检查 38、40）；尚无站点搜索／地图定位／真实接驳。列车／航班查询可选，人工输入是核心 |
| 阶段 3：AI 解析／修改提案，不覆盖已选 | src/server/ai；recommend-places.ts；tests/unit/ai.test.ts；recommendation-map-smoke-2026-10-13.json | 仅推荐 A；需求解析、受约束修改提案及冲突覆盖回归缺失 |
| 阶段 4：PostgreSQL／Drizzle、匿名权限、版本事务 | src/server/db/schema.ts；drizzle SQL／metadata；db-schema.test.ts | 已获准依赖及本地数据库；五表、复合键、摘要与时区／expiry 的静态检查及迁移生成幂等通过（检查 29），101 单测／44 E2E；仍无连接、所有权／事务／应用保存，数据许可未确认 |
| 脱敏只读分享、撤销、越权／并发 | security/tokens.ts、storage-policy.ts、share-snapshot.ts；security.test.ts | 118 单测／44 E2E／build 通过；仅凭证／Cookie 参数、许可 TTL 与脱敏 DTO 辅助规则；尚无会话所有权、发令牌、公开链接、撤销／越权／并发应用测试 |
| 阶段 5：美团／铁路／航班可选接口 | docs/api-verification.md D 记录 | 权限与账号实测后才启用；不能用 fixture 或第三方示例验收 |
| UI 来源／未知／错误／重试／焦点与浅色 | src/features；tests/e2e；docs/testing.md 检查 26 | 最新 104 E2E 覆盖基础流程、本地编辑、手动费用、人工跨城／票价预填、离线天气、手动餐次／换店／混合邻段、全程午晚餐费预填、餐厅营业／预约事实／冲突与撤销；不覆盖真实天气／天气室内替代／持久化分享完整主线 |
| 规划器边界：开放、时间窗、锁、跨午夜、返程、不可行 | tests/unit/draft.test.ts 等 | 覆盖顺序分天、未知步行、18:00、编辑锁与跨午夜／手工跨城返程边界及未知不遮蔽已知冲突；开放／预约／午晚餐窗口有领域断言，手动餐次已接活动工作台与混合邻段／锁回归（检查 51），餐厅规则已接表单／预览／实例详情及后续景点编辑冲突（检查 53），预约解除已接领域当前快照复算与前后绑定核对（检查 55），服务端复验／权限事务、景点规则录入与自动生成仍缺；公交时间窗仍缺，不能推定完整排程与交互校验 |
| 供应商业务码／鉴权／限流／超时 | tests/unit/amap.test.ts、ai.test.ts；server/providers | 更多能力及必要真实错误样本未验证 |
| 比较评估：纯模型／距离排序／完整方案 | 尚无评估报告 | 时间冲突、交通耗时、修改次数的真实对照缺失 |
| format、check、build、e2e；每轮记录和本地提交 | package.json；docs/testing.md；本地 Git | 每轮复验，不凭历史通过声称本轮通过 |

## 当前完成判断

**未完成。**上述缺项均阻止将活跃目标标记 complete。实现一个子项后只更新对应行；最终须逐项检查实际产物与覆盖范围，再运行完整主线并审计许可、配置与阻塞，不能以台账齐全代替产物完成。
