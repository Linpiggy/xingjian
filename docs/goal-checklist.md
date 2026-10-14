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
| 阶段 1：表单→地点→交通→天气→日程 | src/features/trip-form；src/server/services/create-draft.ts；src/domain/draft.ts；app-smoke-2026-10-13.json | 草稿只含景点与步行，天气、正式午晚餐、开放／预约／返程校验缺失 |
| 真实地图与详情联动 | src/features/map；amap-js-smoke-2026-10-13.json；tests/unit/map-lifecycle.test.ts | 桌面点选 A；真实窄屏与工作台线路专项实测缺失 |
| 阶段 2：拖拽／按钮、地点与时间锁、局部刷新 | src/domain/editing.ts；features/planner/edit-dialog.tsx、editor-store.ts；tests/unit/editing.test.ts；tests/e2e/editing.spec.ts | 未保存草稿顺序／跨天／停留编辑、桌面拖动／按钮、位置／时间锁及局部路段请求离线通过；餐饮／交通替换和真实编辑联调未验 |
| 修改预览、确认、baseVersion、撤销新版本 | editing.ts；editor-store.ts；编辑 E2E（确认前不改、取消、重试、单步撤销）；单测（过期／跨会话拒绝） | 本地会话版本＋确认重算＋单步撤销已实现；不能替代持久化服务端所有权／复验／事务与完整版本历史 |
| 完整预算（跨城、市内、住宿、餐饮、门票） | src/domain/budget.ts；budget-panel.tsx；budgetEstimateSchema；tests/unit/budget.test.ts；tests/e2e/budget.spec.ts | 五类手动估算、口径、未知／零、超额知情及版本预览／确认／撤销离线通过（97 单测／44 E2E／有界 build，检查 26）；不是实时报价，真实费用数据与自动关联缺失 |
| 跨城手动录入、Asia/Shanghai、跨午夜及接驳 | 尚无实现 | 列车／航班查询是可选能力，人工输入是核心交付 |
| 阶段 3：AI 解析／修改提案，不覆盖已选 | src/server/ai；recommend-places.ts；tests/unit/ai.test.ts；recommendation-map-smoke-2026-10-13.json | 仅推荐 A；需求解析、受约束修改提案及冲突覆盖回归缺失 |
| 阶段 4：PostgreSQL／Drizzle、匿名权限、版本事务 | src/server/db/schema.ts；drizzle SQL／metadata；db-schema.test.ts | 已获准依赖及本地数据库；五表、复合键、摘要与时区／expiry 的静态检查及迁移生成幂等通过（检查 29），101 单测／44 E2E；仍无连接、所有权／事务／应用保存，数据许可未确认 |
| 脱敏只读分享、撤销、越权／并发 | security/tokens.ts、storage-policy.ts、share-snapshot.ts；security.test.ts | 118 单测／44 E2E／build 通过；仅凭证／Cookie 参数、许可 TTL 与脱敏 DTO 辅助规则；尚无会话所有权、发令牌、公开链接、撤销／越权／并发应用测试 |
| 阶段 5：美团／铁路／航班可选接口 | docs/api-verification.md D 记录 | 权限与账号实测后才启用；不能用 fixture 或第三方示例验收 |
| UI 来源／未知／错误／重试／焦点与浅色 | src/features；tests/e2e；docs/testing.md 检查 26 | 最新 44 E2E 覆盖基础流程、本地编辑和手动费用，不覆盖未实现的天气／餐饮／持久化分享主线 |
| 规划器边界：开放、时间窗、锁、跨午夜、返程、不可行 | tests/unit/draft.test.ts 等 | 当前只覆盖顺序分天、未知步行和 18:00 冲突，不能推定完整约束校验 |
| 供应商业务码／鉴权／限流／超时 | tests/unit/amap.test.ts、ai.test.ts；server/providers | 更多能力及必要真实错误样本未验证 |
| 比较评估：纯模型／距离排序／完整方案 | 尚无评估报告 | 时间冲突、交通耗时、修改次数的真实对照缺失 |
| format、check、build、e2e；每轮记录和本地提交 | package.json；docs/testing.md；本地 Git | 每轮复验，不凭历史通过声称本轮通过 |

## 当前完成判断

**未完成。**上述缺项均阻止将活跃目标标记 complete。实现一个子项后只更新对应行；最终须逐项检查实际产物与覆盖范围，再运行完整主线并审计许可、配置与阻塞，不能以台账齐全代替产物完成。
