# L51 · `tier-plans-trio`（三档方案页：报告风标题条 + 三列方案卡，推荐那档挂一面小旗）

> **📄 详情**：本文件供 design 阶段匹配到 L51 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，视觉中等（约 200–350 字）
- **核心手法**：**三列同样的卡，横着一条一条对得上** —— 三列等宽方案卡（`.l51-trio`，`1fr 1fr 1fr`），每列同样的顺序、同样的配色、同样的条数；推荐的那一档在右上角挂一面 `.l51-flag` 小旗（写"推荐"），**其余一处都不特殊化**
- **结构**：报告风标题条（`.rp-head` + 建议带 `lead` 说清三档的差别在哪）→ 三列方案卡（每列：英文小字 + 档位名 + 一个大数字 + 2–4 条包含项 + 贴底的适合谁）→ 底部结论条（`.rp-foot`）
- **是否全幅**：否（全部内容包在 `.slide-inner` 里）
- **什么时候用**：**报价/合作分档**（试点-落地-全量）、**产品版本对比**（基础-专业-企业）、**服务档位**、**三条路线各自的代价** —— 凡是「三个选项，其中一个是我们建议的」
- **不用它的场景**：两个选项对立（用对比双卡那几条）；四个以上档位（第四列起卡内每行都换行，见下）

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

- 标题**必须是 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。
- `lead` 写**三档的差别在哪一件事上**（"差别只在谁来盯那两处人工"）—— 不写的话读的人得自己横着对三列，
  而三列各自都写得很完整，看起来只是「信息有点多」。

### 2. 方案卡 · `.l51-plan` × 3

- 卡内从上到下：`<b>` 英文小字 → `<h3>` 档位名（一行，10 字内）→ `.l51-price` 一个大数字（`<i>` 里写单位/口径）
  → 2–4 条 `.l51-feat`（每条一行，上方一条细线）→ `.l51-note`（`margin-top:auto` 贴底，写"适合谁"）。
- **大数字只写一个数**（周期 / 人天 / 价格 / 页数都行），单位一律进 `<i>`：数字和单位同字号时那个数就不显眼了，
  三列一起变成三段小字，读的人得逐字读完才知道差别。**不写百分比换算、不写"约"** —— 会算错的格式不交给模型。
- **`.l51-feat` 2–4 条，推荐 4 条**：卡内高 580px，一条一行约 68px。
  5 条起 `.l51-note` 被顶出卡底、压在卡外的浅底上（故意不裁，裁掉的话「适合谁」凭空消失而卡本身很完整）；
  三列的条数**必须一样多**（左边 4 条右边 2 条时，读的人以为右边那档少了两项功能，而其实是没写）。
- 每条 `.l51-feat` **一行写完**（一列宽 527px，约 22 个汉字）：换行的那一条会把这一列后面全部顶下去，
  三列的行就不在一条水平线上了 —— 而每一列自己看都是整齐的。

### 3. 推荐那一档 · `.l51-flag`

- **三列的底色、描边、padding、字号完全一样**（原来推荐那一列有个 `.on`：品牌色反色实底 + `margin:-28px 0`
  上下溢出 + 投影，已经去掉了）。**不要自己在 build-part 里给某一列套满色底 / 负 margin inline style**：
  那一列在整份浅色稿子里是唯一一处满色卡，翻起来像另一套模板里的页，而这一页自己看完全正常。
- **推荐哪一档全靠这面小旗**（`.l51-flag`，深底白字，写"推荐"/"多数人选这档"），**必须挂一面** ——
  一面都不挂的话「三个选项里我们建议哪个」这一页一个字都没说，三列各自都很完整、读的人自己挑，
  而这一条版式的用途就是「三个选项，其中一个是我们建议的」。
- **只挂一列**（全挂等于没挂）。挂在中间那列最稳（挂边上没有对齐问题，三列现在一样高）。

### 4. 结论条 · `.rp-foot`

