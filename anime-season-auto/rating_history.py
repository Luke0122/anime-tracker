# -*- coding: utf-8 -*-
"""评分历史记录：每个评分快照把每部番的评分写入季度历史 JSON。

历史文件结构（_runtime/data/rating_history_<季>.json）：
{
  "season": "2026-07",
  "snapshots": {
    "2026-08-09": {
      "456081": {"bgm_id": 456081, "title": "...", "weekday": "周一",
                 "time": "20:30", "rating": 4.9, "rating_total": 112, "rank": 9137}
    }
  }
}
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE_DIR, load_json, save_json, season_key


def history_path(sy, sm):
    return os.path.join(CACHE_DIR, "rating_history_%s.json" % season_key(sy, sm))


def load_history(sy, sm):
    return load_json(history_path(sy, sm), {}) or {}


def snapshot_dates(hist):
    return sorted((hist.get("snapshots") or {}).keys())


def record_snapshot(items, sy, sm, date_str, logger=None):
    """把一次评分快照写入季度历史；同一日期重复运行只覆盖不重复。"""
    hist = load_history(sy, sm)
    hist.setdefault("season", season_key(sy, sm))
    snapshots = hist.setdefault("snapshots", {})
    snap = snapshots.setdefault(date_str, {})
    for x in items:
        bid = x.get("bgm_id")
        if not bid:
            continue
        snap[str(bid)] = {
            "bgm_id": int(bid),
            "title": x.get("title") or x.get("name") or "",
            "weekday": x.get("weekday") or "",
            "time": x.get("time") or "",
            "rating": x.get("rating"),
            "rating_total": x.get("rating_total"),
            "rank": x.get("rank"),
        }
    save_json(history_path(sy, sm), hist)
    if logger:
        logger.info("评分历史已记录：%s @ %s（%d 部）", season_key(sy, sm), date_str, len(snap))
    return hist


def backfill_from_cache(sy, sm, date_str, data_file=None, logger=None):
    """从 bangumi 缓存 JSON 回填一个快照点（用于补做历史）。"""
    if data_file is None:
        data_file = os.path.join(CACHE_DIR, "bangumi_%04d%02d.json" % (sy, sm))
    bgm = load_json(data_file, {}) or {}
    items = bgm.get("items") or []
    if not items:
        raise RuntimeError("回填数据为空：%s" % data_file)
    return record_snapshot(items, sy, sm, date_str, logger=logger)


if __name__ == "__main__":
    # 用法：python rating_history.py --backfill 2026-07 2026-08-09
    import argparse
    parser = argparse.ArgumentParser(description="评分历史回填工具")
    parser.add_argument("--backfill", nargs=2, metavar=("季", "日期"),
                        help="如：--backfill 2026-07 2026-08-09")
    args = parser.parse_args()
    if args.backfill:
        season, date_str = args.backfill
        sy, sm = int(season[:4]), int(season[5:7])
        hist = backfill_from_cache(sy, sm, date_str)
        print("OK snapshots:", list((hist.get("snapshots") or {}).keys()))
    else:
        parser.print_help()