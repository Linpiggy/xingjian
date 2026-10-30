
# 外部接口核验记录

核验日期：2026-10-12。用户已确认：先按公开文档验证结果创建架构文档与本地仓库，真实账号调用留待凭据配置后进行。

最新方向更新（2026-10-28）：用户已取消美团／大众点评接入，改为评估 MediaCrawler 社交推荐数据；相关旧文档与 D 记录仅保留为历史调查，不再以美团权限作为当前接入前提。最新许可、数据结构及接入边界见第 13 节。

## 1. 验证等级与结论

- **D（文档确认）**：官方／供应商公开页面说明存在该能力及其接入方式。
- **A（账号实测）**：本项目账号发起请求，检查业务状态、实际字段及失败场景。
- **P（上线确认）**：额度、费用、用户范围、公开展示、缓存／保存及来源署名许可已确认。

首次文档核验时项目目录为空且未发现相关 API 环境变量。随后用户配置了本地高德 Web 服务 Key；2026-10-12 已完成 5 次只读真实请求，高德地点、附近餐厅、步行与公交达到 A（代表性冒烟测试），见第 5 节。其余供应商未实测；所有能力均未达到 P。没有注册账号、付费购买或发起订票操作；凭据未写入报告或日志。

**架构结论：高德核心接口账号可用，但不是完整覆盖／上线许可验收。**天气按用户最新要求暂假设可接入，仅用于设计推进，实际等级保持 D。餐饮基础推荐使用地点数据加人工资料；铁路／航班先支持用户录入。美团评论、实时铁路查询、航班动态及机票报价是分别验收的可选能力。文档示例不算实测响应，免费接入不等于生产使用无条件免费。

## 2. 能力矩阵

| 能力                 | 等级                | 已确认                                                | 未确认                                       | 首版处理                             |
| -------------------- | ------------------- | ----------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| 高德 POI 2.0         | A：文本／周边冒烟   | 2 次地点搜索及 1 次附近餐厅搜索成功；商业字段部分缺失 | ID 搜索未测；批量覆盖、费用与存储许可        | 可推进；缺字段显示未知               |
| 高德公交／步行 2.0   | A：路线冒烟         | 真实地点间步行、指定日期时间公交成功，均有耗时        | 更多策略／城市、错误场景、费用与额度         | 可推进；无路线不宣称可行             |
| 和风每日天气         | D：设计阶段假设可用 | 每日预报、位置与时段、认证文档                        | 未发起真实请求；账号版本、覆盖、权限、费用   | 按用户要求不阻塞设计；示例标为未实测 |
| 美团个人 MCP／Skills | D：仅入口           | 个人开发者入口、实名认证与免费接入说明                | 工具列表、餐饮字段、评论全文、面向多用户许可 | 默认关闭，待登录控制台验证           |
| 美团企业版到餐 API   | D                   | 店铺搜索、详情、评论；需分配凭据及企业 ID             | 个人项目能否获批、数据用途与许可             | 不作为个人首版依赖                   |
| 聚合数据铁路查询 817 | D                   | 站到站时刻、席别价格、余票示例、15 天日期限制         | 实际权限、延迟、当前价格、字段覆盖           | 先手动录入；实测后开启查询           |
| 飞常准航班动态       | D：产品说明         | 航班时刻、状态、航站楼等数据服务                      | 个人账号接入、覆盖与费用                     | 先手动录入；不当作机票报价           |
| 商业机票供应商       | D：合作流程         | 存在查询／票务接口及商务对接流程                      | 个人项目能否合作、查询费用与展示许可         | 不依赖，不做交易                     |

## 3. 核验证据与限制

### 高德

来源：

