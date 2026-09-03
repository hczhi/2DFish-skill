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
            <span class="sep">·</span>
            <span>{{ saveLabel }}</span>
          </div>
        </div>
      </div>

      <div class="tb-actions">
        <button class="btn-ghost" @click="showSettings = true">提纲与设置</button>
        <button class="btn-ghost" :disabled="batchRunning || !pages.length || !pendingCount" @click="runAll">
          {{ batchRunning ? `生成中… 第 ${batchAt} / ${pages.length} 页` : `生成${builtCount ? '剩下的 ' : '全部 '}${pendingCount} 页` }}
        </button>
        <!-- 停止是必需的：一页一次真实调用，看到前两页不对时不给停就是把剩下十几次额度花完。 -->
        <button v-if="batchRunning" class="btn-ghost warn" @click="stopBatch">停止</button>
        <button class="btn-ghost" :disabled="batchRunning || !builtCount || !imgTodo" @click="fillAllImages">
          {{ imgTodo ? `配全部图（差 ${imgTodo} 张）` : '图都配齐了' }}
        </button>
        <button class="btn-ghost" :disabled="batchRunning || exporting || !pages.length || builtCount < pages.length" @click="exportDeck">
          {{ exporting ? '导出中…' : '导出 .html' }}
        </button>
      </div>
    </header>

    <!-- 打不开这份稿子（换了账号 / 已删掉 / id 抄错）必须说清并给一条回列表的路：
         只留一个空工作台的话，读起来像「这份稿子里什么都没有」，他会当场重打一遍提纲。 -->
    <div class="banners">
      <p v-if="loadErr" class="banner bad">{{ loadErr }} <router-link to="/ppt/decks">回演示稿列表</router-link></p>
      <p v-if="error" class="banner bad">{{ error }}</p>
      <p v-if="metaErr" class="banner bad">{{ metaErr }}</p>
      <p v-if="batchNote" class="banner">{{ batchNote }}</p>
      <!-- 换画风之后已经配好的那几页**不会自动重做**：不说的话整份翻下来笔触不统一，
           而每张图单看都好、没有一处报错。 -->
      <p v-if="styleMismatch" class="banner warn">{{ styleMismatch }}</p>
      <p v-if="deckErr" class="banner bad">{{ deckErr }}</p>
      <p v-if="exportErr" class="banner bad">{{ exportErr }}</p>
      <!-- 导出的那份文件依赖什么必须写在界面上：那几句话是唯一能解释「转给同事打开图全是
           破的」的地方，而下载下来的文件本身打开一片正常。 -->
      <div v-if="exportNote" class="banner">
        <b>{{ exportNote }}</b>
        <ul v-if="exportWarnings.length"><li v-for="(w, i) in exportWarnings" :key="i">{{ w }}</li></ul>
      </div>
    </div>

    <div class="wb-body">
      <aside class="rail">
        <div class="rail-head">
          页面
          <em v-if="pages.length">{{ builtCount }} / {{ pages.length }}</em>
        </div>
        <div class="rail-list">
          <!-- 缩略图：生成过的放那一页真的预览（服务端拼的 previewHtml），没生成的放这个版式的
               效果 demo 并盖一层「未生成」—— 不盖的话 demo 看起来就像这一页已经排好了，
               他会直接去拼整份，而拼整份会 400 说缺页。 -->
          <button
            v-for="p in pages"
            :key="p.page"
            class="slide-item"
            :class="{ on: view === 'page' && current === p.page, blank: !built[p.page] }"
            @click="selectPage(p.page)"
          >
            <span class="si-no">{{ p.page }}</span>
            <span class="si-thumb">
              <iframe v-if="built[p.page]" :srcdoc="built[p.page].previewHtml" scrolling="no" :title="`第 ${p.page} 页`"></iframe>
              <iframe v-else :src="p.demoUrl" loading="lazy" scrolling="no" :title="`${p.layoutId} 效果 demo`"></iframe>
              <em v-if="busy[p.page]" class="si-ghost">生成中…</em>
              <em v-else-if="!built[p.page]" class="si-ghost">未生成</em>
            </span>
            <span class="si-text">
              <b>{{ p.title || '(这一页没标题)' }}</b>
              <span class="si-tags">
                <!-- 换过版式的显示**换成的那条**（还写规划那条的话，缩略图上这一页的版式
                     和真的用的那条不一样，两边都是一页正常的幻灯片，看不出来）。 -->
                <i class="tag" :class="{ warn: setupLayout[p.page] }">{{ setupLayout[p.page] || p.layoutId }}</i>
                <i v-if="setupNotes[p.page]" class="tag" :title="setupNotes[p.page]">要求</i>
                <i v-if="built[p.page] && slotCount(p.page)" class="tag" :class="filledCount(p.page) >= slotCount(p.page) ? 'ok' : 'warn'">
                  图 {{ filledCount(p.page) }}/{{ slotCount(p.page) }}
                </i>
                <i v-else-if="p.images" class="tag">图 {{ p.images }}</i>
                <!-- 备好的图也要在这条上：只在当前页的详情里显示的话，「哪几页已经备过图了」
                     得逐页点开才看得出来，而每一张都是花过钱的。 -->
                <i v-if="pending[p.page]?.length" class="tag">备 {{ pending[p.page].length }}</i>
                <i v-if="pageErr[p.page] || imgErr[p.page] || prepErr[p.page]" class="tag bad">出错</i>
                <i v-else-if="built[p.page]?.problems.length" class="tag warn">{{ built[p.page].problems.length }} 处</i>
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
            打开「提纲与设置」贴一份提纲再点规划 —— 规划会把提纲拆成逐页，并从<router-link to="/ppt/layouts">案例库那 22 个版式</router-link>里给每页挑一个。
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
              <div class="stage-tags">
                <a :href="cur.demoUrl" target="_blank">{{ cur.layoutId }} {{ cur.layoutName }} ↗</a>
                <span>{{ cur.layoutTitle }}</span>
                <span v-if="cur.fullbleed" class="tag">全幅</span>
                <span v-if="cur.images" class="tag">规划要 {{ cur.images }} 张图</span>
                <span v-if="setupLayout[cur.page]" class="tag warn">已换成 {{ setupLayout[cur.page] }}</span>
                <span v-if="setupNotes[cur.page]" class="tag" :title="setupNotes[cur.page]">带额外要求</span>
              </div>
            </div>
            <div class="stage-acts">
              <button class="btn-ghost" :disabled="busy[cur.page] || batchRunning || imgBusy[cur.page]" @click="openSetup(cur)">
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
                    {{ busy[cur.page] ? '生成中…' : '生成这一页（一次真实调用）' }}
                  </button>
                </div>
              </template>
              <!-- 生成/生图期间画面上必须有东西在动，而且要说清「下面这张是上一版」：
                   重新生成一次要 20–60 秒，这期间 iframe 里挂的还是旧那一页 —— 只把顶上
                   按钮的字改成「生成中…」的话，画面读起来就是「已经生成完了、还是这个样子」，
                   他会当成没生效再点一次（每次一次真实调用）。 -->
              <div v-if="busy[cur.page] || imgBusy[cur.page] || aiBusy" class="screen-overlay busy">
                <div class="ios-loading-bar"><div class="ios-loading-fill"></div></div>
                <b>{{ busy[cur.page] ? '正在生成这一页…' : aiBusy ? '正在按你那句话改这一块…' : '正在生成这一页的图…' }}</b>
                <!-- AI 编辑也要盖这一层：不盖的话画面十几秒一动不动（下面挂的是改之前那一版），
                     读起来就是「已经改完了、没什么变化」，他会再点一次 —— 那是再花一次额度。 -->
                <p v-if="aiBusy">一次真实 AI 调用，通常十几秒。下面看到的还是改之前那一版。</p>
                <p v-else-if="busy[cur.page]">
                  一次真实 AI 调用，通常 20–60 秒，回来之后画面会自己换。
                  <b v-if="built[cur.page]">下面看到的还是上一版，不是这次的结果。</b>
                </p>
                <p v-else>一张图几十秒，逐张来；已经生成好的那几张不会重做。</p>
              </div>
            </div>
          </div>
          <!-- 画面底下这一条**高度必须是预留死的**（`.stage-foot` 的 min-height）：`.screen`
               的宽度是 `min(100cqw, 100cqh*16/9)`，也就是说这里长出一行，上面那块 16:9 的画面
               就立刻缩一圈。而这里长出一行的时机正是「他点下第一下」（选中读数 + AI 那一栏
               同时出现）—— 于是双击的第二下落在缩过之后的画面上，点到的是别的元素，
               现象是「双击改不动文字了」，而屏幕上一切正常，没有一处报错。 -->
          <div class="stage-foot">
          <!-- 这一行是「就地改文字」唯一的入口说明：不写的话双击能改这件事没有一处
               看得出来（hover 那圈虚线只有把鼠标放上去才出现）。存失败那句必须留在
               这里而不是只写进右边抽屉 —— 那是收起来的。 -->
          <p v-if="built[cur.page]" class="edit-tip" :class="{ bad: editErr[cur.page] }">
            <template v-if="editErr[cur.page]">{{ editErr[cur.page] }}</template>
            <template v-else-if="editBusy">正在存这段文字…</template>
            <template v-else-if="editNote">{{ editNote }}</template>
            <template v-else-if="canEditText">
              <b>单击选中一句字改颜色/字号/粗细/对齐，双击直接改文字；点字之间的空处（或「⤢ 选大一点」）选中一整块</b>
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
              v-model="aiWish" class="ai-wish" :maxlength="MAX_WISH" :disabled="aiBusy"
              placeholder="跟 AI 说这一块怎么改，比如「这三条排成两列」「标题小一点、间距拉开」"
              @keyup.enter="aiEdit()"
            />
            <button class="btn-ai" :disabled="aiBusy || !aiSel || !aiWish.trim()" @click="aiEdit()">
              {{ aiBusy ? '正在改…' : 'AI 改这一块（花 1 次）' }}
            </button>
            <span v-if="aiErr" class="ai-msg bad">{{ aiErr }}</span>
            <span v-else-if="aiNote" class="ai-msg ok">{{ aiNote }}</span>
            <span v-else-if="aiSel" class="ai-msg">
              改「{{ aiSel.label }}」这一块 —— 文案发出去之前会打码，AI 改不到一个字
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

            <div class="ins-cols">
              <div class="ins-col">
                <div class="ins-h">为什么挑这个版式</div>
                <p class="why" :class="{ missing: !cur.why }">
                  {{ cur.why || '（模型没给理由 —— 只能自己看 demo 判断挑得准不准）' }}
                </p>
                <ul v-if="cur.points.length" class="points">
                  <li v-for="(pt, i) in cur.points" :key="i">{{ pt }}</li>
                </ul>
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
            <div v-if="built[cur.page]?.problems.length" class="problems">
              <div class="problems-title">这一页有 {{ built[cur.page].problems.length }} 处要注意</div>
              <ul><li v-for="(x, i) in built[cur.page].problems" :key="i">{{ x }}</li></ul>
            </div>

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

        <label class="field">
          <span class="label">
            提纲
            <em :class="{ over: outline.length > MAX_OUTLINE }">{{ outline.length }} / {{ MAX_OUTLINE }}</em>
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

        <!-- problems 是「结果能用但有话要说」。规划这一步的失败形态全是一份看起来完整的
             规划：编出来的版式名、被截断只规划了一半、连续五页同版式 —— 不显示没人发现。 -->
        <div v-if="problems.length" class="problems">
          <div class="problems-title">这次规划有 {{ problems.length }} 处要注意</div>
          <ul><li v-for="(x, i) in problems" :key="i">{{ x }}</li></ul>
        </div>
        <p v-if="usage" class="muted">本次规划 token：输入 {{ usage.prompt_tokens }} / 输出 {{ usage.completion_tokens }}</p>
        <a class="muted link" href="/api/ppt/demo-deck.html" target="_blank">看全部 22 个版式 demo ↗</a>
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
        <p v-if="outlineIssue" class="banner bad">{{ outlineIssue }}</p>
        <p class="muted">
          提纲跟着这次生成一起存 —— <b>点了下面那个生成按钮才存，直接关掉这个框不保存</b>。
        </p>

        <label class="field">
          <span class="label">版式</span>
          <select v-model="draftLayout">
            <option v-if="!layoutList.length" :value="draftLayout">{{ draftLayout }}（清单没读出来）</option>
            <!-- 规划挑的那条和它给的备选排最前面：22 条平铺的话「换一个也合适的」等于自己认，
                 挑一条装不下这一页内容的出来照样是一页完整的幻灯片，只是内容挤成一团。 -->
            <optgroup v-if="suggestedItems.length" label="规划挑的 + 它给的备选">
              <option v-for="l in suggestedItems" :key="l.id" :value="l.id">
                {{ l.id }} {{ l.title }}{{ l.id === setupFor.layoutId ? '（规划挑的）' : '（备选）' }}
              </option>
            </optgroup>
            <optgroup v-if="otherItems.length" :label="`其余 ${otherItems.length} 条`">
              <option v-for="l in otherItems" :key="l.id" :value="l.id">{{ l.id }} {{ l.title }}</option>
            </optgroup>
          </select>
        </label>
        <!-- 老规划里没有备选。不说的话上面那组只有一条，读起来像「模型认为只有这个版式合适」。 -->
        <p v-if="layoutList.length && !setupFor.alts?.length" class="muted">
          规划没给备选版式（重新规划一次才有），下拉里是全部 {{ layoutList.length }} 条 —— 装不装得下看 demo。
        </p>
        <p v-if="draftLayoutItem" class="muted">
          <a :href="draftLayoutItem.demoUrl" target="_blank">看 {{ draftLayoutItem.id }} 的效果 demo ↗</a>
          · 图位 <span :title="draftLayoutItem.imageSlots">{{ slotBrief(draftLayoutItem.imageSlots) }}</span>
        </p>
        <!-- 换版式会连图位一起换：备好的图是按序号贴的，图位少了那几张就没地方贴。
             这句话必须在点之前说 —— 生成完再说的话那次调用已经花了。 -->
        <p v-if="draftLayoutChanged && pending[setupFor.page]?.length" class="banner warn">
          这一页备好了 {{ pending[setupFor.page].length }} 张图，换版式之后图位的数量/比例可能不一样 ——
          多出来的那几张会没地方贴（生成完会点名说是哪几张，图还在素材库里）。
        </p>

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
            {{ built[setupFor.page] ? '按这些重新生成（一次真实调用）' : '开始生成（一次真实调用）' }}
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
        <div class="dr-head">
          <b>给第 {{ pickFor.page }} 页第 {{ pickFor.index }} 格挑一张（挑图不花额度）</b>
          <button class="btn-ghost sm" @click="pickFor = null">关掉</button>
        </div>
        <p v-if="assetsErr" class="banner bad">{{ assetsErr }}</p>
        <p v-else-if="!assets.length" class="muted">
          素材库还是空的 —— 生成过的每张配图都会自动进这里，之后就能在别的页里重用。
        </p>
        <p v-else class="muted">
          共 {{ assetsTotal }} 张，这里显示最近 {{ assets.length }} 张。比例/画风和这一格不一样也能挑，
          挑完会告诉你差在哪（贴进去会被裁 / 笔触不统一）。
        </p>
        <div class="pick-grid">
          <button v-for="a in assets" :key="a.id" class="pick-cell" :title="a.prompt" @click="pickAsset(a.id)">
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
import { apiGet, apiPost, apiPatch } from '../../lib/api'

