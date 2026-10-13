"""Generate editable FigCli JSX, not application code. No API credentials needed."""
import json
from html import escape
from pathlib import Path

OUT = Path(__file__).parent
serial = 0


def node(tag, children="", **props):
    global serial
    serial += 1
    props.setdefault("name", f"{tag} {serial}")
    attrs = []
    for k, v in props.items():
        if isinstance(v, bool):
            attrs.append(f'{k}={{{str(v).lower()}}}')
        elif isinstance(v, (int, float)):
            attrs.append(f'{k}={{{v}}}')
        else:
            attrs.append(f'{k}={json.dumps(str(v), ensure_ascii=False)}')
    return f'<{tag} {" ".join(attrs)}>{children}</{tag}>'


def text(value, size=14, color="foreground", bold=False, fill=False, **props):
    # FigCli's diagnostic JS string does not escape literal newlines.
    if "\n" in value:
        lines = "".join(text(line, size, color, bold, fill) for line in value.splitlines())
        return col(lines, gap=0, **({"w": "fill"} if fill else {}), **props)
    return node("Text", escape(value, quote=False), font="Noto Sans SC", size=size,
                weight="bold" if bold else "regular", color=f"var:{color}",
                lineHeight="150%", **({"w": "fill"} if fill else {}), **props)


def frame(children="", **props):
    return node("Frame", children, **props)


def col(children, **props):
    return frame(children, flex="col", gap=props.pop("gap", 12), **props)


def row(children, **props):
    return frame(children, flex="row", items=props.pop("items", "center"), gap=props.pop("gap", 12), **props)


def icon(name, color="muted", size=20):
    return f'<Icon name="lucide:{name}" size={{{size}}} color="var:{color}" />'


def button(label, primary=False, **props):
    return row(text(label, color="on-primary" if primary else "foreground", bold=True),
               name=f"Button / {label}", bg="var:primary" if primary else "var:surface",
               stroke="var:primary" if primary else "var:border", strokeWidth=1,
               rounded=8, h=48, px=20, justify="center", **props)


def chip(label, selected=False):
    return row(text(label, size=13, color="primary" if selected else "muted", bold=selected),
               h=36, px=12, rounded=99, bg="var:primary-soft" if selected else "var:background")


def panel(children, **props):
    return col(children, bg="var:surface", stroke="var:border", strokeWidth=1,
               rounded=12, p=props.pop("p", 24), **props)


def notice(message, warning=False, **props):
    return row(icon("cloud-rain" if warning else "info", "warning-ink" if warning else "muted")
               + col(text(message, size=13, color="warning-ink" if warning else "muted", fill=True), w="fill"),
               bg="var:warning-bg" if warning else "var:background", rounded=8, p=12, **props)


def nav(mobile=False):
    brand = row(row(icon("compass", "on-primary", 22), w=36, h=36,
                    bg="var:primary", rounded=10, justify="center")
                + text("行间", size=22, bold=True), gap=10)
    if mobile:
        return row(brand + row(icon("more-horizontal"), name="Button / 更多", w=44, h=44,
                              justify="center"), name="Header", w="fill", h=64, px=20,
                   justify="between", bg="var:surface")
    links = row(text("旅行规划", color="primary", bold=True) + text("我的行程", color="muted")
                + text("使用说明", color="muted"), gap=32)
    return row(brand + links + button("新建计划"), name="Header", w="fill", h=72,
               px=32, justify="between", bg="var:surface")


def field(label, value, helper=None, width="fill", glyph="chevron-down"):
    parts = text(label, bold=True, fill=True)
    parts += row(text(value, fill=True) + icon(glyph, size=18), w="fill", h=48, px=14,
                 bg="var:surface", stroke="var:border", strokeWidth=1, rounded=8)
    if helper:
        parts += text(helper, size=12, color="muted", fill=True)
    return col(parts, gap=8, w=width)


def divider():
    return frame(w="fill", h=1, bg="var:border")


def section(title, content):
    return col(text(title, size=18, bold=True, fill=True) + content, w="fill", gap=16)


