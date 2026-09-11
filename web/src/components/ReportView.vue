<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { api, track } from '../api.js';

const ctx = inject('aicrm');
const range = ref('week');
const loading = ref(false);
const report = ref(null);
const edited = ref('');
const generatedAt = ref(null);
const copied = ref(false);

const s = computed(() => ctx.stats.value || {});
const openTasks = computed(() =>
  ctx.tasks.value.filter((t) => t.status !== 'done')
    .sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 6));

async function gen() {
  loading.value = true;
  const r = await api.report(range.value);
  report.value = r.report;
  edited.value = r.report.sections.map((x) => `${x.heading}\n${x.body}`).join('\n\n');
  generatedAt.value = new Date();
  loading.value = false;
  track('report_generate', { range: range.value, sections: r.report.sections.length });
}

async function copy() {
  try {
    await navigator.clipboard.writeText(`${report.value.title}\n\n${edited.value}`);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
    track('report_export', { action: 'copy' });
  } catch { ctx.flash('复制失败，请手动选择文本'); }
}

function download() {
  const blob = new Blob([`${report.value.title}\n\n${edited.value}`], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${report.value.title}.txt`;
  a.click();
  track('report_export', { action: 'download' });
}

const editedRatio = computed(() => {
  if (!report.value) return null;
  const orig = report.value.sections.map((x) => `${x.heading}\n${x.body}`).join('\n\n');
  if (!orig.length) return null;
  let same = 0;
  for (let i = 0; i < Math.min(orig.length, edited.value.length); i++) if (orig[i] === edited.value[i]) same++;
  return Math.round(same / orig.length * 100);
});

onMounted(() => { if (!report.value) gen(); });
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">一键汇报</h1>
        <p class="vh-s">数据进 → 归因结论 + 汇报稿出 · 右侧是同期工作进度</p>
      </div>
      <div class="row gap8">
        <div class="seg">
          <button :class="{ on: range === 'week' }" @click="range = 'week'; gen()">本周</button>
          <button :class="{ on: range === 'month' }" @click="range = 'month'; gen()">本月</button>
        </div>
        <button class="btn btn-primary" :disabled="loading" @click="gen">
          {{ loading ? '生成中…' : '重新生成' }}
        </button>
      </div>
    </header>

    <div class="body">
      <!-- 左：汇报稿 -->
      <div class="left">
        <div class="card doc">
          <div class="doc-head">
            <div>
              <div class="doc-t">{{ report ? report.title : '生成中…' }}</div>
              <div class="doc-s" v-if="generatedAt">
                生成于 {{ generatedAt.toLocaleTimeString('zh-CN') }}
                <span v-if="editedRatio !== null"> · 当前编辑幅度 {{ 100 - editedRatio }}%</span>
              </div>
            </div>
            <div class="row gap6">
              <button class="btn btn-sm" @click="copy">{{ copied ? '已复制 ✓' : '复制' }}</button>
              <button class="btn btn-sm" @click="download">导出</button>
            </div>
          </div>
          <textarea v-model="edited" class="doc-edit" spellcheck="false" />
          <div class="doc-foot">
            <span class="dim">汇报稿可直接编辑；复制后即可发到微信</span>
            <span class="tag tag-g">已由你确认</span>
          </div>
        </div>

        <div class="card sec">
          <div class="sec-h">本期关键数字</div>
          <div class="mini-kpis">
            <div><b>{{ s.followWeek || 0 }}</b><span>本周跟进</span></div>
            <div><b>{{ s.high || 0 }}</b><span>高意向客户</span></div>
            <div :class="{ warn: s.risk > 5 }"><b>{{ s.risk || 0 }}</b><span>流失风险</span></div>
            <div><b>{{ s.taskDone || 0 }}/{{ s.taskTotal || 0 }}</b><span>任务完成</span></div>
          </div>
        </div>
      </div>

      <!-- 右：工作进度可视化（与面板同屏） -->
      <div class="right">
        <div class="card sec">
          <div class="sec-h">汇报时的工作进度</div>
          <div class="prog">
            <div v-for="t in openTasks" :key="t.id" class="prog-item">
              <span class="prog-dot" :class="{ od: new Date(t.due_at) < new Date() }" />
              <div class="grow">
                <div class="prog-t">{{ t.title }}</div>
                <div class="prog-s">{{ t.customer_name || '—' }} · 截止 {{ new Date(t.due_at).getMonth() + 1 }}/{{ new Date(t.due_at).getDate() }}</div>
              </div>
            </div>
            <div v-if="!openTasks.length" class="dim">所有任务已完成</div>
          </div>
        </div>

        <div class="card sec">
          <div class="sec-h">需要向老板解释的</div>
          <div class="expl">
            <div v-for="c in (s.attention || []).slice(0, 3)" :key="c.id" class="expl-item">
              <div class="expl-t">{{ c.company_name }}</div>
              <div class="expl-s">{{ c.ai_insight }}</div>
            </div>
          </div>
          <div class="hint">这些问题已自动写进汇报稿「二、需要关注的问题」段落。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 12px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.seg { display: flex; border: 1px solid var(--line); border-radius: var(--r-2); overflow: hidden; }
.seg button { border: 0; background: var(--surface); padding: 6px 12px; font-size: 12px; color: var(--ink-3); }
.seg button.on { background: var(--ink); color: #fff; }

.body { flex: 1; display: grid; grid-template-columns: 1.45fr 1fr; gap: 12px; padding: 0 20px 20px; overflow: hidden; }
.left, .right { display: flex; flex-direction: column; gap: 12px; overflow: auto; }

.doc { display: flex; flex-direction: column; overflow: hidden; }
.doc-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--line-soft);
}
.doc-t { font-size: 14px; font-weight: 650; }
.doc-s { font-size: 11px; color: var(--ink-3); margin-top: 3px; }
.doc-edit {
  border: 0; outline: 0; resize: none; padding: 14px; min-height: 360px;
  font-size: 12.5px; line-height: 1.85; color: var(--ink); background: var(--surface);
  font-family: var(--font);
}
.doc-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; border-top: 1px solid var(--line-soft); background: var(--surface-2);
  font-size: 11px;
}

.sec { padding: 13px 14px; }
.sec-h { font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 10px; }

.mini-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.mini-kpis > div { text-align: center; padding: 8px 0; border-radius: var(--r-2); background: var(--surface-2); }
.mini-kpis > div.warn { background: var(--red-soft); }
.mini-kpis b { display: block; font-size: 18px; font-weight: 650; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.mini-kpis span { font-size: 10.5px; color: var(--ink-3); }

.prog { display: flex; flex-direction: column; }
.prog-item { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-top: 1px solid var(--line-soft); }
.prog-item:first-child { border-top: 0; }
.prog-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-top: 5px; flex: 0 0 7px; }
.prog-dot.od { background: var(--red); }
.prog-t { font-size: 12px; font-weight: 550; line-height: 1.5; }
.prog-s { font-size: 11px; color: var(--ink-3); margin-top: 2px; }

.expl { display: flex; flex-direction: column; gap: 9px; }
.expl-item { padding-left: 9px; border-left: 2px solid var(--red); }
.expl-t { font-size: 12px; font-weight: 600; }
.expl-s { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; line-height: 1.55; }
.hint {
  margin-top: 11px; padding: 8px 10px; border-radius: var(--r-2);
  background: var(--accent-soft); font-size: 11.5px; color: var(--accent); line-height: 1.6;
}
</style>
