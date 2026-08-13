# -*- coding: utf-8 -*-
"""字段中文化：把原作/动画制作/导演/系列构成·脚本/主要声优/标签里的日文转成中文。

策略：
1. 已知名词典优先（制作公司、知名声优、知名作者、出版社、知名作品名）；
2. 纯汉字名只做繁/日变体转简体（不调用翻译）；
3. 含假名的名字用 Google 翻译兜底，翻译后再用修正表纠正常见误译；
4. 幂等：已无假名的字段跳过，不重复翻译。
"""
import json
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_SCRIPTS_DIR = r"D:\ANIME\日本TV动画信息\scripts"
if os.path.isdir(_SCRIPTS_DIR) and _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from common import CACHE_DIR, _has_kana, simplify_cn


_CACHE_FILE = os.path.join(CACHE_DIR, "translate_cache.json")


def _load_cache():
    try:
        if os.path.exists(_CACHE_FILE):
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_cache():
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        tmp = _CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_TRANSLATE_CACHE, f, ensure_ascii=False)
        os.replace(tmp, _CACHE_FILE)
    except Exception:
        pass


# ---------------- 基础工具 ----------------

def has_kana(s):
    return _has_kana(str(s or ""))


_TRANSLATE_CACHE = _load_cache()


def google_ja_zh(text, timeout=20):
    """Google 免费翻译接口，ja -> zh-CN；失败返回原文。"""
    if not text or not has_kana(text):
        return text
    if text in _TRANSLATE_CACHE:
        return _TRANSLATE_CACHE[text]
    url = "https://translate.googleapis.com/translate_a/single"
    params = {"client": "gtx", "sl": "ja", "tl": "zh-CN", "dt": "t", "q": text}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=timeout,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            j = r.json()
            out = "".join(seg[0] for seg in j[0] if seg and seg[0]).strip()
            _TRANSLATE_CACHE[text] = out
            _save_cache()
            return out
        except Exception:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    return text


_CN_CHAR_FIX = str.maketrans({
    "鎌": "镰", "実": "实", "濱": "滨", "渕": "渊", "寛": "宽",
    "冴": "冴", "嶋": "岛", "邉": "边", "﨑": "崎", "髙": "高",
    "丼": "丼", "枦": "枦", "峰": "峰", "柊": "柊", "栖": "栖",
    "雫": "雫", "麗": "丽", "綾": "绫", "紗": "纱", "絢": "绚",
    "嵐": "岚", "條": "条", "都": "都", "総": "总", "線": "线",
    "瀬": "濑", "満": "满", "弾": "弹", "稲": "稻", "筿": "筱",
    "篠": "筱", "増": "增", "掲": "揭", "歩": "步", "円": "圆",
    "戦": "战", "眞": "真", "弐": "二", "輝": "辉", "陽": "阳",
    "広": "广", "戸": "户", "徳": "德",
})


def cjk_cn(s):
    """繁/日变体转简体 + 少量日文汉字修正 + 々 重复记号展开。"""
    s = simplify_cn(s)
    s = s.translate(_CN_CHAR_FIX)
    out = []
    prev = ""
    for ch in s:
        if ch == "々" and prev:
            ch = prev
        out.append(ch)
        if "\u4e00" <= ch <= "\u9fff":
            prev = ch
    return "".join(out)


def name_cn(s, kana_dict=None, fallback_translate=True):
    """把单个名字转中文：纯汉字直接转简体；含假名先查词典再 Google。"""
    if not s:
        return ""
    s = str(s).strip()
    if not has_kana(s):
        return cjk_cn(s)
    if kana_dict and s in kana_dict:
        return kana_dict[s]
    out = google_ja_zh(s)
    out = cjk_cn(out)
    return out


# ---------------- 制作公司词典 ----------------

