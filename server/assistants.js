/**
 * AI 助手体系 + 分助手会话 + 看板卡片
 *
 * 核心设计（对应用户第 3、4 条需求）：
 *  · 每个助手 = 一个页面 + 一套工具 + 一个上下文范围 + 独立的会话列表
 *  · 聊天记录按助手隔离，不同助手管不同的上下文
 *  · 「看板工程师」能增删数据看板的卡片，并**向该页面的负责助手（数据分析师）汇报**
 */
'use strict';

const { db, J, S, uid } = require('./db.js');

const now = () => new Date().toISOString();

/* ------------------------------------------------------------ 助手定义 */
const ASSISTANTS = [
  {
    id: 'customer', name: '客户管理助手', avatar: '客',
    duty: '筛客户、查状态、批量打标、改负责人',
    scene: 'customer', scene_name: '客户',
    context_scope: ['客户档案', '客户标签', '跟进记录'],
    tools: ['query_customers', 'get_customer_detail', 'batch_tag', 'update_owner', 'summarize_customer'],
    reports_to: null, builtin: true, enabled: true, tone: '利落，直接给筛选结果',
  },
  {
    id: 'knowledge', name: '知识库助手', avatar: '知',
    duty: '检索资料、生成话术、找汇报口径',
    scene: 'knowledge', scene_name: '知识库',
    context_scope: ['知识库条目', '话术库', '汇报资料'],
    tools: ['kb_search', 'kb_ask', 'kb_script', 'kb_add'],
    reports_to: null, builtin: true, enabled: true, tone: '引用原文，不编造',
  },
  {
    id: 'tag', name: '客户洞察助手', avatar: '析',
    duty: '客群分布、分群对比、标签体系建议',
    scene: 'tag', scene_name: '标签画像',
    context_scope: ['客户标签', '客群统计'],
    tools: ['analyze_segment', 'suggest_tags', 'compare_segments', 'list_tags'],
    reports_to: null, builtin: true, enabled: true, tone: '给结论 + 给依据',
  },
  {
    id: 'task', name: '任务助手', avatar: '任',
    duty: '建任务、排优先级、从跟进提取任务',
    scene: 'task', scene_name: '任务',
    context_scope: ['任务列表', '客户关联'],
    tools: ['query_tasks', 'create_task', 'update_task_status', 'extract_tasks'],
    reports_to: null, builtin: true, enabled: true, tone: '排序必须给理由',
  },
  {
    id: 'data', name: '数据分析师', avatar: '数',
    duty: '归因分析、趋势解读、异常预警（只出结论不动手）',
    scene: 'data', scene_name: '数据',
    context_scope: ['客户统计', '跟进统计', '任务统计', '看板卡片'],
    tools: ['get_stats', 'analyze_trend', 'attribute_drop', 'explain_metric'],
    reports_to: null, builtin: true, enabled: true, tone: '只出结论，不改数据',
    is_page_owner: true,          // ← 数据页的负责助手
  },
  {
    id: 'report', name: '汇报助手', avatar: '报',
    duty: '生成汇报稿、归因、下周建议',
    scene: 'report', scene_name: '汇报',
    context_scope: ['业务数据', '知识库·汇报资料', '客户跟进'],
    tools: ['generate_report', 'explain_number', 'quote_kb'],
    reports_to: null, builtin: true, enabled: true, tone: '面向老板，结论先行',
  },
  {
    id: 'dashboard', name: '看板工程师', avatar: '工',
    duty: '为数据看板增删卡片、调整布局，并把改动汇报给数据分析师',
    scene: 'data', scene_name: '数据（配置）',
    context_scope: ['看板卡片配置', '卡片数据源'],
    tools: ['list_cards', 'add_card', 'remove_card', 'reorder_card', 'preview_card'],
    reports_to: 'data',           // ← 向「数据分析师」汇报
    builtin: true, enabled: true, tone: '工程师口吻，先给方案再动手',
    is_engineer: true,
  },
];

/* ------------------------------------------------------------ 会话（按助手隔离，SQLite） */
const MAX_CONV_PER_ASSISTANT = 30;

const rowConv = (r) => r && ({
  id: r.id, assistant_id: r.assistant_id, title: r.title,
  context: (() => { try { return JSON.parse(r.context || '{}'); } catch { return {}; } })(),
  created_at: r.created_at, updated_at: r.updated_at,
});

const rowMsg = (r) => r && ({
  id: r.id, conversation_id: r.conversation_id, role: r.role, text: r.text,
  at: r.at, ...(() => { try { return JSON.parse(r.extra || '{}'); } catch { return {}; } })(),
});

