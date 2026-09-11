<script setup>
import { ref, computed, watch, nextTick, onMounted, inject } from 'vue';
import { api, chatStream, track } from '../api.js';

const props = defineProps({
  scene: { type: String, default: 'customer' },
  user: { type: Object, default: null },
  conversationToOpen: { type: Object, default: null },
});
const emit = defineEmits(['actions', 'consumed']);
const ctx = inject('aicrm', null);

/** 给模型喂一份精简的业务快照，否则它答不了「这批客户」这类指代 */
function snapshot() {
  if (!ctx) return {};
  const cs = (ctx.customers.value || []).slice(0, 12).map((c) => ({
    n: c.company_name, i: c.industry, s: c.status, st: c.stage,
    d: c.days_since_follow, p: c.priority_score, t: c.tags.slice(0, 3),
  }));
  const ts = (ctx.tasks.value || []).filter((t) => t.status !== 'done').slice(0, 8)
    .map((t) => ({ n: t.title, c: t.customer_name, pri: t.priority, due: (t.due_at || '').slice(0, 10) }));
  const st = ctx.stats.value || {};
  return {
    统计: { 客户总数: st.total, 高意向: st.high, 流失风险: st.risk, 本周跟进: st.followWeek, 任务完成: st.taskDone + '/' + st.taskTotal },
    客户样本: cs,
    未完成任务: ts,
    阶段分布: st.byStage,
  };
}

/* ---------------------------------------------------- 状态 */
const collapsed = ref(false);
const assistants = ref([]);          // 当前场景下的助手（可能不止一个）
const current = ref(null);           // 当前助手
const conversations = ref([]);       // 当前助手的会话列表
const conv = ref(null);              // 当前会话
const messages = ref([]);
const input = ref('');
const streaming = ref(false);
const controller = ref(null);
const scroller = ref(null);
const lastLatency = ref(null);
const showConvList = ref(false);
const atts = ref([]);              // 待发送的附件
const attInput = ref(null);
const attBusy = ref(false);

/* ---------------------------------------------------- 加载 */
async function loadScene(scene) {
  const r = await api.assistants();
  assistants.value = (r.list || []).filter((a) => a.scene === scene && a.enabled);
  if (!assistants.value.length) {
    assistants.value = (r.list || []).filter((a) => a.enabled).slice(0, 1);
  }
  // 默认选第一个（页面负责助手）；若场景内已有选中的助手则保留
  if (!current.value || !assistants.value.some((a) => a.id === current.value.id)) {
    current.value = assistants.value[0] || null;
  }
  await loadConversations();
}

async function loadConversations() {
  if (!current.value) return;
  const r = await api.conversations(current.value.id);
  conversations.value = r.list || [];
  if (conv.value && !conversations.value.some((c) => c.id === conv.value.id)) conv.value = null;
  if (!conv.value && conversations.value.length) await selectConv(conversations.value[0]);
  if (!conv.value && !conversations.value.length) {
    const n = await api.newConversation(current.value.id, '新对话', {});
    conv.value = n.conversation;
    conversations.value = [{ id: n.conversation.id, title: n.conversation.title, message_count: 0 }];
    messages.value = [];
  }
}

async function selectConv(c) {
  const r = await api.conversation(c.id);
  if (!r.ok) return;
  conv.value = r.conversation;
  messages.value = r.conversation.messages.map((m) => ({ ...m, streaming: false }));
  showConvList.value = false;
  scrollDown();
  track('conversation_switch', { id: c.id, assistant: current.value && current.value.id });
}

async function newConv() {
  if (!current.value) return;
  const n = await api.newConversation(current.value.id, '新对话', {});
  conv.value = n.conversation;
  messages.value = [];
  await loadConversations();
  showConvList.value = false;
}

async function switchAssistant(a) {
  if (a.id === (current.value && current.value.id)) return;
  current.value = a;
  conv.value = null;
  messages.value = [];
  await loadConversations();
  track('assistant_switch', { id: a.id, scene: props.scene });
}

/* 场景切换 → 切助手（跟随而非选择） */
watch(() => props.scene, async (s, old) => {
  if (s === old) return;
  current.value = null;
  conv.value = null;
  messages.value = [];
  await loadScene(s);
  track('scene_switch', { from: old, to: s, employee: current.value && current.value.name });
});

