# -*- coding: utf-8 -*-
"""主调度器：每天运行一次，命中季度日程或存在待重试任务时执行并发送邮件。

用法：
  python run_job.py                      # 按当天日期自动判断
  python run_job.py --date 2026-09-15    # 模拟某天（结合 --dry-run 测试）
  python run_job.py --dry-run            # 只打印将执行的任务
  python run_job.py --job info --season 2026-07 --force            # 补做/强制生成新番信息
  python run_job.py --job snapshot --season 2026-07 --date 2026-08-08 --force  # 补做评分快照
  python run_job.py --job trend --season 2026-07 --date 2026-10-05 --force       # 生成季末评分趋势 PPT
  python run_job.py --test-email         # 发送测试邮件

错过的触发日（如当天关机/未登录）会在之后任意一次运行时自动补做，
有效期 45 天；只有“已启用流水线的季度”（当前季度或已有任务记录的季度）才会补。
"""
import argparse
import datetime
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (CACHE_DIR, DATA_ROOT, STATE_FILE, add_months, ensure_dirs, load_config,
                    load_json, reconfigure_console, save_json, season_dir, season_key,
                    season_label, setup_logging, today)
import email_content
import fetch_bangumi
import fetch_yuc
import build_info_docx
import build_rating_docx
import build_info_pptx
import build_rating_pptx
import build_trend_pptx
import rating_history
import send_email
import localize

JOB_INFO = "info"
JOB_EARLY = "early"
JOB_MID = "mid"
JOB_END = "end"
JOB_SNAPSHOT = "snapshot"
JOB_TREND = "trend"

JOB_TYPES = (JOB_INFO, JOB_EARLY, JOB_MID, JOB_END, JOB_SNAPSHOT, JOB_TREND)
JOB_ORDER = {JOB_INFO: 0, JOB_EARLY: 1, JOB_MID: 2, JOB_END: 3, JOB_SNAPSHOT: 4, JOB_TREND: 5}
RATING_PHASES = {JOB_EARLY: "初期", JOB_MID: "中期", JOB_END: "末期", JOB_SNAPSHOT: "补做"}
JOB_LABELS = {JOB_INFO: "新番信息", JOB_EARLY: "评分-初期", JOB_MID: "评分-中期",
              JOB_END: "评分-末期", JOB_SNAPSHOT: "评分-补做", JOB_TREND: "评分趋势"}
SEASON_MONTHS = (1, 4, 7, 10)


def trigger_dates(season_year, season_month):
    info_y, info_m = add_months(season_year, season_month, -1)
    early_y, early_m = add_months(season_year, season_month, 0)
    mid_y, mid_m = add_months(season_year, season_month, 1)
    end_y, end_m = add_months(season_year, season_month, 3)
    end = datetime.date(end_y, end_m, 5)
    return {
        JOB_INFO: datetime.date(info_y, info_m, 15),
        JOB_EARLY: datetime.date(early_y, early_m, 20),
        JOB_MID: datetime.date(mid_y, mid_m, 20),
        JOB_END: end,
        JOB_TREND: end,
    }


def season_of(d):
    m = d.month
    sm = 1 if m <= 3 else 4 if m <= 6 else 7 if m <= 9 else 10
    sy = d.year if m >= sm else d.year - 1
    return sy, sm


def candidate_seasons(d):
    sy, sm = season_of(d)
    out = [(sy, sm)]
    out.append(add_months(sy, sm, -3))
    out.append(add_months(sy, sm, 3))
    out.append(add_months(sy, sm, 6))
    return out


def job_key(job_type, sy, sm):
    return "%s:%s" % (season_key(sy, sm), job_type)


def scheduled_jobs(d):
    jobs = []
    for sy, sm in candidate_seasons(d):
        for jt, td in trigger_dates(sy, sm).items():
            if td == d:
                jobs.append((jt, sy, sm))
    return jobs


def started_seasons(state):
    """从任务状态中解析出已启用流水线的季度。"""
    out = set()
    for key in (state.get("jobs") or {}):
        parts = key.split(":")
        if len(parts) >= 2 and len(parts[0]) == 7 and parts[0][4] == "-":
            try:
                out.add((int(parts[0][:4]), int(parts[0][5:7])))
            except ValueError:
                pass
    return out


def missed_jobs(d):
    """已错过触发日、仍在有效期内、且该季度已启用流水线的任务（自动补做）。"""
    st = load_state()
    started = started_seasons(st)
    started.add(season_of(d))
    state_keys = set((st.get("jobs") or {}).keys())
    jobs = []
    for sy, sm in candidate_seasons(d):
        if (sy, sm) not in started:
            continue
        for jt, td in trigger_dates(sy, sm).items():
            if td >= d:
                continue
            if is_expired(jt, sy, sm, d):
                continue
            if job_key(jt, sy, sm) in state_keys:
                continue
            jobs.append((jt, sy, sm))
    return jobs


