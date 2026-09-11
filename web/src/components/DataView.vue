<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { api, track } from '../api.js';

defineProps({ pending: { type: Array, default: () => [] } });
const emit = defineEmits(['confirm', 'reject']);

const ctx = inject('aicrm');
const changes = ref([]);
const manageMode = ref(false);
const addOpen = ref(false);
const draft = ref({ type: 'kpi', title: '', reason: '' });

const s = computed(() => ctx.stats.value || {});
const cards = computed(() => ctx.cards.value || []);
const templates = computed(() => ctx.cardTemplates.value || []);

const STAGES = ['需求确认', '方案沟通', '已报价', '商务谈判', '已成交'];
const funnel = computed(() => {
  const by = {};
  (s.value.byStage || []).forEach((x) => { by[x.name] = x.value; });
  const rows = STAGES.map((k) => ({ name: k, value: by[k] || 0 }));
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows.map((r, i) => {
    const prev = i === 0 ? r.value : rows[i - 1].value;
    return { ...r, pct: Math.round(r.value / max * 100), conv: prev ? Math.round(r.value / prev * 100) : 100 };
  });
});

const industries = computed(() => {
  const arr = s.value.byIndustry || [];
  const max = Math.max(...arr.map((x) => x.value), 1);
  return arr.map((x) => ({ ...x, pct: Math.round(x.value / max * 100) }));
});

function metricVal(card) {
  const v = s.value[card.metric];
  return v === undefined ? '—' : v;
}
function metricSub(card) {
  if (!card.sub) return '';
  const v = s.value[card.sub];
  return v === undefined ? '' : `${card.sub === 'high' ? '其中高意向' : '累计'} ${v}`;
}

async function removeCard(c) {
  await api.removeCard(c.id, '用户在看板管理中手动移除');
  await ctx.refreshCards();
  await loadChanges();
  ctx.flash(`已移除「${c.title}」，并已汇报给数据分析师`);
  track('card_remove', { id: c.id });
}
async function move(c, dir) {
  await api.reorderCard(c.id, dir);
  await ctx.refreshCards();
}
async function resetAll() {
  await api.resetCards();
  await ctx.refreshCards();
  ctx.flash('看板已恢复默认');
}
async function addCard() {
  if (!draft.value.title.trim()) return;
  const tpl = templates.value.find((t) => t.type === draft.value.type) || templates.value[0];
  await api.addCard({
    type: draft.value.type,
    title: draft.value.title.trim(),
    size: draft.value.type === 'kpi' ? 'sm' : 'half',
    source: draft.value.type === 'bars' ? 'byIndustry' : draft.value.type === 'table' ? 'byOwner' : null,
    reason: draft.value.reason || '用户在看板管理中手动添加',
  });
  await ctx.refreshCards();
  await loadChanges();
  addOpen.value = false;
  draft.value = { type: 'kpi', title: '', reason: '' };
  ctx.flash('已添加卡片，并已汇报给数据分析师');
  track('card_add', { type: draft.value.type });
}
async function loadChanges() {
  const r = await api.dashboardChanges();
  if (r.ok) changes.value = r.list.slice(0, 6);
}

