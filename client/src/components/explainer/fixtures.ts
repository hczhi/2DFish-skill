import type { Scene } from './scene'

// 调试台的测试场景。挑容易崩的：长标题、6 个元素、虚线箭头带字、字母数字混排、图标库里没有的名字。
export const FIXTURES: { id: string; name: string; scene: Scene }[] = [
  {
    id: 'gps',
    name: 'GPS 怎么定位（3 镜）',
    scene: {
      version: 1, title: '手机怎么知道你在哪', duration: 20,
      shots: [
        { seconds: 5, heading: '手机怎么知道你在哪？', layout: 'hero', items: [{ id: 'p', type: 'icon', icon: '手机', label: '你', accent: true }], beats: [{ do: 'circle', target: 'p' }] },
        {
          seconds: 7, heading: '三颗卫星同时发信号',
          items: [{ id: 's1', type: 'icon', icon: '卫星', label: '卫星 A' }, { id: 's2', type: 'icon', icon: 'satellite', label: '卫星 B' }, { id: 's3', type: 'icon', icon: '卫星', label: '卫星 C' }],
          note: '距离 = 光速 × 时间',
          layout: 'hub',
        },
        {
          seconds: 8, heading: '三个距离交于一点',
          items: [{ id: 'd', type: 'list', items: ['到 A 的距离', '到 B 的距离', '到 C 的距离'] }, { id: 'pin', type: 'icon', icon: '位置', label: '就是你的位置', accent: true }],
          arrows: [{ from: 'd', to: 'pin', label: '求交点', dashed: true }],
          beats: [{ do: 'underline', target: 'd' }, { do: 'zoom', target: 'pin' }],
        },
      ],
    },
  },
  {
    id: 'gear',
    name: '齿轮减速器（2 镜）',
    scene: {
      version: 1, title: '齿轮减速器', duration: 16,
      shots: [
        {
          seconds: 8, heading: '大齿轮 48 齿，小齿轮 16 齿',
          items: [{ id: 'm', type: 'icon', icon: 'Zap', label: '电机 3000 rpm' }, { id: 'g', type: 'icon', icon: '齿轮', label: '减速 3 : 1' }, { id: 'w', type: 'icon', icon: 'Car', label: '输出 1000 rpm', accent: true }],
          arrows: [{ from: 'm', to: 'g' }, { from: 'g', to: 'w' }],
        },
        {
          seconds: 8, heading: '为什么要减速',
          items: [{ id: 't', type: 'text', text: '转速降 3 倍，扭矩大 3 倍', accent: true }, { id: 'l', type: 'list', items: ['电机转得快但没劲', '齿轮把速度换成力气', 'Torque × 3'] }],
          note: '功率不变：P = T × ω',
        },
      ],
    },
  },
  {
    id: 'make10',
    name: '凑十法 8+5（图示组件）',
    scene: {
      version: 1, title: '凑十法', duration: 24,
      shots: [
        { seconds: 5, heading: '8 + 5 = ？', layout: 'compare', items: [{ id: 'a', type: 'diagram', kind: 'dots', count: 8, label: '8 个' }, { id: 'b', type: 'diagram', kind: 'dots', count: 5, label: '5 个', accent: true }] },
        { seconds: 6, heading: '从 5 里借走 2', items: [{ id: 'f', type: 'diagram', kind: 'dots', count: 5, groups: [2, 3], highlight: 2, label: '5 分成 2 和 3' }], note: '5 = 2 + 3', layout: 'hero', beats: [{ do: 'circle', target: 'f' }] },
        {
          seconds: 6, heading: '十格框满了就是 10',
          items: [{ id: 't', type: 'diagram', kind: 'tenframe', filled: 10, highlight: 2, label: '8 + 2 = 10' }, { id: 'r', type: 'diagram', kind: 'dots', count: 3, label: '剩下 3 个' }],
        },
        {
          seconds: 7, heading: '十再加剩下的三',
          items: [{ id: 'n', type: 'diagram', kind: 'numberline', from: 0, to: 15, marks: [8, 13], jumps: [{ from: 8, to: 10 }, { from: 10, to: 13 }] }, { id: 'e', type: 'diagram', kind: 'equation', text: '10 + 3 = 13', accent: true }],
          beats: [{ do: 'check', target: 'e' }, { do: 'zoom', target: 'e' }],
        },
      ],
    },
  },
  {
    id: 'layouts',
    name: '版式一览（7 种版式 + 讲解动作）',
    scene: {
      version: 1, title: '版式一览', duration: 45,
      shots: [
        { heading: 'reveal 大字揭示', layout: 'reveal', items: [{ id: 'n', type: 'text', text: '38 微秒', accent: true }, { id: 'a', type: 'text', text: '每天快这么多' }], beats: [{ do: 'underline', target: 'n' }] },
        { heading: 'compare 左右对比', layout: 'compare', items: [{ id: 'l', type: 'icon', icon: '电脑', label: '以前' }, { id: 'r', type: 'icon', icon: '手机', label: '现在', accent: true }], beats: [{ do: 'cross', target: 'l' }, { do: 'check', target: 'r' }] },
        { heading: 'flow 流程链', layout: 'flow', items: [{ id: 'a', type: 'icon', icon: '用户', label: '下单' }, { id: 'b', type: 'icon', icon: '数据库', label: '扣库存' }, { id: 'c', type: 'icon', icon: 'Truck', label: '发货' }, { id: 'd', type: 'icon', icon: '喜欢', label: '收货' }], beats: [{ do: 'box', target: 'b' }] },
        { heading: 'hub 中心发散', layout: 'hub', items: [{ id: 'c', type: 'icon', icon: 'Brain', label: '大模型', accent: true }, { id: 'a', type: 'text', text: '写作' }, { id: 'b', type: 'text', text: '编程' }, { id: 'd', type: 'text', text: '翻译' }, { id: 'e', type: 'text', text: '画图' }] },
        { heading: 'timeline 时间线', layout: 'timeline', items: [{ id: 'a', type: 'text', text: '1957 卫星' }, { id: 'b', type: 'text', text: '1973 GPS 立项' }, { id: 'c', type: 'text', text: '1995 全面运行' }, { id: 'd', type: 'text', text: '2007 手机定位', accent: true }], beats: [{ do: 'circle', target: 'd' }] },
        { heading: 'hero 主角放大', layout: 'hero', items: [{ id: 'g', type: 'icon', icon: '齿轮', label: '核心部件', accent: true }, { id: 'a', type: 'text', text: '转速 ↓' }, { id: 'b', type: 'text', text: '扭矩 ↑' }], beats: [{ do: 'zoom', target: 'g' }] },
        { heading: 'grid 平均分格', items: [{ id: 'a', type: 'icon', icon: '云', label: '云' }, { id: 'b', type: 'icon', icon: '数据库', label: '存储' }, { id: 'c', type: 'icon', icon: '电脑', label: '终端' }] },
      ],
    },
  },
  {
    id: 'dense',
    name: '压力测试：6 个元素 + 超长文字',
    scene: {
      version: 1, title: '压力测试', duration: 10,
      shots: [{
        heading: '这是一个故意写得非常非常长的标题，用来看缩字号有没有生效以及会不会出画面',
        items: [
          { id: 'a', type: 'icon', icon: '电脑', label: '电脑' }, { id: 'b', type: 'icon', icon: '云', label: '云端服务器集群' },
          { id: 'c', type: 'icon', icon: '数据库', label: '数据库' }, { id: 'd', type: 'icon', icon: '不存在的图标', label: '缺图标' },
          { id: 'e', type: 'text', text: '99.99% SLA' }, { id: 'f', type: 'list', items: ['第一条比较短', '第二条写得特别长特别长看看会不会折行', '3'] },
        ],
        arrows: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: '同步' }, { from: 'x', to: 'c' }],
        note: '注释也写得很长，看看两行折行和缩字号是不是都能正常工作，而且不压到上面的元素',
      }],
    },
  },
]