/* 从「AI 助手管理」打开历史会话 */
watch(() => props.conversationToOpen, async (c) => {
  if (!c) return;
  const r = await api.conversation(c.id);
  if (r.ok) {
    const a = assistants.value.find((x) => x.id === c.assistant_id);
    if (a) current.value = a;
    else {
      const ar = await api.assistant(c.assistant_id);
      if (ar.ok) assistants.value = [...assistants.value, ar.assistant];
      current.value = ar.ok ? ar.assistant : current.value;
    }
    await loadConversations();
    await selectConv(c);
  }
  emit('consumed');
});

/* ---------------------------------------------------- 消息 */
/* ---------------------------------------------------- 附件 */
function pickAtt() { attInput.value && attInput.value.click(); }

async function onAtt(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  attBusy.value = true;
  for (const f of files) {
    if (atts.value.length >= 5) { ctx && ctx.flash && ctx.flash('最多 5 个附件'); break; }
    if (f.size > 4 * 1024 * 1024) { ctx && ctx.flash && ctx.flash(`${f.name} 超过 4MB，已跳过`); continue; }
    const isImg = /^image\//.test(f.type);
    const isText = /^text\//.test(f.type) || /\.(txt|md|csv|json|log)$/i.test(f.name);
    if (isImg) {
      const content = await new Promise((res) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f);
      });
      atts.value.push({ type: 'image', name: f.name, size: f.size, content });
    } else if (isText) {
      const content = await f.text();
      atts.value.push({ type: 'text', name: f.name, size: f.size, content: content.slice(0, 20000) });
    } else {
      // 其他类型当纯文本尝试读
      try {
        const content = await f.text();
        atts.value.push({ type: 'text', name: f.name, size: f.size, content: content.slice(0, 20000) });
      } catch {
        ctx && ctx.flash && ctx.flash(`${f.name} 暂不支持，请转成图片或文本`);
      }
    }
  }
  attBusy.value = false;
  track('chat_attach', { count: atts.value.length });
}

function removeAtt(i) { atts.value.splice(i, 1); }

function scrollDown() {
  nextTick(() => { const el = scroller.value; if (el) el.scrollTop = el.scrollHeight; });
}

async function send(text) {
  const t = (text ?? input.value).trim();
  if (!t || streaming.value || !conv.value || !current.value) return;
  input.value = '';

  const userMsg = { id: 'tmp' + Date.now(), role: 'user', text: t };
  messages.value.push(userMsg);
  track('ai_prompt', { scene: props.scene, assistant: current.value.id, len: t.length, text: t });

  const sentAtts = atts.value.slice();
  if (sentAtts.length) {
    messages.value[messages.value.length - 1].atts = sentAtts.map((a) => ({ type: a.type, name: a.name }));
  }
  atts.value = [];

  const holder = { id: 'a' + Date.now(), role: 'assistant', text: '', streaming: true };
  messages.value.push(holder);
  streaming.value = true;
  controller.value = new AbortController();
  scrollDown();

  await chatStream({
    scene: current.value.id,          // ← 用助手 id 作为场景，保证助手与能力一致
    text: t,
    context: { conversation_id: conv.value.id, snapshot: snapshot() },
    attachments: atts.value.map((a) => ({ type: a.type, name: a.name, content: a.content })),
    assistantId: current.value.id,
    conversationId: conv.value.id,
    signal: controller.value.signal,
    onDelta: (d, full) => { holder.text = full; scrollDown(); },
    onAction: (actions) => {
      if (actions.length) emit('actions', actions);
      track('function_call', { assistant: current.value.id, actions: actions.map((a) => a.type) });
    },
    onDone: (m) => {
      holder.streaming = false;
      lastLatency.value = { first: m.firstTokenMs, total: m.totalMs };
      track('ai_response', {
        assistant: current.value.id, latency_first: m.firstTokenMs,
        latency_total: m.totalMs, len: holder.text.length,
      });
      if (conv.value.title === '新对话') loadConversations();
    },
    onError: (e) => {
      holder.streaming = false;
      holder.text = holder.text || '（请求失败：' + (e.message || '未知错误') + '）';
      track('error_event', { assistant: current.value.id, message: e.message });
    },
  });

  // 落库：把本轮问答写进会话
  try {
    await fetch('/api/conversations/' + conv.value.id + '/append', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AICRM-Token': localStorage.getItem('aicrm:token') || '' },
      body: JSON.stringify({ user: t, assistant: holder.text }),
    });
    await loadConversations();
  } catch {}

  streaming.value = false;
  controller.value = null;
}

