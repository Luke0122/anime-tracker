# -*- coding: utf-8 -*-
"""Project Status Report 模板共享排版工具。

负责：
1. 用 Pillow 把表格 / 详情卡 / Top10 网格渲染成 PNG（2x 超采样保证清晰）；
2. 生成 template-frame-map.json（封面/总览/内容页/致谢）；
3. 调 prepare_template_starter_deck.mjs 生成 template-starter.pptx；
4. 调 build_deck.mjs 改写文本、插入图片、导出最终 PPTX。
"""
import datetime
import json
import math
import os
import re
import subprocess
import sys
import zipfile

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RUNTIME_DIR, download_cover, setup_logging

# ---- 模板色板（Project Status Report）----
ACCENT = "#753F2C"
ACCENT2 = "#637376"
ACCENT3 = "#BE937E"
ACCENT4 = "#576853"
DARK = "#3B4546"
GRID = "#E7E6E6"
GRAY = "#8A8F98"
WHITE = "#FFFFFF"
ZEBRA = "#F6F4F2"
SCORE_HIGH = "#1E8E3E"
SCORE_MID = "#E8930C"
SCORE_LOW = "#9A9A9A"

SLIDE_W, SLIDE_H = 1280, 720

PPT_TOOL = os.environ.get("ANIME_PPT_TOOL") or os.path.join(RUNTIME_DIR, "ppt_tool")
NODE = os.path.join(PPT_TOOL, "node.exe")
REFERENCE = os.path.join(PPT_TOOL, "reference.pptx")
PREPARE = os.path.join(PPT_TOOL, "tools", "template_following_scripts",
                        "prepare_template_starter_deck.mjs")
INSPECT = os.path.join(PPT_TOOL, "template-inspect", "template-inspect.ndjson")
BUILD_MJS = os.environ.get("ANIME_DECK_MJS") or os.path.join(PPT_TOOL, "build_deck.mjs")

# ---- 模板各源页编辑目标（shape id 取自模板原版）----
S1_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/p8jyx83q"]},
              {"action": "rewrite", "shapeIds": ["sh/hsvat0fa"]}]
S2_TARGETS = [{"action": "rewrite", "shapeIds": ["sh/6987itcr"]},
              {"action": "rewrite", "shapeIds": ["sh/7a18rydc"]},
              {"action": "keep", "shapeIds": ["sh/k7qpgjul"]},
              {"action": "rewrite", "shapeIds": ["sh/58zqpov6"]}]
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


def frame_map(n_content_pages):
    """n_content_pages = 源8 克隆页数（一览表/详情/总表/Top10 共用）。"""
    out = []
    out.append({"outputSlide": 1, "sourceSlide": 1, "narrativeRole": "opening thesis",
                "reuseMode": "duplicate-slide", "editTargets": S1_TARGETS})
    out.append({"outputSlide": 2, "sourceSlide": 2, "narrativeRole": "status summary",
                "reuseMode": "duplicate-slide", "editTargets": S2_TARGETS})
    for i in range(n_content_pages):
        out.append({"outputSlide": 3 + i, "sourceSlide": 8, "narrativeRole": "analysis",
                    "reuseMode": "duplicate-slide", "editTargets": S8_TARGETS})
    out.append({"outputSlide": 3 + n_content_pages, "sourceSlide": 11,
                "narrativeRole": "closing contact", "reuseMode": "duplicate-slide",
                "editTargets": S11_TARGETS})
    return {"outputSlides": out, "omittedSourceSlides": [
        {"sourceSlide": 3, "reason": "两栏进度页不需要"},
        {"sourceSlide": 4, "reason": "关注点页不需要"},
        {"sourceSlide": 5, "reason": "日程页不需要"},
        {"sourceSlide": 6, "reason": "交付物页不需要"},
        {"sourceSlide": 7, "reason": "成本页不需要"},
        {"sourceSlide": 9, "reason": "资源页不需要"},
        {"sourceSlide": 10, "reason": "下次复核页不需要"},
    ]}


# ---------------- 字体与文本 ----------------
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


def _text_w(draw, text, font):
    return draw.textlength(text, font=font)


