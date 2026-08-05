// 意图解析的并发闸。
//
// ── 为什么需要它 ──
// 一条指令进来，dispatcher 立刻返回（3 秒限制），真活跑在一个游离 promise 里。
// 也就是说**没有任何东西在限制同时有多少条指令在跑**：一个部门早上九点集体
// @ 一下机器人，就是同时几十个 LLM 请求打向同一个 provider。
// 多租户下更明显——每家公司各一条长连接，它们共用平台那把 key。
//
// 撞限流的后果不是"慢一点"，而是**用户拿到一句莫名其妙的失败**：provider 回
// 429，我们翻译不出来，回帖里是一段英文报错，而他做的事完全正常。
// 排队等几秒再成功，比立刻失败好得多——他本来就在等回帖，几秒察觉不到。
//
// ── 为什么排队还要有上限 ──
// 无上限排队会把"限流"换成"永远不回"：队伍排到几百条时，最后那个人等到的
// 是十分钟后的回帖，而他早就当助理坏了，重发了三遍（每遍又占一个位置）。
// 所以超过 MAX_QUEUED 就**立刻拒绝**并回一句人话——「太忙，请稍后重说一遍」
// 是个用户能理解、也能照着办的结果。
//
// ── 为什么闸在这一层，而不是 gateway ──
// gateway 是全平台共用的（网页里的写作台、诊断都走它），在那里限流会让
// 一个飞书群的早会通知拖慢正在网页上等结果的人。这个闸只管飞书这条入向路径。

/**
 * 同时跑几个意图解析。
 *
 * 4 是个保守值：单条指令的 LLM 调用一般 1-3 秒，4 并发就是每秒一两条指令的
 * 吞吐，足够覆盖"一个部门同时下指令"；而多租户下所有公司共用这个数，
 * 调高的收益是缩短排队、代价是撞 provider 限流的概率上升。
 * 真要调，先看 ai_logs 里的耗时分布，而不是凭感觉加。
 */
const MAX_CONCURRENT = 4;

/**
 * 最多排多少条在等。
 *
 * 按上面的吞吐，20 条大约对应最坏 15 秒的等待——还在"用户愿意等一条回帖"的范围内。
 * 再长就该告诉他「现在太忙」，而不是让他盯着一个不会来的回复。
 */
const MAX_QUEUED = 20;

/** 队伍满了。dispatcher 据此回一句人话，并把指令记成 failed。 */
export class TooBusyError extends Error {
  constructor() {
    super(
      '助理现在同时在处理的指令太多，这条没能排上队。\n' +
        '请过十几秒把这句话再说一遍 —— 本次没有执行任何操作，重说不会重复。'
    );
    this.name = 'TooBusyError';
  }
}

let running = 0;
const waiting: Array<() => void> = [];

/**
 * 拿一个名额跑 `fn`。名额不够就排队；队伍也满了就抛 {@link TooBusyError}。
 *
 * 注意「本次没有执行任何操作」这句承诺是**这个函数的位置**保证的：
 * 它只包住意图解析，此时一个写操作都还没发生，所以让用户重说一遍是安全的。
 * 千万不要把它挪到包住整个 execute —— 那样被拒绝的指令可能已经发出去半条消息了。
 */
export async function withIntentSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUED) throw new TooBusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    // 交棒给下一个。用 shift 保持先到先服务：后到的先跑会让最早那条指令
    // 在忙时段一直排在末尾（饿死），而它的主人等得最久。
    waiting.shift()?.();
  }
}

/** 当前负载快照，供排障时看「是不是在排队」。 */
export function intentLoad(): { running: number; queued: number; maxConcurrent: number } {
  return { running, queued: waiting.length, maxConcurrent: MAX_CONCURRENT };
}