function stop() {
  if (controller.value) controller.value.abort();
  streaming.value = false;
  const last = messages.value[messages.value.length - 1];
  if (last && last.role === 'assistant') last.streaming = false;
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
}

function render(t) {
  if (!t) return '';
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}

onMounted(async () => { await loadScene(props.scene); });
</script>

<template>
  <section class="cw" :class="{ collapsed }">
    <div v-if="collapsed" class="cw-mini" @click="collapsed = false" title="展开对话工作台">
      <div class="cw-mini-avatar">{{ current ? current.avatar : '·' }}</div>
      <div class="cw-mini-txt">{{ current ? current.name : 'AI' }}</div>
    </div>

    <template v-else>
      <!-- 头部：当前 AI 员工（随场景自动切换） -->
      <header class="cw-head">
        <div class="cw-avatar">{{ current ? current.avatar : '·' }}</div>
        <div class="grow">
          <div class="cw-name">
            {{ current ? current.name : '—' }}
            <span v-if="current && current.is_engineer" class="cw-badge eng">工程师</span>
          </div>
          <div class="cw-desc">{{ current ? current.duty : '' }}</div>
        </div>
        <button class="btn btn-ghost btn-sm" title="折叠" @click="collapsed = true">‹</button>
      </header>

      <!-- 场景内的助手切换（仅当该页面有多个助手时显示） -->
      <div v-if="assistants.length > 1" class="cw-asst">
        <button
          v-for="a in assistants" :key="a.id"
          class="asst-btn" :class="{ on: current && current.id === a.id }"
          @click="switchAssistant(a)"
        >
          <span class="ab-av">{{ a.avatar }}</span>{{ a.name }}
        </button>
      </div>

      <!-- 当前助手的会话 -->
      <div class="cw-conv">
        <button class="conv-cur" @click="showConvList = !showConvList">
          <span class="cc-dot" />
          <span class="grow ellipsis">{{ conv ? conv.title : '加载中…' }}</span>
          <span class="cc-count">{{ conversations.length }}</span>
          <span class="cc-caret">{{ showConvList ? '▴' : '▾' }}</span>
        </button>
        <button class="btn btn-ghost btn-sm" title="新会话" @click="newConv">＋</button>

        <div v-if="showConvList" class="conv-pop">
          <div class="pop-h">
            {{ current ? current.name : '' }} 的会话
            <span class="dim">（{{ conversations.length }}）</span>
          </div>
          <div class="pop-list">
            <button
              v-for="c in conversations" :key="c.id" class="pop-item"
              :class="{ on: conv && conv.id === c.id }" @click="selectConv(c)"
            >
              <div class="pi-t ellipsis">{{ c.title }}</div>
              <div class="pi-m">{{ c.message_count }} 条</div>
            </button>
            <div v-if="!conversations.length" class="dim" style="padding:8px;font-size:11.5px">暂无会话</div>
          </div>
          <div class="pop-f">每个助手的会话互相独立</div>
        </div>
      </div>

      <!-- 消息流 -->
      <div ref="scroller" class="cw-body" @click="showConvList = false">
        <div v-if="!messages.length" class="cw-welcome">
          <div class="cw-welcome-ico">{{ current ? current.avatar : '·' }}</div>
          <div class="cw-welcome-t">{{ current ? current.greeting : '' }}</div>
          <div v-if="current" class="cw-scope">
            上下文：<span v-for="s in current.context_scope" :key="s" class="tag">{{ s }}</span>
          </div>
        </div>

        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
          <template v-if="m.role === 'system'">
            <div class="msg-sys">{{ m.text }}</div>
          </template>
          <template v-else-if="m.role === 'user'">
            <div class="bubble user">
              <div v-if="m.atts && m.atts.length" class="b-atts">
                <span v-for="(a, i) in m.atts" :key="i" class="b-att">
                  {{ a.type === 'image' ? '🖼' : '📄' }} {{ a.name }}
                </span>
              </div>
              <div v-if="m.text">{{ m.text }}</div>
            </div>
          </template>
          <template v-else>
            <div class="bubble ai">
              <span v-html="render(m.text)"></span>
              <span v-if="m.streaming" class="caret" />
            </div>
          </template>
        </div>

        <div v-if="lastLatency && !streaming" class="cw-latency">
          首字 {{ lastLatency.first }}ms · 完整 {{ lastLatency.total }}ms
        </div>
      </div>

      <!-- 建议指令 -->
      <div v-if="!messages.length && current" class="cw-sugg">
        <button v-for="s in current.suggestions || []" :key="s" class="sugg" @click="send(s)">{{ s }}</button>
      </div>

      <!-- 输入 -->
      <footer class="cw-foot">
        <div v-if="atts.length" class="att-bar">
          <span v-for="(a, i) in atts" :key="i" class="att-chip">
            {{ a.type === 'image' ? '🖼' : '📄' }} {{ a.name }}
            <i @click="removeAtt(i)">✕</i>
          </span>
          <span v-if="attBusy" class="dim" style="font-size:10.5px">读取中…</span>
        </div>

        <div class="cw-input">
          <button class="att-btn" :disabled="streaming || attBusy" title="上传附件（图片 / 文本）" @click="pickAtt">📎</button>
          <input ref="attInput" type="file" multiple accept="image/*,.txt,.md,.csv,.json,.log,text/*" style="display:none" @change="onAtt" />
          <textarea
            v-model="input" rows="1" :disabled="streaming"
            :placeholder="current ? `向${current.name}提问…` : '加载中…'"
            @keydown="onKeydown"
          />
          <button v-if="streaming" class="btn btn-sm" @click="stop">停止</button>
          <button v-else class="btn btn-primary btn-sm" :disabled="!input.trim()" @click="send()">发送</button>
        </div>
        <div class="cw-foot-hint">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span class="dim">写操作需确认</span>
        </div>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.cw {
  width: var(--chat-w); flex: 0 0 var(--chat-w);
  background: var(--surface); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; overflow: hidden; position: relative;
  transition: flex-basis .22s var(--ease), width .22s var(--ease);
}
.cw.collapsed { width: var(--chat-w-collapsed); flex-basis: var(--chat-w-collapsed); }

