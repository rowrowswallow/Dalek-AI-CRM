/**
 * 知识库 / 素材库 —— SQLite 驱动
 *
 * 设计取向（来自竞品分析）：
 *  · 悟空「知识库」= 给 AI 检索的资料库（查）
 *  · WeiClaw「素材库」= 给 AI 回复的弹药库（发）
 *  · 我们 = 查 + 发 合体，并新增第三类「汇报资料」（对老板说）
 */
'use strict';

const { db, J, S, uid, D } = require('./db.js');

const CATEGORIES = [
  { key: 'product',  name: '产品文档', icon: '📘', desc: '功能说明、报价体系、实施流程' },
  { key: 'solution', name: '方案资料', icon: '📐', desc: '行业方案、案例集、对比材料' },
  { key: 'script',   name: '话术库',   icon: '💬', desc: '开场、异议处理、促单话术（对客户说）' },
  { key: 'report',   name: '汇报资料', icon: '📊', desc: '汇报模板、老板关心的问题、历史汇报稿（对老板说）', star: true },
  { key: 'meeting',  name: '会议纪要', icon: '📝', desc: '客户会议、内部复盘' },
  { key: 'contract', name: '合同文件', icon: '📄', desc: '合同、报价单、协议模板' },
];

const TYPES = [
  { key: 'text',  name: '文本' }, { key: 'card', name: '卡片' },
  { key: 'image', name: '图片' }, { key: 'video', name: '视频' },
  { key: 'file',  name: '文件' }, { key: 'audio', name: '语音' },
];

const rowKb = (r) => r && ({
  id: r.id, category: r.category, title: r.title, content: r.content,
  type: r.type, file_type: r.file_type, tags: J(r.tags),
  used_count: r.used_count, source: r.source,
  created_at: r.created_at, updated_at: r.updated_at,
});

/* ---------------------------------------------------------------- 检索 */
/** 中文无空格：除按空白切分，还要对 CJK 片段做 2-gram 切分 */
function tokenize(q) {
  const raw = (q || '').toLowerCase().replace(/[，。？！、,.?!；;:：\s]+/g, ' ').trim();
  if (!raw) return [];
  const out = new Set();
  raw.split(' ').filter(Boolean).forEach((seg) => {
    out.add(seg);
    (seg.match(/[\u4e00-\u9fa5]+/g) || []).forEach((run) => {
      if (run.length <= 2) { out.add(run); return; }
      for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
    });
  });
  return [...out].filter((t) => t.length > 0);
}

/** 相关度：标题 > 标签 > 正文；无任何命中直接淘汰 */
function score(item, terms) {
  const title = (item.title || '').toLowerCase();
  const tags = (item.tags || []).join(' ').toLowerCase();
  const body = (item.content || '').toLowerCase();
  const cat = CATEGORIES.find((c) => c.key === item.category);
  const catName = cat ? cat.name.toLowerCase() : '';

  let hit = 0, s = 0;
  terms.forEach((t) => {
    let local = 0;
    if (title.includes(t)) local += 6;
    if (tags.includes(t)) local += 4;
    if (body.includes(t)) local += 2;
    if (catName.includes(t)) local += 5;
    if (local > 0) { hit++; s += local; }
  });
  if (hit === 0) return 0;
  s += hit * 3;
  s += Math.min((item.used_count || 0) / 60, 0.6);
  return s;
}

const api = {
  categories: () => CATEGORIES,
  types: () => TYPES,

  list({ category, type, q, tag } = {}, ws) {
    let l = (ws
      ? db.prepare('SELECT * FROM kb_items WHERE workspace_id=?').all(ws)
      : db.prepare('SELECT * FROM kb_items').all()
    ).map(rowKb);
    if (category && category !== 'all') l = l.filter((x) => x.category === category);
    if (type && type !== 'all') l = l.filter((x) => x.type === type);
    if (tag) l = l.filter((x) => x.tags.includes(tag));
    if (q && String(q).trim()) {
      const terms = tokenize(q);
      l = l.map((x) => ({ x, s: score(x, terms) })).filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s).map((r) => ({ ...r.x, _score: Number(r.s.toFixed(1)) }));
    } else {
      l.sort((a, b) => (b.used_count || 0) - (a.used_count || 0));
    }
    return { list: l, total: l.length };
  },

  get(id) {
    const r = db.prepare('SELECT * FROM kb_items WHERE id = ?').get(id);
    return rowKb(r);
  },

  add(d, ws) {
    const id = uid('K');
    db.prepare(`INSERT INTO kb_items
      (id,category,title,content,type,file_type,tags,used_count,source,created_at,updated_at,workspace_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, d.category || 'product', d.title || '未命名', d.content || '',
      d.type || 'text', d.file_type || null, S(d.tags || []), 0,
      d.source || 'manual', new Date().toISOString(), new Date().toISOString(), ws || '');
    return api.get(id);
  },

  update(id, patch) {
    const r = db.prepare('SELECT * FROM kb_items WHERE id = ?').get(id);
    if (!r) return null;
    const n = { ...rowKb(r), ...patch };
    db.prepare(`UPDATE kb_items SET category=?,title=?,content=?,type=?,file_type=?,tags=?,updated_at=? WHERE id=?`)
      .run(n.category, n.title, n.content, n.type, n.file_type, S(n.tags), new Date().toISOString(), id);
    return api.get(id);
  },

  remove(id) {
    if (!db.prepare('SELECT id FROM kb_items WHERE id = ?').get(id)) return false;
    db.prepare('DELETE FROM kb_items WHERE id = ?').run(id);
    return true;
  },

  removeMany(ids) {
    let n = 0;
    ids.forEach((id) => { if (api.remove(id)) n++; });
    return n;
  },

  /** 使用计数（学 WeiClaw：知道哪条素材真的有用） */
  use(id) {
    const r = db.prepare('SELECT * FROM kb_items WHERE id = ?').get(id);
    if (!r) return null;
    db.prepare('UPDATE kb_items SET used_count = used_count + 1 WHERE id = ?').run(id);
    return api.get(id);
  },

  stats(ws) {
    const all = (ws
      ? db.prepare('SELECT * FROM kb_items WHERE workspace_id=?').all(ws)
      : db.prepare('SELECT * FROM kb_items').all()
    ).map(rowKb);
    return {
      total: all.length,
      totalUsed: all.reduce((a, b) => a + (b.used_count || 0), 0),
      byCat: CATEGORIES.map((c) => ({
        key: c.key, name: c.name, icon: c.icon, star: !!c.star,
        count: all.filter((x) => x.category === c.key).length,
        used: all.filter((x) => x.category === c.key).reduce((a, b) => a + (b.used_count || 0), 0),
      })),
      byType: TYPES.map((t) => ({ ...t, count: all.filter((x) => x.type === t.key).length })),
      topUsed: all.slice().sort((a, b) => (b.used_count || 0) - (a.used_count || 0)).slice(0, 5)
        .map((x) => ({ id: x.id, title: x.title, used_count: x.used_count, category: x.category })),
      neverUsed: all.filter((x) => !x.used_count).length,
    };
  },

  tags(ws) {
    const m = {};
    const rows = ws ? db.prepare('SELECT tags FROM kb_items WHERE workspace_id=?').all(ws)
                    : db.prepare('SELECT tags FROM kb_items').all();
    rows.forEach((r) => {
      J(r.tags).forEach((t) => { m[t] = (m[t] || 0) + 1; });
    });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  },
};

module.exports = api;