def create_plan():
    heading = col(text("把想去的地方，排进合适的一天。", size=32, bold=True, fill=True)
                  + text("先告诉我们你的安排。行程生成后，仍然可以自由调整。", size=16,
                         color="muted", fill=True), w="fill", px=144, py=36)
    basics = row(field("目的地", "杭州", "设计示例城市", width=344, glyph="map-pin")
                 + field("出行日期", "2026/10/17 - 10/18", width=344, glyph="calendar"), w="fill", gap=24, items="start")
    basics += row(field("同行人数", "2 位成人", width=344, glyph="users")
                  + field("每人预算", "¥ 1,500", "示例金额，不代表实际费用", width=344,
                          glyph="wallet"), w="fill", gap=24, items="start")
    basics += field("住宿或每日出发点", "西湖附近，具体地址待填写", glyph="map-pin")
    preferences = row(chip("自然风光", True) + chip("博物馆", True) + chip("当地美食", True)
                      + chip("城市漫步"), w="fill", gap=8)
    preferences += row(field("旅行节奏", "适中，每天保留休息时间", width=344)
                       + field("市内交通", "公交 / 地铁 + 步行", width=344), w="fill", gap=24)
    meals = row(field("每餐人均", "¥ 50-100", "可选择预算友好备选", width=344)
                + field("饮食要求", "填写忌口或过敏信息", width=344), w="fill", gap=24, items="start")
    transport = row(icon("train-front") + col(text("补充到达与返程时间", bold=True, fill=True)
                    + text("手动录入车票或航班，不提供出票服务。", size=13, color="muted", fill=True),
                    w="fill", gap=4) + icon("plus"), w="fill", h=72, p=14,
                    bg="var:background", rounded=8)
    form = panel(section("旅行信息", basics) + divider() + section("你想怎样旅行", preferences)
                 + divider() + section("午餐与晚餐", meals) + transport
                 + notice("预算含跨城交通、住宿、餐饮、门票与市内交通；购物不计入。", w="fill")
                 + row(text("生成后可编辑，不会自动预订。", size=13, color="muted")
                       + button("生成行程", True), w="fill", justify="between"), w=760, gap=24)
    summary = panel(text("一份可以改的计划", size=22, bold=True, fill=True)
                    + text("路程、吃饭和返程，一起安排。", size=15, color="muted", fill=True)
                    + divider() + text("示例偏好", bold=True, fill=True)
                    + text("杭州 2 日 / 2 位成人\n自然风光、博物馆、当地美食\n预算 ¥ 1,500 / 人", color="muted", fill=True)
                    + notice("营业时间与价格缺失时，明确显示未知。", w="fill")
                    + notice("和风天气未实测。天气内容仅作设计示例。", w="fill"), w=368, gap=20)
    body = frame(form + summary, flex="row", items="start", w="fill", px=144, pb=48, gap=24)
    return col(nav() + heading + body, name="01 新建旅行计划 / Desktop", w=1440,
               bg="var:background", gap=0)


def activity(time, title, detail, selected=False, locked=False):
    head = row(text(title, size=15, bold=True, fill=True) + (icon("lock-keyhole", "primary", 16) if locked else ""), w="fill", gap=6)
    return row(col(text(time, size=13, bold=True) + icon("grip-vertical", size=16), w=44, gap=8)
               + col(head + text(detail, size=12, color="muted", fill=True), w="fill", gap=6),
               w="fill", p=12, rounded=8, bg="var:primary-soft" if selected else "var:background",
               stroke="var:primary" if selected else "var:border", strokeWidth=1, gap=10)


def itinerary(mobile=False):
    return panel(row(text("每日行程", size=20, bold=True) + row(icon("sliders-horizontal"),
                        name="Button / 行程设置", w=44, h=44, justify="center"),
                     w="fill", justify="between")
                 + row(button("第 1 天", True, w=124) + button("第 2 天", w=124), w="fill", gap=8)
                 + text("10月17日  星期六 / 时间为示例", size=12, color="muted", fill=True)
                 + activity("09:30", "浙江省博物馆孤山馆", "停留 90 分钟 / 已锁定地点", True, True)
                 + text("下一路段按出发时刻查询", size=12, color="muted", fill=True)
                 + activity("12:00", "午餐：附近杭帮菜", "餐厅待选择 / 人均待核实")
                 + activity("14:00", "西湖博物馆", "停留 90 分钟 / 示例安排", locked=True)
                 + activity("16:00", "湖边散步", "室外活动 / 可替换")
                 + activity("18:00", "晚餐与返回住宿", "沿途餐厅待选择")
                 + text("拖动可调整；也可用上移 / 下移操作。", size=12, color="muted", fill=True),
                 w="fill" if mobile else 320, h="fill" if not mobile else "hug", p=16, gap=14)


