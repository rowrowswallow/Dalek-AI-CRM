#!/usr/bin/env node
/* ------------------------------------------------------------------
   Node 版本检查 —— 朋友 clone 下来最容易卡在这里
  node:sqlite 需要 Node >= 22.5
------------------------------------------------------------------ */
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 5)) {
  console.error([
    '',
    '  ✗ Node 版本过低',
    '',
    '  当前版本：v' + process.versions.node,
    '  需要版本：v22.5.0 或更高（用到了内置的 node:sqlite）',
    '',
    '  升级方式：',
    '    · 官网下载  https://nodejs.org/   （选 LTS）',
    '    · 或用 nvm  nvm install 22 && nvm use 22',
    '',
    '  升级后重新运行  npm start',
    '',
  ].join('\n'));
  process.exit(1);
}

try { require('node:sqlite'); } catch (e) {
  console.error('\n  ✗ 当前 Node 不包含 node:sqlite 模块（v' + process.versions.node + '）\n'
    + '  请升级到 v22.5.0 或更高版本。\n');
  process.exit(1);
}


/**
 * AICRM 原型后端 —— 零依赖 Node HTTP 服务
 *
 * 设计要点：
 *  1. 不依赖任何 npm 包，`node server/index.js` 直接跑
 *  2. AI 层可插拔：没配 API Key 时用「规则 + 模板」引擎，
 *     配了就透传真实模型（AI_API_KEY / AI_BASE_URL / AI_MODEL）
 *  3. 所有写操作走 /api/ai/confirm，模拟「AI 生成 → 用户确认 → 落库」
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;
const AI_KEY = process.env.AI_API_KEY || '';
const AI_BASE = process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AI_MODEL = process.env.AI_MODEL || 'qwen-plus';

const store = require('./store.js');
const ai = require('./ai.js');
const kb = require('./knowledge.js');
const auth = require('./auth.js');
const aist = require('./assistants.js');
const settings = require('./settings.js');
const db = require('./db.js').db;
const extract = require('./extract.js');

/* ------------------------------------------------------------------ 工具 */
function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-AICRM-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 4e6) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({}); }
    });
  });
}

