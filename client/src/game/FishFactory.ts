import type { Fish, Personality, HiddenStats, FishAppearance, Hobby, Relationship } from './types'

let fishIdCounter = 0

interface SpeciesPreset {
  personalityBias: Partial<Personality>
  statBias: Partial<HiddenStats>
  colorRange: { h: [number, number]; s: [number, number]; l: [number, number] }
  appearance: {
    bodyLength: [number, number]
    bodyWidth: [number, number]
    bodyShape: FishAppearance['bodyShape']
    pattern: FishAppearance['pattern']
    patternDensity: [number, number]
    finSize: [number, number]
    finShape: FishAppearance['finShape']
    tailShape: FishAppearance['tailShape']
    eyeSize: [number, number]
  }
}

const SPECIES_PRESETS: Record<string, SpeciesPreset> = {
  // 摸鱼达人 — 圆润慵懒，暖色调，大眼无辜
  moyu: {
    personalityBias: { aggression: 0.1, social: 0.6, curiosity: 0.3, cowardice: 0.7 },
    statBias: { attack: 4, defense: 8, speed: 6, hp: 50 },
    // Expanded color range for Moyu to include all warm colors (reds, oranges, yellows, light greens)
    colorRange: { h: [0, 90], s: [50, 85], l: [50, 75] },
    appearance: {
      bodyLength: [34, 44],
      bodyWidth: [0.6, 0.75],
      bodyShape: 'round',
      pattern: 'gradient',
      patternDensity: [2, 3],
      finSize: [0.8, 1.1],
      finShape: 'round',
      tailShape: 'forked',
      eyeSize: [0.16, 0.2],
    },
  },
  // 卷王 — 修长有力，冷色系，锐利
  juanwang: {
    personalityBias: { aggression: 0.7, social: 0.3, curiosity: 0.8, cowardice: 0.1 },
    statBias: { attack: 16, defense: 10, speed: 18, hp: 55 },
    // Expanded color range for Juanwang to include all cool colors (greens, blues, purples)
    colorRange: { h: [150, 280], s: [50, 85], l: [30, 55] },
    appearance: {
      bodyLength: [38, 50],
      bodyWidth: [0.35, 0.45],
      bodyShape: 'slim',
      pattern: 'stripes',
      patternDensity: [3, 5],
      finSize: [0.7, 1.0],
      finShape: 'sharp',
      tailShape: 'pointed',
      eyeSize: [0.1, 0.13],
    },
  },
  // 社牛 — 色彩鲜艳，中等身材，活泼
  sheniu: {
    personalityBias: { aggression: 0.3, social: 0.9, curiosity: 0.7, cowardice: 0.2 },
    statBias: { attack: 8, defense: 8, speed: 14, hp: 40 },
    // Expanded color range for Sheniu to include almost the entire spectrum of bright colors
    colorRange: { h: [0, 360], s: [70, 95], l: [50, 65] },
    appearance: {
      bodyLength: [30, 40],
      bodyWidth: [0.45, 0.55],
      bodyShape: 'oval',
      pattern: 'spots',
      patternDensity: [3, 5],
      finSize: [1.0, 1.4],
      finShape: 'flowing',
      tailShape: 'forked',
      eyeSize: [0.14, 0.17],
    },
  },
  // 咸鱼 — 扁平躺倒风格，低饱和度
  xianyu: {
    personalityBias: { aggression: 0.05, social: 0.4, curiosity: 0.2, cowardice: 0.5 },
    statBias: { attack: 3, defense: 15, speed: 4, hp: 60 },
    // Expanded color range for Xianyu to include more diverse muted colors
    colorRange: { h: [30, 200], s: [15, 35], l: [55, 75] },
    appearance: {
      bodyLength: [36, 46],
      bodyWidth: [0.7, 0.9],
      bodyShape: 'angular',
      pattern: 'none',
      patternDensity: [1, 2],
      finSize: [0.5, 0.7],
      finShape: 'round',
      tailShape: 'pointed',
      eyeSize: [0.12, 0.15],
    },
  },
  // 戏精 — 华丽夸张，大鳍大尾
  xijing: {
    personalityBias: { aggression: 0.4, social: 0.7, curiosity: 0.6, cowardice: 0.3 },
    statBias: { attack: 10, defense: 6, speed: 12, hp: 38 },
    // Expanded color range for Xijing to include bright reds, pinks, purples, and striking yellows
    colorRange: { h: [0, 60], s: [75, 95], l: [45, 65] },
    appearance: {
      bodyLength: [32, 42],
      bodyWidth: [0.5, 0.6],
      bodyShape: 'oval',
      pattern: 'stripes',
      patternDensity: [2, 4],
      finSize: [1.6, 2.2],
      finShape: 'flowing',
      tailShape: 'fan',
      eyeSize: [0.15, 0.19],
    },
  },
}

