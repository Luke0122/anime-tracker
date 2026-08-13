# -*- coding: utf-8 -*-
"""生成季度新番信息 PPT（Project Status Report 模板版，原生表格，信息完整）。

结构：封面(源1) → 统计总览(源2) → 新番一览表(源8 克隆 x N，原生表格) →
每部番详情页(源8 克隆，封面图 + 原生详情表格；简介/声优等字段不截断，
放不下时自动拆成“主表页 + 简介续页”) → 感谢页(源11)。
"""
import datetime
import math
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RUNTIME_DIR, season_key, season_label, setup_logging
import template_pptx as tpl

CHUNK = 9
TABLE_POS = {"left": 30, "top": 238, "width": 1220, "height": 446}
COVER_POS = {"left": 30, "top": 240, "width": 230, "height": 325}
SCORE_CARD_POS = {"left": 30, "top": 572, "width": 230, "height": 130}
CARD_POS = {"left": 285, "top": 170, "width": 965, "height": 524}
TITLE_TOP = 88
TABLE_COL_WIDTHS = [52, 396, 80, 120, 100, 102, 270, 100]
DETAIL_COL_WIDTHS = [150, 315, 150, 350]
MERGE_W = sum(DETAIL_COL_WIDTHS[1:])                # 合并值列总宽（声优/标签/简介）
BUDGET = 524.0                                       # 表格可用高度（top=170 → 底 <= 694）
FIT_BUDGET = BUDGET - 8.0                            # 单页/简介续页预算：预留估算误差
MAIN_BUDGET = BUDGET - 20.0                          # 拆页主表预算：更保守，防拉丁字符撑高
VF_SET = [34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14]   # 双列行（放送/原作/导演…）字号，最小 14
LF_SET = [28, 26, 24, 22, 20, 18, 16, 14, 12]       # 合并行（声优/标签/简介）字号，最小 12
SF_SET = [26, 24, 22, 20, 18, 16, 14, 12]           # 简介续页字号（兜底用）
LABEL_CAP = 26                                       # 标签字号上限，避免“脚本/构成”折行
LINE_FACTOR = 1.30                                   # 行高系数（实测 PowerPoint 约 1.2，取保守值）
WIDTH_FACTOR = 0.97                                  # 每行可用宽度安全系数
CELL_MARGIN_X = 19.2                                 # 单元格左右边距合计(px)
CELL_MARGIN_Y = 9.6                                  # 单元格上下边距合计(px)
BORDER_H = 2.0                                       # 上下边框占位(px)

FONT_CN = "微软雅黑"
C_ACCENT = "#753F2C"
C_LABEL_BG = "#F6F4F2"
C_BORDER = "#E7E6E6"
C_LABEL = "#637376"
C_VALUE = "#3B4546"
C_WHITE = "#FFFFFF"

OVERVIEW_CAPS = [4, 16, 4, 7, 4, 3, 10, 4]
OVERVIEW_CENTER_COLS = {0, 2, 3, 4, 5, 7}
OVERVIEW_LEFT_COLS = {1, 6}
DETAIL_CAP_WEEKDAY_TIME = 12


def _fmt_rating(item):
    r = item.get("rating")
    if r is None:
        return "—"
    return "%.1f" % r


def _fmt_eps(eps):
    """把话数统一成纯数字：12 / 全24话 / 24话 → 24。"""
    if eps is None:
        return ""
    s = str(eps).strip()
    s = re.sub(r"^全", "", s)
    s = re.sub(r"话$", "", s)
    return s


def _table_rows(items):
    rows = []
    for i, x in enumerate(items, start=1):
        rows.append([
            i,
            x.get("title", ""),
            x.get("weekday", ""),
            x.get("time", ""),
            ("全%s话" % _fmt_eps(x.get("eps"))) if _fmt_eps(x.get("eps")) else "",
            {True: "原创", False: "改编", None: "—"}.get(x.get("original"), "—"),
            x.get("studio") or "—",
            _fmt_rating(x),
        ])
    return rows


