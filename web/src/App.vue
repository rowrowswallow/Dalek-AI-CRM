<script setup>
import { ref, computed, onMounted, provide } from 'vue';
import ChatWorkbench from './components/ChatWorkbench.vue';
import CustomerView from './components/CustomerView.vue';
import TagView from './components/TagView.vue';
import TaskView from './components/TaskView.vue';
import DataView from './components/DataView.vue';
import ReportView from './components/ReportView.vue';
import KnowledgeView from './components/KnowledgeView.vue';
import AssistantView from './components/AssistantView.vue';
import SettingsView from './components/SettingsView.vue';
import Login from './components/Login.vue';
import Register from './components/Register.vue';
import { api, track } from './api.js';

/* ---------------------------------------------------------- 一级导航 */
const ALL_NAV = [
  { key: 'customer',  label: '客户',    ico: '👤' },
  { key: 'knowledge', label: '知识库',   ico: '📚' },
  { key: 'tag',       label: '标签画像', ico: '◎' },
  { key: 'task',      label: '任务',    ico: '✓' },
  { key: 'data',      label: '数据',    ico: '▤' },
  { key: 'report',    label: '汇报',    ico: '✎' },
  { key: 'assistant', label: 'AI 助手', ico: '✦' },
  { key: 'settings',  label: '设置',    ico: '⚙' },
];

/* 场景 → AI 员工：跟随而非选择 */
const SCENE_OF_NAV = {
  customer: 'customer', knowledge: 'knowledge', tag: 'tag',
  task: 'task', data: 'data', report: 'report',
  assistant: 'customer', settings: 'customer',
};

/* ---------------------------------------------------------- 账号 */
const user = ref(null);
const booting = ref(true);
const authMode = ref('login');   // login | register
const nav = ref('customer');

const NAV = computed(() => {
  if (!user.value) return ALL_NAV;
  return ALL_NAV.filter((n) => user.value.nav.includes(n.key));
});
const scene = computed(() => SCENE_OF_NAV[nav.value] || 'customer');

function bootNav() {
  const allowed = [...((user.value && user.value.nav) || ALL_NAV.map((n) => n.key)), 'settings'];
  if (!allowed.includes(nav.value)) {
    nav.value = allowed.includes('customer') ? 'customer' : allowed[0];
  }
}

function onLogin(u) { user.value = u; bootNav(); }

async function logout() {
  try { await api.logout(); } catch {}
  localStorage.removeItem('aicrm:token');
  localStorage.removeItem('aicrm:user');
  user.value = null;
}

/* ---------------------------------------------------------- 全局状态 */
const meta = ref({ aiMode: 'rule' });
const stats = ref(null);
const customers = ref([]);
const tags = ref([]);
const tasks = ref([]);
const cards = ref([]);
const cardTemplates = ref([]);
const toast = ref('');
const filter = ref(null);
const highlightId = ref(null);
const pendingOps = ref([]);
const quoteForFollow = ref(null);
const quoteForReport = ref(null);

/** 「AI 助手管理」页打开历史会话 → 传给对话工作台 */
const conversationToOpen = ref(null);
function openConversation(conv) {
  conversationToOpen.value = conv;
  track('conversation_open', { id: conv.id });
}

function flash(msg) {
  toast.value = msg;
  setTimeout(() => { if (toast.value === msg) toast.value = ''; }, 2400);
}

async function loadAll() {
  const [m, s, c, t, k, d] = await Promise.all([
    api.meta(), api.stats(), api.customers(), api.tags(), api.tasks(), api.cards(),
  ]);
  meta.value = m; stats.value = s.stats;
  customers.value = c.list; tags.value = t.groups; tasks.value = k.list;
  cards.value = d.cards; cardTemplates.value = d.templates;
}

