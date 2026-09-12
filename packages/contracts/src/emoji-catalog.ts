/**
 * 站点表情目录（单一权威来源）。
 *
 * 两种形态共用一份目录：
 * - 纯文本条目（Unicode 表情、颜文字）插入为 `text` 节点，`text` 即正文内容；
 * - 自定义条目（自带 PNG 资源）插入为持久化的行内原子节点 `emoji`，
 *   图片由 `GET /api/emoji/:emojiId/image` 提供，正文只保存 `emojiId` 与相对 `src`。
 *
 * `id` 是持久化契约的一部分：一经发布不可改名或复用，下线只会让历史正文
 * 降级为 `fallback` 文本（净化器对未知 id 不报错）。
 */

/** 自定义表情图片在 API 侧的路由前缀。 */
export const EMOJI_ASSET_PATH_PREFIX = "/api/emoji";

/** 自定义表情支持的自带图片格式；`.gif` 保留站点表情包里的动图。 */
export const EMOJI_ASSET_EXTENSIONS = ["gif", "png"] as const;

/** 自带图片格式到响应 MIME 的映射。 */
export const EMOJI_ASSET_MIME_TYPES: Readonly<
  Record<(typeof EMOJI_ASSET_EXTENSIONS)[number], string>
> = {
  gif: "image/gif",
  png: "image/png",
};

/** 触发浮层默认展示的候选条目数量，避免面板一次渲染过多条目。 */
export const DEFAULT_EMOJI_QUERY_LIMIT = 8;

/** 表情条目标识：与 {@link EntityIdSchema} 兼容，可在 URL 路径中直接使用。 */
export const EMOJI_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** 表情目录中的单个条目。 */
export interface EmojiCatalogEntry {
  /** 稳定标识；自定义表情同时是图片文件名（`<id>.png`）与 URL 段落。 */
  id: string;
  /** 所属分组 ID，对应 {@link EMOJI_GROUPS}。 */
  groupId: string;
  /** 中文名，用于 aria-label、tooltip 与图片 `alt`。 */
  name: string;
  /** 搜索词；除名称与 id 外额外匹配（含拼音首字母，例如 `wx` 命中「微笑」）。 */
  keywords: string[];
  /** 要写入正文的文本：Unicode 表情字符或整串颜文字。 */
  text: string;
  /** 可选索引／简写标注，例如颜文字组的 `kao1`。 */
  label?: string;
  /** 快捷输入码，例如 `hh`、`wx`。 */
  shortcodes?: string[];
  /**
   * 自带图片的文件名（位于 API 静态表情目录内）。只有自定义表情有值：
   * 站点表情包沿用既有中文文件名，因此显式记录而不是从 id 推导。
   */
  assetFile?: string;
}

/** 表情分组。`custom` 之外的分组都是纯文本条目，不需要图片资源。 */
export const EMOJI_GROUPS = [
  { id: "faces", label: "表情" },
  { id: "gestures", label: "手势" },
  { id: "symbols", label: "符号" },
  { id: "kaomoji", label: "颜文字" },
  { id: "custom", label: "站点表情" },
] as const;

/** 分组 ID 联合类型。 */
export type EmojiGroupId = (typeof EMOJI_GROUPS)[number]["id"];

/** 自定义表情所见即所得的图片路由；非自定义条目返回 `null`。 */
export function emojiAssetPath(emojiId: string): string | null {
  return hasEmojiAsset(emojiId) ? `${EMOJI_ASSET_PATH_PREFIX}/${emojiId}/image` : null;
}

/** 自定义表情的磁盘文件名（位于 API 的静态表情目录内）；非自定义条目返回 `null`。 */
export function emojiAssetFileName(emojiId: string): string | null {
  return findEmojiEntry(emojiId)?.assetFile ?? null;
}

/** 自带图片的响应 MIME；无资源或未知后缀时返回 `null`。 */
export function emojiAssetMimeType(emojiId: string): string | null {
  const file = emojiAssetFileName(emojiId);
  if (!file) return null;
  const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return extension in EMOJI_ASSET_MIME_TYPES
    ? EMOJI_ASSET_MIME_TYPES[extension as keyof typeof EMOJI_ASSET_MIME_TYPES]
    : null;
}

/** 该表情是否为自带图片资源的自定义表情。 */
export function hasEmojiAsset(emojiId: string): boolean {
  return findEmojiEntry(emojiId)?.assetFile !== undefined;
}

/**
 * 静态缩略图的文件名与 MIME。
 *
 * 面板与候选浮层一次要显示十几个 500×500 的动图，直接渲染开销很大，
 * 因此动图用构建期生成的首帧缩略图（`thumbs/<id>.png`）展示，
 * 只有真正写进正文的图片才用完整动图。
 */