STUDIO_CN = {
    "MAHO FILM": "MAHO FILM",
    "オーラスタジオ": "Aura Studio",
    "サイエンスSARU": "Science SARU",
    "サンライズ": "日升（SUNRISE）",
    "旭プロダクション": "旭Production",
    "動画工房": "动画工房",
    "サイピク": "CYPIC",
    "project No.9": "project No.9",
    "ゼロジー×セイバーワークス": "ZERO-G × Saber Works",
    "マジックバス×ピカンテサーカス、STUDIO POLON": "Magic Bus × Picante Circus、STUDIO POLON",
    "スタジオディーン": "Studio DEEN",
    "パッショーネ×ハヤブサフィルム": "Passione × Hayabusa Film",
    "UNEND": "UNEND",
    "BONES・ノーマッド": "BONES × NOMAD",
    "AtoriE": "AtoriE",
    "ニチカライン": "Nichika Line",
    "GoHands": "GoHands",
    "バイブリーアニメーションスタジオ": "Bibury Animation Studios",
    "エイトビット（8bit）": "8bit",
    "サテライト": "SATELIGHT",
    "CloverWorks": "CloverWorks",
    "ゼロジー×ZG-R": "ZERO-G × ZG-R",
    "Production I.G": "Production I.G",
    "WIT STUDIO": "WIT STUDIO",
    "NHKエンタープライズ": "NHK Enterprises",
    "OLM Division 3": "OLM Division 3",
    "A-1 Pictures×Psyde Kick Studio": "A-1 Pictures × Psyde Kick Studio",
    "ゼロジー×グラス": "ZERO-G × G-Lass",
    "Colored Pencil Animation Japan": "Colored Pencil Animation Japan",
    "フジテレビ、読売広告社、東映アニメーション": "富士电视台、读卖广告社、东映动画",
    "OLM Division 1・DONGWOO A&E": "OLM Division 1・DONGWOO A&E",
    "TROYCA": "TROYCA",
    "寺田虹輝(1-2)": "寺田虹辉（1-2）",
    "京都アニメーション": "京都动画",
    "KINEMA CITRUS": "KINEMA CITRUS",
}


def localize_studio(s):
    if not s:
        return ""
    if s in STUDIO_CN:
        return STUDIO_CN[s]
    if not has_kana(s):
        return s
    out = google_ja_zh(s)
    return cjk_cn(out)


# ---------------- 导演 / 脚本 词典 ----------------

DIRECTOR_CN = {
    "黒柳トシマサ": "黑柳丰正",
    "モコちゃん": "Moko酱",
    "つくも匠": "九十九匠",
    "オジング": "小神",
    "まついひとゆき": "松井仁之",
    "あおきえい": "青木英",
    "山﨑みつえ": "山崎美津枝",
    "森井ケンシロウ": "森井健四郎",
    "森あおい": "森葵",
    "宮嶋星矢・森井ケンシロウ": "宫岛星矢・森井健四郎",
    "板津匡覧(前篇) / 鎌倉由実(后篇)": "板津匡览（前篇） / 镰仓由实（后篇）",
    "森下柊聖[後藤圭二]": "森下柊圣［后藤圭二］",
}

SCRIPT_CN = {
    "あおしまたかし": "青岛崇",
    "あおしまたかし、藤本冴香": "青岛崇、藤本冴香",
    "赤尾でこ[三重野瞳] / 赤尾でこ[三重野瞳]": "赤尾凸［三重野瞳］ / 赤尾凸［三重野瞳］",
    "赤尾でこ（三重野瞳） / 赤尾でこ(三重野瞳)": "赤尾凸（三重野瞳） / 赤尾凸（三重野瞳）",
    "三津留ゆう / 三津留ゆう": "三津留优 / 三津留优",
    "伊丹あき": "伊丹秋",
    "大島のぞむ": "大岛望",
    "いぬいまい": "犬井麻衣",
    "イシノアツオ": "石野敦夫",
    "菊池たけし": "菊池武",
    "さがら総": "相乐总",
    "灰渕ヨツジ": "灰渊余司",
    "三沢ケイ": "三泽圭",
    "水埜なつ": "水野夏",
    "野澤ゆき子": "野泽雪子",
    "富樫じゅん": "富樫润",
    "かないねこ": "金井猫",
    "けんたろう": "健太郎",
    "えとうヨナ": "江藤由奈",
    "ユンボ": "云波",
    "オキモト・シュウ": "冲本修",
    "みっつばー": "三叶",
}


