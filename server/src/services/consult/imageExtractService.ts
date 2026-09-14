// 图片（客户发来的 PPT 截图 / 海报 / 包装 / 手写笔记 / 扫描页）→ 客户资料底稿。
// **这条路一定要花一次 AI 额度**（图里的字只有大模型读得出来），所以它和 fileExtract
// 那条「只做程序提取」的路是分开的两个文件：混在一起的话，一次「提取文字」会静默扣掉
// 他今天 10 次里的一次，而界面上那一步写着「正在提取文字…」（硬规则 1）。
//
// 这条路比文件那条**少一道闸门**，这件事必须一路说到界面上：文件那边有程序抠出来的原文，
// 所以能程序化比对「整理后多出来的数字」（fileTidyService.numbersAddedBy）；图片这边
// **压根没有原文** —— 模型多抄一个客单价、把 12.8 看成 128，没有任何一处会露馅，
// 而那个数字会以「客户说的」身份进后面十二步的全部结论。所以：
// ① prompt 里「看不清就写［看不清］，不许猜」是硬规则；
// ② 每一份图片结果都带一条 note，明说这份没有原文可比对，请他对着图核一眼数字。
//
// 第二件必须认出来的事：**这条接入点的模型可能压根不认图片**（这一步走「内容提取」通道，
// 后台可以给它单独指一条接入点，没指就还是 default 档那条 —— 两种情况都可能是纯文本模型）。
// 宽松的网关会把 image_url 那一段悄悄丢掉，然后模型照着剩下的文字说明
// 编一份「客户资料」—— 那份东西读起来完全正常。所以 prompt 里要求「收不到图片就只回
// NO_IMAGE」，代码认这个标记并报出真实成因（去换一个支持视觉的模型）。

import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { EXTRACT_CHANNEL } from '../../core/llm/apps.js';
import { StageError } from './draftService.js';
import { budgetRule, CATEGORY_LIST, cutToBudget, TIDY_BUDGET_CHARS } from './fileTidyService.js';

/** 认得的图片扩展名。**能不能真的解析看文件头**（{@link sniffImage}）。 */
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

/**
 * 一张图最多这么大。**不是内存限制，是请求体限制**：图片要 base64 进请求（体积 ×1.34），
 * 上游网关那一层普遍卡 10MB 左右，超了回的是一句网关自己的英文错误 ——
 * 那句话读起来像「模型出错了」，而真正的动作是把图压小。所以在这里先拦并说清楚。
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 这一步的 `max_tokens`。配 `noThinking: true`，把额度全给正文（硬规则 2）。 */
const MAX_TOKENS_IMAGE = 8000;

/** 视觉模型比纯文本慢，给足并且**不重试**（重试一次只是让他等两倍时间拿同一句失败）。 */
const AI_TIMEOUT_MS = 180_000;

export interface ImageExtractResult {
  text: string;
  chars: number;
  notes: string[];
  /** 花了几次 AI 额度（图片恒为 1）。界面上要显示 —— 他有权知道这一下花了多少。 */
  calls: number;
  /** 顶到 token 上限，后半张图没抄完。断在半句话上的资料和抄完的长得一模一样。 */
  truncated: boolean;
  reasoningTokens: number;
  /** 超过一份文件的字数预算，提交那一下会被拒（这里不截，理由见 TIDY_BUDGET_CHARS）。 */
  overBudget: boolean;
}

/** 图片文件头 → mime。改扩展名的图到处都有，按文件头认才不会把 PDF 当图片发上去。 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('latin1');
  if (buf[0] === 0x89 && hex.slice(1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (hex.startsWith('RIFF') && hex.slice(8, 12) === 'WEBP') return 'image/webp';
  if (hex.startsWith('GIF87a') || hex.startsWith('GIF89a')) return 'image/gif';
  return null;
}

/**
 * 模型不吃、但用户手上很常见的那几种图。**必须单独认**：
 * iPhone 相册里直接拖出来的就是 .heic，随手一张微信长截图可能是 .bmp/.tiff。
 * 不认的话它们落到「文件头不是图片」那句上，而那句话对一张明明能看的照片讲不通，
 * 他只会反复传同一张。
 */