def _cap_width(s, max_w):
    """按 CJK≈1 / ASCII≈0.70 估算宽度截断，超宽加省略号（只用于短字段）。"""
    s = str(s or "")
    w = 0.0
    for i, ch in enumerate(s):
        cw = 1.0 if ord(ch) > 0x2E7F else 0.70
        if w + cw > max_w:
            return s[:i].rstrip() + "…"
        w += cw
    return s


KANA_RANGE = "\u3040-\u30ff"


def _clean_text(s):
    """把任意文本压成单行：合并空白、去掉换行。"""
    return re.sub(r"\s+", " ", str(s or "").strip()).strip()


def _is_jp_line(line):
    """含大量假名的行判定为日文行，用于从简介中剔除日文原文。"""
    kana = sum(1 for ch in line if "\u3040" <= ch <= "\u30ff")
    han = sum(1 for ch in line if "\u4e00" <= ch <= "\u9fff")
    return kana >= 2 and kana >= han * 0.3


def _clean_summary(s):
    """提取中文简介：去掉 [简介原文] 段与含假名的日文行，合并为单行。"""
    s = str(s or "")
    if "[简介原文]" in s:
        s = s.split("[简介原文]", 1)[0]
    parts = []
    for line in s.splitlines():
        line = line.strip()
        if line and not _is_jp_line(line):
            parts.append(line)
    return " ".join(parts)


# 部分条目 Bangumi 无中文简介，此处人工补充中文简介（键为中文标题）
MANUAL_SUMMARY = {
    "转学后班上的清纯可爱美少女，竟是小时候玩在一起的哥们儿":
        "童年好友转学后重逢，却发现对方竟是清纯可爱的美少女，过去的兄弟情与当下的心动交织，校园恋爱喜剧就此展开。",
    "欺诈游戏":
        "女大学生神崎直被卷入巨额诈欺游戏「Liar Game」，与天才诈欺师秋山深一携手，在尔虞我诈的心理博弈中不断逆转翻盘。",
    "乡下大叔成为剑圣 第二季":
        "昔日闻名天下的剑圣如今隐居于乡下道场，面对新时代的挑战再次拔剑，书写属于他的第二段传说。",
    "元祖！BanG Dream Chan":
        "《BanG Dream!》系列的 Q 版搞笑动画，少女乐队成员以夸张逗趣的方式登场，带来轻松欢乐的日常。",
    "在超市后门吸烟的二人":
        "在超市后门偶遇的两人，因一起吸烟而相识，在平凡日常的交谈中逐渐拉近距离的治愈系故事。",
    "落第贤者的学院无双～第二次转生的S级开外挂魔术师冒险录～":
        "前世被称为贤者的主角转生为学院落第生，隐藏真实实力，以 S 级外挂魔术师之姿在学园中大展身手。",
    "无职转生 第三季 ～到了异世界就拿出真本事～":
        "三十四岁的无职家里蹲死后转生到剑与魔法的异世界，以鲁迪乌斯之名认真活出新的人生，冒险与成长物语迎来第三季。",
    "死神 千年血战篇-祸进谭-":
        "《死神》最终篇章「千年血战篇」动画系列，护廷十三队与无形帝国的决战逐步推向高潮。",
    "小鲨鱼去郊游":
        "软萌小鲨鱼踏上郊游之旅，与途中相遇的伙伴们共度温馨日常的治愈系动画。",
    "电影名侦探光之美少女！不可思议的庭院与两人的秘密":
        "《光之美少女》系列剧场版联动作品，名侦探光之美少女们在不可思议的庭院中解开两人之间的秘密。",
    "数码宝贝 觉醒节拍":
        "《数码宝贝》系列新作动画，孩子们与数码兽的羁绊再度觉醒，展开全新的冒险篇章。",
    "拜托了偶像公主":
        "以成为顶级偶像为目标的少女们，在舞台与日常中追逐梦想、闪闪发光的偶像物语。",
    "炒翻天":
        "热爱料理的天才少年秋山酱，以惊人的厨艺与创意挑战美食界，展开火热的料理对决。",
    "超超超超超喜欢你的100个女朋友 第三季":
        "命中注定将拥有 100 位女朋友的恋太郎，在第三季中继续与性格各异的女友们上演热闹的恋爱喜剧。",
    "碧蓝航线：微速前行！第二季":
        "《碧蓝航线》官方四格漫画改编的 Q 版短篇动画，舰船少女们展开轻松悠闲的日常。",
    "天是红河岸":
        "普通女高中生夕梨被神秘力量带到古代赫梯帝国，卷入王位之争，并与凯尔王子在乱世中相知相爱。",
}