def map_panel():
    parts = frame(w=360, h=410, x=30, y=64, bg="var:lake", rounded=180, name="Lake - schematic")
    parts += frame(w=148, h=88, x=65, y=48, bg="var:park", rounded=24, rotate=-12, name="Park / schematic")
    for i, (x, y, w, angle) in enumerate([(268, 50, 280, 28), (320, 180, 320, 30), (245, 390, 320, -12)]):
        parts += frame(w=w, h=14, x=x, y=y, bg="var:road", rotate=angle, name=f"Road {i} / schematic")
    parts += frame(text("西湖", size=26, color="muted"), w=200, h=48, x=126, y=258,
                   name="Map label / West Lake")
    for i, (x, y, w, angle) in enumerate([(171, 156, 180, 40), (309, 275, 174, 34)]):
        parts += frame(w=w, h=4, x=x, y=y, bg="var:primary", rotate=angle, name=f"Route segment {i} / schematic")
    for label, name, x, y in [("1", "孤山馆", 128, 120), ("2", "午餐待选择", 288, 252), ("3", "西湖博物馆", 440, 362)]:
        pin = row(text(label, size=14, color="on-primary", bold=True), w=36, h=36,
                  bg="var:primary", rounded=18, justify="center")
        parts += col(pin + text(name, size=13, bold=True), x=x, y=y, gap=6, name=f"Map marker / {label}")
    parts += row(text("路线示意，不是高德底图", size=12, color="muted"),
                 bg="var:surface", rounded=8, px=12, py=8, w=300, h=36, x=20, y=490, name="Map disclaimer")
    diagram = frame(parts, name="Map / schematic only", w="fill", h=542, flex="none",
                    bg="var:background", rounded=8, overflow="hidden")
    tools = row(col(text("当天路线", size=20, bold=True) + text("地点和餐厅都在同一张图上", size=12, color="muted"), gap=4)
                + row(icon("maximize"), name="Button / 放大地图", w=44, h=44, justify="center"),
                w="fill", justify="between")
    weather = notice("天气设计示例：小雨，18-23°C。和风天气未实测，不是实际预报。", True, w="fill")
    return panel(tools + diagram + weather + row(text("室外活动可查看室内备选", size=13, color="muted")
                 + button("预览雨天方案"), w="fill", justify="between"), w="fill", h="fill", p=16, gap=16)


def details():
    return panel(text("地点详情", size=20, bold=True, fill=True)
                 + row(icon("landmark", "primary", 28) + chip("已锁定", True))
                 + text("浙江省博物馆\n孤山馆", size=24, bold=True, fill=True)
                 + text("选中的地点会在行程与地图中同步突出显示。", color="muted", fill=True)
                 + divider() + text("来源与核实", bold=True, fill=True)
                 + text("位置来源：高德\n开放与预约：需进一步核实\n门票价格：未知", color="muted", fill=True)
                 + notice("地点搜索成功不代表开放和预约规则已确认。", w="fill")
                 + button("查看来源", w="fill") + divider()
                 + text("预算概览", size=18, bold=True, fill=True)
                 + text("¥ 1,500 / 人", size=26, bold=True, fill=True)
                 + text("这是预算目标，不是已核算总价。", size=12, color="muted", fill=True)
                 + text("住宿、餐饮、门票与交通\n部分费用未知，待补充后汇总。", color="muted", fill=True),
                 w=304, h="fill", p=20, gap=14)


def workspace():
    title = row(col(text("杭州两日计划", size=28, bold=True) + text("10/17 - 10/18  /  2 位成人  /  节奏适中", color="muted"), gap=6)
                + row(button("撤销") + button("分享") + button("保存计划", True), gap=10),
                w="fill", h=104, px=32, justify="between")
    banner = row(icon("info") + text("设计示例：行程、预算与地图为示意；不是已校验的完整旅行方案。", size=13, color="muted"),
                 w="fill", h=40, px=32)
    body = frame(itinerary() + map_panel() + details(), name="Workbench columns", flex="row", gap=16,
                 w="fill", h=800, px=32, py=20)
    return col(nav() + title + banner + body
               + row(text("草稿 / 还有开放、预约和费用信息待核实", size=13, color="muted")
                     + text("高德接口已实测；天气为设计示例", size=12, color="muted"),
                     w="fill", h=48, px=32, justify="between"),
               name="02 行程规划工作台 / Desktop", w=1440, bg="var:background", gap=0)


