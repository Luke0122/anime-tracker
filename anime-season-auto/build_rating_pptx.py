# -*- coding: utf-8 -*-
"""生成季度评分汇总 PPT（Project Status Report 模板版）。

结构：封面(源1) → 分档统计(源2) → 评分总表(源8 克隆 x N) →
Top10 亮点(源8 克隆，封面网格) → 感谢页(源11)。
表格与 Top10 网格用 Pillow 渲染成 PNG 后由 build_deck.mjs 插入。
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RUNTIME_DIR, season_key, season_label, setup_logging
import template_pptx as tpl

CHUNK = 14
TABLE_PAD = 14
TITLE_TOP = 88
TABLE_COL_WIDTHS = [84, 560, 100, 130, 110, 180]
GRID_POS = {"left": 44, "top": 180, "width": 1192, "height": 500}
TABLE_POS = {"left": 44, "top": 180,
             "width": sum(TABLE_COL_WIDTHS) + TABLE_PAD * 2, "height": 0}


def _dedupe_top(rated, limit=10):
    best = {}
    for x in rated:
        bid = x.get("bgm_id")
        key = ("b", bid) if bid else ("n", x.get("title", ""))
        cur = best.get(key)
        if cur is None:
            best[key] = x
            continue

        def tk(t):
            t = t or ""
            return (1 if "#" in t else 0, -len(t))
        if tk(x.get("title", "")) < tk(cur.get("title", "")):
            best[key] = x
    vals = list(best.values())
    vals.sort(key=lambda x: (-(x.get("rating") or 0), -(x.get("rating_total") or 0)))
    return vals[:limit]


def _sorted_items(items):
    rated = [x for x in items if x.get("rating") is not None]
    unrated = [x for x in items if x.get("rating") is None]
    rated.sort(key=lambda x: (-(x.get("rating") or 0), -(x.get("rating_total") or 0)))
    return rated, unrated


def _overview_lines(items, phase_label):
    rated, unrated = _sorted_items(items)
    n9 = sum(1 for x in rated if x["rating"] >= 9.0)
    n8 = sum(1 for x in rated if 8.0 <= x["rating"] < 9.0)
    n7 = sum(1 for x in rated if 7.0 <= x["rating"] < 8.0)
    nlow = sum(1 for x in rated if x["rating"] < 7.0)
    avg = (sum(x["rating"] for x in rated) / len(rated)) if rated else 0.0
    best = rated[0] if rated else None
    lines = [
        "%s评分汇总 · 已评分 %d 部 · 暂无 %d 部" % (phase_label, len(rated), len(unrated)),
        "9.0 及以上：%d 部 · 8.0–8.9：%d 部" % (n9, n8),
        "7.0–7.9：%d 部 · 7.0 以下：%d 部" % (n7, nlow),
        "平均分：%.2f · 最高：%s" % (avg, ("%s %.1f 分" % (best["title"], best["rating"])) if best else "—"),
        "评分随季度推进更新（初期/中期/末期快照）",
    ]
    return "\n".join(lines)


def _table_rows(items):
    rated, unrated = _sorted_items(items)
    ordered = []
    for i, x in enumerate(rated, start=1):
        ordered.append([
            i, x.get("title", ""), "%.1f" % x["rating"],
            x.get("rating_total") or 0, x.get("weekday", ""), x.get("time", ""),
        ])
    for x in unrated:
        ordered.append(["—", x.get("title", ""), "暂无评分", "—",
                        x.get("weekday", ""), x.get("time", "")])
    return ordered


def _pick_table_font(rows, col_widths, cap=21):
    """选最大字号，使所有单元格文本在列宽内放得下（用真实字体测量）。"""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(img)
    for F in range(cap, 13, -1):
        ok = True
        for row in rows:
            for j, val in enumerate(row):
                f = tpl._font(F)
                if tpl._text_w(d, str(val), f) > col_widths[j] - TABLE_PAD * 2:
                    ok = False
                    break
            if not ok:
                break
        if ok:
            return F
    return 13


def _rating_notes(label, skey, phase_label, generated_at, n_pages):
    src = "数据来源：Bangumi 评分（bgm.tv）"
    notes = [
        "%s评分汇总（%s）。\n[Sources] %s；生成日期 %s。" % (label, phase_label, src, generated_at),
        "分档统计：9+/8–8.9/7–7.9/<7/暂无/平均分。\n[Sources] %s；缓存 bangumi_%s.json。" % (src, skey),
    ]
    for i in range(n_pages):
        notes.append("评分总表（%d/%d），按评分降序，暂无评分列末尾。\n[Sources] %s。" % (i + 1, n_pages, src))
    notes.append("高分亮点 Top 10：全部已评分作品去重后按评分排序。\n[Sources] %s。" % src)
    notes.append("感谢观看。\n[Sources] %s；自动生成于 %s。" % (src, generated_at))
    return notes


def build(bgm_items, year, start_month, phase_label, out_path, generated_at=None):
    generated_at = generated_at or datetime.date.today().isoformat()
    label = season_label(year, start_month)
    skey = season_key(year, start_month)
    items = list(bgm_items)
    logger = setup_logging()
    work_root = os.path.join(RUNTIME_DIR, "rating_work", skey)
    os.makedirs(work_root, exist_ok=True)
    charts_dir = os.path.join(work_root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    ordered = _table_rows(items)
    n_pages = (len(ordered) + CHUNK - 1) // CHUNK
    n_content = n_pages + 1

    table_font = _pick_table_font(ordered, TABLE_COL_WIDTHS)
    table_row_h = int(table_font * 1.5)
    table_header_h = int(table_font * 2.0)
    table_h = TABLE_PAD * 2 + table_header_h + CHUNK * table_row_h
    table_pos = dict(TABLE_POS, height=table_h)

    images = []
    edits = [
        {"slide": 1, "name": "Title 23", "text": "%s\n评分汇总（%s）" % (label, phase_label),
         "fontSize": 52, "lineSpacing": 1.0},
        {"slide": 1, "name": "Subtitle 10",
         "text": "日本 TV 动画 · 本季评分跟踪 · %s" % generated_at,
         "fontSize": 18, "lineSpacing": 1.0},
        {"slide": 2, "name": "Title 1", "text": "分档统计"},
        {"slide": 2, "name": "Footer Placeholder 2", "text": "%s动画季" % label},
        {"slide": 2, "name": "Content Placeholder 4",
         "text": _overview_lines(items, phase_label)},
    ]

    slide_no = 3
    for idx in range(n_pages):
        chunk_rows = ordered[idx * CHUNK:(idx + 1) * CHUNK]
        png = os.path.join(charts_dir, "rating_%02d.png" % (idx + 1))
        tpl.render_table(
            png,
            ["排名", "标题", "评分", "评分人数", "星期", "时间"],
            chunk_rows,
            TABLE_COL_WIDTHS,
            font_size=table_font, row_h=table_row_h, header_h=table_header_h,
            score_col=2, align_cols={0: "center", 2: "center", 3: "center",
                                     4: "center", 5: "center"},
        )
        images.append({
            "slide": slide_no, "path": tpl._fwd(png), "alt": "评分总表 %d" % (idx + 1),
            "left": table_pos["left"], "top": table_pos["top"],
            "width": table_pos["width"], "height": table_pos["height"],
        })
        edits += [
            {"slide": slide_no, "name": "Title 3",
             "text": "评分总表（%d/%d）" % (idx + 1, n_pages)},
            {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
            {"slide": slide_no, "name": "Text Placeholder 4", "text": "评分总表"},
            {"slide": slide_no, "name": "Text Placeholder 6",
             "text": "按评分降序 · 暂无评分列末尾"},
            {"slide": slide_no, "name": "Text Placeholder 5", "text": "分档说明"},
            {"slide": slide_no, "name": "Text Placeholder 7",
             "text": "9+ / 8+ / 7+ / <7 分档见总览页"},
            {"slide": slide_no, "name": "Text Placeholder 8", "text": "数据来源"},
            {"slide": slide_no, "name": "Text Placeholder 9",
             "text": "Bangumi 实时评分（bgm.tv）"},
        ]
        slide_no += 1

    # Top10 亮点页
    rated, _ = _sorted_items(items)
    top = _dedupe_top(rated, 10)
    grid_png = os.path.join(charts_dir, "top10.png")
    tpl.render_top_grid(grid_png, top, w=GRID_POS["width"], h=GRID_POS["height"], logger=logger)
    images.append({
        "slide": slide_no, "path": tpl._fwd(grid_png), "alt": "高分亮点 Top 10",
        "left": GRID_POS["left"], "top": GRID_POS["top"],
        "width": GRID_POS["width"], "height": GRID_POS["height"],
    })
    edits += [
        {"slide": slide_no, "name": "Title 3", "text": "高分亮点（Top 10）"},
        {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
        {"slide": slide_no, "name": "Text Placeholder 4", "text": "选取范围"},
        {"slide": slide_no, "name": "Text Placeholder 6",
         "text": "全部已评分作品 · 去重后按评分排序取前 10"},
        {"slide": slide_no, "name": "Text Placeholder 5", "text": "评分口径"},
        {"slide": slide_no, "name": "Text Placeholder 7",
         "text": "Bangumi 实时评分 · 附评分人数"},
        {"slide": slide_no, "name": "Text Placeholder 8", "text": "数据来源"},
        {"slide": slide_no, "name": "Text Placeholder 9",
         "text": "Bangumi 评分快照 %s" % generated_at},
    ]
    slide_no += 1

    last_slide = slide_no
    edits += [
        {"slide": last_slide, "name": "Title 1", "text": "感谢观看"},
        {"slide": last_slide, "name": "Text Placeholder 2",
         "text": "%s评分汇总（%s）· 自动生成\n数据来源：Bangumi（bgm.tv）\n生成日期：%s" % (label, phase_label, generated_at),
         "fontSize": 18, "lineSpacing": 1.1},
    ]

    notes = _rating_notes(label, skey, phase_label, generated_at, n_pages)
    result = tpl.build_deck(out_path, edits, images, notes, logger=logger,
                            work_root=work_root, n_content_pages=n_content)
    tpl.move_shape_top_from_pptx(out_path, "Title 3", TITLE_TOP)
    tpl.strip_shapes_from_pptx(out_path, ["Text Placeholder 4", "Text Placeholder 5",
                                          "Text Placeholder 6", "Text Placeholder 7",
                                          "Text Placeholder 8", "Text Placeholder 9"])
    return result


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description="生成模板版评分汇总 PPT")
    parser.add_argument("--season", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--phase", default="补做")
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
    result = build(items, sy, sm, args.phase, args.out, generated_at=args.date)
    print(json.dumps(result, ensure_ascii=False, indent=2))