def _fallback_summary(item):
    key = item.get("name_cn") or item.get("title") or ""
    if key in MANUAL_SUMMARY:
        return MANUAL_SUMMARY[key]
    return "暂无中文简介（详情见 Bangumi 条目）"


def _cell_style(font_size, color, bold=False, align=None, valign="middle"):
    st = {"typeface": FONT_CN, "fontSize": font_size, "color": color,
          "verticalAlignment": valign}
    if bold:
        st["bold"] = True
    if align:
        st["alignment"] = align
    return st


def _overview_table_spec(slide_no, rows, page_idx):
    headers = ["序", "标题", "星期", "时间", "话数", "原创", "制作公司", "评分"]
    values = [headers]
    for r in rows:
        values.append([_cap_width(v, OVERVIEW_CAPS[j]) if j != 0 else v
                       for j, v in enumerate(r)])
    nrows = len(values)
    spec = {
        "slide": slide_no, "name": "新番一览表 %d" % (page_idx + 1),
        "rows": nrows, "columns": 8,
        "left": TABLE_POS["left"], "top": TABLE_POS["top"],
        "width": TABLE_POS["width"], "height": TABLE_POS["height"],
        "columnWidths": TABLE_COL_WIDTHS,
        "values": values,
        "styleOptions": {"headerRow": True, "bandedRows": False},
        "borders": {"style": "solid", "fill": C_BORDER, "width": 1},
        "rowHeights": [{"index": 0, "height": 46}] +
                      [{"index": i, "height": 42} for i in range(1, nrows)],
    }
    spec.setdefault("blocks", []).append({
        "row": 0, "column": 0, "rowCount": 1, "columnCount": 8,
        "fill": C_ACCENT,
        "textStyle": _cell_style(22, C_WHITE, bold=True, align="center"),
    })
    for ri in range(1, nrows):
        fill = C_WHITE if ri % 2 == 1 else C_LABEL_BG
        spec["blocks"].append({
            "row": ri, "column": 0, "rowCount": 1, "columnCount": 8,
            "fill": fill,
            "textStyle": _cell_style(20, C_VALUE, align="center"),
        })
    for col in OVERVIEW_LEFT_COLS:
        spec["blocks"].append({
            "row": 1, "column": col, "rowCount": nrows - 1, "columnCount": 1,
            "textStyle": _cell_style(20, C_VALUE, align="left"),
        })
    return spec


# ---------------- 文本宽度/行高估算（保证表格不溢出） ----------------
def _units(s):
    """按 CJK≈1 / ASCII≈0.70 估算文本宽度单位（微软雅黑实测拉丁字符约 0.55–0.75）。"""
    return sum(1.0 if ord(ch) > 0x2E7F else 0.70 for ch in str(s or ""))


def _cell_lines(u, usable, fs):
    return max(1, math.ceil(u / ((usable * WIDTH_FACTOR) / fs)))


def _cell_height(u, usable, fs):
    """单元格所需高度：行数 * 字号 * 行高系数 + 上下边距 + 边框。"""
    return _cell_lines(u, usable, fs) * fs * LINE_FACTOR + CELL_MARGIN_Y + BORDER_H