function sniffUnusable(buf: Buffer): { format: string; hint: string } | null {
  const head = buf.subarray(0, 16).toString('latin1');
  if (/ftyp(heic|heix|hevc|mif1|msf1)/.test(head)) {
    return {
      format: 'HEIC/HEIF（iPhone 拍照的默认格式）',
      hint:
        '大模型不认这种格式。在 iPhone 上：设置 > 相机 > 格式，选「兼容性最佳」；'
        + '已经拍好的照片可以用「照片」App 分享/导出成 JPG，或者在电脑「预览」里导出成 JPG。',
    };
  }
  if (/ftypavif/.test(head)) {
    return { format: 'AVIF', hint: '请用看图工具另存为 PNG 或 JPG 再传。' };
  }
  if (head.startsWith('BM')) {
    return { format: 'BMP', hint: '请另存为 PNG 或 JPG 再传（体积也会小很多）。' };
  }
  // TIFF 的文件头是 49 49 2A 00（小端）/ 4D 4D 00 2A（大端）—— 里面有个 0x00，
  // 直接写成字符串字面量会把一个裸的 NUL 塞进这份源码（整个文件被当成二进制，grep 从此搜不到它），
  // 所以按字节比。
  const tiffLE = buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00;
  const tiffBE = buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a;
  if (tiffLE || tiffBE) {
    return { format: 'TIFF', hint: '请另存为 PNG 或 JPG 再传。' };
  }
  return null;
}

/**
 * 这次上传该走图片识别吗。**扩展名和文件头任一像图片就算**：
 * - 只看扩展名：一张改名成 `.docx` 的截图会落到 zip 解析上，回一句「解压失败」；
 * - 只看文件头：`.heic` / `.bmp` 这些我们认不出 mime 的会落到「既不是 Word 也不是 PDF」，
 *   而那句话对一张照片讲不通。
 */
export function looksLikeImage(ext: string, buf: Buffer): boolean {
  return (
    IMAGE_EXTS.includes(ext as (typeof IMAGE_EXTS)[number])
    || ext === '.heic'
    || ext === '.heif'
    || ext === '.bmp'
    || ext === '.tif'
    || ext === '.tiff'
    || ext === '.avif'
    || !!sniffMime(buf)
    || !!sniffUnusable(buf)
  );
}

const IMAGE_SYSTEM = `你在读客户发来的一张资料图片（PPT 截图 / 海报 / 产品包装 / 手写笔记 / 扫描页 / 图表）。
把图里**看得见的文字和数据抄出来**，按下面的类目归好，给品牌咨询顾问当资料底稿。

硬规则 0（最重要，其它规则都在它之下）：**只抄不编。**
图里没有的东西一个字都不许加 —— 尤其是数字、金额、比例、增长率、日期、年份、人名、
品牌名、产品名、成分、渠道名、奖项资质。看不清的字写成 ［看不清］，**不要猜、不要按常识
补全、不要把模糊的数字读成一个"合理"的数**。
这条路上和文件不一样：**没有程序抠出来的原文可以拿来比对你抄得对不对**。你多抄一个客单价、
把 12.8 看成 128，没有任何一处会报错，而那个数字会以「客户说的」身份进后面十二步的全部结论。

硬规则 1：**如果你收不到图片**（只看到这段文字说明，没有图像），第一行只写 NO_IMAGE，
后面什么都不要写。绝对不要根据文件名编内容。
硬规则 2：如果图片里**一个字都没有**（纯产品照、纯色块、纯风景），第一行只写 NO_TEXT，
**第二行起照样给内容** —— 用 \`## 其它可能有用的\` 把这张图**是什么**如实描述出来：
画面上有什么、是什么品类的产品、包装/器型/材质/配色什么样、场景是什么、图表在画什么。
只写**看得见的**东西；品牌名、销量、价格、成分、产地、卖点这些图上没写的，一个字都不许推测
（"看起来像高端定位""应该是年轻女性用户"这类判断也算推测，不要写）。

1. 要留的，用下面这些 \`## 小标题\`（图里没有对应内容的那一节**直接不要出现**，不要写"暂无"）：
${CATEGORY_LIST}
2. 图表 / 表格：坐标轴、图例、数据标签上的文字和数字**原样抄**，能看出对应关系的写成
   「标签：数字」。**不要替我算增长率、不要排序、不要总结趋势** —— 算错了没人看得出来。
3. 要删的：水印、页码、装饰性文字、CONTENTS / THANKS 这类模板词、和这个品牌业务无关的东西。
4. **不做分析、不给建议、不下结论、不打分。** 这是资料，不是方案。
5. 每节用 \`- \` 要点，一条一个事实，短句。定位语 / slogan / 客户原话照抄，不要改写成书面语。
6. 直接输出正文，第一个字就是 \`##\`（或者 NO_IMAGE / NO_TEXT）。不要写"以下是整理后的内容"。`
  + budgetRule(TIDY_BUDGET_CHARS, 7);

