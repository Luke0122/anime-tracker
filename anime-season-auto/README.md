# 日本TV动画季度信息自动采集

自动抓取 yuc.wiki + Bangumi 数据，生成 Word + PPT 文档，并通过 QQ 邮箱发送到指定邮箱。
全部由 Windows 任务计划程序（Task Scheduler）每天自动执行，不依赖 Codex。

## 目录结构

    D:\ANIME\日本TV动画信息\
    ├─ scripts\                # 本套脚本
    │  ├─ run_job.py           # 主调度器（每天运行）
    │  ├─ fetch_yuc.py         # 抓取 yuc.wiki 季度番剧清单
    │  ├─ fetch_bangumi.py     # 抓取 Bangumi 详情/评分/声优
    │  ├─ build_info_docx.py   # 生成新番信息 Word
    │  ├─ build_info_pptx.py   # 生成新番信息 PPT
    │  ├─ build_rating_docx.py # 生成评分汇总 Word
    │  ├─ build_rating_pptx.py # 生成评分汇总 PPT
    │  ├─ pptx_common.py       # PPT 样式（莫兰迪浅色主题）
    │  ├─ send_email.py        # QQ 邮箱 SMTP 发送
    │  ├─ common.py            # 公共工具与文档样式
    │  ├─ config.example.json  # 配置样例（复制为 config.json 使用）
    │  └─ _runtime\            # 日志、缓存、任务状态（自动生成）
    ├─ 2026年7月\              # 每个季度一个文件夹，存放 Word / PPT 文档
    ├─ 2026年10月\
    └─ ...

## 季度日程

| 季度 | 季前信息 | 评分·初期 | 评分·中期 | 评分·末期 |
|------|----------|-----------|-----------|-----------|
| 1月  | 12/15    | 1/20      | 2/20      | 4/5       |
| 4月  | 3/15     | 4/20      | 5/20      | 7/5       |
| 7月  | 6/15     | 7/20      | 8/20      | 10/5      |
| 10月 | 9/15     | 10/20     | 11/20     | 次年1/5   |

每天 09:30 由任务计划程序调用 `run_job.py`：
命中触发日则执行；失败的任务保持待重试状态，第二天自动再试；
已生成的文档不会重复生成（幂等）。

## PPT 说明

- 每份文档同时输出 Word 和 PPT 两个版本，邮件一并附带；
- PPT 为 16:9 宽屏，莫兰迪浅色主题（米灰底 + 鼠尾草绿点缀）；
- 新番信息 PPT：封面 → 统计概览 → 一览表 → 每部番一页（封面 + 详细信息 + 简介）；
- 评分 PPT：封面 → 分档统计 → 评分总表（按评分着色）→ Top10 亮点；
- PPT 封面统一使用 Bangumi common 尺寸图，体积小、适合邮件发送。

## 常用命令

    # 手动立即执行一次（例如补做 2026年7月季信息）
    "C:\Users\sah10\miniconda3\python.exe" run_job.py --job info --season 2026-07 --force

    # 补做评分快照（标题会标注“补做”和日期）
    "C:\Users\sah10\miniconda3\python.exe" run_job.py --job snapshot --season 2026-07 --date 2026-08-08 --force

    # 模拟某个日期，看会执行什么（不生成文件）
    "C:\Users\sah10\miniconda3\python.exe" run_job.py --date 2026-09-15 --dry-run

    # 发送测试邮件
    "C:\Users\sah10\miniconda3\python.exe" run_job.py --test-email

## 查看/管理定时任务

    schtasks /query /tn AnimeSeasonAuto
    schtasks /delete /tn AnimeSeasonAuto /f      # 删除任务
    schtasks /run /tn AnimeSeasonAuto            # 立即手动触发一次

## QQ 邮箱 SMTP 配置

1. 打开 https://mail.qq.com → 设置 → 账号 → 开启“POP3/IMAP/SMTP 服务”；
2. 按提示生成“授权码”；
3. 把 `config.example.json` 复制为 `config.json`，再把授权码填入 `smtp_auth_code` 字段（仅保存在本地）。

注意：授权码等于邮箱密码，请勿把 config.json 发给他人或上传到任何地方。


## 季末评分趋势复盘 PPT（新增）

每个季度末期（1/5、4/5、7/5、10/5）在生成“评分·末期”文档之后，自动再生成一份
**评分趋势季末复盘 PPT**（Project Status Report 模板版），包含：

- 全季平均评分走势折线图；
- 热门/高分番（末期评分 Top20 ∪ 评分人数 Top10，去重后最多 30 部）
  的初期 → 中期 → 末期评分折线图；
- 文件命名：`<季度>评分趋势-季末复盘-<日期>.pptx`，存入对应季度文件夹；
- 邮件正文为 HTML 排版摘要，附件为趋势 PPT，同时发送到 QQ 邮箱与 Outlook（抄送）。

评分快照会在每次评分任务执行时写入 `_runtime\data\rating_history_<季>.json`；
2026年7月季已回填 2026-08-09 补做点，10/5 末期将生成第一份正式趋势复盘。

    # 手动生成趋势复盘（需评分历史已有末期快照）
    "C:\Users\sah10\miniconda3\python.exe" run_job.py --job trend --season 2026-07 --date 2026-10-05 --force

    # 回填评分历史（从 bangumi 缓存补一个快照点）
    "C:\Users\sah10\miniconda3\python.exe" rating_history.py --backfill 2026-07 2026-08-09

## 错过自动补做（重要）

如果当天关机 / 未登录导致 09:30 的任务没跑，`run_job.py` 会在之后任意一次运行时
自动补做错过的任务：只针对“已启用流水线的季度”（当前季度或已有任务记录的季度），
评分 / 趋势任务在触发日后 45 天内有效；文件名带实际补做日期。

例如 10/5 关机错过，10/6 开机后会自动补做“评分-末期-2026-10-06”和
“评分趋势-季末复盘-2026-10-06”，并自动发邮件。