.cw-mini { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 0; cursor: pointer; }
.cw-mini:hover { background: var(--surface-2); }
.cw-mini-avatar {
  width: 30px; height: 30px; border-radius: var(--r-2); background: var(--accent-soft);
  color: var(--accent); display: grid; place-items: center; font-size: 13px; font-weight: 600;
}
.cw-mini-txt { writing-mode: vertical-rl; font-size: 11.5px; color: var(--ink-3); letter-spacing: 1px; }

.cw-head { display: flex; align-items: center; gap: 9px; padding: 11px 12px; border-bottom: 1px solid var(--line-soft); }
.cw-avatar {
  width: 30px; height: 30px; border-radius: var(--r-2); flex: 0 0 30px;
  background: var(--ink); color: #fff; display: grid; place-items: center;
  font-size: 13px; font-weight: 600;
}
.cw-name { font-size: 13px; font-weight: 600; letter-spacing: .2px; display: flex; align-items: center; gap: 5px; }
.cw-badge { font-size: 9.5px; padding: 1px 5px; border-radius: var(--r-1); background: var(--violet-soft); color: var(--violet); font-weight: 500; }
.cw-desc { font-size: 11px; color: var(--ink-3); margin-top: 1px; }

.cw-asst { display: flex; gap: 4px; padding: 7px 10px; background: var(--violet-soft); flex-wrap: wrap; }
.asst-btn {
  display: inline-flex; align-items: center; gap: 4px; border: 1px solid transparent;
  background: rgba(255,255,255,.6); border-radius: var(--r-pill); padding: 3px 9px 3px 4px;
  font-size: 11px; color: var(--ink-2);
}
.asst-btn.on { background: var(--surface); border-color: var(--violet); color: var(--violet); font-weight: 600; }
.ab-av {
  width: 16px; height: 16px; border-radius: 50%; background: var(--violet);
  color: #fff; display: grid; place-items: center; font-size: 9px;
}

.cw-conv { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--line-soft); position: relative; }
.conv-cur {
  flex: 1; display: flex; align-items: center; gap: 6px; border: 0; background: transparent;
  font-size: 11.5px; color: var(--ink-2); text-align: left; padding: 3px 0; min-width: 0;
}
.cc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); flex: 0 0 5px; }
.cc-count { font-size: 10px; color: var(--ink-4); }
.cc-caret { font-size: 9px; color: var(--ink-4); }

