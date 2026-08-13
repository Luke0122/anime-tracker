# -*- coding: utf-8 -*-
"""季末评分趋势复盘 PPT：读取评分历史，生成折线图，用 Project Status Report 模板排版。

流程：
1. 读取 _runtime/data/rating_history_<季>.json
2. 按“末期评分 Top20 ∪ 评分人数 Top10”选取候选（最多 30 部）
3. 用 Pillow 渲染平均分宽图 + 每部番迷你折线图 PNG
4. 写 template-frame-map.json（封面/总览/平均分页/折线图页xN/致谢）
5. 调 prepare_template_starter_deck.mjs 生成 template-starter.pptx
6. 调 build_trend.mjs 改写文本、插入图表、导出最终 PPTX
"""
import datetime
import json
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import add_months, load_json, RUNTIME_DIR, season_key, season_label, setup_logging
import rating_history

# ---- 常量 ----
ACCENT = "#753F2C"      # 模板 accent1
ACCENT2 = "#637376"     # 模板 accent2
DARK = "#3B4546"        # 模板 dk2
GRID = "#E7E6E6"        # 模板 lt2
GRAY = "#8A8F98"

MINI_W, MINI_H = 292, 140
WIDE_W, WIDE_H = 1220, 140
AVG_POS = {"left": 30, "top": 560, "width": WIDE_W, "height": WIDE_H}
MINI_X0, MINI_Y, MINI_GAP = 26, 560, 20
MAX_CANDIDATES = 30
CHUNK = 4

PPT_TOOL = os.environ.get("ANIME_PPT_TOOL") or os.path.join(RUNTIME_DIR, "ppt_tool")
NODE = os.path.join(PPT_TOOL, "node.exe")
REFERENCE = os.path.join(PPT_TOOL, "reference.pptx")
PREPARE = os.path.join(PPT_TOOL, "tools", "template_following_scripts", "prepare_template_starter_deck.mjs")
INSPECT = os.path.join(PPT_TOOL, "template-inspect", "template-inspect.ndjson")
BUILD_MJS = os.environ.get("ANIME_TREND_MJS") or os.path.join(PPT_TOOL, "build_trend.mjs")


def _font(size, bold=False):
    cands = []
    if bold:
        cands.append(r"C:\Windows\Fonts\msyhbd.ttc")
    cands += [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              r"C:\Windows\Fonts\simsun.ttc"]
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


# ---- 候选与统计 ----
def select_candidates(hist):
    """末期评分 Top20 ∪ 评分人数 Top10，按 bgm_id 去重，按末期评分降序，最多 30 部。"""
    snapshots = hist.get("snapshots") or {}
    if not snapshots:
        raise RuntimeError("评分历史为空，无法生成趋势复盘")
    end_date = sorted(snapshots.keys())[-1]
    end_snap = snapshots[end_date] or {}
    rated = [r for r in end_snap.values() if r.get("rating") is not None]
    by_rating = sorted(rated, key=lambda r: (-(r.get("rating") or 0), -(r.get("rating_total") or 0)))
    by_count = sorted(rated, key=lambda r: (-(r.get("rating_total") or 0), -(r.get("rating") or 0)))
    top_rating = by_rating[:20]
    top_count = by_count[:10]
    seen = set()
    union = []
    for r in list(top_rating) + list(top_count):
        bid = r.get("bgm_id")
        if bid is None or bid in seen:
            continue
        seen.add(bid)
        union.append(r)
    union.sort(key=lambda r: (-(r.get("rating") or 0), -(r.get("rating_total") or 0)))
    union = union[:MAX_CANDIDATES]
    if len(union) < 12:
        union = top_rating[:20]
    return end_date, union


def _points_for(hist, bid):
    dates = sorted((hist.get("snapshots") or {}).keys())
    pts = []
    for d in dates:
        rec = (hist["snapshots"][d] or {}).get(str(bid))
        if rec and rec.get("rating") is not None:
            pts.append((d, float(rec["rating"])))
    return pts


def _avg_points(hist):
    dates = sorted((hist.get("snapshots") or {}).keys())
    out = []
    for d in dates:
        vals = [r.get("rating") for r in (hist["snapshots"][d] or {}).values()
                if r.get("rating") is not None]
        if vals:
            out.append((d, sum(vals) / len(vals)))
    return out


