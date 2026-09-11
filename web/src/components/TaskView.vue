<script setup>
import { ref, computed, inject } from 'vue';
import { api, track } from '../api.js';
import BatchBar from './BatchBar.vue';
import SmartInput from './SmartInput.vue';

const props = defineProps({ pending: { type: Array, default: () => [] } });
const emit = defineEmits(['confirm', 'reject']);
const ctx = inject('aicrm');

/* ---- 批量管理 ---- */
const selected = ref(new Set());
const BATCH_ACTIONS = [
  { key: 'status', label: '改状态', options: [
    { value: 'todo', label: '待处理' }, { value: 'doing', label: '进行中' }, { value: 'done', label: '已完成' }] },
  { key: 'priority', label: '改优先级', options: [
    { value: 'high', label: '高' }, { value: 'mid', label: '中' }, { value: 'low', label: '低' }] },
  { key: 'delete', label: '删除任务', danger: true },
];
function toggleSel(id, e) {
  e && e.stopPropagation();
  const s2 = new Set(selected.value);
  s2.has(id) ? s2.delete(id) : s2.add(id);
  selected.value = s2;
}
function selAll() {
  const ids = list.value.map((x) => x.id);
  selected.value = selected.value.size === ids.length ? new Set() : new Set(ids);
}
async function handleBatch({ action, value }) {
  const ids = [...selected.value];
  if (!ids.length) return;
  await api.batchTasks(ids, action, value);
  track('batch_action', { target: 'task', action, count: ids.length });
  selected.value = new Set();
  await ctx.refreshTasks();
  const label = { delete: '已删除', status: '已改状态', priority: '已改优先级' }[action] || '已处理';
  ctx.flash(`${label} ${ids.length} 个任务`);
}

/* ---- 新建 / 编辑 / 删除 ---- */
const editOpen = ref(false);
const editing = ref(null);
const form = ref({});
const saving = ref(false);
const OWNERS = ['陈立', '赵敏', '王涛'];

function openNew() {
  editing.value = null;
  form.value = { title: '', description: '', due_at: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
                 priority: 'mid', status: 'todo', owner_name: '陈立', customer_id: '', customer_name: '' };
  editOpen.value = true;
}
function openEdit(t) {
  editing.value = t;
  form.value = { title: t.title, description: t.description || '', due_at: (t.due_at || '').slice(0, 10),
                 priority: t.priority, status: t.status, owner_name: t.owner_name || '陈立',
                 customer_id: t.customer_id || '', customer_name: t.customer_name || '' };
  editOpen.value = true;
}
function onSmartFill(f) {
  if (f.title) form.value.title = f.title;
  if (f.description) form.value.description = f.description;
  if (f.due_at) form.value.due_at = String(f.due_at).slice(0, 10);
  if (f.priority) form.value.priority = f.priority;
  if (f.owner_name) form.value.owner_name = f.owner_name;
  ctx.flash('已按识别结果填入表单');
}
async function onSmartBatch(rows) {
  const r = await api.importRows('tasks', rows);
  editOpen.value = false;
  await ctx.refreshTasks();
  ctx.flash(`已导入 ${r.imported} 个任务${r.failed ? `，${r.failed} 条失败` : ''}`);
  track('batch_import', { entity: 'tasks', count: r.imported });
}

async function saveTask() {
  if (!form.value.title.trim()) return;
  saving.value = true;
  const payload = { ...form.value, due_at: form.value.due_at ? new Date(form.value.due_at).toISOString() : null };
  if (editing.value) await api.updateTask(editing.value.id, payload);
  else await api.addTask(payload);
  saving.value = false;
  editOpen.value = false;
  await ctx.refreshTasks();
  ctx.flash(editing.value ? '任务已更新' : '任务已创建');
  track('task_save', { mode: editing.value ? 'edit' : 'create' });
}
async function delTask(t) {
  if (!confirm(`删除任务「${t.title}」？此操作不可撤销。`)) return;
  await api.removeTask(t.id);
  await ctx.refreshTasks();
  ctx.flash('任务已删除');
  track('task_delete', {});
}
const customerOptions = computed(() => (ctx.customers.value || []).slice(0, 30));