def _seg_cn(seg, kana_dict):
    """单个名字片段 -> 中文；处理末尾集数/读音括注。"""
    seg = seg.strip()
    if not seg:
        return ""
    if not has_kana(seg):
        return cjk_cn(seg)
    if seg in kana_dict:
        return kana_dict[seg]
    m = re.search(r"(\([^()]*\)|（[^（）]*）)$", seg)
    suffix = m.group(0) if m else ""
    core = seg[:m.start()].strip() if m else seg
    if core and not has_kana(core) and has_kana(suffix):
        return cjk_cn(core)
    if core and core != seg:
        core_cn = _seg_cn(core, kana_dict)
        if has_kana(suffix):
            suffix_cn = cjk_cn(google_ja_zh(suffix))
        else:
            suffix_cn = cjk_cn(suffix)
        return core_cn + suffix_cn
    return cjk_cn(google_ja_zh(seg))


def _localize_people(s, kana_dict):
    """导演/脚本：按分隔符拆成多个人名，逐个转中文后按原分隔符拼回。"""
    if not s:
        return ""
    if not has_kana(s):
        return cjk_cn(s)
    if s in kana_dict:
        return kana_dict[s]
    parts = re.split(r"( / |、|・|，|,)", s)
    out = []
    for p in parts:
        if p in (" / ", "、", "・", "，", ","):
            out.append(p)
        else:
            out.append(_seg_cn(p, kana_dict))
    return "".join(out)


def localize_director(s):
    return _localize_people(s, DIRECTOR_CN)


def localize_script(s):
    return _localize_people(s, SCRIPT_CN)


# ---------------- 声优词典（含假名的知名声优） ----------------

ACTOR_CN = {
    "ファイルーズあい": "菲鲁兹·蓝",
    "水瀬いのり": "水濑祈",
    "てらそままさき": "寺杣昌纪",
    "夏吉ゆうこ": "夏吉优子",
    "広瀬ゆうき": "广濑裕也",
    "日髙のり子": "日高范子",
    "田村ゆかり": "田村由香里",
    "行成とあ": "行成桃阿",
    "長縄まりあ": "长绳麻理亚",
    "いとうさとる": "伊藤聪",
    "うえだゆうじ": "上田祐司",
    "くじら": "鲸",
    "くまいもとこ": "熊井统子",
    "ゆかな": "尤加奈",
    "七海ひろき": "七海广希",
    "上原あゆみ": "上原步美",
    "中山まなか": "中山真奈香",
    "仲田ありさ": "仲田亚里沙",
    "仲町あられ": "仲町霰",
    "千石ユノ": "千石柚野",
    "叶矢りか": "叶矢梨华",
    "大原さやか": "大原沙耶香",
    "大森こころ": "大森心",
    "安堂ななこ": "安堂菜菜子",
    "宮永ののか": "宫永乃乃香",
    "岩田アンジ": "岩田安示",
    "岸尾だいすけ": "岸尾大辅",
    "市ノ瀬加那": "市之濑加那",
    "幾田りら": "幾田莉拉",
    "恒松あゆみ": "恒松步",
    "斎賀みつき": "斋贺美月",
    "日野まり": "日野真理",
    "春瀬なつみ": "春濑夏美",
    "東内マリ子": "东内玛丽子",
    "楠木ともり": "楠木灯",
    "潘めぐみ": "潘惠美",
    "福原かつみ": "福原克实",
    "結川あさき": "结川步",
    "船戸ゆり絵": "船户百合绘",
    "花守ゆみり": "花守由美里",
    "蜜蜂ほのか": "蜜蜂穗乃香",
    "西本りみ": "西本梨美",
    "諸星すみれ": "诸星堇",
    "豊口めぐみ": "丰口惠美",
    "郷田ほづみ": "乡田穗积",
    "鈴木みのり": "铃木实里",
    "阿保まりあ": "阿保麻里亚",
    "髙橋ミナミ": "高桥未奈美",
    "麦穂あんな": "麦穗安娜",
    "黒崎しおり": "黑崎诗织",
}


