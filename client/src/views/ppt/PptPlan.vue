<template>
  <!-- 详情页做成「真 PPT 软件」的样子：左边一条页面缩略图菜单，右边一整块当前页。
       原来那版是十几行「缩略图 + 信息 + 预览」竖着排下来，翻到第 8 页要滚很久，
       而「这一页到底生成了没有」得逐行去认 —— 现在状态都收在左边那条上。 -->
  <div class="wb">
    <div class="bg-elements">
      <div class="bg-overlay"></div>
      <div class="grid-bg"></div>
    </div>

    <header class="topbar">
      <div class="tb-left">
        <router-link class="btn-back-icon" to="/ppt/decks" title="返回演示稿列表">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </router-link>
        <div class="tb-title">
          <input v-model="title" class="title-input" maxlength="80" placeholder="这份演示稿的名字" @blur="saveMeta()" />
          <!-- 「哪些东西存下来了」必须一直在界面上：每一页都是一次真实调用，他要能确定
               关掉页面回来还在，不然只能靠再点一次生成来确认，而那是重新花钱。 -->
          <div class="tb-meta" :class="{ bad: metaErr }">
            <span v-if="pages.length">共 {{ pages.length }} 页 · 已生成 {{ builtCount }} · 用到 {{ usedLayouts }} 个版式</span>
            <span v-else-if="running">正在规划…</span>
            <span v-else>还没规划</span>
            <!-- 空闲时那句「改动失焦即存」已经去掉（头部不留提示）—— 只剩「保存中… / 已保存
                 hh:mm / 没保存上」这三个**状态**，没状态时连分隔点一起不显示。 -->
            <template v-if="saveLabel">
              <span class="sep">·</span>
              <span>{{ saveLabel }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- 只有一个主按钮 = 下一步（见 `nextAct`）。剩下那两件事被顶下去时照旧留着，
           但是次要样式：全都一样重的话，每次进来他都要自己判断该点哪个。 -->
      <div class="tb-actions">
        <button class="btn-primary" :disabled="nextAct.busy" @click="nextAct.act()">{{ nextAct.label }}</button>
        <!-- 停止是必需的：一页一次真实调用，看到前两页不对时不给停就是把剩下十几次额度花完。 -->
        <button v-if="batchRunning" class="btn-ghost warn" @click="stopBatch">停止</button>
        <button class="btn-ghost" @click="showSettings = true">提纲与设置</button>
        <button
          v-if="nextAct.key !== 'images'"
          class="btn-ghost"
          :disabled="batchRunning || !builtCount || !imgTodo"
          @click="fillAllImages"
        >{{ imgTodo ? `配全部图（差 ${imgTodo} 张）` : '图都配齐了' }}</button>
        <button
          v-if="nextAct.key !== 'export'"
          class="btn-ghost"
          :disabled="batchRunning || exporting || exportingPptx || !pages.length || builtCount < pages.length"
          @click="exportDeck"
        >{{ exporting ? '导出中…' : '导出 .html' }}</button>
        <!-- .pptx 是可编辑的那一份（每块字都是 PowerPoint 文本框）。**必须显示进度和禁用**：
             服务端一页要开浏览器渲一遍，十几页要十几秒 —— 没有「导出中」的话他会连点，
             而每次点都真开一个浏览器。 -->
        <button
          class="btn-ghost"
          :disabled="batchRunning || exporting || exportingPptx || !pages.length || builtCount < pages.length"
          @click="exportPptx"
        >{{ exportingPptx ? `导出 pptx 中…（${pages.length} 页，约 ${pptxEta} 秒）` : '导出 .pptx（可编辑）' }}</button>
      </div>
    </header>

    <!-- 打不开这份稿子（换了账号 / 已删掉 / id 抄错）必须说清并给一条回列表的路：
         只留一个空工作台的话，读起来像「这份稿子里什么都没有」，他会当场重打一遍提纲。 -->
    <div class="banners">
      <p v-if="loadErr" class="banner bad">{{ loadErr }} <router-link to="/ppt/decks">回演示稿列表</router-link></p>
      <p v-if="error" class="banner bad">{{ error }}</p>
      <p v-if="metaErr" class="banner bad">{{ metaErr }}</p>
      <p v-if="batchNote" class="banner">{{ batchNote }}</p>
      <!-- 删页的回执。**逐类报数**（一次生成 / 几张备好的图 / 手写的要求）：只说「已删除」的话
           他不知道刚扔掉的是几次真实花费，而少掉的那一页在界面上只是少了一张卡。 -->
      <p v-if="structNote" class="banner" :class="{ bad: structErr }">{{ structNote }}</p>
      <!-- 换画风之后已经配好的那几页**不会自动重做**：不说的话整份翻下来笔触不统一，
           而每张图单看都好、没有一处报错。 -->
      <p v-if="styleMismatch" class="banner warn">{{ styleMismatch }}</p>
      <p v-if="deckErr" class="banner bad">{{ deckErr }}</p>
      <p v-if="exportErr" class="banner bad">{{ exportErr }}</p>
      <!-- pptx 的回执**保留**（.html 那条被删掉了）：这条路是有损的 —— 装饰还原不了、
           服务器取不到字体/图时版面会偏，而下载下来的文件自己打开是一份完整的稿子，
           不说的话他会以为「pptx 就长这样」，回头照它把网页版也改素了。
           「可编辑 M 块」是「这份真的能改字」唯一的凭据，所以和页数一起写在第一行。 -->
      <p v-if="pptxNote" class="banner">{{ pptxNote }}</p>
      <p v-for="(w, i) in pptxWarnings" :key="i" class="banner warn">{{ w }}</p>
      <!-- 「已导出 xxx.html（N 页）—— 双击就能放映」那条回执连着它下面那几条依赖说明
           （字体走 Google Fonts、图走 COS）**故意删了**（他要的）。代价：那几句话原来是唯一能
           解释「转给同事打开之后字变瘦了 / 图全是破的」的地方，而下载下来的文件自己打开一切正常。
           导出失败（`exportErr`）照旧出声。 -->
    </div>

    <div class="wb-body">
      <aside class="rail">
        <div class="rail-head">
          页面
          <em v-if="pages.length">{{ builtCount }} / {{ pages.length }}</em>
        </div>
        <!-- 分屏条（一屏 15 个缩略图）。**必须写出这一屏是第几页到第几页** —— 只画几个
             屏号的话「后面那些页呢」看不出来，而这一栏原来是整份稿子唯一的页清单。
             屏号上那个红点是「这一屏里有页出错了」：不标的话第 27 页那句错误在第 1 屏上
             完全看不见，他只会看到批量结束时一句「失败 1 页」然后找不到是哪一页。 -->
        <div v-if="railCount > 1" class="rail-pager">
          <button class="rp-arrow" :disabled="railIndex === 0" title="上一屏" @click="railIndex--">‹</button>
          <button
            v-for="(w, i) in railWindows"
            :key="i"
            class="rp-num"
            :class="{ on: i === railIndex, bad: w.bad }"
            :title="`第 ${w.from}–${w.to} 页${w.bad ? '（这一屏里有页出错）' : ''}`"
            @click="railIndex = i"
          >{{ i + 1 }}</button>
          <button class="rp-arrow" :disabled="railIndex >= railCount - 1" title="下一屏" @click="railIndex++">›</button>
          <em>第 {{ railWindows[railIndex]?.from }}–{{ railWindows[railIndex]?.to }} 页</em>
        </div>
        <div class="rail-list">
          <!-- 缩略图：生成过的放那一页真的预览（服务端拼的 previewHtml），没生成的放这个版式的
               效果 demo 并盖一层「未生成」—— 不盖的话 demo 看起来就像这一页已经排好了，
               他会直接去拼整份，而拼整份会 400 说缺页。
               **只挂这一屏的那 15 个**（`railSlice`）：每个缩略图都是一份完整的 75KB 预览文档，
               全挂的话低配机器上的表现是「点了没反应」（实测见下面 RAIL_SIZE 那段注释）。 -->
          <button
            v-for="p in railSlice"
            :key="p.page"
            class="slide-item"
            :class="{ on: view === 'page' && current === p.page, blank: !built[p.page] }"
            @click="selectPage(p.page)"
          >
            <span class="si-no">{{ p.page }}</span>
            <span class="si-thumb">
              <iframe v-if="built[p.page]" :srcdoc="built[p.page].previewHtml" scrolling="no" :title="`第 ${p.page} 页`"></iframe>
              <!-- 空白页没有 demo（`demoUrl` 是空串）。**不能让它落到下面那个 iframe 上**：
                   `src=""` 会把工作台这一页自己再套一层加载进来，缩略图里是一整个界面。 -->
              <iframe v-else-if="p.demoUrl" :src="p.demoUrl" loading="lazy" scrolling="no" :title="`${p.layoutId} 效果 demo`"></iframe>
              <em v-if="busy[p.page]" class="si-ghost">生成中…</em>
              <!-- 空白页插进来那一刻就有内容了，所以走到这里 = 库里那一行没写上（少见但会发生）。
                   照旧说「未生成」的话他会去点生成，而那条路对空白页是拒绝的 —— 两句话对不上。 -->
              <em v-else-if="!built[p.page]" class="si-ghost">{{ isBlank(p) ? '内容没了' : '未生成' }}</em>
            </span>
            <span class="si-text">
              <b>{{ p.title || '(这一页没标题)' }}</b>
              <span class="si-tags">
                <!-- 换过版式的显示**换成的那条**（还写规划那条的话，缩略图上这一页的版式
                     和真的用的那条不一样，两边都是一页正常的幻灯片，看不出来）。 -->
                <!-- 空白页写「空白页」而不是 `BLANK`：那个词只有我们看得懂，而它出现在
                     一排 L 编号中间时读起来像某条版式的名字。 -->
                <i class="tag" :class="{ warn: setupLayout[p.page] }">{{ setupLayout[p.page] || (isBlank(p) ? '空白页' : p.layoutId) }}</i>
                <i v-if="setupNotes[p.page]" class="tag" :title="setupNotes[p.page]">要求</i>
                <i v-if="built[p.page] && slotCount(p.page)" class="tag" :class="filledCount(p.page) >= slotCount(p.page) ? 'ok' : 'warn'">
                  图 {{ filledCount(p.page) }}/{{ slotCount(p.page) }}
                </i>
                <i v-else-if="p.images" class="tag">图 {{ p.images }}</i>
                <!-- 备好的图也要在这条上：只在当前页的详情里显示的话，「哪几页已经备过图了」
                     得逐页点开才看得出来，而每一张都是花过钱的。 -->
                <i v-if="pending[p.page]?.length" class="tag">备 {{ pending[p.page].length }}</i>
                <i v-if="pageErr[p.page] || imgErr[p.page] || prepErr[p.page]" class="tag bad">出错</i>
                <!-- 「N 处」那个标签跟着右栏那一块一起去掉了（见那边的注释）：留着的话缩略图上
                     挂着一个数字，而点进去右栏什么都没有 —— 他会在界面上找一块已经不存在的东西。 -->
              </span>
            </span>
          </button>

          <button v-if="pages.length" class="slide-item deck-item" :class="{ on: view === 'deck' }" @click="openDeck">
            <span class="si-no">▶</span>
            <span class="si-text">
              <b>整份放映（{{ pages.length }} 页）</b>
              <span class="si-tags">
                <i class="tag" :class="builtCount < pages.length ? 'warn' : 'ok'">
                  {{ builtCount < pages.length ? `还差 ${pendingCount} 页` : '可以拼' }}
                </i>
              </span>
            </span>
          </button>
        </div>
      </aside>

      <main class="stage">
        <!-- 还没规划：这里必须能说出「在等什么」。空白一块的话和「规划失败了」分不开。 -->
        <div v-if="!pages.length" class="stage-empty">
          <div v-if="running" class="ios-loading-bar"><div class="ios-loading-fill"></div></div>
          <b v-if="running">正在规划这份提纲…</b>
          <b v-else>这份稿子还没有规划</b>
          <p v-if="running">一次真实 AI 调用，通常 10–40 秒。它只挑版式、不生成 HTML。</p>
          <p v-else>
            打开「提纲与设置」贴一份提纲再点规划 —— 规划会把提纲拆成逐页，并从<router-link to="/ppt/layouts">案例库那 61 个版式</router-link>里给每页挑一个。
          </p>
          <button v-if="!running" class="btn-primary" @click="showSettings = true">去写提纲</button>
        </div>

        <!-- 整份放映 -->
        <template v-else-if="view === 'deck'">
          <div class="stage-head">
            <div class="sh-left">
              <h2>整份放映</h2>
              <div class="stage-tags">
                <span>点画面右侧或按 → 翻页</span>
                <span>改过某一页之后这份会作废，要重新拼</span>
              </div>
            </div>
            <div class="stage-acts">
              <button class="btn-ghost" :disabled="batchRunning || builtCount < pages.length" @click="makeDeck">
                {{ deckHtml ? '重新拼一次' : '拼成整份' }}
              </button>
            </div>
          </div>
          <!-- 画面按**剩下的空间**缩放（16:9 撑到最大再水平垂直居中），不按整页宽度铺开：
               铺开的话它比屏幕高，看一页要滚一次，而滚下去之后顶栏那几个按钮和左边那条
               缩略图全看不见了。 -->
          <div class="screen-wrap">
            <div class="screen">
              <iframe v-if="deckHtml" :srcdoc="deckHtml" title="整份 deck 预览"></iframe>
              <div v-else class="screen-overlay solid">
                <b v-if="builtCount < pages.length">还差 {{ pendingCount }} 页没生成，拼不出整份</b>
                <b v-else>还没拼</b>
                <p v-if="builtCount < pages.length">缺页的 deck 翻起来和完整的一模一样，只是内容跳了一段 —— 所以这里不给拼。</p>
                <p v-else>点上面「拼成整份」（不花 AI 额度）。</p>
              </div>
            </div>
          </div>
        </template>

        <!-- 当前页 -->
        <template v-else-if="cur">
          <div class="stage-head">
            <div class="sh-left">
              <span class="kicker" v-if="cur.section">{{ cur.section }}</span>
              <h2>P{{ cur.page }} · {{ cur.title }}</h2>
              <!-- 标题下面那行版式读数（`L48 agenda-offset-card ↗ · 目录页：… · 全幅 · 规划要 N 张图 ·
                   已换成 Lxx · 带额外要求）**故意删了**（他要的）。别再加回来：换过的版式和「要求」
                   在左边缩略图那一列上每页都有一个标（`.tag.warn` / 「要求」），版式详情在
                   「生成前改一下」里点开就是缩略图，所以这里去掉不会让任何改动变得看不见。 -->
            </div>
            <div class="stage-acts">
              <!-- 空白页上的唯一入口：加一个文字框（不调 AI、不花额度）。放在这一行最前面 ——
                   空画布上什么都没有，没有这个按钮的话「往上加东西」这件事在界面上一处也
                   看不出来（他只会看到一块白，以为这一页坏了）。 -->
              <button
                v-if="isBlank(cur) && built[cur.page]"
                class="btn-ghost"
                :disabled="editBusy || structBusy || batchRunning"
                @click="saveCanvas('add-text')"
              >{{ editBusy ? '处理中…' : '＋ 一个文字框' }}</button>
              <!-- 往画布上放一张图：走的是已有那个素材库抽屉（挑一张不花钱，抽屉里也能传本地图）。
                   没有这个入口的话「画布上能放图」这件事一处也看不出来，他只会去插一页普通版式页
                   再让 AI 生一张（那是一次真花钱的调用，出来的还不是他手上那张）。 -->
              <button
                v-if="isBlank(cur) && built[cur.page]"
                class="btn-ghost"
                :disabled="editBusy || structBusy || batchRunning"
                @click="openPicker(cur.page, 0, true)"
              >＋ 一张图（素材库/本地）</button>
              <!-- 空白页没有「生成」这一步（⑥）：留着这个按钮的话他点下去是一句拒绝，
                   而按钮上写着「重新生成」—— 看起来像这一页出了故障。服务端那一道照旧拦着
                   （另一个标签页/直接调接口）。 -->
              <button v-if="!isBlank(cur)" class="btn-ghost" :disabled="busy[cur.page] || batchRunning || imgBusy[cur.page]" @click="openSetup(cur)">
                {{ busy[cur.page] ? '生成中…' : built[cur.page] ? '重新生成…' : '生成这一页…' }}
              </button>
              <button
                v-if="built[cur.page] && slotCount(cur.page)"
                class="btn-ghost"
                :disabled="imgBusy[cur.page] || batchRunning || busy[cur.page]"
                @click="fillImages(cur)"
              >
                {{ imgBusy[cur.page] ? '生图中…（一张几十秒）' : filledCount(cur.page) ? `补齐图（差 ${slotCount(cur.page) - filledCount(cur.page)} 张）` : `生成 ${slotCount(cur.page)} 张图` }}
              </button>
              <button
                v-if="built[cur.page] && filledCount(cur.page)"
                class="btn-ghost"
                :disabled="imgBusy[cur.page] || batchRunning"
                @click="fillImages(cur, true)"
              >换一批图</button>
              <!-- 删这一页。**批量/单页正在跑的时候一律禁掉**：那几次调用回来时是按页码写库的，
                   页码在这中间挪过一位的话，结果会落到别的一页上（服务端 098 那道 planRev
                   也会拦，这里禁掉是为了不让他白花一次调用）。 -->
              <button
                class="btn-ghost warn"
                :disabled="structBusy || batchRunning || busy[cur.page] || imgBusy[cur.page] || pages.length < 2"
                :title="pages.length < 2 ? '整份只剩这一页了，删了这份稿子看起来就像没规划过' : ''"
                @click="removePage(cur)"
              >{{ structBusy ? '删除中…' : '删掉这一页…' }}</button>
              <!-- 插一页（不调 AI、不花额度）。禁用条件同上：那几次在跑的调用是按页码写库的。 -->
              <button
                class="btn-ghost"
                :disabled="structBusy || batchRunning || busy[cur.page] || imgBusy[cur.page]"
                @click="openInsert(cur.page)"
              >{{ structBusy ? '处理中…' : '在这后面插一页…' }}</button>
              <!-- 插一页空白页（不调 AI、不花额度，插进来就是「已生成」的一张空画布）。
                   和上面那个分成两个按钮、不做成框里的一个勾选框：那两条路收的东西不一样
                   （空白页不要要点、不挑版式），一个勾选框漏勾就是插进来一页要 AI 生成的页，
                   而它在界面上和空白页一样都是「新插的一页」。 -->
              <button
                class="btn-ghost"
                :disabled="structBusy || batchRunning || busy[cur.page] || imgBusy[cur.page]"
                @click="openInsert(cur.page, true)"
              >{{ structBusy ? '处理中…' : '插一页空白页…' }}</button>
            </div>
          </div>

          <div class="screen-wrap">
            <div class="screen">
              <!-- 这一份预览带着编辑脚本（`editSrcdoc`）。`:key` 是承重的：存失败时靠它
                   重挂 iframe 把画面退回库里那一版 —— 不退的话屏幕上是他刚打的那句、库里
                   是旧的，而画面读起来完全正常（他会直接去导出）。 -->
              <iframe
                v-if="built[cur.page]"
                :key="`${cur.page}:${previewKey}`"
                :srcdoc="editSrcdoc"
                :title="`第 ${cur.page} 页预览`"
              ></iframe>
              <template v-else>
                <iframe class="faded" :src="cur.demoUrl" :title="`${cur.layoutId} 效果 demo`"></iframe>
                <div class="screen-overlay">
                  <b>这一页还没生成</b>
                  <!-- 这句话是硬的：底下那张是**版式 demo**，不是他的内容。不说的话他会以为
                       这一页已经排好了（读起来完全正常，只是文字全是示例）。 -->
                  <p>下面看到的是 {{ cur.layoutId }} 的效果 demo（生成时照的就是这个骨架），<b>不是这一页的内容</b>。</p>
                  <button class="btn-primary" :disabled="busy[cur.page] || batchRunning" @click="openSetup(cur)">
                    {{ busy[cur.page] ? '生成中…' : '生成这一页' }}
                  </button>
                </div>
              </template>
              <!-- 生成/生图期间画面上必须有东西在动，而且要说清「下面这张是上一版」：
                   重新生成一次要 20–60 秒，这期间 iframe 里挂的还是旧那一页 —— 只把顶上
                   按钮的字改成「生成中…」的话，画面读起来就是「已经生成完了、还是这个样子」，
                   他会当成没生效再点一次（每次一次真实调用）。 -->
              <div v-if="busy[cur.page] || imgBusy[cur.page] || aiBusy" class="screen-overlay busy">
                <div class="ios-loading-bar"><div class="ios-loading-fill"></div></div>
                <!-- 重排图位那一步要单独说：它和生成一样是十几秒的真实调用，都写「正在生成这一页…」
                     的话这一下等的是两段（重排 + 生成），读起来像「这次特别慢」。 -->
                <b>{{ replanBusy[cur.page] ? '正在按新版式重排图位…'
                  : busy[cur.page] ? '正在生成这一页…' : aiBusy ? '正在按你那句话改这一块…' : '正在生成这一页的图…' }}</b>
                <!-- 这一条必须排在链子最前面（重排期间 `busy` 也是 true —— 见 `startBuild`），
                     不然这里会同时挂两句「一次真实调用」。 -->
                <p v-if="replanBusy[cur.page]">
                  生成前的第 1 步（一次真实调用，不生图）：先把图位的格数和比例按这条版式对齐，接着自动生成这一页。
                </p>
                <!-- AI 编辑也要盖这一层：不盖的话画面十几秒一动不动（下面挂的是改之前那一版），
                     读起来就是「已经改完了、没什么变化」，他会再点一次 —— 那是再花一次额度。 -->
                <p v-else-if="aiBusy">一次真实 AI 调用，通常十几秒。下面看到的还是改之前那一版。</p>
                <p v-else-if="busy[cur.page]">
                  一次真实 AI 调用，通常 20–60 秒，回来之后画面会自己换。
                  <b v-if="built[cur.page]">下面看到的还是上一版，不是这次的结果。</b>
                </p>
                <p v-else>一张图几十秒，逐张来；已经生成好的那几张不会重做。</p>
              </div>
              <!-- 底下那一条藏起来之后，存失败的那几句话唯一的出口（见 `SHOW_EDIT_DOCK`）：
                   只在**失败**时出现（成功的读数和说明不再显示），`absolute` 所以不占高度。 -->
              <div v-if="!SHOW_EDIT_DOCK && (editErr[cur.page] || paletteErr)" class="edit-flash">
                {{ editErr[cur.page] || paletteErr }}
              </div>
            </div>
          </div>
          <!-- 画面底下这一条**高度必须是预留死的**（`.stage-foot` 的 min-height）：`.screen`
               的宽度是 `min(100cqw, 100cqh*16/9)`，也就是说这里长出一行，上面那块 16:9 的画面
               就立刻缩一圈。而这里长出一行的时机正是「他点下第一下」（选中读数 + AI 那一栏
               同时出现）—— 于是双击的第二下落在缩过之后的画面上，点到的是别的元素，
               现象是「双击改不动文字了」，而屏幕上一切正常，没有一处报错。 -->
          <div v-if="SHOW_EDIT_DOCK" class="stage-foot">
          <!-- 这一行是「就地改文字」唯一的入口说明：不写的话双击能改这件事没有一处
               看得出来（hover 那圈虚线只有把鼠标放上去才出现）。存失败那句必须留在
               这里而不是只写进右边抽屉 —— 那是收起来的。 -->
          <p v-if="built[cur.page]" class="edit-tip" :class="{ bad: editErr[cur.page] }">
            <template v-if="editErr[cur.page]">{{ editErr[cur.page] }}</template>
            <template v-else-if="editBusy">正在存这段文字…</template>
            <template v-else-if="editNote">{{ editNote }}</template>
            <!-- 空白页要单独说一句，而且**必须排在 `canEditText` 前面**：一页还没加东西的空画布
                 html 里一个 `data-eid` 都没有，跟着走到下面那句的话界面会说「这一页是加就地改文字
                 之前生成的，重新生成一次就可以」—— 那是一句彻底的谎（空白页压根没有生成这一步，
                 他会去找那个按钮，而它是藏着的）。 -->
            <template v-else-if="isBlank(cur)">
              <b>这是一页空白画布：点上面「＋ 一个文字框」加字、「＋ 一张图」放图</b>（都不调 AI、不花额度）——
              加完拖着挪位置、拉右下角那个蓝方块改大小、双击改字，单击选中之后浮动条上能改颜色/字号/粗细，🗑 删掉这一块。
              <span v-if="canEditText">改完立刻存，Esc 取消。</span>
              <span v-if="paletteErr" class="bad">{{ paletteErr }}</span>
            </template>
            <template v-else-if="canEditText">
              <b>单击选中一句字改颜色/字号/粗细/对齐，双击直接改文字；点字之间的空处选中一整块</b>
              （都不调 AI、不花额度）—— 改完立刻存，Esc 取消。<span v-if="paletteErr" class="bad">{{ paletteErr }}</span>
            </template>
            <template v-else>
              这一页是加「就地改文字」之前生成的，双击改不了 —— 重新生成一次这一页就可以。
            </template>
          </p>
          <!-- AI 编辑那一栏：只在选中了一块时出现（没选中就点的话花掉一次额度改的是
               上一次那一块 —— 画面变了、摘要读起来完全正常）。 -->
          <div v-if="built[cur.page] && (aiSel || aiBusy || aiNote || aiErr)" class="ai-edit">
            <input
              v-model="aiWish" class="ai-wish" :maxlength="MAX_REMAKE_WISH" :disabled="aiBusy"
              placeholder="跟 AI 说这一块怎么改：「这三条排成两列」（微调）/「改成两列卡片，每张配一张小图」（自由改造）"
              @keyup.enter="aiEdit()"
            />
            <button class="btn-ai" :disabled="aiBusy || !aiSel || !aiWish.trim()" @click="aiEdit()">
              {{ aiBusy ? '正在改…' : '微调这一块' }}
            </button>
            <!-- 两个按钮、不是一个开关：这一条放开了「删原文 / 新写文案 / 加图」，走错一条的
                 现象是「AI 怎么没照我说的改」，而两边都花掉一次额度。 -->
            <button class="btn-ai ghost" :disabled="aiBusy || !aiSel || !aiWish.trim()" @click="aiRemake()">
              {{ aiBusy ? '正在改…' : '自由改造（不套版式）' }}
            </button>
            <span v-if="aiErr" class="ai-msg bad">{{ aiErr }}</span>
            <template v-else-if="aiNote">
              <span class="ai-msg ok">{{ aiNote }}</span>
              <!-- 这几条是「放开了、但必须出声」的那些改动（丢掉的原文 / AI 新写的文案 /
                   新增的图槽）：不显示的话它们在画面上读起来完全正常。 -->
              <ul v-if="aiNotes.length" class="ai-notes">
                <li v-for="(n, i) in aiNotes" :key="i">{{ n }}</li>
              </ul>
            </template>
            <span v-else-if="aiSel" class="ai-msg">
              改「{{ aiSel.label }}」这一块（都是一次真实调用）—— <b>微调</b>只动排版，文案打码 AI 碰不到；
              <b>自由改造</b>可以重排结构、加图、新写文案，改了哪几句会逐条列出来
            </span>
          </div>
          </div>
        </template>
      </main>

      <!-- 这一页的信息浮在画面右侧，可以滑进滑出（默认收起，画面因此撑到最大）。
           收起来之后 problems、生图失败的那几格（「还是占位图」）就全看不见了，而画面上
           那一页读起来完全正常 —— 所以把手上一直带着「N 处要注意」那个数字，且这一页的
           问题数一变多就自动弹开（见 `curIssues`）。它是全页唯一会滚的地方（除了左边
           那条和弹窗）；摊开的内容本身不再折叠。 -->
      <div v-if="view === 'page' && cur" class="ins-dock" :class="{ open: insOpen }">
        <button
          class="ins-handle"
          :class="{ alarm: curIssues }"
          :title="insOpen ? '收起这一页的详情' : '展开这一页的详情（理由 / 逐张配图 / problems / HTML）'"
          @click="insOpen = !insOpen"
        >
          <span class="ih-arrow">{{ insOpen ? '›' : '‹' }}</span>
          <span class="ih-txt">这一页详情</span>
          <span v-if="curIssues" class="ih-badge">{{ curIssues }}</span>
        </button>
        <aside class="inspector">
            <p v-if="pageErr[cur.page]" class="banner bad">{{ pageErr[cur.page] }}</p>
            <p v-if="imgErr[cur.page]" class="banner bad">{{ imgErr[cur.page] }}</p>
            <!-- 换了版式还没重新生成时，画面里是旧版式排的那一版 —— 两版都是一页正常的
                 幻灯片，不说的话他会以为新版式就长这样。 -->
            <p v-if="layoutMismatch" class="banner warn">{{ layoutMismatch }}</p>
            <p v-if="specMismatch" class="banner warn">{{ specMismatch }}</p>
            <p v-if="orphanPlaceholder" class="banner warn">{{ orphanPlaceholder }}</p>

            <!-- 这一页的黑蒙版（097）。滑块显示的是**服务端那份值**，松手才存、存完拿返回的
                 previewHtml 换画面 —— 本地叠一层黑的话预览里它压在文字上面，而真 deck 里它在
                 背景图上面、内容下面（照本地效果调完，导出的文件是另一副样子）。 -->
            <div class="veil-row">
              <div class="ins-h">
                这一页的蒙版
                <span class="veil-val">{{ Math.round((veil[cur.page] || 0) * 100) }}%</span>
              </div>
              <input
                class="veil-range" type="range" min="0" max="100" step="5"
                :value="Math.round((veil[cur.page] || 0) * 100)"
                :disabled="veilBusy"
                @change="saveVeil(cur.page, Number(($event.target as HTMLInputElement).value) / 100)"
              />
              <p class="muted-note">
                盖在背景图上面、文字下面的一层黑。背景图太亮、字看不清的时候往右拖。
                <b>不花调用</b>，也不用重新生成这一页。
              </p>
              <p v-if="veilErr" class="banner bad">{{ veilErr }}</p>
            </div>

            <div class="ins-cols">
              <div class="ins-col">
                <div class="ins-h">为什么挑这个版式</div>
                <p class="why" :class="{ missing: !cur.why }">
                  {{ cur.why || '（模型没给理由 —— 只能自己看 demo 判断挑得准不准）' }}
                </p>
                <ul v-if="cur.points.length" class="points">
                  <li v-for="(pt, i) in cur.points" :key="i">{{ pt }}</li>
                </ul>

                <!-- 本页内容（= 生成这一页时真正进 prompt 的那一段提纲原文）。
                     不显示的话「这一页为什么少了那组数据」在界面上无处可查：上面那几条要点
                     是模型写的摘要，成稿里少掉的东西在要点里本来也看不见。要改就点「生成」
                     那个对话框（那里才存得下去）—— 这里只读，写在下面那句话里。 -->
                <div class="ins-h mt">本页内容</div>
                <p v-if="cur.coverNote" class="banner warn pre">{{ cur.coverNote }}</p>
                <pre v-if="cur.outlineText?.trim()" class="page-outline">{{ cur.outlineText.trim() }}</pre>
                <p v-else class="muted-note">
                  这一页<b>没有对应的提纲原文</b>（规划没给行号，或者是老规划）——
                  生成时只有上面那几条要点，提纲里的数字、机构名、条款不会出现在页面上。
                  重新规划一次才会有；也可以在「生成」那个对话框里自己粘一段进去。
                </p>
              </div>

              <div class="ins-col">
                <!-- 规划那一步定下的「这几张图画什么」。显示出来才核得动：主题写空了
                     （「一张相关配图」）、比例和图位形状不对、数据页给了 concept ——
                     三种都不报错，等图生出来只会觉得「这批图不太对」。 -->
                <div v-if="cur.images" class="plan-imgs">
                  <div class="ins-h">规划要 {{ cur.images }} 张图</div>
                  <template v-if="cur.imageSpecs?.length">
                    <!-- 已经生成过的那一页：换一张图当场就贴进画面（服务端纯代码替换，不花钱）。
                         这句要写出来，不然他不确定屏幕上这一版是不是已经换过了，会去重新生成一次。 -->
                    <p class="muted-note">
                      <template v-if="built[cur.page]">
                        换或备一张图会<b>当场贴进这一页的画面</b>（不花钱，不用重新生成）。
                      </template>
                      <template v-else>生成这一页 HTML 时，备好的图会按序号自动贴进图位（不再花配图的钱）。</template>
                    </p>
                    <ul class="spec-list">
                      <li v-for="(s, i) in cur.imageSpecs" :key="i">
                        <div class="spec-top">
                          <a
                            v-if="curPrepared[i + 1]"
                            class="spec-thumb"
                            :href="curPrepared[i + 1].url"
                            target="_blank"
                            :title="curPrepared[i + 1].prompt"
                          ><img :src="curPrepared[i + 1].url" :alt="`第 ${i + 1} 格备好的图`" /></a>
                          <span v-else class="spec-thumb empty">未备</span>
                          
                          <div class="spec-acts">
                            <button
                              class="btn-ghost sm"
                              :disabled="prepBusy[`${cur.page}:${i + 1}`] || batchRunning"
                              @click="openAiPrompt(cur.page, i + 1, s.subject || '')"
                            >{{ prepBusy[`${cur.page}:${i + 1}`] ? '生成中…' : 'AI 生成（真实花费）' }}</button>
                            <button
                              class="btn-ghost sm"
                              :disabled="prepBusy[`${cur.page}:${i + 1}`]"
                              @click="openPicker(cur.page, i + 1)"
                            >素材库里挑</button>
                            <button
                              v-if="curPrepared[i + 1]"
                              class="btn-ghost sm"
                              :disabled="prepBusy[`${cur.page}:${i + 1}`]"
                              @click="prepare(cur.page, i + 1, 'clear')"
                            >清掉</button>
                          </div>
                        </div>

                        <div class="spec-txt">
                          <div>#{{ i + 1 }} {{ s.ratio }} · {{ s.mode }} · {{ s.subject }}</div>
                          <div v-if="curPrepared[i + 1]" class="spec-meta">
                            {{ curPrepared[i + 1].from === 'ai' ? '刚生成的' : '素材库挑的' }}
                            · {{ curPrepared[i + 1].ratio }}
                            <!-- 比例对不上只在这里安静写一句，不进 problems（每挑一张都报
                                 「要注意」的话，版式塌了那种真问题会被冲下去）；完全不写
                                 也不行 —— 被 cover 裁掉一块看起来像模型画得不好。 -->
                            <em v-if="ratioClash(s.ratio, curPrepared[i + 1].ratio)">（会裁掉一块）</em>
                            <template v-if="curPrepared[i + 1].styleId"> · 画风 {{ curPrepared[i + 1].styleId }}</template>
                            <em v-if="curPrepared[i + 1].styleId && styleId && curPrepared[i + 1].styleId !== styleId">
                              （这份稿子是 {{ styleId }}，混着用笔触不统一）
                            </em>
                            <em v-if="curPrepared[i + 1].storage === 'local'"> · 存在本机磁盘（换机器会 404）</em>
                          </div>
                        </div>
                      </li>
                    </ul>
                    <p v-if="prepErr[cur.page]" class="banner bad">{{ prepErr[cur.page] }}</p>
                    <div v-if="prepNote[cur.page]?.length" class="problems">
                      <div class="problems-title">备图有 {{ prepNote[cur.page].length }} 处要注意</div>
                      <ul><li v-for="(x, i) in prepNote[cur.page]" :key="i">{{ x }}</li></ul>
                    </div>
                  </template>
                  <p v-else class="muted-note">
                    这份规划没说清每张图画什么（老规划，或者模型只给了张数）——
                    那就只能先生成 HTML、再照它自己写出来的图位配图。重新规划一次才会有逐张说明。
                  </p>
                </div>

                <!-- 生图是部分成功为常态的一步：逐张说清哪张成了、哪张还是占位图、图存哪了。
                     只报一个总数的话，失败的那几格在预览里就是「设计上留白」。 -->
                <div v-if="imgInfo[cur.page]" class="imgs">
                  <div class="ins-h">
                    配图 {{ imgInfo[cur.page].images.filter(i => i.url).length }} / {{ imgInfo[cur.page].images.length }} 张
                    <span class="stylechip">画风 {{ imgInfo[cur.page].style?.id }} {{ imgInfo[cur.page].style?.name }}</span>
                    <span v-if="imgInfo[cur.page].quotaExceeded" class="quota">额度已用完，剩下的没再试</span>
                  </div>
                  <ul>
                    <li v-for="im in imgInfo[cur.page].images" :key="im.index" :class="{ bad: !im.url }">
                      #{{ im.index }} {{ im.ratio }} · {{ im.mode }} · {{ im.prompt || '(没写要什么图)' }}
                      <template v-if="im.url">→ <a :href="im.url" target="_blank">看原图</a>
                        <em v-if="im.skipped">（上次生成的，这次跳过）</em>
                        <em v-else-if="im.storage === 'local'">（存在本机磁盘）</em>
                      </template>
                      <template v-else>→ <span class="bad">{{ im.error || '没生成' }}（还是占位图）</span></template>
                    </li>
                  </ul>
                </div>
                <div v-else class="ins-h muted">这一页还没配过图</div>
              </div>
            </div>

            <div v-if="imgInfo[cur.page]?.problems.length" class="problems">
              <div class="problems-title">生图有 {{ imgInfo[cur.page].problems.length }} 处要注意</div>
              <ul><li v-for="(x, i) in imgInfo[cur.page].problems" :key="i">{{ x }}</li></ul>
            </div>
            <!-- 这一页的 `problems`（`checkPage` 那八条 + 贴图/对齐那几句）**故意不显示了**。
                 代价记在这里：类名不对掉回默认流式布局、提纲被压成三成、图位数和规划对不上、
                 巨标题字号照案例抄、领句抄了标题 —— 这些从此在界面上一个字都没有，而那一页
                 渲染出来都是一页完整正常的幻灯片。库里照旧存着（`problems_json`），要看只能
                 查库或看服务端日志。生成失败 / 配图失败 / 备图失败那几条红字不在这里，照旧出声。 -->

            <div v-if="built[cur.page]" class="src-box">
              <button class="btn-ghost sm" @click="toggleSrc(cur.page)">
                {{ showSrc[cur.page] ? '收起 HTML' : '看这一页的 HTML' }}
              </button>
              <pre v-if="showSrc[cur.page]" class="src">{{ built[cur.page].html }}</pre>
            </div>
        </aside>
      </div>
    </div>

    <!-- 提纲与设置：提纲/品牌/画风/重新规划都收在这里。摊在工作台上的话，占掉的正是
         「当前页」那块地方，而这几样一份稿子里只改几次。 -->
    <div v-if="showSettings" class="drawer-mask" @click.self="showSettings = false">
      <aside class="drawer">
        <div class="dr-head">
          <b>提纲与设置</b>
          <button class="btn-ghost sm" @click="showSettings = false">收起</button>
        </div>

        <p class="dr-note" :class="{ bad: metaErr }">
          <template v-if="metaErr">{{ metaErr }}</template>
          <template v-else>
            {{ saveLabel }} · 规划、每页 HTML、配好的图都随手落库；整份预览和导出的文件是现拼的，
            改过一页之后它们会作废让你重拼。
          </template>
        </p>

        <!-- 自动规划是一次真实调用，必须说出来是谁发起的：只显示「规划中…」的话，
             他会以为是打开页面顺手渲染的东西，直到某天 429 才发现每次进来都在花钱。 -->
        <p v-if="autoPlanned" class="dr-note">
          {{ running ? '进来就自动规划了一次（一次真实调用）——不用再点。' : '这份规划是刚进来时自动跑的；往后每次进来直接用它，不会再花调用。' }}
        </p>

        <!-- 已经规划过之后提纲折成一行（他的提纲动辄八千字，摊开时下面的品牌/画风/设计规范
             全被推到屏幕外，而那几项才是他这时要动的）。**只在「规划过、且提纲没超字数」时折** ——
             超字数折起来的话「规划按钮点不动」就没有任何解释（那个 em 是唯一说出「8043 / 12000」
             的地方），他只会以为按钮坏了。内容本身改到每页详情的「本页内容」里看。 -->
        <div v-if="outlineFolded" class="outline-fold">
          <span>提纲 {{ outline.length }} 字 · 已按它规划成 {{ pages.length }} 页</span>
          <button class="btn-ghost sm" @click="outlineOpen = true">查看 / 修改</button>
        </div>
        <label v-else class="field">
          <span class="label">
            提纲
            <em :class="{ over: outline.length > MAX_OUTLINE }">{{ outline.length }} / {{ MAX_OUTLINE }}</em>
            <button v-if="pages.length" class="btn-ghost sm fold" @click="outlineOpen = false">收起</button>
          </span>
          <textarea
            v-model="outline"
            :disabled="running"
            rows="14"
            @blur="saveMeta()"
            placeholder="一行一条，带层级最好，例如：

云启数科 · AI 转型方案汇报
一、为什么现在做
  1. 行业三个变化：算力降本 / 政策 / 客户预期
  2. 我们的现状：三条业务线、两个痛点
二、我们怎么做
  1. 三阶段路径（试点 → 复制 → 平台化）
  2. 组织与人才
三、投入与回报
  1. 预算拆分
  2. 12 个月里程碑
四、下一步"
          ></textarea>
        </label>

        <!-- 先整理、再分页。提纲里的备注/待办留着的话，规划那一步会把它们当成内容认领进
             某一页（每一行都会被某一页认领、逐字进生成 prompt），于是模型认认真真把
             「这里要补一张图」排成一条要点 —— 那一页看起来完全正常。
             整理**只删行、不改字**（服务端只让模型给行号，删的动作在代码里），
             删掉的每一行都列在下面让他核：删错一行时整理后的提纲读起来完全通顺。 -->
        <div v-if="!outlineFolded" class="clean-row">
          <button
            class="btn-ghost sm" :disabled="cleanBusy || running || !outline.trim()"
            @click="cleanOutlineNow"
          >{{ cleanBusy ? '整理中…' : '先整理提纲（去掉备注 / 待办）' }}</button>
          <button
            v-if="cleanUndo !== null" class="btn-ghost sm" :disabled="cleanBusy" @click="undoClean"
          >撤销整理</button>
          <span class="dr-note">一次真实调用。只删行、不改字，删掉的每一行都会列出来。</span>
        </div>
        <p v-if="cleanErr" class="banner bad">{{ cleanErr }}</p>
        <p v-if="cleanNote" class="banner">{{ cleanNote }}</p>
        <div v-if="cleanRemoved.length" class="banner warn">
          <b>删掉了这 {{ cleanRemoved.length }} 行 —— 原文只留在这个页面里，现在核一遍：</b>
          <ul>
            <li v-for="r in cleanRemoved" :key="r.line">
              第 {{ r.line }} 行：「{{ r.text }}」<em class="why">{{ r.why }}</em>
            </li>
          </ul>
        </div>
        <!-- 这几条是「带数字的行被删了」「删掉的字数占了三成」那种话，逐行带原文，
             所以要保住换行（挤成一段的话那几行原文读不出来，他就不会去核）。 -->
        <p v-for="p in cleanProblems" :key="p" class="banner bad pre">{{ p }}</p>

        <div class="row-fields">
          <label class="field small">
            <!-- 品牌名只影响 deck 外壳（页脚/封面那几个占位符），逐页 HTML 里没有它。 -->
            <span class="label">品牌中文名</span>
            <input v-model="brandCn" :disabled="running" maxlength="24" placeholder="示例企业" @blur="saveMeta()" />
          </label>
          <label class="field small">
            <span class="label">英文名</span>
            <input v-model="brandEn" :disabled="running" maxlength="24" placeholder="SAMPLE" @blur="saveMeta()" />
          </label>
          <label class="field small">
            <!-- 画风只在生图那一步用得上；整份 deck 只能一套，配了几页图再回头换的话
                 前面那几页不会自动重做（上面那条 styleMismatch 会喊）。 -->
            <span class="label">配图画风</span>
            <select v-model="styleId" :title="styleHint" @change="saveMeta()">
              <option v-for="s in styleList" :key="s.id" :value="s.id">{{ s.id }} {{ s.name }}</option>
            </select>
          </label>
        </div>

        <!-- 设计规范（096）：整份统一的配色/字体/疏密。改完**已经生成的页会跟着变**
             （靠覆盖 `:root`，一次调用都不花）—— 所以它和「整份要求」那段是两回事，
             那一段要生效得逐页重新生成。 -->
        <div v-if="designOpts.palettes.length" class="row-fields">
          <label class="field small">
            <span class="label">配色</span>
            <select v-model="design.palette" :disabled="running" @change="applyDesign()">
              <option v-for="o in designOpts.palettes" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
            <span class="dr-note">{{ designHint(designOpts.palettes, design.palette) }}</span>
          </label>
          <label class="field small">
            <span class="label">字体</span>
            <select v-model="design.font" :disabled="running" @change="applyDesign()">
              <option v-for="o in designOpts.fonts" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
            <span class="dr-note">{{ designHint(designOpts.fonts, design.font) }}</span>
          </label>
          <label class="field small">
            <span class="label">疏密</span>
            <select v-model="design.density" :disabled="running" @change="applyDesign()">
              <option v-for="o in designOpts.densities" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
            <span class="dr-note">{{ designHint(designOpts.densities, design.density) }}</span>
          </label>
          <!-- 页眉那一档也在这里，而不是「让模型按样式生成页眉」：页眉一进 prompt 模型就会
               顺手改写模块名、换字号，于是每页左上角那行字都不太一样（硬规则 3）。放在这里
               它和配色走同一条路 —— 改完刷新就变，一次调用都不花。 -->
          <label class="field small">
            <span class="label">页眉</span>
            <select v-model="design.header" :disabled="running" @change="applyDesign()">
              <option v-for="o in designOpts.headers" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
            <span class="dr-note">{{ designHint(designOpts.headers, design.header) }}</span>
          </label>
        </div>
        <p class="dr-note">
          这四项是整份的<b>设计规范</b>，所有页面统一。改完<b>已经生成的页会立刻跟着变</b>（不用重新生成、不花调用）；
          拼好的整份会作废，要重拼一次。案例库里的颜色和间距从此只算参考。
          <b>已经生成的图不会跟着变色</b>（图是像素，不是变量）—— 要笔触和配色都统一，得在那几页点「换一批图」，
          每张都是一次真实花费。往后新生成的图会用现在这套配色。
        </p>
        <p v-for="(m, i) in designProblems" :key="i" class="dr-note bad">{{ m }}</p>

        <!-- 整份统一的那段要求（093）。放在这里而不是每页写一遍：每页抄一遍的话改口径要
             逐页改，漏掉的那几页照旧按老口径生成，而每一页看起来都正常。 -->
        <label class="field">
          <span class="label">
            整份要求（字体 / 排版 / 语气，每页生成都带上）
            <em :class="{ over: deckNotes.length > MAX_NOTES }">{{ deckNotes.length }} / {{ MAX_NOTES }}</em>
          </span>
          <textarea
            v-model="deckNotes"
            rows="3"
            :maxlength="MAX_NOTES"
            @blur="saveMeta()"
            placeholder="例：语气克制、不用感叹号；数字用等宽字体；标题不要超过 12 字"
          ></textarea>
        </label>
        <p class="dr-note">
          改这一段<b>不会自动重排已经生成的那几页</b> —— 它们还是按老要求排的（画面上看不出来），
          要生效得逐页「重新生成」。某一页要额外补充，在那一页的「生成前改一下」里写（两段会一起发）。
        </p>

        <div class="dr-actions">
          <button class="btn-primary" :disabled="!canRun" @click="run">
            {{ running ? '规划中…（10–40 秒）' : pages.length ? '按现在的提纲重新规划' : '开始规划' }}
          </button>
          <span class="muted" v-if="pages.length">
            重新规划会<b>删掉已经生成的那几页</b>（版式和内容都换了，留着会对不上）—— 那是已经花过的调用。
          </span>
        </div>

        <!-- 规划那份 problems 清单（原来的「这次规划有 N 处要注意」）**故意不显示了**：
             十几二十条一次涌出来时他一条都不看，而里面真正要紧的只有一件事 —— 提纲里有几段
             没被任何一页认领（= 他的内容没进成稿）。那件事改成在分页那一步就不许发生
             （硬校验，见服务端），不再靠这里一条没人读的提示。服务端照旧返回 problems
             （落在 `plan_json` 里、也进日志），去掉的只是这块界面。 -->
        <p v-if="usage" class="muted">本次规划 token：输入 {{ usage.prompt_tokens }} / 输出 {{ usage.completion_tokens }}</p>
        <a class="muted link" href="/api/ppt/demo-deck.html" target="_blank">看全部 61 个版式 demo ↗</a>
      </aside>
    </div>

    <!-- 生成前改一下（提纲 + 换版式 + 一段额外要求）。版式和要求**改完就存**，所以
         「逐页生成」和下一次「重新生成」也照着改过的来 —— 不存的话它们会静默退回规划那条
         版式、丢掉那段要求，而生成出来照样是一页完整的幻灯片。**提纲不一样：只有点了下面
         那个生成按钮才存**（他要的就是「没生成就不算改」），所以那句话必须写在框里。 -->
    <div v-if="setupFor" class="drawer-mask" @click.self="setupFor = null">
      <div class="picker">
        <div class="dr-head">
          <b>第 {{ setupFor.page }} 页 · 生成前确认</b>
          <button class="btn-ghost sm" @click="setupFor = null">取消</button>
        </div>
        <p v-if="layoutsErr" class="banner bad">{{ layoutsErr }}</p>
        <p v-if="rebuildImgWarn" class="banner warn">{{ rebuildImgWarn }}</p>
        <p v-if="insertedHint?.page === setupFor.page" class="banner warn">{{ insertedHint!.text }}</p>

        <!-- 提纲放在最上面：这一页说什么是他真正要改的东西，版式和要求都是围着它转的。
             **一定要写明「点生成才存」**：这个框里改完直接关掉是不存的（他要的就是这样），
             不说的话「改了没存」和「存了没生效」在界面上是同一个样子 —— 下次打开又是模型
             那句原话，他会以为保存坏了。 -->
        <label class="field">
          <span class="label">
            这一页的标题
            <em :class="{ over: draftTitle.length > MAX_PAGE_TITLE }">{{ draftTitle.length }}/{{ MAX_PAGE_TITLE }}</em>
          </span>
          <input v-model="draftTitle" type="text" :maxlength="MAX_PAGE_TITLE" placeholder="这一页的标题" />
        </label>
        <label class="field">
          <span class="label">
            这一页的要点（一行一条，最多 {{ MAX_POINTS }} 条）
            <em :class="{ over: draftPointLines.length > MAX_POINTS }">{{ draftPointLines.length }}/{{ MAX_POINTS }} 条</em>
          </span>
          <textarea v-model="draftPoints" rows="5" placeholder="一行一条，模型按这几条排版和写文案"></textarea>
        </label>
        <!-- 提纲原文：**这一段才是逐字进 prompt 的东西**，上面几条要点只是摘要。
             不显示的话「这一页为什么把提纲上那个数字丢了」在界面上完全看不出来（要点里本来
             就没有那个数字），他只会一遍遍重新生成、每次花一份额度。 -->
        <label class="field">
          <span class="label">
            这一页的提纲原文（真正逐字进 prompt 的是这一段）
            <em :class="{ over: draftOutline.trim().length > MAX_PAGE_OUTLINE }">
              {{ draftOutline.trim().length }}/{{ MAX_PAGE_OUTLINE }}
            </em>
          </span>
          <textarea
            v-model="draftOutline" rows="8" class="mono"
            placeholder="规划那一步从你的提纲里切出来的那几行。粘补充材料、改错别字、把不要的段删掉都在这里。"
          ></textarea>
        </label>
        <!-- 「这一页没有提纲原文，生成时只有那几条要点」那条黄条、和「提纲跟着这次生成一起存」
             那句话**故意删了**（他要的）。留下的两处代价，加回来之前先知道：老规划（没有这个
             字段）的那几页，上面那个框空着和「提纲真的丢了」在界面上长得一样；提纲是**点了生成
             按钮才存**的，直接关掉这个框不保存 —— 现在没有一处会说。
             `outlineIssue`（超长/切错行那种真错误）照旧留着。 -->
        <p v-if="outlineIssue" class="banner bad">{{ outlineIssue }}</p>

        <!-- 版式**挑缩略图，不挑名字**：「L5 数据网格」这几个字对他没有形状，
             挑一条装不下这一页内容的出来照样是一页完整的幻灯片（内容挤成一团），
             而他要下一次翻到这一页才知道挑错了。缩略图就是案例库里那一份效果 demo
             （同一份 template.html，所见即所得）。
             规划挑的那条和它给的备选排最前面；其余的**要点一下才加载** ——
             一次挂 22 个 iframe 会把这个框卡住，而卡住的表现只是「点了没反应」。 -->
        <div class="field">
          <span class="label">
            版式
            <em v-if="draftLayoutItem">现在是 {{ draftLayoutItem.id }} {{ draftLayoutItem.title }}</em>
          </span>
          <p v-if="!layoutList.length" class="muted">清单没读出来，这一页照旧用 {{ draftLayout }}。</p>
          <div v-else class="lay-grid">
            <!-- 停用的照旧列在「规划挑的 + 备选」里（这份规划是停用之前跑的），标一句「已停用」。
                 悄悄摘掉的话选中的那条会跳到另一条版式上，他点「生成」拿到的是一页换了版式的
                 幻灯片，而他压根没动过这里。 -->
            <button
              v-for="l in pickerItems" :key="l.id" type="button"
              class="lay" :class="{ on: l.id === draftLayout, off: l.disabled }"
              @click="draftLayout = l.id"
            >
              <span class="lay-thumb">
                <iframe :src="l.demoUrl" loading="lazy" scrolling="no" tabindex="-1" :title="`${l.id} 效果 demo`"></iframe>
              </span>
              <span class="lay-cap">
                <b>{{ l.id }}</b> {{ l.title }}
              </span>
              <span class="lay-tags">
                <em v-if="l.id === setupFor.layoutId" class="plan">规划挑的</em>
                <em v-else-if="altIds.includes(l.id)" class="alt">备选</em>
                <em v-if="l.disabled" class="dis">已停用</em>
                <em v-if="l.fullbleed">全幅</em>
                <em>{{ slotBrief(l.imageSlots) }}</em>
              </span>
            </button>
          </div>
          <p v-if="layoutList.length && !showAllLayouts && suggestedItems.length && otherItems.length" class="prep-acts">
            <button class="btn-ghost sm" type="button" @click="showAllLayouts = true">
              展开其余 {{ otherItems.length }} 条版式
            </button>
          </p>
        </div>
        <!-- 老规划里没有备选。不说的话上面那组只有一条，读起来像「模型认为只有这个版式合适」。 -->
        <p v-if="layoutList.length && !setupFor.alts?.length" class="muted">
          规划没给备选版式（重新规划一次才有），可用的一共 {{ enabledCount }} 条 。
        </p>
        <p v-if="draftLayoutItem" class="muted">
          <a :href="draftLayoutItem.demoUrl" target="_blank">单开 {{ draftLayoutItem.id }} 的 demo 看大图 ↗</a>
          · 图位 <span :title="draftLayoutItem.imageSlots">{{ slotBrief(draftLayoutItem.imageSlots) }}</span>
        </p>
        <!-- 选中的这条是停用的（这份规划比停用早）。不说的话他以为自己在案例库里关掉的那条
             还在被用，而这一页照旧按它排出来 —— 一页完整正常的幻灯片。 -->
        <p v-if="draftLayoutItem?.disabled" class="banner warn">
          {{ draftLayoutItem.id }} 在<router-link to="/ppt/layouts">版式案例库</router-link>里已经停用了（这份规划是停用之前跑的）。
          照它生成没问题，只是往后规划新稿子时不会再挑它 —— 想换掉就在上面挑一张别的缩略图。
        </p>
        <!-- 换版式会连图位一起换：备好的图是按序号贴的，图位少了那几张就没地方贴。
             这句话必须在点之前说 —— 生成完再说的话那次调用已经花了。 -->
        <p v-if="draftLayoutChanged && pending[setupFor.page]?.length" class="banner warn">
          这一页备好了 {{ pending[setupFor.page].length }} 张图，换版式之后图位的数量/比例可能不一样 ——
          多出来的那几张会没地方贴（生成完会点名说是哪几张，图还在素材库里）。
        </p>

        <!-- 图位清单是**整份规划那一次**定的，而版式是他在这里换的 —— 两者从此对不上而一处都
             不报错：这个面板照旧列着规划那几格（换到三图版式之后还是只备 1 张），生成时 prompt 里
             「正好 N 个图位」又压着案例里的图位数，出来是一页排得下但空了两格的幻灯片。
             以前这里有个「重排图位」按钮要他自己点。现在**换过版式的话，下面那个生成按钮会先
             自动重排一次**（见 `needsReplan` / `startBuild`）—— 所以那一下是两次真实调用，
             这件事只能写在按钮上（写在这里等于没说：点完才看到的话那次调用已经花了）。 -->

        <!-- 图放在这里而不是只在右栏：他在这个对话框里做的决定就是「这一页长什么样」，
             而图是先备好、生成时按序号贴进去的 —— 不在这里给入口的话，他点了生成才发现
             图位全是占位图，而那次调用已经花掉了。提示词可改：模型写的那句常常不是他要的
             （「一张相关配图」「示例产品」），改完失焦就存回规划。 -->
        <div v-if="setupFor.imageSpecs?.length" class="field">
          <span class="label">
            这一页的图（{{ setupFor.imageSpecs.length }} 张）
            <em v-if="built[setupFor.page]">换一张当场就贴进画面，不用重新生成（贴图不花钱）</em>
            <em v-else>先备好，生成这一页时自动贴进去（贴图不花钱）</em>
          </span>
          <ul class="prep-list">
            <li v-for="(s, i) in setupFor.imageSpecs" :key="i">
              <a
                v-if="preparedAt(setupFor.page, i + 1)"
                class="spec-thumb"
                :href="preparedAt(setupFor.page, i + 1)!.url"
                target="_blank"
              ><img :src="preparedAt(setupFor.page, i + 1)!.url" :alt="`第 ${i + 1} 格`" /></a>
              <span v-else class="spec-thumb empty">还没有</span>
              <div class="prep-main">
                <div class="prep-meta">
                  #{{ i + 1 }} · {{ s.ratio }} · {{ modeText(s.mode) }}
                  <!-- 素材库挑来的那张可能是别的比例/画风（贴进去会被裁、笔触不统一），
                       两种都不报错，所以这里要写出它是哪来的。 -->
                  <em v-if="preparedAt(setupFor.page, i + 1)">
                    已备 · {{ preparedAt(setupFor.page, i + 1)!.from === 'ai' ? 'AI 生成' : '素材库' }}
                    · {{ preparedAt(setupFor.page, i + 1)!.ratio }}
                    <template v-if="ratioClash(s.ratio, preparedAt(setupFor.page, i + 1)!.ratio)">（会裁掉一块）</template>
                    <template v-if="preparedAt(setupFor.page, i + 1)!.styleId && styleId
                      && preparedAt(setupFor.page, i + 1)!.styleId !== styleId">
                      · 画风 {{ preparedAt(setupFor.page, i + 1)!.styleId }}（这份稿子是 {{ styleId }}，混着用笔触不统一）
                    </template>
                  </em>
                </div>
                <textarea
                  v-model="draftSubject[`${setupFor.page}:${i + 1}`]"
                  rows="2"
                  :maxlength="MAX_SUBJECT"
                  placeholder="画什么，一句话（例：广西玉林山区云雾缭绕的壮药草坡远景，有景深）"
                  @change="saveSubject(setupFor.page, i + 1, s.subject)"
                ></textarea>
                <div class="prep-acts">
                  <button
                    class="btn-ghost sm"
                    :disabled="prepBusy[`${setupFor.page}:${i + 1}`] || batchRunning"
                    @click="prepare(setupFor.page, i + 1, 'ai', undefined, draftSubject[`${setupFor.page}:${i + 1}`])"
                  >
                    {{ prepBusy[`${setupFor.page}:${i + 1}`] ? '生成中…（几十秒）'
                      : preparedAt(setupFor.page, i + 1) ? '按这句重画（花一次额度）' : '生成这张图（花一次额度）' }}
                  </button>
                  <button
                    class="btn-ghost sm"
                    :disabled="prepBusy[`${setupFor.page}:${i + 1}`]"
                    @click="openPicker(setupFor.page, i + 1)"
                  >从素材库挑（免费）</button>
                  <button
                    v-if="preparedAt(setupFor.page, i + 1)"
                    class="btn-ghost sm"
                    :disabled="prepBusy[`${setupFor.page}:${i + 1}`]"
                    @click="prepare(setupFor.page, i + 1, 'clear')"
                  >清掉</button>
                </div>
              </div>
            </li>
          </ul>
          <p v-if="prepErr[setupFor.page]" class="banner bad">{{ prepErr[setupFor.page] }}</p>
          <div v-if="prepNote[setupFor.page]?.length" class="problems">
            <ul><li v-for="(x, i) in prepNote[setupFor.page]" :key="i">{{ x }}</li></ul>
          </div>
          <p class="muted">没备的格子会先放占位图，之后再配也行。</p>
        </div>
        <!-- 老规划没有逐张说明。不说的话这里空着，和「这一页不用图」分不开。 -->
        <p v-else-if="setupFor.images" class="muted">
          规划只说了要 {{ setupFor.images }} 张图、没说画什么（老规划）—— 这一页只能先生成再配图。
        </p>

        <!-- 整份那段也要在这里显示出来：只显示页级那段的话，「这一页什么要求都没有」和
             「这一页跟着整份那段走」在界面上分不开，他会在每页把整份那段再抄一遍。 -->
        <p v-if="deckNotes" class="muted">
          整份要求（一起带上，在「提纲与设置」里改）：<b>{{ deckNotes }}</b>
        </p>
        <label class="field">
          <span class="label">
            这一页额外要求（可留空，和整份那段冲突时按这一页的）
            <em :class="{ over: draftNotes.length > MAX_NOTES }">{{ draftNotes.length }}/{{ MAX_NOTES }}</em>
          </span>
          <textarea
            v-model="draftNotes"
            rows="3"
            :maxlength="MAX_NOTES"
            placeholder="例：标题小一点、正文行距松一些；语气克制，不要感叹号"
          ></textarea>
        </label>
        <!-- 这两句是承重的：存下来（以后重新生成也带着）、不会动整份的输出格式。 -->
        <p class="muted">会存在这一页上，以后重新生成也带着；字号/间距写成 inline style，不改整份格式。</p>

        <div class="dr-actions">
          <button class="btn-ghost" @click="setupFor = null">取消</button>
          <button
            class="btn-primary"
            :disabled="busy[setupFor.page] || batchRunning || !!outlineIssue"
            @click="startBuild"
          >
            {{ (built[setupFor.page] ? '重新生成' : '开始生成')
              + (needsReplan ? '（先重排图位）' : '') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 插一页（不调 AI、不花额度）。**这里只收提纲，版式不在这个框里挑** —— 插完立刻打开
         上面那个「生成前确认」框（那里才有 22 条缩略图，挑版式必须看形状）。在这里再放一个
         挑选器的话就有两处能挑版式，而两处的默认值不一样：他在这里挑完、那边打开又显示成
         规划那条，界面上看不出哪一处才算数。 -->
    <div v-if="insertAfter !== null" class="drawer-mask" @click.self="insertAfter = null">
      <div class="picker" style="width: min(620px, 92vw);">
        <div class="dr-head">
          <b>{{ insBlank ? (insertAfter === 0 ? '在最前面插一页空白页（成为第 1 页）' : `在第 ${insertAfter} 页后面插一页空白页（成为第 ${insertAfter + 1} 页）`)
            : insertAfter === 0 ? '插到最前面（成为第 1 页）' : `在第 ${insertAfter} 页后面插一页（成为第 ${insertAfter + 1} 页）` }}</b>
          <button class="btn-ghost sm" @click="insertAfter = null">取消</button>
        </div>
        <label class="field">
          <span class="label">
            这一页的标题
            <em :class="{ over: insTitle.length > MAX_PAGE_TITLE }">{{ insTitle.length }}/{{ MAX_PAGE_TITLE }}</em>
          </span>
          <!-- 空白页的标题**只在左边那一栏里显示**（画面上是空的）。这句话必须写出来：
               不写的话他会以为标题会印在页面上，摆完发现没有，只能重新想是哪里没生效。 -->
          <input v-model="insTitle" type="text" :maxlength="MAX_PAGE_TITLE"
            :placeholder="insBlank ? '只用来在左边那一栏里认出这一页（画面上不显示）' : '这一页的标题'" />
        </label>
        <label v-if="!insBlank" class="field">
          <span class="label">
            这一页的要点（一行一条，最多 {{ MAX_POINTS }} 条）
            <em :class="{ over: insPointLines.length > MAX_POINTS }">{{ insPointLines.length }}/{{ MAX_POINTS }} 条</em>
          </span>
          <textarea v-model="insPoints" rows="5" placeholder="一行一条，模型按这几条排版和写文案"></textarea>
        </label>
        <p v-if="insIssue" class="banner bad">{{ insIssue }}</p>
        <p v-if="insBlank" class="muted">
          插进来的是一页<b>空白画布</b>（不花额度、也不走 AI 生成）：后面几页的页码整体往后挪一位，
          它们已经生成的画面、备好的图、写过的要求都跟着自己那一页走。
          <b>这一页一开始是真的空的</b> —— 在整份里翻到它和「这一页渲染塌了」分不开，记得往上加东西。
        </p>
        <p v-else class="muted">
          插进来的是一页<b>还没生成的空页</b>（不花额度）：后面几页的页码整体往后挪一位，它们已经生成的画面、
          备好的图、写过的要求都跟着自己那一页走。版式先跟着前一页 ——
          <b>插完会直接打开「生成前确认」，在那里挑一条（和前一页一样的话连着两页会很单调）</b>。
        </p>
        <div class="dr-actions">
          <button class="btn-ghost" @click="insertAfter = null">取消</button>
          <button class="btn-primary" :disabled="structBusy || !!insIssue" @click="doInsert">
            {{ structBusy ? '插入中…' : '插进来' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI生成前编辑提示词 -->
    <div v-if="aiPromptFor" class="drawer-mask" @click.self="aiPromptFor = null">
      <div class="picker" style="width: min(600px, 92vw);">
        <div class="dr-head">
          <b>编辑第 {{ aiPromptFor.page }} 页第 {{ aiPromptFor.index }} 格的提示词</b>
          <button class="btn-ghost sm" @click="aiPromptFor = null">关掉</button>
        </div>
        <p class="muted">
          您可以调整以下提示词，点击确定后将以此开始生成。
        </p>
        <div class="field">
          <textarea
            v-model="aiPromptFor.subject"
            rows="5"
            placeholder="请在此输入画面提示词..."
          ></textarea>
        </div>
        <div class="dr-actions" style="justify-content: flex-end; margin-top: 8px;">
          <button class="btn-ghost" @click="aiPromptFor = null">取消</button>
          <button class="btn-primary" @click="confirmAiPrompt">确定生成</button>
        </div>
      </div>
    </div>

    <!-- 素材库挑图（备图用）。挑一张**不花钱**，所以这里要写出来 —— 不写的话他会以为
         这也是一次生成，宁可不用而去点「AI 生成」，那才是真的花钱。 -->
    <div v-if="pickFor" class="drawer-mask" @click.self="pickFor = null">
      <div class="picker">
        <!-- 标题 + tab 一起 sticky 在抽屉顶上：这里可能是一百多张图，翻到第 80 张想换一组
             或者退出去时，「关掉」和 tab 全在屏幕外 —— 那时唯一的出路是点遮罩（他不知道），
             看起来像卡在这个窗口里出不去了。 -->
        <div class="pick-top">
          <div class="dr-head">
            <b v-if="pickFor.canvas">往第 {{ pickFor.page }} 页的画布上放一张图（挑图不花额度）</b>
            <b v-else>给第 {{ pickFor.page }} 页第 {{ pickFor.index }} 格挑一张（挑图不花额度）</b>
            <div class="head-btns">
              <!-- 筛在某一组上时给一个明确的「回全部」：只靠 tab 的话 tab 条横向滚过去之后
                   「全部」那一个会滚出可视区，而计数行还在说「见上面的『全部』」。 -->
              <button
                v-if="assetDeck" class="btn-ghost sm" :disabled="assetsBusy" @click="pickTab('')"
              >← 回全部（{{ assetAllCount }} 张）</button>
              <!-- 上传本地图片。素材库原来只进 AI 生成的图，手上一张现成的产品照/截图
                   没有任何入口 —— 唯一的出路是去点「AI 生成」画一张「像那样」的，
                   那是一次真花钱的调用，而且出来的不是他要的那张。 -->
              <label class="btn-ghost sm up-btn" :class="{ off: uploadBusy }">
                {{ uploadBusy ? '上传中…' : '＋ 上传本地图片' }}
                <input
                  type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                  :disabled="uploadBusy" @change="uploadLocalImage"
                />
              </label>
              <button class="btn-ghost sm" @click="pickFor = null">关掉</button>
            </div>
          </div>
          <!-- 按稿子分 tab。张数是服务端按整张表算的（`groups`），不是把手上这 120 张分组数
               出来的 —— 页内统计出的「这个项目 3 张」读起来完全正常，而那个项目真正的四十张
               在第 120 张之后。切 tab 重新请求（同一个理由）。 -->
          <div v-if="assetGroups.length > 1" class="pick-tabs">
            <button
              type="button" class="ptab" :class="{ on: !assetDeck }"
              :disabled="assetsBusy" @click="pickTab('')"
            >全部 <em>{{ assetAllCount }}</em></button>
            <button
              v-for="g in assetGroups" :key="g.deckId || ASSET_NO_DECK" type="button"
              class="ptab" :class="{ on: assetDeck === (g.deckId || ASSET_NO_DECK), gone: g.deckGone }"
              :disabled="assetsBusy" @click="pickTab(g.deckId || ASSET_NO_DECK)"
              :title="g.deckGone ? '这份稿子已经删了，图还在素材库里' : g.title"
            >
              {{ g.deckId === deckId ? '本稿' : g.deckGone ? '（已删除的稿子）' : g.title || (g.deckId ? '（没名字的稿子）' : '没记归属') }}
              <em>{{ g.count }}</em>
            </button>
          </div>
        </div>

        <!-- 上传的结果留在抽屉里（不自动贴进图槽）：贴进去会立刻关掉抽屉，而「这张图只存在
             本机磁盘上」那句话就跟着消失了 —— 那种图换台机器就打不开，而页面上只是裂图。 -->
        <p v-if="uploadErr" class="banner bad">{{ uploadErr }}</p>
        <p v-if="uploadNote" class="banner">{{ uploadNote }}</p>
        <p v-if="assetsErr" class="banner bad">{{ assetsErr }}</p>
        <p v-else-if="assetsBusy" class="muted">读取中…</p>
        <p v-else-if="!assets.length && assetDeck" class="muted">
          这一组里没有图（点上面的「全部」看其余的）。
        </p>
        <p v-else-if="!assets.length" class="muted">
          素材库还是空的 —— 生成过的每张配图都会自动进这里，之后就能在别的页里重用。
        </p>
        <p v-else class="muted">
          <!-- 「这一组 N 张」和「素材库共 M 张」必须同时写出来：只写前一个的话，默认落在
               本稿这一组上的他会以为库里就这几张，转头去点「AI 生成」花钱生一张库里已有的图。 -->
          {{ assetDeck === ASSET_NO_DECK ? '没记归属的' : assetDeck ? '这一组' : '素材库共' }}
          {{ assetsTotal }} 张<span v-if="assetDeck">（素材库共 {{ assetAllCount }} 张，见上面的「全部」）</span><span v-if="assetsTotal > assets.length">，这里显示最近 {{ assets.length }} 张</span>。比例/画风和这一格不一样也能挑，
          挑完会告诉你差在哪（贴进去会被裁 / 笔触不统一）。
        </p>
        <div class="pick-grid">
          <button
            v-for="a in assets" :key="a.id" class="pick-cell" :class="{ fresh: a.id === justUploaded }"
            :title="a.prompt" @click="pickAsset(a.id)"
          >
            <img :src="a.url" :alt="a.prompt" />
            <span class="pick-meta">{{ a.ratio || '?' }} · {{ a.style_id || '?' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

interface PlannedImage { subject: string; mode: string; ratio: string }
interface PlannedPage {
  page: number; section: string; title: string; points: string[]
  layoutId: string; why: string; images: number
  /** 规划里定下的「这几张图画什么」。老 deck 的 plan_json 里没有这个字段（那时只有张数）。 */
  imageSpecs?: PlannedImage[]
  /** 规划给的 2-3 条备选版式（服务端校验过在库里）。老 deck 没有这个字段。 */
  alts?: string[]
  /** 这一页的提纲原文（代码按行号切的那几行，逐字进 prompt）。老 deck 没有这个字段 ——
   *  那种页只按上面几条要点生成，所以对话框里要说出来。 */
  outlineText?: string
  /** 这一页的原文里有几行是**代码补进来**的（规划时没有任何一页认领它们）。老 deck 没有。 */
  coverNote?: string
  layoutName: string; layoutTitle: string; fullbleed: boolean; demoUrl: string
}

/** 和服务端 planService.MAX_OUTLINE_CHARS 一致（超了服务端明确拒绝，不截断）。 */
const MAX_OUTLINE = 12000

/**
 * 花钱那几条路的错误文案。额度用光时服务端回的是平台那个形状
 * （`{error:'quota_exceeded'}`，见 server 的 `sendPptError`）：弹窗由 `lib/api.ts` 统一弹，
 * 但抛上来的 `e.message` 就是 `quota_exceeded` 这个英文记号本身。**不换成人话的话**
 * 那一栏显示的是一行 `quota_exceeded` —— 看起来像程序出错，而他真正要做的是等明天或找管理员。
 * 每条路的 `quotaNote` 各写一句：要紧的是「这次到底改没改、花没花」，六条路答案不同。
 */
function errText(e: any, fallback: string, quotaNote: string): string {
  const msg = e?.message || fallback
  return msg === 'quota_exceeded' ? quotaNote : msg
}

const outline = ref('')
/**
 * 提纲框展开着没有（规划过之后默认折起来）。
 *
 * 折的判据里那两条 `!` 是承重的：**没规划过一律展开**（那时提纲框是他唯一要填的东西，
 * 折起来的话这个抽屉里只剩品牌名和画风，看起来像功能没做完），**超字数也一律展开**
 * —— 折起来之后「规划按钮点不动」就没有任何解释，而那个 `8043 / 12000` 是唯一说出成因的地方。
 */
const outlineOpen = ref(false)
const running = ref(false)
const error = ref('')
const pages = ref<PlannedPage[]>([])
/**
 * 页序版本号（098）。库里的页数/页序每变一次它就 +1，**按页码写库的每一条请求都要带上它**
 * （生成 / 备图 / 配图 / 重排图位，以及就地编辑那七条：改字 / 改样式 / 改整块对齐 / 删这一块 /
 * ai-edit / ai-remake / 蒙版）：不带的话服务端 400，带错了 409。
 *
 * 为什么不能省：花钱那几条都要等上游几十秒，这期间页序变过的话结果会落在**现在的**那个页码上 ——
 * 出来是一页完整的幻灯片，只是照着别的一页的提纲排的，而这是一次真实花费。
 * **不花钱的那几条同样要带**：他在另一个标签页里插了/删了一页之后，这边第 12 页已经是另一份
 * 内容，改下去接口 200、这一栏写着「已存」，而改的是隔壁那一页（`eids` 交叉核对救不了 ——
 * eid 是每页从 `t1` 重编的，连着两页同版式时它是空对空）。
 */
const planRev = ref(0)
const usage = ref<{ prompt_tokens: number; completion_tokens: number; total_tokens: number } | null>(null)

interface BuiltPage { html: string; previewHtml: string; problems: string[] }
const built = ref<Record<number, BuiltPage>>({})
const busy = ref<Record<number, boolean>>({})
const pageErr = ref<Record<number, string>>({})
/**
 * 每页那层黑蒙版的透明度（097，0 = 没有蒙版）。**从服务端读、存完照返回值走** ——
 * 只在本地记的话刷新一次全部归零，而库里是他调过的值（画面上还真的是暗的）。
 */
const veil = ref<Record<number, number>>({})
const veilBusy = ref(false)
const veilErr = ref('')
const showSrc = ref<Record<number, boolean>>({})

const brandCn = ref('')
const brandEn = ref('')
/**
 * 整份统一的那段要求（093）。**每一页生成时都带上，和页级那段一起发**（不是二选一）——
 * 页级有就顶掉的话，他在某一页补一句话，整份定的语气就在那一页悄悄失效了。
 */
const deckNotes = ref('')

// ── 这份稿子（落库，migration 089）────────────────────────────
const route = useRoute()
const deckId = computed(() => String(route.params.id || ''))
const title = ref('')
const loadErr = ref('')
/** 这次进页面是自动跑的规划（不是他点的）。要在界面上说一句 —— 一次真实调用
 *  不能悄悄发生，不然他只看到「规划中…」而不知道额度是谁花的。 */
const autoPlanned = ref(false)
const savingMeta = ref(false)
const metaErr = ref('')
const metaSavedAt = ref('')
/** 上一次真的存进库里的那份值。相同就不再发请求 —— 每次失焦都发一遍的话，
 *  「已存」那句话会在什么都没改的时候不停刷新，读起来像一直在存东西。 */
let savedSnapshot = ''

function metaSnapshot() {
  return JSON.stringify([
    title.value.trim(), outline.value, brandCn.value, brandEn.value, styleId.value, deckNotes.value,
    design.value.palette, design.value.font, design.value.density, design.value.header,
  ])
}

/** 顶栏那句「存没存上」。每一页都是一次真实调用，他要能一眼确定关掉页面回来还在。 */
const saveLabel = computed(() => {
  if (metaErr.value) return '没保存上'
  if (savingMeta.value) return '保存中…'
  if (metaSavedAt.value) return `已保存 ${metaSavedAt.value}`
  // 还没存过时**什么都不说**（头部不留提示）：三个状态里只有「没保存上」是会骗人的那个，
  // 它照旧在这里出声，另外在 `banners` 里还有一条红字（`metaErr`）。
  return ''
})

/**
 * 存这份稿子的元信息（名字 / 提纲 / 品牌 / 画风）。
 *
 * 失败**必须出声**：静默失败的话他改完提纲关掉页面，下次回来是上一版，
 * 而这中间界面上什么都没说 —— 他会以为自己记错了改没改。
 */
async function saveMeta(): Promise<boolean> {
  if (!deckId.value || loadErr.value) return false
  const snap = metaSnapshot()
  if (snap === savedSnapshot) return true
  if (!title.value.trim()) {
    metaErr.value = '名字不能为空（这一次没保存）。'
    return false
  }
  savingMeta.value = true
  metaErr.value = ''
  try {
    await apiPatch(`/api/ppt/decks/${deckId.value}`, {
      title: title.value.trim(),
      outline: outline.value,
      brandCn: brandCn.value,
      brandEn: brandEn.value,
      styleId: styleId.value,
      notes: deckNotes.value,
      // 四项缺一项服务端就 400（缺的那项会悄悄回到默认那套），所以要么整段传、要么不传。
      design: design.value.palette && design.value.font && design.value.density && design.value.header
        ? { ...design.value } : undefined,
    })
    savedSnapshot = snap
    metaSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    return true
  } catch (e: any) {
    metaErr.value = `没保存上：${e?.message || '请求失败'} —— 这次改的东西还只在这个页面里，别关掉。`
    return false
  } finally {
    savingMeta.value = false
  }
}

/**
 * 先整理提纲、再分页（`POST /clean-outline`）。
 *
 * 服务端**不写回库**，只把整理后的文本回给这里 —— 于是「撤销整理」才做得到（原文还在
 * `cleanUndo` 里，库里也还是原文，直到失焦或规划时 `saveMeta()` 把新的存进去）。
 * 三件事必须出声：删掉的每一行原文（删错一行时整理后的提纲读起来完全通顺）、
 * 服务端给的每一条 `problems`、以及**「一行都没删」**（不说的话按钮点下去什么都不变，
 * 看起来像这次调用失败了，而额度已经扣掉了）。
 */
const cleanBusy = ref(false)
const cleanErr = ref('')
const cleanNote = ref('')
const cleanProblems = ref<string[]>([])
const cleanRemoved = ref<{ line: number; text: string; why: string }[]>([])
/** 整理前那份提纲原文；null = 这次打开还没整理过（撤销按钮也就不出现）。 */
const cleanUndo = ref<string | null>(null)

async function cleanOutlineNow() {
  // 和 run() 同一个理由：服务端整理的是**库里那一份**提纲。不先存的话它整理的是上一版，
  // 而回来的那份「干净提纲」会盖掉他刚敲的那几段 —— 两边都不报错。
  if (!(await saveMeta())) {
    cleanErr.value = '提纲没存上，这次没整理（整理用的是库里那一份）—— 上面那行写了没存上的原因。'
    return
  }
  cleanBusy.value = true
  cleanErr.value = ''
  cleanNote.value = ''
  cleanProblems.value = []
  cleanRemoved.value = []
  try {
    const data = await apiPost<{
      cleaned: string
      removed: { line: number; text: string; why: string }[]
      problems: string[]
      changed: boolean
      chars: { before: number; after: number }
    }>(`/api/ppt/decks/${deckId.value}/clean-outline`, {})
    cleanProblems.value = data.problems || []
    if (!data.changed) {
      cleanNote.value = '模型没找到要删的行 —— 这份提纲里没有备注/待办之类的东西，直接规划就行（这次调用的额度已经用掉了）。'
      return
    }
    cleanRemoved.value = data.removed || []
    cleanUndo.value = outline.value
    outline.value = data.cleaned
    cleanNote.value =
      `整理完了：${data.chars.before} 字 → ${data.chars.after} 字。这只是页面上的改动，失焦或点规划时才存进库 ——` +
      '删错了就点「撤销整理」，那时候库里还是原文。'
  } catch (e: any) {
    cleanErr.value = `整理失败：${e?.message || '请求失败'} —— 你的提纲一个字都没动，可以直接规划。`
  } finally {
    cleanBusy.value = false
  }
}

function undoClean() {
  if (cleanUndo.value === null) return
  outline.value = cleanUndo.value
  cleanUndo.value = null
  cleanRemoved.value = []
  cleanProblems.value = []
  cleanNote.value = '已经退回整理前那份提纲（还没失焦过的话库里本来就是它）。'
}

/**
 * 整份的设计规范（096：配色 / 字体 / 疏密 / 页眉）。
 *
 * 清单从 `GET /api/ppt/design-options` 来，**不在前端写死**（同画风那条的理由）。
 * `designProblems` 是服务端读库时发现认不出的 id 时给的那几句，**必须显示** ——
 * 不显示的话他打开一份「墨绿」的稿子看到的是橙的，而下拉里也显示成默认那档。
 */
interface DesignOpt { id: string; name: string; hint: string }
const designOpts = ref<{ palettes: DesignOpt[]; fonts: DesignOpt[]; densities: DesignOpt[]; headers: DesignOpt[] }>(
  { palettes: [], fonts: [], densities: [], headers: [] }
)
const design = ref({ palette: '', font: '', density: '', header: '' })
const designProblems = ref<string[]>([])
const designHint = (list: DesignOpt[], id: string) => list.find(x => x.id === id)?.hint || ''

/**
 * 换了规范：存库，**然后把已经生成的那几页重新读一遍**。
 *
 * 那几页的 `previewHtml` 是服务端拼的（规范那段 `<style>` 在里面），不重读的话画面上
 * 一点变化都没有 —— 而库里已经存了新规范，他会以为这个下拉是坏的，或者以为得重新生成
 * 十几页（那是十几次真实花费）。拼好的整份同样要作废：留着的话它翻起来完全正常，
 * 只是整份还是旧配色。
 */
async function applyDesign() {
  if (!(await saveMeta())) return
  invalidateDeck()
  await loadPages()
}

/**
 * 配图画风。清单从 `GET /api/ppt/styles` 来，**不在前端写死** —— md 里加了一套之后
 * 界面上完全看不见，而后端照旧认它（读起来像「就这几种」）。
 * 拿不到清单时下拉留空但不挡生图：服务端不给 styleId 会用它自己的默认那套。
 */
interface StyleItem { id: string; name: string; applicable: string }
const styleList = ref<StyleItem[]>([])
const styleId = ref('')
const styleHint = computed(() => {
  const s = styleList.value.find(x => x.id === styleId.value)
  return s ? `${s.id} ${s.name}：${s.applicable}` : '配图画风（生图那一步用）'
})

/**
 * 已经配过图的页里，有几页用的不是现在选的这套画风。
 * 换画风**不会**自动重做那几页 —— 不说的话整份翻下来笔触不统一，而每张单看都好。
 */
const styleMismatch = computed(() => {
  if (!styleId.value) return ''
  const bad = pages.value.filter(p => {
    const used = imgInfo.value[p.page]?.style?.id
    return used && used !== styleId.value
  }).map(p => p.page)
  if (!bad.length) return ''
  return `第 ${bad.join(' / ')} 页的图是用别的画风生成的（现在选的是 ${styleId.value}）。换画风不会自动重做已有的图 —— 要笔触统一就在那几页上点「换一批图」（每张都是一次真实花费）。`
})

const batchRunning = ref(false)
/**
 * 正在跑的是哪一种批量：`page` = 逐页生成，`image` = 逐页配图。两件事共用
 * `batchRunning / batchAt` 这一套状态，不分开的话进度那句话会**写错**：配图跑到第 3 页时
 * 顶栏写的是「生成中… 第 3 / 12 页」，他会以为这十几次调用花在生成上（而那几页早就生成好了）。
 */
const batchKind = ref<'' | 'page' | 'image'>('')
const batchAt = ref(0)
const batchNote = ref('')
let stopRequested = false

const deckHtml = ref('')
const deckErr = ref('')

const exporting = ref(false)
const exportErr = ref('')
const exportNote = ref('')
const exportWarnings = ref<string[]>([])

const exportingPptx = ref(false)
const pptxNote = ref('')
const pptxWarnings = ref<string[]>([])
/** 一页在服务端大约半秒（渲染 + 走 DOM + 截图），报个数是为了让人愿意等而不是连点。 */
const pptxEta = computed(() => Math.max(3, Math.round(pages.value.length * 0.6)))

interface FilledImage {
  index: number; prompt: string; mode: string; ratio: string
  url?: string; error?: string; skipped?: boolean; storage?: 'cos' | 'local'
}
interface ImagesResult {
  html: string; previewHtml: string; images: FilledImage[]
  problems: string[]; quotaExceeded: boolean
  style?: { id: string; name: string }
}
const imgBusy = ref<Record<number, boolean>>({})
const imgErr = ref<Record<number, string>>({})
const imgInfo = ref<Record<number, ImagesResult>>({})

// ── 先备图（091）────────────────────────────
// 规划里每一格图可以在生成 HTML **之前**就备好：从素材库挑（不花钱）或者 AI 现生一张。
// 备好的图存在那一页上，**还没贴进 HTML** —— 界面上必须一直说这句，不然他看到缩略图
// 就以为这一页图配好了，去拼整份才发现那几格全是占位图。
interface PreparedImage {
  index: number; url: string; prompt: string; mode: string; ratio: string
  styleId?: string; model?: string; storage?: string; from: 'ai' | 'library'; at: string
}
const pending = ref<Record<number, PreparedImage[]>>({})
/** 按 `页:格` 记 —— 按页记的话备第 2 格时第 1 格的按钮也会一起变灰，看起来像卡住了。 */
const prepBusy = ref<Record<string, boolean>>({})
const prepErr = ref<Record<number, string>>({})
const prepNote = ref<Record<number, string[]>>({})
/** 当前页每一格备的是哪张（按 index 取，不按数组下标 —— 中间清掉一格的话下标会错位）。 */
const curPrepared = computed<Record<number, PreparedImage>>(() => {
  const m: Record<number, PreparedImage> = {}
  for (const x of pending.value[current.value] || []) m[x.index] = x
  return m
})

interface AssetItem {
  id: string; url: string; prompt: string; mode: string; style_id: string
  ratio: string; model: string; storage: string; created_at: string
}
const aiPromptFor = ref<{ page: number; index: number; subject: string } | null>(null)
function openAiPrompt(page: number, index: number, subject: string) {
  aiPromptFor.value = { page, index, subject }
}
function confirmAiPrompt() {
  if (!aiPromptFor.value) return
  const { page, index, subject } = aiPromptFor.value
  aiPromptFor.value = null
  prepare(page, index, 'ai', undefined, subject)
}

interface AssetGroup { deckId: string; title: string; deckGone: boolean; count: number; lastAt: string }

/** 「没记归属」那一组在接口上的值（服务端 `ASSETS_NO_DECK`）。空串会被当成「没筛」，
 *  那个 tab 点下去回的是全部素材 —— 而 tab 是选中的，看起来像这一组有三百张。 */
const ASSET_NO_DECK = '__none__'

/** 挑图这个抽屉现在是给谁挑的：图槽（`index` ≥ 1）还是空白页的画布（`canvas`）。
 *  **两条路必须分开**：画布那条压根没有「格号」，共用一条的话抽屉标题会写「第 0 格」，
 *  而挑完那张图会走备图那条路 —— 接口说「已备好」，画布上什么都没多出来。 */
const pickFor = ref<{ page: number; index: number; canvas?: boolean } | null>(null)
const assets = ref<AssetItem[]>([])
const assetsTotal = ref(0)
const assetsErr = ref('')
const assetGroups = ref<AssetGroup[]>([])
/** 现在筛的是哪一份稿子（`''` = 全部）。**服务端筛**，不在前端过滤手上这 120 张。 */
const assetDeck = ref('')
const assetsBusy = ref(false)
/** 连点两个 tab 时只认最后那一次的返回：不认的话先发的那次后到，网格是 A 组的图而
 *  tab 高亮在 B 组上 —— 挑完备的图对不上，而两边读起来都正常。 */
let assetsSeq = 0
const assetAllCount = computed(() => assetGroups.value.reduce((n, g) => n + g.count, 0))

async function loadAssets() {
  const seq = ++assetsSeq
  assetsBusy.value = true
  assetsErr.value = ''
  try {
    const q = assetDeck.value ? `?deckId=${encodeURIComponent(assetDeck.value)}` : ''
    const data = await apiGet<{
      assets: AssetItem[]; total: number; groups: AssetGroup[]
    }>(`/api/ppt/assets${q}`)
    if (seq !== assetsSeq) return
    assets.value = data.assets || []
    assetsTotal.value = data.total || 0
    assetGroups.value = data.groups || []
  } catch (e: any) {
    if (seq !== assetsSeq) return
    // 静默的话这里是一个空网格，和「素材库本来是空的」长得一样 —— 而他会去点「AI 生成」
    // 重新花一次钱生成一张库里已经有的图。
    assetsErr.value = `素材库读不出来：${e?.message || '请求失败'} —— 先别当成「库里没有图」，那可能只是这次请求失败了。`
  } finally {
    if (seq === assetsSeq) assetsBusy.value = false
  }
}

async function openPicker(page: number, index: number, canvas = false) {
  pickFor.value = { page, index, canvas }
  // 上一次的上传提示必须清掉：那句话里写着页码和格号（「点它贴进第 3 页第 1 格」），
  // 留着的话它在另一格上照旧读起来完全正常，而他会照那句话把图贴到别的地方。
  uploadErr.value = ''
  uploadNote.value = ''
  justUploaded.value = ''
  // 默认落在本稿那一组：要重用的多半是同一个项目里的图，全库几百张时翻不到。
  assetDeck.value = deckId.value
  await loadAssets()
  // 本稿一张图都没有时退回全部 —— 停在空网格上的话，和「素材库是空的」长得一样，
  // 而他会去点「AI 生成」花一次钱生一张别的稿子里已经有的图。
  if (!assetsErr.value && !assets.value.length && assetDeck.value) {
    assetDeck.value = ''
    await loadAssets()
  }
}

/** 切 tab = 重新请求（前端过滤只过滤得到手上这 120 张，见模板里那段注释）。 */
function pickTab(id: string) {
  if (assetDeck.value === id) return
  assetDeck.value = id
  loadAssets()
}

// ── 上传本地图片进素材库 ────────────────────────────
const uploadBusy = ref(false)
const uploadErr = ref('')
const uploadNote = ref('')
/** 刚上传成功的那一张（网格里高亮它）。列表按时间倒序、它就在最前面，但一屏一百多张时
 *  「最前面那张」并不比其余的显眼 —— 找不到的话他会以为没传上去，再传一遍。 */
const justUploaded = ref('')
const MAX_UPLOAD_MB = 10

/**
 * 传一张本地图片。**上传完不自动贴进图槽**：贴进去会立刻关掉抽屉，而服务端那句
 * 「这张图只落在本机磁盘上」就跟着消失了 —— 那种图换台机器/多实例就打不开，
 * 而页面上只是一张裂图。所以这里只上传 + 高亮，贴不贴由他点。
 */
async function uploadLocalImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 同一个文件连传两次也要能触发 change（不清的话第二次一点反应都没有）。
  input.value = ''
  if (!file) return
  uploadErr.value = ''
  uploadNote.value = ''
  justUploaded.value = ''
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    uploadErr.value =
      `这张图 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${MAX_UPLOAD_MB}MB，没有上传。` +
      `先压一下再传（截图另存成 JPG 通常能小一个量级）。`
    return
  }
  uploadBusy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    // 记归属到当前这份稿子：不记的话它落进「没记归属」那一组，而挑图默认落在本稿这一组上
    // —— 刚传的图在那里看不到，读起来就是「上传没成功」。
    fd.append('deckId', deckId.value)
    // 不走 apiPost（它会 JSON.stringify）；api() 认得 FormData，让浏览器自己写 boundary。
    const res = await api('/api/ppt/assets/upload', { method: 'POST', body: fd })
    if (!res.ok) {
      // 413 是**反代**拦下来的（请求压根没到 Node，所以没有我们那句带上限数字的 JSON，
      // 落下去就是一句「HTTP 413」，读起来像接口挂了）。
      if (res.status === 413) {
        throw new Error(
          `这张图 ${(file.size / 1024 / 1024).toFixed(1)}MB，被服务器前面的反向代理挡下了（HTTP 413），` +
          `请求没有到达后端。压小再传，或让运维加大 Nginx 的 client_max_body_size。`
        )
      }
      const data = await res.json().catch(() => ({}))
      throw new Error((data as any).error || `HTTP ${res.status}`)
    }
    const data: { asset: AssetItem; ratio: string; pixels: string; note: string } = await res.json()
    justUploaded.value = data.asset.id
    const at = pickFor.value
    uploadNote.value =
      `已上传 ${file.name}（${data.pixels}，按 ${data.ratio} 记进素材库）` +
      (at ? (at.canvas
        ? `—— 点下面高亮那张就放到第 ${at.page} 页的画布上。`
        : `—— 点下面高亮那张就贴进第 ${at.page} 页第 ${at.index} 格。`) : '') +
      (data.note ? ` ${data.note}` : '')
    // 切到本稿那一组再刷新：停在别的 tab 上的话刚传的图不在网格里，看起来像没传上去。
    assetDeck.value = deckId.value
    await loadAssets()
  } catch (e: any) {
    uploadErr.value = `上传失败：${e?.message || '请求失败'}`
  }
  uploadBusy.value = false
}

function pickAsset(assetId: string) {
  const at = pickFor.value
  pickFor.value = null
  if (!at) return
  // 空白页画布那条走 canvas 接口。走错的话备图那条会回一句「已备好第 0 格」（那一格不存在），
  // 而画布上什么都没多出来。
  if (at.canvas) saveCanvas('add-image', { assetId })
  else prepare(at.page, at.index, 'library', assetId)
}

/**
 * 备一格图。`ai` 是一次真实花费，`library` 不花钱，`clear` 只是不再备着（图还在素材库里）。
 *
 * 返回的整份 `images` 数组直接覆盖本地那一页 —— 只改动过的那一格的话，服务端排序/去重之后
 * 两边的数组会漂开，而界面上每一格都显示着一张图（只是和库里存的不是同一张）。
 */
async function prepare(
  page: number,
  index: number,
  from: 'ai' | 'library' | 'clear' | 'subject',
  assetId?: string,
  subject?: string
) {
  const key = `${page}:${index}`
  prepBusy.value[key] = true
  prepErr.value[page] = ''
  try {
    const data = await apiPost<{
      page: number; images: PreparedImage[]; problems: string[]; imageSpecs?: PlannedImage[]
      pasted?: { html: string; previewHtml: string; images: FilledImage[]; styleId: string }
    }>(
      `/api/ppt/decks/${deckId.value}/prepare-images`,
      { page, index, from, assetId, subject, planRev: planRev.value }
    )
    // 服务端回的规格覆盖内存里那份：改过的提示词只留在输入框里的话，关掉再开是模型
    // 原来那句，而库里已经是新的 —— 两处不一样，界面上一处都不说。
    if (data.imageSpecs) {
      const row = pages.value.find(p => p.page === page)
      if (row) row.imageSpecs = data.imageSpecs
    }
    pending.value[page] = data.images || []
    prepNote.value[page] = data.problems || []
    // 已经生成过 HTML 的那一页：服务端**当场把图贴进那份 html 了**（纯代码替换、不花钱），
    // 所以这里必须用它回的那一版覆盖画面 —— 不覆盖的话屏幕上还是旧图而库里已经换了，
    // 他会照着屏幕再点一次「重新生成这一页」（那才是一次真实调用）。
    if (data.pasted && built.value[page]) {
      built.value[page] = {
        ...built.value[page],
        html: data.pasted.html,
        previewHtml: data.pasted.previewHtml,
      }
      imgInfo.value[page] = {
        ...(imgInfo.value[page] || { problems: [], quotaExceeded: false }),
        html: data.pasted.html,
        previewHtml: data.pasted.previewHtml,
        images: data.pasted.images,
        style: data.pasted.styleId
          ? { id: data.pasted.styleId, name: styleList.value.find(s => s.id === data.pasted!.styleId)?.name || '' }
          : imgInfo.value[page]?.style,
      } as ImagesResult
      // 拼好的整份作废：留着的话它翻起来完全正常，只是这一页还是换图之前那张。
      invalidateDeck()
    }
  } catch (e: any) {
    prepErr.value[page] = errText(e, '备图失败', '今天的 AI 额度用完了，这一格没备上。')
  }
  prepBusy.value[key] = false
}

/**
 * 按现在挑的这条版式 + 这一页的真实内容重排图位清单（一次真实调用，**不生图**）。
 * 没有按钮了：换过版式时由 `startBuild` 在生成前自动跑一次（见那边）。
 *
 * 四件事在这里：**整份规划里那条 `imageSpecs` 要就地换掉**（不换的话面板上还是旧那几格，
 * 而库里已经是新的 —— 他在旧格子上备的图下一次生成时贴不进去）；**输入框里那几句也要跟着换**
 * （留着旧的那份的话，随便一次失焦就把旧提示词写回库了，而两处都读起来正常）；
 * **服务端顺手把这次挑的版式/要求存了**（同「开始生成」那条路），所以本地那两个标记要跟上，
 * 不然关掉对话框之后这一页的标签写的还是旧版式；**`specsLayout` 要记下这份清单是按哪条版式
 * 排的** —— 不记的话下一次点生成还会再重排一次（结果一模一样，只是又扣一次额度）。
 *
 * 参数是显式传进来的（不读 `setupFor`）：调用它的时候对话框已经关了。
 */
const replanBusy = ref<Record<number, boolean>>({})
async function replanImages(p: PlannedPage, layoutId: string, notes: string) {
  replanBusy.value[p.page] = true
  prepErr.value[p.page] = ''
  const before = p.imageSpecs?.length || 0
  try {
    const data = await apiPost<{
      page: number; layoutId: string; imageSpecs: PlannedImage[]; problems: string[]
    }>(`/api/ppt/decks/${deckId.value}/replan-images`, {
      page: p.page,
      layoutId,
      notes,
      planRev: planRev.value,
    })
    const row = pages.value.find(x => x.page === data.page)
    if (row) {
      row.imageSpecs = data.imageSpecs || []
      row.images = row.imageSpecs.length
      setupLayout.value[data.page] = data.layoutId === row.layoutId ? '' : data.layoutId
    }
    specsLayout.value[data.page] = data.layoutId
    ;(data.imageSpecs || []).forEach((s, i) => { draftSubject.value[subjectKey(data.page, i + 1)] = s.subject })
    setupNotes.value[data.page] = notes
    prepNote.value[data.page] = data.problems || []
  } catch (e: any) {
    // 重排失败**不挡生成**（见 `startBuild`），所以这句话要把降级说完：成因 + 这一页接下来
    // 是按哪份清单排的。只说「重排图位失败」的话，紧接着那一页照旧生成出来、读起来完全正常，
    // 而备图面板上还是旧那几格 —— 他对不回是这一步没成。
    prepErr.value[p.page] = `${errText(e, '重排图位失败', '今天的 AI 额度用完了，图位没重排。')}` +
      ` 这一页接着按旧的那份清单（${before} 格）生成了：新版式的图位数/比例可能对不上，` +
      '备图面板上列的也还是旧那几格。想重排就再点一次生成（会先重试这一步）。'
  }
  replanBusy.value[p.page] = false
}

/** 这一页有几个图槽位（生图那一步认的就是 data-img-prompt）。 */
function slotCount(page: number): number {
  return (built.value[page]?.html.match(/data-img-prompt="/g) || []).length
}
/** 已经不是占位图的那几格。 */
function filledCount(page: number): number {
  const html = built.value[page]?.html || ''
  return (html.match(/data-img-prompt="/g) || []).length - (html.match(/\/ppt-cases\/ph-/g) || []).length
}
const imgTodo = computed(() =>
  pages.value.reduce((n, p) => n + (built.value[p.page] ? slotCount(p.page) - filledCount(p.page) : 0), 0)
)

// 批量生成期间不许重新规划：换一份规划之后已生成的页会被清掉，而那一刻还有一页正在跑，
// 它回来时会挂到新规划的同一个页码下面 —— 版式和内容都不是那一页的，两边都不报错。
const canRun = computed(() =>
  !running.value && !batchRunning.value && !!outline.value.trim() && outline.value.length <= MAX_OUTLINE
)
const usedLayouts = computed(() => new Set(pages.value.map(p => p.layoutId)).size)
const builtCount = computed(() => pages.value.filter(p => built.value[p.page]).length)

// 空白页只认 `layoutId`（和后端 `isBlankPage` 同一个判据，大小写归一后再比）。
// 不能改判「有没有 demoUrl」：普通页在旧的 plan_json 里也可能没有那个字段，
// 那时候整份都被当成空白页 —— 生成按钮集体消失，而界面上只是「怎么点不了了」。
function isBlank(p?: { layoutId?: string } | null): boolean {
  return String(p?.layoutId || '').trim().toUpperCase() === 'BLANK'
}
const pendingCount = computed(() => pages.value.length - builtCount.value)

// ── 左边那条缩略图分屏 ────────────────────────────
//
// 一屏挂 15 个，不是全挂。每个缩略图是一个 `srcdoc` iframe，而 srcdoc 是**一份完整的
// 预览文档**（`assemblePreview` 套的是整份 template.html，实测 75KB/页）—— 浏览器要为每个
// 缩略图建一个 document、解析一遍那份 CSS、跑一遍它自己的 `fit()`。
//
// 实测（`server/scripts/bench-ppt.mts`，Chromium 限速 4 倍 ≈ 一台低配笔记本；
// load 总时长每次跑有波动，主线程阻塞那一列是稳定的）：
//   15 个 → 全部 load ~2 秒，主线程被长任务堵住 0.7 秒（最长一个 440ms），JS 堆 12.7MB
//   41 个 → ~7 秒，堵 2.5 秒，堆 33MB，浏览器里 86 个 document
//   60 个 → ~7 秒，堵 3.0 秒（最长一个 650ms），堆 47MB，124 个 document
// 单个长任务到 650ms 就是他说的「点了没反应」（那段时间里点击排在队列里不动），而屏幕上
// 只是缩略图在陆续出现，没有一处会说是这一栏在占着主线程。
// `loading="lazy"` 救不了：那只对有 `src` 的 iframe 生效，生成过的页走的是 srcdoc。
//
// 这里只挡**渲染**：`built / pending / veil / pageErr` 那十几个按页码索引的 map 照旧是全份的，
// 批量生成、拼整份、导出都不看这个窗口 —— 把它们也切窗口的话会变成「只生成看得见的那 15 页」，
// 而拼出来的整份翻起来完全正常，只是少了后面 26 页的内容。
const RAIL_SIZE = 15
const railIndex = ref(0)
const railCount = computed(() => Math.max(1, Math.ceil(pages.value.length / RAIL_SIZE)))
const railWindows = computed(() =>
  Array.from({ length: railCount.value }, (_, i) => {
    const slice = pages.value.slice(i * RAIL_SIZE, i * RAIL_SIZE + RAIL_SIZE)
    return {
      from: slice[0]?.page ?? 0,
      to: slice[slice.length - 1]?.page ?? 0,
      // 出错的页在别的屏上时要在屏号上标出来（见模板里那段注释）。
      bad: slice.some(p => pageErr.value[p.page] || imgErr.value[p.page] || prepErr.value[p.page]),
    }
  })
)
const railSlice = computed(() => pages.value.slice(railIndex.value * RAIL_SIZE, railIndex.value * RAIL_SIZE + RAIL_SIZE))

/** 第 N 页在第几屏（页码不一定从 1 连续数 —— 按位置找，别拿页码除）。 */
function railOf(page: number): number {
  const i = pages.value.findIndex(p => p.page === page)
  return i < 0 ? railIndex.value : Math.floor(i / RAIL_SIZE)
}

// ── 工作台（左缩略图菜单 + 右当前页）────────────────────────────
/** 右边这块在放什么：某一页，还是拼好的整份。 */
const view = ref<'page' | 'deck'>('page')
/** 选中的页码。0 = 还没有页可选。 */
const current = ref(0)
const cur = computed(() => pages.value.find(p => p.page === current.value) || null)
const showSettings = ref(false)

/**
 * 顶栏那**一个**主按钮：从状态里算出「下一步」是哪一件（写提纲 → 规划 → 生成 → 配图 → 导出）。
 * 原来五个按钮一样重、其中四个是灰的，每次进来他都得自己判断该点哪个。
 *
 * 三条不能省的边界：
 * ① 标签里的**数字要留着**（剩几页 / 差几张图）—— 那些每一下都是真实花费，写成「继续」的话
 *    他点下去才知道这一按要花十几次调用。
 * ② 跑批期间照旧显示进度和页码，并且**要分清是生成还是配图**（`batchKind`）—— 合成一句
 *    「处理中」的话，卡在第 3 页时他不知道花掉的是生成还是生图的额度。
 * ③ 被顶下去的「配全部图 / 导出」照旧留在旁边（次要样式）。藏起来的话「这一版没有导出这回事」
 *    和「现在还不能导出」在屏幕上是同一个样子，而这个模块的终点就是那个文件。
 * 重新规划不进这里（它会删掉已生成的那几页 = 已经花过的钱），照旧留在抽屉里那个按钮上。
 */
const nextAct = computed<{ key: string; label: string; busy: boolean; act: () => void }>(() => {
  if (running.value) return { key: 'busy', label: '规划中…（10–40 秒）', busy: true, act: () => {} }
  if (batchRunning.value) {
    return batchKind.value === 'image'
      ? { key: 'busy', label: `配图中… 第 ${batchAt.value} 页`, busy: true, act: () => {} }
      : { key: 'busy', label: `生成中… 第 ${batchAt.value} / ${pages.value.length} 页`, busy: true, act: () => {} }
  }
  if (!outline.value.trim())
    return { key: 'outline', label: '先写提纲', busy: false, act: () => { showSettings.value = true; outlineOpen.value = true } }
  // 提纲超字数时不能让它显示「规划这份稿子」：点下去是服务端一句 400（那一刻看起来像网络问题），
  // 而真正要做的事是自己删减（不会自动截断）。
  if (outline.value.length > MAX_OUTLINE)
    return {
      key: 'outline',
      label: `提纲超了 ${outline.value.length - MAX_OUTLINE} 字，先删减`,
      busy: false,
      act: () => { showSettings.value = true; outlineOpen.value = true },
    }
  if (!pages.value.length) return { key: 'plan', label: '规划这份稿子', busy: false, act: run }
  if (pendingCount.value)
    return {
      key: 'pages',
      label: `生成${builtCount.value ? '剩下的 ' : '全部 '}${pendingCount.value} 页`,
      busy: false,
      act: runAll,
    }
  if (imgTodo.value) return { key: 'images', label: `配全部图（差 ${imgTodo.value} 张）`, busy: false, act: fillAllImages }
  return { key: 'export', label: exporting.value ? '导出中…' : '导出 .html', busy: exporting.value, act: exportDeck }
})

function selectPage(page: number) {
  view.value = 'page'
  current.value = page
  // 选中的那一块跟着页码作废：留着的话翻到下一页时那个 eid 在这一页上是另一块字，
  // 浮动条会自己吸到一块他没选的字上面。
  selEid = ''
  selEids = []
  // 路径同理（下标在另一页上指的是另一块内容 —— 那时候浮动条会框住一块他没选的东西）。
  selPath = null
  aiSel.value = null
  aiErr.value = ''
  aiNote.value = ''
  editNote.value = ''
}

/** 整份放映。拼装不花 AI 额度，所以够页数时直接拼一次，不用他再点。 */
async function openDeck() {
  view.value = 'deck'
  if (!deckHtml.value && pages.value.length && builtCount.value >= pages.value.length) await makeDeck()
}

/** 规划回来/读到库里那份之后，把选中页落在第一页上（没有选中页时右边是一块空白）。 */
function selectFirst() {
  if (!pages.value.length) { current.value = 0; return }
  if (!pages.value.some(p => p.page === current.value)) current.value = pages.value[0].page
}

/** ← → 翻页（像真 PPT 软件）。在输入框里打字时不接管 —— 接管的话他在提纲里按左右键会跳页。 */
function onKey(e: KeyboardEvent) {
  if (view.value !== 'page' || showSettings.value) return
  const t = e.target as HTMLElement | null
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  if (e.key === 'Escape' && insOpen.value) { insOpen.value = false; return }
  const i = pages.value.findIndex(p => p.page === current.value)
  if (i < 0) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    if (i + 1 < pages.value.length) { current.value = pages.value[i + 1].page; e.preventDefault() }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    if (i > 0) { current.value = pages.value[i - 1].page; e.preventDefault() }
  }
}
// deck 外壳上那个大标题（topic）现在由服务端按这份稿子的名字写（`shellMeta`）：
// 前端再算一份的话，改了名字之后预览里的页脚和拼出来的整份是两个标题，两边都不报错。

// ── 生成前改一下（092：换版式 + 一段额外要求）────────────────────
/** 他挑的版式（空/没有 = 照规划那条）。存在服务端，刷新回来还在。 */
const setupLayout = ref<Record<number, string>>({})
/** 他手写的额外要求（字体/排版/语气）。 */
const setupNotes = ref<Record<number, string>>({})
/**
 * 这一页**现在这份 html 是用哪条版式排的**。和 `setupLayout` 分开存是承重的：
 * 换了版式还没重新生成时，画面里是旧版式排的那一版 —— 两版都是一页正常的幻灯片，
 * 不显眼说出来的话他会以为新版式就长这样。
 */
const builtLayout = ref<Record<number, string>>({})
const MAX_NOTES = 500

interface LayoutItem {
  id: string; name: string; title: string; applicable: string
  imageSlots: string; fullbleed: boolean; demoUrl: string
  /** 在案例库里停用了（`/ppt/layouts` 上那个开关）。这里也不给挑 —— 见下拉上的注释。 */
  disabled?: boolean
}
const layoutList = ref<LayoutItem[]>([])
const layoutsErr = ref('')

/** 生成前那个对话框：null = 没开。 */
const setupFor = ref<PlannedPage | null>(null)
const draftLayout = ref('')
const draftNotes = ref('')
/** 「其余 N 条」展开了没有（每次打开对话框收回去）。 */
const showAllLayouts = ref(false)

/**
 * 这一页的提纲（可改）。**只在点「生成」时随那次调用一起存**（服务端 `readPageOutline`）——
 * 另开一个「保存提纲」按钮的话会多出一种状态：库里提纲是新的、画面是旧提纲生成的那一版，
 * 两边各自都读得通，看不出哪个是最新的。
 */
const draftTitle = ref('')
/** 要点按行编辑（一行一条）。空行丢掉，服务端也丢 —— 两边规则不一样的话条数对不上。 */
const draftPoints = ref('')
/**
 * 这一页的**提纲原文**（`plan_json.outlineText`，规划那一步按行号切出来的那几行）。
 * 上面那几条要点是摘要，**真正逐字进 prompt 的是这一段** —— 所以这里必须显示出来：
 * 不显示的话「这一页为什么把提纲上那个数字丢了」在界面上完全看不出来（要点里本来就没有
 * 那个数字），他只会一遍遍重新生成。
 */
const draftOutline = ref('')
/** 四个上限和服务端 `deckStore` 里那四个常量一致：两边不一样时他在这里写得下，
 *  一点生成就被 400，而看不出是哪一边的限制。 */
const MAX_PAGE_TITLE = 60
const MAX_POINTS = 12
const MAX_POINT = 200
const MAX_PAGE_OUTLINE = 4000

const draftPointLines = computed(() =>
  draftPoints.value.split('\n').map(s => s.trim()).filter(Boolean)
)

const outlineFolded = computed(
  () => !outlineOpen.value && pages.value.length > 0 && outline.value.length <= MAX_OUTLINE
)

/**
 * 提纲不合规就**在点生成之前**说出来（服务端同样会 400，但那时他已经等了一次往返）。
 * 「一条要点都没有」是这里最值钱的一条：只给标题的话模型会自己编这一页的内容 ——
 * 出来是一页排版完整、读着通顺、而内容不是他的东西的幻灯片，一处都不报错。
 */
const outlineIssue = computed(() => {
  if (!setupFor.value) return ''
  if (!draftTitle.value.trim()) return '标题是空的 —— 生成出来会是一页没有标题的幻灯片，看起来像版式本来就这样。'
  const lines = draftPointLines.value
  if (!lines.length) return '一条要点都没有 —— 只给标题的话模型会自己编这一页的内容，出来那一页读着通顺但不是你的东西。'
  if (lines.length > MAX_POINTS) return `要点 ${lines.length} 条，最多 ${MAX_POINTS} 条（多的排不下，会被裁掉且不报错）。拆成两页更好排。`
  const i = lines.findIndex(s => s.length > MAX_POINT)
  if (i >= 0) return `第 ${i + 1} 条要点有 ${lines[i].length} 字，上限 ${MAX_POINT} 字 —— 一条要点是一行字，太长会被版式裁掉。`
  const n = draftOutline.value.trim().length
  if (n > MAX_PAGE_OUTLINE) return `提纲原文有 ${n} 字，上限 ${MAX_PAGE_OUTLINE} 字（超了服务端会拒，不会截断）。这么多内容一页装不下，拆成两页。`
  return ''
})

/**
 * 每一格图的提示词（可改）。**失焦就存回规划**（`prepare(..., 'subject')`）：只留在输入框里的话，
 * 他改完直接点「AI 生成」以外的任何地方，下一次生图用的还是模型原来那句 —— 生出来是一张
 * 正常的图，只是不是他要的那张。key 是 `页:格`。
 */
const draftSubject = ref<Record<string, string>>({})
const MAX_SUBJECT = 300

function subjectKey(page: number, index: number) { return `${page}:${index}` }

/** 这一格备的是哪张（按 index 找，不按数组下标 —— 中间清掉一格的话下标会错位）。 */
function preparedAt(page: number, index: number): PreparedImage | undefined {
  return (pending.value[page] || []).find(x => Number(x.index) === index)
}

/**
 * 备的那张和这一格比例对不上（贴进去被 `cover` 裁掉一块）。
 * 两边的写法不统一（规划那边是 `3:4`，素材库那条存的是 `3:4 portrait`），所以只比
 * `a:b` 那一段 —— 直接比字符串的话每一张都算「对不上」，那句提示就永远挂着。
 */
function ratioClash(slot?: string, got?: string): boolean {
  const k = (s?: string) => (s || '').match(/\d+:\d+/)?.[0] || ''
  return !!k(slot) && !!k(got) && k(slot) !== k(got)
}

/** concept/case/data 三路画法各自对应画风里的一套模板，填错了数据页会拿到概念插画。 */
function modeText(mode: string): string {
  return mode === 'concept' ? '概念插画' : mode === 'case' ? '实景/产品' : mode === 'data' ? '数据图' : mode
}

/** 版式那段图位说明是**库里的原文**（不在前端拆开），太长时只显示开头，全文放 title。 */
function slotBrief(s: string): string {
  const t = (s || '（没有图）').trim()
  return t.length > 36 ? `${t.slice(0, 36)}…` : t
}

/** 失焦保存。没改过就不发请求（每次失焦都写一遍库的话，列表的 updated_at 会一直跳）。 */
function saveSubject(page: number, index: number, original: string) {
  const v = (draftSubject.value[subjectKey(page, index)] || '').trim()
  if (!v || v === original) return
  prepare(page, index, 'subject', undefined, v)
}

async function openSetup(p: PlannedPage) {
  setupFor.value = p
  insertedHint.value = null // 只有 doInsert 打开的那一次会紧接着重新写上（见那边）
  showAllLayouts.value = false
  draftLayout.value = setupLayout.value[p.page] || p.layoutId
  draftNotes.value = setupNotes.value[p.page] || ''
  // 每次打开都从库里那份规划重读（留着上一次的输入的话，他上次改完关掉不存的那版会在
  // 这里当成「已经存下来的提纲」显示，而库里还是模型原来那句）。
  draftTitle.value = p.title || ''
  draftPoints.value = (p.points || []).join('\n')
  draftOutline.value = p.outlineText || ''
  ;(p.imageSpecs || []).forEach((s, i) => { draftSubject.value[subjectKey(p.page, i + 1)] = s.subject })
  if (layoutList.value.length) return
  try {
    layoutsErr.value = ''
    const { layouts } = await apiGet<{ layouts: LayoutItem[] }>('/api/ppt/layouts')
    layoutList.value = layouts || []
  } catch (e: any) {
    // 静默的话下拉里只有当前那一条，读起来像「这一页只能用这个版式」。
    layoutsErr.value = `版式清单没读出来（${e?.message || '请求失败'}），只能先按规划那条生成 —— 换版式请刷新后再试。`
  }
}

const draftLayoutItem = computed(() => layoutList.value.find(l => l.id === draftLayout.value) || null)

/**
 * 下拉里排最前面那组：规划挑的那条 + 规划给的备选。
 * 全部 22 条平铺的话「换一个也合适的版式」等于从 22 条里自己认，他要么不换、要么挑一条
 * 装不下这一页内容的（生成出来照样是一页完整的幻灯片，只是内容挤成一团）。
 */
const suggestedItems = computed(() => {
  const p = setupFor.value
  if (!p) return []
  return [p.layoutId, ...(p.alts || [])]
    .map(id => layoutList.value.find(l => l.id === id))
    .filter((l): l is LayoutItem => !!l)
})
const otherItems = computed(() => {
  const ids = suggestedItems.value.map(l => l.id)
  return layoutList.value.filter(l => !ids.includes(l.id) && !l.disabled)
})
const enabledCount = computed(() => layoutList.value.filter(l => !l.disabled).length)
const altIds = computed(() => setupFor.value?.alts || [])
/**
 * 缩略图列表。其余那十几条**要点一下才进来**：一次挂 22 个 iframe（每个都是一整份
 * demo deck 的文档请求）会把这个框卡住几秒，而卡住的表现只是「点了没反应」——
 * 和「这个按钮坏了」分不开。每次打开对话框都收回去（见 openSetup）。
 */
const pickerItems = computed(() => {
  // 一条建议都认不出来（清单是旧的、规划那条编号不在里面）时直接摊开全部：
  // 收着的话这一格是空的，读起来像「这一页没法换版式了」。
  if (!suggestedItems.value.length) return otherItems.value
  return showAllLayouts.value ? [...suggestedItems.value, ...otherItems.value] : suggestedItems.value
})

/** 「你换过版式，但画面/demo 还是另一条」——两版都是一页正常的幻灯片，所以必须写出来。 */
const layoutMismatch = computed(() => {
  const p = cur.value
  if (!p) return ''
  const want = setupLayout.value[p.page]
  if (!want) return ''
  const now = builtLayout.value[p.page]
  if (!now) return `这一页你换成了 ${want}（还没生成）。下面那张是规划里 ${p.layoutId} 的效果 demo，不是 ${want} 的。`
  return now === want
    ? ''
    : `这一页你换成了 ${want}，但画面里这一版还是 ${now} 排的 —— 点「重新生成…」才会按 ${want} 重排（一次真实调用）。`
})
/**
 * 画面里这一版排出来的图位数 ≠ 规划里那份清单的格数。
 *
 * 这一条**必须显眼说**：备图 / 素材库挑 / 换图 全都按规划那份清单画（服务端也按
 * `specs.length` 卡格子号），所以规划是 0 格时那一整块干脆不出现 —— 而画面上明明有 4 张
 * 占位图，界面另一处还写着「配全部图（差 4 张）」。他只会以为备图坏了，或者去点那条真花钱的路。
 * 现在重新生成会自动对齐（`specsFromSlots`），这句话就是告诉他去点哪里。
 */
const specMismatch = computed(() => {
  const p = cur.value
  if (!p || !built.value[p.page]) return ''
  const slots = slotCount(p.page)
  const planned = p.imageSpecs?.length || 0
  if (slots === planned) return ''
  return `画面里这一版有 ${slots} 个图位，而规划里是 ${planned} 格 —— 备图、换图、素材库都认规划那份清单，` +
    `所以${slots > planned ? `多出来的那几格现在没有入口` : `多的那几格贴不进画面`}。` +
    '点「重新生成…」会按画面上的图位自动对齐（不用额外花钱，就是这一页那一次调用）。'
})
/**
 * 画面里有占位图，但它不挂在任何一个图槽上（元素上没有 `data-img-prompt`）。
 *
 * 这一条**必须说**：整条配图链认的都是 `data-img-prompt`（`findImageSlots`），所以那一处
 * 在备图面板上不出现、「配全部图」不算它、生图也跳过它 —— 画面上它就是一张图（或者一块
 * 灰底），永远停在占位图上，而没有一处会说。踩过的那次是自由改造加了一张**背景图**
 * （`background-image:url(占位图)`）：校验那时只查 `<img>`，于是它整个漏了过去。
 *
 * 数法：占位图的处数 - 图槽数。图槽的那张图可能已经是真图（不占一处占位图），所以这个差
 * 只在「有占位图没人认」时才为正 —— 服务端现在会拒掉这种输出，这条是给库里已经存着的那几页看的。
 */
const orphanPlaceholder = computed(() => {
  const p = cur.value
  const html = p ? built.value[p.page]?.html || '' : ''
  if (!html) return ''
  const n = (html.match(/\/ppt-cases\/ph-/g) || []).length - slotCount(p!.page)
  if (n <= 0) return ''
  return `画面里有 ${n} 处占位图没挂在图槽上（元素上少了 data-img-prompt）—— 备图、换图、配全部图都扫不到它，` +
    '那一处会一直停在占位图上，而它看起来就是一张图。用「自由改造」说一句「给那张背景图补上 data-img-prompt，' +
    '写清要什么图」，或者重新生成这一页。'
})
/** 换版式会连图位一起换：备好的图是按序号贴的，图位少了那几张就没地方贴（服务端会点名）。 */
const draftLayoutChanged = computed(() => !!setupFor.value && draftLayout.value !== setupFor.value.layoutId)
/**
 * 这一页现在那份 `imageSpecs` 是按**哪条版式**排的：规划那条（没重排也没生成过时就是它）、
 * 上一次重排那条、或者上一次生成完服务端按真实图槽对齐用的那条（`build` 里一起记）。
 */
const specsLayout = ref<Record<number, string>>({})
/**
 * 点生成之前要不要先自动重排一次图位（**一次额外的真实调用**）。
 * 比的是上面那个「清单按哪条版式排的」，不是 `draftLayoutChanged`（那个比的是规划那条）——
 * 用后者的话，换过版式之后**每一次**重新生成都会再重排一遍，两次结果一模一样，只是每次多扣
 * 一次额度，而界面上看不出多花了这一次。
 */
const needsReplan = computed(() => !!setupFor.value &&
  draftLayout.value !== (specsLayout.value[setupFor.value.page] || setupFor.value.layoutId))

// ── 这一页的详情（浮在画面右侧，可收起）──────────────────────────
// 默认收起（画面因此能撑到最大），但收起来之后生图失败的那几格「还是占位图」就看不见了，
// 而画面上那一页读起来完全正常。所以两处补偿是承重的：
// **把手上带「N 处要注意」的数字**（去掉的话收起状态和「这一页干干净净」分不开），
// 以及**这一页的问题数一变多就自动弹开** —— 刚跑完的生成/配图那几条必须撞到眼前，
// 不然他会拿着一份还带占位图的稿子去拼整份/导出，而那两步都不会拦。
// 注意这个数字里**已经不算 `built[n].problems`** 了（那一块不显示了，见模板那边的注释）：
// 算进去的话把手上写着「1 处」而点开右栏什么都没有。
const insOpen = ref(false)
const curIssues = computed(() => {
  const p = cur.value
  if (!p) return 0
  const n = p.page
  return (pageErr.value[n] ? 1 : 0) + (imgErr.value[n] ? 1 : 0) + (prepErr.value[n] ? 1 : 0) +
    (layoutMismatch.value ? 1 : 0) + (specMismatch.value ? 1 : 0) + (orphanPlaceholder.value ? 1 : 0) +
    (imgInfo.value[n]?.problems.length || 0) +
    (prepNote.value[n]?.length || 0) +
    // 代码往这一页补进来的提纲段（规划时没人认领它）：并进来的位置不一定对，
    // 而收起详情之后这一页读起来完全正常 —— 不算进这个数字的话他永远不会点开去核。
    (p.coverNote ? 1 : 0) +
    // 还是占位图的那几格：预览里它就是「这一版设计得比较空」
    (built.value[n] ? Math.max(0, slotCount(n) - filledCount(n)) : 0)
})
// 左边那条缩略图窗口要跟着**当前页**和**批量生成正在跑的那一页**走。不跟的话：右边在改
// 第 27 页而左边挂着第 1–15 页那一屏（他会以为这一页从列表里消失了），批量生成跑到窗口外
// 之后左边十几个缩略图一动不动 —— 而顶栏那句「生成中… 第 27 页」照常在走，看起来像卡死。
watch([current, batchAt], ([p, at]) => {
  const page = batchRunning.value && at ? at : p
  if (page) railIndex.value = railOf(page)
})
// 页数变了（重新规划 / 删页 / 插页）要夹回去：删掉最后几页时窗口下标会落在范围外，
// 而那时左边是**空的一栏** —— 和「这份稿子没有页」长得一模一样。
watch(() => pages.value.length, () => {
  if (railIndex.value > railCount.value - 1) railIndex.value = railCount.value - 1
  if (railIndex.value < 0) railIndex.value = 0
})

// 只在**同一页**的问题数变多时弹开：翻页也弹的话他每按一次方向键都要再收一次。
let issueMark = { page: 0, n: 0 }
watch([current, curIssues], ([p, n]) => {
  if (p === issueMark.page && n > issueMark.n) insOpen.value = true
  issueMark = { page: p, n }
})

async function startBuild() {
  const p = setupFor.value
  if (!p) return
  // 提纲不合规就不发（服务端也会拒，但那时对话框已经关了，那句话会落在这一页的错误里，
  // 而他要改的输入框已经不在眼前了）。
  if (outlineIssue.value) return
  // 对话框马上就关，而下面要 await —— 这几个值必须**先取出来**：await 之后 `setupFor`
  // 已经是 null（或者他又打开的另一页那份），那时再读 `draftLayout` 就是拿别的一页的输入去生成。
  const setup = {
    layoutId: draftLayout.value,
    notes: draftNotes.value.trim(),
    // 提纲随这次调用一起发（服务端先写回 plan_json 再按新的那份生成）。
    title: draftTitle.value.trim(),
    points: draftPointLines.value,
    // 原文**每次都发**（他没动过也发同一段回去）：只在「改过」时发的话，一次「只改了标题」
    // 的生成会走进服务端「没传 outlineText」那条分支 —— 那一次是对的（用库里那份），但
    // 这里少一个字段就等于把「他刚清空了原文」和「他没动原文」变成同一个请求。
    outlineText: draftOutline.value.trim(),
  }
  const replan = needsReplan.value
  setupFor.value = null
  // 上一版的配图记录先清掉：留着的话生成期间界面上写着「3/3 张有图」，而新 html 里
  // 图槽位已经换回占位图（build 回来之后再按服务端那份重新填）。
  imgInfo.value[p.page] = undefined as any
  imgErr.value[p.page] = ''
  // 换过版式的话先重排图位（以前是对话框里一个按钮，他不点就等于不重排 —— 而不重排排出来
  // 是「一页排得下但空了两格」，一处都不报错）。两件事是承重的：
  // ① 这一段先把 `busy` 立起来 —— 重排要十几秒，`build` 还没进去，所有按「生成中」变灰/盖
  //    遮罩的地方都还是可点的空档，他会再点一次（那是又两次真实调用）；
  // ② 重排失败**不挡生成**：挡的话额度用完/上游抽风那天这一页连旧清单那一版都出不来。
  //    降级那句话在 `prepErr` 里说了成因和「接着按旧清单生成了」，它算进 `curIssues`，
  //    右边那栏会自己弹开。
  if (replan) {
    busy.value[p.page] = true
    await replanImages(p, setup.layoutId, setup.notes)
  }
  await build(p, setup)
}

type BuildOutcome = 'ok' | 'fail' | 'quota'

/**
 * 某一页改过之后，拼好的整份和「已导出」那句话都要作废。
 * 留着的话整份预览翻起来完全正常（只是那一页是改之前的版本），而那句「已导出 xxx.html」
 * 会让人以为手上那个文件是最新的 —— 两样都不报错。
 */
function invalidateDeck() {
  if (deckHtml.value) { deckHtml.value = ''; deckErr.value = '' }
  if (exportNote.value) { exportNote.value = '这一页改过了，刚才导出的那个文件已经不是最新的 —— 要发出去请重新导出一次。'; exportWarnings.value = [] }
  // pptx 那条同理（而且它那句话里写着「可编辑 N 块」，看起来更像一份已经交付好的东西）。
  if (pptxNote.value) { pptxNote.value = '这一页改过了，刚才导出的那份 pptx 已经不是最新的 —— 要发出去请重新导一次。'; pptxWarnings.value = [] }
}

// ── 就地改文字（不调 AI、不花额度）────────────────────────────
// 每段文字上的 `data-eid` 是生成那一步由服务端写进 html 的。前端**只回「哪一块 + 改前那句
// + 改后那句」**，改 html 全在服务端做：把整份 html 序列化回传的话，一次 DOMParser 往返
// 就可能把引号/自闭合标签/实体全换一遍，而页面照样渲染 —— 那种改动看不出来。

/**
 * 塞进预览 iframe 的那段编辑脚本（**只塞进这一个正在编辑的单页预览**）。左边缩略图、
 * 整份预览、导出的文件都不带它 —— 带进导出文件的话，别人打开那份稿子也能编辑，
 * 而改动只留在他自己的浏览器里，看起来像存下来了。
 */
const EDITOR_JS = `
<style>
  [data-eid]{cursor:text}
  [data-eid]:hover{outline:1px dashed rgba(0,0,0,.35);outline-offset:2px}
  [data-editing]{outline:2px solid #4a90d9!important;outline-offset:2px;background:rgba(74,144,217,.10)}
  /* 骨架自带的那个「编辑模式」气泡（按 E 那套）不要冒出来：它 fixed 在画面底部，盖住的是
     这一页自己的内容，而且说的是另一套操作（按 E 退出）—— 我们的说明在 iframe 外面那一行。 */
  #edit-tip{display:none!important}
  [data-sel]{outline:2px solid #4a90d9!important;outline-offset:2px}
  /* 浮动条挂在 body 上（#stage 才是被 scale() 缩过的那一层）—— 挂进舞台里的话它会跟着
     缩放一起变小，窗口小一点就成了几个点不中的小方块。 */
  #ppt-bar{position:fixed;z-index:99999;display:none;align-items:center;gap:6px;padding:6px 8px;
    border-radius:10px;background:#1b1e24;box-shadow:0 8px 24px rgba(0,0,0,.35);
    font-family:system-ui,sans-serif;font-size:12px;line-height:1}
  #ppt-bar button{background:transparent;border:0;color:#fff;cursor:pointer;padding:4px 7px;border-radius:6px;font:inherit}
  #ppt-bar button:hover{background:rgba(255,255,255,.18)}
  #ppt-bar .sw{width:18px;height:18px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.55)}
  #ppt-bar .sep{width:1px;height:16px;background:rgba(255,255,255,.28)}
  #ppt-bar .lab{color:rgba(255,255,255,.72);padding:0 2px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* 选中的是一整块（没有 data-eid）时，改颜色/字号那几个键要藏起来：容器不在
     applyStyleEdit 认的范围里，留着的话点下去只会得到一句「找不到这一块」。 */
  #ppt-bar[data-mode="region"] .txt{display:none}
  /* 反过来：整块对齐那三个键**只在「选中的这一块自己是 flex/grid」时出现**。别的布局上
     align-items 浏览器压根不认 —— 露着的话他点下去接口 200、库里也真写着，画面一动不动。 */
  #ppt-bar .reg{display:none}
  #ppt-bar[data-mode="region"][data-flex="1"] .reg{display:block}
  /* 🗑 两种模式下都在（一段字和一整块都能删）。含图的那一块调淡 —— 点下去只会换回一句
     「这一块里有图」，先把这件事写在按钮上省他一次来回。 */
  #ppt-bar .del{color:#ff9c9c}
  #ppt-bar[data-imgs="1"] .del{opacity:.4}
  /* 鼠标停在哪一块上就描出那一块的边：不描的话点空处「吸附」到的是哪一层完全看不出来，
     他只能靠点下去之后那句读数去猜。 */
  [data-hov]{outline:1px dotted rgba(74,144,217,.75);outline-offset:2px}
  [data-region]{outline:2px solid #f0a020!important;outline-offset:3px;background:rgba(240,160,32,.07)}
  /* 空白页画布上的块：整块可拖，右下角那个蓝方块是缩放手柄。**手柄画在块里面**
     （::after，不是块外面）：画外面的话它会伸进旁边那一块的地盘，按下去按到的是那一块 ——
     他以为自己在缩放这一块，动的是另一块。悬停/选中才显形，否则导出前的预览上一堆蓝点，
     看起来像页面上真有这些方块。 */
  .bl-el{cursor:move}
  .bl-el::after{content:'';position:absolute;right:0;bottom:0;width:36px;height:36px;
    background:#4a90d9;border:3px solid #fff;border-radius:6px;opacity:0;cursor:nwse-resize}
  .bl-el:hover::after,.bl-el[data-sel]::after{opacity:.95}
  /* 拖的时候别让浏览器顺手选中文字：不挡的话整块蓝底一片，看起来像出错了（而且松手时
     那次 selection 会把 contentEditable 的插入点带走）。 */
  body.bl-drag,body.bl-drag *{user-select:none!important}
</style>
<script>
(function(){
  function post(m){ try{ parent.postMessage(m,'*') }catch(e){} }
  // 整段包在 try 里，出错要**喊出来**：这段脚本一挂，双击改字、浮动条、区域选中全都不存在了,
  // 而 hover 那圈虚线是 CSS 画的、照旧亮 —— 屏幕上于是「一切正常，只是双击没反应」。
  try{
  // ── 浮动条：选中一块字，改颜色 / 字号 / 字重 ──────────────────
  // 色板由服务端下发，前端不自己写一份：写一份的话它和 pageEdit 的白名单一漂开，
  // 他点的那个颜色会被接口 400 拒掉。
  // 下面这两个占位串由 editSrcdoc 替换掉。**注释里不要再出现它们**（替换是全局的，
  // 但那次就是因为注释里也写了一遍、只换了第一处，整段脚本 ReferenceError）。
  var PALETTE = __PALETTE__
  var SEL = __SEL__
  var SELPATH = __SELPATH__
  var bar = null, selEl = null, hovEl = null

  /** 这一块是不是「一句字」（有 data-eid）。整块（容器）只能选、不能改样式。 */
  function isLeaf(el){ return !!(el && el.getAttribute && el.getAttribute('data-eid')) }

  /**
   * 鼠标停在这个元素上时，「一整块」指的是哪个。
   * 只认这一页里面的（closest('.slide')）—— 不限的话会选到骨架的页码/进度条/页脚上，
   * 那些不是这一页的内容，选中它之后再让 AI 改会把整份外壳一起重写。
   */
  function blockOf(t){
    if(!t || !t.closest || t.nodeType !== 1) return null
    if(bar && bar.contains(t)) return null
    if(!t.closest('.slide')) return null
    return t
  }

  /**
   * 这一块在这一页里的位置：从 section 数下来「第几个孩子」的下标路径（空数组 = 整页）。
   * AI 编辑就是照这条路径在服务端把那一段切出来 —— **不靠 eid 求公共祖先**：他框住的那块里
   * 可能有几个没文字的元素（图、装饰条），按 eid 算出来的是里面更小的一层，于是他框的是整块、
   * AI 改的是里面那一层，而摘要和画面都读得通。
   */
  function pathOf(el){
    var p = [], cur = el
    while(cur && !cur.classList.contains('slide')){
      var par = cur.parentElement
      if(!par) return null
      p.unshift([].indexOf.call(par.children, cur))
      cur = par
    }
    return cur ? p : null
  }

  /** 这一块里有什么（给外面那行读数用；也是下一步 AI 编辑要改的范围）。 */
  function info(el){
    var eids = [].map.call(el.querySelectorAll('[data-eid]'), function(x){ return x.getAttribute('data-eid') })
    if(isLeaf(el)) eids.unshift(el.getAttribute('data-eid'))
    return {
      cls: (el.getAttribute('class') || '').trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      eids: eids,
      imgs: el.querySelectorAll('img').length,
      whole: el.classList.contains('slide'),
    }
  }

  function mount(){
    bar = document.createElement('div'); bar.id = 'ppt-bar'
    for(var i=0;i<PALETTE.length;i++){
      var b = document.createElement('button')
      b.className = 'sw txt'; b.type = 'button'
      b.setAttribute('data-act','color'); b.setAttribute('data-v', PALETTE[i])
      b.title = '字色 ' + PALETTE[i]
      b.style.background = PALETTE[i]
      bar.appendChild(b)
    }
    var sep = document.createElement('span'); sep.className = 'sep txt'; bar.appendChild(sep)
    var defs = [
      ['size','down','A-','小一号','txt'],
      ['size','up','A+','大一号','txt'],
      ['weight','','B','加粗 / 取消加粗','txt'],
      ['align','left','⇤','左对齐','txt'],
      ['align','center','⇔','居中','txt'],
      ['align','right','⇥','右对齐','txt'],
      // 整块的 align-items。图标和标题在 select() 里按 flex-direction 重写 —— 写死「顶部/底部」
      // 的话 column 方向上那两个键实际改的是左右，他照着图标点，画面往另一个轴动。
      ['ralign','start','⤒','靠起始边','reg'],
      ['ralign','center','⇕','居中','reg'],
      ['ralign','end','⤓','靠结束边','reg'],
      // 取消 = **把那一条 inline 声明删掉**（回到这一页版式自己的对齐），不是写 align-items:unset
      // —— 那个是盖住版式那条、按成「拉满」，屏幕上不是「取消了」而是第三种样子。
      ['ralign','off','⦸','取消这一块的对齐（回到版式自己的样子）','reg off'],
      // 删掉这一整块（一段字也算一块）。含图的删不了：图的序号按 html 出现顺序算，
      // 少一格之后下一次配图会把第 2 张贴进第 1 格 —— 图文不符而页面渲染完全正常。
      ['del','','🗑','删掉这一块（含图的删不了）','del'],
    ]
    for(var j=0;j<defs.length;j++){
      var t = document.createElement('button'); t.type = 'button'
      t.className = defs[j][4]
      t.setAttribute('data-act', defs[j][0]); t.setAttribute('data-v', defs[j][1])
      t.textContent = defs[j][2]; t.title = defs[j][3]
      if(defs[j][0] === 'weight') t.style.fontWeight = '800'
      bar.appendChild(t)
    }
    var lab = document.createElement('span'); lab.className = 'lab'; bar.appendChild(lab)
    document.body.appendChild(bar)
  }

  function place(){
    if(!selEl || !bar) return
    var r = selEl.getBoundingClientRect()
    bar.style.display = 'flex'
    var bw = bar.offsetWidth, bh = bar.offsetHeight
    var left = Math.min(Math.max(4, r.left + r.width/2 - bw/2), Math.max(4, innerWidth - bw - 4))
    var top = r.top - bh - 8
    if(top < 4) top = Math.min(r.bottom + 8, innerHeight - bh - 4)
    bar.style.left = left + 'px'; bar.style.top = top + 'px'
  }

  function select(el){
    if(!bar) mount()
    if(selEl){ selEl.removeAttribute('data-sel'); selEl.removeAttribute('data-region') }
    selEl = el
    var leaf = isLeaf(el)
    el.setAttribute(leaf ? 'data-sel' : 'data-region', '1')
    if(hovEl){ hovEl.removeAttribute('data-hov'); hovEl = null }
    bar.setAttribute('data-mode', leaf ? 'text' : 'region')
    var d = info(el)
    var cs = getComputedStyle(el)
    var size = Math.round(parseFloat(cs.fontSize) || 0)
    // 这一块自己是不是 flex/grid（决定整块对齐那三个键出不出现）。
    var dsp = cs.display || ''
    var flex = !leaf && (dsp.indexOf('flex') >= 0 || dsp.indexOf('grid') >= 0)
    bar.setAttribute('data-flex', flex ? '1' : '0')
    // 这一块里有没有图（🗑 调淡用）。自己就是 <img> 的也算 —— 只数 querySelectorAll 的话
    // 选中一张图时那个键是亮的，点下去才换回一句「这一块里有图」。
    bar.setAttribute('data-imgs', (d.imgs + (el.tagName === 'IMG' ? 1 : 0)) ? '1' : '0')
    // align-items 管的是**交叉轴**：row / grid 时是上下，column 时是左右。图标按这个改，
    // 不改的话他看着「⤒ 顶部」点下去，内容往左边靠了 —— 一次看起来完全正常的改错方向。
    var vert = flex && (cs.flexDirection || '').indexOf('column') < 0
    var faces = vert ? ['⤒','⇕','⤓'] : ['⇤','⇔','⇥']
    var names = vert ? ['靠上','垂直居中','靠下'] : ['靠左','水平居中','靠右']
    // 只重写那三个方向键（.off 那个「取消」不参与换轴 —— 一起换的话它会拿到 undefined，
    // 按钮上显示的是 "undefined"）。
    var regs = bar.querySelectorAll('.reg:not(.off)')
    for(var k=0;k<regs.length;k++){ regs[k].textContent = faces[k]; regs[k].title = '这一整块的内容' + names[k] + '（align-items）' }
    // 「取消」只在这一条真的写在 inline 上时才有意义（不在的话它来自这一页的 <style>，删不掉）。
    var off = bar.querySelector('.reg.off')
    if(off) off.style.opacity = (el.style && el.style.alignItems) ? '1' : '.4'
    bar.querySelector('.lab').textContent = leaf
      ? size + 'px'
      : (d.whole ? '整页' : d.cls) + ' · ' + d.eids.length + ' 段字' + (d.imgs ? ' / ' + d.imgs + ' 图' : '')
    place()
    post({type:'ppt-sel', eid: leaf ? el.getAttribute('data-eid') : '',
      size: size, weight: parseInt(cs.fontWeight,10) || 400, region: d, path: pathOf(el),
      flex: flex, vert: vert, display: dsp, alignItems: flex ? cs.alignItems : ''})
  }

  function hide(){
    if(selEl){ selEl.removeAttribute('data-sel'); selEl.removeAttribute('data-region') }
    selEl = null
    if(bar) bar.style.display = 'none'
    post({type:'ppt-sel', eid:''})
  }

  function apply(act, v){
    if(!selEl) return
    // 整块的对齐（align-items）。**在下面那条「容器不能改样式」之前**：走到那里就被挡掉了，
    // 现象是这三个键点了没反应。
    if(act === 'ralign'){
      var cs1 = getComputedStyle(selEl)
      var d1 = cs1.display || ''
      if(d1.indexOf('flex') < 0 && d1.indexOf('grid') < 0){ post({type:'ppt-region-nope', why:'flex', display:d1}); return }
      var pp = pathOf(selEl)
      // 路径拿不到 = 这一块不在这一页的 section 里（骨架的页码/页脚那些）。发出去只会换回
      // 一句「和库里对不上」—— 指错方向。
      if(!pp){ post({type:'ppt-region-nope', why:'path'}); return }
      // off 发 null = 服务端把这一条 inline 声明删掉。发字符串 unset 的话是**盖住**版式
      // 那条、按成拉满 —— 他点的是「取消」，得到的是第三种样子，而页面照样渲染。
      var av = v === 'off' ? null : v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : 'center'
      post({type:'ppt-region-style', path: pp, eids: info(selEl).eids, style:{alignItems: av}})
      return
    }
    // 删掉这一整块。**也要排在下面那条「容器不能改样式」之前**（同 ralign）：排后面的话
    // 选中一整块时点 🗑 会被那条挡掉，现象是这个键点了没反应。
    if(act === 'del'){
      // 空白页画布上的块走另一条路（服务端的 canvas 接口）。**必须排在下面那两条拒绝之前**：
      // applyDelete 一是「这一块里有图就拒」（画布上摆的图从此删不掉），二是「删完一个
      // data-eid 都不剩就拒」，而它给出的理由是「重新生成一次这一页才能改文字」——
      // 对着一页空白画布那句话完全指错方向（空白页压根没有生成这一步）。
      var cel = selEl.closest ? selEl.closest('.bl-el') : null
      if(cel && cel.getAttribute('data-bel')){
        post({type:'ppt-canvas-del', bel: cel.getAttribute('data-bel'),
          texts: (cel.textContent || '').replace(/\\s+/g,' ').trim().slice(0,40),
          imgs: cel.querySelectorAll('img').length})
        return
      }
      var i2 = info(selEl)
      var nimg = i2.imgs + (selEl.tagName === 'IMG' ? 1 : 0)
      // 三种都要出声：静默 return 的话和「按钮坏了」在屏幕上一模一样。
      if(nimg){ post({type:'ppt-del-nope', why:'img', n:nimg}); return }
      if(i2.whole){ post({type:'ppt-del-nope', why:'whole'}); return }
      var pd = pathOf(selEl)
      if(!pd){ post({type:'ppt-del-nope', why:'path'}); return }
      post({type:'ppt-del', path: pd, eids: i2.eids, cls: i2.cls, tag: i2.tag,
        texts: (selEl.textContent || '').replace(/\\s+/g,' ').trim().slice(0,60)})
      return
    }
    // 选中的是一整块时那几个键本来就藏着（CSS），这里再挡一次：容器没有 eid，发出去只会
    // 换回一句「找不到这一块」，而他看到的是「点了没反应」。
    if(!isLeaf(selEl)){ post({type:'ppt-sel-region-style'}); return }
    var eid = selEl.getAttribute('data-eid')
    var cs = getComputedStyle(selEl)
    if(act === 'color'){ post({type:'ppt-style', eid:eid, style:{color:v}}); return }
    if(act === 'size'){
      // 字号按**浏览器算出来的那个 px** 加减（1920×1080 的固定坐标系，骨架本身写的就是 px）。
      // 发 em/百分比的话它是相对父级的，父级本来就大一号时「点大一点」会渲染得更小。
      var now = Math.round(parseFloat(cs.fontSize) || 16)
      var next = v === 'up' ? Math.max(now + 1, Math.round(now * 1.12)) : Math.min(now - 1, Math.round(now * 0.9))
      post({type:'ppt-style', eid:eid, style:{fontSize: next}}); return
    }
    if(act === 'weight'){
      var w = parseInt(cs.fontWeight, 10) || 400
      post({type:'ppt-style', eid:eid, style:{fontWeight: w >= 600 ? 400 : 700}})
      return
    }
    if(act === 'align'){
      // 这一块的宽度就是文字本身的宽度时（flex/grid 里的项目常常这样），左中右三个键**一个都不会
      // 有变化** —— 那时候要动的是外面那一层的对齐。跟着这次改动一起把话带回去（区域对齐还没做），
      // 不说的话他会以为对齐这几个键坏了，而接口回的是 200。
      var box = selEl.getBoundingClientRect()
      var rg = document.createRange(); rg.selectNodeContents(selEl)
      var noRoom = box.width - rg.getBoundingClientRect().width < 2
      // 这一块本身是 flex/grid 的时候 text-align 浏览器**根本不认**（它管的是里面的行内内容，
      // 而 flex 项目不受它摆布）—— 发过去接口 200、库里写着 text-align:center，画面一动不动。
      // 所以按算出来的 display 挑属性。
      var dsp = cs.display || ''
      var st = (dsp.indexOf('flex') >= 0 || dsp.indexOf('grid') >= 0)
        ? {justifyContent: v === 'left' ? 'flex-start' : v === 'right' ? 'flex-end' : 'center'}
        : {textAlign: v}
      post({type:'ppt-style', eid:eid, style:st, noRoom:noRoom})
      return
    }
  }

  // ── 空白页画布：拖着挪位置 / 拉右下角改大小 ──────────────────
  /**
   * #stage 是被 scale() 缩过的那一层，鼠标位移**必须除掉那个倍数**再写进坐标：不除的话
   * 窗口小一点时拖 100px 会写进去 250px —— 那一块窜到鼠标前面老远，看起来像「拖动很飘」，
   * 而每一次都存得好好的。
   */
  function stageScale(){
    var st = document.getElementById('stage')
    var r = st && st.getBoundingClientRect()
    return (r && r.width) ? r.width / 1920 : 1
  }
  /** 手柄边长（和 CSS 里那个 36px 是同一个数：两处漂开的话，看得见的方块和按得着的范围
   *  错开一圈 —— 他按在方块上却拖动了整块，或者按在空处却开始缩放）。 */
  var HANDLE = 36
  /** 这一块现在的坐标。**先读 inline style**（服务端写的就是它），拿不到才退回 offset*：
   *  offsetWidth 是**取整之后**的渲染值，拿它当起点的话每拖一次都会掉 0.x px，拖十次
   *  这一块自己缩小了一圈，而每一次都「已存」。 */
  function pxOf(el, k, dflt){ var v = parseFloat(el.style[k]); return isFinite(v) ? v : dflt }
  document.addEventListener('mousedown', function(e){
    if(e.button !== 0) return
    if(bar && e.target && bar.contains(e.target)) return
    var el = e.target && e.target.closest ? e.target.closest('.bl-el') : null
    if(!el || el.isContentEditable) return
    var bel = el.getAttribute('data-bel')
    // 没有 data-bel = 这一块不是从画布接口加进来的（手工改过 html）。静默拖的话画面上它跟着
    // 鼠标走，松手一句「已存」，而库里没有这一块 —— 刷新之后它回到原位。
    if(!bel){ post({type:'ppt-canvas-nobel'}); return }
    var s = stageScale()
    var r = el.getBoundingClientRect()
    var resize = e.clientX >= r.right - HANDLE * s && e.clientY >= r.bottom - HANDLE * s
    var x0 = e.clientX, y0 = e.clientY, moved = false
    var b0 = {
      left: pxOf(el,'left', el.offsetLeft), top: pxOf(el,'top', el.offsetTop),
      width: pxOf(el,'width', el.offsetWidth), height: pxOf(el,'height', el.offsetHeight),
    }
    // 骨架在 window 上挂着「点画面一下翻下一页」，而浏览器默认会把这次拖动当成选文字/拖图。
    // 两个都要挡：不挡的话拖一下同时翻页，或者拖出来一张半透明的图片影子。
    e.preventDefault(); e.stopPropagation()
    document.body.classList.add('bl-drag')
    function onMove(ev){
      if(!moved && Math.abs(ev.clientX-x0) + Math.abs(ev.clientY-y0) <= 3) return
      moved = true
      var dx = (ev.clientX - x0) / s, dy = (ev.clientY - y0) / s
      if(resize){
        // 这里也夹一次下限（服务端夹的是权威的那一份）：不夹的话拖过头会出现负宽度，
        // 那一块当场消失，而松手之后服务端把它夹回 40px —— 中间那一下看起来像「删掉了」。
        el.style.width = Math.max(40, Math.round(b0.width + dx)) + 'px'
        el.style.height = Math.max(40, Math.round(b0.height + dy)) + 'px'
      }else{
        el.style.left = Math.round(b0.left + dx) + 'px'
        el.style.top = Math.round(b0.top + dy) + 'px'
      }
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      document.body.classList.remove('bl-drag')
      // 没挪动 = 他只是点了一下：什么都不发（选中交给 click 那个处理器）。发的话每次单击
      // 选中都会走一趟接口，而 html 一个字都没变。
      if(!moved) return
      post({type:'ppt-canvas-box', bel: bel,
        left: pxOf(el,'left',0), top: pxOf(el,'top',0),
        width: pxOf(el,'width',0), height: pxOf(el,'height',0)})
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }, true)

  // 捕获阶段接，且**接住的那些点击不再往上传**：骨架自己在 window 上挂着「点画面一下翻下一页」，
  // 不挡的话选一块字这个动作同时会翻页（单页预览里是「点了没反应」，整份里是跳走）。
  document.addEventListener('click', function(e){
    var t = e.target
    if(bar && t && bar.contains(t)){
      e.preventDefault(); e.stopPropagation()
      var act = t.getAttribute && t.getAttribute('data-act')
      if(act) apply(act, t.getAttribute('data-v') || '')
      return
    }
    var el = t && t.closest ? t.closest('[data-eid]') : null
    if(el && el.isContentEditable) return
    // 点在两段字之间的空处 = 选中那一整块（「吸附」到结构块上）。不这么做的话点空处只会
    // 把选中取消掉，而他以为自己点的是那一块。
    if(!el) el = blockOf(t)
    if(el){ e.stopPropagation(); select(el) }
    else if(selEl) hide()
  }, true)
  // hover 描边：停在哪一块上就描出那一块。选中的那一块不再描（两圈线叠在一起看不出哪是哪）。
  document.addEventListener('mouseover', function(e){
    var el = blockOf(e.target)
    if(el === hovEl) return
    if(hovEl) hovEl.removeAttribute('data-hov')
    hovEl = el && el !== selEl && !isLeaf(el) ? el : null
    if(hovEl) hovEl.setAttribute('data-hov','1')
  })
  addEventListener('resize', place)
  // 存完之后这份预览是重挂的（srcdoc 换了）—— 不把选中的那一块选回来的话，「再大一号」
  // 每次都得重新点一下那块字，看起来像浮动条只生效一次。
  // 选中的是一整块时靠下标路径选回来（容器没有 eid）：不选回来的话改一次对齐选中框就没了，
  // 「⤒ 再点一下」得重新往外选好几层 —— 看起来像那三个键只生效一次。
  if(SEL || SELPATH) setTimeout(function(){
    if(SEL){
      var e0 = document.querySelector('[data-eid="' + SEL + '"]')
      if(e0){ select(e0); return }
    }
    if(SELPATH){
      var n = document.querySelector('.slide')
      for(var i=0;i<SELPATH.length && n;i++) n = n.children[SELPATH[i]]
      if(n) select(n)
    }
  }, 120)

  document.addEventListener('dblclick', function(e){
    hide()
    var el = e.target && e.target.closest ? e.target.closest('[data-eid]') : null
    // 双击了改不动的地方要出声：静默的话「这一块不能就地改」和「双击没反应/页面卡住」
    // 在屏幕上是同一个样子。
    if(!el){ post({type:'ppt-edit-noeid'}); return }
    if(el.isContentEditable) return
    el.setAttribute('data-old', el.textContent)
    el.setAttribute('data-editing','1')
    // 骨架自己那套键盘/点击翻页要挡掉，靠的是它自己留的这个开关（body.editing）。
    // 不加的话：空格键被它 preventDefault 掉 —— **打空格打不出空格**，而屏幕上一点提示都没有；
    // 方向键会翻页；单击画面还会 go(cur+1)。
    document.body.classList.add('editing')
    el.contentEditable = 'plaintext-only'
    if(el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'
    el.focus()
    var r = document.createRange(); r.selectNodeContents(el)
    var s = getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  document.addEventListener('keydown', function(e){
    var el = document.activeElement
    if(!el || !el.isContentEditable){ if(e.key === 'Escape' && selEl) hide(); return }
    if(e.key === 'Enter'){ e.preventDefault(); el.blur() }
    else if(e.key === 'Escape'){ e.preventDefault(); el.textContent = el.getAttribute('data-old') || ''; el.blur() }
  })
  // blur 不冒泡，只能捕获阶段接
  document.addEventListener('blur', function(e){
    var el = e.target
    if(!el || !el.getAttribute || !el.isContentEditable) return
    el.contentEditable = 'false'
    el.removeAttribute('data-editing')
    document.body.classList.remove('editing')
    var old = el.getAttribute('data-old') || ''
    var next = el.textContent || ''
    if(next.trim() === old.trim()) return
    post({type:'ppt-edit', eid: el.getAttribute('data-eid'), oldText: old, newText: next})
  }, true)
  }catch(err){ post({type:'ppt-editor-dead', msg: String((err && err.message) || err)}) }
})()
<\/script>
`

/** 这一页正在编辑的那份预览（带编辑脚本）。库里那份 previewHtml 一个字不改。 */
const editSrcdoc = computed(() => {
  const b = cur.value ? built.value[cur.value.page] : null
  if (!b?.previewHtml) return ''
  // **`replaceAll`，不是 `replace`**：只换第一处的话，脚本上方注释里再提一次这个占位串
  // 就会把真正那一行留成 `var PALETTE = __PALETTE__` —— 整段脚本 ReferenceError，
  // 双击改字/浮动条/区域选中全部不存在，而 hover 那圈虚线是 CSS 画的、照旧亮着，
  // 屏幕上看起来只是「双击没反应」。（这个坑真踩过一次。）
  const js = EDITOR_JS
    .replaceAll('__PALETTE__', JSON.stringify(palette.value))
    .replaceAll('__SEL__', JSON.stringify(selEid))
    .replaceAll('__SELPATH__', JSON.stringify(selPath))
  return b.previewHtml.includes('</body>')
    ? b.previewHtml.replace('</body>', `${js}</body>`)
    : b.previewHtml + js
})

/**
 * 这一页能不能就地改文字。**旧的那几页（这个功能之前生成的）html 里压根没有 `data-eid`** ——
 * 不区分的话双击它们只会得到「这一块是混排的」，而其实是整页都还没编号，他会一块一块试。
 */
const canEditText = computed(() => !!cur.value && (built.value[cur.value.page]?.html || '').includes('data-eid'))

/**
 * 画面底下那一条（就地编辑说明 + AI 改这一块）**暂时藏起来**（他要的：那两段说明和输入框
 * 占掉画面下面一大片）。改回 `true` 就整条回来 —— 用开关不删代码，是因为「AI 微调 / 自由改造」
 * 这两个入口只在那一栏里，删掉之后接口还在、界面上却再也点不到。
 *
 * **藏起来之后存失败那几句话跟着一起没了**，而那正是这一页唯一会骗人的地方：双击改一句字、
 * 浮动条改颜色、拖一块、删一块**照旧能点**（它们在画面上，不在这一条里），接口失败时 iframe
 * 会退回库里那一版 —— 画面上就是「他改的那一下没生效」，看起来像点空了，他会再改一遍。
 * 所以下面那条浮在画面底部的 `.edit-flash` 只在**失败**时出现，且 `position:absolute`
 * （不占高度：这一条一长高，`.screen` 那块 16:9 就缩一圈，双击的第二下会落到别的元素上）。
 */
const SHOW_EDIT_DOCK = false

const editErr = ref<Record<number, string>>({})
const editNote = ref('')
const editBusy = ref(false)

/** 浮动条上那几个色块。**服务端下发**（`applyStyleEdit` 的白名单就是它）：这边自己写一份的话
 *  两份一漂开，他点的那个颜色会被接口 400 拒。 */
const palette = ref<string[]>([])
const paletteErr = ref('')
/**
 * 现在选中的是哪一块（存完之后要把它选回来）。**故意不是 ref**：`editSrcdoc` 里读它，
 * 做成 ref 的话每选一块字整个 iframe 都会重挂一次（画面闪一下、选中框跟着丢），
 * 而屏幕上看起来像浮动条自己弹掉了。
 */
let selEid = ''
/** 选中的那一块里有哪几段字（选中一整块时就是这一串）—— 「AI 编辑」要改的范围。 */
let selEids: string[] = []
/** 选中一整块时它的下标路径（改完对齐要把这一块选回来 —— 容器没有 eid，只能按路径找）。
 *  和 `selEid` 一样**故意不是 ref**：它进 srcdoc。 */
let selPath: number[] | null = null
/** 现在这一块能不能交给 AI 改（选中了、而且路径算得出来）。这一条要**响应式**：那一栏的
 *  显示/隐藏靠它，而 `selEid` 故意不是 ref（它进 srcdoc，见上面）。 */
const aiSel = ref<{ path: number[]; eids: string[]; label: string } | null>(null)
const aiWish = ref('')
const aiBusy = ref(false)
const aiNote = ref('')
const aiErr = ref('')
/** 自由改造那次「改了什么」逐条（丢掉的原文 / AI 新写的文案 / 新增的图槽）。**必须显示** ——
 *  只显示那句摘要的话，这几条改动在画面上读起来完全正常（少一句话、多一句他没写的话）。 */
const aiNotes = ref<string[]>([])
const MAX_WISH = 400
/** 自由改造那句要求的上限（服务端 `MAX_REMAKE_INSTRUCTION` 是同一个数）。 */
const MAX_REMAKE_WISH = 1000
/** 存失败时靠它强制重挂 iframe：画面上留着他刚打的那句、而库里是旧的 —— 两处不一样，
 *  而屏幕看起来完全正常（他会以为存上了，直接去导出）。 */
const previewKey = ref(0)

function onFrameMsg(e: MessageEvent) {
  const d = e.data
  if (!d || typeof d !== 'object') return
  if (d.type === 'ppt-edit-noeid') {
    editNote.value = canEditText.value
      ? '这一块是和别的元素混排的（比如标题里带一个不同颜色的词），就地改不了 —— 要改它得走「重新生成」。'
      : '这一页是加这个功能之前生成的，整页都还没有编辑标记 —— 重新生成一次这一页（一次真实调用）就能双击改文字了。'
    return
  }
  // 预览里那段编辑脚本挂了。**必须显示出来**：它一挂，双击改字、浮动条、区域选中全都不存在，
  // 而 hover 那圈虚线是 CSS 画的、照旧亮着 —— 屏幕上看起来只是「双击没反应」，他会以为是自己
  // 双击得不够快，反复试。
  if (d.type === 'ppt-editor-dead') {
    const p = cur.value
    if (p) editErr.value[p.page] = `这一页预览里的编辑脚本没跑起来（${String(d.msg || '未知错误')}）—— 双击改文字、浮动条、AI 编辑现在都不生效（画面本身是好的，导出不受影响）。`
    return
  }
  if (d.type === 'ppt-sel') {
    selEid = String(d.eid || '')
    const r = d.region as { cls?: string; eids?: string[]; imgs?: number; whole?: boolean } | undefined
    selEids = Array.isArray(r?.eids) ? r!.eids!.map(String) : []
    // AI 编辑那一栏靠这个显示/隐藏。**路径拿不到就不让点**（`pathOf` 返回 null = 这一块
    // 不在这一页的 section 里，发出去只会换回一句「和库里对不上」）。
    aiSel.value = r && Array.isArray(d.path)
      ? { path: (d.path as unknown[]).map(Number), eids: selEids, label: r.whole ? '整页' : String(r.cls || '这一块') }
      : null
    selPath = !selEid && r && Array.isArray(d.path) ? (d.path as unknown[]).map(Number) : null
    if (selEid) {
      editNote.value = `选中这一句（${d.size || '?'}px / 字重 ${d.weight || '?'}）—— 浮动条上改颜色、字号、粗细、对齐（⇤ ⇔ ⇥），点一下就存；🗑 把这一句整段删掉（不留空壳，撤销还没做）。`
    } else if (r) {
      // 选中一整块时**必须说清是哪一块、里面有什么**：只描一圈线的话「选到了外层容器」和
      // 「选到了我要的那一块」在屏幕上是同一个样子（下一步 AI 编辑改的就是这个范围）。
      // 是 flex/grid 就把「现在的对齐是什么」一起说出来：不说的话点了 ⤒ 而画面没动
      // （本来就已经是 flex-start）看起来像按钮没生效。
      const align: Record<string, string> = { 'flex-start': '靠起始边', start: '靠起始边', center: '居中', 'flex-end': '靠结束边', end: '靠结束边', stretch: '拉满', normal: '拉满（默认）' }
      const axis = d.vert ? '上下' : '左右'
      editNote.value = `选中${r.whole ? '整页' : `这一块（${r.cls}）`}：含 ${r.eids?.length || 0} 段字${r.imgs ? ` / ${r.imgs} 张图` : ''} —— Esc 取消。要改颜色/字号得点到具体那一句上。` +
        (r.imgs ? '这一块里有图，🗑 删不了（图的序号按出现顺序算，少一格之后下一次配图会错位）—— 要去掉它走「重新生成这一页」。' : '🗑 把这一整块删掉（撤销还没做）。') +
        (d.flex
          ? `这一块是 ${d.display} 布局，里面的内容现在${axis}${align[String(d.alignItems)] || String(d.alignItems)} —— 浮动条上那三个键改它（align-items）。`
          : `（这一块不是 flex/grid，所以没有整块对齐可改。）`)
    } else {
      editNote.value = ''
    }
    return
  }
  if (d.type === 'ppt-sel-region-style') {
    editNote.value = '现在选中的是一整块，改颜色/字号要点到具体那一句上（整块里每一句的字号本来就不一样，一起改会把层级压平）。'
    return
  }
  // 整块对齐点不下去的两种情形。**都要出声**：静默的话和「点了没反应」在屏幕上一模一样。
  if (d.type === 'ppt-region-nope') {
    editNote.value = d.why === 'flex'
      ? `这一块是 ${d.display || '普通'} 布局，不是 flex/grid —— align-items 在它身上浏览器根本不认（写进去也不会有任何变化）。要让它里面的内容上下居中，先让这一块变成 flex（走「AI 编辑」说一句「这一块改成 flex 垂直居中」）。`
      : '这一块不在这一页里（是页码、进度条那些外壳），改不了它的对齐。'
    return
  }
  // 🗑 点不下去的三种情形。**都要说出成因**：合成一句「删不了」的话，「这一块有图」（去重新
  // 生成）和「这是整页」（换整页）下一步完全不同，而静默 return 和「按钮坏了」一模一样。
  if (d.type === 'ppt-del-nope') {
    editNote.value = d.why === 'img'
      ? `这一块里有 ${d.n || 1} 张图，删不了 —— 图的序号是按这一页里的出现顺序算的，少一格之后下一次「换一批图」会把第 2 张贴进第 1 格（图文不符，而页面看起来完全正常）。要去掉这一块请走「重新生成这一页」。`
      : d.why === 'whole'
        ? '这样是把整页删掉 —— 剩下一个空页，在预览里就是一块白，和「这个版式渲染塌了」分不开。要换掉整页请点「重新生成这一页」。'
        : '这一块不在这一页里（是页码、进度条那些外壳），删不了它。'
    return
  }
  if (d.type === 'ppt-del') {
    deleteNode(
      (Array.isArray(d.path) ? d.path : []).map(Number),
      (Array.isArray(d.eids) ? d.eids : []).map(String),
      `<${String(d.tag || 'div')}${d.cls ? ` class="${d.cls}"` : ''}>`,
      String(d.texts || '')
    )
    return
  }
  if (d.type === 'ppt-region-style') {
    saveRegionStyle(
      (Array.isArray(d.path) ? d.path : []).map(Number),
      (Array.isArray(d.eids) ? d.eids : []).map(String),
      d.style || {}
    )
    return
  }
  // 空白页画布：拖完/拉完一块（松手才发这一次），和删掉画布上的一块。
  if (d.type === 'ppt-canvas-box') {
    saveCanvas('box', {
      bel: String(d.bel || ''),
      left: Number(d.left) || 0, top: Number(d.top) || 0,
      width: Number(d.width) || 0, height: Number(d.height) || 0,
    })
    return
  }
  if (d.type === 'ppt-canvas-del') {
    const bel = String(d.bel || '')
    const what = d.texts ? `「${String(d.texts)}」` : d.imgs ? '这张图' : '这一块'
    // 撤销还没做：删错了这一块就得重新摆一遍（画布上没有「重新生成」这条退路）。
    if (!bel || !window.confirm(`删掉${what}？\n\n撤销还没做 —— 删了只能自己重新加一个摆回去。`)) return
    saveCanvas('delete', { bel })
    return
  }
  if (d.type === 'ppt-canvas-nobel') {
    editNote.value = '这一块不是从「＋ 一个文字框」加进来的（没有画布编号），拖不动也删不了 —— 拖了的话画面上它跟着鼠标走，而库里没有这一块，刷新之后就回到原位了。'
    return
  }
  if (d.type === 'ppt-style') saveStyle(String(d.eid || ''), d.style || {}, !!d.noRoom)
  if (d.type === 'ppt-edit') saveText(String(d.eid || ''), String(d.oldText ?? ''), String(d.newText ?? ''))
}

/**
 * 服务端回的 `chartNotes`（改完/删完之后图表的量被代码重算了）接在那句「已存」后面。
 * **必须显示出来**：条长和它旁边那个数对不上时，画面上是一张干净完整的图表 —— 一处都不报错，
 * 只有照条长读出来的结论是错的。反过来重算之后别的条会当场变长，不说一句他会以为是自己改坏了。
 */
function chartTail(notes?: string[]): string {
  return Array.isArray(notes) && notes.length ? `　⚠ ${notes.join('　')}` : ''
}

/**
 * 存这一段改动。**页码在发出去的那一刻就定死**（`cur` 会跟着他翻页变，用它的话存完回来
 * 会把新文字记到另一页上，而两页画面各自都读得通）。
 */
async function saveText(eid: string, oldText: string, newText: string) {
  const p = cur.value
  if (!p || !eid) return
  const page = p.page
  editBusy.value = true
  editErr.value[page] = ''
  editNote.value = ''
  try {
    const data = await apiPost<{ html: string; previewHtml: string; text: string; chartNotes?: string[] }>(
      `/api/ppt/decks/${deckId.value}/edit-text`,
      { page, eid, oldText, newText, planRev: planRev.value }
    )
    // 用服务端回的那一版覆盖（画面上于是显示的是库里真的那份，不是他浏览器里改出来的样子）。
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    editNote.value =
      `已存：「${data.text.slice(0, 24)}${data.text.length > 24 ? '…' : ''}」` + chartTail(data.chartNotes)
    // 拼好的整份和「已导出」那句话要作废：那一页已经不是文件里的那一版了。
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这段没改上：${e?.message || '请求失败'}（画面已经回到库里那一版）`
    // 画面必须回退到库里那份：留着他刚打的那句的话，屏幕上一切正常而库里是旧的。
    previewKey.value++
  }
  editBusy.value = false
}

/**
 * 存这一块的颜色/字号/字重（不调 AI）。和 `saveText` 同一套成败处理：**存不上就把画面退回
 * 库里那一版并说出来** —— 留着他刚点出来的样子的话，屏幕上一切正常而导出的还是旧的。
 */
async function saveStyle(eid: string, style: Record<string, unknown>, noRoom = false) {
  const p = cur.value
  if (!p || !eid) return
  const page = p.page
  editBusy.value = true
  editErr.value[page] = ''
  editNote.value = ''
  try {
    const data = await apiPost<{ html: string; previewHtml: string; style: Record<string, unknown> }>(
      `/api/ppt/decks/${deckId.value}/edit-style`,
      { page, eid, style, planRev: planRev.value }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    const align: Record<string, string> = { left: '左对齐', 'flex-start': '左对齐', center: '居中', right: '右对齐', 'flex-end': '右对齐' }
    const parts = Object.entries(data.style || {}).map(([k, v]) =>
      k === 'color' ? `字色 ${v}`
        : k === 'fontSize' ? `字号 ${v}px`
        : k === 'fontWeight' ? `字重 ${v}`
        : align[String(v)] || `${k} ${v}`
    )
    // 「宽度就是文字宽度」那种块上，左中右三个键存进去了但画面一点不动 —— 不说的话看起来像
    // 按钮坏了（接口 200、库里也真写着新值）。
    editNote.value = `已存：${parts.join('、') || '这一块的样式'}` +
      (noRoom ? '。但这一块的宽度就是文字本身的宽度，所以画面上看不出变化 —— 要让它在外面那一块里挪位置，点它周围的空处选中外层那一整块，再用浮动条上那三个整块对齐的键。' : '')
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这一块的样式没改上：${e?.message || '请求失败'}（画面已经回到库里那一版）`
    previewKey.value++
  }
  editBusy.value = false
}

/**
 * 空白页画布上的摆放（加文字框 / 拖动缩放 / 删一块，都不调 AI、不花额度）。和 `saveText`
 * 同一套成败处理：**存不上就把画面退回库里那一版并说出来** —— 留着他刚拖出来的位置的话，
 * 屏幕上一切正常而导出的还是旧的那一版。
 *
 * 加完之后把新那一块**选回来**（`selEid`）：不选的话加进来的框在一堆块里认不出是哪个新的，
 * 他会以为「点了加没反应」，再点几次 —— 于是画布上叠着好几个一样的框。
 */
async function saveCanvas(op: 'add-text' | 'add-image' | 'box' | 'delete', body: Record<string, unknown> = {}) {
  const p = cur.value
  if (!p) return
  const page = p.page
  editBusy.value = true
  editErr.value[page] = ''
  editNote.value = ''
  try {
    const data = await apiPost<{
      html: string; previewHtml: string; eid?: string; bel?: string; ratio?: string
      box?: { left: number; top: number; width: number; height: number }
    }>(`/api/ppt/decks/${deckId.value}/canvas`, { page, op, ...body, planRev: planRev.value })
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    if (op === 'add-text' && data.eid) { selEid = data.eid; selPath = null }
    // 删掉的那一块要把选中清掉：留着的话浮动条吸在一块空气上，再点一下换回一句「找不到这一块」。
    if (op === 'delete') { selEid = ''; selPath = null; aiSel.value = null }
    const box = data.box
    editNote.value = op === 'add-text'
      ? '加了一个文字框（已经选中它了）—— 双击改字，按住拖着挪位置，拉右下角那个蓝方块改大小。'
      // 比例要说出来：这一张是按它自己的比例摆的，拉成别的比例会被裁掉两边（图本身没变，
      // 只是构图缺一块）—— 不说的话他会以为「这张图本来就是这么构图的」。
      : op === 'add-image'
        ? `放上去一张图（${data.ratio || '?'}，${box?.width}×${box?.height}）—— 拖着挪位置，拉右下角改大小；改成别的比例会裁掉两边，按住比例拉就不会。`
      : op === 'delete'
        ? '已删掉这一块（撤销还没做）。'
        // 坐标要报出来：服务端会把摆到画布外面的块夹回画布里，报数是他唯一能看出「刚才那一下
        // 被夹回来了」的地方（画布是 1920×1080）。
        : `已存这一块的位置：左 ${box?.left} / 上 ${box?.top}，${box?.width}×${box?.height}（画布 1920×1080）。`
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这一块没摆上：${e?.message || '请求失败'}（画面已经回到库里那一版）`
    previewKey.value++
  }
  editBusy.value = false
}

/**
 * 存这一整块的对齐（`align-items`，不调 AI）。**eid 那一串要一起发过去**：容器没有 eid，
 * 只能按下标路径定位 —— 服务端拿这一串交叉核对，对不上就 400。不核的话浏览器和库里差一层时，
 * 对齐写到了隔壁那一块上：页面照样渲染、接口 200，只是他点的那一块没动、另一块动了。
 */
async function saveRegionStyle(path: number[], eids: string[], style: Record<string, unknown>) {
  const p = cur.value
  if (!p) return
  const page = p.page
  editBusy.value = true
  editErr.value[page] = ''
  editNote.value = ''
  try {
    const data = await apiPost<{ html: string; previewHtml: string; style: Record<string, unknown>; region: string; prev: Record<string, string> }>(
      `/api/ppt/decks/${deckId.value}/edit-region-style`,
      { page, path, eids, style, planRev: planRev.value }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    const align: Record<string, string> = { 'flex-start': '靠起始边', center: '居中', 'flex-end': '靠结束边', stretch: '拉满' }
    // 「取消」那一下要说出**刚删掉的是哪个值**：那一整块会跟着版式自己的样式变回去，不说的话
    // 他看到的是「点了取消，这块又变样了」，而不知道该点回哪个键。
    const parts = Object.entries(data.style || {}).map(([k, v]) => {
      const name = k === 'alignItems' ? '整块对齐' : '主轴对齐'
      const was = data.prev?.[k === 'alignItems' ? 'align-items' : 'justify-content'] || ''
      return v === null
        ? `取消了${name}（原来是 ${align[was] || was || '空'}）—— 现在跟着这一页版式自己的样式走`
        : `${name} ${align[String(v)] || v}`
    })
    editNote.value = `已存：<${data.region}> 这一整块 ${parts.join('、')}。`
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这一块的对齐没改上：${e?.message || '请求失败'}（画面已经回到库里那一版）`
    previewKey.value++
  }
  editBusy.value = false
}

/**
 * 删掉选中的那一整块（不调 AI、不花额度）。**先二次确认**：撤销还没做，删错了唯一的出路是
 * 「重新生成这一页」= 一次真实调用，而删掉之后画面上那一块就是「本来就没有」的样子 ——
 * 他要能在删之前看清删的是哪一块（框里写出那几个字和有几段字）。
 *
 * 成功之后**必须把选中清掉**：那个元素已经不在了，留着的话浮动条吸在一块空气上，
 * 再点一下换回一句「和库里对不上」。
 */
async function deleteNode(path: number[], eids: string[], label: string, texts: string) {
  const p = cur.value
  if (!p) return
  const page = p.page
  const what = texts ? `「${texts}」` : label
  if (!window.confirm(
    `删掉这一块 ${what}${eids.length ? `（${eids.length} 段字）` : ''}？\n\n` +
    '撤销还没做 —— 删错了只能「重新生成这一页」，那是一次真实调用，而且会连版式和文案一起重排。'
  )) {
    editNote.value = '没删。'
    return
  }
  editBusy.value = true
  editErr.value[page] = ''
  editNote.value = ''
  try {
    const data = await apiPost<{ html: string; previewHtml: string; chartNotes?: string[]; removed: { name: string; cls: string; eids: string[]; text: string } }>(
      `/api/ppt/decks/${deckId.value}/delete-node`,
      { page, path, eids, planRev: planRev.value }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    // 选中的那一块已经不存在了（`selEid` / `selPath` 会进 srcdoc —— 留着的话重挂之后
    // 那段脚本会按老路径选到**顶上来的另一块**，浮动条框着一块他没选的东西）。
    selEid = ''
    selEids = []
    selPath = null
    aiSel.value = null
    const r = data.removed
    editNote.value = `已删掉 <${r.name}${r.cls ? ` class="${r.cls}"` : ''}>` +
      (r.text ? `：「${r.text}」` : '') +
      (r.eids.length ? `（${r.eids.length} 段字）` : '') +
      ' —— 剩下那几段字的编辑标记没变，接着双击就能改。' +
      // 删掉图表里一行之后轨道上限会跟着降，剩下几条当场变长 —— 不说的话看起来像删坏了数据。
      chartTail(data.chartNotes)
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这一块没删掉：${e?.message || '请求失败'}（画面已经回到库里那一版）`
    previewKey.value++
  }
  editBusy.value = false
}

/**
 * 让 AI 改选中那一块（**一次真实调用**）。文案打了码发出去，模型碰不到 —— 校验和成因
 * 全在服务端，这里只负责把那句话原样显示出来：合成一句「AI 编辑失败」的话，「它想改文案」
 * 和「它编了个类名」在界面上就成了同一句，而两种的下一步完全不同。
 */
async function aiEdit() {
  const p = cur.value
  const sel = aiSel.value
  if (!p || !sel || aiBusy.value) return
  const wish = aiWish.value.trim()
  if (!wish) { aiErr.value = '先写一句要怎么改（比如「这三条排成两列」）。'; return }
  if (wish.length > MAX_WISH) { aiErr.value = `这句有 ${wish.length} 字，上限 ${MAX_WISH} 字 —— 这么长的通常是「重写这一页」，那个走「重新生成」。`; return }
  const page = p.page
  aiBusy.value = true
  aiErr.value = ''
  aiNote.value = ''
  aiNotes.value = []
  try {
    const data = await apiPost<{ html: string; previewHtml: string; summary: string; chartNotes?: string[] }>(
      `/api/ppt/decks/${deckId.value}/ai-edit`,
      { page, path: sel.path, eids: sel.eids, instruction: wish, planRev: planRev.value }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    aiNote.value = data.summary
    // 模型改的 inline style 里就有 `--bar-v` / `--bar-max`：被服务端重算过的话逐条列出来
    // （和「自由改造」那几条走同一个位置）—— 不列的话那一页的条长和数字对不上，而图表读起来正常。
    aiNotes.value = Array.isArray(data.chartNotes) ? data.chartNotes : []
    // 这一页已经不是拼好的那份整份/导出文件里的那一版了。
    invalidateDeck()
    // 预览是重挂的，选中框跟着没了 —— 那一栏也要收起来，留着的话他会对着一块没被框住的
    // 内容再点一次（那是再花一次额度）。
    aiSel.value = null
    aiWish.value = ''
  } catch (e: any) {
    aiErr.value = errText(e, '这一块没改上', '今天的 AI 额度用完了，这一块没改（画面还是原来那版）。')
    previewKey.value++
  }
  aiBusy.value = false
}

/**
 * 自由改造选中那一块（**一次真实调用**）：可以重排结构、新写文案、加图槽，不套案例库那条版式。
 *
 * 和上面那条走**两个端点**、不是一个开关：这边放开了「删原文 / 写中文」，走错一条的现象是
 * 「AI 怎么没照我说的改」。回来那几条 `notes`（丢掉了哪几句 / AI 新写了哪几句 / 新增了几个
 * 图槽）**一定要显示出来** —— 那些改动在画面上读起来完全正常。
 */
async function aiRemake() {
  const p = cur.value
  const sel = aiSel.value
  if (!p || !sel || aiBusy.value) return
  const wish = aiWish.value.trim()
  if (!wish) { aiErr.value = '先写一句要改成什么样（比如「改成两列卡片，每张配一张小图」）。'; return }
  if (wish.length > MAX_REMAKE_WISH) { aiErr.value = `这句有 ${wish.length} 字，上限 ${MAX_REMAKE_WISH} 字 —— 拆成两次改。`; return }
  const page = p.page
  aiBusy.value = true
  aiErr.value = ''
  aiNote.value = ''
  aiNotes.value = []
  try {
    const data = await apiPost<{
      html: string; previewHtml: string; summary: string; notes?: string[]
      images?: FilledImage[]; plan?: { images: number; imageSpecs: PlannedImage[] }
    }>(
      `/api/ppt/decks/${deckId.value}/ai-remake`,
      { page, path: sel.path, eids: sel.eids, instruction: wish, planRev: planRev.value }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    // 图位清单照服务端回的那份记（同「生成这一页」）：自由改造可以加/删图槽，不覆盖的话
    // 备图那一块照旧按老格数画 —— 画面上两个图槽而面板上只有一格，新那格备图/换图/素材库
    // 一个入口都没有，他只剩「配全部图」那条真花钱的路。
    if (data.plan) {
      p.images = data.plan.images
      p.imageSpecs = data.plan.imageSpecs
      data.plan.imageSpecs.forEach((s, i) => { draftSubject.value[subjectKey(page, i + 1)] = s.subject })
    }
    // 加/删图槽之后服务端会把配图记录按新 html 重排一次（图的序号是按出现顺序数的），
    // 重排过就回一份新的 —— 不接的话这一栏照旧写着「配图 1/1 张」并挂着那张缩略图，
    // 而画面里那几格已经是占位图了，他会当这一页配完直接去拼整份。
    if (data.images && imgInfo.value[page]) {
      imgInfo.value[page] = { ...imgInfo.value[page], images: data.images }
    }
    aiNote.value = data.summary
    aiNotes.value = Array.isArray(data.notes) ? data.notes : []
    invalidateDeck()
    // 预览重挂之后选中框就没了 —— 那一栏也收起来，留着的话他会对着一块没被框住的内容
    // 再点一次（那是再花一次额度）。
    aiSel.value = null
    aiWish.value = ''
  } catch (e: any) {
    aiErr.value = errText(e, '这一块没改上', '今天的 AI 额度用完了，这一块没改（画面还是原来那版）。')
    previewKey.value++
  }
  aiBusy.value = false
}

/**
 * 生成（或重新生成）一页。`setup` 只在从那个对话框点进来时带 —— 不带的话服务端用库里
 * 存着的那份（换过的版式 + 手写要求），所以「逐页生成」也会照着他改过的来。
 */
async function build(
  p: PlannedPage,
  setup?: { layoutId: string; notes: string; title: string; points: string[]; outlineText: string }
): Promise<BuildOutcome> {
  busy.value[p.page] = true
  pageErr.value[p.page] = ''
  let outcome: BuildOutcome = 'ok'
  try {
    // 图位规格服务端从库里那份规划取。版式/额外要求/提纲**只在那个对话框点进来时**才带 ——
    // 每次都原样回传的话，内存里那份万一是上一次规划的，它就成了事实上的输入，生成出来的页
    // 每一页都好看、只是和这份稿子对不上。带了的话服务端先存下来再按新的那份生成。
    const data = await apiPost<
      BuiltPage & {
        images?: FilledImage[]
        style?: { id: string; name: string }
        setup?: { layoutId: string; notes: string }
        outline?: { title: string; points: string[]; outlineText?: string }
        plan?: { images: number; imageSpecs: PlannedImage[] }
      }
    >(`/api/ppt/decks/${deckId.value}/pages`, { page: p.page, planRev: planRev.value, ...(setup || {}) })
    // 图位清单照服务端回的那份记：它会按这一页**真的排出来的图位**对齐（换过版式、或者按
    // 真实内容多排了一块）。不覆盖的话备图那一整块照旧按老的格数画 —— 规划里 0 格时它干脆
    // 不画（界面上写「这一页还没配过图」），而画面上明明有 4 张占位图、一个备图入口都没有。
    if (data.plan) {
      p.images = data.plan.images
      p.imageSpecs = data.plan.imageSpecs
      data.plan.imageSpecs.forEach((s, i) => { draftSubject.value[subjectKey(p.page, i + 1)] = s.subject })
    }
    // 提纲照服务端回的那份记（那是库里现在那份）。不同步的话左边列表和标题栏还写着模型
    // 原来那句标题，而画面是按新提纲生成的 —— 两处各自都读得通，看不出哪个是最新的。
    if (data.outline) {
      p.title = data.outline.title
      p.points = data.outline.points
      // 原文也照服务端回的那份记。不同步的话下次打开那个框显示的是手上这份老原文，
      // 看起来像上一次的修改没存上 —— 而库里存的、这一页画面上的，都是新的那一段。
      if (data.outline.outlineText !== undefined) p.outlineText = data.outline.outlineText
    }
    // 这次到底按哪条版式、带了什么要求，照服务端回的那份记（本地那份 draft 可能和它不一样：
    // 选回规划那条时服务端会把覆盖清掉）。不同步的话标签写着 L12 而画面是 L07 排的。
    if (data.setup) {
      builtLayout.value[p.page] = data.setup.layoutId
      setupLayout.value[p.page] = data.setup.layoutId === p.layoutId ? '' : data.setup.layoutId
      setupNotes.value[p.page] = data.setup.notes || ''
      // 上面那份 `plan.imageSpecs` 是服务端按**这一版真的排出来的图槽**对齐过的，也就是说
      // 清单现在跟的是这条版式。记下来，不然换过版式生成完之后再点一次生成，`needsReplan`
      // 还是 true —— 又多一次重排调用，而结果和刚才那份一样。
      specsLayout.value[p.page] = data.setup.layoutId
    }
    built.value[p.page] = { html: data.html, previewHtml: data.previewHtml, problems: data.problems || [] }
    // 备好的图是服务端在生成完当场贴进去的（`applyPreparedImages`）。贴上了几张要接过来 ——
    // 不接的话这一页写着「还没配过图」而图就在画面里，他会再点一次配图。
    // 没贴上任何图时**必须清掉上一版的配图记录**（服务端也清了 `images_json`）：留着的话
    // 界面上写着「3/3 张有图、画风 S-A」，而新 html 里图槽位已经换回占位图。
    if (data.images?.length) {
      imgInfo.value[p.page] = {
        html: data.html, previewHtml: data.previewHtml, images: data.images,
        problems: [], quotaExceeded: false,
        style: data.style?.id
          ? { id: data.style.id, name: styleList.value.find(x => x.id === data.style!.id)?.name || '' }
          : undefined,
      }
    } else {
      delete imgInfo.value[p.page]
    }
    // 拼好的整份必须作废：留着的话它翻起来完全正常，只是那一页还是改之前的版本。
    invalidateDeck()
  } catch (e: any) {
    // 失败要说在那一页上（顶上一条全局错误看不出是哪一页），而且上一版留着 ——
    // 清掉的话「重新生成失败」和「还没生成过」在界面上是同一个样子。
    pageErr.value[p.page] = errText(e, '这一页生成失败', '今天的 AI 额度用完了，这一页没生成。')
    outcome = e?.message === 'quota_exceeded' ? 'quota' : 'fail'
  }
  busy.value[p.page] = false
  return outcome
}

/**
 * 逐页生成（**串行**，只生成还没生成过的那几页）。
 *
 * 三件事是承重的：串行发（并发一批会撞上游频控，而回来的错误读起来像模型不行）；
 * 额度打满立刻停（接着跑十几页只会拿到十几条一样的错误，中间还夹着刚才那几页的成功）；
 * 收尾那句话必须逐类报数，不能合成一句「已完成」—— 部分成功是常态，失败的那几页在
 * 界面上就是「还没生成」的样子。
 */
async function runAll() {
  batchRunning.value = true
  batchKind.value = 'page'
  stopRequested = false
  batchNote.value = ''
  let ok = 0
  const failed: number[] = []
  let quota = false
  const todo = pages.value.filter(p => !built.value[p.page])
  for (const p of todo) {
    if (stopRequested) break
    batchAt.value = p.page
    const r = await build(p)
    if (r === 'ok') ok++
    else failed.push(p.page)
    if (r === 'quota') { quota = true; break }
  }
  const rest = todo.length - ok - failed.length
  batchNote.value = [
    `这一轮生成了 ${ok} 页`,
    failed.length ? `失败 ${failed.length} 页（第 ${failed.join(' / ')} 页，错误写在那一页上）` : '',
    quota ? 'AI 额度已用完，剩下的没再试 —— 明天 0 点重置，或者去后台加额度。' : '',
    !quota && stopRequested && rest > 0 ? `你点了停止，还剩 ${rest} 页没生成。` : '',
  ].filter(Boolean).join('；')
  batchRunning.value = false
  batchKind.value = ''
}

function stopBatch() {
  // 只置位，当前那一页跑完再停（掐断的话那次调用的额度已经花了，而界面上是「没生成」）。
  stopRequested = true
  batchNote.value = '已请求停止，当前这一页跑完就停。'
}

async function makeDeck() {
  deckErr.value = ''
  try {
    const data = await apiPost<{ html: string }>(`/api/ppt/decks/${deckId.value}/deck`, {})
    deckHtml.value = data.html
  } catch (e: any) {
    deckHtml.value = ''
    deckErr.value = e.message || '整份 deck 拼不出来'
  }
}

/**
 * 导出成一个 .html 文件。拼装和改地址都在服务端（同一份 deckShell + buildDeck）。
 *
 * 两件事是承重的：`baseUrl` 传 `location.origin`（图的相对地址按它改成绝对，服务端在
 * 反代后面算出来的是 http，混合内容会被浏览器拦掉而那几格看起来只是「没配图」）；
 * 下载失败必须出声 —— `createObjectURL` / `a.click()` 静默失败时按钮点下去什么都不发生，
 * 读起来像导出功能坏了。
 */
async function exportDeck() {
  exportErr.value = ''
  exportNote.value = ''
  exportWarnings.value = []
  exporting.value = true
  try {
    const data = await apiPost<{ filename: string; html: string; warnings: string[]; placeholders: number }>(
      `/api/ppt/decks/${deckId.value}/export`,
      { baseUrl: location.origin }
    )
    download(data.filename, data.html)
    exportNote.value = `已导出 ${data.filename}（${pages.value.length} 页）—— 双击就能在浏览器里放映。`
    exportWarnings.value = data.warnings || []
  } catch (e: any) {
    exportErr.value = e.message || '导出失败'
  }
  exporting.value = false
}

/**
 * 导出可编辑 .pptx。服务端要开浏览器逐页渲染，十几页要十几秒（`apiPost` 走 fetch，没有超时，
 * 所以这里只要把「在导」这件事显示出来就行 —— 见按钮上的 disabled）。
 *
 * 回执里那几句（字体没取到 / 图没取到 / 哪几类样式画不出来）**必须显示出来**：这条路是有损的，
 * 而下载下来的文件自己打开是一份完整的稿子，没有任何一处会说差在哪。
 *
 * 三个数（文本 / 色块 / 图片）分开报：这份里每一块都是独立对象，「图片」那个数是唯一能看出
 * 「这页有几块还是贴图、改不了」的地方 —— 合成一个总数的话，全页贴成一张图和全页可编辑
 * 在回执上一模一样。
 */
async function exportPptx() {
  exportErr.value = ''
  pptxNote.value = ''
  pptxWarnings.value = []
  exportingPptx.value = true
  try {
    const data = await apiPost<{
      filename: string; base64: string; bytes: number; pages: number
      textBlocks: number; shapes: number; images: number; warnings: string[]
    }>(`/api/ppt/decks/${deckId.value}/export-pptx`, { baseUrl: location.origin })
    downloadBytes(data.filename, data.base64, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    pptxNote.value =
      `已导出 ${data.filename}（${data.pages} 页 / 文本 ${data.textBlocks} 块 / 色块 ${data.shapes} 个 / ` +
      `图片 ${data.images} 张，${Math.max(1, Math.round(data.bytes / 1024 / 102.4) / 10)} MB）` +
      `—— 每一块都是独立对象，在 PowerPoint 里单独点得中、改得动。`
    pptxWarnings.value = data.warnings || []
  } catch (e: any) {
    exportErr.value = e.message || '导出 pptx 失败'
  }
  exportingPptx.value = false
}

/** base64 → 文件。**不能走 `download()`**：那个按文本存，二进制会被当成 UTF-8 改写，
 *  存出来的 .pptx 双击时 PowerPoint 说文件损坏（而下载那一步一切正常）。 */
function downloadBytes(filename: string, b64: string, mime: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function toggleSrc(page: number) { showSrc.value[page] = !showSrc.value[page] }

/**
 * 重新生成这一页 HTML 会把配好的图**换回占位图**（新 HTML 里图槽位是占位图），
 * 而那一页在预览里看起来只是「这版设计得比较空」—— 所以生成前那个对话框里必须写清楚
 * 这一次会丢掉几张、又会免费贴回去几张。备好的那几张是不花钱贴回去的，一律说「要重新
 * 花钱」的话他就再也不敢重排这一页了。
 */
const rebuildImgWarn = computed(() => {
  const p = setupFor.value
  if (!p || !built.value[p.page]) return ''
  const filled = filledCount(p.page)
  if (filled <= 0) return ''
  const prepped = pending.value[p.page]?.length || 0
  return prepped >= filled
    ? `这一页已经配了 ${filled} 张图，备好的那 ${prepped} 张会在新 HTML 里自动贴回去（不花钱）。`
    : `这一页已经配了 ${filled} 张图，其中 ${prepped} 张备过（会自动贴回去），剩下 ${filled - prepped} 张要点「补齐这一页的图」重新生成才有（每张一次真实花费）。`
})

/**
 * 给一页配图。成功后必须用返回的 html **覆盖**这一页存着的 html —— 不覆盖的话拼整份
 * 用的还是占位图那一版，而预览里刚刚明明看到图了。
 */
async function fillImages(p: PlannedPage, force = false): Promise<BuildOutcome> {
  if (force && !confirm(`换一批图会把第 ${p.page} 页现有的 ${filledCount(p.page)} 张全部重新生成（旧的不会自动删）。继续？`)) return 'ok'
  imgBusy.value[p.page] = true
  imgErr.value[p.page] = ''
  let outcome: BuildOutcome = 'ok'
  try {
    // html 也从库里取（服务端）：传内存里那份的话，重新生成过的那一页会被配上图再存回去，
    // 内容退回上一版而图是新的，两边都不报错。
    const data = await apiPost<ImagesResult>(
      `/api/ppt/decks/${deckId.value}/images`, { page: p.page, force, planRev: planRev.value }
    )
    built.value[p.page] = { ...built.value[p.page], html: data.html, previewHtml: data.previewHtml }
    imgInfo.value[p.page] = data
    invalidateDeck()
    if (data.quotaExceeded) outcome = 'quota'
    else if (data.images.some(i => !i.url)) outcome = 'fail'
  } catch (e: any) {
    imgErr.value[p.page] = errText(e, '生图失败', '今天的 AI 额度用完了，这一页的图没配上。')
    outcome = e?.message === 'quota_exceeded' ? 'quota' : 'fail'
  }
  imgBusy.value[p.page] = false
  return outcome
}

/** 逐页配图（串行、可停止、逐类报数，和 runAll 一个口径）。只做还差图的那几页。 */
async function fillAllImages() {
  batchRunning.value = true
  batchKind.value = 'image'
  stopRequested = false
  batchNote.value = ''
  let done = 0
  const failed: number[] = []
  let quota = false
  const todo = pages.value.filter(p => built.value[p.page] && slotCount(p.page) > filledCount(p.page))
  for (const p of todo) {
    if (stopRequested) break
    batchAt.value = p.page
    const r = await fillImages(p)
    if (r === 'ok') done++
    else failed.push(p.page)
    if (r === 'quota') { quota = true; break }
  }
  const rest = todo.length - done - failed.length
  batchNote.value = [
    `配图跑完 ${done} 页`,
    failed.length ? `有 ${failed.length} 页没配齐（第 ${failed.join(' / ')} 页，缺的那几格还是占位图，详情写在那一页下面）` : '',
    quota ? 'AI 额度已用完，剩下的没再试。' : '',
    !quota && stopRequested && rest > 0 ? `你点了停止，还剩 ${rest} 页没配图。` : '',
  ].filter(Boolean).join('；')
  batchRunning.value = false
  batchKind.value = ''
}

onMounted(async () => {
  try {
    const data = await apiGet<{ styles: StyleItem[]; defaultStyleId: string }>('/api/ppt/styles')
    styleList.value = data.styles || []
    styleId.value = data.defaultStyleId || data.styles?.[0]?.id || ''
  } catch {
    // 画风清单拿不到不挡生图（服务端有自己的默认那套），下拉留空就是「用默认」。
  }
  try {
    const d = await apiGet<{
      palettes: DesignOpt[]; fonts: DesignOpt[]; densities: DesignOpt[]; headers: DesignOpt[]
      default: { palette: string; font: string; density: string; header: string }
    }>('/api/ppt/design-options')
    designOpts.value = { palettes: d.palettes, fonts: d.fonts, densities: d.densities, headers: d.headers }
    design.value = { ...d.default }
  } catch (e: any) {
    // 出声：静默的话抽屉里那三个下拉是空的，看起来像「这一版没有设计规范这回事」，
    // 而库里存着的那份照旧在生效（画面是那份，界面上一处都不显示）。
    designProblems.value = [`设计规范的清单没拿到（${e?.message || '请求失败'}）—— 配色/字体/疏密/页眉这四个下拉暂时是空的，这份稿子还是按库里存着的那套渲染。`]
  }
  try {
    palette.value = (await apiGet<{ colors: string[] }>('/api/ppt/edit-palette')).colors || []
  } catch (e: any) {
    // 拿不到就得出声：静默的话浮动条上一个色块都没有，看起来像「这一版没有改颜色这个功能」。
    paletteErr.value = `调色板没拿到（${e?.message || '请求失败'}）—— 浮动条上暂时只能改字号和粗细，刷新一下再试。`
  }
  await loadDeck()
  // 新建完进来就直接开跑，不用他再点一次。**只在「一页都没规划过」时跑** ——
  // 每次进页面都跑的话，刷新一下就是一次真实调用，而且会把已经生成好的那几页清掉
  // （见 savePlan），界面上只是「怎么又在规划」。
  if (!loadErr.value && !pages.value.length && outline.value.trim()) {
    autoPlanned.value = true
    await run()
  }
  // 提纲是空的（新建时只填了名字）：直接把抽屉打开 —— 空工作台上没有任何入口的话，
  // 「还没写提纲」看起来像这个页面坏了。
  if (!loadErr.value && !outline.value.trim()) showSettings.value = true
  window.addEventListener('keydown', onKey)
  window.addEventListener('message', onFrameMsg)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('message', onFrameMsg)
})

/**
 * 读这份稿子。画风必须**在拿到清单之后**再按库里那条覆盖 —— 反过来的话
 * `/styles` 那个缺省值会盖掉他存过的画风，而下拉里显示的是缺省那套，
 * 看起来像他自己选的（下一批图于是换了笔触，没有一处报错）。
 */
async function loadDeck() {
  if (!deckId.value) {
    loadErr.value = '这个地址里没有演示稿 id。'
    return
  }
  try {
    const { deck, design: spec, designProblems: dp } = await apiGet<{
      deck: any; design?: { palette: string; font: string; density: string; header: string }; designProblems?: string[]
    }>(`/api/ppt/decks/${deckId.value}`)
    title.value = deck.title || ''
    outline.value = deck.outline || ''
    brandCn.value = deck.brand_cn || ''
    brandEn.value = deck.brand_en || ''
    deckNotes.value = deck.notes || ''
    // 页序版本号（098）。**每次读 deck 都要跟上**：不跟的话删过一页之后这一页上所有
    // 花钱的操作都会 409，而他刚刚才刷新过。
    planRev.value = Number(deck.plan_rev) || 0
    if (deck.style_id) styleId.value = deck.style_id
    // 规范用服务端解析过的那份（`parseDesignSpec`），不自己读 `design_json`：两处各解析一遍的话
    // 画面按服务端那份渲染、下拉显示前端这份，认不出的 id 上两边会不一样而都不报错。
    if (spec) design.value = { ...spec }
    if (dp?.length) designProblems.value = dp
    savedSnapshot = metaSnapshot()
    // 上一次的规划（`plan_json` 是整份 PlanResult 原样存的）。解析失败要出声：
    // 静默当成「没规划过」的话，下面那句自动规划会直接再花一次调用，而旧规划还在库里。
    if (deck.plan_json) {
      try {
        const p = JSON.parse(deck.plan_json)
        pages.value = p.pages || []
        usage.value = p.usage || null
      } catch {
        loadErr.value = '这份稿子存着的规划读不出来（plan_json 坏了）。点「重新规划」会重新花一次调用。'
      }
    }
    await loadPages()
    selectFirst()
  } catch (e: any) {
    loadErr.value = `打不开这份演示稿：${e?.message || '请求失败'}`
  }
}

interface StoredPage {
  page: number; layoutId: string; html: string
  /**
   * 这一页那一段（贴好蒙版、剥掉页码），要塞进那份共用外壳的 `previewSlot` 里。
   *
   * **列表接口只回这一段，不回整份预览**：整份预览是「85KB 的外壳 + 这一页」，逐页回等于把
   * 同一份外壳抄 N 遍 —— 实测 41 页的稿子响应 3658KB，改完 141KB
   * （`server/scripts/bench-ppt.mts`）。别的接口（生成 / 配图 / 就地编辑）照旧回整份 previewHtml：
   * 那是一次一页，抄不出量来。
   */
  section: string
  problems: string[]; images: FilledImage[]; imageStyleId: string
  /** 生成 HTML 之前先备好的图（091）。这一页可能只有备图、还没有 html。 */
  pendingImages: PreparedImage[]
  /** 他挑的版式（092，空 = 照规划）。`layoutId` 是这份 html 实际用的那条，两者可能不同。 */
  setupLayoutId: string
  /** 他手写的额外要求（092）。 */
  notes: string
  /** 这一页黑蒙版的透明度（097）。 */
  veilOpacity: number
}

/**
 * 把服务端那份共用外壳和这一页那一段拼成可以丢进 iframe 的一整份。
 *
 * **这里只做一次字符串替换，不算任何东西**：蒙版（那层黑）和页码剥离都在服务端
 * `previewSection` 里，也就是仍然只有一份实现 —— 这边自己贴一层的话预览和导出的文件会是
 * 两种深浅，而两边各自都是一页正常的幻灯片（服务端 `deckShell.test.ts` 按「两条路逐字相同」
 * 对账）。**替换一律用函数形式**：那一段正文里的 `$&` / `$1` 在字符串形式下会被当成引用
 * 展开，悄悄吃掉几个字符（服务端那份也是为这个用函数形式的）。
 */
function previewOf(shell: string, slot: string, section: string): string {
  return shell.replace(slot, () => section)
}

/**
 * 读已经生成的那几页。预览由**服务端回的那份外壳** + 每页那一段拼起来（`previewOf`）——
 * 蒙版和页码都是服务端算的，这边只做一次字符串替换（见 `previewOf` 上的注释）。
 *
 * 读不进来**必须出声**：静默当成「还没生成」的话，界面上是「生成全部 12 页」，
 * 而那十几次调用其实已经花过 —— 他会照着按钮再花一遍。
 */
async function loadPages() {
  try {
    const { pages: rows, shell, previewSlot } = await apiGet<{ pages: StoredPage[]; shell: string; previewSlot: string }>(
      `/api/ppt/decks/${deckId.value}/pages`
    )
    // 外壳/插入点缺一样就**不要静默继续**：拼出来是一份没有幻灯片的空外壳，
    // 每一页的缩略图和画面都是一块白 —— 和「这一页排版塌了」长得一模一样。
    if (rows.some(r => r.html) && (!shell || !previewSlot || !shell.includes(previewSlot))) {
      loadErr.value = '这份稿子的预览外壳没拿到（服务端回的 shell/previewSlot 对不上）—— 已经生成的那几页现在显示不出来，别重新生成（那是重新花钱），刷新一下再试。'
      return
    }
    for (const r of rows) {
      // 备好图但还没生成 HTML 的那几页也会回来（`html = ''`）。**不能当成「已生成」**：
      // 那样右边是一块白，读起来像这一页排版塌了，而它压根没生成过。
      if (r.pendingImages?.length) pending.value[r.page] = r.pendingImages
      // 生成前改过的那两样（092）也要接回来：不接的话对话框每次都从规划那条开始，
      // 他上次写的要求看不见（以为没保存上），而下一次生成服务端照旧会带上它。
      if (r.setupLayoutId) setupLayout.value[r.page] = r.setupLayoutId
      if (r.notes) setupNotes.value[r.page] = r.notes
      if (r.veilOpacity) veil.value[r.page] = r.veilOpacity
      if (!r.html) continue
      builtLayout.value[r.page] = r.layoutId
      const previewHtml = previewOf(shell, previewSlot, r.section)
      built.value[r.page] = { html: r.html, previewHtml, problems: r.problems || [] }
      // 配图结果也存着（哪张成了、用的哪套画风）。只显示「配了几张」的话，
      // 失败的那几格在预览里就是「设计上留白」。
      if (r.images?.length) {
        imgInfo.value[r.page] = {
          html: r.html, previewHtml, images: r.images,
          problems: [], quotaExceeded: false,
          style: r.imageStyleId
            ? { id: r.imageStyleId, name: styleList.value.find(x => x.id === r.imageStyleId)?.name || '' }
            : undefined,
        }
      }
    }
  } catch (e: any) {
    loadErr.value = `这份稿子已经生成的页读不出来：${e?.message || '请求失败'} —— 先别点生成（那些页可能已经存在库里，重生一次是重新花钱）。`
  }
}

/**
 * 存这一页的蒙版透明度（**不调 AI**）。
 *
 * 两条是承重的：
 * ① **预览用服务端回的那份 previewHtml 换掉**，不在本地叠一层半透明黑 —— 本地那层是压在
 *    iframe 上面的（连页眉正文一起压暗），而真 deck 里它夹在背景图和内容之间：
 *    照本地看到的效果去调，导出的文件是另一副样子。
 * ② **存不上要出声并把滑块退回原值**：不退的话滑块停在他拖的位置、画面也是暗的（本地渲染），
 *    而库里还是旧值 —— 拼整份和导出用的都是旧值。
 */
async function saveVeil(page: number, next: number) {
  const before = veil.value[page] || 0
  if (veilBusy.value) return
  veilBusy.value = true
  veilErr.value = ''
  veil.value[page] = next
  try {
    const r = await apiPatch<{ veilOpacity: number; previewHtml: string }>(
      `/api/ppt/decks/${deckId.value}/pages/${page}/veil`, { opacity: next, planRev: planRev.value }
    )
    veil.value[page] = r.veilOpacity
    if (r.previewHtml && built.value[page]) {
      built.value[page] = { ...built.value[page], previewHtml: r.previewHtml }
      if (imgInfo.value[page]) imgInfo.value[page] = { ...imgInfo.value[page], previewHtml: r.previewHtml }
    }
    // 整份预览和「已导出」那句话都过期了（`invalidateDeck`）—— 不作废的话他点「看整份」
    // 看到的是没有蒙版的那一版，而每一页单看都是对的。
    invalidateDeck()
  } catch (e: any) {
    veil.value[page] = before
    veilErr.value = `蒙版没存上（这一页还是 ${Math.round(before * 100)}%）：${e?.message || '请求失败'}`
  }
  veilBusy.value = false
}

// ── 删一页（结构改动，098）────────────────────────────
const structBusy = ref(false)
const structNote = ref('')
const structErr = ref(false)

/**
 * 把所有**按页码索引**的本地状态清空。
 *
 * 删一页之后后面的页码全部往前挪一位，而这十几个 map 的 key 是页码 —— 不清的话它们整体
 * 错位一位：备好的图挂在没备图的那一页上、蒙版滑块显示的是隔壁那页的值、生成前对话框里
 * 那几句图片提示词是上一页的。**每一页渲染出来都是一页正常的幻灯片**，一处都不报错。
 *
 * 所以这里宁可全清再从库里读一遍（都是本地缓存，重读不花钱），不做「把 key 平移一位」——
 * 平移漏掉任何一个 map 就是上面那种错位，而漏掉哪个看不出来。
 */
function resetPageState() {
  built.value = {}
  builtLayout.value = {}
  busy.value = {}
  pageErr.value = {}
  veil.value = {}
  showSrc.value = {}
  imgBusy.value = {}
  imgErr.value = {}
  imgInfo.value = {}
  pending.value = {}
  prepBusy.value = {}
  prepErr.value = {}
  prepNote.value = {}
  replanBusy.value = {}
  // 这一份也按页码存：错位之后「这一页的图位清单是按哪条版式排的」记的是隔壁那页的版式 ——
  // 于是生成前该自动重排的那一次被跳掉（`needsReplan` 算成 false），出来是空了两格的一页。
  specsLayout.value = {}
  setupLayout.value = {}
  setupNotes.value = {}
  // 图片提示词的草稿也按「页码:格号」存（`subjectKey`）：留着的话生成前那个对话框里显示的是
  // 隔壁那一页的提示词，而他一按保存就把它写进这一页了。
  draftSubject.value = {}
  editErr.value = {}
}

/**
 * 删掉这一页。
 *
 * ① **确认框里逐类写清扔掉什么**（一次生成 / 几张备好的图 / 手写的要求）：写成「确定删除？」
 *    的话他不知道这一下扔的是几次真实花费。备好的图仍在素材库里能挑回来，这句也要说。
 * ② **删完从服务端重读整份**（`resetPageState` + `loadDeck`），不本地 splice —— 见
 *    `resetPageState` 上面那段。
 * ③ **`planRev` 换成服务端回的那个**：不换的话这一页之后所有花钱的操作全部 409，
 *    而他刚刚才在界面上删过一页。
 */
async function removePage(p: PlannedPage) {
  if (structBusy.value) return
  const cost = [
    built.value[p.page] ? '这一页已经生成的画面（一次真实调用）' : '',
    filledCount(p.page) ? `贴在画面里的 ${filledCount(p.page)} 张图` : '',
    pending.value[p.page]?.length ? `备好的 ${pending.value[p.page].length} 张图（每张一次真实花费）` : '',
    setupNotes.value[p.page] ? '你给这一页写的额外要求' : '',
    veil.value[p.page] ? '这一页调过的蒙版' : '',
  ].filter(Boolean)
  const ok = window.confirm(
    `删掉第 ${p.page} 页「${p.title || '(没标题)'}」？\n\n` +
      (cost.length
        ? `会跟着扔掉：\n${cost.map(c => `· ${c}`).join('\n')}\n\n` +
          '图本身还在素材库里，以后能挑回来（不用重新花钱）；画面和要求删了就没了。\n\n'
        : '这一页还没生成过，删掉不损失什么。\n\n') +
      '后面几页的页码会整体往前挪一位。'
  )
  if (!ok) return
  structBusy.value = true
  structNote.value = ''
  structErr.value = false
  try {
    const r = await apiDelete<{
      planRev: number
      removed: { html: boolean; images: number; prepared: number; notes: boolean; veil: boolean }
      shifted: number
    }>(`/api/ppt/decks/${deckId.value}/pages/${p.page}`)
    // 报的是**服务端真的删掉的那几样**，不是上面确认框里那份猜测（两处不一样的时候，
    // 库里那份才算数 —— 比如另一处刚给这一页备过图）。
    const gone = [
      r.removed.html ? '已生成的画面' : '',
      r.removed.images ? `画面里的 ${r.removed.images} 张图` : '',
      r.removed.prepared ? `备好的 ${r.removed.prepared} 张图（还在素材库里）` : '',
      r.removed.notes ? '额外要求' : '',
      r.removed.veil ? '蒙版' : '',
    ].filter(Boolean)
    structNote.value =
      `第 ${p.page} 页删掉了` +
      (gone.length ? `，跟着扔掉了：${gone.join('、')}` : '（那一页还没生成过）') +
      (r.shifted ? `；后面 ${r.shifted} 页的页码往前挪了一位。` : '。')
    resetPageState()
    // 拼好的整份/刚导出的那个文件都过期了（少了一页，而它翻起来完全正常）。
    invalidateDeck()
    await loadDeck()
    // ③ 服务端回的那个版本号兜底：`loadDeck` 正常会带回同一个值，这里再落一次是防
    // 「读 deck 失败但页已经删了」——那种情况下旧的 rev 会让下一次生成 409。
    planRev.value = r.planRev
  } catch (e: any) {
    structErr.value = true
    structNote.value = `第 ${p.page} 页没删掉：${e?.message || '请求失败'}（库里还是原来那样，页码没动）`
  }
  structBusy.value = false
}

// ── 插一页（结构改动，098）──────────────────────────
/** 插在第几页后面（0 = 最前面）。null = 那个框没开。 */
const insertAfter = ref<number | null>(null)
/** 这次插的是空白页（⑥）。**和上面那个位置分开存**：合成一个 mode 字符串的话拼错一个字
 *  就静默走另一条路 —— 插进来的是一页要 AI 生成的页，而它在界面上和空白页一样是「新插的一页」。 */
const insBlank = ref(false)
const insTitle = ref('')
const insPoints = ref('')
const insPointLines = computed(() =>
  insPoints.value.split('\n').map(s => s.trim()).filter(Boolean)
)
/**
 * 「版式还没挑」那句话要显示在「生成前确认」这个框**里面**：写在页面顶上那条
 * `structNote` 上的话，插完弹出来的这个框正盖住它 —— 他看不到，直接按「生成这一页」
 * 就是连着两页一模一样的版式（一次真实调用，翻起来只是「有点单调」，没有一处会说）。
 * 按页码存住，免得下一次为别的页打开这个框时还挂着上一次那句。
 */
const insertedHint = ref<{ page: number; text: string } | null>(null)
/** 和 `outlineIssue` 同一套判据（服务端 `insertPage` 也会拒）—— 少了这一层他要等一次往返。 */
const insIssue = computed(() => {
  if (insertAfter.value === null) return ''
  if (insBlank.value) {
    // 空白页只校验标题（服务端同样只校验它）：那是左边那一栏里认出这一页的唯一线索。
    return insTitle.value.trim() ? '' : '标题是空的 —— 左边那一栏里这一页会是一格没有名字的空卡，和「这一页渲染塌了」分不开。'
  }
  if (!insTitle.value.trim()) return '标题是空的 —— 生成出来会是一页没有标题的幻灯片，看起来像版式本来就这样。'
  const lines = insPointLines.value
  if (!lines.length) return '一条要点都没有 —— 只给标题的话模型会自己编这一页的内容，出来那一页读着通顺但不是你的东西。'
  if (lines.length > MAX_POINTS) return `要点 ${lines.length} 条，最多 ${MAX_POINTS} 条。拆成两页更好排。`
  const i = lines.findIndex(s => s.length > MAX_POINT)
  if (i >= 0) return `第 ${i + 1} 条要点有 ${lines[i].length} 字，上限 ${MAX_POINT} 字 —— 太长会被版式裁掉。`
  return ''
})

function openInsert(after: number, blank = false) {
  insertAfter.value = after
  // 每次打开都清空：留着上一次的话他以为这是「已经填好的这一页」，一按插入就多出一页
  // 内容重复的幻灯片（而两页各自都读得通）。
  // `insBlank` 也要每次重置：上一次插空白页留下的 true 会让下一次「在这后面插一页」
  // 静默插成空白页 —— 那个框里少了要点那一栏，而他不一定会注意到。
  insBlank.value = blank
  insTitle.value = ''
  insPoints.value = ''
  structNote.value = ''
  structErr.value = false
}

/**
 * 插进来。三条和删一页同源（见 `removePage`）：从服务端重读整份而不本地 splice、
 * 换上服务端回的 `planRev`、按页码索引的本地状态全清（`resetPageState`）。
 *
 * 插完**立刻打开新那一页的「生成前确认」**：版式是继承前一页来的（服务端 `layoutInherited`），
 * 不推他去挑的话这份稿子里会连着两页一模一样的版式 —— 翻起来只是「有点单调」，
 * 而规划里那几条跨页提示是上一次算的（已经标成可能不准），没有一处会说。
 */
async function doInsert() {
  const after = insertAfter.value
  if (after === null || structBusy.value || insIssue.value) return
  structBusy.value = true
  structNote.value = ''
  structErr.value = false
  const blank = insBlank.value
  try {
    const r = await apiPost<{ page: number; shifted: number; layoutId: string; layoutInherited: boolean; planRev: number; blank?: boolean }>(
      `/api/ppt/decks/${deckId.value}/insert-page`,
      // 空白页**一条要点都不发**（服务端收到要点会直接拒）：它不进任何 prompt，
      // 发过去等于让他写一段永远不会出现在页面上的字。
      { after, title: insTitle.value.trim(), points: blank ? [] : insPointLines.value, ...(blank ? { blank: true } : {}) }
    )
    insertAfter.value = null
    resetPageState()
    // 少一页/多一页之后，拼好的整份和刚导出的那个文件都过期了（而它们翻起来完全正常）。
    invalidateDeck()
    await loadDeck()
    planRev.value = r.planRev
    // 报的是**服务端说的那件事**（`r.blank`），不是这边点的那个按钮：两处不一样的时候
    // 库里那份才算数（比如这个版本的服务端还不认 `blank`，那插进来的是一页要生成的页 ——
    // 照着按钮报「空白页已插好」的话他会一直等着在上面摆东西，而它是「未生成」）。
    structNote.value = r.blank
      ? `插好了：新的第 ${r.page} 页「${insTitle.value.trim()}」是一张空画布` +
        (r.shifted ? `，后面 ${r.shifted} 页的页码往后挪了一位` : '') +
        '。它不走 AI 生成，也不会被「生成剩下的 N 页」碰到 —— 现在它是真的空的，翻到它和「渲染塌了」分不开。'
      : `插好了：新的第 ${r.page} 页「${insTitle.value.trim()}」（还没生成）` +
        (r.shifted ? `，后面 ${r.shifted} 页的页码往后挪了一位` : '') +
        (r.layoutInherited ? `。版式先跟着前一页（${r.layoutId}）—— 在打开的这个框里挑一条，连着两页同一个版式会很单调。` : '。')
    current.value = r.page
    const fresh = pages.value.find(p => p.page === r.page)
    // 找不到就**不要静默跳过**：那说明重读回来的规划和服务端说的页码对不上（他会以为
    // 版式已经挑好了，而这一页用的是继承来的那条）。
    // 空白页**不开那个框**：它压根没有「生成」这一步，开了的话他会在里面按「生成这一页」
    // （服务端会拦，但那一刻他已经以为空白页也要花一次调用才出得来）。
    if (r.blank) {
      view.value = 'page'
    } else if (fresh) {
      await openSetup(fresh)
      // openSetup 会先清掉，所以这一句必须写在它之后
      if (r.layoutInherited) insertedHint.value = {
        page: r.page,
        text: `这一页的版式先跟着前一页（${r.layoutId}）—— 在下面挑一条再生成，连着两页同一个版式翻起来很单调。`,
      }
    } else {
      structErr.value = true
      structNote.value = `插好了，但重新读回来的规划里没有第 ${r.page} 页 —— 刷新一下再看，这一页的版式还是跟着前一页的那条（${r.layoutId}），生成前记得挑。`
    }
  } catch (e: any) {
    structErr.value = true
    structNote.value = `没插进去：${e?.message || '请求失败'}（库里还是原来那样，页码没动）`
  }
  structBusy.value = false
}

async function run() {
  // 规划前必须先把提纲存进去（他常常是改完提纲直接点规划，没失焦过）：服务端规划用的是
  // **库里那一份**，存不上就直接不跑 —— 照跑的话花掉的这次调用规划的是上一版提纲，
  // 而结果看起来完全正常（页数和标题都像那么回事）。
  if (!(await saveMeta())) {
    error.value = '提纲没保存上，这次没规划（规划用的是存进库里的那份提纲，不先存就会规划成上一版）。上面那行写了失败原因。'
    return
  }
  running.value = true
  error.value = ''
  try {
    const data = await apiPost<{
      pages: PlannedPage[]; problems: string[]
      clearedPages?: number
      clearedImages?: number
      clearedNotes?: number
      planRev?: number
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }>(`/api/ppt/decks/${deckId.value}/plan`, {})
    pages.value = data.pages || []
    // 重新规划也会让页序版本号 +1（旧页全清了）。**必须跟上**：不跟的话规划完点第一次生成
    // 就是一句 409，而他刚刚才在这里成功规划过（读起来像这个按钮坏了）。
    if (data.planRev !== undefined) planRev.value = data.planRev
    usage.value = data.usage || null
    // 规划成功之后提纲折回去（他刚才可能是展开改了一段才重新规划的）。
    outlineOpen.value = false
    // 规划完把工作台落回第一页（旧的选中页可能压根不在这份规划里了）。
    view.value = 'page'
    current.value = 0
    selectFirst()
    showSettings.value = false
    // 重新规划把库里那几页全清了（服务端 savePlan 一起做的），所以按页码索引的本地状态
    // 一个都不能留：新规划的第 3 页和旧的第 3 页压根不是一页内容，留下来的画面/备图/额外要求
    // 会挂在同一个页码下面，看起来像刚生成的。**和删页走同一个清空函数** —— 各写一份清单的话，
    // 以后新加一个按页码索引的 map 只会被清在一处，而漏掉的那一处是「翻起来完全正常」。
    resetPageState()
    // 库里那几页也被这次规划清掉了（服务端 savePlan 一起做的）。清了几页、扔了几张备好的图
    // 都要说出来 —— 那全是已经花掉的调用，只说「规划完成」的话他不知道自己刚扔掉了什么。
    batchNote.value = [
      data.clearedPages
        ? `这次重新规划把之前生成好的 ${data.clearedPages} 页删掉了（版式和内容都换了，留着会对不上），它们要重新生成。`
        : '',
      data.clearedImages
        ? `另外扔掉了 ${data.clearedImages} 张备好的图 —— 图本身还在素材库里（/ppt/assets），可以直接挑回来，不用重新生成。`
        : '',
      data.clearedNotes
        ? `你在 ${data.clearedNotes} 页上写的额外要求（版式/语气那些）也跟着清掉了 —— 不重新写的话，接下来生成的是不带这些要求的那一版。`
        : '',
    ].filter(Boolean).join('')
    // 拼好的整份同理：它对应的是上一份规划的页，翻起来看不出任何异常。
    deckHtml.value = ''
    deckErr.value = ''
    exportNote.value = ''
    exportWarnings.value = []
    exportErr.value = ''
    pptxNote.value = ''
    pptxWarnings.value = []
  } catch (e: any) {
    error.value = errText(e, '排版规划失败', '今天的 AI 额度用完了，这份提纲没拆页（下面还是上一次的结果）。')
    // 上一次的结果留在页面上：清掉的话失败之后是一片空白，读起来像「这份提纲拆不出页」。
  }
  running.value = false
}
</script>

<style scoped>
/* 和 /consult 那几页同一套（深色玻璃卡 + 品牌黄）：两个模块各写一套的话，
   同一个平台上点进去像两个产品。布局是「顶栏 + 左缩略图菜单 + 右当前页」。 */
.wb {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --color-soft: rgba(255, 255, 255, 0.6);
  --bg-color: #12182B;

  /* 一屏装完：整页**不滚**，只有左边那条缩略图、右边详情栏和弹窗内部会滚。
     页面能滚的话滚下去顶栏那几个按钮（生成 / 配图 / 导出）和左边那条就全看不见了，
     而每一页都是一次真实调用 —— 「刚才那一页生成了没有」得滚回去认。
     动态高度用 dvh：手机上 100vh 会被地址栏吃掉一截，底下那行按钮永远点不到。 */
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg-color);
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.bg-elements {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover; background-position: center;
}
.bg-overlay {
  position: absolute; inset: 0; background: rgba(18, 24, 43, 0.72);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
}

/* ── 顶栏：钉在屏幕最上面（页面不滚，所以它天然不会走掉）───── */
.topbar {
  position: relative; z-index: 2; flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  padding: 12px 24px; flex-wrap: wrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
}
.tb-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.tb-title { min-width: 0; }
.btn-back-icon {
  width: 40px; height: 40px; flex: none; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05); color: var(--text-primary);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-back-icon:hover { background: var(--brand-yellow); color: #000; }
/* 名字就地改（失焦即存）：做成看起来像标题的输入框而不是「编辑」按钮 ——
   两段式的话他改完不点保存就走了，而界面上那行已经是新名字。 */
.title-input {
  font: inherit; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;
  color: var(--text-primary); background: transparent;
  border: 1px solid transparent; border-radius: 8px;
  padding: 2px 8px; margin-left: -8px; width: min(420px, 60vw); outline: none;
}
.title-input:hover { border-color: rgba(255, 255, 255, 0.16); }
.title-input:focus { border-color: var(--brand-yellow); background: rgba(0, 0, 0, 0.3); }
.tb-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 11px; color: var(--color-soft); margin-top: 2px; padding-left: 1px;
}
.tb-meta.bad { color: #FCA5A5; }
.tb-meta .sep { opacity: .4; }

.tb-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
/* 主按钮在这一排里不能换行（「生成剩下的 12 页」断成两行看起来像坏了） */
.tb-actions .btn-primary { white-space: nowrap; }
.btn-ghost {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: var(--text-secondary);
  padding: 9px 16px; border-radius: 999px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap; text-decoration: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-ghost:hover:not(:disabled) { color: #fff; background: rgba(255, 255, 255, 0.16); transform: scale(0.98); }
.btn-ghost:disabled { opacity: .4; cursor: not-allowed; }
.btn-ghost.warn { background: rgba(252, 165, 165, 0.1); color: #FCA5A5; }
.btn-ghost.sm { padding: 6px 12px; font-size: 12px; }
.btn-primary {
  background: var(--brand-yellow); color: #111;
  padding: 11px 22px; border: none; border-radius: 999px;
  font-family: var(--font-sans); font-size: 14px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-primary:hover:not(:disabled) { transform: scale(0.98); background: var(--brand-yellow-hover); box-shadow: 0 2px 8px rgba(255, 184, 0, 0.1); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── 横幅：错误 / 提示一律留在顶部，不塞进那一页里面 ──
   它占多少地方就从画面那块里让出多少（画面是按剩下的空间缩放的），所以横幅永远不会
   把内容顶出屏幕。堆到七八条时这一块自己滚 —— 截掉后面几条的话，「导出的文件里图是
   破的」那种话就消失了，而界面上一切正常。 */
.banners {
  position: relative; z-index: 1; flex: none;
  max-height: 26vh; overflow-y: auto;
  padding: 10px 24px 0; display: flex; flex-direction: column; gap: 8px;
}
.banner {
  margin: 0; padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.7;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-secondary);
}
.banner.bad { background: rgba(254, 242, 242, 0.1); border-color: rgba(252, 165, 165, 0.3); color: #FCA5A5; }
.banner.warn { background: rgba(255, 251, 235, 0.1); border-color: rgba(253, 230, 138, 0.35); color: #FDE68A; }
.banner ul { margin: 6px 0 0; padding-left: 18px; }
.banner a { color: var(--brand-yellow); }
/* 服务端那几条警告里逐行带原文，挤成一段的话那几行读不出来，他就不会去核 */
.banner.pre { white-space: pre-line; }
.banner .why { color: var(--color-soft); font-style: normal; }
.banner .why::before { content: '　它说：'; }

/* ── 提纲整理那一行 ── */
.clean-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* ── 主体：左缩略图 + 画面撑满剩下的空间，详情浮在右侧滑进滑出 ── */
.wb-body {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: grid; grid-template-columns: 264px minmax(0, 1fr);
  gap: 16px; padding: 12px 24px 16px; align-items: stretch;
  --ins-w: 380px;
}

.rail {
  height: 100%; min-height: 0;
  display: flex; flex-direction: column;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px; overflow: hidden;
}
.rail-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; font-size: 13px; font-weight: 700;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.rail-head em { font-style: normal; font-family: var(--font-mono); font-size: 11px; color: var(--color-soft); }
.rail-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }

/* 分屏条。屏号上那个红点（.bad）不能只靠颜色深浅——出错的那一屏必须一眼看出来。 */
.rail-pager {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.rail-pager em {
  font-style: normal; margin-left: auto;
  font-family: var(--font-mono); font-size: 11px; color: var(--color-soft);
}
.rp-arrow, .rp-num {
  min-width: 24px; height: 24px; padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 7px;
  background: transparent; color: var(--color-text);
  font-size: 12px; font-family: var(--font-mono); cursor: pointer;
}
.rp-arrow:disabled { opacity: .3; cursor: default; }
.rp-num.on { background: rgba(255, 255, 255, 0.16); font-weight: 700; }
.rp-num.bad { position: relative; }
.rp-num.bad::after {
  content: ''; position: absolute; top: -2px; right: -2px;
  width: 6px; height: 6px; border-radius: 50%; background: #ff5f56;
}

.slide-item {
  display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 8px; border-radius: 12px; cursor: pointer;
  background: rgba(0, 0, 0, 0.2); border: 1px solid transparent;
  color: var(--text-secondary); font-family: var(--font-sans);
  transition: all 0.2s;
}
.slide-item:hover { border-color: rgba(255, 255, 255, 0.2); }
.slide-item.on { border-color: var(--brand-yellow); background: rgba(255, 184, 0, 0.1); color: #fff; }
.si-no { flex: none; width: 18px; font-family: var(--font-mono); font-size: 12px; color: var(--color-soft); text-align: center; }
.slide-item.on .si-no { color: var(--brand-yellow); }
.si-thumb {
  position: relative; flex: none; width: 96px; aspect-ratio: 16 / 9;
  border-radius: 6px; overflow: hidden; background: #0b1020;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
/* iframe 里不要再叠 transform: scale()——deck 自己的 fit() 已按视口缩放，缩两遍就是
   贴在左上角的一小块；pointer-events:none 是因为 deck 在 document 上挂了「点一下翻页」，
   不掐掉的话点缩略图不切页，界面毫无反应。 */
.si-thumb iframe { width: 100%; height: 100%; border: 0; pointer-events: none; }
.slide-item.blank .si-thumb iframe { opacity: .35; filter: grayscale(1); }
.si-ghost {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-style: normal; font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px;
  background: rgba(11, 16, 32, 0.55); color: rgba(255, 255, 255, 0.8);
}
.si-text { min-width: 0; flex: 1; }
.si-text b { display: block; font-size: 12px; font-weight: 700; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.si-tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.tag {
  font-style: normal; font-family: var(--font-mono); font-size: 9px; font-weight: 700;
  padding: 2px 5px; border-radius: 4px;
  background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.75);
}
.tag.ok { background: #DCFCE7; color: #166534; }
.tag.warn { background: #FEF3C7; color: #92400E; }
.tag.bad { background: #FEE2E2; color: #991B1B; }
.deck-item .si-no { color: var(--brand-yellow); }

/* ── 舞台：标题一行 + 画面吃掉剩下的全部高度 ─────────── */
.stage { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; overflow: hidden; }
.stage-head {
  flex: none;
  display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap;
}
.sh-left { min-width: 0; }
.kicker { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.16em; color: var(--brand-yellow); }
.stage-head h2 { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 4px; }
.stage-tags { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 11px; color: var(--color-soft); }
.stage-tags a { color: var(--brand-yellow); text-decoration: none; }
.stage-acts { display: flex; gap: 10px; flex-wrap: wrap; }

/* 画面的尺寸由**剩下的那块地方**算出来：16:9 在宽高两边都撑到最大的那个尺寸，
   然后水平垂直居中（`container-type: size` + `cq` 单位 = 浏览器自己按容器实时算，
   不用 JS 量一遍 —— JS 那版少接一个 resize/字体加载的时机就会停在旧尺寸上，
   画面要么溢出被裁、要么小一块，而两种看起来都像「预览就是这么显示的」）。
   `width: 100%` 那行是给不认 cq 单位的老浏览器兜的底。 */
.screen-wrap {
  flex: 1; min-height: 0; min-width: 0;
  display: grid; place-items: center;
  container-type: size;
}
.screen {
  position: relative; aspect-ratio: 16 / 9;
  width: 100%;
  width: min(100cqw, calc(100cqh * 16 / 9));
  max-width: 100%; max-height: 100%;
  background: #0b1020; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.screen iframe { width: 100%; height: 100%; border: 0; display: block; }
.screen iframe.faded { opacity: .28; filter: grayscale(0.6); pointer-events: none; }
/* 画面底下那一条（编辑入口说明 + AI 编辑那一栏）。**高度预留死**：选中一块字的时候这里会多出
   一行读数和一整栏输入框，而 `.screen` 的宽高是按 `.screen-wrap` 剩下的高度算的 ——
   不预留的话「点第一下」就把画面缩一圈，双击的第二下于是落到别的元素上（现象：双击改不动
   文字，而屏幕上一切正常）。用 min-height 不用 height：存失败那种长句要能撑开，
   截掉的话报错只剩半句。 */
.stage-foot { flex: 0 0 auto; min-height: 92px; }
/* 存失败那一句浮在画面底部（`SHOW_EDIT_DOCK` 关掉时它是唯一的出口）。`pointer-events:none`：
   盖在画面上的话那一片区域双击不到，而他要改的正是刚才没存上的那句字。 */
.edit-flash {
  position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 5; pointer-events: none;
  padding: 8px 14px; border-radius: 10px; text-align: center;
  background: rgba(11, 16, 32, 0.9); border: 1px solid rgba(255, 180, 180, 0.5);
  font-size: 12px; line-height: 1.6; color: #ffb4b4;
}
.edit-tip {
  margin: 8px 0 0; flex: 0 0 auto; text-align: center;
  font-size: 12px; line-height: 1.7; color: var(--text-secondary);
}
.edit-tip b { color: var(--brand-yellow); }
.edit-tip.bad { color: #ffb4b4; }
.edit-tip .bad { color: #ffb4b4; }
/* AI 编辑那一栏在画面下面、和那行说明同一列（不放右边抽屉里：抽屉是收起来的，
   而这一栏每次点都花一次额度，报错必须一直在他眼前）。 */
.ai-edit {
  margin: 8px auto 0; flex: 0 0 auto;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;
  max-width: 100%;
}
.ai-wish {
  font: inherit; font-size: 12px; color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px; padding: 7px 14px; width: min(420px, 46vw); outline: none;
}
.ai-wish:focus { border-color: var(--brand-yellow); }
.btn-ai {
  background: var(--brand-yellow); color: #111; border: none; border-radius: 999px;
  padding: 7px 14px; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap;
}
.btn-ai:disabled { opacity: .45; cursor: not-allowed; }
/* 自由改造那颗按钮做成描边款：和「微调」长得一样的话他会随手点到放开了删原文/新写文案的那一条。 */
.btn-ai.ghost {
  background: transparent; color: var(--brand-yellow);
  border: 1px solid var(--brand-yellow); padding: 6px 13px;
}
.ai-msg { font-size: 12px; color: var(--text-secondary); max-width: min(560px, 92%); }
.ai-msg.bad { color: #ffb4b4; }
.ai-msg.ok { color: var(--brand-yellow); }
.ai-msg b { color: var(--brand-yellow); font-weight: 800; }
/* 占满一行（不跟着摘要挤在同一行）：这几条是「AI 替你动了什么」，挤成一行他会当装饰略过。 */
.ai-notes {
  flex: 0 0 100%; margin: 2px 0 0; padding-left: 18px; text-align: left;
  max-width: min(700px, 96%); margin-inline: auto;
  font-size: 12px; line-height: 1.6; color: var(--text-secondary);
}
.ai-notes li { margin: 2px 0; }
.screen-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 24px;
}
.screen-overlay.solid { background: rgba(11, 16, 32, 0.6); }
/* 生成中那层要盖住旧画面（半透明就够，让他知道底下那张还在，只是不是这次的结果） */
.screen-overlay.busy { background: rgba(11, 16, 32, 0.82); backdrop-filter: blur(3px); }
.screen-overlay b { font-size: 18px; }
.screen-overlay p { margin: 0; max-width: 520px; font-size: 13px; line-height: 1.8; color: var(--text-secondary); }
.screen-overlay p b { font-size: inherit; color: var(--brand-yellow); }

.stage-empty {
  margin: auto; max-width: 720px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  padding: 48px 24px; text-align: center;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px; backdrop-filter: blur(20px);
}
.stage-empty b { font-size: 20px; }
.stage-empty p { margin: 0; max-width: 560px; font-size: 14px; line-height: 1.8; color: var(--text-secondary); }
.stage-empty a { color: var(--brand-yellow); }
.ios-loading-bar {
  width: 200px; height: 4px; background: rgba(255, 255, 255, 0.08);
  border-radius: 4px; overflow: hidden; position: relative;
}
.ios-loading-fill {
  position: absolute; top: 0; left: 0; bottom: 0; width: 50%;
  background: var(--brand-yellow); border-radius: 4px;
  animation: ios-progress 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  transform-origin: left center;
}
@keyframes ios-progress {
  0% { transform: translateX(-100%) scaleX(0.2); }
  50% { transform: translateX(50%) scaleX(1); }
  100% { transform: translateX(200%) scaleX(0.2); }
}

/* ── 这一页的信息（右栏，撑满高度；装不下时**这一栏自己滚**，绝不收起来）── */
/* ── 详情：浮在画面右侧的抽屉，把手一直露在外面 ──
   整块（把手 + 面板）一起平移，只平移面板宽度 —— 把手因此永远留在视口里。
   `.wb` 是 overflow:hidden，收起时滑出去那部分被裁掉，不会撑出横向滚动条。 */
.ins-dock {
  position: absolute; top: 12px; right: 12px; bottom: 16px; z-index: 3;
  display: flex; align-items: stretch;
  transform: translateX(var(--ins-w));
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.ins-dock.open { transform: translateX(0); }
/* 把手是收起状态下唯一的入口，也是唯一还在报「这一页有几处不对」的地方 ——
   所以它不能是一条灰缝：亮底、白字、够宽（点得到），有问题时整块转红。 */
.ins-handle {
  align-self: center; flex: none; width: 44px; min-height: 168px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 18px 0; cursor: pointer;
  background: rgba(38, 41, 54, 0.94); border: 1px solid rgba(255, 255, 255, 0.24);
  border-right: none; border-radius: 14px 0 0 14px;
  box-shadow: -10px 0 28px rgba(0, 0, 0, 0.38);
  color: #fff; font-family: var(--font-sans); font-size: 13px; font-weight: 700;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.ins-handle:hover { background: rgba(56, 60, 78, 0.96); border-color: var(--brand-yellow); color: var(--brand-yellow); }
.ins-handle.alarm {
  background: rgba(120, 34, 34, 0.92); border-color: #FCA5A5; color: #FFE4E4;
}
.ins-handle.alarm:hover { background: rgba(150, 44, 44, 0.95); border-color: #FCA5A5; color: #fff; }
.ih-txt { writing-mode: vertical-rl; letter-spacing: 0.18em; }
.ih-arrow { font-size: 15px; font-weight: 800; opacity: .8; }
.ih-badge {
  min-width: 22px; padding: 3px 5px; border-radius: 11px;
  background: #FCA5A5; color: #3B0A0A; font-size: 12px; font-weight: 800; text-align: center;
}

.inspector {
  width: var(--ins-w); flex: none;
  height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  background: rgba(20, 22, 30, 0.6);
  display: flex; flex-direction: column; gap: 12px;
  border-radius: 16px; padding: 14px;
  backdrop-filter: blur(32px); -webkit-backdrop-filter: blur(32px);
  box-shadow: -18px 0 48px rgba(0, 0, 0, 0.4);
}
/* 右栏只有 300-360px，两列会挤成两条 140px 的柱子（备图那三个按钮直接换行成六行）。 */
.veil-row { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.veil-val { font-size: 13px; font-weight: 700; color: var(--brand-yellow); }
.veil-range { width: 100%; accent-color: var(--brand-yellow); cursor: pointer; }
.veil-range:disabled { opacity: .5; cursor: default; }
.ins-cols { display: flex; flex-direction: column; gap: 16px; }
.ins-col { min-width: 0; }
.ins-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary); margin-bottom: 10px; }
.ins-h.muted { color: var(--color-soft); font-weight: 400; }
.ins-h.mt { margin-top: 18px; }
/* 本页内容：换行照原文（提纲的层级全在换行和缩进里，挤成一段就核不动了） */
.page-outline {
  margin: 0; padding: 10px 12px; max-height: 34vh; overflow: auto;
  background: rgba(0, 0, 0, 0.22); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
  font-family: inherit; font-size: 12px; line-height: 1.9; color: var(--color-soft);
  white-space: pre-wrap; word-break: break-word;
}
.why { font-size: 13px; line-height: 1.8; color: var(--text-secondary); margin: 0; }
.why.missing { color: #FDE68A; }
.points { margin: 8px 0 0; padding-left: 18px; }
.points li { font-size: 12px; line-height: 1.9; color: var(--color-soft); }
.plan-imgs { margin-bottom: 14px; }
.plan-imgs ul { margin: 0; padding-left: 16px; }
.plan-imgs li { font-family: var(--font-mono); font-size: 11px; line-height: 1.9; color: var(--color-soft); word-break: break-word; }
.muted-note { font-size: 12px; line-height: 1.7; color: var(--text-secondary); margin: 0 0 16px 0; padding-left: 10px; border-left: 3px solid var(--brand-yellow); }
/* 逐格备图：缩略图 + 规格 + 三个按钮。缩略图必须显示出来 —— 只写「已备好」的话，
   挑错了一张（另一套画风/另一个内容）在界面上完全看不出来。 */
.spec-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.spec-list li {
  display: flex; flex-direction: column; gap: 12px; padding: 12px 16px;
  border-radius: 12px; background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}
.spec-top { display: flex; gap: 16px; align-items: center; }
.spec-thumb {
  flex: 0 0 auto; width: 80px; height: 56px; border-radius: 8px; overflow: hidden;
  background: rgba(0, 0, 0, 0.2); display: flex; align-items: center; justify-content: center;
}
.spec-thumb img { width: 100%; height: 100%; object-fit: cover; }
.spec-thumb.empty { font-size: 12px; color: rgba(255, 255, 255, 0.3); font-weight: 500; }
.spec-txt { width: 100%; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: rgba(255, 255, 255, 0.85); word-break: break-word; }
.spec-meta { color: rgba(255, 255, 255, 0.4); margin-top: 4px; font-size: 11px; }
.spec-meta em { font-style: normal; color: var(--brand-yellow); }
.spec-acts { flex: 1; display: flex; flex-wrap: wrap; gap: 8px; }

/* 生成前那个对话框里的逐格图（提示词可改）。缩略图比右栏那份大一点：他在这里要判断
   「这张能不能用」，44px 高的那种只看得出有没有图。 */
.prep-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
.prep-list li {
  display: flex; gap: 16px; align-items: flex-start; padding: 16px;
  border-radius: 16px; background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}
.prep-list .spec-thumb { width: 120px; height: 80px; border-radius: 10px; }
.prep-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.prep-meta { font-size: 12px; color: rgba(255, 255, 255, 0.5); }
.prep-meta em { font-style: normal; color: #FDE68A; margin-left: 8px; }
.prep-main textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  font-family: var(--font-sans); font-size: 13px; line-height: 1.7; resize: vertical;
}
.prep-main textarea:focus { outline: none; border-color: var(--brand-yellow); box-shadow: 0 0 0 3px rgba(255, 184, 0, 0.1); }
.prep-acts { display: flex; flex-wrap: wrap; gap: 8px; }

/* 素材库挑图 */
.picker {
  margin: auto; width: min(880px, 92vw); max-height: 86vh; overflow-y: auto;
  padding: 24px; box-sizing: border-box; border-radius: 20px;
  background: rgba(18, 24, 43, 0.7);
  backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  display: flex; flex-direction: column; gap: 16px;
}
/* 版式缩略图。iframe 要 pointer-events:none：demo deck 自己在 document 上挂了
   「点一下翻页」，不掐掉的话点缩略图选不中这一条（点击被 iframe 吃掉，毫无反应）。
   也不要再叠 transform: scale()——deck 自己的 fit() 已按 iframe 视口缩放。 */
.lay-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.lay {
  padding: 0; text-align: left; border-radius: 12px; overflow: hidden; cursor: pointer;
  background: rgba(255, 255, 255, 0.04); border: 2px solid transparent;
  display: flex; flex-direction: column; transition: border-color 0.15s, background 0.2s;
}
.lay:hover { background: rgba(255, 255, 255, 0.1); }
.lay.on { border-color: var(--brand-yellow); background: rgba(255, 184, 0, 0.1); }
.lay.off { opacity: 0.6; }
.lay-thumb { display: block; aspect-ratio: 16 / 9; background: #fff; overflow: hidden; }
.lay-thumb iframe { width: 100%; height: 100%; border: 0; pointer-events: none; display: block; }
.lay-cap { display: block; padding: 6px 8px 0; font-size: 11px; line-height: 1.5; color: var(--color-soft); }
.lay-cap b { font-family: var(--font-mono); color: #fff; margin-right: 4px; }
.lay-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px 8px; }
.lay-tags em {
  font-style: normal; font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.55);
}
.lay-tags em.plan { background: rgba(255, 184, 0, 0.2); color: #FDE68A; }
.lay-tags em.alt { background: rgba(165, 180, 252, 0.18); color: #C7D2FE; }
.lay-tags em.dis { background: rgba(252, 165, 165, 0.18); color: #FCA5A5; }

/* 标题 + tab 一起 sticky 在抽屉顶上。**`flex: none` 是承重的**：`.picker` 是被
   `max-height: 86vh` 压着的 column flex，图网格一高，默认的 flex-shrink 会把这一条压成
   几个像素高的一道线 —— tab 全在里面但一个都看不见，而计数行照旧写着「见上面的『全部』」。 */
.pick-top {
  flex: none; position: sticky; top: 0; z-index: 3;
  margin: -24px -24px 0; padding: 24px 24px 10px;
  background: rgba(18, 24, 43, 0.94);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; flex-direction: column; gap: 12px;
}
.head-btns { display: flex; gap: 8px; flex: none; }
/* tab 条横向可滚（十几份稿子时换行会把图网格顶到抽屉外，那时看起来像图没加载出来）。 */
.pick-tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; flex: none; }
/* 同一个理由：抽屉里的说明/报错这几行也不能被图网格压扁（压扁之后是几行叠在一起的字）。 */
.picker > p { flex: none; }
.ptab {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  max-width: 220px; padding: 6px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-soft); font-size: 12px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.2s;
}
.ptab:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.3); }
.ptab:disabled { opacity: 0.5; cursor: default; }
.ptab.on { background: var(--brand-yellow); border-color: var(--brand-yellow); color: #12182B; }
.ptab.gone { font-style: italic; }
.ptab em { font-family: var(--font-mono); font-style: normal; font-size: 10px; opacity: 0.7; }

.pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.pick-cell {
  padding: 0; border-radius: 12px; overflow: hidden;
  background: rgba(255, 255, 255, 0.04); cursor: pointer; display: flex; flex-direction: column;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s;
}
.pick-cell:hover { background: rgba(255, 255, 255, 0.1); transform: scale(0.98); }
.pick-cell img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
.pick-meta { padding: 4px 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-soft); }
/* 刚上传的那一张。一屏一百多张时「最前面那张」并不显眼，找不到就等于没传上去。 */
.pick-cell.fresh { outline: 2px solid var(--brand-yellow); outline-offset: 1px; }
/* 上传按钮是个 label（里面藏着 file input）—— 按钮上没有 pointer 的话它看起来不能点。 */
.up-btn { cursor: pointer; }
.up-btn input { display: none; }
.up-btn.off { opacity: 0.55; cursor: default; }

.imgs ul { margin: 0; padding-left: 16px; }
.imgs li { font-family: var(--font-mono); font-size: 11px; line-height: 1.9; color: var(--color-soft); word-break: break-all; }
.imgs li.bad, .imgs .bad { color: #FCA5A5; }
.imgs a { color: var(--brand-yellow); }
.imgs em { font-style: normal; color: rgba(255, 255, 255, 0.45); }
.stylechip { font-family: var(--font-mono); font-size: 10px; font-weight: 400; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.12); color: var(--color-soft); }
.quota { font-family: var(--font-mono); font-size: 10px; color: #FCA5A5; }

.problems {
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255, 251, 235, 0.08); border: 1px solid rgba(253, 230, 138, 0.3);
}
.problems-title { font-size: 12px; font-weight: 700; color: #FDE68A; margin-bottom: 4px; }
.problems ul { margin: 0; padding-left: 18px; }
/* pre-line：覆盖率那一条是「一行一段漏掉的提纲原文」，塌成一行之后二十段挤成一坨，
   他找不到自己那一段在哪儿，于是整条警告被当成噪音划过去 */
.problems li { font-size: 12px; line-height: 1.8; color: #FDE68A; white-space: pre-line; }

.src-box { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.src {
  width: 100%; box-sizing: border-box; max-height: 320px; overflow: auto; margin: 0;
  padding: 12px 14px; border-radius: 10px; background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: var(--font-mono); font-size: 11px; line-height: 1.7; color: #A5B4FC;
  white-space: pre-wrap; word-break: break-all;
}

/* ── 提纲与设置抽屉 ───────────────────────────── */
.drawer-mask {
  position: fixed; inset: 0; z-index: 10;
  background: rgba(8, 11, 20, 0.6); backdrop-filter: blur(4px);
  display: flex; justify-content: flex-end;
}
.drawer {
  width: min(560px, 100vw); height: 100%; overflow-y: auto;
  padding: 24px; box-sizing: border-box;
  background: rgba(18, 24, 43, 0.96); border-left: 1px solid rgba(255, 255, 255, 0.12);
  display: flex; flex-direction: column; gap: 16px;
}
.dr-head { display: flex; justify-content: space-between; align-items: center; }
.dr-head b { font-size: 18px; font-weight: 800; }
.dr-note { margin: 0; font-size: 12px; line-height: 1.8; color: var(--color-soft); }
.dr-note.bad { color: #FCA5A5; }
.field { display: block; }
.field.small { flex: 1; min-width: 150px; }
/* 折起来的提纲：一行字 + 一个「查看 / 修改」。 */
.outline-fold {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 8px;
  background: rgba(255, 255, 255, .03); font-size: 13px; color: var(--color-soft);
}
.label .fold { font-size: 12px; font-weight: 400; padding: 0 6px; }
.row-fields { display: flex; gap: 12px; flex-wrap: wrap; }
.label { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.label em { font-style: normal; font-family: var(--font-mono); font-weight: 400; color: var(--color-soft); }
.label em.over { color: #FCA5A5; }
.field input, .field textarea, .field select {
  width: 100%; box-sizing: border-box; padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px;
  background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  font-family: var(--font-sans); font-size: 14px; line-height: 1.8; resize: vertical;
  transition: all 0.2s;
}
.field select option { color: #111; }
/* 提纲原文那个框：小一号 + 等宽，一眼能看出这是「粘进来的原始文字」而不是要他重写的输入。 */
.field textarea.mono { font-family: var(--font-mono); font-size: 13px; line-height: 1.7; }
.field input::placeholder, .field textarea::placeholder { color: rgba(255, 255, 255, 0.3); }
.field input:focus, .field textarea:focus, .field select:focus {
  outline: none; border-color: var(--brand-yellow); box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.1);
}
.field input:disabled, .field textarea:disabled { opacity: .6; }
.dr-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.muted { font-size: 12px; line-height: 1.7; color: var(--color-soft); flex: 1; min-width: 220px; }
.muted b { color: #FDE68A; }
.muted.link { color: var(--brand-yellow); text-decoration: none; flex: none; }
/* 不写这条的话 `<a>` 用的是浏览器默认色：深底上是紫蓝的一小段，点过之后更暗，
   看起来像坏了 —— 而它是「这个版式长什么样」唯一的入口。 */
.muted a { color: var(--brand-yellow); text-decoration: none; border-bottom: 1px solid rgba(255, 184, 0, 0.35); }
.muted a:hover { color: var(--brand-yellow-hover); border-bottom-color: var(--brand-yellow); }

/* 窄一点的屏（笔记本 1280）：左边那条和浮层都收窄，还是一屏。 */
@media (max-width: 1320px) {
  .wb-body { grid-template-columns: 220px minmax(0, 1fr); gap: 12px; padding: 10px 16px 12px; --ins-w: 330px; }
  .si-thumb { width: 76px; }
}

/* 手机/窄窗：**退回整页可滚**，详情不再是浮层而是接在画面下面（一个 300px 的浮层会
   把整块画面盖掉，而收起它才能看见画面 = 两样只能看一样）。 */
@media (max-width: 1000px) {
  .wb { height: auto; min-height: 100dvh; overflow: visible; }
  .banners { max-height: none; overflow: visible; }
  .wb-body { grid-template-columns: 1fr; align-items: start; }
  .rail { height: auto; max-height: 320px; }
  .rail-list { flex-direction: row; overflow-x: auto; }
  .slide-item { flex: none; width: 210px; }
  .stage { overflow: visible; }
  .screen-wrap { container-type: normal; }
  .screen { width: 100%; max-height: none; }
  .ins-dock { position: static; transform: none; flex-direction: column; }
  .ins-dock:not(.open) .inspector { display: none; }
  .ins-handle { align-self: flex-start; width: auto; flex-direction: row; padding: 8px 14px; border-right: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px; }
  .ih-txt { writing-mode: horizontal-tb; }
  .inspector { width: auto; flex: 1; min-width: 0; height: auto; overflow: visible; box-shadow: none; }
  .topbar { padding: 14px 16px; }
  .banners, .wb-body { padding-left: 16px; padding-right: 16px; }
}
</style>