export function emojiThumbnailFileName(emojiId: string): string | null {
  const assetFile = findEmojiEntry(emojiId)?.assetFile;
  return assetFile?.toLowerCase().endsWith(".gif") ? `${emojiId}.png` : null;
}

/** 缩略图的完整访问路径；没有缩略图（非动图或未知 id）时返回 `null`。 */
export function emojiThumbnailPath(emojiId: string): string | null {
  return emojiThumbnailFileName(emojiId)
    ? `${EMOJI_ASSET_PATH_PREFIX}/${emojiId}/image?frame=first`
    : null;
}

/** 缩略图的响应 MIME；索引色 PNG 固定为 image/png。 */
export function emojiThumbnailMimeType(emojiId: string): string | null {
  return emojiThumbnailFileName(emojiId) ? "image/png" : null;
}

/** 按 id 查找目录条目。 */
export function findEmojiEntry(emojiId: string): EmojiCatalogEntry | undefined {
  return EMOJI_CATALOG.find((entry) => entry.id === emojiId);
}

/** 纯文本表情：Unicode 表情、手势与符号。 */
export const TEXT_EMOJI_ENTRIES: readonly EmojiCatalogEntry[] = [
  {
    id: "smile",
    groupId: "faces",
    name: "微笑",
    text: "😀",
    keywords: ["微笑", "开心", "wx", "smile"],
    shortcodes: ["wx", "smile"],
  },
  {
    id: "laugh",
    groupId: "faces",
    name: "大笑",
    text: "😄",
    keywords: ["大笑", "高兴", "dx", "laugh"],
  },
  {
    id: "grin",
    groupId: "faces",
    name: "呲牙",
    text: "😁",
    keywords: ["呲牙", "嘿嘿", "cy", "grin"],
  },
  {
    id: "joy",
    groupId: "faces",
    name: "笑哭",
    text: "😂",
    keywords: ["笑哭", "笑cry", "xk", "joy"],
  },
  {
    id: "wink",
    groupId: "faces",
    name: "眨眼",
    text: "😉",
    keywords: ["眨眼", "调皮", "zy", "wink"],
  },
  {
    id: "cry",
    groupId: "faces",
    name: "流泪",
    text: "😢",
    keywords: ["流泪", "难过", "ll", "cry"],
  },
  {
    id: "sob",
    groupId: "faces",
    name: "大哭",
    text: "😭",
    keywords: ["大哭", "痛哭", "dk", "sob"],
  },
  {
    id: "angry",
    groupId: "faces",
    name: "生气",
    text: "😡",
    keywords: ["生气", "愤怒", "sq", "angry"],
  },
  {
    id: "surprised",
    groupId: "faces",
    name: "惊讶",
    text: "😮",
    keywords: ["惊讶", "吃惊", "jy", "surprised"],
  },
  {
    id: "shy",
    groupId: "faces",
    name: "害羞",
    text: "😊",
    keywords: ["害羞", "腼腆", "hx", "shy"],
  },
  {
    id: "think",
    groupId: "faces",
    name: "思考",
    text: "🤔",
    keywords: ["思考", "想想", "sk", "think"],
  },
  {
    id: "sweat",
    groupId: "faces",
    name: "汗",
    text: "😅",
    keywords: ["流汗", "尴尬", "han", "sweat"],
  },
  {
    id: "sleep",
    groupId: "faces",
    name: "困",
    text: "😴",
    keywords: ["睡觉", "困", "shuijiao", "sleep"],
  },
  { id: "cool", groupId: "faces", name: "酷", text: "😎", keywords: ["酷", "墨镜", "ku", "cool"] },
  {
    id: "love",
    groupId: "faces",
    name: "花痴",
    text: "😍",
    keywords: ["喜欢", "爱慕", "xa", "love"],
  },
  {
    id: "dizzy",
    groupId: "faces",
    name: "晕",
    text: "😵",
    keywords: ["晕", "头晕", "yun", "dizzy"],
  },
  {
    id: "speechless",
    groupId: "faces",
    name: "无语",
    text: "😑",
    keywords: ["无语", "面无表情", "wy", "speechless"],
  },
  {
    id: "pray",
    groupId: "faces",
    name: "祈祷",
    text: "🙏",
    keywords: ["祈祷", "拜托", "qd", "pray"],
  },
  {
    id: "ok",
    groupId: "gestures",
    name: "OK",
    text: "👌",
    keywords: ["好的", "没问题", "ok", "hd"],
  },
  {
    id: "thumbs-up",
    groupId: "gestures",
    name: "赞",
    text: "👍",
    keywords: ["赞", "顶", "支持", "zan", "ding"],
  },
  {
    id: "thumbs-down",
    groupId: "gestures",
    name: "踩",
    text: "👎",
    keywords: ["踩", "反对", "cai", "bad"],
  },
  {
    id: "clap",
    groupId: "gestures",
    name: "鼓掌",
    text: "👏",
    keywords: ["鼓掌", "拍手", "gz", "clap"],
  },
  {
    id: "wave",
    groupId: "gestures",
    name: "挥手",
    text: "👋",
    keywords: ["挥手", "打招呼", "hs", "wave"],
  },
  {
    id: "fist",
    groupId: "gestures",
    name: "拳头",
    text: "✊",
    keywords: ["拳头", "加油", "qt", "fist"],
  },
  {
    id: "muscle",
    groupId: "gestures",
    name: "肌肉",
    text: "💪",
    keywords: ["肌肉", "力量", "jl", "muscle"],
  },
  {
    id: "handshake",
    groupId: "gestures",
    name: "握手",
    text: "🤝",
    keywords: ["握手", "合作", "ws", "handshake"],
  },
  {
    id: "point-right",
    groupId: "gestures",
    name: "指右",
    text: "👉",
    keywords: ["指", "右侧", "zyou", "point"],
  },
  {
    id: "point-up",
    groupId: "gestures",
    name: "指上",
    text: "👆",
    keywords: ["指", "上面", "shang", "point"],
  },
  {
    id: "heart",
    groupId: "symbols",
    name: "爱心",
    text: "❤️",
    keywords: ["爱", "心", "喜欢", "ax", "heart"],
  },
  {
    id: "broken-heart",
    groupId: "symbols",
    name: "心碎",
    text: "💔",
    keywords: ["心碎", "伤心", "xs", "broken"],
  },
  {
    id: "star",
    groupId: "symbols",
    name: "星星",
    text: "⭐",
    keywords: ["星", "收藏", "xing", "star"],
  },
  {
    id: "sparkles",
    groupId: "symbols",
    name: "闪光",
    text: "✨",
    keywords: ["闪光", "闪亮", "sg", "sparkle"],
  },
  {
    id: "fire",
    groupId: "symbols",
    name: "火",
    text: "🔥",
    keywords: ["火", "热门", "huo", "fire"],
  },
  {
    id: "tada",
    groupId: "symbols",
    name: "庆祝",
    text: "🎉",
    keywords: ["庆祝", "撒花", "qz", "tada"],
  },
  {
    id: "gift",
    groupId: "symbols",
    name: "礼物",
    text: "🎁",
    keywords: ["礼物", "礼包", "lw", "gift"],
  },
  {
    id: "rose",
    groupId: "symbols",
    name: "玫瑰",
    text: "🌹",
    keywords: ["玫瑰", "花", "mg", "rose"],
  },
  {
    id: "coffee",
    groupId: "symbols",
    name: "咖啡",
    text: "☕",
    keywords: ["咖啡", "休息", "kf", "coffee"],
  },
  {
    id: "bulb",
    groupId: "symbols",
    name: "灯泡",
    text: "💡",
    keywords: ["灵感", "点子", "dp", "idea"],
  },
  {
    id: "warning",
    groupId: "symbols",
    name: "警告",
    text: "⚠️",
    keywords: ["警告", "注意", "jz", "warning"],
  },
  {
    id: "check",
    groupId: "symbols",
    name: "对勾",
    text: "✅",
    keywords: ["对", "完成", "wancheng", "check"],
  },
  {
    id: "cross",
    groupId: "symbols",
    name: "叉",
    text: "❌",
    keywords: ["错", "否", "cuo", "cross"],
  },
  {
    id: "question",
    groupId: "symbols",
    name: "问号",
    text: "❓",
    keywords: ["疑问", "问号", "wh", "question"],
  },
  {
    id: "exclamation",
    groupId: "symbols",
    name: "叹号",
    text: "❗",
    keywords: ["感叹", "注意", "th", "exclamation"],
  },
  {
    id: "arrow-right",
    groupId: "symbols",
    name: "右箭头",
    text: "➡️",
    keywords: ["箭头", "右", "jiantou", "arrow"],
  },
  {
    id: "arrow-left",
    groupId: "symbols",
    name: "左箭头",
    text: "⬅️",
    keywords: ["箭头", "左", "jiantou", "arrow"],
  },
  {
    id: "crescent",
    groupId: "symbols",
    name: "月牙",
    text: "🌙",
    keywords: ["月亮", "晚安", "yueliang", "moon"],
  },
  {
    id: "sun",
    groupId: "symbols",
    name: "太阳",
    text: "☀️",
    keywords: ["太阳", "晴天", "taiyang", "sun"],
  },
  {
    id: "cloud",
    groupId: "symbols",
    name: "云",
    text: "☁️",
    keywords: ["云", "阴天", "yun", "cloud"],
  },
  { id: "snow", groupId: "symbols", name: "雪", text: "❄️", keywords: ["雪", "冷", "xue", "snow"] },
  {
    id: "pencil",
    groupId: "symbols",
    name: "铅笔",
    text: "✏️",
    keywords: ["铅笔", "写", "qb", "pencil"],
  },
  {
    id: "book",
    groupId: "symbols",
    name: "书",
    text: "📖",
    keywords: ["书", "阅读", "shu", "book"],
  },
  {
    id: "lock",
    groupId: "symbols",
    name: "锁",
    text: "🔒",
    keywords: ["锁", "保密", "suo", "lock"],
  },
  {
    id: "key",
    groupId: "symbols",
    name: "钥匙",
    text: "🔑",
    keywords: ["钥匙", "解锁", "ys", "key"],
  },
  {
    id: "crown",
    groupId: "symbols",
    name: "皇冠",
    text: "👑",
    keywords: ["皇冠", "第一", "hg", "crown"],
  },
  {
    id: "trophy",
    groupId: "symbols",
    name: "奖杯",
    text: "🏆",
    keywords: ["奖杯", "冠军", "jb", "trophy"],
  },
  {
    id: "medal",
    groupId: "symbols",
    name: "奖牌",
    text: "🏅",
    keywords: ["奖牌", "荣誉", "jp", "medal"],
  },
  {
    id: "rocket",
    groupId: "symbols",
    name: "火箭",
    text: "🚀",
    keywords: ["火箭", "起飞", "hj", "rocket"],
  },
  {
    id: "eyes",
    groupId: "symbols",
    name: "围观",
    text: "👀",
    keywords: ["围观", "看看", "wg", "eyes"],
  },
  {
    id: "kao-happy",
    groupId: "kaomoji",
    name: "开心",
    text: "(*^▽^*)",
    keywords: ["开心", "高兴", "kx"],
    label: "kao1",
  },
  {
    id: "kao-laugh",
    groupId: "kaomoji",
    name: "大笑",
    text: "(≧▽≦)",
    keywords: ["大笑", "笑", "dx"],
    label: "kao2",
  },
  {
    id: "kao-cry",
    groupId: "kaomoji",
    name: "大哭",
    text: "(T_T)",
    keywords: ["哭", "难过", "ku"],
    label: "kao3",
  },
  {
    id: "kao-sob",
    groupId: "kaomoji",
    name: "抽泣",
    text: "(;_;)",
    keywords: ["哭", "眼泪", "yanlei"],
    label: "kao4",
  },
  {
    id: "kao-angry",
    groupId: "kaomoji",
    name: "生气",
    text: "(╬ Ò﹏Ó)",
    keywords: ["生气", "愤怒", "sq"],
    label: "kao5",
  },
  {
    id: "kao-sweat",
    groupId: "kaomoji",
    name: "冷汗",
    text: "(￣▽￣;)",
    keywords: ["汗", "尴尬", "gan"],
    label: "kao6",
  },
  {
    id: "kao-shy",
    groupId: "kaomoji",
    name: "害羞",
    text: "(*/ω＼*)",
    keywords: ["害羞", "脸红", "lianhong"],
    label: "kao7",
  },
  {
    id: "kao-wink",
    groupId: "kaomoji",
    name: "眨眼",
    text: "(^_-)",
    keywords: ["眨眼", "调皮", "tiaopi"],
    label: "kao8",
  },
  {
    id: "kao-salute",
    groupId: "kaomoji",
    name: "敬礼",
    text: "o7",
    keywords: ["敬礼", "收到", "shoudao"],
    label: "kao9",
  },
  {
    id: "kao-thanks",
    groupId: "kaomoji",
    name: "感谢",
    text: "m(_ _)m",
    keywords: ["感谢", "谢谢", "xiexie"],
    label: "kao10",
  },
  {
    id: "kao-hands-up",
    groupId: "kaomoji",
    name: "举手",
    text: "\\o/",
    keywords: ["举手", "欢呼", "huanhu"],
    label: "kao11",
  },
  {
    id: "kao-joy",
    groupId: "kaomoji",
    name: "撒花",
    text: "ヽ(°▽°)ノ",
    keywords: ["撒花", "欢呼", "sahua"],
    label: "kao12",
  },
  {
    id: "kao-shrug",
    groupId: "kaomoji",
    name: "摊手",
    text: "┑(￣Д ￣)┍",
    keywords: ["摊手", "无奈", "wunai"],
    label: "kao13",
  },
  {
    id: "kao-sleepy",
    groupId: "kaomoji",
    name: "困",
    text: "(=_=)",
    keywords: ["困", "睡觉", "shuijiao"],
    label: "kao14",
  },
  {
    id: "kao-stunned",
    groupId: "kaomoji",
    name: "呆",
    text: "(⊙_⊙)",
    keywords: ["呆", "惊讶", "jingya"],
    label: "kao15",
  },
  {
    id: "kao-oh",
    groupId: "kaomoji",
    name: "哦",
    text: "(￣▽￣)",
    keywords: ["哦", "明白", "mingbai"],
    label: "kao16",
  },
  {
    id: "kao-please",
    groupId: "kaomoji",
    name: "拜托",
    text: "(人´▽`)",
    keywords: ["拜托", "求", "qiu"],
    label: "kao17",
  },
  {
    id: "kao-cat",
    groupId: "kaomoji",
    name: "猫",
    text: "(=^･ω･^=)",
    keywords: ["猫", "喵", "miao"],
    label: "kao18",
  },
  {
    id: "kao-bear",
    groupId: "kaomoji",
    name: "熊",
    text: "ʕ•ᴥ•ʔ",
    keywords: ["熊", "可爱", "keai"],
    label: "kao19",
  },
  {
    id: "kao-rabbit",
    groupId: "kaomoji",
    name: "兔子",
    text: "(・x・)",
    keywords: ["兔子", "tu"],
    label: "kao20",
  },
  {
    id: "kao-run",
    groupId: "kaomoji",
    name: "跑",
    text: "≡┏|*´･Д･|┓",
    keywords: ["跑", "溜了", "liule"],
    label: "kao21",
  },
  {
    id: "kao-heart",
    groupId: "kaomoji",
    name: "比心",
    text: "(♡´▽`♡)",
    keywords: ["爱心", "比心", "bixin"],
    label: "kao22",
  },
  {
    id: "kao-cry-big",
    groupId: "kaomoji",
    name: "泪奔",
    text: "(╥﹏╥)",
    keywords: ["泪奔", "哭", "leiben"],
    label: "kao23",
  },
  {
    id: "kao-dizzy",
    groupId: "kaomoji",
    name: "晕",
    text: "(@_@)",
    keywords: ["晕", "头晕", "touyun"],
    label: "kao24",
  },
  {
    id: "kao-music",
    groupId: "kaomoji",
    name: "哼歌",
    text: "♪(´▽`)",
    keywords: ["唱歌", "音乐", "yinyue"],
    label: "kao25",
  },
  {
    id: "kao-thinking",
    groupId: "kaomoji",
    name: "沉思",
    text: "(－_－)",
    keywords: ["思考", "沉默", "chenmo"],
    label: "kao26",
  },
  {
    id: "kao-ok",
    groupId: "kaomoji",
    name: "好",
    text: "(・∀・)",
    keywords: ["好", "可以", "keyi"],
    label: "kao27",
  },
  {
    id: "kao-panic",
    groupId: "kaomoji",
    name: "慌张",
    text: "(°Д°)",
    keywords: ["慌张", "震惊", "zhenjing"],
    label: "kao28",
  },
  {
    id: "kao-proud",
    groupId: "kaomoji",
    name: "得意",
    text: "(￣ω￣)",
    keywords: ["得意", "自信", "zixin"],
    label: "kao29",
  },
  {
    id: "kao-depressed",
    groupId: "kaomoji",
    name: "沮丧",
    text: "(´･_･`)",
    keywords: ["沮丧", "低落", "diluo"],
    label: "kao30",
  },
  {
    id: "kao-bow",
    groupId: "kaomoji",
    name: "鞠躬",
    text: "_(_ _)_",
    keywords: ["鞠躬", "谢谢", "xiexie"],
    label: "kao31",
  },
  {
    id: "kao-hug",
    groupId: "kaomoji",
    name: "抱抱",
    text: "(づ｡◕‿‿◕｡)づ",
    keywords: ["抱抱", "拥抱", "yongbao"],
    label: "kao32",
  },
  {
    id: "kao-cheer",
    groupId: "kaomoji",
    name: "应援",
    text: "＼(^o^)／",
    keywords: ["应援", "加油", "jiayou"],
    label: "kao33",
  },
  {
    id: "kao-glad",
    groupId: "kaomoji",
    name: "安心",
    text: "(´▽`ʃ♡ƪ)",
    keywords: ["安心", "满足", "manzu"],
    label: "kao34",
  },
  {
    id: "kao-hungry",
    groupId: "kaomoji",
    name: "馋",
    text: "(￣﹃￣)",
    keywords: ["馋", "饿", "e"],
    label: "kao35",
  },
  {
    id: "kao-scorn",
    groupId: "kaomoji",
    name: "嫌弃",
    text: "(￣ヘ￣)",
    keywords: ["嫌弃", "不屑", "buxie"],
    label: "kao36",
  },
  {
    id: "kao-cold",
    groupId: "kaomoji",
    name: "寒",
    text: "(；一_一)",
    keywords: ["寒冷", "冷场", "lengchang"],
    label: "kao37",
  },
  {
    id: "kao-smirk",
    groupId: "kaomoji",
    name: "坏笑",
    text: "(￣ー￣)ゞ",
    keywords: ["坏笑", "偷笑", "touxiao"],
    label: "kao38",
  },
  {
    id: "kao-clap",
    groupId: "kaomoji",
    name: "鼓掌",
    text: "ヽ(￣ω￣(￣ω￣〃)ゞ",
    keywords: ["鼓掌", "拍手", "paishou"],
    label: "kao39",
  },
  {
    id: "kao-star",
    groupId: "kaomoji",
    name: "星星眼",
    text: "(☆▽☆)",
    keywords: ["星星眼", "期待", "qidai"],
    label: "kao40",
  },
];