def wrap_lines(draw, text, font, max_w):
    """按字符宽度换行，保留显式换行；返回行列表。"""
    out = []
    for para in str(text or "").split("\n"):
        para = para.strip()
        if not para:
            out.append("")
            continue
        cur = ""
        for ch in para:
            if _text_w(draw, cur + ch, font) > max_w and cur:
                out.append(cur)
                cur = ch
            else:
                cur += ch
        if cur:
            out.append(cur)
    return out


def _truncate(draw, text, font, max_w):
    if _text_w(draw, text, font) <= max_w:
        return text
    while text and _text_w(draw, text + "\u2026", font) > max_w:
        text = text[:-1]
    return text + "\u2026"


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _fit_font(draw, text, font_size, bold, max_w, max_h, line_h=None, min_size=12):
    """自动缩字号直到文本在 max_w x max_h 内放得下。"""
    size = font_size
    while size >= min_size:
        f = _font(size, bold)
        lines = wrap_lines(draw, text, f, max_w)
        lh = line_h or int(size * 1.35)
        if len(lines) * lh <= max_h:
            return size, f, lines, lh
        size -= 1
    return min_size, _font(min_size, bold), lines, int(min_size * 1.35)


# ---------------- 表格渲染 ----------------
def render_table(path, headers, rows, col_widths, font_size=15, row_h=27,
                 header_h=33, pad=14, score_col=None, scale=2,
                 align_cols=None, title_trunc=True):
    """渲染一张带表头的表格 PNG（2x 超采样），返回 1x 尺寸 (w, h)。"""
    ncols = len(headers)
    W1 = sum(col_widths) + pad * 2
    H1 = pad * 2 + header_h + len(rows) * row_h
    S = scale
    img = Image.new("RGB", (W1 * S, H1 * S), WHITE)
    d = ImageDraw.Draw(img)
    tf = _font(font_size * S, bold=True)
    vf = _font(font_size * S)
    x0 = pad * S
    y = pad * S
    # 表头
    d.rounded_rectangle([0, 0, W1 * S - 1, (pad * 2 + header_h) * S - 1],
                        radius=10 * S, fill=_hex(ACCENT))
    cx = x0
    for j, htext in enumerate(headers):
        w = col_widths[j] * S
        d.text((cx + 8 * S, y + (header_h * S - font_size * S) / 2),
               str(htext), font=tf, fill=_hex(WHITE))
        cx += w
    yy = pad * S + header_h * S
    for i, row in enumerate(rows):
        if i % 2 == 1:
            d.rectangle([0, yy, W1 * S, yy + row_h * S], fill=_hex(ZEBRA))
        cx = x0
        for j, val in enumerate(row):
            w = col_widths[j] * S
            sval = str(val)
            if title_trunc and _text_w(d, sval, vf) > w - 14 * S:
                sval = _truncate(d, sval, vf, w - 14 * S)
            color = _hex(DARK)
            if score_col is not None and j == score_col:
                try:
                    fv = float(str(val).replace("%", "").strip())
                    color = _hex(SCORE_HIGH if fv >= 8.5 else (SCORE_MID if fv >= 7.5 else SCORE_LOW))
                except Exception:
                    pass
            tx = cx + 8 * S
            ty = yy + (row_h * S - font_size * S) / 2
            if align_cols and align_cols.get(j) == "center":
                tw = _text_w(d, sval, vf)
                tx = cx + (w - tw) / 2
            d.text((tx, ty), sval, font=vf, fill=color)
            cx += w
        # 行分隔线
        d.line([(x0, yy + row_h * S), (W1 * S - pad * S, yy + row_h * S)],
               fill=_hex(GRID), width=max(1, S))
        yy += row_h * S
    img.save(path, "PNG")
    return W1, H1


# ---------------- 封面 ----------------
def _round_corner_mask(size, radius):
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    return m


def open_cover(bgm_id, url, logger=None):
    path = download_cover(bgm_id, url, logger=logger)
    if not path:
        return None
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


