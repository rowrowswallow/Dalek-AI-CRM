<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, track } from './api.js';

/* ------------------------------------------------------------------
   企微抽屉演示
   真实环境：由聊天工具栏打开，JSSDK 调 ww.getCurExternalContact() 拿客户 ID
   演示环境：模拟 JSSDK 返回，并允许手动切换客户
------------------------------------------------------------------ */

const meta = ref({ aiMode: 'rule' });
const open = ref(false);
const allCustomers = ref([]);
const tags = ref([]);
const current = ref(null);
const followups = ref([]);
const jssdkState = ref('idle');       // idle | ok | unsupported
const pickerOpen = ref(false);

/* 录入 */
const mode = ref('text');             // text | voice | file
const text = ref('');
const draft = ref(null);
const parsing = ref(false);
const saving = ref(false);

/* 归档操作 */
const remarkDirty = ref(false);
const remark = ref({ description: '', company: '', phone: '' });
const syncState = ref('');            // '' | 'syncing' | 'done' | 'fail'
const scripts = ref([]);              // 知识库匹配到的推荐话术

const openedAt = ref(0);

const wxMessages = [
  { me: false, text: '你好，我们这边看了你们的方案，有几个问题想确认一下' },
  { me: true, text: '您好张总，您说，我这边随时对接' },
  { me: false, text: '主要是价格这块，能不能再谈一下？另外实施周期大概多久' },
  { me: true, text: '价格我可以帮您申请一个方案，周期我确认后回复您' },
];

const tagGroups = computed(() => tags.value || []);

/* 模拟 JSSDK —— 真实代码里是 wx.invoke('getCurExternalContact', ...) */
async function initJssdk() {
  jssdkState.value = 'idle';
  const m = await api.meta();
  meta.value = m;
  const list = await api.customers();
  allCustomers.value = list.list;
  const t = await api.tags();
  tags.value = t.groups;

  // 真实环境：
  //   const r = await new Promise(res => wx.invoke('getCurExternalContact', {}, res));
  //   if (r.err_msg === 'getCurExternalContact:ok') resolveByExternal(r.userId)
  const demoEid = list.list[0] && list.list[0].external_userid;
  if (demoEid) {
    const r = await api.resolveExternal(demoEid);
    if (r.ok) { await selectCustomer(r.customer_id); jssdkState.value = 'ok'; return; }
  }
  jssdkState.value = 'unsupported';
}

async function loadScripts() {
  if (!current.value) { scripts.value = []; return; }
  const r = await api.kbScript({ target: 'customer', customer_id: current.value.id });
  const ids = (r.sources || []).map((x) => x.id);
  const list = await Promise.all(ids.map((id) => api.kbGet(id)));
  scripts.value = list.filter((x) => x.ok).map((x) => ({
    id: x.item.id, title: x.item.title, content: x.item.content, used: x.item.used_count,
  }));
}

async function copyScript(s) {
  try {
    await navigator.clipboard.writeText(s.content);
    syncState.value = 'done';
    setTimeout(() => (syncState.value = ''), 1400);
  } catch { text.value = s.content; }
  await api.kbUse(s.id);
  s.used += 1;
  track('kb_use', { id: s.id, from: 'drawer' });
}

async function selectCustomer(id) {
  const d = await api.customer(id);
  current.value = d.customer;
  followups.value = d.followups.slice(0, 5);
  remark.value = {
    description: (d.customer.tags || []).join('，'),
    company: d.customer.company_name,
    phone: d.customer.contact_phone,
  };
  remarkDirty.value = false;
  draft.value = null;
  await loadScripts();
}

function openDrawer() {
  open.value = true;
  openedAt.value = Date.now();
  track('drawer_action', { action: 'open', source: 'chat_toolbar', in_single_chat: true });
}
function closeDrawer() {
  open.value = false;
  const dur = Date.now() - openedAt.value;
  track('drawer_action', { action: 'close', duration_ms: dur });
}

/* 打标：写入自有库 + 可选同步企微 */
async function toggleTag(name) {
  if (!current.value) return;
  const has = current.value.tags.includes(name);
  await api.batchTag([current.value.id], has ? [] : [name], has ? [name] : []);
  syncState.value = 'syncing';
  const r = await api.syncTag({
    external_userid: current.value.external_userid,
    add: has ? [] : [name], remove: has ? [name] : [],
  });
  syncState.value = r.ok ? 'done' : 'fail';
  setTimeout(() => (syncState.value = ''), 2000);
  const d = await api.customer(current.value.id);
  current.value = d.customer;
  track('element_click', { target: 'drawer_tag', value: name, on: !has });
}