/* ------------------------------------------------------------------ 账号辅助 */
function tokenOf(req) {
  return req.headers['x-aicrm-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

/** 当前请求所属的工作区（未登录时为空字符串，表示不过滤——仅内部调用） */
function wsOf(req) {
  const u = auth.userByToken(tokenOf(req));
  // 到达这里说明已经过中央鉴权；仍加一道保险，宁可返回一个不存在的值也不放行全量
  return u ? u.workspace_id : '__no_workspace__';
}

/* ------------------------------------------------------------------ 路由 */
const routes = [];
const get = (p, h) => routes.push(['GET', p, h]);
const post = (p, h) => routes.push(['POST', p, h]);
const patch = (p, h) => routes.push(['PATCH', p, h]);

/* ---- 元信息 ---- */
get('/api/meta', () => ({
  ok: true,
  app: 'AICRM',
  aiMode: settings.effectiveMode(),
  aiModel: (() => {
    const m = settings.effectiveMode();
    if (m === 'user') return settings.get().model + '（你自己的 API）';
    if (m === 'env') return AI_MODEL + '（环境变量）';
    return '本地规则引擎（未配置 API Key）';
  })(),
  scenes: ai.SCENES,
}));

/* ---- 客户 ---- */
get('/api/customers', (q, p, b, req) => {
  let list = store.customers(null, wsOf(req));
  if (q.tag) list = list.filter((c) => c.tags.includes(q.tag));
  if (q.industry) list = list.filter((c) => c.industry === q.industry);
  if (q.owner) list = list.filter((c) => c.owner_name === q.owner);
  if (q.status) list = list.filter((c) => c.status === q.status);
  if (q.q) {
    const k = q.q.toLowerCase();
    list = list.filter((c) =>
      (c.company_name || '').toLowerCase().includes(k) ||
      (c.contact_name || '').toLowerCase().includes(k) ||
      (c.contact_phone || '').includes(k));
  }
  if (q.sort === 'last_follow') list = [...list].sort((a, b) => (b.last_follow_at || '').localeCompare(a.last_follow_at || ''));
  else if (q.sort === 'created') list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  else list = [...list].sort((a, b) => b.priority_score - a.priority_score);
  return { ok: true, total: list.length, list };
});

get('/api/customers/:id', (q, p, b, req) => {
  const c = store.customerIn(p.id, wsOf(req));
  if (!c) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    customer: c,
    followups: store.followups({ customer_id: c.id }, wsOf(req)),
    tasks: store.tasks({ customer_id: c.id }),
  };
});

patch('/api/customers/:id', (q, p, body) => {
  const c = store.updateCustomer(p.id, body);
  return c ? { ok: true, customer: c } : { ok: false, error: 'not_found' };
});

post('/api/customers', (q, p, body, req) => {
  if (!body.company_name) return { ok: false, error: 'company_name_required' };
  return { ok: true, customer: store.addCustomer(body, wsOf(req)) };
});

post('/api/customers/batch-tag', (q, p, body) => {
  const { ids = [], add = [], remove = [] } = body;
  ids.forEach((id) => {
    const c = store.customer(id);
    if (!c) return;
    const set = new Set(c.tags);
    add.forEach((t) => set.add(t));
    remove.forEach((t) => set.delete(t));
    store.updateCustomer(id, { tags: [...set], ai_dirty: true });
  });
  return { ok: true, affected: ids.length };
});

/* ---- 跟进 ---- */
get('/api/followups', (q, p, b, req) => ({
  ok: true,
  list: store.followups(q.customer_id ? { customer_id: q.customer_id } : undefined, wsOf(req)),
}));

post('/api/followups', (q, p, body, req) => {
  if (!body.customer_id || !body.content) return { ok: false, error: 'invalid' };
  return { ok: true, followup: store.addFollowup(body, wsOf(req)) };
});

post('/api/followups/ai-parse', (q, p, body) =>
  ai.parseFollowup(body.content || '', { customer_id: body.customer_id })
    .then((draft) => ({ ok: true, draft })));

/* ---- 标签 ---- */
get('/api/tags', () => ({ ok: true, groups: store.tagGroups() }));

/* ---- 任务 ---- */
get('/api/tasks', (q, p, b, req) => {
  let list = store.tasks(null, wsOf(req));
  if (q.status && q.status !== 'all') list = list.filter((t) => t.status === q.status);
  if (q.customer_id) list = list.filter((t) => t.customer_id === q.customer_id);
  return { ok: true, list, counts: store.taskCounts(wsOf(req)) };
});

post('/api/tasks', (q, p, body, req) => {
  if (!body.title) return { ok: false, error: 'invalid' };
  return { ok: true, task: store.addTask(body, wsOf(req)) };
});

post('/api/tasks/remove', (q, p, body, req) => {
  const mine = store.tasks(null, wsOf(req)).some((t) => t.id === body.id);
  if (!mine) return { ok: false, error: 'not_found' };
  return { ok: store.deleteTask(body.id) };
});

patch('/api/tasks/:id', (q, p, body, req) => {
  const mine = store.tasks(null, wsOf(req)).some((t) => t.id === p.id);
  if (!mine) return { ok: false, error: 'not_found' };
  const t = store.updateTask(p.id, body);
  return t ? { ok: true, task: t } : { ok: false, error: 'not_found' };
});

/* ---- 统计 / 优先级 / 汇报 ---- */
get('/api/stats/overview', (q, p, b, req) => ({ ok: true, stats: store.stats(wsOf(req)) }));
get('/api/stats/priority', (q, p, b, req) => ({ ok: true, list: store.topPriority(Number(q.n) || 5, wsOf(req)) }));
post('/api/report/generate', (q, p, body, req) => ({ ok: true, report: store.buildReport(body.range || 'week', wsOf(req)) }));

/* ---- AI 建议的采纳反馈（核心埋点） ---- */
post('/api/ai/suggestion/feedback', (q, p, body) => {
  store.recordFeedback(body);
  return { ok: true };
});

/* ---- 企微（原型里返回模拟结果） ---- */
post('/api/wecom/sync-tag', (q, p, body) => ({
  ok: true, mode: 'mock',
  synced: body.add || [], external_userid: body.external_userid || null,
  note: '原型环境：真实环境将调用 externalcontact/mark_tag',
}));
post('/api/wecom/update-remark', (q, p, body) => ({
  ok: true, mode: 'mock', fields: Object.keys(body.fields || {}),
  note: '原型环境：真实环境将调用 externalcontact/remark',
}));
get('/api/wecom/resolve', (q) => {
  // 模拟 ww.getCurExternalContact()：抽屉按 external_userid 找客户
  const c = store.customerByExternal(q.external_userid);
  return c ? { ok: true, customer_id: c.id, customer: c } : { ok: false, error: 'not_found' };
});

/* ---- 健康检查（部署平台探针） ---- */
get('/api/health', () => ({ ok: true, status: 'healthy', time: new Date().toISOString() }));

/* ---- 账号系统 ---- */
post('/api/auth/login', (q, p, body) => {
  const r = auth.login(body.username || '', body.password || '');
  return r.ok ? { ok: true, token: r.token, user: r.user } : { ok: false, error: r.error };
});
post('/api/auth/logout', (q, p, body, req) => { auth.logout(tokenOf(req)); return { ok: true }; });
get('/api/auth/me', (q, p, b, req) => {
  const u = auth.userByToken(tokenOf(req));
  return u ? { ok: true, user: u, roles: auth.ROLES } : { ok: false, error: 'unauthorized' };
});
get('/api/auth/accounts', () => ({ ok: true, accounts: auth.demoAccounts() }));

post('/api/auth/register', (q, p, body) => {
  const r = auth.register(body || {});
  return r.ok ? { ok: true, token: r.token, user: r.user } : { ok: false, error: r.error };
});

/* ---- 邀请码管理（仅登录用户可操作） ---- */
get('/api/auth/invites', (q, p, b, req) => {
  const u = auth.userByToken(tokenOf(req));
  if (!u) return { ok: false, error: 'unauthorized' };
  return { ok: true, list: auth.listInvites(), stats: auth.stats() };
});

post('/api/auth/invites', (q, p, body, req) => {
  const u = auth.userByToken(tokenOf(req));
  if (!u) return { ok: false, error: 'unauthorized' };
  return { ok: true, invite: auth.createInvite({ ...(body || {}), created_by: u.username }) };
});

post('/api/auth/invites/toggle', (q, p, body) => ({ ok: auth.disableInvite(body.code) }));
post('/api/auth/invites/remove', (q, p, body) => ({ ok: auth.removeInvite(body.code) }));

/* ---- 用户管理 ---- */
get('/api/auth/users', (q, p, b, req) => {
  const u = auth.userByToken(tokenOf(req));
  if (!u) return { ok: false, error: 'unauthorized' };
  return { ok: true, list: auth.listUsers() };
});

post('/api/auth/users/remove', (q, p, body, req) => {
  const u = auth.userByToken(tokenOf(req));
  if (!u) return { ok: false, error: 'unauthorized' };
  return auth.removeUser(body.id, u.id);
});

/* ---- 智能录入：语音文本 / 图片 / 附件 统一解析 ---- */
function aiCfg() {
  return settings.effectiveMode() === 'user' ? settings.get()
    : process.env.AI_API_KEY
      ? { api_key: process.env.AI_API_KEY, base_url: process.env.AI_BASE_URL, model: process.env.AI_MODEL }
      : null;
}

post('/api/extract/text', async (q, p, body) => {
  const entity = body.entity || 'customer';
  const text = body.text || '';
  if (!text.trim()) return { ok: false, error: 'empty' };
  let out = entity === 'task' ? extract.parseTask(text)
    : entity === 'kb' ? extract.parseKnowledge(text)
    : extract.parseCustomer(text);
  // 配了模型时用模型兜底补全空字段
  const cfg = aiCfg();
  if (cfg && out._confidence < 0.85) {
    const llm = await extract.llmParse(entity, text, cfg);
    if (llm) {
      Object.keys(llm).forEach((k) => {
        if (k.startsWith('_')) { out[k] = llm[k]; return; }
        const v = llm[k];
        const empty = out[k] === '' || out[k] === null || out[k] === undefined
          || (Array.isArray(out[k]) && !out[k].length);
        if (empty && v !== null && v !== undefined && v !== '') out[k] = v;
      });
      out._source = 'model+rule';
    }
  }
  return { ok: true, fields: out };
});

post('/api/extract/ocr', async (q, p, body) => {
  const cfg = aiCfg();
  try {
    const text = await extract.ocrImage(body.image, cfg);
    const entity = body.entity || 'customer';
    const fields = entity === 'task' ? extract.parseTask(text)
      : entity === 'kb' ? extract.parseKnowledge(text)
      : extract.parseCustomer(text);
    return { ok: true, text, fields: { ...fields, _source: 'ocr' } };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

post('/api/extract/table', (q, p, body) => {
  const { headers, rows } = extract.parseTable(body.text || '');
  if (!rows.length) return { ok: false, error: '没有解析到数据行' };
  const mapped = extract.mapRows(headers, rows);
  return { ok: true, headers, header_map: headers.map(extract.mapHeader), rows: mapped, count: mapped.length };
});

/* ---- 系统设置：AI 服务配置 ---- */
get('/api/settings/ai', () => ({ ok: true, ...settings.getSafe() }));
post('/api/settings/ai', (q, p, body) => ({ ok: true, ...settings.update(body.ai || body) }));
post('/api/settings/ai/test', async () => ({ ok: true, result: await settings.test() }));
post('/api/settings/ai/clear', () => ({ ok: true, ...settings.clearKey() }));

/* ---- AI 助手体系 ---- */
get('/api/assistants', () => ({ ok: true, list: aist.list(), stats: aist.stats() }));
get('/api/assistants/scene/:scene', (q, p) => ({ ok: true, list: aist.byScene(p.scene) }));
get('/api/assistants/:id', (q, p) => {
  const a = aist.get(p.id);
  return a ? { ok: true, assistant: a } : { ok: false, error: 'not_found' };
});
patch('/api/assistants/:id', (q, p, body) => {
  const a = aist.update(p.id, body);
  return a ? { ok: true, assistant: a } : { ok: false, error: 'not_found' };
});

/* ---- 会话（按助手隔离）---- */
get('/api/conversations', (q, p, b, req) => ({ ok: true, list: aist.conversations(q.assistant_id, wsOf(req)) }));
get('/api/conversations/:id', (q, p, b, req) => {
  const c = aist.conversation(p.id);
  if (!c || (wsOf(req) && c.workspace_id && c.workspace_id !== wsOf(req))) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: true, conversation: c };
});
post('/api/conversations/new', (q, p, body, req) => ({
  ok: true, conversation: aist.newConversation(body.assistant_id, body.title, body.context, wsOf(req)),
}));
post('/api/conversations/:id/append', (q, p, body) => {
  const c = aist.conversation(p.id);
  if (!c) return { ok: false, error: 'not_found' };
  if (body.user) aist.addMessage(p.id, 'user', body.user);
  if (body.assistant) aist.addMessage(p.id, 'assistant', body.assistant);
  return { ok: true, conversation: aist.conversation(p.id) };
});
post('/api/conversations/clear', (q, p, body, req) => {
  aist.clearConversations(body.assistant_id, wsOf(req));
  return { ok: true };
});

/* ---- 数据看板（看板工程师操作的对象）---- */
get('/api/dashboard/cards', (q, p, b, req) => ({ ok: true, cards: aist.cards(wsOf(req)), templates: aist.cardTemplates() }));
post('/api/dashboard/cards/add', (q, p, body, req) => {
  const ws = wsOf(req);
  const c = aist.addCard(body, ws);
  aist.logChange({
    ws,
    from: 'dashboard', from_name: '看板工程师', reports_to: 'data',
    action: 'add_card',
    summary: `新增卡片「${c.title}」（类型：${c.type}）。原因：${body.reason || '按用户要求配置'}`,
    card_id: c.id,
  });
  return { ok: true, card: c };
});
post('/api/dashboard/cards/remove', (q, p, body, req) => {
  const card = aist.cards(wsOf(req)).find((x) => x.id === body.id);
  const ok = aist.removeCard(body.id);
  if (ok) {
    aist.logChange({
      ws: wsOf(req),
      from: 'dashboard', from_name: '看板工程师', reports_to: 'data',
      action: 'remove_card',
      summary: `移除卡片「${card ? card.title : body.id}」。原因：${body.reason || '按用户要求配置'}`,
      card_id: body.id,
    });
  }
  return { ok };
});
post('/api/dashboard/cards/reorder', (q, p, body) => ({ ok: aist.reorderCard(body.id, body.dir) }));
post('/api/dashboard/cards/reset', (q, p, b, req) => { aist.resetCards(wsOf(req)); return { ok: true, cards: aist.cards(wsOf(req)) }; });
get('/api/dashboard/changes', (q, p, b, req) => ({ ok: true, list: aist.changes(wsOf(req)) }));

/* ---- 批量导入（智能录入的附件通道） ---- */
post('/api/import/:entity', (q, p, body, req) => {
  const ws = wsOf(req);
  const rows = body.rows || [];
  if (!rows.length) return { ok: false, error: 'empty' };
  let n = 0;
  const errors = [];
  rows.forEach((r, i) => {
    try {
      if (p.entity === 'customers') {
        if (!r.company_name) { errors.push(`第 ${i + 1} 行缺少公司名称`); return; }
        store.addCustomer(r, ws);
      } else if (p.entity === 'tasks') {
        if (!r.title) { errors.push(`第 ${i + 1} 行缺少标题`); return; }
        store.addTask(r, ws);
      } else if (p.entity === 'kb') {
        if (!r.title) { errors.push(`第 ${i + 1} 行缺少标题`); return; }
        kb.add(r, ws);
      } else return;
      n++;
    } catch (e) { errors.push(`第 ${i + 1} 行：${e.message}`); }
  });
  return { ok: true, imported: n, failed: errors.length, errors: errors.slice(0, 5) };
});

/* ---- 演示数据重置 ---- */
post('/api/admin/reset', (q, p, b, req) => {
  require('./db.js').reset(wsOf(req));
  return { ok: true, message: '数据已重置，请重新登录' };
});

/* ---- 批量操作 ---- */
post('/api/batch/customers', (q, p, body, req) => {
  const { ids = [], action, value } = body;
  const ws = wsOf(req);
  // 跨工作区的 id 一律过滤掉
  const mine = new Set(store.customers(null, ws).map((c) => c.id));
  const safe = ids.filter((id) => mine.has(id));
  if (!ids.length) return { ok: false, error: 'empty' };
  if (action === 'delete') safe.forEach((id) => store.deleteCustomer(id));
  else if (action === 'tag') safe.forEach((id) => {
    const c = store.customer(id); if (!c) return;
    const set = new Set(c.tags);
    ((value || {}).add || []).forEach((t) => set.add(t));
    ((value || {}).remove || []).forEach((t) => set.delete(t));
    store.updateCustomer(id, { tags: [...set] });
  });
  else if (action === 'owner') safe.forEach((id) => store.updateCustomer(id, { owner_id: value.id, owner_name: value.name }));
  else if (action === 'level') safe.forEach((id) => store.updateCustomer(id, { level: value }));
  else if (action === 'stage') safe.forEach((id) => store.updateCustomer(id, { stage: value }));
  else return { ok: false, error: 'unknown_action' };
  return { ok: true, affected: safe.length, action };
});
post('/api/batch/tasks', (q, p, body, req) => {
  const { ids = [], action, value } = body;
  const mine = new Set(store.tasks(null, wsOf(req)).map((t) => t.id));
  const ids2 = ids.filter((id) => mine.has(id));
  if (!ids2.length) return { ok: false, error: 'empty' };
  const ids3 = ids2;
  if (action === 'delete') ids3.forEach((id) => store.deleteTask(id));
  else if (action === 'status') ids3.forEach((id) => store.updateTask(id, { status: value }));
  else if (action === 'priority') ids3.forEach((id) => store.updateTask(id, { priority: value }));
  else return { ok: false, error: 'unknown_action' };
  return { ok: true, affected: ids3.length, action };
});
post('/api/batch/kb', (q, p, body, req) => {
  const { ids = [], action, value } = body;
  const mine = new Set(kb.list({}, wsOf(req)).list.map((k) => k.id));
  const safe = ids.filter((id) => mine.has(id));
  if (!safe.length) return { ok: false, error: 'empty' };
  if (action === 'delete') safe.forEach((id) => kb.remove(id));
  else if (action === 'category') safe.forEach((id) => kb.update(id, { category: value }));
  else return { ok: false, error: 'unknown_action' };
  return { ok: true, affected: safe.length, action };
});

/* ---- 知识库 / 素材库 ---- */
get('/api/kb/categories', () => ({ ok: true, categories: kb.categories(), types: kb.types() }));
get('/api/kb/stats', (q, p, b, req) => ({ ok: true, stats: kb.stats(wsOf(req)), tags: kb.tags(wsOf(req)) }));
get('/api/kb/list', (q, p, b, req) => {
  const r = kb.list({ category: q.category, type: q.type, q: q.q, tag: q.tag }, wsOf(req));
  return { ok: true, ...r };
});
get('/api/kb/get/:id', (q, p, b, req) => {
  const it = kb.get(p.id);
  if (!it || (wsOf(req) && it.workspace_id !== wsOf(req))) return { ok: false, error: 'not_found' };
  return { ok: true, item: it };
});
post('/api/kb/add', (q, p, body, req) => ({ ok: true, item: kb.add(body, wsOf(req)) }));
post('/api/kb/update', (q, p, body, req) => {
  const own = kb.get(body.id);
  if (!own || own.workspace_id !== wsOf(req)) return { ok: false, error: 'not_found' };
  const it = kb.update(body.id, body.patch || body);
  return it ? { ok: true, item: it } : { ok: false, error: 'not_found' };
});
post('/api/kb/remove', (q, p, body) => ({ ok: kb.remove(body.id) }));
post('/api/kb/use', (q, p, body) => {
  const it = kb.use(body.id);
  return it ? { ok: true, used_count: it.used_count } : { ok: false, error: 'not_found' };
});

/** 知识库问答：检索 + 组装答案（本地为 RAG-lite，配 Key 后可换真实模型） */
post('/api/kb/ask', (q, p, body, req) => {
  const question = (body.question || '').trim();
  if (!question) return { ok: false, error: 'empty' };
  const r = kb.list({ q: question }, wsOf(req));
  const hits = r.list.slice(0, 4);
  if (!hits.length) {
    return { ok: true, answer: '知识库里没有找到相关内容。可以换个说法，或者先补充这条资料。', sources: [] };
  }
  const top = hits[0];
  const answer = `**${top.title}**\n\n${top.content}`
    + (hits.length > 1 ? `\n\n另外这几条也相关：${hits.slice(1).map((h) => `《${h.title}》`).join('、')}` : '');
  return {
    ok: true, answer,
    sources: hits.map((h) => ({ id: h.id, title: h.title, category: h.category, used_count: h.used_count })),
  };
});

/** 定向话术生成：知识库 × 客户上下文（学悟空的 targeted-script，但服务于「对上」也服务于「对客户」） */
post('/api/kb/script', (q, p, body, req) => {
  const { customer_id, target = 'customer', intent = '' } = body;
  const ws = wsOf(req);
  const c = customer_id ? store.customer(customer_id) : null;

  if (target === 'boss') {
    // 汇报口径：从「汇报资料」类里取
    const pool = kb.list({ category: 'report' }, ws).list;
    const pick = intent && /线索|变少|下降/.test(intent)
      ? pool.find((x) => x.title.includes('线索'))
      : intent && /跟丢|流失/.test(intent)
        ? pool.find((x) => x.title.includes('跟丢'))
        : pool.find((x) => x.title.includes('老板'));
    const structure = kb.list({ category: 'report' }, ws).list.find((x) => x.title.includes('模板'));
    return {
      ok: true, target: 'boss',
      script: (pick ? `**${pick.title}**\n${pick.content}` : '')
        + (structure ? `\n\n**汇报结构参考**\n${structure.content}` : ''),
      sources: [pick, structure].filter(Boolean).map((x) => ({ id: x.id, title: x.title })),
    };
  }

  // 对客户口径：按客户标签挑话术
  const tags = c ? c.tags : [];
  let want = '开场';
  if (tags.includes('价格敏感')) want = '价格';
  else if (tags.includes('竞品接触中')) want = '竞品';
  else if (tags.includes('长期沉默')) want = '唤醒';
  else if (tags.includes('已报价') || tags.includes('商务谈判')) want = '促单';

  const pool = kb.list({ category: 'script' }, ws).list;
  const hit = pool.find((x) => x.tags.includes(want)) || pool[0];
  const opener = c
    ? `> 对象：${c.contact_name}（${c.company_name}）· 阶段：${c.stage} · 当前状态：${c.ai_status}\n\n`
    : '';
  return {
    ok: true, target: 'customer', matched_by: want,
    script: opener + (hit ? hit.content : '话术库里暂无匹配内容'),
    sources: hit ? [{ id: hit.id, title: hit.title }] : [],
  };
});

get('/api/kb/tag/:tag', (q, p, b, req) => {
  const r = kb.list({ tag: decodeURIComponent(p.tag) }, wsOf(req));
  return { ok: true, ...r };
});

/* ---- AI 对话（SSE 流式） ---- */
post('/api/ai/chat', (q, p, body, req, res) => {
  const scene = body.scene || 'customer';
  const text = body.text || '';
  const ctx = body.context || {};

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  ai.chat({ scene, text, ctx, store, kb, aist, settings, attachments: body.attachments })
    .then((reply) => {
      // 模拟流式：按片段推送
      const chunks = reply.text.match(/[\s\S]{1,14}/g) || [''];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          clearInterval(timer);
          send('action', { actions: reply.actions || [] });
          send('done', { latency_ms: Date.now() - started, scene });
          res.end();
          return;
        }
        send('delta', { text: chunks[i++] });
      }, 28);
    })
    .catch((e) => {
      send('error', { message: String(e.message || e) });
      res.end();
    });

  const started = Date.now();
  req.on('close', () => { try { res.end(); } catch {} });
  return 'STREAM';
});

