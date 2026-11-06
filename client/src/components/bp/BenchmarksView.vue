<script setup lang="ts">
import Refs from './Refs.vue'
import Xsrc from './Xsrc.vue'
import SourcesList from './SourcesList.vue'
import type { Competitors } from './CompetitorsView.vue'

// 08 对标企业。资料来源和 07 共用（同一轮检索），锚点前缀 comp，来源列表放在本章末尾。
defineProps<{ data: Competitors }>()
const P = 'comp'
</script>

<template>
  <p class="intro">挑商业模式最像、且走得比你远的公司，看它们的融资、营收和盈利走到了哪一步 —— 这就是你的「发展预期」参照。</p>
  <p v-if="!data.benchmarks.length" class="pending">检索资料里没有可核实的对标企业。</p>
  <template v-else>
    <div class="sub-h">资本与经营对照</div>
    <div class="table-wrap">
      <table class="t wide">
        <thead><tr><th>公司</th><th>融资</th><th>营收</th><th>盈利</th><th>对你意味着</th></tr></thead>
        <tbody>
          <tr v-for="b in data.benchmarks" :key="b.name">
            <td class="cname">{{ b.name }}<Refs :prefix="P" :src="b.src" /><span v-if="b.unsourced" class="csub"><span class="uns">有数字在资料里找不到</span></span><span v-else class="csub"><Xsrc :n="b.xsrc" /></span></td>
            <td data-l="融资" class="val">{{ b.funding || '未披露' }}</td>
            <td data-l="营收" class="val">{{ b.revenue || '未披露' }}</td>
            <td data-l="盈利">{{ b.profit || '未披露' }}</td>
            <td data-l="对你意味着">{{ b.outlook }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
  <SourcesList :prefix="P" title="竞品与对标" chapter="competitors" step="competitors" :sources="data.sources" :queries="data.queries" :failed-queries="data.failedQueries"
    :trimmed="data.trimmed" :user-materials="data.userMaterials" :excluded="data.excluded" />
</template>
