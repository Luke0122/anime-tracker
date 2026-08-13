# -*- coding: utf-8 -*-
"""邮件正文 HTML 排版（信息文档 / 评分文档）。"""
import html as _html


def esc(s):
    return _html.escape("" if s is None else str(s))


def _style():
    return (
        "<style>"
        "body{font-family:'Microsoft YaHei','微软雅黑',sans-serif;color:#333;}"
        "h1{color:#2B6CB0;}h2{color:#2B6CB0;border-bottom:2px solid #2B6CB0;padding-bottom:4px;}"
        "table{border-collapse:collapse;width:100%;font-size:12px;}"
        "th{background:#2B6CB0;color:#fff;padding:5px 8px;border:1px solid #999;}"
        "td{padding:4px 8px;border:1px solid #ccc;}"
        "tr:nth-child(even){background:#f2f7fc;}"
        ".note{color:#888;font-size:12px;}"
        "</style>"
    )


def _table(headers, rows):
    out = ["<table>", "<tr>"]
    for h in headers:
        out.append("<th>%s</th>" % esc(h))
    out.append("</tr>")
    for row in rows:
        out.append("<tr>")
        for v in row:
            out.append("<td>%s</td>" % esc(v))
        out.append("</tr>")
    out.append("</table>")
    return "".join(out)


def _otype(x):
    return {True: "原创", False: "改编", None: "—"}.get(x.get("original"), "—")


def build_info_html(label, items, generated_at):
    total = len(items)
    matched = sum(1 for x in items if x.get("bgm_id"))
    unmatched = total - matched
    originals = sum(1 for x in items if x.get("original") is True)
    adapted = sum(1 for x in items if x.get("original") is False)
    wd_order = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    wd_count = {}
    for x in items:
        wd = x.get("weekday") or "未知"
        wd_count[wd] = wd_count.get(wd, 0) + 1

    stats = [
        ["收录作品", "%d 部" % total],
        ["已匹配 Bangumi 条目", "%d 部" % matched],
        ["未匹配（仅保留 yuc.wiki 标题）", "%d 部" % unmatched],
        ["原创动画", "%d 部" % originals],
        ["改编动画", "%d 部" % adapted],
    ]
    for wd in wd_order:
        if wd_count.get(wd):
            stats.append(["放送于 %s" % wd, "%d 部" % wd_count[wd]])

    rows = []
    for i, x in enumerate(items, start=1):
        rows.append([
            i, x.get("title", ""), x.get("weekday", ""), x.get("time", ""),
            x.get("eps", ""), _otype(x), x.get("studio", "") or "—",
            "%.1f" % x["rating"] if x.get("rating") is not None else "—",
        ])

    html = [
        "<html><head><meta charset='utf-8'>%s</head><body>" % _style(),
        "<h1>%s新番信息</h1>" % esc(label),
        "<p class='note'>生成日期：%s　|　数据来源：yuc.wiki（番剧清单）+ Bangumi（详细信息与评分）　|　附件：Word + PPT</p>" % esc(generated_at),
        "<h2>一、统计概览</h2>",
        _table(["项目", "数量"], stats),
        "<h2>二、新番一览表</h2>",
        _table(["序", "标题", "星期", "时间", "话数", "原创", "制作公司", "评分"], rows),
        "<p class='note'>每部番的完整信息（导演、脚本、声优、标签、简介、Bangumi 链接）见附件 Word / PPT 文档。</p>",
        "</body></html>",
    ]
    return "".join(html)