def paste_cover(base, cover, box, radius=6, scale=1):
    """把封面等比缩放并居中贴到 box (x,y,w,h)，圆角。"""
    x, y, w, h = box
    cw, ch = cover.size
    ratio = min(w / cw, h / ch)
    nw, nh = max(1, int(cw * ratio)), max(1, int(ch * ratio))
    cover = cover.resize((nw, nh), Image.LANCZOS)
    px = int(x + (w - nw) // 2)
    py = int(y + (h - nh) // 2)
    if isinstance(base, Image.Image):
        base.paste(cover, (px, py), _round_corner_mask((nw, nh), radius * scale))
    else:
        base.bitmap((px, py), cover, None)


def render_cover_placeholder(path, w, h, scale=2, text="暂无封面"):
    S = scale
    img = Image.new("RGB", (w * S, h * S), _hex(ZEBRA))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w * S - 1, h * S - 1], radius=12 * S,
                        outline=_hex(GRID), width=max(2, S * 2))
    f = _font(16 * S, bold=True)
    tw = _text_w(d, text, f)
    d.text(((w * S - tw) / 2, (h * S - 16 * S) / 2), text, font=f, fill=_hex(GRAY))
    img.save(path, "PNG")
    return w, h


# ---------------- 详情卡 ----------------
_DETAIL_FIELDS = [
    ("放送", "weekday_time"),
    ("是否原创", "otype"),
    ("原作", "source"),
    ("导演", "director"),
    ("系列构成 / 脚本", "script"),
    ("动画制作", "studio"),
    ("主要声优", "cast"),
    ("标签", "tags"),
    ("Bangumi 评分", "rating"),
    ("Bangumi 链接", "link"),
]


def _detail_value(item):
    vals = {}
    parts = [item.get("weekday", ""), item.get("time", "")]
    wt = " ".join(p for p in parts if p)
    if item.get("eps"):
        wt += "　全%s话" % item["eps"]
    vals["weekday_time"] = wt or "—"
    o = item.get("original")
    if o is True:
        vals["otype"] = "原创"
    elif o is False:
        vals["otype"] = "改编（原作：%s）" % (item.get("source") or "—")
    else:
        vals["otype"] = "未知"
    vals["source"] = item.get("source") or "—"
    vals["director"] = item.get("director") or "—"
    vals["script"] = item.get("script") or "—"
    vals["studio"] = item.get("studio") or "—"
    vals["cast"] = item.get("cast") or "—"
    vals["tags"] = item.get("tags") or "—"
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
    return vals