def _two_col_row_h(lab0, val0, lab1, val1, vf):
    """双列行（放送/原创、原作/导演…）所需高度。标签用上限字号防折行。"""
    lfs = min(vf, LABEL_CAP)
    return max(
        _cell_height(_units(lab0), DETAIL_COL_WIDTHS[0] - CELL_MARGIN_X, lfs),
        _cell_height(_units(val0), DETAIL_COL_WIDTHS[1] - CELL_MARGIN_X, vf),
        _cell_height(_units(lab1), DETAIL_COL_WIDTHS[2] - CELL_MARGIN_X, lfs),
        _cell_height(_units(val1), DETAIL_COL_WIDTHS[3] - CELL_MARGIN_X, vf),
    )


def _row_heights(v, vf, lf, nrows):
    """详情表各行所需高度（px）。nrows=5 不含简介，nrows=6 含简介。"""
    hs = [
        _two_col_row_h("放送", v["weekday_time"], "是否原创", v["otype"], vf),
        _two_col_row_h("原作", v["source"], "导演", v["director"], vf),
        _two_col_row_h("脚本/构成", v["script"], "动画制作", v["studio"], vf),
    ]
    if nrows >= 4:
        hs.append(max(
            _cell_height(_units("主要声优"), DETAIL_COL_WIDTHS[0] - CELL_MARGIN_X, min(lf, LABEL_CAP)),
            _cell_height(_units(v["cast"]), MERGE_W - CELL_MARGIN_X, lf),
        ))
    if nrows >= 5:
        hs.append(max(
            _cell_height(_units("标签"), DETAIL_COL_WIDTHS[0] - CELL_MARGIN_X, min(lf, LABEL_CAP)),
            _cell_height(_units(v["tags"]), MERGE_W - CELL_MARGIN_X, lf),
        ))
    if nrows >= 6:
        hs.append(max(
            _cell_height(_units("简介"), DETAIL_COL_WIDTHS[0] - CELL_MARGIN_X, min(lf, LABEL_CAP)),
            _cell_height(_units(v["summary"]), MERGE_W - CELL_MARGIN_X, lf),
        ))
    return hs


def _fit_combo(v, nrows, min_vf=0, min_lf=0, budget=FIT_BUDGET):
    """找 (vf, lf) 使 nrows 行总高 <= budget；优先放大长文本字号（LF 优先，VF 次之）。"""
    best = None
    for lf in LF_SET:
        if lf < min_lf:
            continue
        for vf in VF_SET:
            if vf < min_vf:
                continue
            hs = _row_heights(v, vf, lf, nrows)
            if sum(hs) <= budget:
                if best is None or lf > best[1] or (lf == best[1] and vf > best[0]):
                    best = (vf, lf, hs)
                break
    return best


def _synopsis_height(v, sf):
    return max(
        _cell_height(_units("简介"), DETAIL_COL_WIDTHS[0] - CELL_MARGIN_X, sf),
        _cell_height(_units(v["summary"]), MERGE_W - CELL_MARGIN_X, sf),
    )


def _fit_synopsis(v, budget=FIT_BUDGET):
    for sf in SF_SET:
        if _synopsis_height(v, sf) <= budget:
            return sf
    return SF_SET[-1]


# ---------------- 详情页内容 ----------------
def _dedupe_script(s):
    """'笔安一幸 / 笔安一幸' 这类重复字段合并为一个。"""
    if not s or "/" not in s:
        return s
    parts = [p.strip() for p in s.split("/") if p.strip()]
    if len(parts) > 1 and len(set(parts)) == 1:
        return parts[0]
    return s