const HOBBIES: Hobby[] = ['sports', 'food', 'gaming', 'music', 'coding', 'gossip', 'philosophy', 'finance']

export const HOBBY_BUBBLES: Record<Hobby, string[]> = {
  sports: [
    '梅西yyds', '今晚有球赛', '该跑步了',
    'NBA谁冠军', '最近在练腹肌', '游泳真舒服',
    '世界杯来了', '健身第一天', '足球>篮球',
    '跳绳500个了', '瑜伽好难', '骑行真爽',
  ],
  food: [
    '中午吃啥', '奶茶好喝', '火锅走起',
    '减肥明天开始', '这个好吃！', '外卖到了吗',
    '想吃烧烤', '咖啡续命', '蛋糕真香',
    '螺蛳粉yyds', '今天自己做饭', '甜品时间~',
  ],
  gaming: [
    '再来一局', '队友太菜了', '上分中',
    '新皮肤出了', '今晚开黑', 'MVP拿下',
    'bug还是feature', '手残党哭了', '差一点就赢',
    '这游戏有毒', '充了648', '肝到凌晨3点',
  ],
  music: [
    '这首歌好听', '单曲循环中', '新专辑出了',
    '想学吉他', '耳机坏了QQ', '演唱会抢票',
    '随机播放', '今天适合听雨', '低音炮震撼',
    '练琴第3天', '音乐节走起', '歌词写的真好',
  ],
  coding: [
    'bug改好了！', '又在加班', 'git冲突了',
    '这代码谁写的', '编译通过！', '上线祈福',
    '摸鱼被发现', '需求又变了', 'review过了',
    '今天摸了一天', '终于跑通了', 'deadline明天',
  ],
  gossip: [
    '听说了吗', '谁又离职了', '八卦时间',
    '工资涨了吗', '隔壁组出事了', '好消息好消息',
    '你知道吗…', '别告诉别人', '太离谱了',
    '瓜太大了', '群里在聊啥', '吃瓜第一名',
  ],
  philosophy: [
    '人为什么活着', '宇宙好大啊', '时间是假的',
    '今天也很迷茫', '意义是什么', '想太多了',
    '活在当下吧', '自由意志存在吗', '人生如梦',
    '世界是虚拟的', '存在即合理？', '想通了又没通',
  ],
  finance: [
    '今天涨了吗', '定投第30天', '基金绿了',
    '该加仓吗', '工资到账了', '花呗该还了',
    '理财小白', '比特币又跌了', '存款目标10w',
    '消费降级中', '发工资真开心', '又月光了',
  ],
}