def render_detail_card(path, item, w=900, h=470, scale=2, logger=None,
                       synopsis_limit=150, cast_limit=150):
    """渲染番剧详情卡：字段两列网格 + 底部简介。"""
    S = scale
    W1, H1 = w, h
    vals = _detail_value(item)
    img = Image.new("RGB", (W1 * S, H1 * S), WHITE)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W1 * S - 1, H1 * S - 1], radius=14 * S,
                        outline=_hex(GRID), width=max(2, S * 2))

    pad = 18 * S
    inner_w = (W1 - pad * 2) * S
    x0 = pad
    y = 20 * S
    hf = _font(17 * S, bold=True)
    d.text((x0, y), "基本信息", font=hf, fill=_hex(ACCENT))
    d.line([(x0, y + 28 * S), (x0 + 150 * S, y + 28 * S)], fill=_hex(ACCENT3),
           width=max(2, S * 2))
    y += 46 * S

    # 主要声优、标签截断
    cast = str(vals["cast"])
    if len(cast) > cast_limit:
        cast = cast[:cast_limit] + "…"
    tags = str(vals["tags"])
    if len(tags) > 90:
        tags = tags[:90] + "…"

    summary = str(item.get("summary") or "")
    if len(summary) > synopsis_limit:
        summary = summary[:synopsis_limit].rstrip() + "…"

    gap = 10 * S
    pair_w = (inner_w - gap) / 2
    label_h = 18 * S
    bottom = H1 * S - 8 * S

    def _row_h(nlines, lhh):
        # 标签占一行，值从 label_h + 2S 处开始，行高必须包含这段偏移，否则会压到下一行
        return label_h + 2 * S + nlines * lhh

    def _fit(fs, cast_t, tags_t):
        lf = _font(13 * S, bold=True) if fs > 12 else _font(12 * S, bold=True)
        vf = _font(fs * S)
        lhh = int(fs * S * 1.36)
        pairs_t = [
            ("放送", vals["weekday_time"], "是否原创", vals["otype"]),
            ("原作", vals["source"], "导演", vals["director"]),
            ("系列构成 / 脚本", vals["script"], "动画制作", vals["studio"]),
            ("主要声优", cast_t, None, None),
            ("标签", tags_t, None, None),
            ("Bangumi 评分", vals["rating"], "Bangumi 链接", vals["link"]),
        ]
        yy = y
        for lab1, v1, lab2, v2 in pairs_t:
            if lab2 is None:
                n = len(wrap_lines(d, v1, vf, inner_w))
            else:
                n = max(len(wrap_lines(d, v1, vf, pair_w)),
                        len(wrap_lines(d, v2, vf, pair_w)))
            yy += _row_h(n, lhh) + 8 * S
        sy = yy + 4 * S
        sf = _font(13 * S, bold=True)
        sfont = _font(max(11, fs - 1) * S)
        slhh = int(max(11, fs - 1) * S * 1.36)
        if sy + 26 * S + slhh > bottom:
            return None
        max_lines = max(1, int((bottom - (sy + 26 * S)) // slhh))
        lines = wrap_lines(d, summary, sfont, inner_w)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            last = lines[-1]
            if last and not last.endswith("…"):
                lines[-1] = last[:max(1, len(last) - 1)] + "…"
        return (fs, lf, vf, lhh, yy, sy, lines, sf, sfont, slhh)

    best = None
    cast_t, tags_t = cast, tags
    for fs in (14, 13, 12):
        best = _fit(fs, cast_t, tags_t)
        if best:
            break
    if best is None:
        # 内容过长：先收紧声优 / 标签再重试
        cast_t = (cast[:110] + "…") if len(cast) > 110 else cast
        tags_t = (tags[:56] + "…") if len(tags) > 56 else tags
        for fs in (14, 13, 12):
            best = _fit(fs, cast_t, tags_t)
            if best:
                break
    if best is None:
        # 最终兜底：进一步压缩后按 12px 绘制，仍保证不重叠
        cast_t = (cast_t[:80] + "…") if len(cast_t) > 80 else cast_t
        tags_t = (tags_t[:44] + "…") if len(tags_t) > 44 else tags_t
        for fs in (14, 13, 12):
            best = _fit(fs, cast_t, tags_t)
            if best:
                break
    if best is None:
        raise RuntimeError("详情卡内容无法排版：%s" % item.get("title", ""))

    fs, lf, vf, lhh, yy, sy, lines, sf, sfont, slhh = best
    pairs_f = [
        ("放送", vals["weekday_time"], "是否原创", vals["otype"]),
        ("原作", vals["source"], "导演", vals["director"]),
        ("系列构成 / 脚本", vals["script"], "动画制作", vals["studio"]),
        ("主要声优", cast_t, None, None),
        ("标签", tags_t, None, None),
        ("Bangumi 评分", vals["rating"], "Bangumi 链接", vals["link"]),
    ]

    def draw_cell(x, yc, label, value, vw, vfont, lfont):
        d.text((x, yc), label, font=lfont, fill=_hex(ACCENT2))
        ls = wrap_lines(d, value, vfont, vw)
        ty = yc + label_h + 2 * S
        for ln in ls:
            d.text((x, ty), ln, font=vfont, fill=_hex(DARK))
            ty += lhh

    yc = y
    for lab1, v1, lab2, v2 in pairs_f:
        if lab2 is None:
            draw_cell(x0, yc, lab1, v1, inner_w, vf, lf)
            yc += _row_h(len(wrap_lines(d, v1, vf, inner_w)), lhh) + 8 * S
        else:
            draw_cell(x0, yc, lab1, v1, pair_w, vf, lf)
            n1 = len(wrap_lines(d, v1, vf, pair_w))
            draw_cell(x0 + pair_w + gap, yc, lab2, v2, pair_w, vf, lf)
            n2 = len(wrap_lines(d, v2, vf, pair_w))
            yc += _row_h(max(n1, n2), lhh) + 8 * S

    # 简介
    d.line([(x0, sy - 4 * S), (W1 * S - pad, sy - 4 * S)], fill=_hex(GRID),
           width=max(1, S))
    d.text((x0, sy), "简介", font=sf, fill=_hex(ACCENT))
    ty = sy + 26 * S
    for ln in lines:
        d.text((x0, ty), ln, font=sfont, fill=_hex(DARK))
        ty += slhh
    if ty > H1 * S - 2 * S and logger:
        logger.warning("详情卡文字接近底边：%d/%d", ty, H1 * S)
    img.save(path, "PNG")
    return W1, H1


# ---------------- Top10 网格 ----------------
def render_top_grid(path, top, w=1220, h=460, scale=2, logger=None,
                   cover_box=(125, 160), title_font=17, score_font=16):
    """5x2 封面网格：封面 + 标题 + 评分。坐标统一按 1x 计算，绘制时乘 scale。"""
    S = scale
    W1, H1 = w, h
    img = Image.new("RGB", (W1 * S, H1 * S), WHITE)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W1 * S - 1, H1 * S - 1], radius=14 * S,
                        outline=_hex(GRID), width=max(2, S * 2))
    pad = 18
    cols, rows_n = 5, 2
    cell_w = (W1 - pad * 2) / cols
    cell_h = (H1 - pad * 2 - 8) / rows_n
    tf = _font(title_font * S, bold=True)
    sf = _font(score_font * S, bold=True)
    cw, ch = cover_box
    for i, x in enumerate(top):
        col = i % cols
        row = i // cols
        cx = pad + col * cell_w
        cy = pad + row * cell_h + 6
        cover = open_cover(x.get("bgm_id"), x.get("image_url"), logger=logger)
        bx = cx + (cell_w - cw) / 2
        by = cy
        if cover:
            paste_cover(img, cover, (bx * S, by * S, cw * S, ch * S),
                        radius=6, scale=S)
        else:
            sub = Image.new("RGB", (cw * S, ch * S), _hex(ZEBRA))
            sd = ImageDraw.Draw(sub)
            pf = _font(max(14, title_font - 1) * S)
            sd.text(((cw * S - _text_w(sd, "暂无封面", pf)) / 2,
                     (ch * S - (title_font - 1) * S) / 2), "暂无封面",
                    font=pf, fill=_hex(GRAY))
            img.paste(sub, (int(round(bx * S)), int(round(by * S))))
        title = _truncate(d, str(x.get("title", "")), tf, cell_w * S - 8 * S)
        ty = int(round((cy + ch + 10) * S))
        tx = int(round((cx + (cell_w - _text_w(d, title, tf) / S) / 2) * S))
        d.text((tx, ty), title, font=tf, fill=_hex(DARK))
        score = x.get("rating")
        if score is None:
            st = "暂无评分"
            sc = _hex(GRAY)
        else:
            st = "%.1f 分（%d 人）" % (score, x.get("rating_total") or 0)
            sc = _hex(SCORE_HIGH if score >= 8.5 else (SCORE_MID if score >= 7.5 else SCORE_LOW))
        ty2 = int(round((cy + ch + 10 + 24) * S))
        tx2 = int(round((cx + (cell_w - _text_w(d, st, sf) / S) / 2) * S))
        d.text((tx2, ty2), st, font=sf, fill=sc)
    img.save(path, "PNG")
    return W1, H1


