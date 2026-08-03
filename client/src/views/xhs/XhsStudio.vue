<template>
  <div class="page-wrapper">
    <SiteHeader />
    <div class="xhs-studio">
      <!-- 左侧：写作区 -->
    <div class="editor-pane">
      <div class="editor-header">
        <router-link to="/xhs" class="back-link">← 返回首页</router-link>
        <input v-model="niche" class="niche-input hc-input" placeholder="赛道/人群（选填，如：省钱/职场女性）" />
        <select v-model="genre" class="genre-select hc-input" title="文体决定用哪套写作/评分手艺，选错会误伤（如给抒情文硬加干货）">
          <option value="auto">文体：自动判断</option>
          <option value="story">干货/经验体</option>
          <option value="lyric">抒情/随笔体</option>
          <option value="punchline">金句/文案体</option>
        </select>
        <div class="header-actions">
          <span class="save-hint" v-if="savedAt">已保存 {{ savedAt }}</span>
          <div class="drafts-dropdown">
            <button class="btn-ghost" @click="toggleDrafts">草稿 ▾</button>
            <div class="drafts-menu hc-shadow" v-if="showDrafts">
              <button class="draft-new" @click="newNote">＋ 新建笔记</button>
              <div v-if="drafts.length === 0" class="draft-empty">还没有草稿</div>
              <div v-for="d in drafts" :key="d.id" class="draft-item" :class="{ active: d.id === noteId }">
                <span class="draft-title" @click="openDraft(d.id)">
                  {{ d.title || '(无标题)' }}
                  <span class="draft-score" v-if="d.last_score != null">{{ d.last_score }}分</span>
                </span>
                <button class="draft-del" @click.stop="deleteDraft(d.id)" title="删除">✕</button>
              </div>
            </div>
          </div>
          <router-link to="/xhs/calibration" class="btn-ghost">校准</router-link>
          <button class="btn-ghost" @click="saveDraft" :disabled="saving">{{ saving ? '保存中…' : '存草稿' }}</button>
        </div>
      </div>

      <!-- 用写作 Skill 生成整篇 -->
      <div class="skill-gen-bar">
        <select v-model="genSkillId" class="hc-input skill-select">
          <option value="">选择写作 Skill…</option>
          <option v-for="s in writingSkills" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input v-model="genTopic" class="hc-input topic-input" placeholder="主题（如：油皮夏天不脱妆粉底推荐）" @keyup.enter="runInterview" />
        <button class="btn-ghost" @click="openPipeline" v-if="pipeStep === 0" :disabled="!genTopic.trim()">陪写 →</button>
        <button class="btn-primary" @click="generateWithSkill" :disabled="genLoading || !genSkillId || !genTopic.trim()">
          {{ genLoading ? '生成中…' : '直接生成' }}
        </button>
        <router-link to="/xhs/skills" class="btn-ghost">管理 Skill</router-link>
      </div>

      <!-- 陪写管线：逼问素材 → 立根 →（选填）联网补料 → 生成/大纲共创 -->
      <div class="pipeline hc-shadow-sm" v-if="pipeStep > 0">
        <div class="pipe-head">
          <div class="pipe-steps">
            <span class="pipe-dot" :class="{ on: pipeStep >= 1 }">① 逼问素材</span>
            <span class="pipe-arrow">→</span>
            <span class="pipe-dot" :class="{ on: pipeStep >= 2 }">② 立根</span>
            <span class="pipe-arrow">→</span>
            <span class="pipe-dot" :class="{ on: searchAvailable }" v-if="searchAvailable">②.5 联网补料</span>
            <span class="pipe-arrow" v-if="searchAvailable">→</span>
            <span class="pipe-dot" :class="{ on: pipeStep >= 3 }">③ 生成 / 大纲</span>
          </div>
          <button class="pipe-close" @click="pipeStep = 0" title="收起">✕</button>
        </div>

        <!-- ① 逼问素材 -->
        <div class="pipe-block">
          <div class="pipe-block-head">
            <span class="pipe-block-title">① 先答几个只有你知道答案的问题（去 AI 味的命门）</span>
            <button class="btn-ghost sm" @click="runInterview" :disabled="pipeBusy || !genTopic.trim()">
              {{ pipeBusy && questions.length === 0 ? '生成问题中…' : (questions.length ? '重新提问' : '让 AI 提问') }}
            </button>
          </div>
          <div v-if="questions.length" class="q-list">
            <div v-for="(q, i) in questions" :key="i" class="q-item">
              <div class="q-text">{{ q.q }}</div>
              <div class="q-why">💡 {{ q.why }}</div>
              <textarea v-model="q.answer" class="q-answer hc-input" placeholder="用你的真实经历/数字/细节回答（选填，答得越具体越不像 AI）" rows="2"></textarea>
            </div>
          </div>
          <p v-else class="pipe-hint">填好上面的主题，点「让 AI 提问」，它会问出只有你答得上来的细节。</p>
        </div>

        <!-- ② 立根 -->
        <div class="pipe-block" v-if="questions.length">
          <div class="pipe-block-head">
            <span class="pipe-block-title">② 选一个"核心判断"当全文的根（非共识才不像 AI）</span>
            <button class="btn-ghost sm" @click="runRoot" :disabled="pipeBusy">
              {{ pipeBusy && roots.length === 0 ? '提炼中…' : (roots.length ? '重新提炼' : '提炼核心判断') }}
            </button>
          </div>
          <div v-if="roots.length" class="root-list">
            <div v-for="(r, i) in roots" :key="i" class="root-card" :class="{ chosen: chosenRoot === r.insight }" @click="chooseRoot(r.insight)">
              <div class="root-insight">{{ r.insight }}</div>
              <div class="root-meta"><span class="root-tag">反面</span>{{ r.counter }}</div>
              <div class="root-meta"><span class="root-tag">切入</span>{{ r.angle }}</div>
            </div>
          </div>
        </div>

        <!-- ②.5 联网补料（仅在管理员配置了搜索 key 时出现） -->
        <div class="pipe-block" v-if="searchAvailable && questions.length">
          <div class="pipe-block-head">
            <span class="pipe-block-title">②.5 联网补点外部资料（选填，让内容更硬）</span>
            <button class="btn-ghost sm" @click="runEnrich" :disabled="enriching || !genTopic.trim()">
              {{ enriching ? '联网查询中…' : (enrichFacts.length ? '重新查询' : '让 AI 联网查') }}
            </button>
          </div>
          <div v-if="enrichQueries.length" class="enrich-queries">搜索词：{{ enrichQueries.join(' · ') }}</div>
          <div v-if="enrichFacts.length" class="enrich-list">
            <label v-for="(f, i) in enrichFacts" :key="i" class="enrich-item" :class="{ adopted: f.adopted }">
              <input type="checkbox" v-model="f.adopted" />
              <span class="enrich-body">
                <span class="enrich-point">{{ f.point }}</span>
                <a v-if="f.source" :href="f.source.url" target="_blank" rel="noopener" class="enrich-src" @click.stop>来源：{{ f.source.title || f.source.url }} ↗</a>
                <span v-if="f.caution" class="enrich-caution">⚠ {{ f.caution }}</span>
              </span>
            </label>
            <p class="enrich-tip">勾选后会作为「外部佐证」并入素材（来源可见）。这是外部信息，用前请自己核实，别当亲身经历写。</p>
          </div>
          <p v-else class="pipe-hint">查回来的都是带来源的外部信息，你勾选哪些、才会并进素材。</p>
        </div>

        <!-- ③ 人设 + 生成 -->
        <div class="pipe-block" v-if="pipeStep >= 3 && chosenRoot">
          <div class="pipe-block-title">③ 补个固定人设（选填），然后生成初稿</div>
          <input v-model="persona" class="hc-input persona-input" placeholder="作者人设，如：30岁沪漂，被消费主义坑过，说话直" />
          <div class="chosen-root">已选核心判断：<b>{{ chosenRoot }}</b></div>
          <p v-if="materialThin" class="material-warn">
            ⚠ 素材太薄——没有独家的数字/对话/翻车/具体场景，再强的 AI 也只能写空话（这是 AI 味的头号根因）。
            强烈建议回上面「逼问素材」多答几条真实细节再生成。仍可继续，但产出大概率平庸。
          </p>
          <div class="gen-actions">
            <button class="btn-primary" @click="generateWithSkill" :disabled="genLoading || !genSkillId || !genTopic.trim()"
              :title="materialThin ? '素材偏薄，产出大概率平庸；建议先补素材' : ''">
              {{ genLoading ? '生成中…' : (materialThin ? '⚠ 一键生成初稿' : '⚡ 一键生成初稿') }}
            </button>
            <button class="btn-ghost" @click="startCoWrite" :disabled="coBusy || !genTopic.trim()" title="先和 AI 一起把大纲定好（可增删改、可讨论），满意后一键生成全文">
              🤝 先定大纲再成文
            </button>
          </div>
          <span v-if="!genSkillId" class="pipe-warn">一键生成需先选写作 Skill；「先定大纲再成文」不需要</span>
        </div>
      </div>

      <!-- ③′ 大纲共创：改大纲 / 和 AI 讨论 → 定稿后一键成文 → 回编辑器改全文 -->
      <div class="cowrite hc-shadow-sm" v-if="coActive">
        <div class="pipe-head">
          <span class="pipe-block-title">🤝 先一起定大纲，满意后一键生成全文</span>
          <button class="pipe-close" @click="coActive = false" title="退出">✕</button>
        </div>

        <div v-if="coBusy && !coOutline.length" class="co-loading">AI 正在拟大纲…</div>

        <!-- 大纲：可增删改、调序 -->
        <div class="co-outline" v-if="coOutline.length">
          <div class="co-outline-title">全篇大纲 · 可自由增删改，也能让 AI 帮你调</div>
          <div v-for="(s, i) in coOutline" :key="i" class="co-sec-row">
            <span class="co-sec-idx">{{ i + 1 }}</span>
            <div class="co-sec-fields">
              <input v-model="s.heading" class="co-sec-heading" placeholder="这段的要点/小标题" />
              <input v-model="s.goal" class="co-sec-goal" placeholder="这段要讲什么、承担全文哪一步" />
            </div>
            <div class="co-sec-ops">
              <button class="co-op" @click="moveSection(i, -1)" :disabled="i === 0" title="上移">↑</button>
              <button class="co-op" @click="moveSection(i, 1)" :disabled="i === coOutline.length - 1" title="下移">↓</button>
              <button class="co-op" @click="addSection(i)" title="在下方插入一段">＋</button>
              <button class="co-op del" @click="removeSection(i)" title="删除这段">✕</button>
            </div>
          </div>
          <button class="btn-ghost sm co-add-tail" @click="addSection(coOutline.length - 1)">＋ 加一段</button>
        </div>

        <!-- 和 AI 讨论大纲 -->
        <div class="co-discuss" v-if="coOutline.length">
          <div class="co-note" v-if="coNote">🤖 {{ coNote }}</div>
          <div class="co-feedback">
            <input v-model="coFeedback" class="hc-input"
                   placeholder="和 AI 商量大纲，如：第2段拆成两段 / 少点说教多点故事 / 加个反面案例"
                   @keyup.enter="discussOutline" />
            <button class="btn-ghost sm" @click="discussOutline" :disabled="coBusy || !coFeedback.trim()">
              {{ coBusy ? '调整中…' : '💬 让 AI 帮我调' }}
            </button>
          </div>
        </div>

        <!-- 定稿 → 一键成文 -->
        <div class="co-finish" v-if="coOutline.length">
          <button class="btn-primary" @click="generateFromOutline" :disabled="coGenerating || coBusy">
            {{ coGenerating ? '按大纲生成全文中…' : '✅ 大纲定了，一键生成全文' }}
          </button>
          <span class="co-finish-hint">生成后回到编辑器，选中文字可继续改写/去味/整篇重构</span>
        </div>
      </div>

      <!-- 核心判断常驻条：全文都要为它服务，写的时候始终盯着它，避免"每段都对但合起来发散没魂" -->
      <div class="root-anchor" v-if="chosenRoot">
        <span class="ra-label">核心判断</span>
        <b class="ra-text">{{ chosenRoot }}</b>
        <button class="ra-clear" @click="chosenRoot = ''" title="清除核心判断">✕</button>
      </div>

      <input v-model="title" class="title-input" placeholder="标题（决定用户点不点开）" @input="scheduleScore" />
      <textarea
        ref="bodyRef"
        v-model="body"
        class="body-input"
        placeholder="正文…（选中一段文字，可以问 AI 怎么改）"
        @input="scheduleScore"
        @select="onSelect"
        @mouseup="onSelect"
        @keyup="onSelect"
      ></textarea>

      <!-- 选中文字后浮出的陪写指令栏（改写三版/顺着写/演示化/去 AI 味/问 AI） -->
      <div class="selection-bar hc-shadow" v-if="selection">
        <span class="sel-preview">已选中「{{ selection.slice(0, 20) }}{{ selection.length > 20 ? '…' : '' }}」</span>
        <div class="cmd-btns">
          <button class="btn-ghost sm" @click="askAI('rewrite')" :disabled="asking">改写三版</button>
          <button class="btn-ghost sm" @click="askAI('continue')" :disabled="asking">顺着写</button>
          <button class="btn-ghost sm" @click="askAI('demonstrate')" :disabled="asking" title="把讲道理的段落改成用一个具体场景演示——治'空、像 AI'的头号手法">🎬 演示化</button>
          <button class="btn-ghost sm" @click="askAI('deflavor')" :disabled="asking" title="只给选中这一句去味；想改整篇用下方「逐句去味 / 整篇重构」">去 AI 味（本句）</button>
        </div>
        <input v-model="question" class="ask-input" placeholder="或直接问：这段怎么改更抓人" @keyup.enter="askAI('ask')" />
        <button class="btn-primary" @click="askAI('ask')" :disabled="asking || !question">{{ asking ? '思考中…' : '问 AI' }}</button>
      </div>

      <!-- 全文去味自检（④实测去味） -->
      <div class="deflavor-bar">
        <button class="btn-ghost" @click="detectRewrite" :disabled="detecting || rewriting || !body.trim()">
          {{ detecting ? '检测中…' : '🔬 逐句去味' }}
        </button>
        <button class="btn-ghost" @click="deflavorRewrite" :disabled="detecting || rewriting || !body.trim()">
          {{ rewriting ? '整篇重构中…' : '♻️ 整篇重构去味' }}
        </button>
        <button class="btn-ghost" @click="polishNow" :disabled="detecting || rewriting || polishing || !body.trim()"
          title="揪出全文最平庸的几句，各给更有质感的改写——治'写得平'，不只是治 AI 味">
          {{ polishing ? '打磨中…' : '✨ 打磨平庸句' }}
        </button>
        <span class="deflavor-hint">逐句去味只改词句、动不了结构；整篇重构打散三拍循环/砍金句/段落参差；打磨平庸句则揪出最弱的几句精修文采。（只改选中的一句用上方选中栏的「去 AI 味（本句）」）</span>
      </div>
    </div>

    <!-- 右侧：诊断区 -->
    <div class="panel-pane">
      <div class="panel-section">
        <div class="score-header">
          <div class="total-score" :class="scoreClass">
            <span class="score-num">{{ result ? result.totalScore : '—' }}</span>
            <span class="score-label">爆款潜力</span>
          </div>
          <button class="btn-primary score-btn" @click="scoreNow" :disabled="scoring || (!title && !body)">
            {{ scoring ? '诊断中…' : '立即诊断' }}
          </button>
        </div>
        <div class="ai-smell" v-if="result && result.aiSmell">⚠️ 检测到 AI 味，情绪/共鸣已被压分</div>
      </div>

      <!-- 炼句台：随时能用的灵感工具。输一个母题，一次出一批金句，挑喜欢的插进正文 -->
      <div class="panel-section punchline-box">
        <div class="pl-head" @click="plOpen = !plOpen">
          <span class="pl-title">✨ 炼句台</span>
          <span class="pl-sub">输个母题，炼一批金句挑着用</span>
          <span class="pl-toggle">{{ plOpen ? '▾' : '▸' }}</span>
        </div>
        <div v-if="plOpen" class="pl-body">
          <input v-model="plTheme" class="hc-input pl-input" placeholder="母题/主题，如：班味 vs 草味 / 内卷 / 存钱"
            @keyup.enter="coinPunchlines" />
          <button class="btn-primary pl-run" @click="coinPunchlines" :disabled="plBusy || !plTheme.trim()">
            {{ plBusy ? '炼句中…' : '🔥 炼一批（5 条）' }}
          </button>
          <p class="pl-tip">高温发散 + 自动筛掉套话，只留最意外的 5 条。点一条 →「插入正文」。</p>
          <ul class="pl-list" v-if="plLines.length">
            <li v-for="(l, i) in plLines" :key="i" class="pl-line">
              <div class="pl-line-text">{{ l.text }}</div>
              <div class="pl-line-twist" v-if="l.twist">💡 {{ l.twist }}</div>
              <div class="pl-line-ops">
                <button class="btn-ghost sm" @click="insertPunchline(l.text)">插入正文</button>
                <button class="btn-ghost sm" @click="copyPunchline(l.text)">复制</button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- 维度雷达（简单条形） -->
      <div class="panel-section" v-if="result">
        <div class="dim-list">
          <div v-for="d in dimList" :key="d.key" class="dim-row" @click="expanded = expanded === d.key ? '' : d.key">
            <div class="dim-top">
              <span class="dim-name">{{ d.label }}</span>
              <span class="dim-score" :class="barClass(d.score)">{{ d.score }}/10</span>
            </div>
            <div class="dim-bar"><div class="dim-fill" :class="barClass(d.score)" :style="{ width: d.score * 10 + '%' }"></div></div>
            <div class="dim-detail hc-shadow-sm" v-if="expanded === d.key">
              <p class="dim-reason">{{ d.reason }}</p>
              <p class="dim-suggestion" v-if="d.suggestion">
                💡 {{ d.suggestion }}
                <span class="fb-btns">
                  <button class="fb-btn" @click.stop="feedback(d.key, 'accept_suggestion')" title="有用">👍</button>
                  <button class="fb-btn" @click.stop="feedback(d.key, 'reject_suggestion')" title="没用">👎</button>
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 一句话总结 -->
      <div class="panel-section" v-if="result">
        <div class="top-suggestion hc-shadow-sm" v-if="result.topSuggestion">
          <div class="ts-label">最该改的一处</div>
          <p>{{ result.topSuggestion }}</p>
        </div>
        <p class="overall">{{ result.overall }}</p>
      </div>

      <!-- 跑题检测：只有立了根才有。列出没为核心判断服务的段落——这是"素材够但写发散"的头号病根 -->
      <div class="panel-section" v-if="result && result.offTopic && result.offTopic.length">
        <div class="ts-label">跑题检测 · 偏离核心判断的段落</div>
        <div class="offtopic-hint">下面这些句子没在为「{{ chosenRoot }}」服务，删掉或改写会让全文更聚焦：</div>
        <div v-for="(o, i) in result.offTopic" :key="i" class="offtopic-item hc-shadow-sm">
          <div class="ot-excerpt">「{{ o.excerpt }}」</div>
          <div class="ot-why">↳ {{ o.why }}</div>
        </div>
      </div>

      <!-- AI 问答结果 -->
      <div class="panel-section" v-if="answer || asking">
        <div class="ts-label">AI 建议</div>
        <div class="answer-text">{{ answer }}<span v-if="asking" class="cursor">▋</span></div>
      </div>

      <!-- 去味自检结果 -->
      <div class="panel-section" v-if="detectResult">
        <div class="deflavor-head">
          <div class="ts-label">去味自检</div>
          <span class="deflavor-grade" v-if="detectResult.grade">{{ detectResult.grade }} · {{ detectResult.total_score }}分</span>
        </div>
        <p class="deflavor-assess">{{ detectResult.overall_assessment }}</p>
        <div class="fp-tags" v-if="detectResult.fingerprints && detectResult.fingerprints.length">
          <span v-for="fp in detectResult.fingerprints" :key="fp" class="fp-tag">{{ fp }}</span>
        </div>
        <div class="rewrite-list" v-if="detectResult.appliedRewrites.length">
          <div class="rewrite-count">
            将定点重写 {{ detectResult.appliedRewrites.length }} 处<span v-if="detectResult.skippedRewrites">（{{ detectResult.skippedRewrites }} 处未在正文精确定位，已跳过）</span>
          </div>
          <div v-for="(rw, i) in detectResult.appliedRewrites" :key="i" class="rewrite-item hc-shadow-sm">
            <div class="rw-fp">{{ rw.fingerprint }} · {{ rw.reason }}</div>
            <div class="rw-orig">原：{{ rw.original }}</div>
            <div class="rw-new">改：{{ rw.suggestion }}</div>
          </div>
          <button class="btn-primary adopt-btn" @click="adoptRewrite">一键采纳去味后正文</button>
        </div>
        <p v-else class="deflavor-clean">没有命中需要定点重写的 AI 指纹 👍</p>
      </div>

      <!-- 整篇重构结果 -->
      <div class="panel-section" v-if="rewriteResult">
        <div class="ts-label">整篇重构去味</div>
        <div class="rewrite-notes" v-if="rewriteResult.notes.length">
          <div v-for="(n, i) in rewriteResult.notes" :key="i" class="rw-note">· {{ n }}</div>
        </div>
        <div class="rewrite-preview hc-shadow-sm">
          <div class="rw-title" v-if="rewriteResult.rewrittenTitle">{{ rewriteResult.rewrittenTitle }}</div>
          <div class="rw-body">{{ rewriteResult.rewrittenBody }}</div>
        </div>
        <button class="btn-primary adopt-btn" @click="adoptFullRewrite">一键采纳重构后全文</button>
      </div>

      <!-- 打磨平庸句结果 -->
      <div class="panel-section" v-if="polishResult">
        <div class="ts-label">打磨平庸句 · 定点狙击最弱的几句</div>
        <div class="rewrite-list" v-if="polishResult.appliedPolishes.length">
          <div class="rewrite-count">
            打磨 {{ polishResult.appliedPolishes.length }} 处<span v-if="polishResult.skippedPolishes">（{{ polishResult.skippedPolishes }} 处未在正文精确定位，已跳过）</span>
          </div>
          <div v-for="(p, i) in polishResult.appliedPolishes" :key="i" class="rewrite-item hc-shadow-sm">
            <div class="rw-orig">原：{{ p.original }}</div>
            <div class="rw-new">改：{{ p.suggestion }}</div>
            <div class="rw-fp" v-if="p.why">↳ {{ p.why }}</div>
          </div>
          <button class="btn-primary adopt-btn" @click="adoptPolish">一键采纳打磨后正文</button>
        </div>
        <p v-else class="deflavor-clean">这几句已经够有质感，没揪出更该打磨的 👍</p>
      </div>

      <div class="panel-empty" v-if="!result && !answer && !asking && !detectResult && !rewriteResult && !polishResult">
        <p>在左侧写好标题和正文，点「立即诊断」看看能不能爆 🔥</p>
      </div>
    </div>
  </div>
  <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete, apiStream, streamSSEData } from '../../lib/api'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