def _phase_label(sy, sm, date_str):
    d = datetime.date.fromisoformat(date_str)
    early = datetime.date(sy, sm, 20)
    mid_y, mid_m = add_months(sy, sm, 1)
    mid = datetime.date(mid_y, mid_m, 20)
    end_y, end_m = add_months(sy, sm, 3)
    end = datetime.date(end_y, end_m, 5)
    if d == early:
        return "初期"
    if d == mid:
        return "中期"
    if d == end:
        return "末期"
    if d > end:
        return "末期"
    return "补做"


def _x_label(date_str, phase=None):
    d = datetime.date.fromisoformat(date_str)
    p = phase or ""
    return "%d/%d%s" % (d.month, d.day, (" " + p) if p else "")


# ---- 折线图渲染 ----
def _truncate_text(draw, text, font, max_px):
    if draw.textlength(text, font=font) <= max_px:
        return text
    while text and draw.textlength(text + "…", font=font) > max_px:
        text = text[:-1]
    return text + "…"


def render_mini(path, title, pts, dates, end_score):
    """292x140 迷你折线图：标题(番名+末期分) + 0-10 坐标线 + 各快照点连线。"""
    img = Image.new("RGB", (MINI_W, MINI_H), "white")
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, MINI_W - 1, MINI_H - 1], radius=8, fill="white", outline=GRID)
    tf = _font(13, bold=True)
    shown = _truncate_text(draw, str(title), tf, MINI_W - 40)
    draw.text((12, 8), "%s  %.1f分" % (shown, end_score), font=tf, fill=DARK)

    left, right, top, bottom = 40, 282, 32, 124

    def y_of(v):
        return bottom - (max(0.0, min(10.0, v)) / 10.0) * (bottom - top)

    gf = _font(9)
    for gv in (0, 2, 4, 6, 8, 10):
        gy = y_of(gv)
        draw.line([(left, gy), (right, gy)], fill=GRID, width=1)
    draw.text((6, y_of(0) - 5), "0", font=gf, fill=GRAY)
    draw.text((4, y_of(10) - 5), "10", font=gf, fill=GRAY)

    xstep = (right - left) / max(1, len(dates) - 1) if len(dates) > 1 else 0
    xs = {}
    for i, d in enumerate(dates):
        xs[d] = left + i * xstep if xstep else left + (right - left) / 2

    line_pts = []
    for d, v in pts:
        line_pts.append((xs[d], y_of(v)))
    if len(line_pts) >= 2:
        draw.line(line_pts, fill=ACCENT, width=2, joint="curve")
    for d, v in pts:
        r = 3
        draw.ellipse([xs[d] - r, y_of(v) - r, xs[d] + r, y_of(v) + r], fill=ACCENT2, outline="white")

    xf = _font(8)
    for d in dates:
        lab = _x_label(d)
        w = draw.textlength(lab, font=xf)
        draw.text((xs[d] - w / 2, bottom + 5), lab, font=xf, fill=GRAY)
    img.save(path, "PNG")


def render_avg(path, avg_pts, sy, sm):
    """1220x140 全季平均评分走势图。"""
    img = Image.new("RGB", (WIDE_W, WIDE_H), "white")
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, WIDE_W - 1, WIDE_H - 1], radius=8, fill="white", outline=GRID)
    tf = _font(15, bold=True)
    draw.text((18, 10), "全季平均评分", font=tf, fill=DARK)

    left, right, top, bottom = 130, 1190, 34, 118

    def y_of(v):
        return bottom - (max(0.0, min(10.0, v)) / 10.0) * (bottom - top)

    gf = _font(10)
    for gv in (0, 2, 4, 6, 8, 10):
        gy = y_of(gv)
        draw.line([(left, gy), (right, gy)], fill=GRID, width=1)
        draw.text((left - 34, gy - 6), str(gv), font=gf, fill=GRAY)

    dates = [d for d, _ in avg_pts]
    xstep = (right - left) / max(1, len(dates) - 1) if len(dates) > 1 else 0
    xs = []
    for i, d in enumerate(dates):
        xs.append(left + i * xstep if xstep else left + (right - left) / 2)

    line_pts = [(xs[i], y_of(v)) for i, (_, v) in enumerate(avg_pts)]
    if len(line_pts) >= 2:
        draw.line(line_pts, fill=ACCENT, width=3, joint="curve")
    vf = _font(11, bold=True)
    for i, (d, v) in enumerate(avg_pts):
        r = 4
        cx, cy = xs[i], y_of(v)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT2, outline="white")
        lab = "%.2f" % v
        lw = draw.textlength(lab, font=vf)
        draw.text((cx - lw / 2, cy - 20), lab, font=vf, fill=ACCENT)

    xf = _font(10)
    for i, d in enumerate(dates):
        lab = _x_label(d, _phase_label(sy, sm, d))
        lw = draw.textlength(lab, font=xf)
        draw.text((xs[i] - lw / 2, bottom + 6), lab, font=xf, fill=DARK)
    img.save(path, "PNG")