# ---------------- 构建管线 ----------------
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
    return env


def _run(cmd, logger, env=None, ok_if_exists=None):
    logger.info("运行：%s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env or _node_env())
    if proc.stdout.strip():
        logger.info("stdout: %s", proc.stdout.strip()[:2500])
    if proc.returncode != 0:
        if ok_if_exists and os.path.exists(ok_if_exists) and os.path.getsize(ok_if_exists) > 0:
            logger.warning("node 退出码异常(%s)但产物已生成，继续：%s", proc.returncode, ok_if_exists)
            return proc
        logger.error("stderr: %s", (proc.stderr or "")[:4000])
        raise RuntimeError("子进程失败：%s" % " ".join(cmd[:3]))
    return proc


def strip_shapes_from_pptx(path, names):
    """从已生成的 PPTX 中删除指定名称的文本框（原生 PPT 图形），保证模板正文框不再压在表格后面。"""
    names = set(names or [])
    if not names:
        return
    pat = re.compile(r"<p:sp>.*?</p:sp>", re.S)
    slide_re = re.compile(r"ppt/slides/slide\d+\.xml$")
    tmp = path + ".tmp"
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if slide_re.match(item.filename):
                xml = data.decode("utf-8")
                def _keep(m):
                    first = re.search(r'name="([^"]+)"', m.group(0)[:800])
                    return not (first and first.group(1) in names)
                xml = pat.sub(lambda m: m.group(0) if _keep(m) else "", xml)
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    import os as _os
    _os.replace(tmp, path)


def move_shape_top_from_pptx(path, name, top_px):
    """把指定名称的原生图形移动到 top_px（px）处。

    模板里标题是版式占位符（无显式位置），这里写入显式 a:xfrm 覆盖版式位置，
    用于把克隆页大标题整体上移、给下方表格腾出空间。复用 zip 重写模式。
    """
    names = {name}
    pat = re.compile(r"<p:sp>.*?</p:sp>", re.S)
    slide_re = re.compile(r"ppt/slides/slide\d+\.xml$")
    emu_y = int(round(top_px * 9525))
    new_sp = ('<p:spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="603504" y="%d"/>'
              '<a:ext cx="10871740" cy="704088"/></a:xfrm></p:spPr>' % emu_y)
    tmp = path + ".tmp"
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if slide_re.match(item.filename):
                xml = data.decode("utf-8")
                def _keep(m):
                    first = re.search(r'name="([^"]+)"', m.group(0)[:800])
                    if not (first and first.group(1) in names):
                        return m.group(0)
                    head = m.group(0)
                    if re.search(r"<a:xfrm>", head):
                        return re.sub(r'(<a:off [^>]*?y=")[0-9]+(")',
                                      lambda mm: mm.group(1) + str(emu_y) + mm.group(2),
                                      head, count=1)
                    if re.search(r"<p:spPr\s*/>", head):
                        return re.sub(r"<p:spPr\s*/>", new_sp, head, count=1)
                    if re.search(r"<p:spPr>\s*</p:spPr>", head):
                        return re.sub(r"<p:spPr>\s*</p:spPr>", new_sp, head, count=1)
                    return head
                xml = pat.sub(_keep, xml)
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    os.replace(tmp, path)


def build_deck(out_path, edits, images, notes, logger=None, work_root=None,
               n_content_pages=None, tables=None):
    """执行模板构建管线，返回 summary dict。"""
    logger = logger or setup_logging()
    work_root = work_root or os.path.join(RUNTIME_DIR, "template_work")
    os.makedirs(work_root, exist_ok=True)
    if n_content_pages is None:
        n_content_pages = max(0, len(edits) - 3)
    fm = frame_map(n_content_pages)
    _write_json(os.path.join(work_root, "template-frame-map.json"), fm)
    data = {"edits": edits, "images": images, "notes": notes,
            "tables": tables or [],
            "generated_at": datetime.date.today().isoformat()}
    data_path = os.path.join(work_root, "data.json")
    _write_json(data_path, data)

    starter = os.path.join(work_root, "template-starter.pptx")
    preview_dir = os.path.join(work_root, "template-starter-preview")
    layout_dir = os.path.join(work_root, "template-starter-layout")
    _run([NODE, PREPARE, "--workspace", work_root, "--pptx", REFERENCE,
          "--map", os.path.join(work_root, "template-frame-map.json"),
          "--out", starter, "--inspect", INSPECT,
          "--preview-dir", preview_dir, "--layout-dir", layout_dir], logger,
         ok_if_exists=starter)

    env = _node_env()
    env["TMP_DIR"] = work_root
    env["DATA_FILE"] = data_path
    env["FINAL_PPTX"] = out_path
    _run([NODE, BUILD_MJS], logger, env=env, ok_if_exists=out_path)

    if not os.path.exists(out_path):
        raise RuntimeError("PPT 未生成：%s" % out_path)
    logger.info("PPT 已生成：%s", out_path)
    return {"output": out_path, "slides": len(edits) + 2 if False else None,
            "images": len(images)}