def localize_actor(s):
    if not s:
        return ""
    if not has_kana(s):
        return cjk_cn(s)
    if s in ACTOR_CN:
        return ACTOR_CN[s]
    return cjk_cn(google_ja_zh(s))


# ---------------- 角色名修正表 ----------------

CHAR_CN = {
    "ナレーション": "旁白",
    "モブキャラクター": "路人角色",
    "アナウンス": "广播员",
    "前世の男": "前世的男人",
    "リュウ": "隆",
    "ガイル": "盖尔",
    "春麗": "春丽",
    "豪鬼": "豪鬼",
    "ブランカ": "布兰卡",
    "キャミィ・ホワイト": "卡米·怀特",
    "ケン・マスターズ": "肯·马斯特斯",
    "アリアン": "亚丽安",
    "ポンタ": "彭塔",
    "アーク": "亚克",
    "カロリーナ": "卡罗琳娜",
    "フローラ": "芙罗拉",
    "アリア": "艾莉娅",
    "エド": "艾德",
    "フラン": "弗兰",
    "ガイル": "盖尔",
    "トツキ・シーナ": "十月·希娜",
    "カガリ・ミミ": "卡嘉莉·咪咪",
    "リジィ・セイラン": "丽兹·塞兰",
    "モード・アリ": "莫德·阿里",
    "アンハルト・ハルフレズ": "安哈尔特·哈弗雷斯",
    "ニノ・エスタ": "尼诺·埃斯塔",
    "空野かける": "空野翔",
    "三岳みなも": "三岳水面",
    "鴻蔵てる": "鸿藏辉",
    "鴻蔵まりか": "鸿藏麻里香",
    "鴻蔵ありさ": "鸿藏亚里沙",
    "鴻蔵弥栄子": "鸿藏弥荣子",
    "三ツ矢": "三矢",
    "ベリル・ガーデナント": "贝丽尔·加德南特",
    "アリューシア・シトラス": "阿留西亚·西特拉斯",
    "ルーシー・ダイアモンド": "露西·戴蒙德",
    "受付嬢": "前台小姐",
    "ミーシャ・テイル": "米莎·泰尔",
    "生徒": "学生",
    "ターニャ・デグレチャフ": "谭雅·德古雷查夫",
    "ヴィーシャ": "维莎",
    "リインフォースⅡ": "琳芙斯Ⅱ",
    "アンドロモン": "安杜路兽",
    "ボタモン": "波特兽",
    "プニモン": "普尼兽",
    "ポヨモン": "波约兽",
    "バブモン": "泡泡兽",
    "レアモン": "稀有兽",
    "スナイモン": "狙击兽",
    "マッシュモン": "蘑菇兽",
    "キイロイトリ": "黄色小鸟",
    "公安9課": "公安九课",
    "リインフォースⅡ": "强化二号",
    "レイジングハート": "旭日之心",
    "バルディッシュ": "巴鲁迪修",
    "キュアワンダフル": "美妙天使",
    "キュアフレンディ": "挚友天使",
    "キュアニャミー": "喵咪天使",
    "キュアリリアン": "百合天使",
    "キュアアイドル": "偶像天使",
    "キュアウインク": "眨眼天使",
    "キュアキュンキュン": "心动天使",
    "キュアズキューン": "啾心天使",
    "ジャンボキング": "巨型大王",
    "たのSEAフレンズ": "快乐的SEA朋友们",
    "こうさくくん": "小工君",
    "わたるくん": "小渡君",
    "あおいちゃん": "小葵",
    "かえるちゃん": "小青蛙",
    "ゆきんこ": "小雪人",
    "よびー": "小约比",
    "らき": "拉琪",
    "お市": "阿市",
    "お茶の水ひろし": "御茶水弘",
    "アルねこ": "阿尔猫",
    "アワワネコ": "阿哇哇猫",
    "カンサイねこ": "关西猫",
    "クロタマ": "黑玉",
    "クロバネ": "黑羽",
    "ごまみそ": "芝麻味噌",
    "手塚ぴょんたろう": "手冢蹦太郎",
    "魚住フナ": "鱼住船",
    "犬飼こむぎ": "犬饲小麦",
    "犬飼いろは": "犬饲彩羽",
    "猫屋敷ユキ": "猫屋敷雪",
    "猫屋敷まゆ": "猫屋敷真由",
    "咲良うた": "咲良歌",
    "蒼風なな": "苍风七奈",
    "紫雨こころ": "紫雨心",
    "プリルン": "普丽伦",
    "エドワード・エルリック": "爱德华·艾尔利克",
    "アルフォンス・エルリック": "阿尔冯斯·艾尔利克",
    "ショウ・タッカー": "肖·塔克",
    "ニーナ・タッカー": "妮娜·塔克",
    "黒崎一護": "黑崎一护",
    "朽木ルキア": "朽木露琪亚",
    "井上織姫": "井上织姬",
    "茶渡泰虎": "茶渡泰虎",
    "石田雨竜": "石田雨龙",
    "有沢竜貴": "有泽龙贵",
    "藍染惣右介": "蓝染惣右介",
    "グリムジョー・ジャガージャック": "葛力姆乔·贾卡杰克",
    "戸山香澄": "户山香澄",
    "花園たえ": "花园多惠",
    "牛込りみ": "牛込里美",
    "山吹沙綾": "山吹沙绫",
    "市ヶ谷有咲": "市谷有咲",
    "上原ひまり": "上原绯玛丽",
    "美竹蘭": "美竹兰",
    "青葉モカ": "青叶摩卡",
    "高町なのは": "高町奈叶",
    "フェイト・テスタロッサ": "菲特·泰斯塔罗莎",
    "八神はやて": "八神疾风",
    "草薙素子": "草薙素子",
    "バトー": "巴特",
    "トグサ": "户草",
    "イシカワ": "石川",
    "サイトー": "斋藤",
    "パズ": "帕兹",
    "ルーデウス・グレイラット": "鲁迪乌斯·格雷拉特",
    "シルフィエット・グレイラット": "希露菲叶特·格雷拉特",
    "エリス・グレイラット": "艾莉丝·格雷拉特",
    "ロキシー・ミグルディア・グレイラット": "洛琪希·米格路迪亚·格雷拉特",
    "パウロ・グレイラット": "保罗·格雷拉特",
    "ゼニス・グレイラット": "泽妮丝·格雷拉特",
    "リーリャ・グレイラット": "莉莉雅·格雷拉特",
    "神崎直": "神崎直",
    "秋山深一": "秋山深一",
    "マツバラフミオ": "松原文夫",
    "ミウラタカヨシ": "三浦孝吉",
    "ダンノダイスケ": "团野大辅",
    "マキハラユキ": "牧原雪",
    "ミヤハラヒトミ": "宫原瞳",
    "アズールレーン": "碧蓝航线",
    "転生したらスライムだった件": "关于我转生变成史莱姆这档事",
    "天は赤い河のほとり": "天是红河岸",
    "幼女戦記": "幼女战记",
    "令和のダラさん": "令和的懒散君",
    "おでかけ子ザメ": "外出小鲨鱼",
}