/* AI 整理跟进 */
async function doParse() {
  if (!text.value.trim()) return;
  parsing.value = true;
  const r = await api.parseFollowup(text.value, current.value.id);
  draft.value = r.draft;
  parsing.value = false;
  track('function_call', { scene: 'drawer', tool: 'parse_followup' });
}

async function save(useDraft) {
  if (!text.value.trim()) return;
  saving.value = true;
  await api.addFollowup({
    customer_id: current.value.id,
    content: text.value,
    source: useDraft ? 'ai' : 'manual',
    summary: useDraft && draft.value ? draft.value.summary : undefined,
    node_times: useDraft && draft.value ? draft.value.node_times : [],
    next_action: useDraft && draft.value ? draft.value.next_action : '',
  });
  if (useDraft && draft.value && draft.value.suggest_tags.length) {
    await api.batchTag([current.value.id], draft.value.suggest_tags);
  }
  const d = await api.customer(current.value.id);
  current.value = d.customer;
  followups.value = d.followups.slice(0, 5);

  track('drawer_action', {
    action: 'followup_saved',
    mode: mode.value,
    used_ai: useDraft,
    duration_ms: Date.now() - openedAt.value,
  });
  track('ai_suggestion_feedback', { type: 'followup_parse', action: useDraft ? 'accepted' : 'manual' });

  text.value = ''; draft.value = null; saving.value = false;
  syncState.value = 'done';
  setTimeout(() => (syncState.value = ''), 1600);
}

async function saveRemark() {
  await api.updateRemark({
    external_userid: current.value.external_userid,
    fields: { description: remark.value.description, remark_company: remark.value.company, remark_mobiles: [remark.value.phone] },
  });
  remarkDirty.value = true;
  syncState.value = 'done';
  setTimeout(() => (syncState.value = ''), 1600);
  track('function_call', { scene: 'drawer', tool: 'update_remark' });
}

onMounted(initJssdk);
</script>