function newConversation(assistantId, title, context) {
  const id = uid('CV');
  const t = new Date().toISOString();
  db.prepare('INSERT INTO conversations (id,assistant_id,title,context,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, assistantId, title || '新对话', JSON.stringify(context || {}), t, t);
  // 每个助手的会话上限
  const mine = db.prepare('SELECT id FROM conversations WHERE assistant_id=? ORDER BY updated_at DESC').all(assistantId);
  if (mine.length > MAX_CONV_PER_ASSISTANT) {
    mine.slice(MAX_CONV_PER_ASSISTANT).forEach((r) => {
      db.prepare('DELETE FROM messages WHERE conversation_id=?').run(r.id);
      db.prepare('DELETE FROM conversations WHERE id=?').run(r.id);
    });
  }
  return api.conversation(id);
}

function addMessage(convId, role, text, extra = {}) {
  const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(convId);
  if (!c) return null;
  const id = uid('M');
  const at = new Date().toISOString();
  db.prepare('INSERT INTO messages (id,conversation_id,role,text,extra,at) VALUES (?,?,?,?,?,?)')
    .run(id, convId, role, text, JSON.stringify(extra || {}), at);
  const patch = { updated_at: at };
  if (role === 'user' && c.title === '新对话') {
    patch.title = text.slice(0, 18) + (text.length > 18 ? '…' : '');
  }
  db.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?')
    .run(patch.title || c.title, at, convId);
  return rowMsg(db.prepare('SELECT * FROM messages WHERE id=?').get(id));
}

/* ------------------------------------------------------------ 看板卡片（SQLite） */
const CARD_TEMPLATES = [
  { type: 'kpi', title: '指标卡', desc: '单指标大数字卡', source: 'stats' },
  { type: 'funnel', title: '转化漏斗', desc: '各阶段客户数与转化率', source: 'byStage' },
  { type: 'bars', title: '分布条形图', desc: '按行业分布', source: 'byIndustry' },
  { type: 'table', title: '明细表格', desc: '按负责人', source: 'byOwner' },
  { type: 'attention', title: '风险清单', desc: '需立即跟进的客户', source: 'attention' },
  { type: 'text', title: '文字说明卡', desc: '在看板里写一段结论或备注', source: '-' },
];

const rowCard = (r) => r && ({
  id: r.id, type: r.type, title: r.title, metric: r.metric, sub: r.sub,
  source: r.source, size: r.size, order: r.ord, added_by: r.added_by,
  note: r.note, warn: !!r.warn, bar: !!r.bar,
});

/** 改动日志：工程师向页面负责助手「汇报」的记录 */
const changeLog = [];

function logChange(entry) {
  const rec = { id: 'CH' + Date.now() + Math.floor(Math.random() * 100), at: now(), ...entry };
  changeLog.push(rec);
  // 向负责该页面的助手汇报：写入它的会话（系统消息）
  const target = ASSISTANTS.find((a) => a.id === rec.reports_to);
  if (target) {
    let conv = conversations
      .filter((c) => c.assistant_id === target.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (!conv) conv = newConversation(target.id, '看板变更通知', {});
    addMessage(conv.id, 'system',
      `【来自「${rec.from_name}」的变更汇报】${rec.summary}`);
  }
  return rec;
}

const api = {
  /* ---------------- 助手 ---------------- */
  list: () => ASSISTANTS.map((a) => {
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM conversations WHERE assistant_id=?').get(a.id).c;
    const last = db.prepare('SELECT updated_at FROM conversations WHERE assistant_id=? ORDER BY updated_at DESC LIMIT 1').get(a.id);
    return { ...a, conversation_count: cnt, last_active: last ? last.updated_at : null };
  }),
  get: (id) => ASSISTANTS.find((a) => a.id === id) || null,
  byScene: (scene) => ASSISTANTS.filter((a) => a.scene === scene),
  update(id, patch) {
    const a = ASSISTANTS.find((x) => x.id === id);
    if (!a) return null;
    ['name', 'duty', 'tone', 'enabled'].forEach((k) => { if (k in patch) a[k] = patch[k]; });
    if (Array.isArray(patch.context_scope)) a.context_scope = patch.context_scope;
    return a;
  },

  /* ---------------- 会话 ---------------- */
  conversations(assistantId) {
    const rows = assistantId
      ? db.prepare('SELECT * FROM conversations WHERE assistant_id=? ORDER BY updated_at DESC').all(assistantId)
      : db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
    return rows.map((r) => {
      const c = rowConv(r);
      const n = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(r.id).c;
      const last = db.prepare('SELECT text FROM messages WHERE conversation_id=? ORDER BY at DESC LIMIT 1').get(r.id);
      return { ...c, message_count: n, preview: last ? last.text : '' };
    });
  },

  conversation(id) {
    const r = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    if (!r) return null;
    const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY at ASC').all(id).map(rowMsg);
    return { ...rowConv(r), messages: msgs };
  },

  newConversation,
  addMessage,

  clearConversations(assistantId) {
    const rows = assistantId
      ? db.prepare('SELECT id FROM conversations WHERE assistant_id=?').all(assistantId)
      : db.prepare('SELECT id FROM conversations').all();
    rows.forEach((r) => {
      db.prepare('DELETE FROM messages WHERE conversation_id=?').run(r.id);
      db.prepare('DELETE FROM conversations WHERE id=?').run(r.id);
    });
    return rows.length;
  },

  stats() {
    const totalConv = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
    const totalMsg = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
    return {
      assistants: ASSISTANTS.length,
      enabled: ASSISTANTS.filter((a) => a.enabled).length,
      conversations: totalConv,
      messages: totalMsg,
      byAssistant: ASSISTANTS.map((a) => ({
        id: a.id, name: a.name, avatar: a.avatar,
        conversations: db.prepare('SELECT COUNT(*) AS c FROM conversations WHERE assistant_id=?').get(a.id).c,
        messages: db.prepare(`SELECT COUNT(*) AS c FROM messages m
          JOIN conversations cv ON cv.id=m.conversation_id WHERE cv.assistant_id=?`).get(a.id).c,
      })),
    };
  },

  /* ---------------- 看板 ---------------- */
  cards: () => db.prepare('SELECT * FROM cards ORDER BY ord').all().map(rowCard),
  cardTemplates: () => CARD_TEMPLATES,

  addCard(d) {
    const id = 'D' + Date.now().toString(36);
    const maxOrd = db.prepare('SELECT COALESCE(MAX(ord),0) AS m FROM cards').get().m;
    db.prepare(`INSERT INTO cards (id,type,title,metric,sub,source,size,ord,added_by,note,warn,bar)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.type || 'kpi', d.title || '新卡片', d.metric || null, d.sub || null,
      d.source || null, d.size || 'half', maxOrd + 1, d.added_by || 'dashboard',
      d.note || '', d.warn ? 1 : 0, d.bar ? 1 : 0);
    return rowCard(db.prepare('SELECT * FROM cards WHERE id=?').get(id));
  },

  removeCard(id) {
    if (!db.prepare('SELECT id FROM cards WHERE id=?').get(id)) return false;
    db.prepare('DELETE FROM cards WHERE id=?').run(id);
    db.prepare('SELECT id FROM cards ORDER BY ord').all().forEach((r, i) => {
      db.prepare('UPDATE cards SET ord=? WHERE id=?').run(i + 1, r.id);
    });
    return true;
  },

  reorderCard(id, dir) {
    const list = db.prepare('SELECT id FROM cards ORDER BY ord').all();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((r, idx) => db.prepare('UPDATE cards SET ord=? WHERE id=?').run(idx + 1, r.id));
    return true;
  },

  resetCards() {
    db.prepare('DELETE FROM cards').run();
    [
      ['D01', 'kpi', '在管客户', 'total', 'high', null, 'sm', 0, 0],
      ['D02', 'kpi', '本周跟进', 'followWeek', 'followTotal', null, 'sm', 0, 0],
      ['D03', 'kpi', '流失风险', 'risk', null, null, 'sm', 1, 0],
      ['D04', 'kpi', '任务完成', 'taskDone', 'taskTotal', null, 'sm', 0, 1],
      ['D05', 'funnel', '转化漏斗', null, null, null, 'half', 0, 0],
      ['D06', 'bars', '行业分布', null, null, 'byIndustry', 'half', 0, 0],
      ['D07', 'table', '按负责人', null, null, 'byOwner', 'full', 0, 0],
      ['D08', 'attention', '需要立即关注', null, null, 'attention', 'full', 0, 0],
    ].forEach((r, i) => {
      db.prepare(`INSERT INTO cards (id,type,title,metric,sub,source,size,ord,added_by,note,warn,bar)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], i + 1, 'builtin', '', r[7], r[8]);
    });
    return api.cards();
  },

  changes: () => db.prepare('SELECT * FROM changes ORDER BY at DESC LIMIT 50').all()
    .map((r) => ({ id: r.id, from: r.from_who, from_name: r.from_name, reports_to: r.reports_to,
                   action: r.action, summary: r.summary, card_id: r.card_id, at: r.at })),

  logChange(entry) {
    const id = uid('CH');
    const at = new Date().toISOString();
    db.prepare('INSERT INTO changes (id,from_who,from_name,reports_to,action,summary,card_id,at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, entry.from || '', entry.from_name || '', entry.reports_to || '',
           entry.action || '', entry.summary || '', entry.card_id || '', at);
    // 向负责该页面的助手汇报：写入它的会话
    const target = ASSISTANTS.find((a) => a.id === entry.reports_to);
    if (target) {
      let row = db.prepare('SELECT id FROM conversations WHERE assistant_id=? ORDER BY updated_at DESC LIMIT 1').get(target.id);
      let convId = row ? row.id : newConversation(target.id, '看板变更通知', {}).id;
      addMessage(convId, 'system', '【来自「' + entry.from_name + '」的变更汇报】' + entry.summary);
    }
    return { id, at, ...entry };
  },
};

module.exports = api;