def localize_character(s):
    if not s:
        return ""
    if not has_kana(s):
        return cjk_cn(s)
    if s in CHAR_CN:
        return CHAR_CN[s]
    return cjk_cn(google_ja_zh(s))


def localize_cast(cast):
    """声优字段：'角色（声优）、角色（声优）…' -> 中文。"""
    if not cast:
        return ""
    entries = [e.strip() for e in str(cast).split("、") if e.strip()]
    out = []
    for e in entries:
        m = re.match(r"^(.*)（([^（）]*)）$", e)
        if m:
            cname, aname = m.group(1).strip(), m.group(2).strip()
            cn = localize_character(cname)
            an = localize_actor(aname)
            out.append("%s（%s）" % (cn, an))
        else:
            out.append(localize_character(e))
    return "、".join(out)


# ---------------- 原作字段 ----------------

PUB_CN = [
    ("株式会社KADOKAWA", "KADOKAWA"),
    ("角川スニーカー文庫", "角川Sneaker文库"),
    ("カドカワBOOKS", "KADOKAWA BOOKS"),
    ("オーバーラップノベルス", "OVERLAP Novels"),
    ("コミックガルド", "Comic Gardo"),
    ("GA文庫", "GA文库"),
    ("GAノベル", "GA Novels"),
    ("SBクリエイティブ", "SB Creative"),
    ("講談社", "讲谈社"),
    ("モーニングKC", "Morning KC"),
    ("KCデラックス", "KC Deluxe"),
    ("月刊少年マガジン", "月刊少年Magazine"),
    ("週刊少年サンデー", "周刊少年Sunday"),
    ("週刊少年ジャンプ", "周刊少年Jump"),
    ("ジャンプコミックス", "Jump Comics"),
    ("ヤングジャンプコミックスDIGITAL", "Young Jump Comics Digital"),
    ("週刊ヤングジャンプ", "周刊Young Jump"),
    ("少年ジャンプ＋", "少年Jump+"),
    ("月刊少年シリウス", "月刊少年Sirius"),
    ("月刊少年ガンガン", "月刊少年Gangan"),
    ("少年ガンガン", "少年Gangan"),
    ("ビッグガンガン", "Big Gangan"),
    ("ウルトラジャンプ", "Ultra Jump"),
    ("別冊マーガレット", "别册Margaret"),
    ("ゲッサン", "Gessan"),
    ("週刊コロコロコミック", "周刊Corocoro Comic"),
    ("月刊コミックアライブ", "月刊Comic Alive"),
    ("コミック百合姫", "Comic百合姬"),
    ("comic POOL", "Comic POOL"),
    ("COMICポラリス", "Comic Polaris"),
    ("フレックスコミックス", "Flex Comics"),
    ("MFコミックス フラッパーシリーズ", "MF Comics Flapper系列"),
    ("一迅社ノベルス", "一迅社Novels"),
    ("一迅社", "一迅社"),
    ("小学館クリエイティブ", "小学馆Creative"),
    ("小学館", "小学馆"),
    ("マンガワン", "MangaONE"),
    ("集英社", "集英社"),
    ("ホビージャパン", "Hobby Japan"),
    ("HJノベルス", "HJ Novels"),
    ("HJ文庫", "HJ文库"),
    ("HJコミックス", "HJ Comics"),
    ("コミックファイア", "Comic Fire"),
    ("TOブックス", "TO Books"),
    ("MFブックス", "MF Books"),
    ("MF文庫J", "MF文库J"),
    ("フラッパーシリーズ", "Flapper系列"),
    ("GCノベルズ", "GC Novels"),
    ("マイクロマガジン社", "Micro Magazine社"),
    ("SQEXノベル", "SQEX Novels"),
    ("スクウェア・エニックス", "史克威尔艾尼克斯"),
    ("白泉社", "白泉社"),
    ("花とゆめコミックス", "花与梦Comics"),
    ("秋田書店", "秋田书店"),
    ("スターツ出版文庫", "Starts出版文库"),
    ("スターツ出版", "Starts出版"),
    ("アース・スター エンターテイメント", "Earth Star Entertainment"),
    ("アース・スターノベル", "Earth Star Novels"),
    ("アース・スター ルナ", "Earth Star Luna"),
    ("宝島社", "宝岛社"),
    ("月刊ComicREX", "月刊Comic REX"),
    ("ヤングマガジン", "Young Magazine"),
    ("モーニング・ツー", "Morning Two"),
    ("good!アフタヌーン", "good!Afternoon"),
    ("LINEマンガ", "LINE漫画"),
    ("KAエスマ文庫", "KA Esuma文库"),
    ("京都アニメーション", "京都动画"),
    ("アズールレーン", "碧蓝航线"),
    ("ブシロード", "Bushiroad（武士道）"),
    ("サンエックス(San-X)", "San-X"),
    ("タカラトミーアーツ", "TAKARA TOMY Arts"),
    ("シンソフィア", "Sin Sophia"),
    ("メテオアーク社", "Meteor Arc社"),
    ("キルクスコレクション協会", "基尔库斯收藏协会"),
]