def build_rating_html(label, phase_label, items, generated_at):
    rated = [x for x in items if x.get("rating") is not None]
    unrated = [x for x in items if x.get("rating") is None]
    rated.sort(key=lambda x: (-(x.get("rating") or 0), -(x.get("rating_total") or 0)))
    n9 = sum(1 for x in rated if x["rating"] >= 9.0)
    n8 = sum(1 for x in rated if 8.0 <= x["rating"] < 9.0)
    n7 = sum(1 for x in rated if 7.0 <= x["rating"] < 8.0)
    nlow = sum(1 for x in rated if x["rating"] < 7.0)

    rows = []
    for i, x in enumerate(rated, start=1):
        rows.append([i, x.get("title", ""), "%.1f" % x["rating"],
                     x.get("rating_total") or 0, x.get("weekday", ""), x.get("time", "")])
    for x in unrated:
        rows.append(["—", x.get("title", ""), "暂无评分", "—", x.get("weekday", ""), x.get("time", "")])

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
    top10 = list(best.values())[:10]
    top = ["<ol>"]
    for i, x in enumerate(top10, start=1):
        top.append("<li>%s　——　%.1f 分（%d 人评分）</li>" %
                   (esc(x.get("title", "")), x["rating"], x.get("rating_total") or 0))
    top.append("</ol>")

    html = [
        "<html><head><meta charset='utf-8'>%s</head><body>" % _style(),
        "<h1>%s评分汇总（%s）</h1>" % (esc(label), esc(phase_label)),
        "<p class='note'>生成日期：%s　|　数据来源：Bangumi 评分（bgm.tv）　|　附件：Word + PPT</p>" % esc(generated_at),
        "<h2>一、评分总表</h2>",
        _table(["排名", "标题", "评分", "评分人数", "星期", "时间"], rows),
        "<h2>二、分档统计</h2>",
        _table(["分档", "数量"], [
            ["9.0 及以上", "%d 部" % n9],
            ["8.0 – 8.9", "%d 部" % n8],
            ["7.0 – 7.9", "%d 部" % n7],
            ["7.0 以下", "%d 部" % nlow],
            ["暂无评分", "%d 部" % len(unrated)],
            ["合计", "%d 部" % len(items)],
        ]),
        "<h2>三、高分亮点（Top 10）</h2>",
        "".join(top),
        "</body></html>",
    ]
    return "".join(html)


def _add_months(year, month, delta):
    m = month - 1 + delta
    y = year + m // 12
    m = m % 12 + 1
    return y, m


def _phase_for(sy, sm, date_str):
    from datetime import date
    d = date.fromisoformat(str(date_str))
    if d == date(sy, sm, 20):
        return "初期"
    mid_y, mid_m = _add_months(sy, sm, 1)
    if d == date(mid_y, mid_m, 20):
        return "中期"
    end_y, end_m = _add_months(sy, sm, 3)
    if d == date(end_y, end_m, 5):
        return "末期"
    return "补做"


def build_trend_html(label, sy, sm, summary, generated_at):
    if not summary:
        return ("<html><head><meta charset='utf-8'>%s</head><body>"
                "<h1>%s评分趋势复盘</h1>"
                "<p class='note'>暂无可用数据，请查看附件 PPT。</p>"
                "</body></html>" % (_style(), esc(label)))
    end_date = summary.get("end_date") or ""
    candidates = summary.get("candidates") or 0
    total = summary.get("total") or 0
    n_pages = summary.get("n_pages") or 0
    avg = summary.get("avg") or []
    top = summary.get("top") or []

    avg_rows = []
    for d, v in avg:
        avg_rows.append(["%s（%s）" % (_phase_for(sy, sm, str(d)), esc(str(d))), "%.2f" % float(v)])
    if not avg_rows:
        avg_rows.append(["暂无数据", "—"])

    top_html = ["<ol>"]
    for i, x in enumerate(top[:10], start=1):
        top_html.append("<li>%s　——　%.1f 分（%d 人评分）</li>" %
                        (esc(x.get("title", "")), x.get("rating") or 0, x.get("rating_total") or 0))
    top_html.append("</ol>")

    html = [
        "<html><head><meta charset='utf-8'>%s</head><body>" % _style(),
        "<h1>%s评分趋势复盘</h1>" % esc(label),
        "<p class='note'>生成日期：%s　|　末期快照：%s　|　附件：季末评分趋势 PPT</p>" % (esc(generated_at), esc(end_date)),
        "<h2>一、全季平均评分走势</h2>",
        _table(["快照（阶段）", "平均分"], avg_rows),
        "<h2>二、选取范围</h2>",
        _table(["项目", "数量"], [
            ["本季收录作品", "%d 部" % total],
            ["趋势复盘候选番（末期评分 Top20 ∪ 热度 Top10）", "%d 部" % candidates],
            ["折线图页数", "%d 页" % n_pages],
        ]),
        "<h2>三、高分番（Top 10）</h2>",
        "".join(top_html),
        "<p class='note'>每部候选番的初期 → 中期 → 末期评分折线图详见附件 PPT。</p>",
        "</body></html>",
    ]
    return "".join(html)
