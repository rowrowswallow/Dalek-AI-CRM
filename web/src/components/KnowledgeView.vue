<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { api, track } from '../api.js';
import BatchBar from './BatchBar.vue';
import SmartInput from './SmartInput.vue';

const ctx = inject('aicrm');

const cats = ref([]);
const types = ref([]);
const stats = ref(null);
const tagList = ref([]);
const list = ref([]);
const cat = ref('all');
const type = ref('all');
const q = ref('');
const loading = ref(false);
const activeTag = ref('');
const highlight = ref(new Set());

/* ---- 批量管理 ---- */
const selected = ref(new Set());
const BATCH_ACTIONS = computed(() => [
  { key: 'category', label: '批量改分类', options: cats.value.filter((c) => c.key !== 'all').map((c) => ({ value: c.key, label: c.name })) },
  { key: 'delete', label: '删除条目', danger: true },
]);
function toggleSel(id, e) {
  e && e.stopPropagation();
  const s2 = new Set(selected.value);
  s2.has(id) ? s2.delete(id) : s2.add(id);
  selected.value = s2;
}
function selAll() {
  const ids = displayList.value.map((x) => x.id);
  selected.value = selected.value.size === ids.length ? new Set() : new Set(ids);
}
async function handleBatch({ action, value }) {
  const ids = [...selected.value];
  if (!ids.length) return;
  if (action === 'delete') { await api.batchKb(ids, 'delete'); ctx.flash(`已删除 ${ids.length} 条`); }
  else if (action === 'category') { await api.batchKb(ids, 'category', value); ctx.flash(`已移动 ${ids.length} 条`); }
  track('batch_action', { target: 'kb', action, count: ids.length });
  selected.value = new Set();
  await Promise.all([load(), loadStats()]);
}

const question = ref('');
const asking = ref(false);
const answer = ref(null);

const detail = ref(null);
const addOpen = ref(false);
const editId = ref(null);       // 非空=编辑模式
const draftTitle = ref('');
const draftContent = ref('');
const draftCat = ref('product');
const draftTags = ref('');

async function load() {
  loading.value = true;
  const params = {};
  if (cat.value !== 'all') params.category = cat.value;
  if (type.value !== 'all') params.type = type.value;
  if (q.value.trim()) params.q = q.value.trim();
  if (activeTag.value) params.tag = activeTag.value;
  const r = await api.kbList(params);
  list.value = r.list;
  loading.value = false;
}
async function loadStats() {
  const s = await api.kbStats();
  stats.value = s.stats;
  tagList.value = s.tags;
}

function pickCat(k) { cat.value = k; activeTag.value = ''; load(); track('element_click', { target: 'kb_cat', value: k }); }
function pickType(k) { type.value = k; load(); }
function pickTag(t) { activeTag.value = activeTag.value === t ? '' : t; load(); }

let timer = null;
function onSearch() {
  clearTimeout(timer);
  timer = setTimeout(() => { load(); track('ai_prompt', { scene: 'knowledge', text: q.value }); }, 260);
}

async function ask() {
  const questionText = question.value.trim();
  if (!questionText) return;
  asking.value = true;
  track('ai_prompt', { scene: 'knowledge', text: questionText, kind: 'rag' });
  const t0 = Date.now();
  const r = await api.kbAsk(questionText);
  answer.value = r;
  asking.value = false;
  highlight.value = new Set((r.sources || []).map((s) => s.id));
  track('ai_response', { scene: 'knowledge', latency_total: Date.now() - t0, sources: (r.sources || []).length });
}

async function use(id) {
  const r = await api.kbUse(id);
  const it = list.value.find((x) => x.id === id);
  if (it) it.used_count = r.used_count;
  if (detail.value && detail.value.id === id) detail.value.used_count = r.used_count;
  await loadStats();
  ctx.flash('已记录一次引用');
  track('kb_use', { id });
}

/** 引用到跟进（对客户）/ 引用到汇报（对老板）—— 这是我们与两家竞品的差异点 */
async function quoteTo(target) {
  if (!detail.value) return;
  await use(detail.value.id);
  if (target === 'report') {
    ctx.quoteForReport.value = detail.value;
    ctx.flash('已放入汇报引用，去「汇报」页查看');
    track('kb_quote', { target: 'report', id: detail.value.id });
  } else {
    ctx.quoteForFollow.value = detail.value;
    ctx.flash('已放入跟进引用，去「客户」页记录跟进时可用');
    track('kb_quote', { target: 'followup', id: detail.value.id });
  }
}