# ---- frame map / data json ----
S1_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/p8jyx83q"]},
              {"action": "rewrite", "shapeIds": ["sh/hsvat0fa"]}]
S2_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/6987itcr"]},
              {"action": "rewrite", "shapeIds": ["sh/7a18rydc"]},
              {"action": "keep", "shapeIds": ["sh/k7qpgjul"]},
              {"action": "rewrite", "shapeIds": ["sh/58zqpov6"]}]
S3_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/mt83e1or"]},
              {"action": "rewrite", "shapeIds": ["sh/but03e5c"]},
              {"action": "rewrite", "shapeIds": ["sh/nuh47m5c"]},
              {"action": "rewrite", "shapeIds": ["sh/wza5kb6t"]},
              {"action": "rewrite", "shapeIds": ["sh/xkjmdgne"]},
              {"action": "rewrite", "shapeIds": ["sh/axsni1o3"]},
              {"action": "keep", "shapeIds": ["sh/q9kzu94r"]}]
S8_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/ov6x0761"]},
              {"action": "rewrite", "shapeIds": ["sh/e54vudoz"]},
              {"action": "rewrite", "shapeIds": ["sh/9wfetcnm"]},
              {"action": "rewrite", "shapeIds": ["sh/nuxwr25g"]},
              {"action": "rewrite", "shapeIds": ["sh/mtofyxov"]},
              {"action": "rewrite", "shapeIds": ["sh/wzqx476x"]},
              {"action": "rewrite", "shapeIds": ["sh/x0zexcni"]},
              {"action": "rewrite", "shapeIds": ["sh/1gr2hofm"]},
              {"action": "keep", "shapeIds": ["sh/z6xwni5k"]}]
S11_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/a18jyds3"]},
               {"action": "rewrite", "shapeIds": ["sh/v2hkryto"]}]


def build_frame_map(n_pages):
    out = []
    out.append({"outputSlide": 1, "sourceSlide": 1, "narrativeRole": "opening thesis",
                "reuseMode": "duplicate-slide", "editTargets": S1_TARGETS})
    out.append({"outputSlide": 2, "sourceSlide": 2, "narrativeRole": "status summary",
                "reuseMode": "duplicate-slide", "editTargets": S2_TARGETS})
    out.append({"outputSlide": 3, "sourceSlide": 3, "narrativeRole": "analysis",
                "reuseMode": "duplicate-slide", "editTargets": S3_TARGETS})
    for i in range(n_pages):
        out.append({"outputSlide": 4 + i, "sourceSlide": 8, "narrativeRole": "chart",
                    "reuseMode": "duplicate-slide", "editTargets": S8_TARGETS})
    out.append({"outputSlide": 4 + n_pages, "sourceSlide": 11, "narrativeRole": "closing contact",
                "reuseMode": "duplicate-slide", "editTargets": S11_TARGETS})
    return {"outputSlides": out, "omittedSourceSlides": [
        {"sourceSlide": 4, "reason": "评分分档页不需要"},
        {"sourceSlide": 5, "reason": "日程页不需要"},
        {"sourceSlide": 6, "reason": "交付物页不需要"},
        {"sourceSlide": 7, "reason": "成本页不需要"},
        {"sourceSlide": 9, "reason": "资源页不需要"},
        {"sourceSlide": 10, "reason": "下次复核页不需要"},
    ]}


def _summary_lines(hist, end_date, n_total, cands, avg):
    lines = ["本季收录：%d 部（全部匹配 Bangumi 条目）" % n_total,
             "趋势候选：%d 部（末期评分 Top20 ∪ 热度 Top10）" % len(cands)]
    if avg:
        lines.append("平均分走势：%s" % " → ".join("%.2f" % v for _, v in avg))
    best = cands[0] if cands else None
    if best:
        lines.append("末期最高：%s %.1f 分" % (best.get("title", ""), best.get("rating") or 0))
    return "\n".join(lines)