interface PlannedImage { subject: string; mode: string; ratio: string }
interface PlannedPage {
  page: number; section: string; title: string; points: string[]
  layoutId: string; why: string; images: number
  /** 规划里定下的「这几张图画什么」。老 deck 的 plan_json 里没有这个字段（那时只有张数）。 */
  imageSpecs?: PlannedImage[]
  /** 规划给的 2-3 条备选版式（服务端校验过在库里）。老 deck 没有这个字段。 */
  alts?: string[]
  layoutName: string; layoutTitle: string; fullbleed: boolean; demoUrl: string
}

/** 和服务端 planService.MAX_OUTLINE_CHARS 一致（超了服务端明确拒绝，不截断）。 */
const MAX_OUTLINE = 12000

const outline = ref('')
const running = ref(false)
const error = ref('')
const pages = ref<PlannedPage[]>([])
const problems = ref<string[]>([])
const usage = ref<{ prompt_tokens: number; completion_tokens: number; total_tokens: number } | null>(null)

interface BuiltPage { html: string; previewHtml: string; problems: string[] }
const built = ref<Record<number, BuiltPage>>({})
const busy = ref<Record<number, boolean>>({})
const pageErr = ref<Record<number, string>>({})
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
  return JSON.stringify([title.value.trim(), outline.value, brandCn.value, brandEn.value, styleId.value, deckNotes.value])
}