function openNew() {
  editId.value = null;
  draftTitle.value = ''; draftContent.value = ''; draftCat.value = 'product'; draftTags.value = '';
  addOpen.value = true;
}
function openEdit(it) {
  editId.value = it.id;
  draftTitle.value = it.title;
  draftContent.value = it.content;
  draftCat.value = it.category;
  draftTags.value = (it.tags || []).join(' ');
  addOpen.value = true;
  detail.value = null;
}
function onSmartFill(f) {
  if (f.title) draftTitle.value = f.title;
  if (f.content) draftContent.value = f.content;
  if (f.category) draftCat.value = f.category;
  if (Array.isArray(f.tags) && f.tags.length) draftTags.value = f.tags.join(' ');
}
async function onSmartBatch(rows) {
  const r = await api.importRows('kb', rows);
  addOpen.value = false;
  await load(); await loadStats();
  ctx.flash(`已导入 ${r.imported} 条资料${r.failed ? `，${r.failed} 条失败` : ''}`);
  track('batch_import', { entity: 'kb', count: r.imported });
}

async function add() {
  if (!draftTitle.value.trim() || !draftContent.value.trim()) return;
  const payload = {
    title: draftTitle.value.trim(),
    content: draftContent.value.trim(),
    category: draftCat.value,
    tags: draftTags.value.split(/[，,\s]+/).filter(Boolean),
  };
  if (editId.value) {
    await api.kbUpdate(editId.value, payload);
    ctx.flash('已更新');
    track('kb_edit', {});
  } else {
    await api.kbAdd(payload);
    ctx.flash('已存入知识库');
    track('kb_add', { category: draftCat.value });
  }
  addOpen.value = false;
  editId.value = null;
  draftTitle.value = ''; draftContent.value = ''; draftTags.value = '';
  await load(); await loadStats();
}
async function delOne(it) {
  if (!confirm(`删除「${it.title}」？此操作不可撤销。`)) return;
  await api.kbRemove(it.id);
  detail.value = null;
  await load(); await loadStats();
  ctx.flash('已删除');
  track('kb_delete', {});
}

const catName = (k) => (cats.value.find((c) => c.key === k) || {}).name || k;
const catIcon = (k) => (cats.value.find((c) => c.key === k) || {}).icon || '📄';

const displayList = computed(() => {
  if (!highlight.value.size) return list.value;
  const on = list.value.filter((x) => highlight.value.has(x.id));
  const off = list.value.filter((x) => !highlight.value.has(x.id));
  return [...on, ...off];
});