AUTHOR_CN = {
    "理不尽な孫の手": "不讲理的孙之手",
    "こしたてつひろ": "小立哲宏",
    "カルロ・ゼン": "卡罗·森",
    "東堂いづみ": "东堂泉",
    "みっつばー": "三叶",
    "さがら総": "相乐总",
    "あおしまたかし": "青岛崇",
    "赤尾でこ": "赤尾凸",
    "志馬なにがし": "志马那尼加什",
    "はぐれメタボ": "走失的胖墩",
    "秤猿鬼": "秤猿鬼",
    "あおのなち": "青野梨",
    "あてきち": "阿特基",
    "あーもんど": "杏仁",
    "えぞぎんぎつね": "虾夷银狐",
    "えろき": "绘罗木",
    "おつじ": "小辻",
    "とよ田みのる": "丰田实",
    "とーわ": "十和",
    "にゃんにゃんファクトリー": "喵喵工房",
    "サワノアキラ": "泽野明",
    "オザキアキラ": "尾崎晶",
    "タカキツヨシ": "高木刚",
    "タンバ": "丹波",
    "トマトスープ": "番茄汤",
    "ハム男": "火腿男",
    "ビュー": "视图",
    "ペンギンボックス": "企鹅盒子",
    "ホリ": "堀",
    "米織": "米织",
    "地主": "地主",
    "守雨": "守雨",
    "猫子": "猫子",
    "風楼": "风楼",
    "蒼木スピカ": "苍木角宿一",
    "水埜なつ": "水野夏",
    "三沢ケイ": "三泽圭",
    "野澤ゆき子": "野泽雪子",
    "富樫じゅん": "富樫润",
    "かないねこ": "金井猫",
    "けんたろう": "健太郎",
    "えとうヨナ": "江藤由奈",
    "ユンボ": "云波",
    "オキモト・シュウ": "冲本修",
    "佐賀崎しげる": "佐贺崎茂",
    "鍋島テツヒロ": "锅岛哲弘",
    "ともつか治臣": "友塚治臣",
    "川上泰樹": "川上泰树",
    "伏瀬": "伏濑",
    "こしたてつひろ": "小立哲宏",
    "中村力斗": "中村力斗",
    "白石新": "白石新",
    "武六甲理衣": "武六甲理衣",
    "星月子猫": "星月子猫",
    "雲雀湯": "云雀汤",
    "香月美夜": "香月美夜",
    "結城弘": "结城弘",
    "坂石遊作": "坂石游作",
    "西条真二": "西条真二",
    "阿賀沢紅茶": "阿贺泽红茶",
    "氷川へきる": "冰川碧",
    "井上堅二": "井上坚二",
    "吉岡公威": "吉冈公威",
    "岩田雪花": "岩田雪花",
    "青木裕": "青木裕",
    "椎橋寛": "椎桥宽",
    "池田祐輝": "池田祐辉",
    "甲斐谷忍": "甲斐谷忍",
    "松井優征": "松井优征",
    "久保帯人": "久保带人",
    "高橋留美子": "高桥留美子",
    "荒川弘": "荒川弘",
    "三原和人": "三原和人",
    "三嶋与夢": "三嶋与梦",
    "士郎正宗": "士郎正宗",
    "中条比紗也": "中条比纱也",
    "中村颯希": "中村飒希",
    "江島絵理": "江岛绘理",
    "岩原裕二": "岩原裕二",
    "長月達平": "长月达平",
    "篠原千絵": "筱原千绘",
    "朝霧カフカ": "朝雾卡夫卡",
    "亜樹直": "亚树直",
    "都築真紀": "都筑真纪",
    "西修": "西修",
    "矢立肇": "矢立肇",
    "佐々木泉": "佐佐木泉",
    "アマラ": "阿玛拉",
    "クレハ": "红羽",
    "コノシロしんこ": "小野白真子",
    "おおのいも": "大野芋",
}


