/**
 * 业务数据层 —— SQLite 驱动
 * 对外 API 与之前的数组版保持一致，业务模块无需改动。
 */
'use strict';

const { db, J, S, uid, D, Dplus } = require('./db.js');

const nowMs = Date.now();

/* ------------------------------------------------------------------ 行映射 */
const rowCustomer = (r) => r && ({
  id: r.id, company_name: r.company_name, industry: r.industry,
  contact_name: r.contact_name, contact_position: r.contact_position, contact_phone: r.contact_phone,
  owner_id: r.owner_id, owner_name: r.owner_name,
  level: r.level, stage: r.stage, status: r.status, tags: J(r.tags),
  last_follow_at: r.last_follow_at, days_since_follow: r.days_since_follow,
  contact_count: r.contact_count, external_userid: r.external_userid,
  created_at: r.created_at, updated_at: r.updated_at,
});

const rowFollow = (r) => r && ({
  id: r.id, customer_id: r.customer_id, customer_name: r.customer_name,
  content: r.content, summary: r.summary,
  key_points: J(r.key_points), node_times: J(r.node_times),
  next_action: r.next_action, source: r.source, created_by: r.created_by,
  created_at: r.created_at,
});

const rowTask = (r) => r && ({
  id: r.id, title: r.title, description: r.description, due_at: r.due_at,
  priority: r.priority, status: r.status,
  owner_id: r.owner_id, owner_name: r.owner_name,
  customer_id: r.customer_id, customer_name: r.customer_name,
  source: r.source, created_at: r.created_at, completed_at: r.completed_at,
});

/* ------------------------------------------------------------------ 优先级评分（可解释） */
function scoreCustomer(c, openTasks) {
  const parts = [];
  let score = 0;

  const lv = { high: 40, mid: 22, low: 8 }[c.level] || 0;
  score += lv;
  parts.push(`${c.level === 'high' ? '高意向' : c.level === 'mid' ? '中意向' : '低意向'} +${lv}`);

  const gap = c.days_since_follow || 0;
  const decay = gap <= 3 ? 25 : gap <= 7 ? 18 : gap <= 14 ? 10 : gap <= 30 ? 4 : 0;
  score += decay;
  parts.push(gap <= 3 ? `刚跟进过 +${decay}` : `${gap} 天未跟进 +${decay}`);

  const t = c.tags || [];
  if (t.includes('已报价')) { score += 12; parts.push('已报价 +12'); }
  if (t.includes('商务谈判')) { score += 15; parts.push('商务谈判中 +15'); }
  if (t.includes('竞品接触中')) { score += 14; parts.push('竞品接触中 +14'); }
  if (t.includes('价格敏感')) { score -= 6; parts.push('价格敏感 −6'); }
  if (t.includes('长期沉默')) { score -= 18; parts.push('长期沉默 −18'); }
  if (c.level === 'low' && gap >= 30) { score -= 10; parts.push('低意向且长期未跟进 −10'); }

  if (openTasks) {
    const add = Math.min(openTasks * 3, 9);
    score += add;
    parts.push(`有 ${openTasks} 个未完成任务 +${add}`);
  }

  return { score: Math.max(0, Math.min(100, score)), reason: parts.join('，') };
}

function withScore(c, openTasks) {
  const { score, reason } = scoreCustomer(c, openTasks);
  const risk = (c.days_since_follow || 0) >= 21 && c.level !== 'low';
  return {
    ...c,
    priority_score: score,
    priority_reason: reason,
    ai_status: c.level === 'high' ? '高意向' : c.level === 'mid' ? '活跃' : '需唤醒',
    ai_insight: risk
      ? `已 ${c.days_since_follow} 天无互动，此前处于${c.stage}阶段，存在流失风险`
      : `正在${c.stage}阶段推进，最近一次互动在 ${c.days_since_follow} 天前`,
    ai_next_step: risk
      ? `建议今天主动触达：以「${c.stage}进展确认」为由重新建立联系`
      : (c.tags || []).includes('已报价')
        ? '建议跟进报价反馈，准备好应对价格异议的对比材料'
        : '建议推进到下一阶段，明确对方的决策流程与时间表',
    ai_updated_at: new Date().toISOString(),
  };
}