/* ---------------------------------------------------------- 对话动作 */
function handleActions(actions) {
  actions.forEach((a) => {
    if (a.type === 'filter_customers') {
      filter.value = a.payload; nav.value = 'customer';
      flash(`已筛选 ${a.payload.ids.length} 家客户`);
      track('ai_action_applied', { type: a.type, count: a.payload.ids.length });
    } else if (a.type === 'goto') {
      nav.value = a.payload.view;
    } else if (a.type === 'kb_highlight') {
      nav.value = 'knowledge';
      flash(`已高亮 ${a.payload.ids.length} 条相关资料`);
    } else if (a.type === 'kb_add') {
      pendingOps.value.push({ id: 'op' + Date.now() + Math.random(), kind: 'kb', payload: a.payload });
      nav.value = 'knowledge';
    } else if (a.type === 'create_task') {
      pendingOps.value.push({ id: 'op' + Date.now() + Math.random(), kind: 'task', payload: a.payload });
      nav.value = 'task';
    } else if (a.type === 'dash_add_card') {
      pendingOps.value.push({ id: 'op' + Date.now() + Math.random(), kind: 'card_add', payload: a.payload });
    } else if (a.type === 'dash_remove_card') {
      pendingOps.value.push({ id: 'op' + Date.now() + Math.random(), kind: 'card_remove', payload: a.payload });
    } else if (a.type === 'dash_reset') {
      pendingOps.value.push({ id: 'op' + Date.now() + Math.random(), kind: 'card_reset', payload: a.payload });
    } else if (a.type === 'dash_reorder') {
      api.reorderCard(a.payload.id, a.payload.dir).then(async () => {
        cards.value = (await api.cards()).cards;
        flash('卡片顺序已调整');
      });
    }
  });
}

async function confirmOp(op) {
  if (op.kind === 'kb') {
    await api.kbAdd({ ...op.payload, category: op.payload.category || 'product' });
    flash('已存入知识库');
  } else if (op.kind === 'task') {
    await api.addTask(op.payload);
    tasks.value = (await api.tasks()).list;
    flash('任务已创建');
  } else if (op.kind === 'card_add') {
    const r = await api.addCard(op.payload);
    cards.value = (await api.cards()).cards;
    flash(`已添加「${r.card.title}」，并已汇报给数据分析师`);
  } else if (op.kind === 'card_remove') {
    await api.removeCard(op.payload.id, op.payload.reason);
    cards.value = (await api.cards()).cards;
    flash(`已移除「${op.payload.title}」，并已汇报给数据分析师`);
  } else if (op.kind === 'card_reset') {
    const r = await api.resetCards();
    cards.value = r.cards;
    flash('看板已恢复默认，并已汇报给数据分析师');
  }
  pendingOps.value = pendingOps.value.filter((x) => x.id !== op.id);
  track('ai_suggestion_feedback', { type: op.kind, action: 'accepted' });
}
function rejectOp(op) {
  pendingOps.value = pendingOps.value.filter((x) => x.id !== op.id);
  flash('已忽略该建议');
  track('ai_suggestion_feedback', { type: op.kind, action: 'ignored' });
}

/* ---------------------------------------------------------- provide */
provide('aicrm', {
  user, customers, tags, tasks, stats, filter, highlightId,
  quoteForFollow, quoteForReport, cards, cardTemplates,
  refreshTasks: async () => { tasks.value = (await api.tasks()).list; },
  refreshCustomers: async () => { customers.value = (await api.customers()).list; },
  refreshCards: async () => { cards.value = (await api.cards()).cards; },
  openConversation, flash, track,
  reloadMeta: async () => { meta.value = await api.meta(); },
});

onMounted(async () => {
  const t = localStorage.getItem('aicrm:token');
  if (t) {
    try {
      const r = await api.me();
      if (r.ok) { user.value = r.user; bootNav(); }
    } catch {}
  }
  booting.value = false;
  if (user.value) await loadAll().catch(() => {});
  track('page_view', { page: 'workbench' });
});
</script>