/**
 * 一张图 → 资料底稿。**一次调用**（既读图又归类）：分成「先转录、再整理」两次的话，
 * 一张海报就要花掉他今天 10 次里的 2 次，而多出来的那一次买不到任何闸门
 * （图片这条路上压根没有原文可比对，见文件头）。
 */
export async function extractImageText(
  userId: string,
  filename: string,
  buf: Buffer
): Promise<ImageExtractResult> {
  const bad = sniffUnusable(buf);
  if (bad) {
    throw new StageError(`${filename} 是 ${bad.format} 格式，${bad.hint}`, 400);
  }
  const mime = sniffMime(buf);
  if (!mime) {
    throw new StageError(
      `${filename} 的文件头不是图片（不是 PNG / JPG / WebP / GIF）。它多半是改过扩展名的`
        + '别的东西，或者下载时坏了。请用看图工具打开确认，另存为 PNG / JPG 再传。',
      400
    );
  }
  if (!buf.length) throw new StageError(`${filename} 是个空文件（0 字节）。`, 400);
  if (buf.length > MAX_IMAGE_BYTES) {
    // 这道闸门在**花额度之前**：不拦的话上游回一句自己的英文体积错误，而那次调用
    // 已经扣掉了一次额度。
    throw new StageError(
      `${filename} 有 ${(buf.length / 1024 / 1024).toFixed(1)}MB，超过单张图 `
        + `${MAX_IMAGE_BYTES / 1024 / 1024}MB 的上限（图片要转成 base64 进请求，体积还会涨三成，`
        + '上游网关那一层会直接拒）。请把它压小：截图重新存成 JPG 通常只有几百 KB，'
        + '或者只截要用的那一部分。',
      400
    );
  }

  const notes: string[] = [];
  const { response, usage, duration_ms, noThinkingRefused } = await aiGateway(
    {
      ...SAMPLING.analytic, // 低温：这一步是抄和归类，不是发挥
      messages: [
        { role: 'system', content: IMAGE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: `文件名：${filename}\n请按上面的规则读这张图。` },
            // data URL 而不是先转存 COS：`file.qiaonan.vip` 是公开可访问的，
            // 客户的品牌资料/预算/竞品名单传上去等于公开（同 /extract-file 那条不落盘的规则）。
            { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } },
          ] as any,
        },
      ],
      max_tokens: MAX_TOKENS_IMAGE,
    },
    {
      userId,
      source: 'consult',
      // 提取走「内容提取」通道：后台可以单独给它指一条便宜快的接入点，而 consult 其余
      // 步骤（对话 / 出草稿 / 出方向）照旧走 consult 那条。额度和日志仍记在 consult 上。
      // 注意这条路要**认图**：指到一个纯文本模型上时，模型会回 NO_IMAGE，
      // 下面那段专门把它翻成「去后台换一个能读图的模型」——不是编一份客户资料出来。
      channel: EXTRACT_CHANNEL,
      operation: 'consult:extract-image',
      requestSummary: `识别上传图片：${filename}（${(buf.length / 1024).toFixed(0)}KB）`,
      // 有人在屏幕前等着，而且这条路上关它治的是截断：思维链算进 max_tokens 却不进
      // content（硬规则 2），症状只是「图里的字抄到一半就断了」。
      noThinking: true,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      // 上游回「忙」（`503 system cpu overloaded`）时重发一次：不重发的话这张图直接失败，
      // 而他刚刚已经为它扣掉了一次额度（重发在同一次调用里，不会再扣一次）。
      retryOnBusy: true,
      // 不写 tier：视觉能力跟着 default 档走（同 uiReview）。写 'fast' 的话走量那一档
      // 常常配的是纯文本模型，而那种情况下图片是被**悄悄丢掉**的。
      // 通道也一样：给「内容提取」指的那条接入点必须认图，否则这里会走到下面 NO_IMAGE。
    }
  );

  const choice = response.choices?.[0];
  // 下面 NO_TEXT 那一支会把它换成「去掉标记之后的描述」，所以是 let。
  let out = (choice?.message?.content || '').trim();
  const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;

  if (!out) {
    throw new StageError(
      `模型一个字都没返回（${usage.output_tokens} 输出 token，其中 ${reasoningTokens} 在思维链上，`
        + `耗时 ${(duration_ms / 1000).toFixed(1)} 秒）。这次的 AI 额度已经扣了。\n`
        + (reasoningTokens > 0
          ? noThinkingRefused
            // 同下面那条 note：这条接入点上「去勾一下」是死路，说了等于把他往回指。
            ? '额度全被思维链想掉了，而这个模型关不掉思维链（这次已经退到 reasoning_effort: \'low\'）—— 去「AI 模型 Provider」把这一步用的那条换成一个能关思维链的模型。'
            : '思维链没关掉，额度全被想掉了 —— 去「AI 模型 Provider」勾上「关思维链」。'
          : '多半是上游抖动，也可能这条接入点的模型不认图片。重试一次，还是空的话换个支持视觉的模型。'),
      502
    );
  }

  // 模型说它压根没收到图片 —— 这是这条路上最贵的一种失败：宽松的网关会把 image_url
  // 那一段悄悄丢掉，而模型照着文件名编一份读起来完全正常的「客户资料」。
  if (/^NO_IMAGE\b/.test(out)) {
    throw new StageError(
      '模型说它没有收到图片，所以这张图一个字都没读到（这次的 AI 额度已经扣了）。\n'
        + '成因是这次用的模型不支持看图 —— 去「AI 模型 Provider」里改那条「应用 = 文件/图片内容提取」'
        + '的配置（没配过这一条的话，改 default 档那条），换一个支持视觉的模型。',
      502
    );
  }
  // 图里一个字都没有（纯产品照 / 纯色块）→ **照样返回**，带回来的是模型对这张图的描述。
  // 原来这里是 400，改成收下是因为：一张产品照对「品类、器型、包装风格」是有信息的，
  // 而报错等于让他自己去打一段描述。但**必须写清这一份是"描述"不是"图里的文字"**：
  // 混在一起的话，「模型看着一张白瓶子写出来的话」在资料里和客户亲口说的长得一模一样，
  // 而后面十二步会把它当成客户给的事实。
  let described = false;
  if (/^NO_TEXT\b/.test(out)) {
    const desc = out.replace(/^NO_TEXT\b[：:]?\s*/, '').trim();
    if (!desc) {
      throw new StageError(
        `${filename} 里既没有文字，模型也没给出画面描述，没有内容能带进资料（这次的 AI 额度已经扣了）。`
          + '请传带文字的那几页，或者重试一次。',
        400
      );
    }
    described = true;
    out = desc;
  }

  // `notes` 只留「这一份的结果和你以为的不一样」那几条（截断 / 超预算 / 这是描述不是原文）。
  // **顺利读完的那张图不说话** —— 原来每张都顶一句「这份是大模型读出来的，请核一眼数字」，
  // 每次上传都是一片黄框，而卡片上本来就写着「AI 读图（无原文）」，那一句是重复的。
  // 这一条不同：它说的是这份内容**压根不是图里的字**，而是模型看着图编的一段描述 ——
  // 不说的话它在资料里和客户亲口说的长得一模一样，后面十二步会把它当成事实。
  if (described) {
    notes.push('这张图里没有文字，这份是模型对画面的描述（不是图里的原文）。');
  }
  if (choice?.finish_reason === 'length') {
    notes.push(
      `结果被截断了（顶到 ${MAX_TOKENS_IMAGE} token${reasoningTokens > 0 ? `，${reasoningTokens} 花在思维链上` : ''}）`
        + '，这张图后半部分没抄进来。请把图裁成两张分别传。'
    );
  }
  // 超预算时**自己切**，不甩一句「请自己删掉 N 字」——那是把这一步的活退回给用户。
  // 这边没有「再让 AI 压一次」那一步（文件那条路有）：一张图读一遍就一次额度，
  // 为了几十个字再花一次不划算，而一张图读出三千五百字以上本来就极少见。
  // 同文件那条路：这一刀**不进用户看的 notes**，线索留在 console.warn 里
  // （prompt 里那句「必须 ≤ N 字，允许整条整节删」是让它压根走不到这里的那一头）。
  if (out.length > TIDY_BUDGET_CHARS) {
    const cut = cutToBudget(out, TIDY_BUDGET_CHARS);
    console.warn(
      `[consult] ${filename}：读图读出 ${out.length} 字，已按小节切掉末尾 ${out.length - cut.length} 字`
        + `（预算 ${TIDY_BUDGET_CHARS}）。`
    );
    out = cut;
  }
  const overBudget = out.length > TIDY_BUDGET_CHARS;
  // 「这条接入点没关掉思维链」不再往用户面前放：那是接入点配置的事，他改不了，
  // 而这一句每次读图都会出现。管理员那边的线索没丢 —— gateway 里 console.warn 一句，
  // 后台点接入点的「测试」按钮也会明说（见 admin.ts 的 probeNoThinking）。
  // 它真的害到人的时候（读一半就断了）说话的是上面那条截断提示，那条带着思维链 token 数。

  return {
    text: out,
    chars: out.length,
    notes,
    calls: 1,
    truncated: choice?.finish_reason === 'length',
    reasoningTokens,
    overBudget,
  };
}