/** 节日与天气：论坛活动常用的一批补充条目。 */
export const EXTRA_EMOJI_ENTRIES: readonly EmojiCatalogEntry[] = [
  {
    id: "santa",
    groupId: "symbols",
    name: "圣诞老人",
    text: "🎅",
    keywords: ["圣诞", "节日", "shengdan"],
  },
  {
    id: "jack-o-lantern",
    groupId: "symbols",
    name: "南瓜灯",
    text: "🎃",
    keywords: ["万圣节", "南瓜", "nangua"],
  },
  {
    id: "fireworks",
    groupId: "symbols",
    name: "烟花",
    text: "🎆",
    keywords: ["烟花", "庆祝", "yanhua"],
  },
  {
    id: "balloon",
    groupId: "symbols",
    name: "气球",
    text: "🎈",
    keywords: ["气球", "生日", "shengri"],
  },
  {
    id: "cake",
    groupId: "symbols",
    name: "蛋糕",
    text: "🎂",
    keywords: ["蛋糕", "生日", "shengri"],
  },
  {
    id: "bamboo",
    groupId: "symbols",
    name: "粽子",
    text: "🍚",
    keywords: ["米饭", "吃饭", "chifan"],
  },
  { id: "tea", groupId: "symbols", name: "茶", text: "🍵", keywords: ["茶", "喝茶", "hecha"] },
  {
    id: "beer",
    groupId: "symbols",
    name: "啤酒",
    text: "🍺",
    keywords: ["啤酒", "干杯", "ganbei"],
  },
  {
    id: "hotpot",
    groupId: "symbols",
    name: "火锅",
    text: "🍲",
    keywords: ["火锅", "聚餐", "juocan"],
  },
  { id: "cat", groupId: "symbols", name: "猫", text: "🐱", keywords: ["猫", "喵", "miao"] },
  { id: "dog", groupId: "symbols", name: "狗", text: "🐶", keywords: ["狗", "汪", "wang"] },
  {
    id: "panda",
    groupId: "symbols",
    name: "熊猫",
    text: "🐼",
    keywords: ["熊猫", "国宝", "guobao"],
  },
  {
    id: "rainbow",
    groupId: "symbols",
    name: "彩虹",
    text: "🌈",
    keywords: ["彩虹", "好运", "haoyun"],
  },
  {
    id: "blossom",
    groupId: "symbols",
    name: "花",
    text: "🌸",
    keywords: ["樱花", "花", "yinghua"],
  },
  { id: "leaf", groupId: "symbols", name: "叶子", text: "🍃", keywords: ["叶子", "风", "feng"] },
  { id: "paw", groupId: "symbols", name: "爪印", text: "🐾", keywords: ["爪印", "萌", "meng"] },
  {
    id: "bomb",
    groupId: "symbols",
    name: "炸弹",
    text: "💣",
    keywords: ["炸弹", "爆炸", "baozha"],
  },
  { id: "zzz", groupId: "symbols", name: "打呼", text: "💤", keywords: ["困", "睡觉", "shuijiao"] },
  { id: "sos", groupId: "symbols", name: "求救", text: "🆘", keywords: ["求救", "求助", "qiuzhu"] },
  {
    id: "hundred",
    groupId: "symbols",
    name: "满分",
    text: "💯",
    keywords: ["满分", "厉害", "lihai"],
  },
  {
    id: "wave-hand",
    groupId: "gestures",
    name: "再见",
    text: "🤚",
    keywords: ["再见", "拜拜", "baibai"],
  },
  {
    id: "pray-hands",
    groupId: "gestures",
    name: "合掌",
    text: "🤲",
    keywords: ["合掌", "请求", "qingqiu"],
  },
  {
    id: "write",
    groupId: "gestures",
    name: "写作",
    text: "✍️",
    keywords: ["写作", "记录", "jilu"],
  },
  { id: "nose", groupId: "faces", name: "捂脸", text: "🤦", keywords: ["捂脸", "无奈", "wunai"] },
  {
    id: "shrug",
    groupId: "faces",
    name: "耸肩",
    text: "🤷",
    keywords: ["耸肩", "不知道", "buzhidao"],
  },
  {
    id: "nervous",
    groupId: "faces",
    name: "紧张",
    text: "😰",
    keywords: ["紧张", "担心", "danxin"],
  },
  {
    id: "confused",
    groupId: "faces",
    name: "困惑",
    text: "😕",
    keywords: ["困惑", "不解", "bujie"],
  },
  {
    id: "smirk",
    groupId: "faces",
    name: "得意",
    text: "😏",
    keywords: ["得意", "坏笑", "huaixiao"],
  },
  {
    id: "neutral",
    groupId: "faces",
    name: "平静",
    text: "😐",
    keywords: ["平静", "无表情", "wubiaoqing"],
  },
  {
    id: "rolling",
    groupId: "faces",
    name: "翻白眼",
    text: "🙄",
    keywords: ["翻白眼", "无语", "wuyu"],
  },
  {
    id: "whistle",
    groupId: "faces",
    name: "吹口哨",
    text: "😗",
    keywords: ["口哨", "轻快", "qingkuai"],
  },
];