<template>
  <div v-if="booting" class="boot">正在加载…</div>

  <Register v-else-if="!user && authMode === 'register'" @ok="onLogin" @back="authMode = 'login'" />
  <Login    v-else-if="!user" @ok="onLogin" @register="authMode = 'register'" />

  <div v-else class="shell">
    <aside class="rail">
      <div class="rail-logo" title="AICRM">A</div>
      <button
        v-for="n in NAV" :key="n.key"
        class="rail-item" :class="{ on: nav === n.key }" :title="n.label"
        @click="nav = n.key; track('element_click', { target: 'nav', value: n.key })"
      >
        <span class="rail-ico">{{ n.ico }}</span>
        <span class="rail-label">{{ n.label }}</span>
      </button>
      <div class="rail-spacer" />
      <a class="rail-item rail-link" href="/drawer.html" target="_blank" title="打开企微抽屉演示">
        <span class="rail-ico">▯</span><span class="rail-label">抽屉</span>
      </a>
      <div class="rail-user" @click="logout" title="点击退出登录">
        <span class="ru-av">{{ user.avatar }}</span>
        <span class="ru-n">{{ user.name }}</span>
      </div>
    </aside>

    <ChatWorkbench
      :scene="scene" :user="user" :conversation-to-open="conversationToOpen"
      @actions="handleActions"
      @consumed="conversationToOpen = null"
    />

    <main class="work">
      <CustomerView   v-if="nav === 'customer'" />
      <KnowledgeView  v-else-if="nav === 'knowledge'" />
      <TagView        v-else-if="nav === 'tag'" />
      <TaskView       v-else-if="nav === 'task'" :pending="pendingOps"
                      @confirm="confirmOp" @reject="rejectOp" />
      <DataView       v-else-if="nav === 'data'" :pending="pendingOps"
                      @confirm="confirmOp" @reject="rejectOp" />
      <ReportView     v-else-if="nav === 'report'" />
      <AssistantView  v-else-if="nav === 'assistant'" />
      <SettingsView   v-else-if="nav === 'settings'" />
    </main>

    <div class="demo-switch" :title="`当前身份：${user.role_name} · ${user.title}`">
      <span class="dim">{{ user.name }}</span>
      <b :class="user.role">{{ user.role_name }}</b>
      <span class="dim">·</span>
      <b :class="meta.aiMode">{{ meta.aiMode === 'model' ? '模型' : '规则' }}</b>
    </div>

    <transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.boot { display: grid; place-items: center; height: 100vh; color: var(--ink-3); font-size: 13px; }
.shell { display: flex; height: 100vh; overflow: hidden; background: var(--bg); }

.rail {
  width: var(--rail-w); flex: 0 0 var(--rail-w);
  background: var(--surface); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 2px;
}
.rail-logo {
  width: 32px; height: 32px; border-radius: var(--r-2); background: var(--ink); color: #fff;
  display: grid; place-items: center; font-size: 15px; font-weight: 700;
  margin-bottom: 12px; letter-spacing: -0.5px;
}
.rail-item {
  width: 46px; padding: 7px 0 5px; border: 0; background: transparent;
  border-radius: var(--r-2); display: flex; flex-direction: column;
  align-items: center; gap: 3px; color: var(--ink-3);
  transition: all .16s var(--ease); text-decoration: none;
}
.rail-item:hover { background: var(--bg-sunken); color: var(--ink-2); }
.rail-item.on { background: var(--accent-soft); color: var(--accent); }
.rail-ico { font-size: 15px; line-height: 1; }
.rail-label { font-size: 10.5px; letter-spacing: .2px; }
.rail-spacer { flex: 1; }
.rail-user {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 0 6px; cursor: pointer; border-radius: var(--r-2); width: 46px;
}
.rail-user:hover { background: var(--bg-sunken); }
.ru-av {
  width: 24px; height: 24px; border-radius: 50%; background: var(--accent-soft);
  color: var(--accent); display: grid; place-items: center; font-size: 11px; font-weight: 600;
}
.ru-n { font-size: 10px; color: var(--ink-3); }

.work { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }

.demo-switch {
  position: fixed; right: 12px; bottom: 10px; z-index: 40;
  display: flex; align-items: center; gap: 4px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-pill); padding: 3px 10px; font-size: 11px; box-shadow: var(--sh-1);
}
.demo-switch b { font-weight: 600; }
.demo-switch b.model { color: var(--green); }
.demo-switch b.rule { color: var(--amber); }
.demo-switch b.owner { color: var(--accent); }
.demo-switch b.sales { color: var(--blue); }
.demo-switch b.boss { color: var(--violet); }

.toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: var(--ink); color: #fff; font-size: 12.5px;
  padding: 8px 16px; border-radius: var(--r-pill); z-index: 90; box-shadow: var(--sh-3);
}
.fade-enter-active, .fade-leave-active { transition: opacity .2s, transform .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }
</style>