- [搜索 POI 2.0](https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch)
- [路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)
- [创建应用和 Key](https://lbs.amap.com/api/webservice/create-project-and-key)
- [基础服务价格](https://lbs.amap.com/pages/base_service_price)

本次文档抽取确认 POI `show_fields` 可返回营业描述、评分、人均消费和入口信息。`rating` 不是评论全文，`cost` 不是门票。单一搜索条件翻页最多获取 200 条，不能假设可导出全城商家。

路径文档还用独立 HTTP 获取核对：公交策略包括经济、少换乘、少步行、地铁优先和时间短；`city1`／`city2` 使用 citycode；支持 `date`／`time`。方案 `cost.duration` 为秒，包含等车时间；相关字段需要请求 `show_fields=cost`。实际响应结构在适配器实测后固定。

文档存在 `railway` 分段，不代表提供完整铁路余票，更不代表机票查询。公交规划不等于实时车辆到站。历史讨论中的免费配额不写入承诺，以当前控制台和价格条款为准。

### 和风天气

来源：

- [每日天气预报](https://dev.qweather.com/docs/api/weather/weather-daily-forecast/)
- [身份认证](https://dev.qweather.com/docs/configuration/authentication/)
- [API Host](https://dev.qweather.com/docs/configuration/api-host/)

Tavily 文档抽取展示每日接口路径 `/weather/v1/daily/{latitude}/{longitude}`、1—10 天范围及默认 7 天；认证文档介绍 JWT（推荐）及 API Key。**不能继续凭旧印象直接采用 `/v7/weather/3d`。**最终 API 版本、Host、路径和响应格式以账号控制台、可读文档和真实请求共同确认。

独立 Python HTTP 抓取上述每日／Host 页面失败；这只是文档抓取失败，不是已证明天气业务接口不可用。抽取内容有代码重复现象，不复制为实现代码。日级数据不能生成精确小时结论；未来日期超出当前预报范围保持未知。

### 美团／大众点评

来源：

- [美团技术服务合作中心](https://developer.meituan.com/)
- [个人开发者控制台入口](https://developer.meituan.com/zh/v2/dev/token)
- [美团企业版到餐 API](https://h5.dianping.com/app/bep-docs/sky-doc/canyinopenapi/daocan_api.html)

首页抽取显示“个人开发者入驻”“实名认证即开通，免费接入 MCP/Skills”。个人控制台抽取失败，未获得工具列表或权限信息；不推断一定支持任意餐厅搜索、点评全文或网站多用户访问。

企业版文档包含 `/openapi/daocanPoi/list`、`detail`、`reviewList`；调用需平台分配 `token`、`sign`、`aesKey`、`entId`，并联系获取测试／线上账号。两种接入途径不能混为一谈。仅做授权的只读验证，不调用支付、下单接口。

### 铁路

来源：[聚合数据火车订票查询（ID 817）](https://www.juhe.cn/docs/api/id/817)。

公开文档为 `https://apis.juhe.cn/fapigw/train/query`，支持站名／站码、出发站、到达站、日期等参数；`date` 仅允许 15 天内。返回示例有班次、出发／到达时刻、历时、席别价格及 `prices[].num`。

这属于第三方供应商接口，不写成“已接入 12306 官方 API”。余票存在“无”等非数字值，须正确归一化；成功但空数组也要展示无结果。订票能力即使存在也不纳入本项目。跨午夜的到达日期需实测确认推导规则，不能只存 HH:mm。

### 航班／机票

来源：

- [飞常准航班动态服务](https://www.variflight.com/en/products/flight-status-data.html)
- [磐河旅行接入指南](http://open.shpanhe.com/home/accessGuide)

飞常准页面列出 Scheduled／Estimated／Actual Time、航班状态、航站楼等字段，并介绍试用；没有据此确认机票价格能力或个人账号权限。

磐河指南经文档抽取和独立 HTTP 获取确认，需要商务洽谈、协议、开发联调后获得正式环境。仅作为商业供应商接入门槛的例子，不视为已选供应商；交易结算和出票均不纳入首版。

## 4. 完整验收清单（高德部分冒烟已执行，其余待执行）

1. 用户在本地或部署平台配置凭据，不贴入聊天；先确认预算、测试额度、数据展示／保存许可。
2. 仅向已知供应商主机发起只读请求，记录时间、接口版本、参数摘要、HTTP 状态、业务状态、必要字段和延迟；移除 Key、令牌、个人信息。
3. 高德：单个真实 POI、附近餐厅、两点步行、指定日期时间公交；检查入口坐标、营业字段、缺失值、时间费用及路线点串。
4. 天气：确认账号 API Host／版本与认证方式；检查目标地点、日期、单位、时区、粒度、来源署名及超预报范围。
5. 美团：登录控制台查看实际工具及用途限制；如有权限，仅调用已授权的餐厅搜索／详情，再单独核验评论能力。
6. 铁路：售票窗口内的站到站查询；核对席别价格、余票表示、跨午夜到达；确认超范围处理。实时信息记录获取时刻，不能承诺购买成功。
7. 航班：只有获得权限后才查询时刻／状态；票价、舱位、税费和行李规则是另一项验收，不以动态接口替代。
8. 失败测试优先用单元 fixtures 模拟鉴权／限流／超时，避免故意耗费付费配额；用必要的真实错误响应确认业务码映射。
9. 每项通过后在本文补充 A 证据；完成权益与许可记录后才标为 P，并开启对应功能。

验收记录最小字段：`provider、capability、checkedAt、apiVersion、requestSummary、businessStatus、fieldCoverage、latency、limits、usagePermission、storagePolicy、evidencePath`。脱敏样本保存到明确标注的测试目录，不提交完整原始供应商数据。

## 5. 高德账号冒烟实测（2026-10-12）

证据：[请求参数与结果摘要](evidence/amap-smoke-2026-10-12.json)。Key 从已被 Git 忽略的 `.env.local` 读取，仅用于向高德发起请求，不显示、保存或提交其值。报告只记录公开测试地点的输入坐标、业务状态、字段覆盖与路线摘要，不包含完整原始商家数据或图片。

测试城市杭州只是接口样例，不代表正式选定首版城市。

| 请求                         | 实测结果                                                                |
| ---------------------------- | ----------------------------------------------------------------------- |
| 浙江省博物馆孤山馆文本搜索   | 返回 1 个 POI，ID、位置、地址、citycode、business、navi 均存在          |
| 西湖博物馆文本搜索           | 返回 1 个 POI，位置和 citycode 等字段可用于算路                         |
| 附近餐饮（2 km 范围，3 条）  | 3 条有评分；仅 1 条有 cost、opentime_today、opentime_week；tag 均缺失   |
| 两个搜索结果间步行           | 1 条方案，4,494 米、3,595 秒，12 个步骤，返回路线点串                   |
| 同两点公交，2026-10-13 10:00 | 1 条方案，7,110 米、2,862 秒，2 个分段，cost 含 duration 与 transit_fee |

5 次请求均为 HTTP 200、`status=1`、`infocode=10000`；单次耗时约 94-266 ms。以上为这次查询返回值，不是长期性能承诺或所有城市／策略的保证。

设计影响：餐厅人均和营业时间必须允许未知；不把评分伪装为点评全文。步行与公交应同时显示距离／耗时，不假设附近地点一定步行更快。尚未验证鉴权／限流／无结果／错误业务码，也未确认公开展示、缓存许可或商业权益。

Figma 阶段的路线示意、行程时间和天气可使用明确标注的示例；本次高德成功不等于网页 JS 地图 Key 已配置。和风天气仅按用户要求假设可接入，不能标为 A 或“已验证成功”。

## 6. 实际应用 HTTP 联调（2026-10-13）

证据：[实际应用草稿请求摘要](evidence/app-smoke-2026-10-13.json)。本地 `POST /api/plans` 经过真实同源校验、输入校验、应用服务和高德适配器，返回 HTTP 200；3 次文本地点查询、1 次步行算路，得到 3 个真实地点、1 条路线与 GCJ-02 点串。步行 4,494 米、3,595 秒、12 段 geometry，草稿保持 `unverified`，未伪装成已校验完整行程。

摘要只保留公开测试输入、请求结果数量和路线指标，不保存凭据或完整商家原始数据。单样本应用请求约 1,164 ms，不作为性能承诺。此次修复了 Next.js 内部 localhost URL 与浏览器 127.0.0.1 同端口别名的误拦；异域、异端口与异协议仍拒绝。

边界：真实 HTTP 联调不等于 JS SDK／底图实测；浏览器 UI 验收使用明确 fixture，另有 2 个真实 Route Handler 的无凭据 HTTP 回归。JS 安全码等待控制台重置确认。天气、餐饮排程、预约、返程、完整预算、持久化与 AI 均未通过实际应用验收，所有供应商等级仍未达到 P。

## 7. 真实 AI 推荐实现与验证边界

已实现服务端 OpenAI Chat Completions 兼容适配，默认 DeepSeek `deepseek-flash`；核对了当前[官方首次调用](https://api-docs.deepseek.com/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)与 [Thinking](https://api-docs.deepseek.com/guides/thinking_mode) 文档，默认关闭 thinking。文档当前模型名与旧版教程不同，不沿用未经核对的旧别名。

按最多三个兴趣类别查询真实 POI 并去重，模型只从有效候选 ID 选择，拒绝编造／重复地点；没有价格、开放、预约和天气数据，不能据此声明预算达标或行程已优化。只发送公开候选名称／坐标及兴趣目标，不发送自定义点位与完整商家响应。Key 仅留服务端，模型与地点配额均可能收费。

离线适配器、无配置 HTTP 与搜索／推荐混合前端已测试通过。2026-10-13 用户授权一次真实联调，经本地浏览器操作调用应用 API，1 次博物馆地点搜索＋1 次 DeepSeek 请求，HTTP 200、约 1656 ms、4 个有效高德推荐；DeepSeek 达到 A（代表性账号实测），不等于 P。见 [真实推荐与地图测试摘要](evidence/recommendation-map-smoke-2026-10-13.json)。

用户已确认 JS 安全码控制台重置并更新本地。第一次地图实测 SDK／代理成功、complete 已触发，但空画布与点击失败；证据保留。补明确容器宽高后，用户单独授权仅地图复验，1 次地点搜索、1 次 JS 地图初始化、0 次模型调用；真实 SDK 将定位设为 relative，容器仍为 710×360，底图实际可见、署名保留、点击产生 GCJ-02 marker 并以用户来源加入清单，达到代表性 A。见 [JS 底图与点选摘要](evidence/amap-js-smoke-2026-10-13.json)。

桌面样本成功不代表真实窄屏／工作台路线绘制均已验收；所有供应商仍未达到 P，不用网络成功状态代替视觉与交互证据。

## 8. 每日天气契约复核（2026-10-14，D／离线授权）

用户明确选择先做离线适配与界面，不授权真实天气请求。Tavily 提取因 api.tavily.com 代理连接异常失败（首次管道仅显示空 results，复核原始输出确认 error／exit 4）；停止该路径。改为只读直接获取官方公开页面，daily／authentication／api-host／glossary／metadata／error-code 均 HTTP 200；猜测的 configuration/location 页 404，不作为证据。文本临时保存于忽略的 test-results 并回读，没有天气业务调用、账号登录或凭据输出。

- 每日接口确认为 `/weather/v1/daily/{latitude}/{longitude}`，经纬度最多两位小数，1—10 天、默认 7；可用 `localTime=true`。响应是 metadata＋days，不沿用 v7 的 code/daily/温度字符串结构。
- 每天含 forecastStartTime／forecastEndTime（结束不含），可含 daytime（当地 07—19）和 nighttime（19—次日07）、温度 value/unit、precipitation 的 amount/probability/type。昼夜仍是日级分段，不推出某个游览小时一定下雨。
- [术语表](https://dev.qweather.com/docs/resource/glossary/)明确：中国大陆用 GCJ-02，其余地区 WGS-84。当前大陆地图坐标不做逆转换；非大陆不能不加判断地套用此查询路径。API 路径 latitude 在前，与旧 location=经度,纬度不同。
- [元数据](https://dev.qweather.com/docs/resource/metadata/)要求 metadata.attributions 与数据共同显示；tag 用于追溯。daily 页面未列数据更新时间字段，不能把本地查询时间冒充供应商更新时间。
- Host 是账号独立地址，并是身份认证的一部分，不使用将逐步停止的公共 Host，也不把真实 Host 输出给页面／日志。JWT 与 API Key 均支持 API，不同时使用；Key 只放 X-QW-Api-Key Header。JWT 先支持用户本地预生成 token，不为此安装 SDK／生成账号或私钥；API Key 自 2027-01-01 有额外每日限制。
- [错误文档](https://dev.qweather.com/docs/resource/error-code/)使用 HTTP 状态与 error 对象；401／403／429 不自动重试，响应 detail 不直接展示。HTTP 200 的错误对象或坏结构仍拒绝。

以上仅 D。账号 Host／版本／认证、实际响应覆盖、公开展示／存储许可和费用仍待确认，未升级为 A／P，不能用公开 JSON 示例作为真实预报。

## 9. 美团／大众点评图片来源复核（D，未接业务接口）

用户希望最终图文优先使用美团／大众点评等官方接口，而非自行选定开放图库。本次检索并抽取官方公开页面，未登录、注册、调用业务工具或下载商家图片。

- [个人开发者入口说明](https://developer.meituan.com/)仍写“实名认证即开通，免费接入 MCP/Skills”。这只确认有个人入驻入口，不证明任意门店照片、点评图片、个人网站多用户调用或独立网页展示已经获权。个人控制台公开抽取失败；[MCP 目录](https://developer.meituan.com/ai-hub/mcp-list)的搜索缓存显示 10 项、重新抽取显示 0 项，动态状态不一致，不能据此断言具体工具可用或平台没有服务。
- [企业版到餐 API 文档](https://h5.dianping.com/app/bep-docs/sky-doc/canyinopenapi/daocan_api.html)明确列出 `/openapi/daocanPoi/list` 的 `defaultpic`（缩略图）、`/openapi/daocanPoi/detail` 的 `defaultPic`（图片）、`/openapi/daocanPoi/reviewList` 的 `photo_urls`（评论图片）。因此企业到餐存在图片字段达到 D；该文档要求平台分配 token／sign／aesKey／entId 并联系取得测试与正式账号，不是个人拿普通 Key 即可调用的公开图库。示例图片未下载、未作为应用素材或真实数据使用。
- [合作中心概述](https://developer.meituan.com/docs/biz/comm-dev-summary)描述面向符合要求的合作伙伴、服务商和应用；[API 文档目录](https://developer.meituan.com/docs/api)可见商家经营及需业务授权的接口。商家上传图片／管理商品的权限不等于查询任意商户图库；到餐图片也不证明覆盖城市封面或所有景点。
- 尚未确认：本项目个人资格与具体工具、返回图片字段及尺寸／有效期、调用额度与费用、面向独立旅行网页的展示及署名、直链或代理方式、缓存／保存／分享快照权限、UGC 图片再展示授权。拿到可访问 URL 不等于这些权限已满足，不能默认盗链、爬取详情页或购买非官方抓取服务。

接入门禁：由用户在个人控制台确认可用工具／API 与用途条款，提供不含凭据的工具名称、字段说明和权限截图；若个人接口不覆盖图片，再确认企业合作资格或替代素材，不自行切换供应商。凭据仅本地配置，账号验证另行授权。当前图片能力只记 D，A／P 均未达到，生产图片接入保持关闭。

## 10. GitHub 旅行产品参考调查（2026-10-28）

用户重新要求改善单调页面，增加背景图、动效、详细地点推荐、精致地图与真实图片。本次通过已认证 gh 搜索，克隆并只读检查以下四个项目的 README、相关实现及仓库截图；未安装依赖、运行外部脚本或调用其业务 API。截图是仓库提供的展示，不代表本次在线演示验收，也不证明本项目取得其图片或供应商权限。

| 项目与固定版本 | 已核对的参考点 | 许可与采用边界 |
| --- | --- | --- |
| [itskovacs/trip](https://github.com/itskovacs/trip/tree/856b1edfe81a735fce4b544c2e16a6518cebf164) | `src/src/app/services/trip-map.service.ts` 的按日路线高亮、其他地点弱化、选中联动；`shared/map.ts` 的照片标记；仓库 `sc_trip.jpg` 展示地图、日程及详情的空间关系 | MIT；可借鉴组织方式，若复用代码须保留许可。采用地图／日程联动思想，不迁移 Angular／Leaflet，不直接搬照片或无条件照搬持续虚线动画 |
| [liketrek/TREK](https://github.com/liketrek/TREK/tree/d4da05bbc93bcfa9668e7a8f4e5384b788452418) | 目的地摄影封面、地点图库；`MapViewGL.tsx` 的路线描边／主次层级与选中相机移动；`placePhotoCredit.ts` 的作者及许可署名；`wikimedia.client.ts` 使用文章身份关联介绍，并返回图片来源页／许可元数据 | AGPL-3.0；本次仅研究交互与数据组织，不复制实现或素材。Google／Wikipedia／Commons 是该项目的来源选择，不代表本项目可自动启用；其缓存逻辑也不是供应商许可证明 |
| [hardikverma22/travel-planner-ai](https://github.com/hardikverma22/travel-planner-ai/tree/b98beb3e940781453b4e5d71c4d7fb3a470ef542) | Next.js 的目的地大图及标题叠层；`components/sections/ImageSection.tsx` 与 `convex/images.ts`。后者用地点名称搜索 Unsplash 并取第一张，随后保存到 Convex | GitHub 未识别许可证，根目录／一级子目录未发现 license／copying 文件，不按可复用代码处理。名称搜索首图不能证明对应具体 POI，不采用其图片选择／保存方案；README 明确这是 Rutugo 前身，不能把新站宣传当该版本已实现 |
| [mysterious-duola/travel-itinerary-mapper](https://github.com/mysterious-duola/travel-itinerary-mapper/tree/7d0603147790f6335ad76c6c5c012108e3cedc5a) | 高德地图、地点照片／介绍、逐日时间轴及城市背景同屏；已查看 `docs/screenshot.jpg` 与 `assets/template.html` | MIT；这是静态 HTML 生成 Skill，不是完整应用验证。借鉴背景与内容层次，不照搬整页等比缩放、玻璃叠层或把点间虚线当实际路线；其示例照片直链不构成展示授权 |

当前问题与改版依据：

- 内容：本项目 `itinerary-model.ts` 明确要求 reason 不超过 40 字，`ItineraryChoice` 只有推荐理由和停留时长，逐项推荐快照只有 reason／dish，详情面板主要呈现排程及编辑字段。应分别承载有来源的地点简介、AI 推荐理由／体验建议和待核实项，而不是只增加文案长度或把模型叙述冒充地点事实。
- 视觉与动效：目的地封面集中承载可信摄影，正文保持浅色不透明阅读面；日切换、资料展开和地图选中使用短促的连续过渡，保留键盘焦点并尊重 reduced motion。不采用复杂背景遮挡正文、整页缩小或永久循环动画。
- 地图：当前 `route-map.tsx` 仅有同形编号与单层绿线，可改善为编号／类别标记、选中强调、路线底描边与方向层级、全日视野及图例；继续只绘制供应商真实分段，缺轨迹不补假直线，高德署名保留。
- 图片：代码许可、照片许可和地点匹配分别校验。若将来评估 Commons，必须按具体文件核对身份、作者、许可及来源页，不能按“免费图库”整体放行；本次未切换图片来源、下载地点实景作为产品素材或开放任意 photoUrl。美团／点评个人权限及站外展示条件仍是第 9 节的缺项，供应商等级不因本次 GitHub 调查升级。

以上是调查时的改版参考与边界，不是 GitHub 调查本身已实现的背景图、丰富推荐、地图效果或图片接入；后续实现与验证分别见测试记录。

## 11. 生成格式与频率专项（2026-10-28，单次受限真实验证）

用户报告 AI 内容格式不对、请求太频繁，并授权少量测试。先离线复现并修复可选指南全覆盖导致整份拒绝、零模型调用也占次数等缺陷（测试检查 91—93）；不通过提高限额、增加自动重试或放行无效候选解决问题。

本次实测上限为 2 次地点搜索、1 次模型，0 路线／天气／地图 SDK／数据库、0 重试；仅调用一次显式脚本并保留唯一当天 attempt。[脱敏摘要](evidence/itinerary-model-smoke-2026-10-28.json)经回读确认：杭州仅接口测试城市，1 日／1 人；实际搜索 2、模型 1，HTTP200、finish_reason=stop、内容 827 字符、约 4949ms；合法 3 个景点及三餐候选，guides 仅 1 项。模型输出通过修复后的严格核心／候选校验，原实现会因缺少全部指南而拒绝；未保存原始地点／模型内容或私密凭据。

这是一条真实 model-only 契约样本，不是网页完整生成／真实路线及排程验收，也不证明多日质量、账号所有错误场景或供应商 P 许可。实际上游限流本次未发生，Retry-After／冷却及错误分类使用离线测试，不为测试限流重复消耗配额。每日 attempt 不能删除重跑，后续真实调用另行授权。

## 12. Tour-AI 技术参考（只读代码调查）

已通过认证 gh 克隆 [dwsera/Tour-AI，04b8729](https://github.com/dwsera/Tour-AI/tree/04b8729af8e2e9fefb49d2086fb4aa25ee028196)，核对 README、package.json、Prisma schema、首页／创建页、AI／图片 API 与地图组件。实际依赖为 Next 15／React 19／TypeScript／Tailwind 3、Radix／Framer Motion 12／Lucide／Zustand；Prisma 6＋MySQL／TiDB、NextAuth 4、Resend。生成用 DashScope qwen-turbo，流式聊天用 qwen-max；Leaflet／React-Leaflet＋OSM 底图，高德用于逆地理及地点图片，另有第三方图片搜索备用。

可参考首页背景与聚焦入口、分步选择、图文地点卡、侧栏导航和选中地图平移，不迁移当前技术栈。不能照搬可靠性逻辑：getTourismGuide 在 JSON 解析失败后用正则提取名称／描述，并默认补“免费”“30分钟”“地铁”；MapComponent 把地点坐标直接连接成虚线而非真实道路路线。图片搜索首个 POI／备用搜索与通用图库映射不能证明地点匹配或展示许可；图片代理接受任意 URL 并非可采用的安全边界。

GitHub 未识别标准许可证，根目录未发现 LICENSE，README 明确仅学习／研究／非商业用途；本次只研究实现思想，不复用其代码、品牌或图片，不运行安装脚本、演示或业务接口。

## 13. MediaCrawler 社交推荐来源（代码调查与离线导入，未采集）

已认证 gh 克隆 [NanmiCoder/MediaCrawler，68d9ef1](https://github.com/NanmiCoder/MediaCrawler/tree/68d9ef1c1da22eab75940dfd7cec259907006538)，读取 LICENSE、README、pyproject.toml、存储指南、小红书导出实现与 API schema。它是采集工具，不提供旅行领域的 POI 核验或真实算路：

- 技术：Python ≥3.11、Playwright／浏览器登录态、httpx、Pydantic、FastAPI／Uvicorn、SQLAlchemy；可选 WebUI 为 React 18／Vite／Tailwind／Zustand／TanStack Query。无需替换现有 Next／React／PostgreSQL 技术栈，也不把其整个 WebUI 或爬虫依赖嵌入本应用。
- 数据：支持小红书、抖音、B站等平台；可导出 JSON、JSONL、CSV、Excel 及数据库。小红书内容包含 note_id、title、desc、time、last_update_time、tag_list、source_keyword、互动计数和 image_list；当前导出还含 xsec_token，note_url 也可带该值。接入必须白名单取字段、去掉令牌／登录态／作者标识，不原样传模型、提交 Git 或分享。
- 许可：[NON-COMMERCIAL LEARNING LICENSE 1.1](https://github.com/NanmiCoder/MediaCrawler/blob/68d9ef1c1da22eab75940dfd7cec259907006538/LICENSE)仅授予非商业学习研究用途，要求保留版权／许可声明，禁止大规模采集或干扰平台；商业用途需作者书面同意。代码许可不自动授予平台访问、笔记转发或照片展示权，不能视为生产可无条件使用的通用接口。
- 首轮采用边界：独立本地采集 → 导入合法公开且已获权的笔记 JSON／JSONL → 提取／审核推荐及来源时间 → 匹配高德候选 POI → 实际相邻路线 → 确定性排程与 AI 解释。推荐和作者经验标为社交来源／未核实，不把热度当可靠性，营业、票价、排队、过敏和路线时刻独立核对。多平台／图片展示／线上抓取任务不是导入 DTO 的默认权限。

检查 101 已实现小红书 JSON／JSONL 本地文件适配与离线 UI／编排闭环（433 单测／194 双端 E2E／build），不是平台账号或真实笔记验收：

- 浏览器最多解析 1 MiB／100 篇，白名单仅保留平台、24 位 noteId、标题、480 字符摘录、可未知的笔记自带时间与独立导入记录。最多选三篇，每篇可由用户确认两个景点／餐厅检索名称；不自动提取或强制用户先填地点。
- Cookie、token、带令牌的原 note_url、作者结构字段、互动量和媒体不进入请求；规范来源链接仅由已校验 ID 构造，不含令牌，可能需平台内查看。正文只清理基础 URL／联系方式／提及，不能替代人工去标识与合法使用确认。
- 资料绑定当前城市并须明确确认发送范围，只有应用后随显式生成交给服务端与当前模型；撤销同意即移除请求字段。最多六项推荐检索，经唯一精确匹配才补入公共候选，歧义／失败明确提示，不变成必去约束；仍只用一轮模型，源文本是数据而非工具指令。来源名单不是逐活动引用证明，更不是营业、价格或安全依据。

未安装 Python 依赖、接管 Chrome、登录、发起平台采集或新增真实模型调用。采集城市／关键词／数量、内容使用权、多平台与照片展示仍未确认；只导入契约与明确 fixture 通过，实际平台文件、自动采集与生产许可未验，不读取或要求 Cookie／登录文件，不绕过验证码或访问控制。

## 14. 短候选生成与独立授权图片通路（离线实现）

生成继续使用现有 OpenAI 兼容接口，没有新增模型、配额或自动重试。候选在请求内编号为 P001 等短 key，完整输出通过严格契约后映射回真实 ID，兼容原完整 ID 协议；完整 JSON／围栏之外的坏 JSON、截断、未知 key、错类型及额外图片字段仍拒绝。有效重复景点在本地去重，空日仅用已校验公共候选补位或重分配，保留调整提示及强约束复核，不虚构地点。NDJSON 新增可选实际工作计数，路线按处理天数更新；其他阶段不造百分比。该协议尚无新增真实模型样本，不能沿用第 11 节样本证明新协议或 14 日输出质量。

图片为独立浏览器适配，不是平台搜索 API，也不让模型指定图片 URL：

- 文件入口仅取 MediaCrawler 小红书 JSON／JSONL 的图片白名单字段；也可粘贴规范小红书／哔哩哔哩来源及受支持公开 CDN 地址。文件至多 1 MiB／100 条、48 个候选，本次会话最多关联 12 张。原文件、作者结构字段、登录态与 token 不进入模型或分享；正文与图片的同意互不替代。
- 每张先确认图片及平台站外展示授权，再以匿名 CORS、无 Referer、no-store、拒绝重定向的浏览器请求读取；只接受 JPEG／PNG／WebP／AVIF，至多 3 MiB。禁止任意主机、query/token、Cookie、代理、防盗链模拟和访问限制绕过；常见受限平台链接可能无法读取，失败保留原来源链接。
- 成功解码后仍需用户确认具体地点对应并填写署名，才可应用；显示为平台参考图，不是供应商事实证明。图片仅以可回收 Blob 保留当前会话，可移除；不进入 Itinerary、TripBrief、模型或分享 DTO，不持久化供应商图片。
- 检查 119 双端用本地生成且标明 Authored test fixture 的图片验证授权前零请求、署名／匹配、应用／移除、原来源、无 Cookie、403 不绕过，以及嵌套原生弹窗焦点／滚动恢复。白名单、格式／大小／重定向与模型隔离另有单测。未登录、采集、下载真实平台照片或安装新依赖。

此处仅说明本项目代码与离线边界：未获得平台官方图片业务契约、真实文件联调或站外展示／保存／分享许可，不能据此标为图片 A／P、全平台自动接入或可商用图库。代码许可、平台访问条件、每张图片使用权和地点匹配仍分别核对。

## 15. 再次真实格式诊断（2026-10-30）

用户报告仍有无效 JSON，并重新授权多次真实定位。本轮主动限为最多三次独立模型请求，零地点／路线／天气／数据库、零自动重试，未删除此前 attempt。新脚本 diagnose-itinerary-json.ts 每天仅接受 attempt 1—3，每槽先排他写记录再请求，重复槽直接拒绝；后续调用仍须新授权，不把脚本当免费回归。

三次均为当前配置模型与 45 个合成候选的格式检查，不是重放用户的失败请求：

| 尝试 | 输入 | 实际结果 | 脱敏证据 |
| --- | --- | --- | --- |
| 1 | 3 日 | HTTP200／stop，外层与核心 JSON 有效，约 4.7s | itinerary-json-diagnostic-2026-10-30-1.json |
| 2 | 14 日 | HTTP200／stop，外层与核心 JSON 有效，约 11.3s | itinerary-json-diagnostic-2026-10-30-2.json |
| 3 | 3 日＋含引号／反斜线／换行的合成社交资料 | HTTP200／stop，外层与核心 JSON 有效，约 4.8s | itinerary-json-diagnostic-2026-10-30-3.json |

文件均在 docs/evidence，仅含状态、大小、计数和耗时，不含模型正文、凭据或供应商主机。没有复现用户原始失败，不能据此声称根治、社交采集成功或真实 14 日质量达标。已确认并修正错误归因：原代码将接口外层 JSON 与模型正文的 SyntaxError 混为 ai_invalid_json；现在外层为 ai_upstream_invalid_json，外层结构为 ai_upstream_invalid_response，正文语法／转义仍是 ai_invalid_json 且提示具体类别。服务端只记 layer／分类／位置，不输出可能含正文的 SyntaxError.message，不修补坏 JSON 或追加付费重试。

## 16. 后台自动社交参考索引（离线适配，非真实采集）

用户已明确最终用户只填写旅行需求，系统依据社交资料整理攻略，不上传笔记或逐张配图。现由 SocialCatalogProvider 在生成时查询后台索引，按同城、旅行目的／次要偏好／必去与必吃词排序并去重，最多三篇交给现有模型；模型仍只选择已核对候选，地图继续核对实际相邻路线。没有额外模型调用，也不在 Next 请求内启动 MediaCrawler。

索引由运营／独立采集处理端准备，而非最终用户：

- 服务端 SOCIAL_REFERENCE_FILE 指向仓库内、已被 Git 忽略的 JSON，例如 node_modules/.cache/social-catalog.json；不得提交真实正文或填写私密路径到聊天。检查扩展名、realpath、文件类型与大小，至多 1 MiB／100 篇，不读仓库外文件，不接受请求指定路径，不缓存副本。
- 格式为 `{ "version": 1, "modelUseConfirmed": true, "records": [...] }`；每个 record 遵循现有 SocialInspiration：city、consent:true、最多三篇 notes，多个同城 record 可合并检索。每篇仅含 platform:xiaohongshu、noteId、title、excerpt、publishedAt、importedAt 与最多两个待核对 places。它是清洗、人工审核并确认模型使用权的索引，不是原始 MediaCrawler 导出；未知字段、作者／媒体／Cookie、超限或无使用权确认整份拒绝。consent 是索引复用的技术字段，不伪装最终用户点过授权。
- 独立采集端须先按许可和平台条件取得资料、清理隐私与令牌、审核摘录／地点名，再原子替换索引文件。modelUseConfirmed 只是运营声明，不自动获得平台访问／展示／商业权益或 P。当前没有安装采集端、生成真实索引或接管登录，亦不支持多平台正文检索。
- 自动参考只加到服务端模型上下文；输出用独立 socialSource 携带 available／not_configured／no_results／unavailable 及有界规范引用，返回 brief 保持原请求，不能削弱客户端错请求／迟到结果校验。已有用户明确选用的参考优先，不被后台静默替换。错城资料不送模型；非 available 状态明确未使用社交内容，不以模型记忆冒充平台检索。
- 纯检索、真实合成临时文件读取、使用权／大小／路径／隐私门禁、单次模型及原请求绑定有单测；双端以 fixture 验证无上传生成、来源查看与无配置提示。图片不在此通路，继续独立核对权利，不让 AI 编造媒体 URL。

当前仅自动资料适配和离线编排闭环可用；实际 MediaCrawler 采集、后台资料供给、平台权限、真实内容效果与逐活动证据归属仍待验证。未连接真实源时，页面明确“未连接后台社交资料库”，不把测试图文或这份索引协议称为已接通小红书。