<template>
  <div class="stage">
    <!-- ============ 手机：模拟企业微信 ============ -->
    <div class="phone">
      <div class="notch" />
      <div class="phone-screen">
        <div class="wx-status"><span>9:41</span><span>▮▮▮ ▮ ▮</span></div>
        <div class="wx-nav">
          <span class="wx-back">‹</span>
          <span class="wx-title">{{ current ? current.contact_name + ' · ' + current.company_name : '客户' }}</span>
          <span class="wx-more">⋯</span>
        </div>

        <div class="wx-chat">
          <div class="wx-time">今天 14:20</div>
          <div v-for="(m, i) in wxMessages" :key="i" class="wx-msg" :class="{ me: m.me }">
            <div class="wx-av" :class="m.me ? 'me' : 'cust'">{{ m.me ? '我' : (current ? current.contact_name[0] : '客') }}</div>
            <div class="wx-bubble">{{ m.text }}</div>
          </div>
        </div>

        <!-- 聊天工具栏（企微官方能力，抽屉从这里打开） -->
        <div class="wx-toolbar">
          <button class="wx-tool hi" @click="openDrawer">
            <span class="wx-tool-ico">✦</span>
            <span>客户助手</span>
          </button>
          <button class="wx-tool"><span class="wx-tool-ico">🖼</span><span>图片</span></button>
          <button class="wx-tool"><span class="wx-tool-ico">📄</span><span>文件</span></button>
          <button class="wx-tool"><span class="wx-tool-ico">📍</span><span>位置</span></button>
        </div>

        <!-- ============ 抽屉面板 ============ -->
        <transition name="slideL">
          <div v-if="open" class="wx-drawer" @click.self="closeDrawer">
            <aside class="wx-panel">
              <header class="wx-panel-head">
                <div class="grow">
                  <div style="font-size:14px;font-weight:650">{{ current ? current.contact_name : '未知客户' }}</div>
                  <div style="font-size:11px;color:var(--ink-3);margin-top:2px">
                    {{ current ? current.company_name : '—' }}
                    <span v-if="syncState === 'done'" class="pill" style="margin-left:5px">已同步企微</span>
                    <span v-else-if="syncState === 'syncing'" class="pill warn" style="margin-left:5px">同步中…</span>
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" @click="closeDrawer">✕</button>
              </header>

              <div class="wx-panel-body">
                <!-- 标签 -->
                <div>
                  <div class="sec-h" style="font-size:11.5px;color:var(--ink-3);margin-bottom:7px">
                    标签 · 点击即打标，同步至企微企业标签
                  </div>
                  <div v-for="g in tagGroups" :key="g.group" style="margin-bottom:8px">
                    <div style="font-size:10.5px;color:var(--ink-4);margin-bottom:4px">{{ g.group }}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:5px">
                      <button
                        v-for="t in g.tags" :key="t"
                        class="tag tagbtn" :class="{ on: current && current.tags.includes(t) }"
                        @click="toggleTag(t)"
                      >{{ t }}</button>
                    </div>
                  </div>
                </div>

                <!-- 记录跟进 -->
                <div class="card" style="padding:10px">
                  <div style="font-size:12px;font-weight:600;margin-bottom:7px">记录跟进</div>
                  <div class="modes">
                    <button :class="{ on: mode === 'text' }" @click="mode = 'text'">文字</button>
                    <button :class="{ on: mode === 'voice' }" @click="mode = 'voice'">语音</button>
                    <button :class="{ on: mode === 'file' }" @click="mode = 'file'">附件</button>
                  </div>

                  <textarea
                    v-if="mode === 'text'"
                    v-model="text" rows="3" class="ta"
                    placeholder="聊完顺手记一句，比如「客户对价格敏感，约下周一给方案」"
                  />
                  <div v-else-if="mode === 'voice'" class="mockbox">
                    <div class="mock-ico">🎙</div>
                    <div>长按录音，松开转文字</div>
                    <div class="dim" style="font-size:10.5px">原型环境：语音转写接口未接入</div>
                    <button class="btn btn-sm" @click="text = '语音转写示例：客户希望下周一前拿到方案报价，对实施周期比较关注。'; mode = 'text'">
                      用示例填充
                    </button>
                  </div>
                  <div v-else class="mockbox">
                    <div class="mock-ico">📄</div>
                    <div>上传聊天记录截图 / 文档</div>
                    <div class="dim" style="font-size:10.5px">原型环境：附件解析未接入</div>
                    <button class="btn btn-sm" @click="text = '附件解析示例：客户发送了需求清单，包含 3 个模块，希望下周三前确认报价。'; mode = 'text'">
                      用示例填充
                    </button>
                  </div>

                  <div class="row gap6" style="margin-top:8px">
                    <button class="btn btn-sm" :disabled="parsing || !text.trim()" @click="doParse">
                      {{ parsing ? '解析中…' : '✦ AI 整理' }}
                    </button>
                    <button class="btn btn-sm btn-primary" :disabled="saving || !text.trim()" @click="save(false)">直接保存</button>
                  </div>

                  <div v-if="draft" class="draft fade-up">
                    <div class="draft-h">
                      <span>AI 整理结果</span>
                      <span class="pill">置信度 {{ Math.round(draft.confidence * 100) }}%</span>
                    </div>
                    <div class="drow"><b>摘要</b><span>{{ draft.summary }}</span></div>
                    <div class="drow" v-if="draft.node_times.length"><b>节点时间</b><span class="accent">{{ draft.node_times.join('、') }}</span></div>
                    <div class="drow" v-if="draft.next_action"><b>下一步</b><span>{{ draft.next_action }}</span></div>
                    <div class="drow" v-if="draft.suggest_tags.length">
                      <b>建议标签</b>
                      <span><span v-for="t in draft.suggest_tags" :key="t" class="tag on" style="margin-right:3px">{{ t }}</span></span>
                    </div>
                    <div class="row gap6" style="margin-top:9px">
                      <button class="btn btn-sm btn-accent" :disabled="saving" @click="save(true)">采用并保存</button>
                      <button class="btn btn-sm" @click="draft = null">忽略</button>
                    </div>
                  </div>
                </div>

                <!-- 话术推荐（知识库 → 抽屉） -->
                <div class="card" style="padding:10px">
                  <div style="font-size:12px;font-weight:600;margin-bottom:7px">
                    推荐话术
                    <span class="pill" style="font-weight:400">来自知识库</span>
                  </div>
                  <div v-if="scripts.length">
                    <div v-for="s in scripts" :key="s.id" class="scr">
                      <div class="scr-h">
                        <b>{{ s.title }}</b>
                        <span class="dim" style="font-size:10px">用 {{ s.used }}</span>
                      </div>
                      <div class="scr-c">{{ s.content }}</div>
                      <div class="row gap6" style="margin-top:6px">
                        <button class="btn btn-sm" @click="copyScript(s)">复制</button>
                        <button class="btn btn-sm" @click="text = (text ? text + '\n' : '') + s.content; mode='text'">填入跟进</button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="dim" style="font-size:11.5px">正在按客户标签匹配话术…</div>
                </div>

                <!-- 更新企微档案 -->
                <div class="card" style="padding:10px">
                  <div style="font-size:12px;font-weight:600;margin-bottom:7px">
                    企微客户档案 <span class="pill" style="font-weight:400">写回企业微信</span>
                  </div>
                  <label class="fld"><span>公司</span><input v-model="remark.company" /></label>
                  <label class="fld"><span>手机号</span><input v-model="remark.phone" /></label>
                  <label class="fld"><span>描述</span><textarea v-model="remark.description" rows="2" /></label>
                  <button class="btn btn-sm" style="margin-top:6px" @click="saveRemark">保存到企微档案</button>
                </div>

                <!-- 历史跟进 -->
                <div>
                  <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:6px">
                    最近跟进（{{ followups.length }}）
                  </div>
                  <div v-for="f in followups" :key="f.id" class="fu">
                    <div class="fu-meta">
                      {{ new Date(f.created_at).getMonth() + 1 }}/{{ new Date(f.created_at).getDate() }}
                      <span v-if="f.source === 'ai'" class="tag tag-v" style="margin-left:4px">AI</span>
                    </div>
                    <div class="fu-t">{{ f.content }}</div>
                  </div>
                  <div v-if="!followups.length" class="dim" style="font-size:11.5px">暂无记录</div>
                </div>
              </div>
            </aside>
          </div>
        </transition>

        <!-- 客户选择器（替代真实环境的 JSSDK 自动识别） -->
        <transition name="fadeUp">
          <div v-if="pickerOpen" class="picker" @click.self="pickerOpen = false">
            <div class="picker-box">
              <div class="picker-h">
                模拟 JSSDK 返回的客户
                <button class="btn btn-ghost btn-sm" @click="pickerOpen = false">✕</button>
              </div>
              <div class="picker-list">
                <button v-for="c in allCustomers.slice(0, 12)" :key="c.id" class="picker-item"
                        @click="selectCustomer(c.id); pickerOpen = false">
                  <b>{{ c.company_name }}</b><span>{{ c.contact_name }}</span>
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- ============ 右侧说明 ============ -->
    <aside class="spec">
      <div class="spec-card">
        <div class="spec-h">这是什么</div>
        <p style="margin:0;font-size:12.5px;line-height:1.75;color:var(--ink-2)">
          企微<b>聊天工具栏</b>内的侧边抽屉。销售在客户单聊窗口里点一下，就能更新客户档案和跟进记录，
          <b>不用切到别的系统</b>。左边手机里点底部的「客户助手」即可体验。
        </p>
      </div>

      <div class="spec-card">
        <div class="spec-h">为什么竞品做不到</div>
        <div class="spec-row"><b>悟空 AICRM</b><span>没有企微集成，只能在自家系统里操作</span></div>
        <div class="spec-row"><b>WeiClaw</b><span>客户端托管方案，只能<b>旁开一个独立窗口</b>，无法嵌入企微聊天界面</span></div>
        <div class="spec-row"><b>我们</b><span>走企微官方聊天工具栏，<b>不需要会话存档授权</b></span></div>
      </div>

      <div class="spec-card">
        <div class="spec-h">用到的官方接口</div>
        <div class="spec-row"><b>取当前客户</b><span><code>ww.getCurExternalContact()</code> · 入口 <code>single_chat_tools</code>（企微 2.8.10+）</span></div>
        <div class="spec-row"><b>写企业标签</b><span><code>externalcontact/mark_tag</code> · add_tag / remove_tag</span></div>
        <div class="spec-row"><b>改客户档案</b><span><code>externalcontact/remark</code> · 备注 / 描述 / 公司 / 手机号</span></div>
        <div class="spec-row"><b>会话存档</b><span><span class="pill warn">不需要</span> 以上接口均无此要求</span></div>
      </div>

      <div class="spec-card">
        <div class="spec-h">当前状态</div>
        <div class="spec-row"><b>JSSDK</b><span v-if="jssdkState === 'ok'" class="pill">已识别当前客户</span>
          <span v-else class="pill warn">未接入（原型模拟）</span></div>
        <div class="spec-row"><b>企微写入</b><span class="pill mock">模拟模式</span>
          <span class="dim" style="font-size:11px">真实环境调用官方接口</span></div>
        <div class="spec-row"><b>AI 引擎</b><span>{{ meta.aiMode === 'model' ? '真实模型' : '本地规则引擎' }}</span></div>
        <div style="margin-top:8px">
          <button class="btn btn-sm" @click="pickerOpen = true">切换模拟客户</button>
        </div>
      </div>

      <div class="spec-card" style="background:var(--accent-soft);border-color:var(--accent-line)">
        <div class="spec-h" style="color:var(--accent)">核心设计约束</div>
        <div style="font-size:12px;line-height:1.7;color:var(--ink-2)">
          所有 AI 生成的内容（整理的跟进、建议的标签）都<b>需要销售确认后才落库</b>。
          抽屉里没有「自动执行」——这是与 WeiClaw 的根本区别，也是合规底线。
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.slideL-enter-active, .slideL-leave-active { transition: transform .24s var(--ease), opacity .24s; }
.slideL-enter-from, .slideL-leave-to { transform: translateX(40px); opacity: 0; }