const tab = ref('all');
const view = ref('board');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待处理' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
];
const COLS = [
  { key: 'todo', label: '待处理' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
];

const counts = computed(() => {
  const l = ctx.tasks.value;
  return {
    all: l.length,
    todo: l.filter((t) => t.status === 'todo').length,
    doing: l.filter((t) => t.status === 'doing').length,
    done: l.filter((t) => t.status === 'done').length,
  };
});

const list = computed(() => {
  let l = ctx.tasks.value;
  if (tab.value !== 'all') l = l.filter((t) => t.status === tab.value);
  return [...l].sort((a, b) => {
    const w = { high: 0, mid: 1, low: 2 };
    if (w[a.priority] !== w[b.priority]) return w[a.priority] - w[b.priority];
    return a.due_at.localeCompare(b.due_at);
  });
});

const byCol = (k) => list.value.filter((t) => t.status === k);

const isOverdue = (t) => t.status !== 'done' && new Date(t.due_at) < new Date();

const fmt = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

async function move(t, status) {
  await api.updateTask(t.id, { status });
  await ctx.refreshTasks();
  track('element_click', { target: 'task_move', id: t.id, status });
}

const sourceTag = (s) =>
  s === 'ai' ? { cls: 'tag-v', txt: 'AI 生成' } :
  s === 'followup' ? { cls: 'tag-b', txt: '来自跟进' } : null;
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">任务</h1>
        <p class="vh-s">共 {{ counts.all }} 项 · 未完成 {{ counts.all - counts.done }} 项 · 支持按优先级与截止时间排序</p>
      </div>
      <div class="row gap8">
        <div class="seg">
          <button :class="{ on: view === 'board' }" @click="view = 'board'">看板</button>
          <button :class="{ on: view === 'list' }" @click="view = 'list'">列表</button>
        </div>
        <button class="btn btn-primary btn-sm" @click="openNew">+ 新建任务</button>
        <button class="btn btn-sm" @click="selAll">
          {{ selected.size && selected.size === list.length ? '取消全选' : '全选' }}
        </button>
      </div>
    </header>

    <div class="tabs">
      <button
        v-for="t in TABS" :key="t.key" class="tabbtn" :class="{ on: tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }} <b>{{ counts[t.key] }}</b>
      </button>
    </div>

    <BatchBar
      :count="selected.size" :total="list.length" :actions="BATCH_ACTIONS" noun="个任务"
      @do="handleBatch" @select-all="selAll" @clear="selected = new Set()"
    />

    <!-- AI 待确认操作 -->
    <div v-if="pending.length" class="pending fade-up">
      <div class="pending-h">
        <span class="tag tag-v">AI 拟了 {{ pending.length }} 个操作</span>
        <span class="dim">这些操作不会自动执行，确认后才会创建</span>
      </div>
      <div v-for="op in pending" :key="op.id" class="op">
        <div class="grow">
          <div class="op-t">{{ op.payload.title }}</div>
          <div class="op-s">
            {{ op.payload.customer_name || '未关联客户' }} ·
            优先级 {{ op.payload.priority === 'high' ? '高' : '中' }} ·
            截止 {{ fmt(op.payload.due_at) }}
          </div>
        </div>
        <button class="btn btn-sm btn-accent" @click="emit('confirm', op)">确认创建</button>
        <button class="btn btn-sm" @click="emit('reject', op)">忽略</button>
      </div>
    </div>

    <!-- 新建/编辑任务 -->
    <transition name="fade">
      <div v-if="editOpen" class="modal" @click.self="editOpen = false">
        <div class="mbox card">
          <div class="mbox-h">{{ editing ? '编辑任务' : '新建任务' }}<button class="btn btn-ghost btn-sm" @click="editOpen = false">✕</button></div>

          <SmartInput v-if="!editing" entity="task" @fill="onSmartFill" @batch="onSmartBatch" />
          <div v-if="!editing" class="or"><span>或手动填写</span></div>

          <label class="fld"><span>标题 *</span><input v-model="form.title" placeholder="要做什么" /></label>
          <label class="fld"><span>描述</span><textarea v-model="form.description" rows="2" /></label>
          <div class="two-col">
            <label class="fld"><span>截止日期</span><input v-model="form.due_at" type="date" /></label>
            <label class="fld"><span>优先级</span>
              <select v-model="form.priority"><option value="high">高</option><option value="mid">中</option><option value="low">低</option></select>
            </label>
          </div>
          <div class="two-col">
            <label class="fld"><span>负责人</span>
              <select v-model="form.owner_name"><option v-for="o in OWNERS" :key="o" :value="o">{{ o }}</option></select>
            </label>
            <label class="fld"><span>状态</span>
              <select v-model="form.status"><option value="todo">待处理</option><option value="doing">进行中</option><option value="done">已完成</option></select>
            </label>
          </div>
          <label class="fld"><span>关联客户</span>
            <select v-model="form.customer_id" @change="form.customer_name = (customerOptions.find(c => c.id === form.customer_id) || {}).company_name || ''">
              <option value="">不关联</option>
              <option v-for="c in customerOptions" :key="c.id" :value="c.id">{{ c.company_name }}</option>
            </select>
          </label>
          <div class="row gap6" style="justify-content:flex-end;margin-top:6px">
            <button class="btn btn-sm" @click="editOpen = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="saving || !form.title.trim()" @click="saveTask">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 看板 -->
    <div v-if="view === 'board'" class="board">
      <div v-for="c in COLS" :key="c.key" class="col">
        <div class="col-h">{{ c.label }} <b>{{ byCol(c.key).length }}</b></div>
        <div class="col-body">
          <div v-for="t in byCol(c.key)" :key="t.id" class="tcard card" :class="{ sel: selected.has(t.id) }">
            <div class="tc-top">
              <input type="checkbox" class="cb" :checked="selected.has(t.id)" @change="toggleSel(t.id, $event)" />
              <span class="pri" :class="'p-' + t.priority">{{ t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低' }}</span>
              <span v-if="isOverdue(t)" class="tag tag-r">已逾期</span>
              <span v-if="sourceTag(t.source)" class="tag" :class="sourceTag(t.source).cls">{{ sourceTag(t.source).txt }}</span>
            </div>
            <div class="tc-t">{{ t.title }}</div>
            <div class="tc-s">{{ t.customer_name || '—' }} · 截止 {{ fmt(t.due_at) }}</div>
            <div class="tc-acts">
              <button v-if="t.status !== 'done'" class="btn btn-sm btn-ghost" @click="move(t, 'done')">标记完成</button>
              <button v-else class="btn btn-sm btn-ghost" @click="move(t, 'todo')">重新打开</button>
              <button class="btn btn-sm btn-ghost" @click="openEdit(t)">编辑</button>
              <button class="btn btn-sm btn-ghost del" @click="delTask(t)">删除</button>
            </div>
          </div>
          <div v-if="!byCol(c.key).length" class="dim col-empty">暂无</div>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-else class="scroll">
      <table class="tb">
        <thead>
          <tr><th style="width:34px"></th><th style="width:36%">任务</th><th style="width:14%">关联客户</th><th style="width:8%">优先级</th><th style="width:10%">截止</th><th style="width:12%">状态</th><th style="width:12%">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in list" :key="t.id" :class="{ sel: selected.has(t.id) }">
            <td><input type="checkbox" class="cb" :checked="selected.has(t.id)" @change="toggleSel(t.id, $event)" /></td>
            <td>
              <div class="co">{{ t.title }}</div>
              <div class="co-sub">
                <span v-if="sourceTag(t.source)" class="tag" :class="sourceTag(t.source).cls">{{ sourceTag(t.source).txt }}</span>
                <span v-else class="dim">手工创建</span>
              </div>
            </td>
            <td>{{ t.customer_name || '—' }}</td>
            <td><span class="pri" :class="'p-' + t.priority">{{ t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低' }}</span></td>
            <td :class="{ od: isOverdue(t) }">{{ fmt(t.due_at) }}</td>
            <td>
              <button class="btn btn-sm" @click="move(t, t.status === 'done' ? 'todo' : 'done')">
                {{ t.status === 'done' ? '已完成 ✓' : t.status === 'doing' ? '进行中' : '待处理' }}
              </button>
            </td>
            <td>
              <button class="btn btn-sm btn-ghost" @click="openEdit(t)">编辑</button>
              <button class="btn btn-sm btn-ghost del" @click="delTask(t)">删</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!list.length" class="empty"><div class="empty-ico">✓</div><div>暂无任务</div></div>
    </div>
  </div>
</template>

<style scoped>
.modal { position: fixed; inset: 0; background: rgba(31,27,22,.35); display: grid; place-items: center; z-index: 60; }
.mbox { width: 560px; padding: 16px; max-height: 88vh; overflow-y: auto; }
.or { display: flex; align-items: center; gap: 9px; margin: 12px 0 10px; font-size: 11px; color: var(--ink-4); }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.mbox-h { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 650; margin-bottom: 12px; }
.two-col { display: flex; gap: 10px; }
.two-col .fld { flex: 1; }
.fld { display: block; margin-bottom: 9px; }
.fld > span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 5px; }
.fld input, .fld select, .fld textarea {
  width: 100%; padding: 7px 10px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink);
  font-family: inherit; resize: vertical;
}
.fld input:focus, .fld select:focus, .fld textarea:focus { border-color: var(--accent-line); }
.btn-ghost.del { color: var(--red); }
.btn-ghost.del:hover { background: var(--red-soft); }
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.cb { width: 13px; height: 13px; accent-color: var(--accent); cursor: pointer; }
.tcard.sel { border-color: var(--accent); background: var(--accent-soft); }
.tb tbody tr.sel { background: var(--accent-soft); }
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 10px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }

.seg { display: flex; border: 1px solid var(--line); border-radius: var(--r-2); overflow: hidden; }
.seg button { border: 0; background: var(--surface); padding: 6px 12px; font-size: 12px; color: var(--ink-3); }
.seg button.on { background: var(--ink); color: #fff; }

.tabs { display: flex; gap: 4px; padding: 0 20px 10px; }
.tabbtn {
  border: 1px solid transparent; background: transparent; border-radius: var(--r-pill);
  padding: 5px 12px; font-size: 12px; color: var(--ink-2);
}
.tabbtn:hover { background: var(--bg-sunken); }
.tabbtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
.tabbtn b { font-weight: 600; opacity: .65; margin-left: 3px; }

.pending {
  margin: 0 20px 12px; padding: 11px 12px; border-radius: var(--r-3);
  background: var(--violet-soft); border: 1px solid rgba(122,106,155,.3);
}
.pending-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
.op {
  display: flex; align-items: center; gap: 8px; padding: 7px 0;
  border-top: 1px solid rgba(122,106,155,.18);
}
.op-t { font-size: 12.5px; font-weight: 550; }
.op-s { font-size: 11px; color: var(--ink-3); margin-top: 1px; }

.board { flex: 1; display: flex; gap: 12px; padding: 0 20px 20px; overflow: auto; }
.col { flex: 1 0 240px; min-width: 240px; display: flex; flex-direction: column; }
.col-h {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--ink-2); font-weight: 600; padding: 0 2px 8px;
}
.col-h b { color: var(--ink-3); font-weight: 500; }
.col-body { display: flex; flex-direction: column; gap: 8px; }
.col-empty { text-align: center; padding: 18px 0; font-size: 12px; }
.tcard { padding: 10px; transition: box-shadow .16s, transform .16s; }
.tcard:hover { box-shadow: var(--sh-2); transform: translateY(-1px); }
.tc-top { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; flex-wrap: wrap; }
.tc-t { font-size: 12.5px; font-weight: 550; line-height: 1.5; }
.tc-s { font-size: 11px; color: var(--ink-3); margin-top: 5px; }
.tc-acts { margin-top: 8px; }

.pri {
  display: inline-grid; place-items: center; width: 18px; height: 18px;
  border-radius: var(--r-1); font-size: 10.5px; font-weight: 600;
}
.p-high { background: var(--red-soft); color: var(--red); }
.p-mid { background: var(--amber-soft); color: var(--amber); }
.p-low { background: var(--bg-sunken); color: var(--ink-3); }

.scroll { flex: 1; overflow: auto; padding: 0 20px 20px; }
.tb { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.tb th { text-align: left; font-weight: 500; color: var(--ink-3); font-size: 11.5px; padding: 0 10px 8px; border-bottom: 1px solid var(--line); }
.tb td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft); }
.co { font-weight: 550; }
.co-sub { font-size: 11px; color: var(--ink-3); margin-top: 3px; }
.od { color: var(--red); font-weight: 600; }
</style>