def _detail_values(item):
    vals = {}
    parts = [_clean_text(item.get("weekday", "")), _clean_text(item.get("time", ""))]
    wt = " ".join(p for p in parts if p)
    eps = _fmt_eps(item.get("eps"))
    if eps:
        wt += "　全%s话" % eps
    vals["weekday_time"] = _cap_width(wt or "—", DETAIL_CAP_WEEKDAY_TIME)
    o = item.get("original")
    if o is True:
        vals["otype"] = "原创"
    elif o is False:
        vals["otype"] = "改编"
    else:
        vals["otype"] = "未知"
    vals["source"] = _clean_text(item.get("source")) or "—"
    vals["director"] = _clean_text(item.get("director")) or "—"
    vals["script"] = _dedupe_script(_clean_text(item.get("script"))) or "—"
    vals["studio"] = _clean_text(item.get("studio")) or "—"
    vals["cast"] = _clean_text(item.get("cast")) or "—"
    vals["tags"] = _clean_text(item.get("tags")) or "—"
    r = item.get("rating")
    if r is None:
        vals["rating"] = "暂无评分"
    else:
        s = "%.1f 分（%d 人" % (r, item.get("rating_total") or 0)
        if item.get("rank"):
            s += "，排名 #%d" % item["rank"]
        s += "）"
        vals["rating"] = s
    vals["link"] = (item.get("bgm_url") or "").replace("https://", "") or "未找到对应条目"
    vals["summary"] = _clean_summary(item.get("summary")) or _fallback_summary(item)
    return vals


def _title_font_size(title):
    """按标题长度选择字号（px）：短标题大字号，长标题自动缩小防溢出。"""
    t = _clean_text(title)
    units = _units(t)
    if units <= 14:
        return 44
    if units <= 22:
        return 38
    if units <= 28:
        return 34
    return 28


def _page_title(x, i, extra=""):
    base = _clean_text(x.get("title")) or ("第 %d 部" % i)
    if extra:
        base += extra
    return _cap_width(base, 36)


def _score_card_spec(slide_no, item):
    r = item.get("rating")
    if r is None:
        score_t = "暂无评分"
    else:
        score_t = "%.1f 分（%d 人）" % (r, item.get("rating_total") or 0)
    if item.get("rank"):
        rank_t = "排名 #%d" % item["rank"]
    else:
        rank_t = "—"
    link = (item.get("bgm_url") or "").replace("https://", "").replace("bgm.tv/subject/", "bgm.tv/") or "未找到条目"
    values = [["Bangumi 评分"], [score_t], [rank_t], [link]]
    spec = {
        "slide": slide_no, "name": "评分卡 %s" % item.get("title", ""),
        "rows": 4, "columns": 1,
        "left": SCORE_CARD_POS["left"], "top": SCORE_CARD_POS["top"],
        "width": SCORE_CARD_POS["width"], "height": SCORE_CARD_POS["height"],
        "columnWidths": [SCORE_CARD_POS["width"]],
        "values": values,
        "styleOptions": {"headerRow": False, "bandedRows": False},
        "borders": {"style": "solid", "fill": C_BORDER, "width": 1},
        "rowHeights": [{"index": 0, "height": 32}, {"index": 1, "height": 36},
                       {"index": 2, "height": 32}, {"index": 3, "height": 30}],
    }
    spec.setdefault("blocks", []).append({
        "row": 0, "column": 0, "rowCount": 4, "columnCount": 1,
        "fill": C_WHITE,
        "textStyle": _cell_style(16, C_VALUE, align="center"),
    })
    spec["blocks"].append({
        "row": 0, "column": 0, "rowCount": 1, "columnCount": 1,
        "fill": C_LABEL_BG,
        "textStyle": _cell_style(18, C_LABEL, bold=True, align="center"),
    })
    spec["blocks"].append({
        "row": 1, "column": 0, "rowCount": 1, "columnCount": 1,
        "fill": C_WHITE,
        "textStyle": _cell_style(22, C_ACCENT, bold=True, align="center"),
    })
    return spec


