# -*- coding: utf-8 -*-
"""抓取 yuc.wiki 季度新番表，解析标题/星期/时间/话数/播放区域。"""
import datetime
import html
import os
import re
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE_DIR, load_json, save_json, setup_logging, yuc_month

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeAutoBot/1.0"

WEEKDAY_RE = re.compile(
    r'<table class="date_"[^>]*>.*?<td class="date2">\s*([^<]+?)\s*</td>', re.S)
SHOW_TABLE_RE = re.compile(r'<table width="120px">(.*?)</table>', re.S)
TITLE_RE = re.compile(r'<td colspan="3" class="date_title_+">(.*?)</td>', re.S)
AREA_RE = re.compile(r'<p class="area">([^<]+)</p>', re.S)
TIME_RE = re.compile(r'(\d{1,2}:\d{2})~\s*')
EPS_RE = re.compile(r'\((?:(全\d+话))\)|P2=\s*(\d+)\s*话')


def cache_path(year, start_month):
    return os.path.join(CACHE_DIR, "yuc_%s.json" % yuc_month(year, start_month))


def fetch_page(year, start_month, timeout=45):
    yyyymm = yuc_month(year, start_month)
    url = "https://yuc.wiki/%s/" % yyyymm
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=timeout)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text, yyyymm


def parse_page(html_text):
    """返回 [{title, weekday, time, eps, region}]"""
    shows = []
    wms = list(WEEKDAY_RE.finditer(html_text))
    for idx, wm in enumerate(wms):
        weekday = re.split(r"\s*\(", wm.group(1).strip())[0]
        section_end = wms[idx + 1].start() if idx + 1 < len(wms) else len(html_text)
        section = html_text[wm.end():section_end]
        cursor = 0
        for sm in SHOW_TABLE_RE.finditer(section):
            table_html = sm.group(1)
            tm = TITLE_RE.search(table_html)
            if not tm:
                continue
            title = html.unescape(re.sub(r"<br\s*/?>", "", tm.group(1)))
            title = re.sub(r"\s+", "", title).strip()
            if not title:
                continue
            seg = section[cursor:sm.start()]
            times = TIME_RE.findall(seg)
            time_str = times[-1] if times else ""
            em = EPS_RE.search(seg)
            eps = (em.group(1) or em.group(2) or "") if em else ""
            am = AREA_RE.search(table_html)
            region = am.group(1).strip() if am else ""
            shows.append({
                "title": title,
                "weekday": weekday,
                "time": time_str,
                "eps": eps,
                "region": region,
            })
            cursor = sm.end()
    return shows


def load_or_fetch(year, start_month, refresh=False):
    logger = setup_logging()
    path = cache_path(year, start_month)
    data = None if refresh else load_json(path)
    if data and data.get("shows"):
        logger.info("yuc.wiki 缓存命中：%s（%d 部）", yuc_month(year, start_month), len(data["shows"]))
        return data
    logger.info("抓取 yuc.wiki %s 新番表…", yuc_month(year, start_month))
    page_html, yyyymm = fetch_page(year, start_month)
    shows = parse_page(page_html)
    data = {"season": yyyymm, "fetched_at": datetime.datetime.now().isoformat(timespec="seconds"), "shows": shows}
    save_json(path, data)
    logger.info("yuc.wiki 解析完成：%d 部", len(shows))
    return data