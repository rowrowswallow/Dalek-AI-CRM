<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { api, track } from '../api.js';

const ctx = inject('aicrm');

const tab = ref('assistants');     // assistants | conversations
const list = ref([]);
const stats = ref(null);
const convs = ref([]);
const active = ref(null);
const editing = ref(false);
const draft = ref({});
const filterAssistant = ref('all');

async function load() {
  const [a, c] = await Promise.all([api.assistants(), api.conversations()]);
  list.value = a.list; stats.value = a.stats;
  convs.value = c.list;
}

function open(a) {
  active.value = a;
  draft.value = {
    name: a.name, duty: a.duty, tone: a.tone || '', enabled: a.enabled,
    context_scope: [...(a.context_scope || [])],
  };
  editing.value = false;
  track('element_click', { target: 'assistant_card', id: a.id });
}

function addScope(e) {
  const v = (e.target.value || '').trim();
  if (v && !draft.value.context_scope.includes(v)) draft.value.context_scope.push(v);
  e.target.value = '';
}

async function save() {
  await api.updateAssistant(active.value.id, draft.value);
  await load();
  ctx.flash('已保存');
  editing.value = false;
  track('assistant_update', { id: active.value.id });
}

async function toggle(a) {
  await api.updateAssistant(a.id, { enabled: !a.enabled });
  await load();
  const fresh = list.value.find((x) => x.id === a.id);
  if (active.value && active.value.id === a.id) active.value = fresh;
  ctx.flash(fresh.enabled ? `${fresh.name} 已启用` : `${fresh.name} 已停用`);
}

async function clear(a) {
  await api.clearConversations(a.id);
  await load();
  ctx.flash(`已清空「${a.name}」的聊天记录`);
  track('conversation_clear', { assistant: a.id });
}

async function openConv(c) {
  const full = await api.conversation(c.id);
  active.value = null;
  ctx.openConversation(full.conversation);
  track('conversation_open', { id: c.id, assistant: c.assistant_id });
}

const filteredConvs = computed(() =>
  filterAssistant.value === 'all' ? convs.value : convs.value.filter((c) => c.assistant_id === filterAssistant.value));

const asstName = (id) => (list.value.find((x) => x.id === id) || {}).name || id;
const asstAvatar = (id) => (list.value.find((x) => x.id === id) || {}).avatar || '?';

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso); const diff = (Date.now() - d) / 60000;
  if (diff < 60) return Math.floor(diff) + ' 分钟前';
  if (diff < 1440) return Math.floor(diff / 60) + ' 小时前';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