def _detail_table_spec(slide_no, item, v, vf, lf, heights, include_summary=True):
    """原生详情表格，行高按估算写入；声优/标签/简介完整不截断。"""
    nrows = 6 if include_summary else 5
    values = [
        ["放送", v["weekday_time"], "是否原创", v["otype"]],
        ["原作", v["source"], "导演", v["director"]],
        ["脚本/构成", v["script"], "动画制作", v["studio"]],
        ["主要声优", v["cast"], "", ""],
        ["标签", v["tags"], "", ""],
    ]
    if include_summary:
        values.append(["简介", v["summary"], "", ""])
    spec = {
        "slide": slide_no, "name": "详情表 %s" % item.get("title", ""),
        "rows": nrows, "columns": 4,
        "left": CARD_POS["left"], "top": CARD_POS["top"],
        "width": CARD_POS["width"], "height": CARD_POS["height"],
        "columnWidths": DETAIL_COL_WIDTHS,
        "values": values,
        "styleOptions": {"headerRow": False, "bandedRows": False},
        "borders": {"style": "solid", "fill": C_BORDER, "width": 1},
        "rowHeights": [{"index": i, "height": round(h, 1)} for i, h in enumerate(heights)],
        "merges": [{"startRow": r, "endRow": r, "startColumn": 1, "endColumn": 3}
                   for r in range(3, nrows)],
        "cells": [],
    }
    lfs = min(vf, LABEL_CAP)
    for r in range(nrows):
        for c in range(4):
            if r >= 3 and c in (2, 3):
                continue  # 合并区只设锚点 (c=1)
            is_label = (c in (0, 2)) if r < 3 else (c == 0)
            fs = lfs if (r < 3 and is_label) else (lf if r >= 3 else vf)
            spec["cells"].append({
                "row": r, "col": c,
                "fill": C_LABEL_BG if is_label else C_WHITE,
                "style": _cell_style(fs, C_LABEL if is_label else C_VALUE,
                                     bold=is_label, align="left"),
            })
    return spec


def _synopsis_table_spec(slide_no, item, v, sf, height):
    """简介续页：1x2 表格（标签 + 完整简介）。"""
    spec = {
        "slide": slide_no, "name": "简介表 %s" % item.get("title", ""),
        "rows": 1, "columns": 2,
        "left": CARD_POS["left"], "top": CARD_POS["top"],
        "width": CARD_POS["width"], "height": height,
        "columnWidths": [DETAIL_COL_WIDTHS[0], MERGE_W],
        "values": [["简介", v["summary"]]],
        "styleOptions": {"headerRow": False, "bandedRows": False},
        "borders": {"style": "solid", "fill": C_BORDER, "width": 1},
        "rowHeights": [{"index": 0, "height": round(height, 1)}],
        "cells": [
            {"row": 0, "col": 0, "fill": C_LABEL_BG,
             "style": _cell_style(sf, C_LABEL, bold=True, align="left")},
            {"row": 0, "col": 1, "fill": C_WHITE,
             "style": _cell_style(sf, C_VALUE, align="left", valign="top")},
        ],
    }
    return spec


def _add_cover(images, charts_dir, slide_no, x, i):
    cover_png = os.path.join(charts_dir, "cover_%s.png" % (x.get("bgm_id") or i))
    cover = tpl.open_cover(x.get("bgm_id"), x.get("image_url"), logger=None)
    if cover:
        canvas = Image.new('RGB', (COVER_POS['width'], COVER_POS['height']), tpl._hex(tpl.WHITE))
        tpl.paste_cover(canvas, cover, (0, 0, COVER_POS['width'], COVER_POS['height']))
        canvas.save(cover_png, 'PNG')
    else:
        tpl.render_cover_placeholder(cover_png, COVER_POS["width"], COVER_POS["height"])
    images.append({
        "slide": slide_no, "path": tpl._fwd(cover_png), "alt": "封面 %s" % x.get("title", ""),
        "left": COVER_POS["left"], "top": COVER_POS["top"],
        "width": COVER_POS["width"], "height": COVER_POS["height"],
    })


def _overview_lines(items):
    total = len(items)
    matched = sum(1 for x in items if x.get("bgm_id"))
    originals = sum(1 for x in items if x.get("original") is True)
    adapted = sum(1 for x in items if x.get("original") is False)
    rated = sum(1 for x in items if x.get("rating") is not None)
    wd_order = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    wd_count = {}
    for x in items:
        wd = x.get("weekday") or "未知"
        wd_count[wd] = wd_count.get(wd, 0) + 1
    dist = "、".join("%s %d 部" % (wd, wd_count[wd]) for wd in wd_order if wd_count.get(wd))
    if wd_count.get("未知"):
        dist += "、未知 %d 部" % wd_count["未知"]
    lines = [
        "收录作品：%d 部（yuc.wiki 季度页全量）" % total,
        "匹配 Bangumi：%d 部 · 未匹配 %d 部" % (matched, total - matched),
        "原创动画：%d 部 · 改编动画：%d 部" % (originals, adapted),
        "已有评分：%d 部（Bangumi 实时数据）" % rated,
        "排序：按热度（评分人数）从高到低",
        "放送分布：%s" % dist,
    ]
    return "\n".join(lines)