def _localize_source_name(name):
    """原作字段里的作者名/团体名 -> 中文。"""
    name = name.strip()
    if not name:
        return ""
    if name in AUTHOR_CN:
        return AUTHOR_CN[name]
    # 多个作者用 ・ 分隔
    if "・" in name:
        return "・".join(_localize_source_name(p) for p in name.split("・") if p.strip())
    if not has_kana(name):
        return cjk_cn(name)
    out = google_ja_zh(name)
    out = cjk_cn(out)
    if out in AUTHOR_CN.values() or not has_kana(out):
        return out
    return out


KANA_TERM_CN = {
    "の": "的",
    "に": "于",
    "を": "把",
    "は": "是",
    "と": "和",
    "で": "在",
    "より": "自",
    "から": "从",
    "していく": "",
    "している": "中",
}


def _kana_runs_cn(s):
    """把残留的连续假名片段翻译成中文（先查小词典，再 Google）。"""
    def repl(m):
        run = m.group(0)
        if run in KANA_TERM_CN:
            return KANA_TERM_CN[run]
        return cjk_cn(google_ja_zh(run))
    return re.sub(r"[\u3041-\u3096\u30a1-\u30fa\u30fc\uff66-\uff9f]+", repl, s)


def _source_part_cn(p):
    """原作字段的一个分号段：处理「漫画：/作画：」子段与作者括注。"""
    subs = re.split(r"(漫画[:：]|作画[:：])", p)
    out = []
    for sub in subs:
        if sub in ("漫画：", "漫画:", "作画：", "作画:"):
            out.append(sub)
            continue
        m = re.match(r"^(.*?)([（(].*)$", sub)
        if m:
            head = _localize_source_name(m.group(1).strip())
            tail = m.group(2)
            # 头部是假名、括注是纯汉字名时（如 サワノアキラ(澤野明)），以括注为准并去掉
            m2 = re.match(r"^[（(]([^（）()]*)[）)]", tail)
            if m2 and re.fullmatch(r"[\u4e00-\u9fff·]{1,8}", m2.group(1)):
                head = cjk_cn(m2.group(1))
                tail = tail[len(m2.group(0)):]
            out.append(head + cjk_cn(tail))
        else:
            out.append(_localize_source_name(sub))
    return "".join(out)