export const HOBBY_KNOWLEDGE: Record<Hobby, string[]> = {
  sports: [
    '人跑步时心率约120-160',
    '足球场长105米宽68米',
    '奥运五环代表五大洲',
    '马拉松全长42.195公里',
    '篮球篮筐高3.05米',
    '游泳能锻炼全身肌肉',
    '人体有206块骨骼',
    '深蹲能练到70%肌群',
    'NBA一节12分钟',
    '羽毛球最快时速493km',
    '人体60%以上是水',
    '跳绳10分钟≈慢跑30分',
  ],
  food: [
    '辣椒素能促进代谢',
    '蜂蜜永远不会变质',
    '番茄最早被当毒果',
    '巧克力曾是货币',
    '全球每天消耗30亿杯咖啡',
    '日本有超3万家拉面店',
    '牛油果其实是水果',
    '味精是氨基酸钠盐',
    '冰淇淋最初是皇室甜点',
    '花生其实是豆科植物',
    '人一生吃约50吨食物',
    '芥末能杀灭99%细菌',
  ],
  gaming: [
    '第一款游戏是Pong',
    'Mario原名Jumpman',
    '俄罗斯方块1984年诞生',
    'GPU最初为游戏设计',
    '全球游戏玩家超30亿',
    'Minecraft销量超3亿',
    'FPS鼻祖是Wolfenstein',
    '电竞2022年入亚运会',
    '任天堂1889年成立',
    '像素最初是技术限制',
    'Pac-Man原名Puck Man',
    '最早网游1997年上线',
  ],
  music: [
    '钢琴有88个键',
    '人耳能听20Hz-20kHz',
    '吉他6根弦标准调EADGBE',
    '莫扎特5岁开始作曲',
    '一首歌平均3-4分钟',
    'CD采样率44.1kHz',
    '音乐能降低皮质醇水平',
    '最古老乐器是骨笛',
    '绝对音感万分之一人有',
    '贝多芬失聪后仍作曲',
    'A4标准音高440Hz',
    '蓝调起源于非裔民歌',
  ],
  coding: [
    '第一位程序员是女性',
    'Git是Linus两周写的',
    'Python以蟒蛇秀命名',
    'Bug源于真的飞蛾',
    'JS只用10天开发出来',
    'Hello World始于1972',
    'Stack Overflow每天百万访问',
    'Linux内核超2800万行',
    '全球开发者超2700万',
    'HTTP状态码418是茶壶',
    'UTF-8覆盖98%网页',
    '递归：见递归',
  ],
  gossip: [
    '人平均每天说1.6万字',
    '八卦源于周易八个卦象',
    '邓巴数：人最多维系150人',
    '微表情只持续1/5秒',
    '人70%对话是闲聊',
    '谣言传播速度是真相6倍',
    '人脑更易记住负面信息',
    '办公室闲聊有助团队协作',
    '人每天做3.5万个决定',
    '表情包每天发送超60亿',
    '人撒谎时会摸鼻子',
    '镜像神经元让八卦上瘾',
  ],
  philosophy: [
    '苏格拉底说我只知无知',
    '时间可能不是线性的',
    '庄周梦蝶还是蝶梦庄周',
    '薛定谔猫既死又活',
    '笛卡尔：我思故我在',
    '尼采说上帝已死',
    '忒修斯之船还是那艘船吗',
    '缸中之脑无法自证',
    '奥卡姆剃刀：简单即好',
    '人的意识有1秒延迟',
    '全宇宙可能是全息投影',
    '自由意志可能是幻觉',
  ],
  finance: [
    '复利是第八大奇迹',
    '72法则：72÷利率=翻倍年',
    '指数基金跑赢90%基金',
    '巴菲特11岁开始炒股',
    '全球股市总市值超100万亿$',
    '美元符号$源于字母PS',
    '比特币总量只有2100万枚',
    '定投能平滑市场波动',
    '通货膨胀每年约2-3%',
    '应急基金建议留3-6月',
    '黄金5000年来都是货币',
    '4%法则：退休每年取4%',
  ],
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1))
}

function generatePersonality(species: string): Personality {
  const bias = SPECIES_PRESETS[species]?.personalityBias || {}
  return {
    aggression: Math.max(0, Math.min(1, (bias.aggression ?? 0.5) + rand(-0.15, 0.15))),
    social: Math.max(0, Math.min(1, (bias.social ?? 0.5) + rand(-0.15, 0.15))),
    curiosity: Math.max(0, Math.min(1, (bias.curiosity ?? 0.5) + rand(-0.15, 0.15))),
    cowardice: Math.max(0, Math.min(1, (bias.cowardice ?? 0.5) + rand(-0.15, 0.15))),
  }
}

function generateStats(species: string): HiddenStats {
  const bias = SPECIES_PRESETS[species]?.statBias || {}
  return {
    attack: (bias.attack ?? 10) + randInt(-3, 3),
    defense: (bias.defense ?? 8) + randInt(-3, 3),
    speed: (bias.speed ?? 10) + randInt(-3, 3),
    hp: (bias.hp ?? 50) + randInt(-10, 10),
    recovery: 3 + rand(0, 4),
    exp: 0,
    level: 1,
  }
}

