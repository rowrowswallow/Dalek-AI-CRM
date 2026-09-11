<script setup>
import { ref, computed, inject, watch } from 'vue';
import { api, track } from '../api.js';
import BatchBar from './BatchBar.vue';
import SmartInput from './SmartInput.vue';

const ctx = inject('aicrm');
const keyword = ref('');
const selected = ref(null);
const detail = ref(null);
const showFollow = ref(false);
const followText = ref('');
const aiDraft = ref(null);
const parsing = ref(false);

/* ---- 新增客户 ---- */
const addOpen = ref(false);
const addForm = ref({ company_name: '', industry: '企业服务', contact_name: '', contact_phone: '', owner_name: '陈立', level: 'mid', tags: '' });
const adding = ref(false);
const INDUSTRIES = ['互联网', '企业服务', '医疗健康', '教育培训', '智能制造', '零售连锁', '金融保险', '建筑工程', '生活服务', '文化传媒'];

/* 智能录入回填 */
function onSmartFill(f) {
  const map = { company_name: 'company_name', contact_name: 'contact_name', contact_phone: 'contact_phone',
                contact_position: 'contact_position', industry: 'industry', level: 'level' };
  Object.keys(map).forEach((k) => { if (f[k]) addForm.value[map[k]] = f[k]; });
  if (Array.isArray(f.tags) && f.tags.length) addForm.value.tags = f.tags.join(' ');
  ctx.flash('已按识别结果填入表单');
}
async function onSmartBatch(rows) {
  const r = await api.importRows('customers', rows);
  addOpen.value = false;
  await ctx.refreshCustomers();
  ctx.flash(`已导入 ${r.imported} 家客户${r.failed ? `，${r.failed} 条失败` : ''}`);
  track('batch_import', { entity: 'customers', count: r.imported });
}

async function doAdd() {
  if (!addForm.value.company_name.trim()) return;
  adding.value = true;
  await api.addCustomer({
    ...addForm.value,
    tags: addForm.value.tags.split(/[，,\s]+/).filter(Boolean),
  });
  adding.value = false;
  addOpen.value = false;
  addForm.value = { company_name: '', industry: '企业服务', contact_name: '', contact_phone: '', owner_name: '陈立', level: 'mid', tags: '' };
  await ctx.refreshCustomers();
  ctx.flash('客户已创建');
  track('customer_create', {});
}

/* ---- 批量管理 ---- */
const checked = ref(new Set());
const BATCH_ACTIONS = [
  { key: 'tag', label: '批量打标' },
  { key: 'owner', label: '改负责人', options: [
    { value: 'U01', label: '陈立' }, { value: 'U02', label: '赵敏' }, { value: 'U03', label: '王涛' }] },
  { key: 'stage', label: '改阶段', options: [
    { value: '需求确认', label: '需求确认' }, { value: '方案沟通', label: '方案沟通' },
    { value: '已报价', label: '已报价' }, { value: '商务谈判', label: '商务谈判' },
    { value: '已成交', label: '已成交' }] },
  { key: 'level', label: '改意向度', options: [
    { value: 'high', label: '高意向' }, { value: 'mid', label: '中意向' }, { value: 'low', label: '低意向' }] },
  { key: 'delete', label: '删除客户', danger: true },
];
const OWNER_NAME = { U01: '陈立', U02: '赵敏', U03: '王涛' };

function toggleSel(id) {
  const s = new Set(checked.value);
  s.has(id) ? s.delete(id) : s.add(id);
  checked.value = s;
}
function selAll() {
  const ids = list.value.map((c) => c.id);
  checked.value = checked.value.size === ids.length ? new Set() : new Set(ids);
}
function clearSel() { checked.value = new Set(); }

