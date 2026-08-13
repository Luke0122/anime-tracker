# -*- coding: utf-8 -*-
"""通过 bangumi API 匹配番剧条目并抓取详情、角色声优、评分。"""
import datetime
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (CACHE_DIR, load_json, save_json, setup_logging, yuc_month, norm_title,
                    simplify_cn)

API = "https://api.bgm.tv"
UA = "AnimeAutoBot/1.0 (https://github.com/Luke0122/ANIME)"
BASE_SUF_RE = re.compile(r"\s*第\s*([一二三四五六七八九十\d]+)\s*(期|季|シーズン|クール)?\s*$")
NO_SOURCE = {"", "无", "原创", "—", "-", "－", "none", "なし"}

# 已知翻译差异大、通用匹配易出错的条目：yuc 标题 -> (搜索关键词, 必需名称片段)
TITLE_OVERRIDES = {
    "新魔神坛斗士Part.2": ("鎧真伝サムライトルーパー", "鎧真伝サムライトルーパー"),
    "关于我转生变成史莱姆这档事第4期Part.1": ("転生したらスライムだった件 第4期", "スライムだった件"),
    "神之水滴": ("神の雫", "神の雫"),
    "新攻壳机动队": ("攻殻機動隊 THE GHOST IN THE SHELL", "攻殻機動隊"),
}
STUDIO_TAGS = ("8bit", "SUNRISE", "サンライズ", "サイエンスSARU", "ScienceSARU", "MAPPA",
               "MADHOUSE", "CloverWorks", "A-1 Pictures", "P.A.WORKS", "WIT STUDIO",
               "J.C.STAFF", "JCSTAFF", "Studio Bind", "BONES", "Production I.G",
               "ufotable", "LIDENFILMS", "PINE JAM", "Seven Arcs", "エイトビット", "京阿尼")
WEEKDAY_MAP = {"周一": 0, "周二": 1, "周三": 2, "周四": 3, "周五": 4, "周六": 5, "周日": 6}


def cache_path(year, start_month):
    return os.path.join(CACHE_DIR, "bangumi_%s.json" % yuc_month(year, start_month))


def _call(fn, *args, **kwargs):
    last = None
    for attempt in range(4):
        try:
            return fn(*args, **kwargs)
        except requests.exceptions.HTTPError as e:
            last = e
            if e.response is not None and e.response.status_code == 429:
                time.sleep(6 * (attempt + 1))
                continue
            raise
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last = e
            time.sleep(4 * (attempt + 1))
            continue
    raise last