/**
 * 站点自定义表情包：正文里持久化为 `emoji` 原子节点，图片由
 * `GET /api/emoji/:emojiId/image` 从 `apps/api/src/assets/emoji/` 提供。
 *
 * `id` 是持久化契约的一部分，发布后不可改名或复用；`assetFile` 指向仓库里
 * 的实际文件（沿用表情包原文件名），`fallback` 是图片加载失败时的降级文本。
 */
export const CUSTOM_EMOJI_ENTRIES: readonly EmojiCatalogEntry[] = [
  {
    id: "hug",
    groupId: "custom",
    name: "抱抱",
    text: "🤗",
    keywords: ["抱抱", "拥抱", "安慰", "hh", "bb", "hug"],
    shortcodes: ["bb", "hug"],
    assetFile: "抱抱.gif",
  },
  {
    id: "pfft",
    groupId: "custom",
    name: "噗呲",
    text: "🤭",
    keywords: ["噗呲", "偷笑", "笑喷", "pc"],
    shortcodes: ["pc"],
    assetFile: "噗呲.gif",
  },
  {
    id: "nose-pinch",
    groupId: "custom",
    name: "捏鼻",
    text: "🤏",
    keywords: ["捏鼻", "嫌弃", "臭", "nb"],
    assetFile: "捏鼻.gif",
  },
  {
    id: "face-pick",
    groupId: "custom",
    name: "扣脸",
    text: "🤞",
    keywords: ["扣脸", "无聊", "抠", "kl"],
    assetFile: "扣脸.gif",
  },
  {
    id: "milk-tea",
    groupId: "custom",
    name: "喝奶茶",
    text: "🧋",
    keywords: ["奶茶", "喝水", "摸鱼", "nc"],
    shortcodes: ["nc"],
    assetFile: "喝奶茶.gif",
  },
  {
    id: "cheek-pinch",
    groupId: "custom",
    name: "捏脸",
    text: "🤏",
    keywords: ["捏脸", "可爱", "软", "nl"],
    assetFile: "捏脸.gif",
  },
  {
    id: "middle-finger",
    groupId: "custom",
    name: "中指",
    text: "🖕",
    keywords: ["中指", "反对", "抗议", "zz"],
    assetFile: "中指.gif",
  },
  {
    id: "shy-sticker",
    groupId: "custom",
    name: "害羞",
    text: "☺️",
    keywords: ["害羞", "脸红", "不好意思", "hx"],
    shortcodes: ["hh"],
    assetFile: "害羞.gif",
  },
  {
    id: "disagree",
    groupId: "custom",
    name: "比 X",
    text: "❌",
    keywords: ["比x", "不行", "拒绝", "bx"],
    assetFile: "比x.gif",
  },
  {
    id: "tongue",
    groupId: "custom",
    name: "吐舌",
    text: "😛",
    keywords: ["吐舌", "调皮", "略略略", "ts"],
    assetFile: "吐舌.gif",
  },
  {
    id: "chips",
    groupId: "custom",
    name: "吃薯片",
    text: "🍟",
    keywords: ["薯片", "吃", "围观", "sp"],
    assetFile: "吃薯片.gif",
  },
  {
    id: "ok-sticker",
    groupId: "custom",
    name: "OK",
    text: "👌",
    keywords: ["ok", "好的", "没问题", "hd"],
    shortcodes: ["ok"],
    assetFile: "yes.gif",
  },
  {
    id: "speechless-sticker",
    groupId: "custom",
    name: "无语",
    text: "😑",
    keywords: ["无语", "沉默", "服了", "wy"],
    shortcodes: ["wy"],
    assetFile: "无语.gif",
  },
  {
    id: "water",
    groupId: "custom",
    name: "浇水",
    text: "💧",
    keywords: ["浇水", "催更", "灌溉", "js"],
    shortcodes: ["js"],
    assetFile: "浇水.gif",
  },
  {
    id: "box",
    groupId: "custom",
    name: "纸箱",
    text: "📦",
    keywords: ["纸箱", "装箱", "溜了", "zx"],
    assetFile: "纸箱.gif",
  },
  {
    id: "wall",
    groupId: "custom",
    name: "扶墙",
    text: "🧱",
    keywords: ["扶墙", "崩溃", "累", "fq"],
    assetFile: "扶墙.gif",
  },
];