async function handleBatch({ action, value }) {
  const ids = [...checked.value];
  if (!ids.length) return;
  if (action === 'tag') {
    const r = await api.batchCustomers(ids, 'tag', { add: ['重点跟进'] });
    ctx.flash(`已为 ${r.affected} 家客户打标`);
  } else if (action === 'delete') {
    const r = await api.batchCustomers(ids, 'delete');
    ctx.flash(`已删除 ${r.affected} 家客户`);
  } else if (action === 'owner') {
    await api.batchCustomers(ids, 'owner', { id: value, name: OWNER_NAME[value] || value });
    ctx.flash(`已改派 ${ids.length} 家客户的负责人`);
  } else if (action === 'stage') {
    await api.batchCustomers(ids, 'stage', value);
    ctx.flash(`已将 ${ids.length} 家客户改为「${value}」`);
  } else if (action === 'level') {
    await api.batchCustomers(ids, 'level', value);
    ctx.flash(`已调整 ${ids.length} 家客户的意向度`);
  }
  track('batch_action', { target: 'customer', action, count: ids.length });
  checked.value = new Set();
  await ctx.refreshCustomers();
}

const list = computed(() => {
  let l = ctx.customers.value;
  if (ctx.filter.value) {
    const ids = new Set(ctx.filter.value.ids);
    l = l.filter((c) => ids.has(c.id));
  }
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase();
    l = l.filter((c) =>
      c.company_name.toLowerCase().includes(k) ||
      c.contact_name.toLowerCase().includes(k) ||
      c.contact_phone.includes(k));
  }
  return l;
});

const statusClass = (s) =>
  s === '高意向' ? 'tag-a' : s === '活跃状态' ? 'tag-b' : 'tag';

function clearFilter() { ctx.filter.value = null; }

async function open(c) {
  checked.value = c;
  track('element_click', { target: 'customer_row', id: c.id });
  const d = await api.customer(c.id);
  detail.value = d;
  showFollow.value = false;
  aiDraft.value = null;
  followText.value = '';
}

/* AI 解析跟进 —— 结果必须人工确认（PRD 硬约束） */
async function doParse() {
  if (!followText.value.trim()) return;
  parsing.value = true;
  const r = await api.parseFollowup(followText.value, checked.value.id);
  aiDraft.value = r.draft;
  parsing.value = false;
  track('function_call', { scene: 'customer', tool: 'parse_followup' });
}