onMounted(async () => {
  const c = await api.kbCategories();
  cats.value = c.categories; types.value = c.types;
  await Promise.all([load(), loadStats()]);
});
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">知识库</h1>
        <p class="vh-s">
          共 {{ stats ? stats.total : 0 }} 条 · 累计被引用 {{ stats ? stats.totalUsed : 0 }} 次
          <span class="dim"> · 既能「查」也能「发」</span>
        </p>
      </div>
      <div class="row gap8">
        <input v-model="q" class="inp" placeholder="检索资料（支持自然语言）" @input="onSearch" />
        <button class="btn btn-sm" @click="selAll">
          {{ selected.size && selected.size === displayList.length ? '取消全选' : '全选' }}
        </button>
        <button class="btn btn-primary" @click="openNew">+ 新建</button>
      </div>
    </header>

    <div class="body">
      <div class="main">
        <!-- 分类 -->
        <div class="cats">
          <button class="catbtn" :class="{ on: cat === 'all' }" @click="pickCat('all')">全部</button>
          <button
            v-for="c in cats" :key="c.key" class="catbtn"
            :class="{ on: cat === c.key, star: c.star }" @click="pickCat(c.key)"
          >
            <span>{{ c.icon }}</span>{{ c.name }}
            <b>{{ stats ? (stats.byCat.find(x => x.key === c.key) || {}).count || 0 : 0 }}</b>
            <span v-if="c.star" class="star-mark" title="竞品都没有这一类">★</span>
          </button>
        </div>

        <!-- 类型 -->
        <div class="types">
          <button class="typebtn" :class="{ on: type === 'all' }" @click="pickType('all')">全部类型</button>
          <button v-for="t in types" :key="t.key" class="typebtn" :class="{ on: type === t.key }" @click="pickType(t.key)">
            {{ t.name }}<b>{{ stats ? (stats.byType.find(x => x.key === t.key) || {}).count || 0 : 0 }}</b>
          </button>
          <span v-if="activeTag" class="tag on" style="margin-left:auto">
            标签：{{ activeTag }} <span style="cursor:pointer" @click="activeTag = ''; load()">✕</span>
          </span>
        </div>

        <BatchBar
          :count="selected.size" :total="displayList.length" :actions="BATCH_ACTIONS" noun="条资料"
          @do="handleBatch" @select-all="selAll" @clear="selected = new Set()"
        />

        <!-- 素材网格（学 WeiClaw：序号 + 使用次数） -->
        <div class="grid">
          <article
            v-for="(it, i) in displayList" :key="it.id"
            class="kcard card" :class="{ hl: highlight.has(it.id), sel: selected.has(it.id) }"
            @click="detail = it"
          >
            <div class="kc-head">
              <input type="checkbox" class="cb" :checked="selected.has(it.id)"
                     @click="toggleSel(it.id, $event)" />
              <span class="kc-cat">{{ catIcon(it.category) }} {{ catName(it.category) }}</span>
              <span class="kc-no">#{{ String(i + 1).padStart(2, '0') }}</span>
            </div>
            <div class="kc-t">{{ it.title }}</div>
            <div class="kc-c">{{ it.content }}</div>
            <div class="kc-foot">
              <span v-for="t in it.tags.slice(0, 2)" :key="t" class="tag">{{ t }}</span>
              <span class="kc-use" :class="{ zero: !it.used_count }">
                {{ it.used_count ? '用 ' + it.used_count + ' 次' : '未使用' }}
              </span>
            </div>
          </article>
        </div>

        <div v-if="!list.length && !loading" class="empty">
          <div class="empty-ico">📚</div>
          <div>{{ q ? '没有找到相关资料' : '这个分类下还没有内容' }}</div>
        </div>
      </div>

      <!-- 右栏：问答 + 统计 + 标签 -->
      <aside class="side">
        <div class="card sec">
          <div class="sec-h">问知识库</div>
          <div class="ask-row">
            <input v-model="question" class="inp grow" placeholder="比如：价格异议怎么处理？" @keydown.enter="ask" />
            <button class="btn btn-accent btn-sm" :disabled="asking || !question.trim()" @click="ask">
              {{ asking ? '…' : '问' }}
            </button>
          </div>
          <div v-if="answer" class="ans fade-up">
            <div class="ans-t">回答</div>
            <div class="ans-b">{{ answer.answer }}</div>
            <div v-if="answer.sources.length" class="ans-s">
              来源：<span v-for="s in answer.sources" :key="s.id" class="tag" style="margin-right:3px">{{ s.title }}</span>
            </div>
          </div>
          <div v-else class="dim" style="font-size:11.5px;margin-top:8px">
            回答会给出引用来源，可点击左侧高亮条目核对原文。
          </div>
        </div>

        <div class="card sec">
          <div class="sec-h">用得最多的</div>
          <div v-for="(x, i) in (stats ? stats.topUsed : [])" :key="x.id" class="toprow">
            <span class="topno">{{ i + 1 }}</span>
            <span class="grow ellipsis">{{ x.title }}</span>
            <b>{{ x.used_count }}</b>
          </div>
          <div v-if="stats && stats.neverUsed" class="hint">
            有 {{ stats.neverUsed }} 条从未被引用过——没人用的资料等于没有。
          </div>
        </div>

        <div class="card sec">
          <div class="sec-h">标签</div>
          <div class="tagwrap">
            <button v-for="t in tagList" :key="t.name" class="tag tagbtn" :class="{ on: activeTag === t.name }" @click="pickTag(t.name)">
              {{ t.name }} <b>{{ t.count }}</b>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 详情 -->
    <transition name="slide">
      <aside v-if="detail" class="drawer">
        <header class="dw-head">
          <div class="grow">
            <div class="dw-t">{{ detail.title }}</div>
            <div class="dw-s">{{ catName(detail.category) }} · 被引用 {{ detail.used_count }} 次</div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="detail = null">✕</button>
        </header>
        <div class="dw-body">
          <div class="dw-tags"><span v-for="t in detail.tags" :key="t" class="tag">{{ t }}</span></div>
          <div class="content">{{ detail.content }}</div>
          <div class="row gap6">
            <button class="btn btn-sm" @click="openEdit(detail)">编辑</button>
            <button class="btn btn-sm del" @click="delOne(detail)">删除</button>
          </div>

          <div class="quote">
            <div class="quote-h">引用这条资料</div>
            <div class="row gap6">
              <button class="btn btn-sm" @click="quoteTo('followup')">引用到跟进（对客户）</button>
              <button class="btn btn-sm btn-accent" @click="quoteTo('report')">引用到汇报（对老板）★</button>
            </div>
            <div class="dim" style="font-size:11px;margin-top:7px">
              「引用到汇报」是竞品没有的路径——把资料直接带进汇报稿。
            </div>
          </div>
        </div>
      </aside>
    </transition>

    <!-- 新建 -->
    <transition name="fade">
      <div v-if="addOpen" class="modal" @click.self="addOpen = false">
        <div class="mbox card">
          <div class="mbox-h">{{ editId ? '编辑知识条目' : '新建知识条目' }}<button class="btn btn-ghost btn-sm" @click="addOpen = false">✕</button></div>

          <SmartInput v-if="!editId" entity="kb" @fill="onSmartFill" @batch="onSmartBatch" />
          <div v-if="!editId" class="or"><span>或手动填写</span></div>

          <label class="fld"><span>标题</span><input v-model="draftTitle" placeholder="比如：客户要求延长试用期怎么回" /></label>
          <label class="fld"><span>内容</span><textarea v-model="draftContent" rows="5" placeholder="写清楚结论和依据，AI 检索时会用到" /></label>
          <label class="fld">
            <span>分类</span>
            <select v-model="draftCat">
              <option v-for="c in cats" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}</option>
            </select>
          </label>
          <label class="fld"><span>标签</span><input v-model="draftTags" placeholder="用空格或逗号分隔" /></label>
          <div class="row gap6" style="justify-content:flex-end">
            <button class="btn btn-sm" @click="addOpen = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="!draftTitle.trim() || !draftContent.trim()" @click="add">{{ editId ? '更新' : '保存' }}</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.btn.del { color: var(--red); border-color: rgba(179,58,43,.3); }