def is_expired(job_type, sy, sm, d):
    if job_type == JOB_INFO:
        return d >= datetime.date(sy, sm, 1)
    td = trigger_dates(sy, sm).get(job_type)
    if td is None:
        return True
    return d > td + datetime.timedelta(days=45)


def load_state():
    st = load_json(STATE_FILE, {}) or {}
    st.setdefault("jobs", {})
    return st


def output_paths(job_type, sy, sm, label, d):
    sdir = season_dir(sy, sm)
    if job_type == JOB_INFO:
        return [
            os.path.join(sdir, "%s新番信息.docx" % label),
            os.path.join(sdir, "%s新番信息.pptx" % label),
        ]
    if job_type == JOB_TREND:
        return [os.path.join(sdir, "%s评分趋势-季末复盘-%s.pptx" % (label, d.isoformat()))]
    fname = "%s评分-%s-%s" % (label, RATING_PHASES[job_type], d.isoformat())
    return [
        os.path.join(sdir, fname + ".docx"),
        os.path.join(sdir, fname + ".pptx"),
    ]


def ensure_data(yyyymm_key, sy, sm, cfg, refresh_bangumi):
    yuc = fetch_yuc.load_or_fetch(sy, sm, refresh=False)
    shows = yuc.get("shows") or []
    if not shows:
        raise RuntimeError("yuc.wiki 页面为空或尚未发布（%s）" % yyyymm_key)
    bgm = fetch_bangumi.load_or_fetch(shows, sy, sm, cfg, refresh=refresh_bangumi)
    items = localize.localize_items(bgm.get("items") or [])
    return yuc, items


def execute_job(job_type, sy, sm, cfg, force=False, sim_date=None, no_email=False, logger=None):
    d = sim_date or today()
    label = season_label(sy, sm)
    outputs = output_paths(job_type, sy, sm, label, d)
    if outputs and all(os.path.exists(p) for p in outputs) and not force:
        logger.info("已存在输出文件，跳过：%s", " / ".join(outputs))
        return {"status": "done", "output": outputs[0], "skipped": True}

    trend_summary = None
    if job_type == JOB_TREND:
        # 趋势复盘只依赖本地评分历史（末期快照由同日稍早的 end 任务写入），无需联网抓取
        trend_summary = build_trend_pptx.build(sy, sm, outputs[0],
                                               generated_at=d.isoformat(), logger=logger)
        logger.info("文档已生成：%s", outputs[0])
    else:
        refresh = job_type in (JOB_EARLY, JOB_MID, JOB_END)
        yuc, items = ensure_data(season_key(sy, sm), sy, sm, cfg, refresh_bangumi=refresh)
        if job_type == JOB_INFO:
            build_info_docx.build(yuc, items, sy, sm, outputs[0], generated_at=d.isoformat())
            build_info_pptx.build(yuc, items, sy, sm, outputs[1], generated_at=d.isoformat())
        else:
            build_rating_docx.build(items, sy, sm, RATING_PHASES[job_type], outputs[0], generated_at=d.isoformat())
            build_rating_pptx.build(items, sy, sm, RATING_PHASES[job_type], outputs[1], generated_at=d.isoformat())
            try:
                rating_history.record_snapshot(items, sy, sm, d.isoformat(), logger=logger)
            except Exception as e:
                logger.warning("评分历史记录失败（不影响文档生成）：%s", e)
        logger.info("文档已生成：%s", " / ".join(outputs))

    email_sent = False
    if cfg.get("send_email", True) and not no_email:
        try:
            subject = "%s %s（自动生成）" % (label, JOB_LABELS[job_type])
            body = "附件为%s，请查收。\n生成时间：%s\n数据来源：yuc.wiki + Bangumi" % (JOB_LABELS[job_type], d.isoformat())
            if job_type == JOB_INFO:
                html_body = email_content.build_info_html(label, items, d.isoformat())
            elif job_type == JOB_TREND:
                html_body = email_content.build_trend_html(label, sy, sm, trend_summary, d.isoformat())
            else:
                html_body = email_content.build_rating_html(label, RATING_PHASES[job_type], items, d.isoformat())
            send_email.send_email(cfg, subject, body, outputs, logger=logger, html_body=html_body)
            email_sent = True
        except Exception as e:
            logger.warning("邮件发送失败（文档已生成）：%s", e)
    else:
        logger.info("未发送邮件（send_email=false / --no-email / 未配置授权码）")
    return {"status": "done", "output": outputs[0], "email_sent": email_sent}