- 写**换档的代价**（"换档不用重做已经生成的稿子"）或**默认建议**。三列都摊开之后读的人最想知道的就是这一句。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* L51 三档方案 */
.l51-trio{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;align-items:stretch;margin:48px 0 44px}
.l51-plan{position:relative;background:var(--c-card);border:1px solid var(--c-hairline);padding:36px 32px;display:flex;flex-direction:column}
.l51-plan b{font-family:var(--num);font-size:13px;font-weight:700;letter-spacing:.2em;color:var(--c-ink-soft)}
.l51-plan h3{font-size:30px;font-weight:800;line-height:1.25;color:var(--c-ink-deep);margin-top:10px}
.l51-price{font-family:var(--num);font-size:44px;font-weight:800;line-height:1;letter-spacing:-.01em;color:var(--c-brand);margin-top:20px;font-variant-numeric:tabular-nums}
.l51-price i{font-style:normal;font-family:var(--sans);font-size:16px;font-weight:700;color:var(--c-ink-soft);margin-left:8px}
.l51-feat{margin-top:22px;padding-top:16px;border-top:1px solid var(--c-hairline);font-size:18px;line-height:1.6;color:var(--c-ink)}
.l51-plan .l51-note{margin-top:auto;padding-top:22px;font-size:16px;line-height:1.6;color:var(--c-ink-soft)}
.l51-flag{position:absolute;top:0;right:0;background:var(--c-ink-deep);padding:8px 16px;font-size:14px;font-weight:700;letter-spacing:.1em;color:#fff}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L51">
  <!-- 模块名由代码贴（.slide-header），这里不要写 -->
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{这一页的标题}}</h1>
      <div class="lead">{{三档的差别在哪一件事上}}</div>
    </div>
    <div class="l51-trio">
      <div class="l51-plan">
        <b>{{英文小字}}</b>
        <h3>{{第一档，10 字内}}</h3>
        <div class="l51-price">{{一个数}}<i>{{单位/口径}}</i></div>
        <div class="l51-feat">{{包含项，一行写完}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-note">适合：{{谁}}</div>
      </div>
      <div class="l51-plan">
        <div class="l51-flag">推荐</div>
        <b>{{英文小字}}</b>
        <h3>{{推荐那一档，只有中间这列加 on}}</h3>
        <div class="l51-price">{{一个数}}<i>{{单位/口径}}</i></div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-note">适合：{{谁}}</div>
      </div>
      <div class="l51-plan">
        <b>{{英文小字}}</b>
        <h3>{{第三档}}</h3>
        <div class="l51-price">{{一个数}}<i>{{单位/口径}}</i></div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-feat">{{包含项}}</div>
        <div class="l51-note">适合：{{谁}}</div>
      </div>
    </div>
    <div class="rp-foot">{{换档的代价，或默认建议}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：三列已经等分了整个内容区，卡里塞图会挤掉两条包含项（出来是「这一档少了两项」），而三列都还渲染正常 |

**禁用**：任何 `<img>` / 背景图 / 图标

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V2 | 去掉 `.l51-price`（只有档位名和包含项） | 价格/周期不在这一页说 |
| V6 | 去掉 `.rp-foot` | 结论已经在 `lead` 里 |

---

## 七、design 提示

- **只当"三个选项，其中一个是我们建议的"用**：两个选项对立用对比双卡那几条；四档起用表格页那一条（第四列起卡内每行都换行）
- **三列配色和尺寸完全一样**，推荐哪一档只由那面 `.l51-flag` 小旗说 —— 小旗必须有一面（一面都没有的话「我们建议哪一档」一个字都没说，而三列各自都很完整），且只有一面
- **不要给某一列套满色底/负 margin 的 inline style**：那一列在整份浅色稿子里是唯一一处满色卡，翻起来像另一套模板里的页，而这一页自己看完全正常
- **三列的 `.l51-feat` 条数必须一样多**（左 4 条右 2 条时读的人以为右边那档少了两项，而其实是没写）；2–4 条，5 条起「适合谁」被顶出卡底压在卡外浅底上（故意不裁）
- **每条包含项一行写完**（一列约 22 个汉字）：换行的那一条把这一列后面全顶下去，三列的行不在一条水平线上，而每一列自己看都很整齐
- **大数字只写一个数、单位进 `<i>`**：数字和单位同字号时那个数就不显眼了，三列一起变成三段小字；不写百分比换算、不写"约"
- **`lead` 必须写三档的差别在哪一件事上**：不写的话读的人得自己横着对三列，而三列各自都很完整、看起来只是「信息有点多」
- **配色**：三列一律 大数字 `var(--c-brand)`、卡底 `var(--c-card)`（用 `var(--bg-plain)` 的话三张卡和页面同色、只剩三条描边，整页像还没排完）、小旗 `var(--c-ink-deep)` + `#fff`
- **整份最多一页**；别和数据表格页相邻（两页都是「标题条 + 一大块分列信息 + 结论条」，翻起来像同一页没动）
- **与对比双卡那几条的区别**：那是两块对立（各自的代价），这一条是三档递进且**明确推荐一档**
