<script setup>
import { computed, inject, ref } from 'vue';
import { api, track } from '../api.js';

const ctx = inject('aicrm');
const picked = ref(new Set());
const showDetail = ref(false);

const all = computed(() => ctx.customers.value);

const groupStats = computed(() =>
  ctx.tags.value.map((g) => ({
    ...g,
    items: g.tags.map((t) => ({ name: t, count: all.value.filter((c) => c.tags.includes(t)).length })),
  })));

const industryStats = computed(() => {
  const m = {};
  all.value.forEach((c) => { m[c.industry] = (m[c.industry] || 0) + 1; });
  const arr = Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const max = Math.max(...arr.map((x) => x.value), 1);
  return arr.map((x) => ({ ...x, pct: Math.round(x.value / max * 100) }));
});

const levelStats = computed(() => {
  const lv = { high: '高意向', mid: '中意向', low: '低意向' };
  const arr = Object.entries(lv).map(([k, name]) => ({
    key: k, name, value: all.value.filter((c) => c.level === k).length,
  }));
  const max = Math.max(...arr.map((x) => x.value), 1);
  return arr.map((x) => ({ ...x, pct: Math.round(x.value / max * 100) }));
});

const matched = computed(() => {
  if (!picked.value.size) return [];
  return all.value.filter((c) => [...picked.value].every((t) => c.tags.includes(t)));
});

function toggle(t) {
  const s = new Set(picked.value);
  s.has(t) ? s.delete(t) : s.add(t);
  picked.value = s;
  track('element_click', { target: 'tag_filter', value: t, active: s.has(t) });
}

async function tagMatched() {
  if (!matched.value.length) return;
  await api.batchTag(matched.value.map((c) => c.id), ['方案沟通']);
  await ctx.refreshCustomers();
  ctx.flash(`已为 ${matched.value.length} 家客户打标`);
}

const levelCls = (k) => (k === 'high' ? 'g' : k === 'mid' ? 'b' : 'a');
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">标签画像</h1>
        <p class="vh-s">{{ ctx.tags.value.length }} 个标签组 · {{ all.length }} 家客户</p>
      </div>
      <div class="row gap8">
        <button class="btn" :class="{ 'btn-accent': picked.size }" @click="showDetail = !showDetail">
          {{ showDetail ? '隐藏细分' : '查看细分' }}
        </button>
      </div>
    </header>

    <div class="scroll">
      <!-- 意向度分布 -->
      <div class="card sec">
        <div class="sec-h">意向度分布</div>
        <div class="bars">
          <div v-for="l in levelStats" :key="l.key" class="bar-row">
            <span class="bar-label">{{ l.name }}</span>
            <div class="bar grow"><i :style="{ width: l.pct + '%' }" :class="'f-' + levelCls(l.key)" /></div>
            <span class="bar-val">{{ l.value }}</span>
          </div>
        </div>
      </div>

      <!-- 标签组 -->
      <div class="card sec">
        <div class="sec-h">
          标签体系
          <span class="dim" style="font-weight:400;font-size:11.5px">点击标签可筛选客户，可多选</span>
        </div>
        <div v-for="g in groupStats" :key="g.group" class="tgroup">
          <div class="tg-name">{{ g.group }}</div>
          <div class="tg-items">
            <button
              v-for="it in g.items" :key="it.name"
              class="tag tagbtn" :class="{ on: picked.has(it.name) }"
              @click="toggle(it.name)"
            >
              {{ it.name }} <b>{{ it.count }}</b>
            </button>
          </div>
        </div>

        <div v-if="picked.size" class="picked fade-up">
          <div class="picked-h">
            已选 {{ picked.size }} 个标签 · 命中 <b>{{ matched.length }}</b> 家客户
            <div class="row gap6">
              <button class="btn btn-sm" :disabled="!matched.length" @click="tagMatched">批量打标</button>
              <button class="btn btn-sm btn-ghost" @click="picked = new Set()">清空</button>
            </div>
          </div>
          <div v-if="matched.length" class="picked-list">
            <span v-for="c in matched.slice(0, 12)" :key="c.id" class="tag">{{ c.company_name }}</span>
            <span v-if="matched.length > 12" class="dim">…共 {{ matched.length }} 家</span>
          </div>
          <div v-else class="dim">没有同时命中这些标签的客户</div>
        </div>
      </div>

      <!-- 行业分布 -->
      <div class="card sec">
        <div class="sec-h">行业分布</div>
        <div class="bars">
          <div v-for="i in industryStats" :key="i.name" class="bar-row">
            <span class="bar-label">{{ i.name }}</span>
            <div class="bar grow"><i :style="{ width: i.pct + '%' }" /></div>
            <span class="bar-val">{{ i.value }}</span>
          </div>
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
.scroll { flex: 1; overflow: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 12px; }

.sec { padding: 13px 14px; }
.sec-h {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 11px;
}
.bars { display: flex; flex-direction: column; gap: 7px; }
.bar-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.bar-label { flex: 0 0 72px; color: var(--ink-2); }
.bar-val { flex: 0 0 26px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.bar i.f-g { background: var(--green); }
.bar i.f-b { background: var(--blue); }
.bar i.f-a { background: var(--amber); }

.tgroup { padding: 8px 0; border-top: 1px solid var(--line-soft); }
.tgroup:first-of-type { border-top: 0; }
.tg-name { font-size: 11.5px; color: var(--ink-3); margin-bottom: 6px; }
.tg-items { display: flex; flex-wrap: wrap; gap: 6px; }
.tagbtn { border: 1px solid var(--line); background: var(--surface-2); height: 23px; padding: 0 9px; }
.tagbtn:hover { border-color: var(--line-strong); }
.tagbtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
.tagbtn b { font-weight: 600; opacity: .6; margin-left: 2px; }

.picked {
  margin-top: 12px; padding: 11px; border-radius: var(--r-2);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.picked-h { display: flex; align-items: center; justify-content: space-between; font-size: 12px; gap: 8px; flex-wrap: wrap; }
.picked-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
</style>