interface DimScore { score: number; reason: string; suggestion: string }
interface OffTopic { excerpt: string; why: string }
interface ScoreResult {
  totalScore: number
  aiSmell: boolean
  dimensions: Record<string, DimScore>
  topSuggestion: string
  overall: string
  offTopic?: OffTopic[]
}

const DIM_LABELS: Record<string, string> = {
  titleHook: '标题钩子',
  opening: '开头留人',
  resonance: '痛点共鸣',
  emotion: '情绪浓度',
  value: '价值密度',
  interaction: '互动引导',
}
const DIM_ORDER = ['titleHook', 'opening', 'resonance', 'emotion', 'value', 'interaction']

const title = ref('')
const body = ref('')
const niche = ref('')
// 文体：决定用哪套写作/评分/去味手艺。auto = 让 AI 自判。写请求时 auto 转 undefined（后端不注入文体块）。
const genre = ref<'auto' | 'story' | 'lyric' | 'punchline'>('auto')
const genreParam = () => (genre.value === 'auto' ? undefined : genre.value)
const noteId = ref<string | null>(null)

const result = ref<ScoreResult | null>(null)
const scoring = ref(false)
const expanded = ref('')

const bodyRef = ref<HTMLTextAreaElement | null>(null)
const selection = ref('')
const question = ref('')
const answer = ref('')
const asking = ref(false)