/* ------------------------------------------------------------------ 启动 */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, { ok: true });

  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const q = Object.fromEntries(u.searchParams.entries());
  let pathname = u.pathname;

  // 静态资源（web/dist 构建产物）
  if (!pathname.startsWith('/api/')) {
    const distDir = path.join(__dirname, '..', 'web', 'dist');
    let file = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(file) && !path.extname(pathname)) file = path.join(distDir, 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      return fs.createReadStream(file).pipe(res);
    }
    return json(res, { ok: false, error: 'not_found', hint: '前端请用 vite dev（cd web && npm run dev）' }, 404);
  }

  /* 需要登录才能访问的数据接口白名单外一律鉴权 */
  const PUBLIC = [
    '/api/health', '/api/meta', '/api/auth/login', '/api/auth/register',
    '/api/auth/accounts', '/api/auth/me', '/api/auth/logout',
  ];
  if (!PUBLIC.includes(pathname)) {
    const u = auth.userByToken(tokenOf(req));
    if (!u) return json(res, { ok: false, error: 'unauthorized', hint: '请先登录' }, 401);
  }

  for (const [method, pattern, handler] of routes) {
    if (method !== req.method) continue;
    const m = matchPath(pattern, pathname);
    if (!m) continue;
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    try {
      const out = await handler(q, m, body, req, res);   // 支持 async handler
      if (out === 'STREAM') return;               // SSE 已接管响应
      return json(res, out);
    } catch (e) {
      return json(res, { ok: false, error: String(e.message || e) }, 500);
    }
  }
  json(res, { ok: false, error: 'not_found', path: pathname }, 404);
});

function matchPath(pattern, pathname) {
  const a = pattern.split('/'), b = pathname.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

server.listen(PORT, '127.0.0.1', () => {
  const mode = settings.effectiveMode();
  const aiText = mode === 'user' ? '真实模型 · ' + settings.get().model + '（你自己的 API）'
    : mode === 'env' ? '真实模型 · ' + (process.env.AI_MODEL || '环境变量配置')
    : '本地规则引擎（未配置 API Key，功能完整可体验）';
  const hasDist = fs.existsSync(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
  const c = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;

  console.log('');
  console.log('  AICRM 已启动');
  console.log('  ─────────────────────────────────────────────');
  console.log('  打开     http://127.0.0.1:' + PORT + '/');
  console.log('  登录     chenli / 123456');
  console.log('  AI 模式  ' + aiText);
  console.log('  数据     SQLite · data/aicrm.db（' + c + ' 个客户）');
  if (!hasDist) {
    console.log('');
    console.log('  ⚠ 前端还没构建 —— 先执行  npm run setup');
    console.log('     或开发模式：npm run dev:server + npm run dev:web');
  }
  console.log('');
});