onMounted(loadChanges);
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">数据面板</h1>
        <p class="vh-s">
          共 {{ cards.length }} 张卡片 · 所有结论均可追溯到原始跟进记录与客户阶段字段
        </p>
      </div>
      <div class="row gap8">
        <button class="btn btn-sm" :class="{ 'btn-accent': manageMode }" @click="manageMode = !manageMode">
          {{ manageMode ? '完成管理' : '看板管理' }}
        </button>
        <button class="btn btn-sm" @click="addOpen = true">+ 添加卡片</button>
      </div>
    </header>

    <div class="scroll">
      <!-- 待确认的看板改动（来自看板工程师） -->
      <div v-if="pending.filter(p => p.kind.startsWith('card')).length" class="pending fade-up">
        <div class="pending-h">
          <span class="tag tag-v">看板工程师拟了 {{ pending.filter(p => p.kind.startsWith('card')).length }} 个改动</span>
          <span class="dim">确认后执行，并自动汇报给数据分析师</span>
        </div>
        <div v-for="op in pending.filter(p => p.kind.startsWith('card'))" :key="op.id" class="op">
          <div class="grow">
            <div class="op-t">
              {{ op.kind === 'card_add' ? '新增：' + op.payload.title
                 : op.kind === 'card_remove' ? '移除：' + op.payload.title
                 : '恢复默认看板' }}
            </div>
            <div class="op-s">{{ op.payload.reason }}</div>
          </div>
          <button class="btn btn-sm btn-accent" @click="emit('confirm', op)">确认</button>
          <button class="btn btn-sm" @click="emit('reject', op)">忽略</button>
        </div>
      </div>

      <!-- 卡片区：完全由 cards 驱动 -->
      <div class="cards">
        <div
          v-for="c in cards" :key="c.id" class="cell"
          :class="[c.size === 'sm' ? 'w-sm' : c.size === 'full' ? 'w-full' : 'w-half']"
        >
          <!-- KPI -->
          <div v-if="c.type === 'kpi'" class="card kpi" :class="{ warn: c.warn && s.risk > 5 }">
            <div class="k-l">{{ c.title }}</div>
            <div class="k-v">{{ metricVal(c) }}</div>
            <div class="k-s">
              <template v-if="c.bar">
                <div class="bar" style="margin-top:6px">
                  <i :style="{ width: (s.taskTotal ? s.taskDone / s.taskTotal * 100 : 0) + '%' }" />
                </div>
              </template>
              <template v-else>{{ metricSub(c) }}</template>
            </div>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>

          <!-- 漏斗 -->
          <div v-else-if="c.type === 'funnel'" class="card sec">
            <div class="sec-h">{{ c.title }}</div>
            <div class="funnel">
              <div v-for="(f, i) in funnel" :key="f.name" class="fn-row">
                <span class="fn-name">{{ f.name }}</span>
                <div class="fn-bar">
                  <div class="fn-fill" :style="{ width: Math.max(f.pct, 6) + '%' }" />
                  <span class="fn-val">{{ f.value }}</span>
                </div>
                <span v-if="i > 0" class="fn-conv" :class="{ bad: f.conv < 50 }">{{ f.conv }}%</span>
                <span v-else class="fn-conv dim">—</span>
              </div>
            </div>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>

          <!-- 条形分布 -->
          <div v-else-if="c.type === 'bars'" class="card sec">
            <div class="sec-h">{{ c.title }}</div>
            <div class="bars">
              <div v-for="i in industries.slice(0, 8)" :key="i.name" class="bar-row">
                <span class="bar-label">{{ i.name }}</span>
                <div class="bar grow"><i :style="{ width: i.pct + '%' }" /></div>
                <span class="bar-val">{{ i.value }}</span>
              </div>
            </div>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>

          <!-- 按负责人表格 -->
          <div v-else-if="c.type === 'table'" class="card sec">
            <div class="sec-h">{{ c.title }}</div>
            <table class="tb">
              <thead><tr><th>销售</th><th>在管客户</th><th>高意向</th><th>风险客户</th><th>本周跟进</th><th>健康度</th></tr></thead>
              <tbody>
                <tr v-for="o in s.byOwner || []" :key="o.name">
                  <td><b>{{ o.name }}</b></td>
                  <td>{{ o.total }}</td><td>{{ o.high }}</td>
                  <td :class="{ od: o.risk > 2 }">{{ o.risk }}</td>
                  <td>{{ o.follow }}</td>
                  <td>
                    <div class="bar" style="width:88px">
                      <i :style="{ width: Math.max(0, Math.min(100, 100 - o.risk * 14)) + '%' }"
                         :class="o.risk > 2 ? 'bad' : ''" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>

          <!-- 风险清单 -->
          <div v-else-if="c.type === 'attention'" class="card sec">
            <div class="sec-h">{{ c.title }}<span class="dim">按优先级排序</span></div>
            <div class="att">
              <div v-for="a in s.attention || []" :key="a.id" class="att-item">
                <div class="grow">
                  <div class="att-t">{{ a.company_name }} <span class="tag tag-r">{{ a.days_since_follow }} 天未跟进</span></div>
                  <div class="att-s">{{ a.ai_insight }}</div>
                  <div class="att-n">→ {{ a.ai_next_step }}</div>
                </div>
                <span class="att-p">{{ a.priority_score }}</span>
              </div>
            </div>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>

          <!-- 文字卡 -->
          <div v-else class="card sec textcard">
            <div class="sec-h">{{ c.title }}</div>
            <div class="tc-body">{{ c.note || '（暂无内容）' }}</div>
            <div class="ctl" :class="{ always: manageMode }">
              <button class="mini" @click="move(c, 'up')">↑</button>
              <button class="mini" @click="move(c, 'down')">↓</button>
              <button class="mini del" @click="removeCard(c)">✕</button>
            </div>
          </div>
        </div>

        <div v-if="manageMode || !cards.length" class="cell w-half">
          <button class="addslot" @click="addOpen = true">
            <span style="font-size:18px">＋</span>
            <span>添加卡片</span>
          </button>
        </div>
      </div>

      <!-- 看板变更记录（工程师 → 分析师） -->
      <div v-if="changes.length" class="card sec">
        <div class="sec-h">
          看板变更记录
          <span class="dim" style="font-weight:400;font-size:11px">
            每次改动都会写入「数据分析师」的会话
          </span>
        </div>
        <div v-for="c in changes" :key="c.id" class="chg">
          <span class="chg-av">{{ c.action === 'add_card' ? '＋' : '－' }}</span>
          <div class="grow">
            <div class="chg-t">{{ c.summary }}</div>
            <div class="chg-m">{{ c.from_name }} → {{ c.reports_to === 'data' ? '数据分析师' : c.reports_to }} · {{ new Date(c.at).toLocaleTimeString('zh-CN') }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加卡片 -->
    <transition name="fade">
      <div v-if="addOpen" class="modal" @click.self="addOpen = false">
        <div class="mbox card">
          <div class="mbox-h">添加看板卡片<button class="btn btn-ghost btn-sm" @click="addOpen = false">✕</button></div>
          <label class="fld">
            <span>类型</span>
            <select v-model="draft.type">
              <option v-for="t in templates" :key="t.type + t.title" :value="t.type">{{ t.title }} — {{ t.desc }}</option>
            </select>
          </label>
          <label class="fld"><span>标题</span><input v-model="draft.title" placeholder="比如：本周新增线索" /></label>
          <label class="fld"><span>原因</span><input v-model="draft.reason" placeholder="会记入变更汇报，让数据分析师知道你为什么加" /></label>
          <div class="hint">
            添加后会**汇报给数据分析师**——他是数据页的负责助手，需要知道看板变了。
          </div>
          <div class="row gap6" style="justify-content:flex-end">
            <button class="btn btn-sm" @click="addOpen = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="!draft.title.trim()" @click="addCard">添加</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 12px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.scroll { flex: 1; overflow: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 12px; }

.pending { padding: 11px 12px; border-radius: var(--r-3); background: var(--violet-soft); border: 1px solid rgba(122,106,155,.3); }
.pending-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
.op { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid rgba(122,106,155,.18); }
.op-t { font-size: 12.5px; font-weight: 550; }
.op-s { font-size: 11px; color: var(--ink-3); margin-top: 1px; }

.cards { display: flex; flex-wrap: wrap; gap: 12px; }
.cell { display: flex; }
.w-sm { flex: 1 1 calc(25% - 9px); min-width: 170px; }
.w-half { flex: 1 1 calc(50% - 6px); min-width: 300px; }
.w-full { flex: 1 1 100%; }
.cell > * { width: 100%; position: relative; }

.kpi { padding: 13px 14px; }
.kpi.warn { border-color: var(--red); background: var(--red-soft); }
.k-l { font-size: 11.5px; color: var(--ink-3); }
.k-v { font-size: 26px; font-weight: 650; letter-spacing: -1px; margin-top: 3px; font-variant-numeric: tabular-nums; }
.k-s { font-size: 11px; color: var(--ink-3); margin-top: 4px; }

.sec { padding: 13px 14px; }
.sec-h { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 11px; }
.sec-h .dim { font-weight: 400; font-size: 11px; }

.funnel { display: flex; flex-direction: column; gap: 8px; }
.fn-row { display: flex; align-items: center; gap: 9px; font-size: 12px; }
.fn-name { flex: 0 0 62px; color: var(--ink-2); }
.fn-bar { flex: 1; height: 22px; background: var(--bg-sunken); border-radius: var(--r-1); position: relative; overflow: hidden; }
.fn-fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--r-1); background: linear-gradient(90deg, rgba(192,86,33,.85), rgba(192,86,33,.55)); }
.fn-val { position: absolute; right: 8px; top: 0; bottom: 0; display: flex; align-items: center; font-weight: 600; font-size: 11.5px; }
.fn-conv { flex: 0 0 40px; text-align: right; font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.fn-conv.bad { color: var(--red); font-weight: 600; }

.bars { display: flex; flex-direction: column; gap: 7px; }
.bar-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.bar-label { flex: 0 0 66px; color: var(--ink-2); }
.bar-val { flex: 0 0 22px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.bar i.bad { background: var(--red); }

.tb { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.tb th { text-align: left; font-weight: 500; color: var(--ink-3); font-size: 11.5px; padding: 0 10px 8px; border-bottom: 1px solid var(--line); }
.tb td { padding: 8px 10px; border-bottom: 1px solid var(--line-soft); }
.od { color: var(--red); font-weight: 600; }

.att { display: flex; flex-direction: column; }
.att-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
.att-item:first-child { border-top: 0; }
.att-t { font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.att-s { font-size: 11.5px; color: var(--ink-3); margin-top: 3px; }
.att-n { font-size: 11.5px; color: var(--accent); margin-top: 3px; }
.att-p { font-size: 15px; font-weight: 650; color: var(--accent); font-variant-numeric: tabular-nums; }

.textcard .tc-body { font-size: 12.5px; line-height: 1.8; color: var(--ink-2); white-space: pre-wrap; }

.ctl {
  position: absolute; top: 6px; right: 6px; display: flex; gap: 3px;
  opacity: 0; transition: opacity .16s var(--ease);
}
.cell:hover .ctl, .ctl.always { opacity: 1; }
.mini {
  width: 20px; height: 20px; border-radius: var(--r-1); border: 1px solid var(--line);
  background: var(--surface); font-size: 10px; color: var(--ink-3); display: grid; place-items: center;
}
.mini:hover { border-color: var(--line-strong); color: var(--ink); }
.mini.del:hover { background: var(--red-soft); border-color: var(--red); color: var(--red); }

.addslot {
  border: 1px dashed var(--line-strong); border-radius: var(--r-3); background: transparent;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; min-height: 110px; color: var(--ink-3); font-size: 12px;
}
.addslot:hover { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); }

.chg { display: flex; gap: 9px; padding: 8px 0; border-top: 1px solid var(--line-soft); }
.chg:first-of-type { border-top: 0; }
.chg-av {
  width: 20px; height: 20px; border-radius: var(--r-1); flex: 0 0 20px;
  background: var(--violet-soft); color: var(--violet); display: grid; place-items: center; font-size: 11px;
}
.chg-t { font-size: 12px; line-height: 1.6; }
.chg-m { font-size: 10.5px; color: var(--ink-4); margin-top: 2px; }

.modal { position: fixed; inset: 0; background: rgba(31,27,22,.35); display: grid; place-items: center; z-index: 60; }
.mbox { width: 440px; padding: 16px; }
.mbox-h { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 650; margin-bottom: 12px; }
.fld { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 9px; font-size: 12px; }
.fld span { flex: 0 0 44px; color: var(--ink-3); padding-top: 6px; }
.fld input, .fld select {
  flex: 1; padding: 6px 9px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink); font-family: inherit;
}
.hint {
  padding: 8px 10px; border-radius: var(--r-2); background: var(--accent-soft);
  font-size: 11.5px; color: var(--accent); line-height: 1.6; margin-bottom: 10px;
}
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