onMounted(load);
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">AI 助手管理</h1>
        <p class="vh-s">
          {{ stats ? stats.assistants : 0 }} 个助手 ·
          {{ stats ? stats.enabled : 0 }} 个启用 ·
          {{ stats ? stats.conversations : 0 }} 个会话 ·
          {{ stats ? stats.messages : 0 }} 条消息
        </p>
      </div>
      <div class="tabs">
        <button :class="{ on: tab === 'assistants' }" @click="tab = 'assistants'">助手与权限</button>
        <button :class="{ on: tab === 'conversations' }" @click="tab = 'conversations'">聊天记录</button>
      </div>
    </header>

    <!-- ============ 助手列表 ============ -->
    <div v-if="tab === 'assistants'" class="body">
      <div class="grid">
        <article
          v-for="a in list" :key="a.id"
          class="acard card" :class="{ off: !a.enabled, sel: active && active.id === a.id }"
          @click="open(a)"
        >
          <div class="ac-top">
            <div class="ac-av">{{ a.avatar }}</div>
            <div class="grow">
              <div class="ac-n">
                {{ a.name }}
                <span v-if="a.is_engineer" class="badge eng">工程师</span>
                <span v-if="a.is_page_owner" class="badge own">页面负责</span>
              </div>
              <div class="ac-scene">绑定页面：{{ a.scene_name }}</div>
            </div>
            <button class="sw" :class="{ on: a.enabled }" @click.stop="toggle(a)" :title="a.enabled ? '停用' : '启用'" />
          </div>
          <div class="ac-duty">{{ a.duty }}</div>
          <div class="ac-meta">
            <span>工具 {{ a.tools.length }}</span>
            <span>会话 {{ a.conversation_count }}</span>
            <span v-if="a.last_active">{{ fmt(a.last_active) }}</span>
          </div>
          <div v-if="a.reports_to" class="ac-report">
            ↳ 变更向「{{ asstName(a.reports_to) }}」汇报
          </div>
        </article>
      </div>

      <!-- 详情 -->
      <transition name="slide">
        <aside v-if="active" class="drawer">
          <header class="dw-head">
            <div class="ac-av big">{{ active.avatar }}</div>
            <div class="grow">
              <div class="dw-t">{{ active.name }}</div>
              <div class="dw-s">{{ active.scene_name }} · {{ active.builtin ? '内置助手' : '自定义' }}</div>
            </div>
            <button class="btn btn-ghost btn-sm" @click="active = null">✕</button>
          </header>

          <div class="dw-body">
            <template v-if="!editing">
              <div class="card blk">
                <div class="blk-h">职责</div>
                <div class="blk-t">{{ active.duty }}</div>
              </div>
              <div class="card blk">
                <div class="blk-h">上下文范围<span class="dim">它能读到什么</span></div>
                <div class="chips">
                  <span v-for="c in active.context_scope" :key="c" class="tag tag-b">{{ c }}</span>
                </div>
              </div>
              <div class="card blk">
                <div class="blk-h">可用工具<span class="dim">{{ active.tools.length }} 个</span></div>
                <div class="chips">
                  <span v-for="t in active.tools" :key="t" class="tool mono">{{ t }}</span>
                </div>
              </div>
              <div class="card blk">
                <div class="blk-h">汇报关系</div>
                <div v-if="active.reports_to" class="rep">
                  <span class="rep-a">{{ active.name }}</span>
                  <span class="rep-arrow">→ 汇报 →</span>
                  <span class="rep-b">{{ asstName(active.reports_to) }}</span>
                </div>
                <div v-else class="blk-t dim">
                  它是 {{ active.scene_name }} 页面的负责助手，接收其他助手的变更汇报。
                </div>
                <div v-if="active.tone" class="blk-t" style="margin-top:8px">
                  <b class="lb">语气设定</b>{{ active.tone }}
                </div>
              </div>
              <div class="row gap6">
                <button class="btn btn-primary btn-sm" @click="editing = true">编辑</button>
                <button class="btn btn-sm" @click="clear(active)">清空聊天记录</button>
              </div>
            </template>

            <template v-else>
              <label class="fld"><span>名称</span><input v-model="draft.name" /></label>
              <label class="fld"><span>职责</span><textarea v-model="draft.duty" rows="2" /></label>
              <label class="fld"><span>语气</span><input v-model="draft.tone" placeholder="比如：结论先行，不啰嗦" /></label>
              <div class="fld">
                <span>上下文范围</span>
                <div class="chips" style="padding-top:5px">
                  <span v-for="c in draft.context_scope" :key="c" class="tag tag-b">
                    {{ c }} <i style="cursor:pointer;font-style:normal" @click="draft.context_scope = draft.context_scope.filter(x => x !== c)">✕</i>
                  </span>
                  <input class="mini" placeholder="+ 添加" @keydown.enter="addScope($event)" />
                </div>
              </div>
              <div class="row gap6" style="justify-content:flex-end">
                <button class="btn btn-sm" @click="editing = false">取消</button>
                <button class="btn btn-sm btn-primary" @click="save">保存</button>
              </div>
            </template>
          </div>
        </aside>
      </transition>
    </div>

    <!-- ============ 聊天记录 ============ -->
    <div v-else class="body conv-body">
      <div class="conv-filter">
        <button class="fbtn" :class="{ on: filterAssistant === 'all' }" @click="filterAssistant = 'all'">
          全部 <b>{{ convs.length }}</b>
        </button>
        <button
          v-for="a in list" :key="a.id" class="fbtn"
          :class="{ on: filterAssistant === a.id }" @click="filterAssistant = a.id"
        >
          {{ a.avatar }} {{ a.name }}
          <b>{{ convs.filter(c => c.assistant_id === a.id).length }}</b>
        </button>
      </div>

      <div class="conv-list">
        <div v-for="c in filteredConvs" :key="c.id" class="conv card" @click="openConv(c)">
          <div class="conv-av">{{ asstAvatar(c.assistant_id) }}</div>
          <div class="grow">
            <div class="conv-t">{{ c.title }}</div>
            <div class="conv-p">{{ c.preview || '（暂无内容）' }}</div>
          </div>
          <div class="conv-r">
            <div class="conv-a">{{ asstName(c.assistant_id) }}</div>
            <div class="conv-m">{{ c.message_count }} 条 · {{ fmt(c.updated_at) }}</div>
          </div>
        </div>
        <div v-if="!filteredConvs.length" class="empty">
          <div class="empty-ico">💬</div>
          <div>还没有聊天记录</div>
          <div class="dim" style="font-size:11.5px">去对应页面和 AI 助手聊几句就会出现</div>
        </div>
      </div>

      <div class="note">
        <b>聊天记录按助手隔离。</b>
        每个助手只管自己的上下文——客户管理助手看不到任务助手在聊什么，
        但「看板工程师」的改动会写进「数据分析师」的会话里，因为那是他的汇报对象。
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 12px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.tabs { display: flex; border: 1px solid var(--line); border-radius: var(--r-2); overflow: hidden; }
.tabs button { border: 0; background: var(--surface); padding: 6px 14px; font-size: 12px; color: var(--ink-3); }
.tabs button.on { background: var(--ink); color: #fff; }

.body { flex: 1; overflow: auto; padding: 0 20px 20px; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); align-content: start; }
.acard { padding: 13px; cursor: pointer; transition: all .16s var(--ease); }
.acard:hover { box-shadow: var(--sh-3); transform: translateY(-2px); }
.acard.sel { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.acard.off { opacity: .5; }
.ac-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; }
.ac-av {
  width: 34px; height: 34px; border-radius: var(--r-2); flex: 0 0 34px;
  background: var(--ink); color: #fff; display: grid; place-items: center;
  font-size: 14px; font-weight: 600;
}
.ac-av.big { width: 38px; height: 38px; flex: 0 0 38px; font-size: 15px; }
.ac-n { font-size: 13px; font-weight: 650; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: var(--r-1); font-weight: 500; }
.badge.eng { background: var(--violet-soft); color: var(--violet); }
.badge.own { background: var(--green-soft); color: var(--green); }
.ac-scene { font-size: 11px; color: var(--ink-3); margin-top: 3px; }
.ac-duty { font-size: 12px; color: var(--ink-2); line-height: 1.6; min-height: 38px; }
.ac-meta { display: flex; gap: 10px; font-size: 11px; color: var(--ink-4); margin-top: 8px; }
.ac-report {
  margin-top: 8px; padding: 5px 8px; border-radius: var(--r-1);
  background: var(--violet-soft); color: var(--violet); font-size: 11px;
}

