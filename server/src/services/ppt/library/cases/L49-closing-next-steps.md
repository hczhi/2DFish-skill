# L49 · `closing-next-steps`（结尾页：浅底 + 右下角出血品牌色块 + 往左上错位的白卡「下一步」）

> **📄 详情**：本文件供 design 阶段匹配到 L49 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**浅底**、文字为主，右下角一块品牌色出血块，视觉中等（约 150–300 字）
- **核心手法**：**斜向错位叠压**（L35 竖着错、L48 横着错，这一条是斜着错）—— ① 品牌色实块占右下角（`.l49-block`，40%×52%，右边和下边都出血）；② 一张白卡（`.l49-card`：`top:400px` / `right:96px` / `bottom:96px` / `width:38%`）从左上方压下来盖住色块的左上角，于是色块只在右侧露出 96px、底部露出 96px，而白卡的上沿和左沿反过来伸出色块之外；③ 左半浅底上纵向居中一组：加宽字距英文 + 64×5px 品牌色短杠 + 88px 衬线巨字（`<em>` 收尾词）+ 一段收尾话，底部细线上两栏元信息
- **是否全幅**：**是** —— 不包 `.slide-inner`（色块要贴到画面边缘）
- **底色**：默认不加类（就是 deck 的 `var(--c-bg)`）
- **什么时候用**：**整份最后一页**，而且这一页要留下「接下来做什么」—— 提案的下一步 / 试点安排 / 需要对方决策的三件事。纯致谢、纯金句的收场用暗底那一条

---

## 二、结构拆解（由后到前）

### 1. 色块 · `.l49-block`

- 右下角 40%×52%，`right:0;bottom:0` 两边出血。它只有一个作用：**给白卡垫出一个斜向的错位关系**。
- **把它铺到贴满右半（或者把卡片挪进它里面）之后，这一页就是「浅底上放了一张白卡」**，收尾的分量没了，
  而每一层都渲染正常、一处都不报错。三个数一起构成错位：色块 40%×52% + 卡片 `top:400px` + `right/bottom:96px`。
- 整份走冷色时改 `var(--c-accent)`（V3）；严肃场合改 `var(--c-ink-deep)`（V4）。**不要用 `var(--c-bg-alt)` 这种浅色**
  （和页面浅底糊成一片，等于没有色块，这一页就只剩一张白卡）。

### 2. 白卡 · `.l49-card`（下一步）

- 里面是 `<h2>` 小标题（带 2px 深色下线）+ 3 条 `.l49-step`（编号 + 一行动作 + 一句补充）。
- **`.page-title` 不许写进卡里** —— 页脚目录面板按 `.page-title` 取每页标题，写进卡里的话整份目录里
  这一页显示成「下一步」，而这一页本身看起来完全正常。
- 阴影是「浮在色块之上」的唯一线索，别去掉。`top:400px` 决定卡的上沿伸出色块多少（色块顶在 518px），
  往下挪过 518px 之后卡整个落进色块里，斜向错位就没了。
- **3 条最合适，最多 4 条**（卡内高 584px，一条「标题 + 一行补充」约 65px + 行距 26px；第 5 条起
  `justify-content:center` 会把上下两条顶出卡外，压在色块和浅底上 —— 故意不裁）。行动项本来就该只有三件。

### 3. 左侧文字 · `.l49-txt`

- **纵向居中**（`top:50% + translateY(-56%)`），不是固定 `top`：巨字一行还是两行都不会在左半留出一大块空洞。
- 巨字 **8 字以内（一行）**：写到 10 字以上会折成两行，而第二行常常只剩一个字（88px 的一个孤字挂在那儿，
  看起来只是「这句写得有点怪」）。最多两行，`<em>` 那半句用 `var(--c-brand-deep)`。
- 收尾话 2–3 行（`max-width:640px`），是「接下来怎么推进」，不是再总结一遍结论。
- 文字块宽 44%（到卡片左缘还剩 109px）—— **别加宽**：加到 50% 之后长标题的末几个字压在白卡边沿上，
  颜色还是深的，读起来只是「有点挤」。

### 4. 元信息 · `.l49-foot`

- 底部细线上两栏（`<b>` 加宽字距小标签 + 一行值）：单位 / 联系方式 / 日期里挑两项。
- **不写页码**（整份页码只由播放器页脚按 section 顺序算，模型编的那个数字必然对不上，而一页写着页码的
  收尾页读起来完全正常 —— 硬规则 3）。

---

## 三、CSS 骨架