function generateAppearance(species: string): FishAppearance {
  const preset = SPECIES_PRESETS[species]
  const cr = preset?.colorRange || { h: [0, 360], s: [50, 80], l: [40, 60] }
  const ap = preset?.appearance

  const h = rand(cr.h[0], cr.h[1])
  const s = rand(cr.s[0], cr.s[1])
  const l = rand(cr.l[0], cr.l[1])

  let patternColor = { h: (h + 180) % 360, s: s - 10, l: l - 10 }
  if (species === 'juanwang') {
    patternColor = { h: h + 30, s: s + 10, l: l + 20 }
  } else if (species === 'xijing') {
    patternColor = { h: (h + 40) % 360, s: 90, l: 70 }
  }

  if (ap) {
    return {
      bodyLength: rand(ap.bodyLength[0], ap.bodyLength[1]),
      bodyWidth: rand(ap.bodyWidth[0], ap.bodyWidth[1]),
      bodyShape: ap.bodyShape,
      primaryColor: { h, s, l },
      secondaryColor: { h: h + rand(-15, 15), s: Math.max(20, s - 10), l: Math.min(85, l + 10) },
      patternColor,
      pattern: ap.pattern,
      patternDensity: randInt(ap.patternDensity[0], ap.patternDensity[1]),
      finSize: rand(ap.finSize[0], ap.finSize[1]),
      finShape: ap.finShape,
      tailShape: ap.tailShape,
      eyeSize: rand(ap.eyeSize[0], ap.eyeSize[1]),
    }
  }

  const shapes: FishAppearance['bodyShape'][] = ['oval', 'slim', 'round', 'angular']
  const patterns: FishAppearance['pattern'][] = ['none', 'stripes', 'spots', 'gradient']
  const finShapes: FishAppearance['finShape'][] = ['flowing', 'sharp', 'round']
  const tailShapes: FishAppearance['tailShape'][] = ['forked', 'fan', 'pointed']

  return {
    bodyLength: rand(30, 50),
    bodyWidth: rand(0.4, 0.6),
    bodyShape: shapes[randInt(0, 3)],
    primaryColor: { h, s, l },
    secondaryColor: { h: h + rand(-15, 15), s: Math.max(20, s - 10), l: Math.min(85, l + 10) },
    patternColor,
    pattern: patterns[randInt(0, 3)],
    patternDensity: randInt(2, 5),
    finSize: rand(0.8, 1.5),
    finShape: finShapes[randInt(0, 2)],
    tailShape: tailShapes[randInt(0, 2)],
    eyeSize: rand(0.12, 0.18),
  }
}

function randomHobby(): Hobby {
  return HOBBIES[Math.floor(Math.random() * HOBBIES.length)]
}

export function createFish(options: { name: string; species: string; x?: number; y?: number; personality?: Personality; hidden?: HiddenStats; appearance?: FishAppearance; hobby?: Hobby }): Fish {
  const species = options.species.toLowerCase()

  const startX = options.x ?? rand(100, 800)
  const startY = options.y ?? rand(100, 500)

  return {
    id: `fish_${++fishIdCounter}_${Date.now()}`,
    name: options.name,
    species,
    hobby: options.hobby || randomHobby(),
    personality: options.personality || generatePersonality(species),
    hidden: options.hidden || generateStats(species),
    appearance: options.appearance || generateAppearance(species),
    skills: [],
    x: startX,
    y: startY,
    z: 0.5 + rand(-0.2, 0.2),
    vx: 0,
    vy: 0,
    vz: 0,
    targetZ: 0.5,
    angle: 0,
    angularVelocity: 0,
    segments: Array.from({ length: 4 }, () => ({ x: startX, y: startY, angle: 0 })),
    currentAction: 'wander',
    actionTarget: null,
    actionUrgency: 0.3,
    hunger: rand(10, 30),
    currentHp: 0,
    mood: 'calm',
    age: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderTimer: 3,
    animTime: Math.random() * 100,
    breedCooldown: 0,
    facingDir: 1,
    facingTransition: 0,
    yaw: 0,
    mouthOpen: 0,
    turnAccumulator: 0,
    stuckCheckX: startX,
    stuckCheckY: startY,
    stuckTimer: 0,
    stunTimer: 0,
    isDead: false,
    deadTimer: 0,
    bubble: null,
    actionTimer: 0,
    prevAction: 'wander',
    hitFlash: 0,
    chargeAmount: 0,
    fightRounds: 0,
    fightPhase: 'idle' as const,
    fightPhaseTimer: 0,
    petEffect: 0,
    relationships: [],
  }
}

export function getSpeciesList() {
  return Object.keys(SPECIES_PRESETS).map(key => ({
    id: key,
    name: { moyu: '摸鱼达人', juanwang: '卷王', sheniu: '社牛', xianyu: '咸鱼', xijing: '戏精' }[key] || key,
  }))
}
