# ANIME

日本 TV 动画相关的两个项目：

- `anime-season-auto/`：日本 TV 动画季度信息自动采集（yuc.wiki + Bangumi → Word/PPT → 邮件 → 按季度存档）
- `anime-tracker/`：番剧记录桌面应用（Electron，按年 × 季度记录追番进度，全离线）

## anime-season-auto

- 抓取 yuc.wiki 当季番剧清单，Bangumi 详情/评分/声优
- 每季度 季前 / 初期 / 中期 / 末期 生成 Word + PPT 并自动发邮件
- 通过 Windows 任务计划程序每天 09:30 自动运行（详见目录内 README）
- 邮件配置请复制 `config.example.json` 为 `config.json` 后填写（仓库内不含任何真实凭据）

## anime-tracker

- Electron 桌面应用，全中文界面，记录每季度追番与集数进度
- 支持统计看板、评分短评、下载目录识别、Excel 导入导出
- 数据保存在本地 `%APPDATA%\anime-tracker\data.json`，应用离线运行

## 安全说明

本仓库公开，已剔除所有个人配置、邮箱地址与 SMTP 授权码。请勿提交 `config.json`、`_runtime/` 等本地运行产物。