async function saveFollow(useDraft) {
  const body = {
    customer_id: checked.value.id,
    content: followText.value,
    source: useDraft ? 'ai' : 'manual',
    summary: useDraft && aiDraft.value ? aiDraft.value.summary : undefined,
    key_points: useDraft && aiDraft.value ? aiDraft.value.key_points : [],
    node_times: useDraft && aiDraft.value ? aiDraft.value.node_times : [],
    next_action: useDraft && aiDraft.value ? aiDraft.value.next_action : '',
  };
  await api.addFollowup(body);
  ctx.flash(useDraft ? '已按 AI 整理结果保存' : '跟进已保存');
  track('ai_suggestion_feedback', { type: 'followup_parse', action: useDraft ? 'accepted' : 'manual' });

  if (useDraft && aiDraft.value && aiDraft.value.suggest_tags.length) {
    await api.batchTag([checked.value.id], aiDraft.value.suggest_tags);
  }
  const d = await api.customer(checked.value.id);
  detail.value = d;
  await ctx.refreshCustomers();
  showFollow.value = false;
  aiDraft.value = null;
  followText.value = '';
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">客户列表</h1>
        <p class="vh-s">共 {{ list.length }} 家 · 按优先级排序（每一项都可追溯）</p>
      </div>
      <div class="row gap8">
        <input v-model="keyword" class="inp" placeholder="搜索公司 / 联系人 / 电话" />
        <button class="btn btn-sm" @click="selAll">
          {{ checked.size && checked.size === list.length ? '取消全选' : '全选本页' }}
        </button>
        <button class="btn btn-primary" @click="addOpen = true; track('element_click', { target: 'add_customer' })">+ 新增客户</button>
      </div>
    </header>

    <!-- AI 筛选提示：对话产出直接落到工作区 -->
    <div v-if="ctx.filter.value" class="filter-bar fade-up">
      <span class="tag on">对话筛选：{{ ctx.filter.value.label }}</span>
      <span class="dim">命中 {{ list.length }} 家</span>
      <button class="btn btn-ghost btn-sm" @click="clearFilter">清除</button>
    </div>

    <BatchBar
      :count="checked.size" :total="list.length" :actions="BATCH_ACTIONS" noun="家客户"
      @do="handleBatch" @select-all="selAll" @clear="clearSel"
    />

    <div class="scroll">
      <table class="tb">
        <thead>
          <tr>
            <th style="width:34px">
              <input type="checkbox" class="cb"
                     :checked="checked.size > 0 && checked.size === list.length"
                     @change="selAll" />
            </th>
            <th style="width:20%">公司名称</th>
            <th style="width:11%">联系人</th>
            <th style="width:12%">电话</th>
            <th style="width:11%">AI 状态</th>
            <th style="width:26%">AI 洞察摘要</th>
            <th style="width:9%">优先级</th>
            <th style="width:11%">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c.id"
              :class="{ hl: ctx.highlightId.value === c.id, sel: checked.has(c.id) }">
            <td><input type="checkbox" class="cb" :checked="checked.has(c.id)" @change="toggleSel(c.id)" /></td>
            <td>
              <div class="co">{{ c.company_name }}</div>
              <div class="co-sub">{{ c.industry }} · {{ c.owner_name }}</div>
            </td>
            <td>{{ c.contact_name }}</td>
            <td class="mono">{{ c.contact_phone }}</td>
            <td><span class="tag" :class="statusClass(c.ai_status)">{{ c.ai_status }}</span></td>
            <td class="insight" :title="c.ai_insight">{{ c.ai_insight }}</td>
            <td>
              <div class="ps">{{ c.priority_score }}</div>
              <div class="bar"><i :style="{ width: c.priority_score + '%' }" /></div>
            </td>
            <td><button class="btn btn-sm" @click="open(c)">AI 跟进</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!list.length" class="empty">
        <div class="empty-ico">◎</div>
        <div>没有匹配的客户</div>
      </div>
    </div>

    <!-- 新增客户 -->
    <transition name="fade">
      <div v-if="addOpen" class="modal" @click.self="addOpen = false">
        <div class="mbox card">
          <div class="mbox-h">新增客户<button class="btn btn-ghost btn-sm" @click="addOpen = false">✕</button></div>

          <SmartInput entity="customer" @fill="onSmartFill" @batch="onSmartBatch" />

          <div class="or"><span>或手动填写</span></div>

          <label class="fld"><span>公司名称 *</span><input v-model="addForm.company_name" placeholder="必填" /></label>
          <div class="two-col">
            <label class="fld"><span>行业</span>
              <select v-model="addForm.industry"><option v-for="i in INDUSTRIES" :key="i" :value="i">{{ i }}</option></select>
            </label>
            <label class="fld"><span>意向度</span>
              <select v-model="addForm.level">
                <option value="high">高意向</option><option value="mid">中意向</option><option value="low">低意向</option>
              </select>
            </label>
          </div>
          <div class="two-col">
            <label class="fld"><span>联系人</span><input v-model="addForm.contact_name" placeholder="姓名" /></label>
            <label class="fld"><span>电话</span><input v-model="addForm.contact_phone" placeholder="手机号" /></label>
          </div>
          <div class="two-col">
            <label class="fld"><span>负责人</span>
              <select v-model="addForm.owner_name"><option>陈立</option><option>赵敏</option><option>王涛</option></select>
            </label>
            <label class="fld"><span>标签</span><input v-model="addForm.tags" placeholder="空格分隔" /></label>
          </div>
          <div class="row gap6" style="justify-content:flex-end;margin-top:6px">
            <button class="btn btn-sm" @click="addOpen = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="adding || !addForm.company_name.trim()" @click="doAdd">
              {{ adding ? '创建中…' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 客户详情 -->
    <transition name="slide">
      <aside v-if="selected" class="drawer">
        <header class="dw-head">
          <div class="grow">
            <div class="dw-t">{{ selected.company_name }}</div>
            <div class="dw-s">{{ selected.industry }} · {{ selected.contact_name }} · {{ selected.owner_name }}</div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="selected = null">✕</button>
        </header>

        <div class="dw-body">
          <div class="dw-tags">
            <span v-for="t in selected.tags" :key="t" class="tag">{{ t }}</span>
          </div>

          <div class="card blk">
            <div class="blk-h">AI 分析</div>
            <div class="blk-row"><b>状态</b><span>{{ selected.ai_status }}</span></div>
            <div class="blk-row"><b>洞察</b><span>{{ selected.ai_insight }}</span></div>
            <div class="blk-row"><b>下一步</b><span class="accent">{{ selected.ai_next_step }}</span></div>
            <div class="blk-row"><b>优先级</b><span>{{ selected.priority_score }} · {{ selected.priority_reason }}</span></div>
          </div>

          <div class="card blk">
            <div class="blk-h">跟进记录（{{ (detail && detail.followups.length) || 0 }}）</div>
            <div v-if="detail && detail.followups.length" class="tl">
              <div v-for="f in detail.followups.slice(0, 8)" :key="f.id" class="tl-item">
                <div class="tl-dot" />
                <div class="tl-body">
                  <div class="tl-meta">
                    {{ fmt(f.created_at) }} · {{ f.created_by }}
                    <span v-if="f.source === 'ai'" class="tag tag-v" style="margin-left:4px">AI 整理</span>
                  </div>
                  <div class="tl-text">{{ f.content }}</div>
                  <div v-if="f.node_times && f.node_times.length" class="tl-node">
                    节点：{{ f.node_times.join('、') }}
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="dim" style="padding:6px 0">暂无跟进记录</div>
          </div>

          <!-- 记录跟进 -->
          <div class="card blk">
            <div class="blk-h">
              记录跟进
              <button v-if="!showFollow" class="btn btn-sm btn-accent" @click="showFollow = true">+ 记录</button>
            </div>
            <div v-if="showFollow">
              <textarea
                v-model="followText" class="ta" rows="4"
                placeholder="粘贴聊天记录、写几句话都行，比如「今天电话沟通，客户对价格敏感，约定下周一给方案」"
              />
              <div class="row gap6" style="margin-top:8px">
                <button class="btn btn-sm" :disabled="parsing || !followText.trim()" @click="doParse">
                  {{ parsing ? '解析中…' : '✦ AI 整理' }}
                </button>
                <button class="btn btn-sm btn-primary" :disabled="!followText.trim()" @click="saveFollow(false)">直接保存</button>
                <span class="dim grow" style="font-size:11px">AI 结果需你确认后才会落库</span>
              </div>

              <!-- AI 草稿（待确认） -->
              <div v-if="aiDraft" class="draft fade-up">
                <div class="draft-h">
                  <span>AI 整理结果</span>
                  <span class="tag tag-g">置信度 {{ Math.round(aiDraft.confidence * 100) }}%</span>
                </div>
                <div class="blk-row"><b>摘要</b><span>{{ aiDraft.summary }}</span></div>
                <div class="blk-row" v-if="aiDraft.key_points.length"><b>关注点</b><span>{{ aiDraft.key_points.join('、') }}</span></div>
                <div class="blk-row" v-if="aiDraft.node_times.length"><b>节点时间</b><span class="accent">{{ aiDraft.node_times.join('、') }}</span></div>
                <div class="blk-row" v-if="aiDraft.next_action"><b>下一步</b><span>{{ aiDraft.next_action }}</span></div>
                <div class="blk-row" v-if="aiDraft.suggest_tags.length">
                  <b>建议标签</b>
                  <span><span v-for="t in aiDraft.suggest_tags" :key="t" class="tag on" style="margin-right:4px">{{ t }}</span></span>
                </div>
                <div class="row gap6" style="margin-top:10px">
                  <button class="btn btn-sm btn-accent" @click="saveFollow(true)">采用并保存</button>
                  <button class="btn btn-sm" @click="aiDraft = null">忽略建议</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </transition>
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
.fld input, .fld select {
  width: 100%; padding: 7px 10px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink); font-family: inherit;
}
.fld input:focus, .fld select:focus { border-color: var(--accent-line); }
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.cb { width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
.tb tbody tr.sel { background: var(--accent-soft); }
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.vh {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 20px 12px; gap: 16px;
}
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.inp {
  height: 30px; width: 220px; padding: 0 10px; font-size: 12.5px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface); outline: 0; color: var(--ink);
}
.inp:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }

.filter-bar {
  display: flex; align-items: center; gap: 8px;
  margin: 0 20px 10px; padding: 7px 10px;
  background: var(--accent-soft); border: 1px solid var(--accent-line);
  border-radius: var(--r-2); font-size: 12px;
}

.scroll { flex: 1; overflow: auto; padding: 0 20px 20px; }
.tb { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.tb th {
  text-align: left; font-weight: 500; color: var(--ink-3); font-size: 11.5px;
  padding: 0 10px 8px; border-bottom: 1px solid var(--line); position: sticky; top: 0;
  background: var(--bg); z-index: 2;
}
.tb td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
.tb tbody tr { transition: background .14s; }
.tb tbody tr:hover { background: var(--surface); }
.tb tr.hl { background: var(--accent-soft); }
.co { font-weight: 550; }
.co-sub { font-size: 11px; color: var(--ink-3); margin-top: 1px; }
.insight { color: var(--ink-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 0; }
.ps { font-size: 12.5px; font-weight: 600; margin-bottom: 4px; }

/* 详情抽屉 */
.drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 420px;
  background: var(--surface); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; z-index: 20; box-shadow: var(--sh-4);
}
.dw-head {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid var(--line-soft);
}
.dw-t { font-size: 15px; font-weight: 650; }
.dw-s { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
.dw-body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
.dw-tags { display: flex; flex-wrap: wrap; gap: 5px; }

.blk { padding: 11px 12px; }
.blk-h {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 8px;
}
.blk-row { display: flex; gap: 8px; font-size: 12px; padding: 3px 0; line-height: 1.6; }
.blk-row b { flex: 0 0 52px; color: var(--ink-3); font-weight: 400; }
.accent { color: var(--accent); }

.tl { display: flex; flex-direction: column; gap: 0; }
.tl-item { display: flex; gap: 9px; padding-bottom: 12px; position: relative; }
.tl-item:not(:last-child)::before {
  content: ''; position: absolute; left: 3px; top: 12px; bottom: 0;
  border-left: 1px dashed var(--line-strong);
}
.tl-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; margin-top: 5px;
  background: var(--accent); z-index: 1;
}
.tl-body { min-width: 0; }
.tl-meta { font-size: 11px; color: var(--ink-3); }
.tl-text { font-size: 12px; margin-top: 2px; line-height: 1.6; }
.tl-node { font-size: 11px; color: var(--accent); margin-top: 3px; }

.ta {
  width: 100%; padding: 8px 10px; font-size: 12.5px; line-height: 1.6;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface-2); outline: 0; resize: vertical; color: var(--ink);
}
.ta:focus { border-color: var(--accent-line); }

.draft {
  margin-top: 10px; padding: 10px; border-radius: var(--r-2);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.draft-h {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11.5px; font-weight: 600; color: var(--accent); margin-bottom: 6px;
}

.slide-enter-active, .slide-leave-active { transition: transform .22s var(--ease); }
.slide-enter-from, .slide-leave-to { transform: translateX(30px); opacity: 0; }
</style>