def run_all(d, force=False, dry_run=False, no_email=False):
    logger = setup_logging()
    logger.info("===== 开始运行（日期：%s）=====", d.isoformat())
    jobs = []
    for jt, sy, sm in scheduled_jobs(d):
        jobs.append((jt, sy, sm))
    st = load_state()
    for key, rec in (st.get("jobs") or {}).items():
        if rec.get("status") == "done":
            continue
        parts = key.split(":")
        if len(parts) != 2:
            continue
        sk = parts[0]
        jt = parts[1]
        try:
            sy, sm = int(sk[:4]), int(sk[5:7])
        except ValueError:
            continue
        if jt not in JOB_TYPES:
            continue
        if is_expired(jt, sy, sm, d):
            logger.info("任务已过期，不再重试：%s", key)
            continue
        jobs.append((jt, sy, sm))

    # 自动补做：已错过触发日但在有效期内、且该季度已启用流水线的任务
    for jt, sy, sm in missed_jobs(d):
        logger.info("发现错过任务，自动补做：%s %s", season_label(sy, sm), JOB_LABELS[jt])
        jobs.append((jt, sy, sm))

    seen = set()
    unique = []
    for j in jobs:
        k = job_key(j[0], j[1], j[2])
        if k not in seen:
            seen.add(k)
            unique.append(j)
    unique.sort(key=lambda j: (JOB_ORDER.get(j[0], 99), j[1], j[2]))

    if not unique:
        logger.info("今天没有需要执行的任务。")
        return 0

    st = load_state()
    for jt, sy, sm in unique:
        key = job_key(jt, sy, sm)
        label = season_label(sy, sm)
        logger.info("执行任务：%s %s", label, JOB_LABELS[jt])
        if dry_run:
            for p in output_paths(jt, sy, sm, label, d):
                logger.info("[dry-run] 将生成：%s", p)
            continue
        try:
            rec = execute_job(jt, sy, sm, cfg, force=force, sim_date=d, no_email=no_email, logger=logger)
            st.setdefault("jobs", {})[key] = {
                "status": rec["status"],
                "output": rec.get("output"),
                "email_sent": rec.get("email_sent", False),
                "updated": datetime.datetime.now().isoformat(timespec="seconds"),
            }
        except Exception as e:
            logger.error("任务失败：%s %s -> %s", label, JOB_LABELS[jt], e)
            logger.error(traceback.format_exc())
            st.setdefault("jobs", {})[key] = {
                "status": "pending",
                "last_error": str(e)[:500],
                "updated": datetime.datetime.now().isoformat(timespec="seconds"),
            }
    save_json(STATE_FILE, st)
    logger.info("===== 运行结束 =====")
    return 0


def main():
    reconfigure_console()
    parser = argparse.ArgumentParser(description="日本TV动画季度信息自动任务")
    parser.add_argument("--date", help="模拟日期 YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="只打印将执行的任务")
    parser.add_argument("--force", action="store_true", help="已存在也重新生成")
    parser.add_argument("--no-email", action="store_true", help="本次不发送邮件")
    parser.add_argument("--job", choices=JOB_TYPES, help="指定任务类型")
    parser.add_argument("--season", help="指定季度 YYYY-MM（与 --job 搭配）")
    parser.add_argument("--test-email", action="store_true", help="发送一封测试邮件")
    args = parser.parse_args()

    ensure_dirs()
    global cfg
    cfg = load_config()
    logger = setup_logging()

    if args.test_email:
        try:
            send_email.send_email(cfg, "动漫信息自动化测试邮件",
                                  "这是一封测试邮件。如果你的定时任务配置成功，未来生成的文档会以附件形式发送到本邮箱。",
                                  [], logger=logger)
            print("TEST EMAIL OK")
            return 0
        except Exception as e:
            logger.error("测试邮件失败：%s", e)
            print("TEST EMAIL FAIL: %s" % e)
            return 1

    d = datetime.date.fromisoformat(args.date) if args.date else today()

    if args.job:
        if not args.season:
            print("使用 --job 时必须同时指定 --season（如 2026-07）")
            return 2
        sy, sm = int(args.season[:4]), int(args.season[5:7])
        if sm not in SEASON_MONTHS:
            print("季度月份必须是 1/4/7/10 月")
            return 2
        if args.dry_run:
            for p in output_paths(args.job, sy, sm, season_label(sy, sm), d):
                print("[dry-run] %s %s -> %s" % (season_label(sy, sm), JOB_LABELS[args.job], p))
            return 0
        rec = execute_job(args.job, sy, sm, cfg, force=args.force, sim_date=d,
                          no_email=args.no_email, logger=logger)
        st = load_state()
        st.setdefault("jobs", {})[job_key(args.job, sy, sm)] = {
            "status": rec["status"], "output": rec.get("output"),
            "email_sent": rec.get("email_sent", False),
            "updated": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        save_json(STATE_FILE, st)
        return 0

    return run_all(d, force=args.force, dry_run=args.dry_run, no_email=args.no_email)


cfg = None

if __name__ == "__main__":
    sys.exit(main())