def comparison(title, changed=False):
    item = "16:00  室内候选地点" if changed else "16:00  湖边散步"
    detail = "开放时间未核实，不承诺可执行" if changed else "室外活动，示例停留 90 分钟"
    return panel(text(title, size=18, bold=True, fill=True)
                 + activity("09:30", "浙江省博物馆孤山馆", "保持不变", locked=True)
                 + activity("12:00", "午餐：附近杭帮菜", "保持不变，餐厅待选择")
                 + activity("14:00", "西湖博物馆", "保持不变", locked=True)
                 + col(text(item, size=15, bold=True, fill=True) + text(detail, size=13, color="muted", fill=True),
                       w="fill", p=14, bg="var:primary-soft" if changed else "var:background", rounded=8)
                 + text("后续交通需重新查询" if changed else "当前示例安排", size=13, color="muted", fill=True),
                 w=350, p=20, gap=18)


def preview():
    heading = col(text("先看变化，再决定。", size=32, bold=True, fill=True)
                  + text("雨天备选只是一份提案，不会自动改动已保存的计划。", size=16, color="muted", fill=True),
                  w="fill", px=80, py=36)
    summary = panel(chip("雨天情景演示", True) + text("保留必去地点，\n替换一个室外活动。", size=26, bold=True, fill=True)
                    + text("天气按小雨示例设计，和风天气未实测。", color="muted", fill=True)
                    + divider() + text("这次修改", size=18, bold=True, fill=True)
                    + text("替换 1 个活动\n保留 2 个锁定地点\n用餐安排不变", color="muted", fill=True)
                    + notice("室内候选开放时间未知；交通与费用需要重新核算。", True, w="fill")
                    + text("调整后仍属于待核实草稿，不标记为可执行方案。", size=13, color="muted", fill=True),
                    w=460, gap=24)
    comparisons = col(row(comparison("当前安排") + comparison("修改后", True), w="fill", gap=20)
                      + notice("确认时复查锁定项与版本；版本变化会要求重新预览。", w="fill")
                      + row(button("取消修改") + button("应用到草稿", True),
                            w="fill", justify="end"), w=720, gap=24)
    return col(nav() + heading + frame(summary + comparisons, flex="row", items="start", w="fill",
               px=80, pb=48, gap=40), name="03 修改方案预览 / Desktop", w=1440,
               bg="var:background", gap=0)


def mobile():
    title = col(text("杭州两日计划", size=24, bold=True, fill=True)
                + text("10/17 - 10/18 / 2 位成人 / 草稿", size=13, color="muted", fill=True),
                w="fill", px=20, py=20, gap=6)
    toggle = row(button("行程", True, w=166) + button("地图", w=166), w="fill", px=20, gap=8)
    body = col(notice("天气示例：小雨。和风天气未实测。", True, w="fill")
               + row(chip("第 1 天", True) + chip("第 2 天"), w="fill", gap=8)
               + text("10月17日 / 时间为示例", size=13, color="muted", fill=True)
               + activity("09:30", "浙江省博物馆孤山馆", "90 分钟 / 地点已锁定", True, True)
               + activity("12:00", "午餐：附近杭帮菜", "餐厅待选择 / 人均未知")
               + activity("14:00", "西湖博物馆", "90 分钟 / 保持锁定", locked=True)
               + activity("16:00", "湖边散步", "室外活动 / 查看室内备选")
               + button("预览雨天方案", w="fill")
               + text("地图与详情在窄屏分别打开；支持按钮调整顺序。", size=12, color="muted", fill=True),
               w="fill", p=20, gap=16)
    footer = row(col(text("预算 ¥ 1,500 / 人", bold=True) + text("示例目标 / 费用未核实", size=12, color="muted"), gap=4)
                 + button("保存", True), w="fill", px=20, py=16, justify="between", bg="var:surface")
    return col(nav(True) + title + toggle + body + footer,
               name="04 窄屏行程工作台 / Responsive web", w=390, bg="var:background", gap=0)


if __name__ == "__main__":
    screens = [create_plan(), workspace(), preview(), mobile()]
    for i, screen in enumerate(screens, 1):
        path = OUT / f"screen-{i:02}.jsx"
        path.write_text(screen + "\n", encoding="utf-8", newline="\n")
    (OUT / "screens.json").write_text(json.dumps(screens, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8", newline="\n")
    print(f"Generated {len(screens)} editable screen definitions; {serial} named JSX nodes")