```css
/* L49 结尾页（浅底）：右下角出血品牌色块 + 往左上错位的白卡「下一步」+ 左侧衬线巨字 */
.l49-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l49-block{position:absolute;right:0;bottom:0;width:40%;height:52%;background:var(--c-brand);z-index:0}
.l49-txt{position:absolute;left:var(--pad-x);top:50%;transform:translateY(-56%);width:44%;z-index:2}
.l49-en{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.3em;color:var(--c-brand-deep)}
.l49-rule{width:64px;height:5px;background:var(--c-brand);margin:26px 0 30px}
.l49-txt .page-title{font-family:var(--serif);font-size:88px;font-weight:900;line-height:1.14;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l49-txt .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l49-txt p{margin-top:28px;font-size:23px;line-height:1.8;color:var(--c-ink);max-width:640px}
.l49-foot{position:absolute;left:var(--pad-x);bottom:var(--pad-bottom);z-index:2;width:44%;display:flex;gap:56px;padding-top:22px;border-top:1px solid var(--c-hairline)}
.l49-foot div{font-size:19px;line-height:1.5;color:var(--c-ink-deep)}
.l49-foot b{display:block;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;color:var(--c-ink-soft);margin-bottom:8px}
.l49-card{position:absolute;right:96px;bottom:96px;top:400px;width:38%;z-index:2;background:var(--c-card);box-shadow:0 40px 90px rgba(0,0,0,.24);padding:48px 56px;display:flex;flex-direction:column}
.l49-card h2{font-size:26px;font-weight:800;line-height:1.3;color:var(--c-ink-deep);padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.l49-steps{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:26px}
.l49-step{display:grid;grid-template-columns:58px 1fr;gap:20px;align-items:start}
.l49-no{font-family:var(--num);font-size:30px;font-weight:800;line-height:1.2;color:var(--c-brand)}
.l49-step h3{font-size:22px;font-weight:800;line-height:1.4;color:var(--c-ink-deep)}
.l49-step p{margin-top:6px;font-size:17px;line-height:1.65;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L49">
  <!-- 全幅：不包 .slide-inner。模块名由代码贴（.slide-header），这里不要写 -->
  <div class="l49-wrap"></div>
  <div class="l49-block"></div>
  <div class="l49-txt">
    <div class="l49-en">{{英文小字，如 NEXT STEPS}}</div>
    <div class="l49-rule"></div>
    <h1 class="page-title">{{收尾巨字，8 字以内一行，<em>半句</em>上色}}</h1>
    <p>{{接下来怎么推进，2–3 行}}</p>
  </div>
  <div class="l49-card">
    <h2>{{卡片小标题，如 接下来三件事}}</h2>
    <div class="l49-steps">
      <div class="l49-step">
        <div class="l49-no">01</div>
        <div>
          <h3>{{第一件事，一行}}</h3>
          <p>{{一句补充：谁做、什么时候}}</p>
        </div>
      </div>
      <div class="l49-step">
        <div class="l49-no">02</div>
        <div>
          <h3>{{第二件事}}</h3>
          <p>{{一句补充}}</p>
        </div>
      </div>
      <div class="l49-step">
        <div class="l49-no">03</div>
        <div>
          <h3>{{第三件事}}</h3>
          <p>{{一句补充}}</p>
        </div>
      </div>
    </div>
  </div>
  <div class="l49-foot">
    <div><b>CONTACT</b>{{单位 / 联系方式}}</div>
    <div><b>DATE</b>{{日期}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：整页只有色块、白卡、巨字三层，塞一张图进来必然是压在色块上的第四层，斜向错位读不出来了。要气氛图的收尾用暗底那一条 |

**禁用**：任何 `<img>` / 背景图（这一页的分量来自那块出血色块，图会把它盖掉，而页面照样渲染）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 整组镜像（色块到左下、白卡到右下的镜像位置，文字挪到右半） | 上一页视觉重心在右时 |
| V2 | 卡里 4 条 | 下一步确实有四件事（上限） |
| V3 | 色块改 `var(--c-accent)` | 整份走冷色调 |
| V4 | 色块改 `var(--c-ink-deep)` 深块 | 严肃场合 |
| V5 | 去掉卡内每条的补充说明（只留一行动作） | 动作本身说得清 |
| V6 | 去掉 `.l49-foot`（不留联系信息） | 内部汇报 |

---

## 七、design 提示

- **只当整份最后一页**：中间用它会读成「讲完了」；这一页的重点是**下一步做什么**，纯致谢/纯金句的收场用暗底那一条
- **错位是结构签名**：色块占右下角两边出血 + 白卡从左上方压下来（色块只露右 96px、底 96px）；把色块铺满右半或把卡片挪进色块里之后，这一页退回「浅底上放了一张白卡」，而每一层都渲染正常
- **`.page-title` 必须留在左侧那块**：页脚目录面板按它取标题，写进白卡里的话整份目录里这一页显示成「下一步」，而这一页本身完全正常
- **巨字 8 字以内**：10 字以上折成两行、第二行常常只剩一个孤字（88px 的一个字挂在那儿，看起来只是「写得有点怪」）
- **卡内 3 条、最多 4 条**：第 5 条起被 `justify-content:center` 顶出卡外压在色块上（故意不裁）；行动项本来就该只有三件
- **文字块宽度别加**：44% 到卡片左缘只剩 109px，加宽之后长标题末几个字压在白卡边沿上，颜色还是深的、读起来只是「有点挤」
- **不写页码**：页码只由播放器页脚按顺序算，模型编的那个数字必然对不上，而写着页码的收尾页读起来完全正常
- **配色**：色块 `var(--c-brand)`（冷色 deck 用 `var(--c-accent)`），巨字 `<em>` 和英文小字用 `var(--c-brand-deep)`（浅底上比 `var(--c-brand)` 压得住），卡片底必须 `var(--c-card)`（用 `var(--bg-plain)` 的话卡片和浅底同色、整张卡消失，只剩悬空的文字压在色块上）
- **与暗底那条结尾的区别**：暗底那条是气氛图 + 中央细框巨字 + 三栏联系信息（收场、致谢），这一条是浅底 + 出血色块 + 一张「下一步」卡（收场、要动作）；**同一份里两条结尾只能选一条**
- **与 L35 的区别**：同一族的错位叠压，L35 是竖着错的封面（色块贴右通高 + 竖图往左错），这一条是斜着错的结尾（色块占右下角 + 白卡往左上错）