.sw {
  width: 34px; height: 19px; border-radius: var(--r-pill); border: 0;
  background: var(--line-strong); position: relative; flex: 0 0 34px;
  transition: background .18s;
}
.sw::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
  border-radius: 50%; background: #fff; transition: transform .18s var(--ease);
}
.sw.on { background: var(--green); }
.sw.on::after { transform: translateX(15px); }

.drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 420px;
  background: var(--surface); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; z-index: 20; box-shadow: var(--sh-4);
}
.dw-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line-soft); }
.dw-t { font-size: 15px; font-weight: 650; }
.dw-s { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
.dw-body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 12px; }

.blk { padding: 12px; }
.blk-h {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 9px;
}
.blk-h .dim { font-weight: 400; font-size: 11px; }
.blk-t { font-size: 12px; line-height: 1.7; color: var(--ink-2); }
.lb { color: var(--ink-3); font-weight: 400; margin-right: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.tool {
  font-family: var(--mono); font-size: 10.5px; padding: 2px 7px;
  border-radius: var(--r-1); background: var(--bg-sunken); color: var(--ink-2);
}
.rep { display: flex; align-items: center; gap: 9px; font-size: 12px; flex-wrap: wrap; }
.rep-a, .rep-b { padding: 3px 9px; border-radius: var(--r-1); background: var(--bg-sunken); font-weight: 550; }
.rep-b { background: var(--green-soft); color: var(--green); }
.rep-arrow { color: var(--violet); font-size: 11px; }

.fld { display: block; margin-bottom: 10px; }
.fld > span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 5px; }
.fld input, .fld textarea {
  width: 100%; padding: 7px 10px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink);
  resize: vertical; font-family: inherit;
}
.fld input:focus, .fld textarea:focus { border-color: var(--accent-line); }
.mini {
  width: 90px; height: 22px; padding: 0 8px; font-size: 11px;
  border: 1px dashed var(--line-strong); border-radius: var(--r-1);
  background: transparent; outline: 0; color: var(--ink);
}

.conv-body { display: flex; flex-direction: column; gap: 11px; }
.conv-filter { display: flex; flex-wrap: wrap; gap: 6px; }
.fbtn {
  border: 1px solid var(--line); background: var(--surface); border-radius: var(--r-2);
  padding: 5px 11px; font-size: 12px; color: var(--ink-2);
}
.fbtn.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.fbtn b { opacity: .55; margin-left: 3px; font-weight: 500; }

.conv-list { display: flex; flex-direction: column; gap: 8px; }
.conv { display: flex; align-items: center; gap: 11px; padding: 11px 13px; cursor: pointer; transition: all .16s var(--ease); }
.conv:hover { box-shadow: var(--sh-2); border-color: var(--line-strong); }
.conv-av {
  width: 30px; height: 30px; border-radius: var(--r-2); flex: 0 0 30px;
  background: var(--accent-soft); color: var(--accent);
  display: grid; place-items: center; font-size: 12.5px; font-weight: 600;
}
.conv-t { font-size: 12.5px; font-weight: 600; }
.conv-p { font-size: 11.5px; color: var(--ink-3); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-r { text-align: right; flex: 0 0 auto; }
.conv-a { font-size: 11px; color: var(--accent); }
.conv-m { font-size: 10.5px; color: var(--ink-4); margin-top: 2px; }

.note {
  padding: 11px 13px; border-radius: var(--r-2); background: var(--accent-soft);
  border: 1px solid var(--accent-line); font-size: 11.5px; line-height: 1.7; color: var(--ink-2);
}
.note b { color: var(--accent); }

.slide-enter-active, .slide-leave-active { transition: transform .22s var(--ease), opacity .22s; }
.slide-enter-from, .slide-leave-to { transform: translateX(30px); opacity: 0; }
</style>