.conv-pop {
  position: absolute; top: 100%; left: 8px; right: 8px; z-index: 30;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3);
  box-shadow: var(--sh-4); overflow: hidden;
}
.pop-h { padding: 8px 11px; font-size: 11px; font-weight: 600; border-bottom: 1px solid var(--line-soft); }
.pop-h .dim { font-weight: 400; }
.pop-list { max-height: 220px; overflow-y: auto; padding: 4px; }
.pop-item {
  display: flex; align-items: center; gap: 6px; width: 100%; border: 0;
  background: transparent; padding: 6px 8px; border-radius: var(--r-1); text-align: left;
}
.pop-item:hover { background: var(--bg-sunken); }
.pop-item.on { background: var(--accent-soft); }
.pi-t { flex: 1; font-size: 11.5px; color: var(--ink); min-width: 0; }
.pi-m { font-size: 10px; color: var(--ink-4); flex: 0 0 auto; }
.pop-f { padding: 6px 11px; font-size: 10px; color: var(--ink-4); background: var(--surface-2); border-top: 1px solid var(--line-soft); }

.cw-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.cw-welcome { padding: 16px 4px; text-align: center; }
.cw-welcome-ico {
  width: 40px; height: 40px; margin: 0 auto 10px; border-radius: var(--r-3);
  background: var(--bg-sunken); color: var(--ink-3); display: grid; place-items: center; font-size: 16px;
}
.cw-welcome-t { font-size: 12.5px; color: var(--ink-3); line-height: 1.7; }
.cw-scope { margin-top: 12px; font-size: 10.5px; color: var(--ink-4); display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; align-items: center; }
.cw-scope .tag { font-size: 10px; height: 18px; }

.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg-sys {
  margin: 0 auto; font-size: 11px; color: var(--violet);
  background: var(--violet-soft); border-radius: var(--r-pill); padding: 4px 12px;
  max-width: 92%; line-height: 1.6;
}
.bubble { max-width: 92%; padding: 9px 12px; border-radius: var(--r-3); font-size: 12.5px; line-height: 1.68; word-break: break-word; }
.bubble.user { background: var(--ink); color: #fff; border-bottom-right-radius: var(--r-1); }
.bubble.ai { background: var(--surface-2); border: 1px solid var(--line-soft); border-bottom-left-radius: var(--r-1); }
.bubble.ai :deep(b) { color: var(--accent); font-weight: 600; }
.caret { display: inline-block; width: 6px; height: 13px; margin-left: 2px; background: var(--accent); vertical-align: -2px; animation: pulse 1s infinite; }
.cw-latency { text-align: center; font-size: 10.5px; color: var(--ink-4); padding-top: 4px; }

.cw-sugg { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 10px; }
.sugg {
  text-align: left; border: 1px dashed var(--line-strong); background: transparent;
  border-radius: var(--r-2); padding: 7px 10px; font-size: 12px; color: var(--ink-2); transition: all .16s var(--ease);
}
.sugg:hover { border-style: solid; border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); }

.cw-foot { border-top: 1px solid var(--line-soft); padding: 10px 12px 12px; }
.att-bar { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
.att-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  font-size: 10.5px; padding: 3px 7px; border-radius: var(--r-1);
  background: var(--accent-soft); color: var(--accent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.att-chip i { cursor: pointer; font-style: normal; opacity: .6; }
.att-chip i:hover { opacity: 1; }
.att-btn {
  border: 0; background: transparent; font-size: 15px; padding: 0 2px 2px;
  color: var(--ink-3); flex: 0 0 auto; line-height: 1.4;
}
.att-btn:hover:not(:disabled) { color: var(--accent); }
.att-btn:disabled { opacity: .4; cursor: not-allowed; }
.b-atts { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.b-att {
  font-size: 10.5px; padding: 2px 6px; border-radius: var(--r-1);
  background: rgba(255,255,255,.18);
}
.cw-input {
  display: flex; align-items: flex-end; gap: 6px; border: 1px solid var(--line);
  border-radius: var(--r-3); padding: 6px 6px 6px 10px; background: var(--surface); transition: border-color .16s;
}
.cw-input:focus-within { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.cw-input textarea {
  flex: 1; border: 0; outline: 0; resize: none; font-size: 12.5px; line-height: 1.6;
  max-height: 110px; background: transparent; color: var(--ink);
}
.cw-foot-hint { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10.5px; color: var(--ink-4); }
</style>