def api_get(path):
    def do():
        r = requests.get(API + path, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        return r.json()
    return _call(do)


def api_search(keyword):
    def do():
        r = requests.post(
            API + "/v0/search/subjects",
            headers={"User-Agent": UA, "Content-Type": "application/json"},
            json={"keyword": keyword, "filter": {"type": [2]}, "limit": 25, "offset": 0},
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("data", [])
    return _call(do)


CJK_RE = re.compile(r"[A-Za-z0-9\s　]+")


def base_title(title):
    m = BASE_SUF_RE.search(title)
    return title[:m.start()].strip() if m else title


def _cjk(s):
    return CJK_RE.sub("", s or "")


def _short_form(s):
    for sep in ("～", "〜", "~"):
        idx = s.find(sep)
        if idx > 0:
            return s[:idx]
    return s


def name_score(sub, title):
    """0-100：名称相似度（中文名/日文名/仅中文部分/去副标题短名）。"""
    t = norm_title(title)
    if not t:
        return 0
    best = 0
    raw_names = [sub.get("name_cn", ""), sub.get("name", ""),
                 _cjk(sub.get("name_cn", "")), _cjk(sub.get("name", ""))]
    variants = []
    for raw in raw_names:
        variants.append(raw)
        sh = _short_form(raw)
        if sh and sh != raw:
            variants.append(sh)
    from difflib import SequenceMatcher
    for raw in variants:
        n = norm_title(raw)
        if not n:
            continue
        if n == t:
            best = max(best, 100)
        elif t in n or n in t:
            best = max(best, 60)
        else:
            r = SequenceMatcher(None, t, n).ratio()
            if r >= 0.55:
                best = max(best, 45)
            elif r >= 0.40:
                best = max(best, 30)
            elif r >= 0.28:
                best = max(best, 15)
    return best


def in_season_window(datestr, season_start):
    if not datestr:
        return False
    try:
        sd = datetime.date.fromisoformat(datestr)
    except ValueError:
        return False
    return -130 <= (sd - season_start).days <= 80


def _search_attempts(title):
    """返回 [(关键词, 是否仅限当季窗口)]；标题以“新”开头时全部限当季，避免匹配旧作。"""
    force_window = title.startswith("新") and len(title) > 2
    attempts = [(title, force_window), (title.replace(" ", ""), force_window)]
    bt = base_title(title)
    if bt != title:
        attempts.append((bt, force_window))
    m = re.search(r"第(\d+)期", title)
    if m:
        n = int(m.group(1))
        cn = "一二三四五六七八九十"[n - 1] if 1 <= n <= 10 else str(n)
        attempts.append((title.replace("第%d期" % n, "第%s季" % cn), force_window))
    m2 = re.search(r"Part\.\d+", title, re.I)
    if m2:
        attempts.append((title[:m2.start()].strip(), force_window))
    if force_window:
        attempts.append((title[1:], True))
    cjk_runs = re.findall(r"[\u4e00-\u9fff]{4,}", title)
    if cjk_runs:
        attempts.append((max(cjk_runs, key=len), force_window))
    if len(title) > 6:
        attempts.append((title[-6:], force_window))
        attempts.append((title[:6], force_window))
    return attempts


def match_score(sub, title, season_start, weekday=None):
    ns = name_score(sub, title)
    if weekday:
        try:
            wd = datetime.date.fromisoformat(sub.get("date") or "").weekday()
        except (TypeError, ValueError):
            wd = None
        if wd is not None and WEEKDAY_MAP.get(weekday) == wd:
            ns += 15
    try:
        delta = (datetime.date.fromisoformat(sub.get("date") or "") - season_start).days
    except (TypeError, ValueError):
        delta = None
    if delta is not None:
        if -20 <= delta <= 10:
            ns += 10
        elif -130 <= delta < -20:
            ns += 5
    return ns


def pick_best(title, season_start, weekday=None):
    ov = TITLE_OVERRIDES.get(title)
    if ov:
        kw, frag = ov
        try:
            data = api_search(kw)
        except Exception:
            data = []
        hits = [s for s in data
                if frag in (s.get("name") or "") or frag in (s.get("name_cn") or "")]
        hits = [s for s in hits
                if in_season_window(s.get("date"), season_start) or not s.get("date")]
        if hits:
            c = max(hits, key=lambda s: name_score(s, title))
            return c, max(name_score(c, title), 60)
    seen_ids = set()
    cands = []
    for kw, restricted in _search_attempts(title):
        try:
            data = api_search(kw)
        except Exception:
            continue
        top1_exact = (kw == title and not restricted and bool(data))
        for i, sub in enumerate(data):
            sid = sub.get("id")
            if not sid or sid in seen_ids:
                continue
            if restricted and not in_season_window(sub.get("date"), season_start):
                continue
            seen_ids.add(sid)
            cands.append((sub, top1_exact and i == 0))
    inwin = [(c, f) for c, f in cands if in_season_window(c.get("date"), season_start)]
    if inwin:
        def key(tp):
            c, f = tp
            return (match_score(c, title, season_start, weekday), 1 if f else 0,
                    1 if c.get("platform") == "TV" else 0, -c.get("id", 0))
        c, f = max(inwin, key=key)
        ns = match_score(c, title, season_start, weekday)
        if ns >= 25 or f:
            return c, ns
    scored = sorted(((c, match_score(c, title, season_start, weekday)) for c, _ in cands),
                    key=lambda x: -x[1])
    if scored and scored[0][1] >= 55:
        return scored[0]
    return None, 0


def extract_infobox(subject):
    out = {}
    for item in subject.get("infobox", []):
        k = item.get("key")
        v = item.get("value")
        if not k:
            continue
        if isinstance(v, list):
            v = " / ".join(str(x) for x in v if str(x).strip())
        out[k] = str(v).strip()
    return out


def judge_original(infobox, subject):
    src = (infobox.get("原作") or "").strip()
    if not src or src in NO_SOURCE:
        return True, src
    meta = subject.get("meta_tags") or []
    if "原创" in meta:
        return True, src
    return False, src


def get_cast_text(sid, max_n):
    try:
        chars = api_get("/v0/subjects/%d/characters" % sid)
    except Exception:
        return ""
    lines = []
    for c in chars:
        cname = c.get("name_cn") or c.get("name") or ""
        actors = c.get("actors") or []
        if actors:
            a = actors[0]
            aname = a.get("name_cn") or a.get("name") or ""
            lines.append("%s（%s）" % (cname, aname))
        elif cname:
            lines.append(cname)
        if len(lines) >= max_n:
            break
    return "、".join(lines)


def enrich_shows(shows, year, start_month, cfg):
    logger = setup_logging()
    delay = float(cfg.get("request_delay", 1.2))
    max_actors = int(cfg.get("max_voice_actors", 8))
    top_tags = int(cfg.get("top_tags", 10))
    season_start = datetime.date(year, start_month, 1)
    results = []
    for i, show in enumerate(shows, start=1):
        item = dict(show)
        try:
            sub, score = pick_best(show["title"], season_start, show.get("weekday"))
            if sub:
                time.sleep(delay)
                sid = sub["id"]
                detail = api_get("/v0/subjects/%d" % sid)
                time.sleep(delay)
                infobox = extract_infobox(detail)
                cast = get_cast_text(sid, max_actors)
                time.sleep(delay)
                rating = detail.get("rating") or {}
                score_val = rating.get("score") if rating.get("total", 0) > 0 else None
                original, source = judge_original(infobox, detail)
                tags = [t["name"] for t in (detail.get("tags") or [])][:top_tags]
                images = detail.get("images") or {}
                studio = infobox.get("动画制作") or infobox.get("制作") or ""
                if not studio:
                    for t in tags:
                        if t in STUDIO_TAGS:
                            studio = t
                            break
                item.update({
                    "bgm_id": sid,
                    "bgm_url": "https://bgm.tv/subject/%d" % sid,
                    "image_url": images.get("common") or images.get("medium") or images.get("large") or "",
                    "image_small": images.get("small") or images.get("grid") or "",
                    "name": detail.get("name", ""),
                    "name_cn": simplify_cn(detail.get("name_cn", "")),
                    "date": detail.get("date", ""),
                    "eps": detail.get("total_episodes") or detail.get("eps") or item.get("eps") or "",
                    "original": original,
                    "source": simplify_cn(source),
                    "director": simplify_cn(infobox.get("导演") or infobox.get("总导演") or ""),
                    "script": simplify_cn(" / ".join(x for x in [infobox.get("系列构成", ""), infobox.get("脚本", "")] if x)),
                    "studio": simplify_cn(studio),
                    "cast": simplify_cn(cast),
                    "tags": "、".join(tags),
                    "summary": simplify_cn((detail.get("summary") or "").strip(), remove_kana=False),
                    "rating": score_val,
                    "rating_total": rating.get("total", 0),
                    "rank": rating.get("rank"),
                    "match_score": score,
                })
            else:
                item.update({"bgm_id": None, "match_score": 0, "original": None})
        except Exception as e:
            logger.warning("第 %d 部「%s」抓取失败：%s", i, show["title"], e)
            item.update({"bgm_id": None, "error": str(e)})
        results.append(item)
        logger.info("[%d/%d] %s -> %s", i, len(shows), show["title"],
                    "bgm#%s" % item.get("bgm_id") if item.get("bgm_id") else "未找到")
    return results


def load_or_fetch(shows, year, start_month, cfg, refresh=False):
    logger = setup_logging()
    path = cache_path(year, start_month)
    data = None if refresh else load_json(path)
    if data and data.get("items"):
        logger.info("bangumi 缓存命中：%s（%d 部）", yuc_month(year, start_month), len(data["items"]))
        return data
    logger.info("抓取 bangumi 详情（%d 部，每部约 3 个请求）…", len(shows))
    items = enrich_shows(shows, year, start_month, cfg)
    data = {"season": yuc_month(year, start_month),
            "fetched_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "items": items}
    save_json(path, data)
    return data

def enrich_images(items, cfg):
    """为已有缓存条目补抓封面 URL（只请求 subject 详情）。"""
    logger = setup_logging()
    delay = float(cfg.get("request_delay", 1.2))
    updated = 0
    for item in items:
        sid = item.get("bgm_id")
        if not sid or item.get("image_url"):
            continue
        try:
            time.sleep(delay)
            detail = api_get("/v0/subjects/%d" % sid)
            images = detail.get("images") or {}
            item["image_url"] = images.get("common") or images.get("medium") or images.get("large") or ""
            item["image_small"] = images.get("small") or images.get("grid") or ""
            if item["image_url"]:
                updated += 1
        except Exception as e:
            logger.warning("封面URL获取失败 bgm#%s: %s", sid, e)
    return updated