def build(sy, sm, out_path, generated_at=None, logger=None, work_root=None):
    generated_at = generated_at or datetime.date.today().isoformat()
    logger = logger or setup_logging()
    label = season_label(sy, sm)
    skey = season_key(sy, sm)
    hist = rating_history.load_history(sy, sm)
    end_date, cands = select_candidates(hist)
    dates = rating_history.snapshot_dates(hist)
    avg = _avg_points(hist)
    n_total = len((hist.get("snapshots") or {}).get(end_date) or {})
    n_pages = max(1, math.ceil(len(cands) / CHUNK))
    logger.info("趋势复盘：%s 候选 %d 部，折线图页 %d 页，快照点 %s",
                label, len(cands), n_pages, ",".join(dates))

    work_root = work_root or os.path.join(RUNTIME_DIR, "trend_work", skey)
    charts_dir = os.path.join(work_root, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    # 渲染图表
    avg_png = os.path.join(charts_dir, "avg.png")
    render_avg(avg_png, avg, sy, sm)
    charts = [{"slide": 3, "path": _fwd(avg_png), "alt": "全季平均评分走势",
               "left": AVG_POS["left"], "top": AVG_POS["top"],
               "width": AVG_POS["width"], "height": AVG_POS["height"]}]

    edits = [
        {"slide": 1, "name": "Title 23", "text": "%s\n评分趋势复盘" % label,
         "fontSize": 66, "lineSpacing": 1.0},
        {"slide": 1, "name": "Subtitle 10", "text": "yuc.wiki · Bangumi · 季末复盘 %s" % end_date,
         "fontSize": 20, "lineSpacing": 1.0},
        {"slide": 2, "name": "Title 1", "text": "季末评分复盘"},
        {"slide": 2, "name": "Footer Placeholder 2", "text": "%s动画季" % label},
        {"slide": 2, "name": "Content Placeholder 4", "text": _summary_lines(hist, end_date, n_total, cands, avg)},
        {"slide": 3, "name": "Title 1", "text": "全季平均评分走势",
         "fontSize": 36, "lineSpacing": 1.0},
        {"slide": 3, "name": "Footer Placeholder 11", "text": "%s动画季" % label},
        {"slide": 3, "name": "Text Placeholder 2", "text": "平均分"},
        {"slide": 3, "name": "Text Placeholder 3", "text": "说明"},
        {"slide": 3, "name": "Text Placeholder 4",
         "text": "\n".join("%s（%s）：%.2f" % (_phase_label(sy, sm, d), _x_label(d), v)
                           for d, v in avg) or "暂无平均分"},
        {"slide": 3, "name": "Text Placeholder 5",
         "text": "以全部已评分作品计算\n折线图见下方\n单位：分（0–10）"},
    ]

    for idx in range(n_pages):
        slide_no = 4 + idx
        chunk = cands[idx * CHUNK:(idx + 1) * CHUNK]
        edits += [
            {"slide": slide_no, "name": "Title 3",
             "text": "热门/高分番评分走势（%d/%d）" % (idx + 1, n_pages)},
            {"slide": slide_no, "name": "Footer Placeholder 1", "text": "%s动画季" % label},
            {"slide": slide_no, "name": "Text Placeholder 4", "text": "图表说明"},
            {"slide": slide_no, "name": "Text Placeholder 6",
             "text": "每条折线代表一部番\n初期 → 中期 → 末期评分（0–10 分）",
             "fontSize": 16, "lineSpacing": 1.0},
            {"slide": slide_no, "name": "Text Placeholder 5", "text": "选取规则"},
            {"slide": slide_no, "name": "Text Placeholder 7",
             "text": "末期评分 Top20 ∪ 热度 Top10\n按末期评分降序，最多 30 部",
             "fontSize": 16, "lineSpacing": 1.0},
            {"slide": slide_no, "name": "Text Placeholder 8", "text": "数据来源"},
            {"slide": slide_no, "name": "Text Placeholder 9",
             "text": "Bangumi 评分快照（bgm.tv）\n%s" % end_date},
        ]
        for j, show in enumerate(chunk):
            bid = show.get("bgm_id")
            pts = _points_for(hist, bid)
            png = os.path.join(charts_dir, "show_%s.png" % bid)
            render_mini(png, show.get("title", ""), pts, dates, show.get("rating") or 0)
            charts.append({
                "slide": slide_no, "path": _fwd(png),
                "alt": show.get("title", ""),
                "left": MINI_X0 + j * (MINI_W + MINI_GAP),
                "top": MINI_Y, "width": MINI_W, "height": MINI_H,
            })

    last_slide = 4 + n_pages
    edits += [
        {"slide": last_slide, "name": "Title 1", "text": "感谢观看"},
        {"slide": last_slide, "name": "Text Placeholder 2",
         "text": "评分趋势季末复盘 · 自动生成\n数据来源：yuc.wiki + Bangumi\n生成日期：%s" % generated_at,
         "fontSize": 18, "lineSpacing": 1.1},
    ]

    notes = _build_notes(label, skey, end_date, n_total, cands, avg, n_pages, dates)

    frame_map = build_frame_map(n_pages)
    _write_json(os.path.join(work_root, "template-frame-map.json"), frame_map)
    data = {"edits": edits, "charts": charts, "notes": notes,
            "generated_at": generated_at, "end_date": end_date}
    data_path = os.path.join(work_root, "data.json")
    _write_json(data_path, data)

    starter = os.path.join(work_root, "template-starter.pptx")
    preview_dir = os.path.join(work_root, "template-starter-preview")
    layout_dir = os.path.join(work_root, "template-starter-layout")
    _run([NODE, PREPARE, "--workspace", work_root, "--pptx", REFERENCE,
          "--map", os.path.join(work_root, "template-frame-map.json"),
          "--out", starter, "--inspect", INSPECT,
          "--preview-dir", preview_dir, "--layout-dir", layout_dir], logger, ok_if_exists=starter)

    env = _node_env()
    env["TMP_DIR"] = work_root
    env["DATA_FILE"] = data_path
    env["FINAL_PPTX"] = out_path
    _run([NODE, BUILD_MJS], logger, env=env, ok_if_exists=out_path)

    if not os.path.exists(out_path):
        raise RuntimeError("趋势 PPT 未生成：%s" % out_path)
    logger.info("趋势 PPT 已生成：%s", out_path)
    return {
        "output": out_path, "end_date": end_date, "candidates": len(cands),
        "n_pages": n_pages, "avg": avg, "generated_at": generated_at,
        "label": label, "total": n_total, "sy": sy, "sm": sm, "dates": dates,
        "top": [{k: s.get(k) for k in ("bgm_id", "title", "rating", "rating_total")} for s in cands[:10]],
    }


def _build_notes(label, skey, end_date, n_total, cands, avg, n_pages, dates):
    src = "数据来源：yuc.wiki 季度页 + Bangumi API v0（bgm.tv）"
    notes = [
        "%s季末评分趋势复盘。\n[Sources] %s；评分历史 rating_history_%s.json。" % (label, src, skey),
        "候选规则：末期评分 Top20 ∪ 评分人数 Top10，按末期评分降序，最多 30 部；共 %d 部。\n[Sources] 本地评分历史。" % len(cands),
        "全季平均评分走势：%s。\n[Sources] 各快照点全部已评分作品均值。" % (" → ".join("%.2f" % v for _, v in avg) if avg else "暂无"),
    ]
    for i in range(n_pages):
        notes.append("第 %d/%d 页：候选番初期→中期→末期评分折线图（缺失点用现有数据连线）。\n[Sources] Bangumi 评分快照 %s。" % (i + 1, n_pages, end_date))
    notes.append("感谢观看。\n[Sources] %s；自动生成于 %s。" % (src, datetime.date.today().isoformat()))
    return notes


def _fwd(p):
    return p.replace("\\", "/")


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _node_env():
    env = os.environ.copy()
    env.setdefault("HOME", os.path.expanduser("~"))
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env["NODE_OPTIONS"] = env.get("NODE_OPTIONS", "")
    return env


def _run(cmd, logger, env=None, ok_if_exists=None):
    logger.info("运行：%s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env or _node_env())
    if proc.stdout.strip():
        logger.info("stdout: %s", proc.stdout.strip()[:2000])
    if proc.returncode != 0:
        if ok_if_exists and os.path.exists(ok_if_exists) and os.path.getsize(ok_if_exists) > 0:
            logger.warning("node 退出码异常(%s)但产物已生成，继续：%s", proc.returncode, ok_if_exists)
            return proc
        logger.error("stderr: %s", (proc.stderr or "")[:4000])
        raise RuntimeError("子进程失败：%s" % " ".join(cmd[:3]))
    return proc


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="生成季末评分趋势复盘 PPT")
    parser.add_argument("--season", required=True, help="季度 YYYY-MM")
    parser.add_argument("--out", required=True, help="输出 PPTX 路径")
    parser.add_argument("--date", help="生成日期 YYYY-MM-DD")
    args = parser.parse_args()
    sy, sm = int(args.season[:4]), int(args.season[5:7])
    summary = build(sy, sm, args.out, generated_at=args.date)
    print(json.dumps(summary, ensure_ascii=False, indent=2))