/** 一次查出所有客户的未完成任务数，避免 N+1 */
function openTaskMap() {
  const rows = db.prepare(
    "SELECT customer_id, COUNT(*) AS c FROM tasks WHERE status != 'done' AND customer_id IS NOT NULL GROUP BY customer_id"
  ).all();
  const m = {};
  rows.forEach((r) => { m[r.customer_id] = r.c; });
  return m;
}

/* ------------------------------------------------------------------ API */
const api = {
  customers(filter, ws) {
    let rows = (ws
      ? db.prepare('SELECT * FROM customers WHERE workspace_id=? ORDER BY created_at DESC').all(ws)
      : db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all()
    ).map(rowCustomer);
    if (filter) return rows.filter(filter);
    const om = openTaskMap();
    return rows.map((c) => withScore(c, om[c.id] || 0))
      .sort((a, b) => b.priority_score - a.priority_score);
  },

  customer(id) {
    const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!r) return null;
    return withScore(rowCustomer(r), openTaskMap()[id] || 0);
  },

  /** 取客户并校验工作区归属，跨区拿不到 */
  customerIn(id, ws) {
    const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!r) return null;
    if (ws && r.workspace_id !== ws) return null;
    return withScore(rowCustomer(r), openTaskMap()[id] || 0);
  },

  customerByExternal(eid) {
    const r = db.prepare('SELECT * FROM customers WHERE external_userid = ?').get(eid);
    if (!r) return null;
    return withScore(rowCustomer(r), openTaskMap()[r.id] || 0);
  },

  addCustomer(d, ws) {
    const id = uid('C');
    const list = d.tags || [];
    db.prepare(`INSERT INTO customers
      (id,company_name,industry,contact_name,contact_position,contact_phone,owner_id,owner_name,
       level,stage,status,tags,last_follow_at,days_since_follow,contact_count,external_userid,created_at,updated_at,workspace_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.company_name || '未命名客户', d.industry || '其他',
      d.contact_name || '', d.contact_position || '', d.contact_phone || '',
      d.owner_id || 'U01', d.owner_name || '陈立',
      d.level || 'mid', d.stage || '需求确认',
      d.level === 'high' ? '高意向' : d.level === 'low' ? '需跟进' : '活跃状态',
      S(list), new Date().toISOString(), 0, 1, 'wm' + Date.now(),
      new Date().toISOString(), new Date().toISOString(), ws || '');
    return api.customer(id);
  },

  updateCustomer(id, patch) {
    const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!r) return null;
    const n = { ...rowCustomer(r), ...patch };
    db.prepare(`UPDATE customers SET
      company_name=?, industry=?, contact_name=?, contact_position=?, contact_phone=?,
      owner_id=?, owner_name=?, level=?, stage=?, status=?, tags=?,
      last_follow_at=?, days_since_follow=?, contact_count=?, updated_at=?
      WHERE id=?`).run(
      n.company_name, n.industry, n.contact_name, n.contact_position, n.contact_phone,
      n.owner_id, n.owner_name, n.level, n.stage, n.status, S(n.tags),
      n.last_follow_at, n.days_since_follow, n.contact_count,
      new Date().toISOString(), id);
    return api.customer(id);
  },

  deleteCustomer(id) {
    if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) return false;
    db.prepare('DELETE FROM followups WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return true;
  },

  followups(filter, ws) {
    let rows;
    if (filter && filter.customer_id) {
      rows = db.prepare('SELECT * FROM followups WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(filter.customer_id);
    } else if (ws) {
      rows = db.prepare('SELECT * FROM followups WHERE workspace_id=? ORDER BY created_at DESC LIMIT 200').all(ws);
    } else {
      rows = db.prepare('SELECT * FROM followups ORDER BY created_at DESC LIMIT 200').all();
    }
    return rows.map(rowFollow);
  },

  addFollowup(d, ws) {
    const c = db.prepare('SELECT company_name FROM customers WHERE id = ?').get(d.customer_id);
    const id = uid('F');
    db.prepare(`INSERT INTO followups
      (id,customer_id,customer_name,content,summary,key_points,node_times,next_action,source,created_by,created_at,workspace_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.customer_id, c ? c.company_name : '',
      d.content || '', d.summary || ((d.content || '').slice(0, 34) + '…'),
      S(d.key_points || []), S(d.node_times || []), d.next_action || '',
      d.source || 'manual', d.created_by || '我', new Date().toISOString(), ws || '');
    if (c) {
      db.prepare('UPDATE customers SET last_follow_at=?, days_since_follow=0, contact_count=contact_count+1 WHERE id=?')
        .run(new Date().toISOString(), d.customer_id);
    }
    return rowFollow(db.prepare('SELECT * FROM followups WHERE id = ?').get(id));
  },

  tasks(filter, ws) {
    let rows = (ws
      ? db.prepare('SELECT * FROM tasks WHERE workspace_id=? ORDER BY created_at DESC').all(ws)
      : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
    ).map(rowTask);
    if (filter && filter.customer_id) rows = rows.filter((t) => t.customer_id === filter.customer_id);
    return rows;
  },

  taskCounts(ws) {
    const SQL = `SELECT COUNT(*) AS a,
      SUM(CASE WHEN status='todo' THEN 1 ELSE 0 END) AS t,
      SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) AS d,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS dn FROM tasks`;
    const r = ws ? db.prepare(SQL + ' WHERE workspace_id=?').get(ws) : db.prepare(SQL).get();
    return { all: r.a || 0, todo: r.t || 0, doing: r.d || 0, done: r.dn || 0 };
  },

  addTask(d, ws) {
    const id = uid('T');
    db.prepare(`INSERT INTO tasks
      (id,title,description,due_at,priority,status,owner_id,owner_name,customer_id,customer_name,source,created_at,completed_at,workspace_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.title || '新任务', d.description || '', d.due_at || Dplus(3),
      d.priority || 'mid', d.status || 'todo',
      d.owner_id || 'U01', d.owner_name || '陈立',
      d.customer_id || null, d.customer_name || '', d.source || 'manual',
      new Date().toISOString(), null, ws || '');
    return rowTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  },

  updateTask(id, patch) {
    const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!r) return null;
    const cur = rowTask(r);
    const n = { ...cur, ...patch };
    db.prepare(`UPDATE tasks SET title=?,description=?,due_at=?,priority=?,status=?,
      owner_id=?,owner_name=?,customer_id=?,customer_name=?,source=?,completed_at=? WHERE id=?`).run(
      n.title, n.description, n.due_at, n.priority, n.status,
      n.owner_id, n.owner_name, n.customer_id, n.customer_name, n.source,
      n.status === 'done' ? (cur.completed_at || new Date().toISOString()) : null, id);
    return rowTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  },

  deleteTask(id) {
    if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) return false;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return true;
  },

  tagGroups() {
    return db.prepare('SELECT * FROM tag_groups ORDER BY sort').all()
      .map((g) => ({ group: g.name, color: g.color, tags: J(g.tags) }));
  },

  topPriority(n = 5, ws) { return api.customers(null, ws).slice(0, n); },

  stats(ws) {
    const all = api.customers(null, ws);
    const tc = api.taskCounts(ws);
    const weekAgo = new Date(nowMs - 7 * 864e5).toISOString();
    const followWeek = ws
      ? db.prepare('SELECT COUNT(*) AS c FROM followups WHERE created_at >= ? AND workspace_id=?').get(weekAgo, ws).c
      : db.prepare('SELECT COUNT(*) AS c FROM followups WHERE created_at >= ?').get(weekAgo).c;
    const followTotal = ws
      ? db.prepare('SELECT COUNT(*) AS c FROM followups WHERE workspace_id=?').get(ws).c
      : db.prepare('SELECT COUNT(*) AS c FROM followups').get().c;

    const byIndustry = {}, byStage = {}, byOwner = {};
    all.forEach((c) => {
      byIndustry[c.industry] = (byIndustry[c.industry] || 0) + 1;
      byStage[c.stage] = (byStage[c.stage] || 0) + 1;
      const o = byOwner[c.owner_name] = byOwner[c.owner_name] || { total: 0, high: 0, risk: 0, follow: 0 };
      o.total++;
      if (c.level === 'high') o.high++;
      if (c.days_since_follow >= 21) o.risk++;
    });
    const ownerSql = 'SELECT created_by, COUNT(*) AS c FROM followups WHERE created_at >= ?'
      + (ws ? ' AND workspace_id=?' : '') + ' GROUP BY created_by';
    (ws ? db.prepare(ownerSql).all(weekAgo, ws) : db.prepare(ownerSql).all(weekAgo))
      .forEach((r) => { if (byOwner[r.created_by]) byOwner[r.created_by].follow = r.c; });

    return {
      total: all.length,
      high: all.filter((c) => c.level === 'high').length,
      risk: all.filter((c) => c.days_since_follow >= 21).length,
      taskDone: tc.done, taskTotal: tc.all,
      followWeek, followTotal,
      byIndustry: Object.entries(byIndustry).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byStage: Object.entries(byStage).map(([name, value]) => ({ name, value })),
      byOwner: Object.entries(byOwner).map(([name, v]) => ({ name, ...v })),
      attention: all.filter((c) => c.days_since_follow >= 21 && c.level !== 'low').slice(0, 5),
    };
  },

  buildReport(range, ws) {
    const s = api.stats(ws);
    const label = range === 'month' ? '本月' : '本周';
    const drop = s.byStage.find((x) => x.name === '需求确认');
    return {
      range, label,
      generated_at: new Date().toISOString(),
      title: label + '销售工作汇报',
      sections: [
        { heading: '一、整体情况',
          body: label + '新增跟进 ' + s.followWeek + ' 条，累计跟进 ' + s.followTotal + ' 条；'
              + '当前在管客户 ' + s.total + ' 家，其中高意向 ' + s.high + ' 家；'
              + '任务完成 ' + s.taskDone + '/' + s.taskTotal + ' 项。' },
        { heading: '二、需要关注的问题',
          body: '有 ' + s.risk + ' 家客户超过 21 天未跟进，其中高意向客户 '
              + s.attention.filter((c) => c.level === 'high').length + ' 家，存在流失风险。'
              + '集中在「' + (drop ? drop.name : '需求确认') + '」阶段的客户最多（' + (drop ? drop.value : 0) + ' 家），'
              + '说明线索进入后的首次推进存在瓶颈。\n'
              + '跟进量分布：' + s.byOwner.map((o) => o.name + ' ' + o.follow + ' 条').join('、') + '。' },
        { heading: '三、下周建议',
          body: s.attention.slice(0, 3).map((c, i) =>
            (i + 1) + '. ' + c.company_name + '（' + c.industry + '）——' + c.priority_reason.slice(0, 40) + '… 建议：' + c.ai_next_step).join('\n')
              + '\n\n整体建议：把「需求确认」阶段的 ' + (drop ? drop.value : 0) + ' 家客户做一次集中梳理，'
              + '明确各自的决策流程与时间表，避免长期停留在需求确认阶段。' },
      ],
    };
  },

  recordFeedback(d) {
    db.prepare('INSERT INTO ai_feedback (id,type,action,at) VALUES (?,?,?,?)')
      .run(uid('FB'), d.type || '', d.action || '', new Date().toISOString());
  },
  feedback: () => db.prepare('SELECT * FROM ai_feedback ORDER BY at DESC LIMIT 100').all(),
};

module.exports = api;
