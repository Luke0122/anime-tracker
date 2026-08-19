# 番剧记录（Anime Tracker）

一个本地优先的 Windows 桌面应用（Electron），按「年 × 季度」记录你的追番进度：状态、集数、评分、短评、每集观看记录，并支持统计看板、下载目录识别、Excel 导入导出与 JSON 备份。全中文界面，粉色深色主题。

> 新番信息自动化管线（抓取 yuc.wiki / Bangumi 生成季度 docx / pptx 报告）已迁移到独立仓库：[Luke0122/anime-season-auto](https://github.com/Luke0122/anime-season-auto)。

## 功能特性

- **季度组织**：左侧按 1 月 / 4 月 / 7 月 / 10 月分组，与追番节奏一致。
- **进度管理**：卡片「＋1 集」一键推进，到达总集数自动标记「看完」；支持一键完成、随时编辑。
- **观看记录**：每集可记录观看时间，支持补看与回溯修改。
- **当季新番选番**：添加番剧时默认从「当季新番」列表选择，自动填充集数、更新日、简介、封面；已添加过的番剧显示「已添加」标记，避免重复。
- **老番搜索**：「搜 Bangumi」自动补全总集数、简介、封面、评分；断网时自动降级为手动填写。
- **统计看板**：追番总数、在看/看完、累计集数、完成率、平均评分、高分 Top 5、季度对比、每月观看趋势。
- **下载目录识别**：扫描下载文件夹（如 `D:\ANIME\花织`），自动识别番名与已下载集数，提示「已下载到第 X 集，但只看到第 Y 集」。
- **导入 / 导出**：导入旧版「已经 将要 看.xlsx」（自动去重）；导出样式化 Excel（总览 / 季度明细 / 全部记录）；导出 / 导入 JSON 完整备份（导入前自动备份当前数据）。
- **自动备份**：每天 / 每周自动把数据备份成带日期的 JSON 到指定文件夹（建议放入同步盘），保留最近 N 份；数据损坏时自动从最近备份恢复。

## 数据来源

- 「添加番剧 → 当季新番」**只从 [yuc.wiki](https://yuc.wiki/) 获取**：在线实时抓取（带 24 小时缓存），断网时回退到应用内置的 yuc.wiki 季度目录（2019-10 至今）。
- 「搜 Bangumi」仅用于添加时补全番剧信息，不作为当季新番列表来源。
- 不再从 Word（docx）或季度文件夹里的 JSON 读取新番列表。

## 快速开始

### 绿色版（推荐）

直接双击 `anime-tracker/dist/番剧记录.exe`（Windows x64，免安装）。

### 开发运行

```bash
cd anime-tracker
npm install        # 首次
npm start          # 启动应用
npm test           # 运行测试（node --test）
npm run dist       # 重新打包绿色版 exe
```

要求：Node.js 18+（Electron 37）。

## 数据与备份

- 数据保存在 `%APPDATA%\anime-tracker\data.json`（应用「设置」页可查看路径）。
- 每次修改都会刷新当日备份（`backups/`，保留最近 30 份）。
- 多设备同步：把整个 `anime-tracker` 数据目录放入同步盘，配合「自动备份」设置。

## 项目结构

```
anime-tracker/
├── main.js / preload.js      # Electron 主进程与安全桥
├── lib/
│   ├── store.js              # 数据持久化（原子写入 + 自动备份 + 损坏恢复）
│   ├── seasonData.js         # 季度数据源（yuc.wiki 实时 + 内置目录）
│   ├── yucLive.js            # yuc.wiki 页面解析（剔除 HTML 注释隐藏的先行放送卡片）
│   ├── bangumi.js            # Bangumi 搜索 API 客户端
│   ├── scanner.js            # 下载目录扫描与文件名解析
│   ├── excel.js              # Excel 导入（新旧格式）与样式化导出
│   ├── docxParser.js         # docx 表格解析（保留工具，应用已不再依赖）
│   └── backup.js             # 自动备份导出
├── renderer/                 # 界面（原生 HTML/CSS/JS，粉色深色主题）
├── data/
│   ├── yuc-catalog.json      # 内置 yuc.wiki 历史季度目录（离线兜底）
│   └── covers/               # 内置番剧封面
└── tests/                    # 单元测试（node --test，39 个用例）
```

## 常见问题

- **断网时「当季新番」能用吗？** 能，会回退到内置的 yuc.wiki 季度目录。
- **为什么 2026 年 7 月只有一部「无职转生」？** yuc.wiki 会把已结束的「首周先行放送」卡片用 HTML 注释隐藏，解析器会先剔除注释，避免同一部番重复出现。
- **数据目录在哪？** `%APPDATA%\anime-tracker\data.json`，应用内「设置」页可见。
- **绿色版要联网吗？** 除「当季新番实时抓取」和「搜 Bangumi」外全部离线可用。

## License

MIT License