/** 顶栏那句「存没存上」。每一页都是一次真实调用，他要能一眼确定关掉页面回来还在。 */
const saveLabel = computed(() => {
  if (metaErr.value) return '没保存上'
  if (savingMeta.value) return '保存中…'
  if (metaSavedAt.value) return `已保存 ${metaSavedAt.value}`
  return '改动失焦即存'
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
const batchAt = ref(0)
const batchNote = ref('')
let stopRequested = false

const deckHtml = ref('')
const deckErr = ref('')

const exporting = ref(false)
const exportErr = ref('')
const exportNote = ref('')
const exportWarnings = ref<string[]>([])

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

const pickFor = ref<{ page: number; index: number } | null>(null)
const assets = ref<AssetItem[]>([])
const assetsTotal = ref(0)
const assetsErr = ref('')

async function openPicker(page: number, index: number) {
  pickFor.value = { page, index }
  assetsErr.value = ''
  try {
    const data = await apiGet<{ assets: AssetItem[]; total: number }>('/api/ppt/assets')
    assets.value = data.assets || []
    assetsTotal.value = data.total || 0
  } catch (e: any) {
    // 静默的话这里是一个空网格，和「素材库本来是空的」长得一样 —— 而他会去点「AI 生成」
    // 重新花一次钱生成一张库里已经有的图。
    assetsErr.value = `素材库读不出来：${e?.message || '请求失败'} —— 先别当成「库里没有图」，那可能只是这次请求失败了。`
  }
}

function pickAsset(assetId: string) {
  const at = pickFor.value
  pickFor.value = null
  if (at) prepare(at.page, at.index, 'library', assetId)
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
      { page, index, from, assetId, subject }
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
    const msg = e.message || '备图失败'
    prepErr.value[page] = msg === 'quota_exceeded' ? '今天的 AI 额度用完了，这一格没备上。' : msg
  }
  prepBusy.value[key] = false
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
const pendingCount = computed(() => pages.value.length - builtCount.value)

// ── 工作台（左缩略图菜单 + 右当前页）────────────────────────────
/** 右边这块在放什么：某一页，还是拼好的整份。 */
const view = ref<'page' | 'deck'>('page')
/** 选中的页码。0 = 还没有页可选。 */
const current = ref(0)
const cur = computed(() => pages.value.find(p => p.page === current.value) || null)
const showSettings = ref(false)

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
}
const layoutList = ref<LayoutItem[]>([])
const layoutsErr = ref('')

/** 生成前那个对话框：null = 没开。 */
const setupFor = ref<PlannedPage | null>(null)
const draftLayout = ref('')
const draftNotes = ref('')

/**
 * 这一页的提纲（可改）。**只在点「生成」时随那次调用一起存**（服务端 `readPageOutline`）——
 * 另开一个「保存提纲」按钮的话会多出一种状态：库里提纲是新的、画面是旧提纲生成的那一版，
 * 两边各自都读得通，看不出哪个是最新的。
 */
const draftTitle = ref('')
/** 要点按行编辑（一行一条）。空行丢掉，服务端也丢 —— 两边规则不一样的话条数对不上。 */
const draftPoints = ref('')
/** 三个上限和服务端 `deckStore` 里那三个常量一致：两边不一样时他在这里写得下，
 *  一点生成就被 400，而看不出是哪一边的限制。 */
const MAX_PAGE_TITLE = 60
const MAX_POINTS = 12
const MAX_POINT = 200

const draftPointLines = computed(() =>
  draftPoints.value.split('\n').map(s => s.trim()).filter(Boolean)
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
  draftLayout.value = setupLayout.value[p.page] || p.layoutId
  draftNotes.value = setupNotes.value[p.page] || ''
  // 每次打开都从库里那份规划重读（留着上一次的输入的话，他上次改完关掉不存的那版会在
  // 这里当成「已经存下来的提纲」显示，而库里还是模型原来那句）。
  draftTitle.value = p.title || ''
  draftPoints.value = (p.points || []).join('\n')
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
  return layoutList.value.filter(l => !ids.includes(l.id))
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
/** 换版式会连图位一起换：备好的图是按序号贴的，图位少了那几张就没地方贴（服务端会点名）。 */
const draftLayoutChanged = computed(() => !!setupFor.value && draftLayout.value !== setupFor.value.layoutId)

// ── 这一页的详情（浮在画面右侧，可收起）──────────────────────────
// 默认收起（画面因此能撑到最大），但收起来之后 problems、生图失败的那几格「还是占位图」
// 就全看不见了，而画面上那一页读起来完全正常。所以两处补偿是承重的：
// **把手上带「N 处要注意」的数字**（去掉的话收起状态和「这一页干干净净」分不开），
// 以及**这一页的问题数一变多就自动弹开** —— 刚跑完的生成/配图那几条必须撞到眼前，
// 不然他会拿着一份还带占位图的稿子去拼整份/导出，而那两步都不会拦。
const insOpen = ref(false)
const curIssues = computed(() => {
  const p = cur.value
  if (!p) return 0
  const n = p.page
  return (pageErr.value[n] ? 1 : 0) + (imgErr.value[n] ? 1 : 0) + (prepErr.value[n] ? 1 : 0) +
    (layoutMismatch.value ? 1 : 0) +
    (built.value[n]?.problems.length || 0) +
    (imgInfo.value[n]?.problems.length || 0) +
    (prepNote.value[n]?.length || 0) +
    // 还是占位图的那几格：预览里它就是「这一版设计得比较空」
    (built.value[n] ? Math.max(0, slotCount(n) - filledCount(n)) : 0)
})
// 只在**同一页**的问题数变多时弹开：翻页也弹的话他每按一次方向键都要再收一次。
let issueMark = { page: 0, n: 0 }
watch([current, curIssues], ([p, n]) => {
  if (p === issueMark.page && n > issueMark.n) insOpen.value = true
  issueMark = { page: p, n }
})

function startBuild() {
  const p = setupFor.value
  if (!p) return
  // 提纲不合规就不发（服务端也会拒，但那时对话框已经关了，那句话会落在这一页的错误里，
  // 而他要改的输入框已经不在眼前了）。
  if (outlineIssue.value) return
  setupFor.value = null
  // 上一版的配图记录先清掉：留着的话生成期间界面上写着「3/3 张有图」，而新 html 里
  // 图槽位已经换回占位图（build 回来之后再按服务端那份重新填）。
  imgInfo.value[p.page] = undefined as any
  imgErr.value[p.page] = ''
  build(p, {
    layoutId: draftLayout.value,
    notes: draftNotes.value.trim(),
    // 提纲随这次调用一起发（服务端先写回 plan_json 再按新的那份生成）。
    title: draftTitle.value.trim(),
    points: draftPointLines.value,
  })
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
  /* 鼠标停在哪一块上就描出那一块的边：不描的话「选大一点」选到了哪一层完全看不出来，
     他只能靠点下去之后那句读数去猜。 */
  [data-hov]{outline:1px dotted rgba(74,144,217,.75);outline-offset:2px}
  [data-region]{outline:2px solid #f0a020!important;outline-offset:3px;background:rgba(240,160,32,.07)}
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
  // 「选小一点」用的回退栈（选大一点每往外一层就压一个）。不留栈的话往外选多了只能重新点一次，
  // 而他要的那一层往往就在中间。
  var path = []

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
      ['grow','','⤢ 选大一点','往外选一层（选中整块）',''],
      ['shrink','','⤡ 回来','退回上一层',''],
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
    path = []
    if(bar) bar.style.display = 'none'
    post({type:'ppt-sel', eid:''})
  }

  /** 往外选一层。**停在这一页那个 section 上**：再往外是骨架的 #slides / #stage —— 那是页码、
   *  进度条、页脚，选中它之后让 AI 改会把整份外壳一起重写，而那一页看起来只是「变样了」。 */
  function grow(){
    if(!selEl) return
    if(selEl.classList.contains('slide') || !selEl.parentElement){ post({type:'ppt-sel-top'}); return }
    path.push(selEl)
    select(selEl.parentElement)
  }

  function shrink(){
    var prev = path.pop()
    if(prev) select(prev)
  }

  function apply(act, v){
    if(!selEl) return
    if(act === 'grow'){ grow(); return }
    if(act === 'shrink'){ shrink(); return }
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
    if(el){ e.stopPropagation(); path = []; select(el) }
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
const MAX_WISH = 400
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
      editNote.value = `选中这一句（${d.size || '?'}px / 字重 ${d.weight || '?'}）—— 浮动条上改颜色、字号、粗细、对齐（⇤ ⇔ ⇥），点一下就存；「⤢ 选大一点」往外选一整块。`
    } else if (r) {
      // 选中一整块时**必须说清是哪一块、里面有什么**：只描一圈线的话「选到了外层容器」和
      // 「选到了我要的那一块」在屏幕上是同一个样子（下一步 AI 编辑改的就是这个范围）。
      // 是 flex/grid 就把「现在的对齐是什么」一起说出来：不说的话点了 ⤒ 而画面没动
      // （本来就已经是 flex-start）看起来像按钮没生效。
      const align: Record<string, string> = { 'flex-start': '靠起始边', start: '靠起始边', center: '居中', 'flex-end': '靠结束边', end: '靠结束边', stretch: '拉满', normal: '拉满（默认）' }
      const axis = d.vert ? '上下' : '左右'
      editNote.value = `选中${r.whole ? '整页' : `这一块（${r.cls}）`}：含 ${r.eids?.length || 0} 段字${r.imgs ? ` / ${r.imgs} 张图` : ''} —— 「⤢」再往外一层、「⤡」退回来，Esc 取消。要改颜色/字号得点到具体那一句上。` +
        (d.flex
          ? `这一块是 ${d.display} 布局，里面的内容现在${axis}${align[String(d.alignItems)] || String(d.alignItems)} —— 浮动条上那三个键改它（align-items）。`
          : `（这一块不是 flex/grid，所以没有整块对齐可改。）`)
    } else {
      editNote.value = ''
    }
    return
  }
  if (d.type === 'ppt-sel-top') {
    editNote.value = '已经是整页了 —— 再往外就是页码、进度条那些外壳，不是这一页的内容，所以选不到。'
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
  if (d.type === 'ppt-region-style') {
    saveRegionStyle(
      (Array.isArray(d.path) ? d.path : []).map(Number),
      (Array.isArray(d.eids) ? d.eids : []).map(String),
      d.style || {}
    )
    return
  }
  if (d.type === 'ppt-style') saveStyle(String(d.eid || ''), d.style || {}, !!d.noRoom)
  if (d.type === 'ppt-edit') saveText(String(d.eid || ''), String(d.oldText ?? ''), String(d.newText ?? ''))
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
    const data = await apiPost<{ html: string; previewHtml: string; text: string }>(
      `/api/ppt/decks/${deckId.value}/edit-text`,
      { page, eid, oldText, newText }
    )
    // 用服务端回的那一版覆盖（画面上于是显示的是库里真的那份，不是他浏览器里改出来的样子）。
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    editNote.value = `已存：「${data.text.slice(0, 24)}${data.text.length > 24 ? '…' : ''}」`
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
      { page, eid, style }
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
      (noRoom ? '。但这一块的宽度就是文字本身的宽度，所以画面上看不出变化 —— 要让它在外面那一块里挪位置，点「⤢ 选大一点」选到外层那一整块，再用浮动条上那三个整块对齐的键。' : '')
    invalidateDeck()
  } catch (e: any) {
    editErr.value[page] = `这一块的样式没改上：${e?.message || '请求失败'}（画面已经回到库里那一版）`
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
      { page, path, eids, style }
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
  try {
    const data = await apiPost<{ html: string; previewHtml: string; summary: string }>(
      `/api/ppt/decks/${deckId.value}/ai-edit`,
      { page, path: sel.path, eids: sel.eids, instruction: wish }
    )
    const b = built.value[page]
    if (b) built.value[page] = { ...b, html: data.html, previewHtml: data.previewHtml }
    aiNote.value = data.summary
    // 这一页已经不是拼好的那份整份/导出文件里的那一版了。
    invalidateDeck()
    // 预览是重挂的，选中框跟着没了 —— 那一栏也要收起来，留着的话他会对着一块没被框住的
    // 内容再点一次（那是再花一次额度）。
    aiSel.value = null
    aiWish.value = ''
  } catch (e: any) {
    aiErr.value = e?.message || '这一块没改上'
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
  setup?: { layoutId: string; notes: string; title: string; points: string[] }
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
        outline?: { title: string; points: string[] }
      }
    >(`/api/ppt/decks/${deckId.value}/pages`, { page: p.page, ...(setup || {}) })
    // 提纲照服务端回的那份记（那是库里现在那份）。不同步的话左边列表和标题栏还写着模型
    // 原来那句标题，而画面是按新提纲生成的 —— 两处各自都读得通，看不出哪个是最新的。
    if (data.outline) {
      p.title = data.outline.title
      p.points = data.outline.points
    }
    // 这次到底按哪条版式、带了什么要求，照服务端回的那份记（本地那份 draft 可能和它不一样：
    // 选回规划那条时服务端会把覆盖清掉）。不同步的话标签写着 L12 而画面是 L07 排的。
    if (data.setup) {
      builtLayout.value[p.page] = data.setup.layoutId
      setupLayout.value[p.page] = data.setup.layoutId === p.layoutId ? '' : data.setup.layoutId
      setupNotes.value[p.page] = data.setup.notes || ''
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
    const msg = e.message || '这一页生成失败'
    pageErr.value[p.page] = msg === 'quota_exceeded' ? '今天的 AI 额度用完了，这一页没生成。' : msg
    outcome = /quota_exceeded|额度/.test(msg) ? 'quota' : 'fail'
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
    const data = await apiPost<ImagesResult>(`/api/ppt/decks/${deckId.value}/images`, { page: p.page, force })
    built.value[p.page] = { ...built.value[p.page], html: data.html, previewHtml: data.previewHtml }
    imgInfo.value[p.page] = data
    invalidateDeck()
    if (data.quotaExceeded) outcome = 'quota'
    else if (data.images.some(i => !i.url)) outcome = 'fail'
  } catch (e: any) {
    const msg = e.message || '生图失败'
    imgErr.value[p.page] = msg === 'quota_exceeded' ? '今天的 AI 额度用完了。' : msg
    outcome = /quota_exceeded|额度/.test(msg) ? 'quota' : 'fail'
  }
  imgBusy.value[p.page] = false
  return outcome
}

/** 逐页配图（串行、可停止、逐类报数，和 runAll 一个口径）。只做还差图的那几页。 */
async function fillAllImages() {
  batchRunning.value = true
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
    const { deck } = await apiGet<{ deck: any }>(`/api/ppt/decks/${deckId.value}`)
    title.value = deck.title || ''
    outline.value = deck.outline || ''
    brandCn.value = deck.brand_cn || ''
    brandEn.value = deck.brand_en || ''
    deckNotes.value = deck.notes || ''
    if (deck.style_id) styleId.value = deck.style_id
    savedSnapshot = metaSnapshot()
    // 上一次的规划（`plan_json` 是整份 PlanResult 原样存的）。解析失败要出声：
    // 静默当成「没规划过」的话，下面那句自动规划会直接再花一次调用，而旧规划还在库里。
    if (deck.plan_json) {
      try {
        const p = JSON.parse(deck.plan_json)
        pages.value = p.pages || []
        problems.value = p.problems || []
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
  page: number; layoutId: string; html: string; previewHtml: string
  problems: string[]; images: FilledImage[]; imageStyleId: string
  /** 生成 HTML 之前先备好的图（091）。这一页可能只有备图、还没有 html。 */
  pendingImages: PreparedImage[]
  /** 他挑的版式（092，空 = 照规划）。`layoutId` 是这份 html 实际用的那条，两者可能不同。 */
  setupLayoutId: string
  /** 他手写的额外要求（092）。 */
  notes: string
}

/**
 * 读已经生成的那几页（`previewHtml` 是服务端现拼的，同一份 `deckShell`）。
 *
 * 读不进来**必须出声**：静默当成「还没生成」的话，界面上是「生成全部 12 页」，
 * 而那十几次调用其实已经花过 —— 他会照着按钮再花一遍。
 */
async function loadPages() {
  try {
    const { pages: rows } = await apiGet<{ pages: StoredPage[] }>(`/api/ppt/decks/${deckId.value}/pages`)
    for (const r of rows) {
      // 备好图但还没生成 HTML 的那几页也会回来（`html = ''`）。**不能当成「已生成」**：
      // 那样右边是一块白，读起来像这一页排版塌了，而它压根没生成过。
      if (r.pendingImages?.length) pending.value[r.page] = r.pendingImages
      // 生成前改过的那两样（092）也要接回来：不接的话对话框每次都从规划那条开始，
      // 他上次写的要求看不见（以为没保存上），而下一次生成服务端照旧会带上它。
      if (r.setupLayoutId) setupLayout.value[r.page] = r.setupLayoutId
      if (r.notes) setupNotes.value[r.page] = r.notes
      if (!r.html) continue
      builtLayout.value[r.page] = r.layoutId
      built.value[r.page] = { html: r.html, previewHtml: r.previewHtml, problems: r.problems || [] }
      // 配图结果也存着（哪张成了、用的哪套画风）。只显示「配了几张」的话，
      // 失败的那几格在预览里就是「设计上留白」。
      if (r.images?.length) {
        imgInfo.value[r.page] = {
          html: r.html, previewHtml: r.previewHtml, images: r.images,
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
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }>(`/api/ppt/decks/${deckId.value}/plan`, {})
    pages.value = data.pages || []
    problems.value = data.problems || []
    usage.value = data.usage || null
    // 规划完把工作台落回第一页（旧的选中页可能压根不在这份规划里了）。
    view.value = 'page'
    current.value = 0
    selectFirst()
    showSettings.value = false
    // 重新规划之后已生成的那几页必须清掉：新规划的第 3 页很可能换了版式和内容，
    // 而旧的那一版会照旧挂在「第 3 页」下面 —— 两边都不报错，看起来像新生成的。
    built.value = {}
    pageErr.value = {}
    showSrc.value = {}
    imgInfo.value = {}
    imgErr.value = {}
    // 备好的图也跟着页一起被清掉了（新规划的第 3 页和旧的第 3 页压根不是一页内容）。
    pending.value = {}
    prepNote.value = {}
    prepErr.value = {}
    // 生成前改过的版式和手写要求也跟着页一起被清掉了（092）。留在界面上的话对话框里
    // 还写着那段要求，而库里已经没有了 —— 下一次生成出来不带它，一处都不说。
    setupLayout.value = {}
    setupNotes.value = {}
    builtLayout.value = {}
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
  } catch (e: any) {
    error.value = e.message || '排版规划失败'
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
.ai-msg { font-size: 12px; color: var(--text-secondary); max-width: min(560px, 92%); }
.ai-msg.bad { color: #ffb4b4; }
.ai-msg.ok { color: var(--brand-yellow); }
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
.ins-cols { display: flex; flex-direction: column; gap: 16px; }
.ins-col { min-width: 0; }
.ins-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary); margin-bottom: 10px; }
.ins-h.muted { color: var(--color-soft); font-weight: 400; }
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
.pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.pick-cell {
  padding: 0; border-radius: 12px; overflow: hidden;
  background: rgba(255, 255, 255, 0.04); cursor: pointer; display: flex; flex-direction: column;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s;
}
.pick-cell:hover { background: rgba(255, 255, 255, 0.1); transform: scale(0.98); }
.pick-cell img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
.pick-meta { padding: 4px 6px; font-family: var(--font-mono); font-size: 10px; color: var(--color-soft); }

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
.problems li { font-size: 12px; line-height: 1.8; color: #FDE68A; }

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