/** 全部表情条目：纯文本条目在前，自定义表情包在后，保证面板里的分组顺序稳定。 */
export const EMOJI_CATALOG: readonly EmojiCatalogEntry[] = [
  ...TEXT_EMOJI_ENTRIES,
  ...EXTRA_EMOJI_ENTRIES,
  ...CUSTOM_EMOJI_ENTRIES,
];

/** 取某个分组下的全部条目；未知分组返回空数组。 */
export function emojiEntriesByGroup(groupId: string): readonly EmojiCatalogEntry[] {
  return EMOJI_CATALOG.filter((entry) => entry.groupId === groupId);
}

/** 命中等级；数字越小越优先，用于让快捷码稳定命中同一个表情。 */
export function emojiMatchRank(entry: EmojiCatalogEntry, needle: string): number | null {
  const shortcodes = (entry.shortcodes ?? []).map((code) => code.toLowerCase());
  // 0：精确 id 或精确快捷码（hh、wx），编辑器触发与搜索框共用同一条规则。
  if (entry.id === needle || shortcodes.includes(needle)) return 0;
  // 1：名称命中（中文名精确/包含）。
  if (entry.name.toLowerCase().includes(needle)) return 1;
  // 2：快捷码前缀，例如输入 s 命中 smile。
  if (shortcodes.some((code) => code.startsWith(needle))) return 2;
  // 3：关键词（含拼音首字母）与索引标注。
  const keywords = [...entry.keywords, entry.label ?? ""];
  if (keywords.some((value) => value.toLowerCase().includes(needle))) return 3;
  // 4：其余字段（正文文本等）。
  return entry.text.toLowerCase().includes(needle) ? 4 : null;
}

/**
 * 按查询词搜索目录，先按命中等级、再按目录顺序返回。
 * 等级保证 `hh` 命中站点表情而不是同名的纯文本表情。
 */
export function searchEmojiEntries(query: string, limit = 100): readonly EmojiCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return EMOJI_CATALOG.slice(0, limit);
  const ranked: { entry: EmojiCatalogEntry; rank: number; order: number }[] = [];
  EMOJI_CATALOG.forEach((entry, order) => {
    const rank = emojiMatchRank(entry, needle);
    if (rank !== null) ranked.push({ entry, rank, order });
  });
  ranked.sort(
    (left, right) =>
      left.rank - right.rank ||
      // 同等级用更短的 id 表示「更基础」：搜「抱抱」时站点表情 hug 排在
      // 同名颜文字 kao-hug 之前，而不是靠目录顺序决定。
      left.entry.id.length - right.entry.id.length ||
      left.order - right.order,
  );
  return ranked.slice(0, limit).map((item) => item.entry);
}