.tagbtn { border: 1px solid var(--line); background: var(--surface-2); height: 22px; padding: 0 8px; font-size: 11px; }
.tagbtn.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }

.modes { display: flex; gap: 4px; margin-bottom: 7px; }
.modes button {
  border: 1px solid var(--line); background: var(--surface); border-radius: var(--r-1);
  padding: 3px 9px; font-size: 11px; color: var(--ink-3);
}
.modes button.on { background: var(--ink); color: #fff; border-color: var(--ink); }

.ta {
  width: 100%; padding: 7px 9px; font-size: 12px; line-height: 1.6;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface-2); outline: 0; resize: vertical; color: var(--ink);
}
.ta:focus { border-color: var(--accent-line); }

.mockbox {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 14px; border: 1px dashed var(--line-strong); border-radius: var(--r-2);
  font-size: 11.5px; color: var(--ink-3); text-align: center;
}
.mock-ico { font-size: 20px; }

.draft {
  margin-top: 9px; padding: 9px; border-radius: var(--r-2);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.draft-h {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 600; color: var(--accent); margin-bottom: 6px;
}
.drow { display: flex; gap: 7px; font-size: 11.5px; padding: 2px 0; line-height: 1.6; }
.drow b { flex: 0 0 48px; color: var(--ink-3); font-weight: 400; }
.accent { color: var(--accent); }

.fld { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 6px; font-size: 11.5px; }
.fld span { flex: 0 0 44px; color: var(--ink-3); padding-top: 5px; }
.fld input, .fld textarea {
  flex: 1; padding: 5px 8px; font-size: 11.5px; border: 1px solid var(--line);
  border-radius: var(--r-1); background: var(--surface-2); outline: 0; color: var(--ink);
  resize: vertical;
}
.fld input:focus, .fld textarea:focus { border-color: var(--accent-line); }

.fu { padding: 7px 0; border-top: 1px solid var(--line-soft); }
.fu:first-child { border-top: 0; }
.fu-meta { font-size: 10.5px; color: var(--ink-4); }
.fu-t { font-size: 11.5px; line-height: 1.6; margin-top: 2px; }

/* 客户选择器 */
.picker {
  position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,.3);
  display: flex; align-items: flex-end;
}
.picker-box {
  width: 100%; background: var(--surface); border-radius: var(--r-4) var(--r-4) 0 0;
  max-height: 62%; display: flex; flex-direction: column;
}
.picker-h {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; font-size: 12.5px; font-weight: 600;
  border-bottom: 1px solid var(--line-soft);
}
.picker-list { overflow-y: auto; padding: 6px; }
.picker-item {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  border: 0; background: transparent; padding: 9px 10px; border-radius: var(--r-2);
  font-size: 12.5px; text-align: left; color: var(--ink);
}
.picker-item:hover { background: var(--bg-sunken); }
.picker-item span { color: var(--ink-3); font-size: 11.5px; }

.fadeUp-enter-active, .fadeUp-leave-active { transition: opacity .2s; }
.fadeUp-enter-from, .fadeUp-leave-to { opacity: 0; }

.scr { padding: 7px 0; border-top: 1px solid var(--line-soft); }
.scr:first-child { border-top: 0; padding-top: 0; }
.scr-h { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; }
.scr-c {
  font-size: 11px; line-height: 1.6; color: var(--ink-2); margin-top: 3px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

code {
  font-family: var(--mono); font-size: 11px;
  background: var(--bg-sunken); padding: 1px 4px; border-radius: 3px;
}
</style>
