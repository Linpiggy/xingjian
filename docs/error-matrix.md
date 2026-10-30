# 失败分类与映射

记录服务端如何把失败变成状态码与文案。唯一映射处是 `src/server/http.ts` 的 `api()`；`/api/itineraries` 是流式例外，见文末。新增错误必须先归类到下表，再写文案。

## 映射规则（`api()` 现状）

| code 形态 | HTTP |
| --- | --- |
| Zod 校验失败 → `invalid_input` | 400 |
| 同源校验、非 JSON、请求体 > 16 KiB → `invalid_request` | 400 |
| `status === "not_configured"` | 503 |
| `rate_limited`／`ai_rate_limited`／`ai_local_rate_limited`／`ai_cooldown` | 429，带 `Retry-After` |
| `generation_busy`／`ai_busy` | 409 |
| `no_place`／`duplicate_place` | 422 |
| 其余 `ProviderError` | 502 |
| 非预期异常 → `unavailable` | 503 |

响应体只含 `code`、`message`、`providerStatus` 与可选的 `retryAfterSeconds`；不返回供应商 URL、原始响应或堆栈。

## 七类失败

| 类别 | 触发 | 现有 code | HTTP | 已计费 | 可重试 | 文案要求 |
| --- | --- | --- | --- | --- | --- | --- |
| 未配置 | 缺 AI／高德／天气 Key，或配置非法 | `ai_not_configured`、`maps_not_configured`、`not_configured`、`weather_not_configured`、`weather_invalid_config` | 503 | 否 | 否，需配置 | 说明服务未配置，且未生成替代方案 |
| 无结果 | 必去地点／餐厅无一唯一匹配、候选不足、两地无步行路线、天气坐标与城市不符 | `no_place`、`duplicate_place`、`no_route`、`weather_location_mismatch` | 422（`no_route`、`weather_location_mismatch` 实为 502） | 地图查询已消耗 | 是，换名称或换城市 | 指出是输入不明确还是候选不足，不补造地点 |
| 超范围 | 天气日期超预报范围、天气位置不支持、整体处理超时 | `weather_unsupported_location`、`generation_timeout`（仅流内） | 502 | 视阶段 | 是 | 说明超出可查范围，不给猜测值 |
| 上游失败 | 供应商 HTTP 非 2xx、响应超大或格式异常、网络异常、权限错误 | `upstream_http`、`weather_upstream_http`、`unavailable`、`permission_denied`、高德业务码（如 `10009`） | 502 | 请求已发出，可能已计费 | 是 | 只说“服务暂时不可用”，不透出供应商细节 |
| 限流与并发 | 本地服务端 Web 服务额度 60 次／分且并发 ≤3、浏览器地图代理额度 120 次／分且并发 ≤8（两套独立窗口）、本地 3 次／分模型保护、冷却期、上游 429、同一时刻已有规划 | `rate_limited`、`ai_local_rate_limited`、`ai_cooldown`、`ai_rate_limited`、`generation_busy`、`ai_busy`、`weather_rate_limited` | 429／409（`weather_rate_limited` 实为 502） | 本地拦截不计费；上游 429 不计费 | 是，按 `Retry-After` | 给出明确等待秒数，声明未发起新请求 |
| 超时 | 高德与和风单请求 8s、通用模型调用 30s、规划模型 45s、`/api/itineraries` 整体 240s | `ai_timeout`（模型）、`unavailable`（地图／天气超时） | 502 | 请求已发出，可能已计费 | 是 | 说明超时层与未应用方案，不承诺剩余时间 |
| 模型输出异常 | JSON 语法／转义／控制字符、输出截断、字段或候选 ID 非法、天数不匹配 | `ai_invalid_json`、`invalid_escape`、`control_character`、`ai_output_truncated`、`ai_invalid_response`、`ai_upstream_invalid_response` | 502 | 是 | 结构化失败按天补写一次；JSON 与截断不重试 | 说明未使用不完整方案，且不打印模型片段 |

## 流式例外：`/api/itineraries`

该路由先建立 NDJSON 流，失败不走 HTTP 状态，改为发送 `{ type: "error", message, code, stage }`：

- `deadline` 触发 → `generation_timeout`，文案“超过处理时限，未应用方案”。
- `ai_*` 类 code → `stage` 记为 `model`，其余沿用当前阶段。
- code 必须匹配 `^[a-z0-9_]{1,60}$`，否则降级为 `unavailable`。
- 请求方主动中止时不发送任何 error 事件。

## 已知不一致（待修，不要照抄现状）

1. `weather_rate_limited` 与 `weather_unsupported_location` 落到 502，语义上应为 429 与 422。
2. `ai_timeout` 落 502，未使用 504；客户端也无法从状态码区分“哪一层超时”。
3. `permission_denied` 落 502，凭据类问题与上游故障无法区分。
4. 高德业务码直接作为对外 `code`（如 `10009`），与项目自有 code 形状混在一起。
5. 未配置类存在三个名称（`ai_not_configured`、`maps_not_configured`、`not_configured`），客户端必须同时识别。
6. 地图与天气的并发保护是单进程内存计数（服务端 Web 服务与浏览器地图代理各自一套），不是分布式限流；多实例部署时需替换。