.btn.del:hover { background: var(--red-soft); border-color: var(--red); }
.cb { width: 13px; height: 13px; accent-color: var(--accent); cursor: pointer; flex: 0 0 13px; }
.kcard.sel { border-color: var(--accent); background: var(--accent-soft); }
.kc-head { gap: 6px; }
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 10px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.inp {
  height: 30px; padding: 0 10px; font-size: 12.5px; width: 240px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface); outline: 0; color: var(--ink);
}
.inp:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }

.body { flex: 1; display: grid; grid-template-columns: 1fr 300px; gap: 12px; padding: 0 20px 20px; overflow: hidden; }
.main { display: flex; flex-direction: column; overflow: hidden; }
.side { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }

.cats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; }
.catbtn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-2); padding: 5px 11px; font-size: 12px; color: var(--ink-2);
  transition: all .16s var(--ease);
}
.catbtn:hover { border-color: var(--line-strong); }
.catbtn.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.catbtn b { font-weight: 500; opacity: .55; font-size: 11px; }
.catbtn.star.on { background: var(--accent); border-color: var(--accent); }
.star-mark { color: var(--accent); font-size: 10px; }
.catbtn.on .star-mark { color: #ffd9a0; }

.types { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 11px; align-items: center; }
.typebtn {
  border: 1px solid transparent; background: var(--bg-sunken); border-radius: var(--r-pill);
  padding: 3px 10px; font-size: 11.5px; color: var(--ink-2);
}
.typebtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
.typebtn b { opacity: .5; margin-left: 3px; font-weight: 500; }

.grid {
  flex: 1; overflow-y: auto; display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  align-content: start; padding-bottom: 4px;
}
.kcard { padding: 11px; cursor: pointer; transition: all .16s var(--ease); display: flex; flex-direction: column; }
.kcard:hover { box-shadow: var(--sh-3); transform: translateY(-2px); border-color: var(--line-strong); }
.kcard.hl { border-color: var(--accent); background: var(--accent-soft); }
.kc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.kc-cat { font-size: 10.5px; color: var(--ink-3); }
.kc-no { font-family: var(--mono); font-size: 10.5px; color: var(--ink-4); }
.kc-t { font-size: 12.5px; font-weight: 600; line-height: 1.5; margin-bottom: 5px; }
.kc-c {
  font-size: 11.5px; color: var(--ink-2); line-height: 1.65; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.kc-foot { display: flex; align-items: center; gap: 4px; margin-top: 9px; }
.kc-use {
  margin-left: auto; font-size: 10.5px; color: var(--accent); font-weight: 600;
  background: var(--accent-soft); padding: 1px 7px; border-radius: var(--r-1);
}
.kc-use.zero { color: var(--ink-4); background: var(--bg-sunken); font-weight: 400; }

.sec { padding: 12px 13px; }
.sec-h { font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 9px; }
.star-card { background: var(--accent-soft); border-color: var(--accent-line); }

.ask-row { display: flex; gap: 6px; }
.ask-row .inp { width: auto; }
.ans { margin-top: 9px; padding: 9px; border-radius: var(--r-2); background: var(--surface-2); }
.ans-t { font-size: 10.5px; color: var(--ink-3); margin-bottom: 4px; }
.ans-b { font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
.ans-s { font-size: 11px; color: var(--ink-3); margin-top: 8px; }

.toprow { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; border-top: 1px solid var(--line-soft); }
.toprow:first-of-type { border-top: 0; }
.topno {
  width: 16px; height: 16px; border-radius: var(--r-1); background: var(--bg-sunken);
  display: grid; place-items: center; font-size: 10px; color: var(--ink-3); flex: 0 0 16px;
}
.toprow b { color: var(--accent); font-variant-numeric: tabular-nums; }
.hint {
  margin-top: 9px; padding: 7px 9px; border-radius: var(--r-2);
  background: var(--amber-soft); font-size: 11px; color: var(--amber); line-height: 1.6;
}
.tagwrap { display: flex; flex-wrap: wrap; gap: 5px; }
.tagbtn { border: 1px solid var(--line); background: var(--surface-2); height: 22px; padding: 0 8px; font-size: 11px; }
.tagbtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
.tagbtn b { opacity: .55; margin-left: 2px; }

.drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 400px;
  background: var(--surface); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; z-index: 20; box-shadow: var(--sh-4);
}
.dw-head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line-soft); }
.dw-t { font-size: 14px; font-weight: 650; }
.dw-s { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
.dw-body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
.dw-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.content {
  font-size: 12.5px; line-height: 1.85; white-space: pre-wrap;
  padding: 12px; background: var(--surface-2); border-radius: var(--r-2); border: 1px solid var(--line-soft);
}
.quote { padding: 11px; border-radius: var(--r-2); background: var(--accent-soft); border: 1px solid var(--accent-line); }
.quote-h { font-size: 11.5px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }

.modal { position: fixed; inset: 0; background: rgba(31,27,22,.35); display: grid; place-items: center; z-index: 60; }
.mbox { width: 560px; padding: 16px; max-height: 88vh; overflow-y: auto; }
.or { display: flex; align-items: center; gap: 9px; margin: 12px 0 10px; font-size: 11px; color: var(--ink-4); }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.mbox-h { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 650; margin-bottom: 12px; }
.fld { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 9px; font-size: 12px; }
.fld span { flex: 0 0 46px; color: var(--ink-3); padding-top: 6px; }
.fld input, .fld textarea, .fld select {
  flex: 1; padding: 6px 9px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink);
  resize: vertical; font-family: inherit;
}
.fld input:focus, .fld textarea:focus, .fld select:focus { border-color: var(--accent-line); }

.slide-enter-active, .slide-leave-active { transition: transform .22s var(--ease), opacity .22s; }
.slide-enter-from, .slide-leave-to { transform: translateX(30px); opacity: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