def localize_source(src):
    """原作字段：保留作者与出版社关系结构，把日文转中文。"""
    if not src:
        return ""
    s = str(src)
    # 1. 出版社/杂志/作品名词典替换
    for ja, cn in sorted(PUB_CN, key=lambda kv: -len(kv[0])):
        s = s.replace(ja, cn)
    s = s.replace("／", "/")
    s = s.replace("「", "《").replace("」", "》")
    s = s.replace("『", "《").replace("』", "》")
    # 2. 按 ；/；拆段
    parts = re.split(r"(；)", s)
    res = []
    for p in parts:
        if p == "；":
            res.append(p)
            continue
        if not p.strip():
            continue
        res.append(_source_part_cn(p))
    # 3. 兜底残余假名片段
    out = _kana_runs_cn("".join(res))
    return out


# ---------------- 标签 ----------------

def localize_tags(tags):
    if not tags:
        return ""
    s = tags.replace("東映アニメーション", "东映动画")
    return cjk_cn(s)


# ---------------- 条目级入口 ----------------

FIELDS = ("source", "studio", "director", "script", "cast", "tags")


def localize_item(item):
    """返回中文化后的新条目；未匹配/无对应字段的保持原样。"""
    x = dict(item)
    x["source"] = localize_source(item.get("source") or "")
    x["studio"] = localize_studio(item.get("studio") or "")
    x["director"] = localize_director(item.get("director") or "")
    x["script"] = localize_script(item.get("script") or "")
    x["cast"] = localize_cast(item.get("cast") or "")
    x["tags"] = localize_tags(item.get("tags") or "")
    return x


def localize_items(items, progress=None):
    out = []
    for i, it in enumerate(items, start=1):
        out.append(localize_item(it))
        if progress:
            progress(i, len(items))
    return out