const saving = ref(false)
const savedAt = ref('')

const drafts = ref<any[]>([])
const showDrafts = ref(false)

// 用写作 skill 生成整篇
interface WritingSkill { id: string; name: string }
const writingSkills = ref<WritingSkill[]>([])
const genSkillId = ref('')
const genTopic = ref('')
const genLoading = ref(false)

// ===== 五步陪写管线状态 =====
// step: 0=收起 1=逼问素材 2=立根 3=可生成
const pipeStep = ref(0)
const pipeBusy = ref(false)
interface InterviewQ { q: string; why: string; answer?: string }
const questions = ref<InterviewQ[]>([])
interface RootCandidate { insight: string; counter: string; angle: string }
const roots = ref<RootCandidate[]>([])
const chosenRoot = ref('')
const persona = ref('')   // 固定人设（选填，越用越像同一个真人）

// ===== ②.5 联网补料状态 =====
interface EnrichFact { point: string; caution: string; source: { title: string; url: string } | null; adopted?: boolean }
const searchAvailable = ref(false)   // 联网搜索是否已配置（管理员填了 key）
const enriching = ref(false)
const enrichFacts = ref<EnrichFact[]>([])
const enrichQueries = ref<string[]>([])

// 用户勾选采纳的外部补充点，拼成一段"外部佐证"文本（带来源），喂给立根/生成/共写
const enrichmentText = computed(() =>
  enrichFacts.value
    .filter(f => f.adopted)
    .map(f => `· ${f.point}${f.source ? `（来源：${f.source.title || f.source.url}）` : ''}`)
    .join('\n')
)