def build(yuc_data, bgm_items, year, start_month, out_path, generated_at=None):
    generated_at = generated_at or datetime.date.today().isoformat()
    label = season_label(year, start_month)
    skey = season_key(year, start_month)
    items = list(bgm_items)
    items.sort(key=lambda x: (-(x.get("rating_total") or 0),
                              -(x.get("rating") or 0), x.get("title", "")))
    logger = setup_logging()
    work_root = os.path.join(RUNTIME_DIR, "info_work", skey)
    os.makedirs(work_root, exist_ok=True)
    charts_dir = os.path.join(work_root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    n_total = len(items)
    n_table_pages = (n_total + CHUNK - 1) // CHUNK

    images = []
    tables = []
    notes = [
        "%s新番信息全收录。\n[Sources] 数据来源：yuc.wiki 季度页 + Bangumi API v0（bgm.tv）；生成日期 %s。"
        % (label, generated_at),
        "季度统计总览：收录/匹配/原创/改编/评分/放送分布。\n[Sources] 数据来源：yuc.wiki 季度页 + Bangumi API v0；缓存 bangumi_%s.json。"
        % skey,
    ]
    edits = [
        {"slide": 1, "name": "Title 23", "text": "%s\n新番信息" % label,
         "fontSize": 44, "lineSpacing": 1.0},
        {"slide": 1, "name": "Subtitle 10",
         "text": "日本 TV 动画 · 季度新番全收录 · %s" % generated_at,
         "fontSize": 18, "lineSpacing": 1.0},
        {"slide": 2, "name": "Title 1", "text": "季度统计总览"},
        {"slide": 2, "name": "Footer Placeholder 2", "text": "%s动画季" % label},
        {"slide": 2, "name": "Content Placeholder 4", "text": _overview_lines(items),
         "fontSize": 28, "lineSpacing": 1.05},
    ]

    # ---- 一览表页（原生表格）----
    all_rows = _table_rows(items)
    slide_no = 3
    for idx in range(n_table_pages):
        chunk_rows = all_rows[idx * CHUNK:(idx + 1) * CHUNK]
        tables.append(_overview_table_spec(slide_no, chunk_rows, idx))
        edits += [
            {"slide": slide_no, "name": "Title 3",
             "text": "新番一览表（%d/%d）" % (idx + 1, n_table_pages)},
            {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
        ]
        notes.append("新番一览表（%d/%d），按热度（评分人数）从高到低。\n[Sources] yuc.wiki 季度页；Bangumi 详情。"
                     % (idx + 1, n_table_pages))
        slide_no += 1

    # ---- 每部番详情页（封面图 + 原生详情表格；每部一页，放不下自动缩字号）----
    n_detail_pages = 0
    for i, x in enumerate(items, start=1):
        v = _detail_values(x)
        fit = _fit_combo(v, 6)
        if fit is None:
            # 极端兜底（正常数据不会走到）：最小字号仍放不下才拆简介续页
            m = _fit_combo(v, 5, budget=MAIN_BUDGET) or _fit_combo(v, 5, budget=MAIN_BUDGET)
            if m is None:
                raise RuntimeError("表格放不下：%s" % x.get("title", ""))
            tables.append(_detail_table_spec(slide_no, x, v, m[0], m[1], m[2], False))
            tables.append(_score_card_spec(slide_no, x))
            _add_cover(images, charts_dir, slide_no, x, i)
            title_main = _page_title(x, i)
            edits += [
                {"slide": slide_no, "name": "Title 3",
                 "text": title_main, "fontSize": _title_font_size(title_main),
                 "lineSpacing": 1.0},
                {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
            ]
            notes.append("第 %d/%d 部新番详情（主表）：放送、是否原创、原作、导演、脚本、制作、声优、标签；评分卡在封面下方。\n[Sources] Bangumi 条目详情（bgm.tv）。"
                         % (i, n_total))
            slide_no += 1
            n_detail_pages += 1
            sf = _fit_synopsis(v)
            height = _synopsis_height(v, sf)
            tables.append(_synopsis_table_spec(slide_no, x, v, sf, height))
            title_syn = _page_title(x, i, "（简介续）")
            edits += [
                {"slide": slide_no, "name": "Title 3",
                 "text": title_syn, "fontSize": _title_font_size(title_syn),
                 "lineSpacing": 1.0},
                {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
            ]
            notes.append("第 %d/%d 部新番简介（续）：完整中文简介。\n[Sources] Bangumi 条目详情（bgm.tv）。"
                         % (i, n_total))
            slide_no += 1
            n_detail_pages += 1
            continue
        # 单页：完整表格（含简介），字号按需缩小，信息不截断
        tables.append(_detail_table_spec(slide_no, x, v, fit[0], fit[1], fit[2], True))
        tables.append(_score_card_spec(slide_no, x))
        _add_cover(images, charts_dir, slide_no, x, i)
        edits += [
            {"slide": slide_no, "name": "Title 3",
             "text": _page_title(x, i), "fontSize": _title_font_size(_page_title(x, i)),
             "lineSpacing": 1.0},
            {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
        ]
        notes.append("第 %d/%d 部新番详情：放送、是否原创、原作、导演、脚本、制作、声优、标签、简介（完整不截断，字号按需缩小）；评分卡在封面下方。\n[Sources] Bangumi 条目详情（bgm.tv）。"
                     % (i, n_total))
        slide_no += 1
        n_detail_pages += 1

    # ---- 感谢页 ----
    last_slide = slide_no
    edits += [
        {"slide": last_slide, "name": "Title 1", "text": "感谢观看"},
        {"slide": last_slide, "name": "Text Placeholder 2",
         "text": "%s新番信息 · 自动生成\n数据来源：yuc.wiki + Bangumi\n生成日期：%s" % (label, generated_at),
         "fontSize": 22, "lineSpacing": 1.1},
    ]
    notes.append("感谢观看。\n[Sources] 数据来源：yuc.wiki + Bangumi；自动生成于 %s。" % generated_at)

    n_content_pages = n_table_pages + n_detail_pages
    result = tpl.build_deck(out_path, edits, images, notes, logger=logger,
                            work_root=work_root, n_content_pages=n_content_pages,
                            tables=tables)
    tpl.move_shape_top_from_pptx(out_path, "Title 3", TITLE_TOP)
    tpl.strip_shapes_from_pptx(out_path, ["Text Placeholder 4", "Text Placeholder 5",
                                          "Text Placeholder 6", "Text Placeholder 7",
                                          "Text Placeholder 8", "Text Placeholder 9"])
    return result


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description="生成模板版新番信息 PPT（原生表格，信息完整）")
    parser.add_argument("--season", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--date", help="YYYY-MM-DD")
    parser.add_argument("--data", help="bangumi json 缓存路径")
    args = parser.parse_args()
    sy, sm = int(args.season[:4]), int(args.season[5:7])
    if not args.data:
        for _cand in ("bangumi_%s.json" % args.season.replace("-", ""),
                      "bangumi_%s.json" % args.season):
            _p = os.path.join(RUNTIME_DIR, "data", _cand)
            if os.path.exists(_p):
                args.data = _p
                break
    data = json.load(open(args.data or os.path.join(RUNTIME_DIR, "data",
                                                    "bangumi_%s.json" % args.season.replace("-", "")),
                          encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("items", data.get("subjects", []))
    result = build([], items, sy, sm, args.out, generated_at=args.date)
    print(json.dumps(result, ensure_ascii=False, indent=2))