// 把逼问的问答拼成"真实素材"文本，喂给立根/生成
const materialsText = computed(() =>
  questions.value
    .filter(q => (q.answer || '').trim())
    .map(q => `Q: ${q.q}\nA: ${q.answer!.trim()}`)
    .join('\n\n')
)

// 素材具体度启发式：没有独家细节，再强的模型也只能写空话——这是 AI 味的头号根因。
// 纯本地正则判断（零 AI 成本），数够几类"硬细节"信号：数字/时间/金额、对话引号、翻车/意外词、够长的作答。
// 只做"软门槛"——不足时醒目提示，不禁止生成（有人就想先出草稿）。
const materialSignals = computed(() => {
  const text = materialsText.value
  let n = 0
  if (/\d/.test(text)) n++                                             // 有数字（价格/时长/次数…）
  if (/[""].+?[""]|["'].+?["']/.test(text)) n++                        // 有对话原话/引号
  if (/(翻车|踩坑|踩雷|后悔|没想到|结果|才发现|居然|竟然|意外|反而)/.test(text)) n++  // 有翻车/意外/转折
  if (/(第一次|那天|那年|上个月|去年|当时|后来|凌晨|周末|上周)/.test(text)) n++       // 有具体时间/场景
  const longAnswers = questions.value.filter(q => (q.answer || '').trim().length >= 20).length
  if (longAnswers >= 2) n++                                            // 至少两条答得够具体
  return n
})
// 少于 2 类硬信号 = 素材太薄，大概率写出 AI 空话
const materialThin = computed(() => materialSignals.value < 2)

// ===== ③′ 大纲共创（可增删改 + 讨论 → 一键成文）状态 =====
interface CoSection { heading: string; goal: string }
const coActive = ref(false)          // 是否进入大纲共创
const coBusy = ref(false)            // 出/调整大纲中
const coGenerating = ref(false)      // 一键成文中
const coOutline = ref<CoSection[]>([])
const coFeedback = ref('')           // 和 AI 讨论大纲的意见
const coNote = ref('')               // AI 上一次调整的说明

async function loadWritingSkills() {
  try {
    const r = await apiGet<{ skills: WritingSkill[] }>('/api/xhs/skills')
    writingSkills.value = r.skills
  } catch { /* 忽略 */ }
}

function openPipeline() {
  pipeStep.value = 1
  questions.value = []
  roots.value = []
  chosenRoot.value = ''
}

// ① 逼问素材：拿主题去换 3-5 个只有本人知道答案的问题
async function runInterview() {
  if (!genTopic.value.trim()) return
  pipeBusy.value = true
  try {
    const r = await apiPost<{ questions: InterviewQ[] }>('/api/xhs/interview', {
      topic: genTopic.value, niche: niche.value,
    })
    questions.value = r.questions.map(q => ({ ...q, answer: '' }))
    pipeStep.value = 1
  } catch (e: any) {
    alert(e.message || '逼问素材失败')
  } finally {
    pipeBusy.value = false
  }
}

// ② 立根：基于主题 + 已答素材，给 2-3 个非共识核心判断候选
async function runRoot() {
  pipeBusy.value = true
  try {
    const r = await apiPost<{ roots: RootCandidate[] }>('/api/xhs/root', {
      topic: genTopic.value,
      materials: [materialsText.value, enrichmentText.value].filter(Boolean).join('\n\n'),
      niche: niche.value,
    })
    roots.value = r.roots
    pipeStep.value = 2
  } catch (e: any) {
    alert(e.message || '立根失败')
  } finally {
    pipeBusy.value = false
  }
}

function chooseRoot(insight: string) {
  chosenRoot.value = insight
  pipeStep.value = 3
}

// ②.5 联网补料：AI 生成搜索词 → 真实联网搜 → 汇总成带来源的补充点，用户手动勾选
async function runEnrich() {
  if (!genTopic.value.trim()) return
  enriching.value = true
  try {
    const r = await apiPost<{ queries: string[]; facts: EnrichFact[] }>('/api/xhs/enrich', {
      topic: genTopic.value,
      materials: materialsText.value || undefined,
      root: chosenRoot.value || undefined,
      niche: niche.value || undefined,
    })
    enrichQueries.value = r.queries || []
    // 默认都不勾选，用户自己把关哪些采纳（来源可见）
    enrichFacts.value = (r.facts || []).map(f => ({ ...f, adopted: false }))
    if (enrichFacts.value.length === 0) alert('没查到有价值的外部补充点，可以直接往下写。')
  } catch (e: any) {
    alert(e.message || '联网补料失败')
  } finally {
    enriching.value = false
  }
}

// ③′ 进入大纲共创：先让 AI 出一版分段大纲
async function startCoWrite() {
  if (!genTopic.value.trim()) return
  coBusy.value = true
  coActive.value = true
  coNote.value = ''
  coFeedback.value = ''
  try {
    const r = await apiPost<{ sections: CoSection[] }>('/api/xhs/cowrite', {
      mode: 'outline',
      topic: genTopic.value,
      materials: materialsText.value || undefined,
      root: chosenRoot.value || undefined,
      persona: persona.value || undefined,
      enrichment: enrichmentText.value || undefined,
      niche: niche.value || undefined,
      genre: genreParam(),
    })
    coOutline.value = r.sections || []
  } catch (e: any) {
    alert(e.message || '生成大纲失败')
    coActive.value = false
  } finally {
    coBusy.value = false
  }
}

// 和 AI 讨论大纲：把意见发过去，AI 直接返回调整后的整份新大纲
async function discussOutline() {
  if (!coOutline.value.length || !coFeedback.value.trim()) return
  coBusy.value = true
  try {
    const r = await apiPost<{ sections: CoSection[]; note: string }>('/api/xhs/cowrite', {
      mode: 'discuss-outline',
      topic: genTopic.value,
      root: chosenRoot.value || undefined,
      materials: materialsText.value || undefined,
      enrichment: enrichmentText.value || undefined,
      niche: niche.value || undefined,
      currentOutline: coOutline.value,
      feedback: coFeedback.value,
    })
    if (r.sections?.length) coOutline.value = r.sections
    coNote.value = r.note || ''
    coFeedback.value = ''
  } catch (e: any) {
    alert(e.message || '调整大纲失败')
  } finally {
    coBusy.value = false
  }
}

// 手动增删段（用户自己也能改大纲）
function addSection(afterIndex: number) {
  coOutline.value.splice(afterIndex + 1, 0, { heading: '', goal: '' })
}
function removeSection(index: number) {
  coOutline.value.splice(index, 1)
}
function moveSection(index: number, dir: -1 | 1) {
  const to = index + dir
  if (to < 0 || to >= coOutline.value.length) return
  const arr = coOutline.value
  ;[arr[index], arr[to]] = [arr[to], arr[index]]
}

// 流式生成的落笔规则：累积文本的第一行当标题、其余当正文。
// generateFromOutline 和 generateWithSkill 两条链路完全一样，抽出来避免改一处漏一处。
// 返回新的累积串（调用方持有 acc）。
function applyGeneratedDelta(acc: string, delta: string): string {
  const next = acc + delta
  const nl = next.indexOf('\n')
  if (nl === -1) {
    title.value = next
  } else {
    title.value = next.slice(0, nl).replace(/^#+\s*/, '').trim()
    body.value = next.slice(nl + 1).trim()
  }
  return next
}

// 大纲定稿 → 一键生成全文（流式），落进标题/正文编辑器
async function generateFromOutline() {
  const outline = coOutline.value.filter(s => (s.heading || '').trim() || (s.goal || '').trim())
  if (!outline.length || !genTopic.value.trim()) return
  coGenerating.value = true
  title.value = ''
  body.value = ''
  let acc = ''
  try {
    const res = await apiStream('/api/xhs/cowrite-generate', {
      topic: genTopic.value,
      outline,
      materials: [materialsText.value, enrichmentText.value ? `【外部佐证（需核实）】\n${enrichmentText.value}` : '']
        .filter(Boolean).join('\n\n') || undefined,
      root: chosenRoot.value || undefined,
      persona: persona.value || undefined,
      enrichment: enrichmentText.value || undefined,
      niche: niche.value || undefined,
      genre: genreParam(),
    }, { failMessage: '生成失败' })

    for await (const { delta } of streamSSEData(res)) {
      if (delta) acc = applyGeneratedDelta(acc, delta)
    }
    coActive.value = false   // 成文后退出大纲面板，回到编辑器改全文
    if (body.value.trim()) scoreNow()   // 首次成文直接诊断一次（之后编辑才走防抖自动重评）
  } catch (e: any) {
    body.value = '（生成失败：' + (e?.message || '未知错误') + '）'
  } finally {
    coGenerating.value = false
  }
}

async function generateWithSkill() {
  if (!genSkillId.value || !genTopic.value.trim()) return
  genLoading.value = true
  // 生成结果直接写进标题/正文：第一行作标题，其余作正文
  title.value = ''
  body.value = ''
  let acc = ''
  try {
    const res = await apiStream(`/api/xhs/skills/${genSkillId.value}/generate`, {
      topic: genTopic.value,
      // 采纳的联网补充点作为"外部佐证"并进素材（来源可见，用户已勾选把关）
      materials: [materialsText.value, enrichmentText.value ? `【外部佐证（需核实）】\n${enrichmentText.value}` : '']
        .filter(Boolean).join('\n\n') || undefined,
      root: chosenRoot.value || undefined,
      persona: persona.value || undefined,
      niche: niche.value || undefined,
      genre: genreParam(),
    }, { failMessage: '生成失败' })

    for await (const { delta } of streamSSEData(res)) {
      if (delta) acc = applyGeneratedDelta(acc, delta)
    }
    if (body.value.trim()) scoreNow()   // 首次成文直接诊断一次（之后编辑才走防抖自动重评）
  } catch (e: any) {
    body.value = '（生成失败：' + (e?.message || '未知错误') + '）'
  } finally {
    genLoading.value = false
  }
}

let scoreTimer: ReturnType<typeof setTimeout> | null = null

const dimList = computed(() => {
  if (!result.value) return []
  return DIM_ORDER.map(key => ({
    key,
    label: DIM_LABELS[key],
    ...(result.value!.dimensions[key] || { score: 0, reason: '', suggestion: '' }),
  }))
})

const scoreClass = computed(() => {
  const s = result.value?.totalScore ?? 0
  if (!result.value) return ''
  if (s >= 75) return 'good'
  if (s >= 55) return 'mid'
  return 'low'
})

function barClass(s: number) {
  if (s >= 8) return 'good'
  if (s >= 5) return 'mid'
  return 'low'
}

// 停止输入 1.5s 后自动重新诊断（有内容且已诊断过一次才自动跑，避免浪费额度）
function scheduleScore() {
  if (!result.value) return
  if (scoreTimer) clearTimeout(scoreTimer)
  scoreTimer = setTimeout(() => scoreNow(), 1500)
}

async function scoreNow() {
  if (!title.value && !body.value) return
  scoring.value = true
  try {
    result.value = await apiPost<ScoreResult>('/api/xhs/score', {
      title: title.value, body: body.value, niche: niche.value || undefined,
      // 传了核心判断就多做一维"跑题检测"：找出没在为这个根服务的段落
      root: chosenRoot.value || undefined,
      genre: genreParam(),   // 文体：按对应校正评分，别拿干货帖标准误伤抒情/金句体
    })
  } catch (e: any) {
    alert(e.message || '诊断失败')
  } finally {
    scoring.value = false
  }
}

function onSelect() {
  const el = bodyRef.value
  if (!el) return
  const sel = el.value.substring(el.selectionStart, el.selectionEnd).trim()
  selection.value = sel
}

// ⑤ AI 陪写：一个流式端点、按 mode 分发（ask 问答 / rewrite 三种改法 / continue 续写 / deflavor 去味）
async function askAI(mode: 'ask' | 'rewrite' | 'continue' | 'deflavor' | 'demonstrate' = 'ask') {
  if (mode === 'ask' && !question.value) return
  if ((mode === 'rewrite' || mode === 'deflavor' || mode === 'demonstrate') && !selection.value) return
  asking.value = true
  answer.value = ''
  try {
    const res = await apiStream('/api/xhs/ask', {
      mode,
      question: question.value,
      selection: selection.value,
      title: title.value, body: body.value, niche: niche.value,
      persona: persona.value || undefined,   // 保持同一个真人的口吻改写/续写
    }, { failMessage: '请求失败' })

    for await (const { delta } of streamSSEData(res)) {
      if (delta) answer.value += delta
    }
  } catch (e: any) {
    answer.value = '（' + (e.message || 'AI 回答失败') + '）'
  } finally {
    asking.value = false
  }
}

// ④ 去味自检闭环。两种力度：
//   patch  = 打分 + 逐句定点替换（改词/单句，动不了结构）
//   rewrite= 整篇重构（打散三拍循环、砍金句、段落参差——这才治得了结构级 AI 味）
interface DetectResult {
  mode?: string
  total_score: number | null
  grade: string | null
  overall_assessment: string
  fingerprints: string[]
  appliedRewrites: Array<{ original: string; suggestion: string; fingerprint: string; reason: string }>
  skippedRewrites: number
  rewrittenBody: string
}
interface RewriteResult {
  mode: 'rewrite'
  rewrittenTitle: string
  rewrittenBody: string
  notes: string[]
}
interface PolishResult {
  appliedPolishes: Array<{ original: string; suggestion: string; why: string }>
  skippedPolishes: number
  polishedBody: string
}
const detecting = ref(false)
const detectResult = ref<DetectResult | null>(null)
const rewriteResult = ref<RewriteResult | null>(null)
const polishing = ref(false)
const polishResult = ref<PolishResult | null>(null)

// 逐句定点去味（轻量）
async function detectRewrite() {
  if (!body.value.trim()) return
  detecting.value = true
  detectResult.value = null
  rewriteResult.value = null
  polishResult.value = null
  try {
    detectResult.value = await apiPost<DetectResult>('/api/xhs/detect-rewrite', {
      title: title.value, body: body.value, mode: 'patch',
      persona: persona.value || undefined, niche: niche.value || undefined,
      genre: genreParam(),   // 保护文体本色：别把金句体的金句、抒情体的留白当 AI 味删掉
    })
  } catch (e: any) {
    alert(e.message || '去味检测失败')
  } finally {
    detecting.value = false
  }
}

// ===== 炼句台 =====
interface PunchLine { text: string; twist: string }
const plOpen = ref(false)
const plTheme = ref('')
const plBusy = ref(false)
const plLines = ref<PunchLine[]>([])

async function coinPunchlines() {
  if (!plTheme.value.trim()) return
  plBusy.value = true
  plLines.value = []
  try {
    const r = await apiPost<{ lines: PunchLine[] }>('/api/xhs/punchline', {
      theme: plTheme.value.trim(),
      niche: niche.value || undefined,
    })
    plLines.value = r.lines || []
  } catch (e: any) {
    alert(e.message || '炼句失败')
  } finally {
    plBusy.value = false
  }
}

// 把选中的金句插进正文光标处（无光标则追加到结尾）
function insertPunchline(text: string) {
  const el = bodyRef.value
  if (el && typeof el.selectionStart === 'number') {
    const pos = el.selectionStart
    const before = body.value.slice(0, pos)
    const after = body.value.slice(pos)
    const sep = before && !before.endsWith('\n') ? '\n' : ''
    body.value = before + sep + text + '\n' + after
  } else {
    body.value = (body.value ? body.value + '\n' : '') + text
  }
  scheduleScore()
}

function copyPunchline(text: string) {
  navigator.clipboard?.writeText(text).catch(() => { /* silent */ })
}

// 整篇重构去味（治结构）
const rewriting = ref(false)
async function deflavorRewrite() {
  if (!body.value.trim()) return
  rewriting.value = true
  detectResult.value = null
  rewriteResult.value = null
  polishResult.value = null
  try {
    rewriteResult.value = await apiPost<RewriteResult>('/api/xhs/detect-rewrite', {
      title: title.value, body: body.value, mode: 'rewrite',
      persona: persona.value || undefined, niche: niche.value || undefined,
      genre: genreParam(),   // 保护文体本色：别把金句体的金句、抒情体的留白当 AI 味删掉
    })
  } catch (e: any) {
    alert(e.message || '整篇重构失败')
  } finally {
    rewriting.value = false
  }
}

// 一键采纳逐句去味后的正文
function adoptRewrite() {
  if (!detectResult.value) return
  body.value = detectResult.value.rewrittenBody
  detectResult.value = null
  scheduleScore()
}

// 一键采纳整篇重构后的标题+正文
function adoptFullRewrite() {
  if (!rewriteResult.value) return
  if (rewriteResult.value.rewrittenTitle) title.value = rewriteResult.value.rewrittenTitle
  body.value = rewriteResult.value.rewrittenBody
  rewriteResult.value = null
  scheduleScore()
}

// 打磨平庸句：揪出全文最弱的几句各给一版更有质感的改写（治"写得平"，不只治 AI 味）
async function polishNow() {
  if (!body.value.trim()) return
  polishing.value = true
  detectResult.value = null
  rewriteResult.value = null
  polishResult.value = null
  try {
    polishResult.value = await apiPost<PolishResult>('/api/xhs/polish', {
      title: title.value, body: body.value,
      persona: persona.value || undefined, niche: niche.value || undefined,
      genre: genreParam(),
    })
  } catch (e: any) {
    alert(e.message || '打磨失败')
  } finally {
    polishing.value = false
  }
}

// 一键采纳打磨后的正文
function adoptPolish() {
  if (!polishResult.value) return
  body.value = polishResult.value.polishedBody
  polishResult.value = null
  scheduleScore()
}

async function saveDraft() {
  saving.value = true
  try {
    if (!noteId.value) {
      const r = await apiPost<{ id: string }>('/api/xhs/notes', {
        title: title.value, body: body.value, niche: niche.value,
      })
      noteId.value = r.id
    }
    await apiPut(`/api/xhs/notes/${noteId.value}`, {
      title: title.value, body: body.value, niche: niche.value,
      last_score: result.value?.totalScore ?? null,
      last_dimensions: result.value?.dimensions ?? {},
    })
    savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    loadDrafts()
  } catch (e: any) {
    alert(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 记录反馈：AI 建议有没有用 → "越用越懂你"的燃料
function feedback(dimension: string, type: string) {
  apiPost('/api/xhs/feedback', {
    note_id: noteId.value || '',
    type, dimension,
    payload: { suggestion: result.value?.dimensions[dimension]?.suggestion },
  }).catch(() => { /* silent */ })
}

// ===== 草稿列表 =====
async function loadDrafts() {
  try {
    drafts.value = await apiGet<any[]>('/api/xhs/notes')
  } catch { /* silent */ }
}

function toggleDrafts() {
  showDrafts.value = !showDrafts.value
  if (showDrafts.value) loadDrafts()
}

async function openDraft(id: string) {
  try {
    const n = await apiGet<any>(`/api/xhs/notes/${id}`)
    noteId.value = n.id
    title.value = n.title || ''
    body.value = n.body || ''
    niche.value = n.niche || ''
    // 恢复上次评分快照
    if (n.last_score != null && n.last_dimensions) {
      try {
        const dims = JSON.parse(n.last_dimensions)
        result.value = {
          totalScore: n.last_score, aiSmell: false, dimensions: dims,
          topSuggestion: '', overall: '（这是上次保存的评分，重新诊断可更新）',
        }
      } catch { result.value = null }
    } else {
      result.value = null
    }
    answer.value = ''
    showDrafts.value = false
  } catch (e: any) {
    alert(e.message || '打开失败')
  }
}

function newNote() {
  noteId.value = null
  title.value = ''
  body.value = ''
  result.value = null
  answer.value = ''
  savedAt.value = ''
  showDrafts.value = false
}

async function deleteDraft(id: string) {
  if (!confirm('确定删除这篇草稿？')) return
  try {
    await apiDelete(`/api/xhs/notes/${id}`)
    if (noteId.value === id) newNote()
    await loadDrafts()
  } catch (e: any) {
    alert(e.message || '删除失败')
  }
}

async function loadSearchAvailable() {
  try {
    const r = await apiGet<{ available: boolean }>('/api/xhs/enrich/available')
    searchAvailable.value = !!r.available
  } catch { /* 忽略：默认不可用 */ }
}

onMounted(() => { loadDrafts(); loadWritingSkills(); loadSearchAvailable() })
</script>

<style scoped>
.page-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.xhs-studio {
  display: flex;
  height: calc(100vh - 50px);
  margin-top: 50px;
  background-color: #f3f4f6;
  background-image: linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  color: #111827;
}

/* ===== 左侧编辑区 ===== */
.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 32px;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid #E5E7EB;
  box-shadow: 4px 0 24px rgba(0,0,0,0.02);
  z-index: 10;
}
.editor-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.back-link { color: #6b7280; text-decoration: none; font-size: 14px; transition: color 0.2s; }
.back-link:hover { color: #3B5BDB; }
.niche-input {
  flex: 1;
  border: 1px solid transparent;
  background: #F9FAFB;
  padding: 10px 16px;
  border-radius: 9999px;
  font-size: 13px;
  outline: none;
  transition: all 0.3s;
}
.niche-input:focus {
  background: #fff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}
.genre-select {
  border: 1px solid transparent;
  background: #F9FAFB;
  padding: 10px 14px;
  border-radius: 9999px;
  font-size: 13px;
  outline: none;
  cursor: pointer;
  transition: all 0.3s;
}
.genre-select:focus { background: #fff; border-color: #3B5BDB; box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15); }
.header-actions { display: flex; align-items: center; gap: 12px; }
.save-hint { font-size: 12px; color: #9ca3af; }

/* 草稿下拉 */
.drafts-dropdown { position: relative; }
.drafts-menu {
  position: absolute; top: 40px; right: 0; z-index: 20;
  width: 280px; max-height: 360px; overflow-y: auto;
  background: #fff; border: 1px solid rgba(0,0,0,0.04); border-radius: 12px;
  padding: 8px;
}
.hc-shadow {
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.02);
}
.hc-shadow-sm {
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.04);
}
.draft-new { width: 100%; text-align: left; border: none; background: #F0F4FF; color: #3B5BDB; padding: 10px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; margin-bottom: 6px; transition: background 0.2s; }
.draft-new:hover { background: #E0E7FF; }
.draft-empty { color: #9ca3af; font-size: 13px; padding: 12px; text-align: center; }
.draft-item { display: flex; align-items: center; justify-content: space-between; padding: 4px; border-radius: 8px; transition: background 0.2s; }
.draft-item:hover { background: #F9FAFB; }
.draft-item.active { background: #F0F4FF; }
.draft-title { flex: 1; padding: 6px 8px; font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-score { color: #3B5BDB; font-size: 11px; margin-left: 6px; }
.draft-del { border: none; background: transparent; color: #d1d5db; cursor: pointer; font-size: 12px; padding: 4px 8px; }
.draft-del:hover { color: #dc2626; }

.hc-input {
  border: 1px solid transparent;
  background: #F9FAFB;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
  color: #111827;
}
.hc-input::placeholder { color: #9ca3af; }
.hc-input:focus {
  background: #fff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}

.skill-gen-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}
.skill-gen-bar .skill-select { flex: 0 0 auto; min-width: 160px; cursor: pointer; }
.skill-gen-bar .topic-input { flex: 1; min-width: 180px; }

/* 核心判断常驻条：写全文时始终盯着的"根" */
.root-anchor {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: linear-gradient(90deg, rgba(59, 91, 219, 0.06), rgba(59, 91, 219, 0.02));
  border: 1px solid rgba(59, 91, 219, 0.2);
  border-left: 3px solid #3B5BDB;
  border-radius: 10px;
}
.ra-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 800;
  color: #3B5BDB;
  letter-spacing: 1px;
  background: rgba(59, 91, 219, 0.1);
  padding: 3px 8px;
  border-radius: 6px;
}
.ra-text { flex: 1; font-size: 14px; color: #1f2937; line-height: 1.5; }
.ra-clear {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 6px;
}
.ra-clear:hover { color: #ef4444; background: rgba(239, 68, 68, 0.08); }

/* 跑题检测面板 */
.offtopic-hint { font-size: 12px; color: #6b7280; margin-bottom: 10px; line-height: 1.6; }
.offtopic-item {
  background: #fff;
  border: 1px solid #fde2e2;
  border-left: 3px solid #ef4444;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.ot-excerpt { font-size: 13px; color: #b91c1c; line-height: 1.6; }
.ot-why { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.5; }

.title-input {
  border: none;
  outline: none;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 16px;
  transition: border-color 0.3s;
}
.title-input:focus { border-color: #3B5BDB; }
.body-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  line-height: 1.8;
  resize: none;
  min-height: 300px;
  font-family: inherit;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid rgba(59, 91, 219, 0.2);
  border-radius: 12px;
  margin-top: 12px;
}
.sel-preview { font-size: 13px; color: #3B5BDB; white-space: nowrap; font-weight: 500; }
.cmd-btns { display: flex; gap: 6px; }
.ask-input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; min-width: 120px; }
.btn-ghost.sm { padding: 6px 12px; font-size: 12px; }

/* ===== 五步陪写管线 ===== */
.pipeline {
  background: #fff;
  border: 1px solid rgba(59, 91, 219, 0.15);
  border-radius: 14px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.pipe-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.pipe-steps { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pipe-dot { color: #9ca3af; font-weight: 600; }
.pipe-dot.on { color: #3B5BDB; }
.pipe-arrow { color: #d1d5db; }
.pipe-close { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 14px; }
.pipe-close:hover { color: #6b7280; }
.pipe-block { padding: 12px 0; border-top: 1px dashed #f0f0f0; }
.pipe-block:first-of-type { border-top: none; }
.pipe-block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.pipe-block-title { font-size: 13px; font-weight: 700; color: #374151; }
.pipe-hint, .pipe-warn { font-size: 12px; color: #9ca3af; margin: 4px 0 0; }
.pipe-warn { color: #ea580c; margin-left: 10px; }
.material-warn {
  font-size: 12.5px; line-height: 1.6; color: #9a3412;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
  padding: 10px 14px; margin: 10px 0;
}

/* 炼句台 */
.punchline-box { border: 1px solid #eef0f4; border-radius: 12px; }
.pl-head { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.pl-title { font-weight: 700; font-size: 14px; }
.pl-sub { font-size: 12px; color: #9ca3af; flex: 1; }
.pl-toggle { color: #9ca3af; font-size: 12px; }
.pl-body { margin-top: 12px; }
.pl-input { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
.pl-run { width: 100%; }
.pl-tip { font-size: 11px; color: #9ca3af; margin: 8px 0 0; line-height: 1.5; }
.pl-list { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 10px; }
.pl-line { background: #F9FAFB; border-radius: 10px; padding: 10px 12px; }
.pl-line-text { font-size: 14px; font-weight: 600; line-height: 1.5; color: #111827; }
.pl-line-twist { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.5; }
.pl-line-ops { display: flex; gap: 8px; margin-top: 8px; }
.q-list { display: flex; flex-direction: column; gap: 12px; }
.q-item { background: #FAFAFA; border-radius: 10px; padding: 10px 12px; }
.q-text { font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 4px; }
.q-why { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
.q-answer { width: 100%; box-sizing: border-box; border: 1px solid #eee; background: #fff; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; }
.q-answer:focus { border-color: #3B5BDB; }
.root-list { display: flex; flex-direction: column; gap: 10px; }
.root-card { border: 1px solid #eee; border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: all 0.2s; }
.root-card:hover { border-color: #3B5BDB; background: #F0F4FF; }
.root-card.chosen { border-color: #3B5BDB; background: #F0F4FF; box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.12); }
.root-insight { font-size: 14px; font-weight: 700; color: #111827; line-height: 1.5; margin-bottom: 8px; }
.root-meta { font-size: 12px; color: #6b7280; line-height: 1.5; margin-top: 4px; }
.root-tag { display: inline-block; background: #F3F4F6; color: #6b7280; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-right: 6px; }
.persona-input { width: 100%; box-sizing: border-box; margin-bottom: 10px; }
.chosen-root { font-size: 12px; color: #6b7280; margin-bottom: 12px; line-height: 1.5; }
.chosen-root b { color: #3B5BDB; }
.gen-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* ===== ②.5 联网补料 ===== */
.enrich-queries { font-size: 12px; color: #9ca3af; margin: 6px 0 8px; }
.enrich-list { display: flex; flex-direction: column; gap: 8px; }
.enrich-item {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border: 1px solid #eef0f4; border-radius: 10px;
  cursor: pointer; transition: all 0.15s; background: #fff;
}
.enrich-item:hover { border-color: rgba(59, 91, 219, 0.3); }
.enrich-item.adopted { border-color: #3B5BDB; background: rgba(59, 91, 219, 0.04); }
.enrich-item input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; }
.enrich-body { display: flex; flex-direction: column; gap: 3px; }
.enrich-point { font-size: 13px; color: #1f2937; line-height: 1.6; }
.enrich-src { font-size: 11px; color: #3B5BDB; text-decoration: none; }
.enrich-src:hover { text-decoration: underline; }
.enrich-caution { font-size: 11px; color: #ea580c; }
.enrich-tip { font-size: 11px; color: #9ca3af; margin: 4px 0 0; line-height: 1.5; }

/* ===== ③′ 大纲共创 ===== */
.cowrite {
  background: #fff; border: 1px solid rgba(59, 91, 219, 0.2);
  border-radius: 14px; padding: 16px 18px; margin-bottom: 16px;
}
.co-loading { font-size: 13px; color: #6b7280; padding: 16px 0; }
.co-outline { margin: 12px 0 14px; }
.co-outline-title { font-size: 12px; color: #6b7280; margin-bottom: 10px; }
.co-sec-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 10px; margin-bottom: 6px; background: #fafbfc; border: 1px solid #eef0f4;
}
.co-sec-idx {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  background: #3B5BDB; color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.co-sec-fields { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.co-sec-heading { border: none; background: transparent; font-size: 14px; font-weight: 600; outline: none; }
.co-sec-goal { border: none; background: transparent; font-size: 12px; color: #6b7280; outline: none; }
.co-sec-ops { flex-shrink: 0; display: flex; gap: 4px; }
.co-op {
  width: 24px; height: 24px; border: 1px solid #e5e7eb; background: #fff;
  border-radius: 6px; color: #6b7280; cursor: pointer; font-size: 12px; line-height: 1;
  display: flex; align-items: center; justify-content: center; transition: all 0.15s;
}
.co-op:hover:not(:disabled) { border-color: #3B5BDB; color: #3B5BDB; }
.co-op:disabled { opacity: 0.3; cursor: not-allowed; }
.co-op.del:hover { border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.06); }
.co-add-tail { margin-top: 4px; }
.co-discuss { margin: 14px 0; padding-top: 14px; border-top: 1px dashed #eef0f4; }
.co-note {
  font-size: 12px; color: #374151; line-height: 1.6; margin-bottom: 10px;
  padding: 8px 12px; background: rgba(59, 91, 219, 0.05); border-radius: 8px;
}
.co-feedback { display: flex; gap: 8px; }
.co-feedback .hc-input { flex: 1; }
.co-finish { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.co-finish-hint { font-size: 12px; color: #9ca3af; }

/* ===== 去味自检 ===== */
.deflavor-bar { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.deflavor-hint { font-size: 12px; color: #9ca3af; }
.deflavor-head { display: flex; align-items: center; justify-content: space-between; }
.deflavor-grade { font-size: 13px; font-weight: 700; color: #3B5BDB; }
.deflavor-assess { font-size: 13px; line-height: 1.7; color: #374151; margin: 8px 0; }
.deflavor-clean { font-size: 13px; color: #16a34a; margin: 8px 0; }
.fp-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.fp-tag { font-size: 11px; background: #fff7ed; color: #ea580c; padding: 3px 8px; border-radius: 6px; }
.rewrite-count { font-size: 12px; color: #6b7280; margin-bottom: 10px; }
.rewrite-list { display: flex; flex-direction: column; gap: 10px; }
.rewrite-item { background: #fff; border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.6; }
.rw-fp { font-size: 11px; color: #9ca3af; margin-bottom: 6px; }
.rw-orig { color: #dc2626; text-decoration: line-through; opacity: 0.7; margin-bottom: 4px; }
.rw-new { color: #16a34a; }
.adopt-btn { align-self: flex-start; margin-top: 6px; }
.rewrite-notes { margin-bottom: 10px; }
.rw-note { font-size: 12px; color: #6b7280; line-height: 1.6; }
.rewrite-preview { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; max-height: 340px; overflow-y: auto; }
.rw-title { font-size: 15px; font-weight: 800; color: #111827; margin-bottom: 10px; line-height: 1.4; }
.rw-body { font-size: 13px; line-height: 1.8; color: #374151; white-space: pre-wrap; }

/* ===== 右侧诊断区 ===== */
.panel-pane {
  width: 400px;
  flex-shrink: 0;
  padding: 32px 24px;
  overflow-y: auto;
  background: transparent;
}
.panel-section { margin-bottom: 24px; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02); }
.score-header { display: flex; align-items: center; justify-content: space-between; }
.total-score { display: flex; flex-direction: column; align-items: flex-start; }
.score-num { font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -2px; }
.total-score.good .score-num { color: #16a34a; }
.total-score.mid .score-num { color: #ea580c; }
.total-score.low .score-num { color: #EF4444; }
.score-label { font-size: 13px; color: #6b7280; margin-top: 6px; font-weight: 500; }
.ai-smell { margin-top: 12px; font-size: 13px; color: #ea580c; background: #fff7ed; padding: 10px 14px; border-radius: 10px; font-weight: 500; }

.dim-list { display: flex; flex-direction: column; gap: 16px; }
.dim-row { cursor: pointer; }
.dim-top { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.dim-name { font-weight: 600; color: #374151; }
.dim-score { font-weight: 600; }
.dim-score.good { color: #16a34a; }
.dim-score.mid { color: #ea580c; }
.dim-score.low { color: #EF4444; }
.dim-bar { height: 8px; background: rgba(0,0,0,0.04); border-radius: 4px; overflow: hidden; }
.dim-fill { height: 100%; border-radius: 4px; transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.dim-fill.good { background: #16a34a; }
.dim-fill.mid { background: #ea580c; }
.dim-fill.low { background: #EF4444; }
.dim-detail { margin-top: 10px; padding: 14px 16px; background: #fff; border-radius: 12px; font-size: 13px; border: 1px solid rgba(0,0,0,0.02); }
.dim-reason { color: #6b7280; margin: 0 0 10px; line-height: 1.6; }
.dim-suggestion { color: #111827; margin: 0; line-height: 1.6; font-weight: 500; }
.fb-btns { margin-left: 8px; }
.fb-btn { border: none; background: #F9FAFB; cursor: pointer; font-size: 13px; padding: 4px 8px; border-radius: 6px; transition: background 0.2s; }
.fb-btn:hover { background: #E5E7EB; }

.top-suggestion { background: #fff; border: 1px solid rgba(59, 91, 219, 0.15); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
.ts-label { font-size: 12px; font-weight: 800; color: #3B5BDB; margin-bottom: 8px; letter-spacing: 1px; }
.top-suggestion p, .overall { margin: 0; font-size: 14px; line-height: 1.7; color: #374151; }
.overall { color: #6b7280; }

.answer-text { font-size: 14px; line-height: 1.8; color: #374151; white-space: pre-wrap; background: #F9FAFB; padding: 16px 20px; border-radius: 12px; border: 1px solid #E5E7EB; }
.cursor { color: #3B5BDB; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }

.panel-empty { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02); color: #9ca3af; font-size: 14px; text-align: center; padding: 80px 20px; line-height: 1.6; }

/* buttons */
.btn-primary {
  background: #3B5BDB; color: #fff; border: none; padding: 10px 20px;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.2);
}
.btn-primary:hover { 
  background: #2B45A8; 
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(59, 91, 219, 0.3);
}
.btn-primary:active { transform: scale(0.97); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.score-btn { align-self: flex-start; }
.btn-ghost {
  background: #fff; color: #374151; border: 1px solid #E5E7EB; padding: 8px 16px;
  border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.2s;
}
.btn-ghost:hover { background: #F9FAFB; border-color: #D1D5DB; }
.btn-ghost:disabled { opacity: 0.5; }

/* 滚动条美化 */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.4);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(107, 114, 128, 0.6); }

@media (max-width: 768px) {
  .xhs-studio { flex-direction: column; height: auto; }
  .panel-pane { width: 100%; border-left: none; border-top: 1px solid #eee; }
}
</style>
