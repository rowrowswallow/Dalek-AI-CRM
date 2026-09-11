/**
 * 账号系统 —— SQLite 存储 + scrypt 密码哈希 + 邀请码注册
 *
 * 设计要点：
 *  · 密码用 Node 内置 crypto.scrypt 加盐哈希，不存明文（依然零依赖）
 *  · 每个用户有自己的 workspace_id，数据互相看不见
 *  · 注册需要邀请码，避免公开仓库被人随手注册
 *  · 会话落库并带过期时间，重启不失效
 */
'use strict';

const crypto = require('crypto');
const { db, J, S, uid, D, Dplus, DEMO_WS } = require('./db.js');

const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ 角色 */
const ROLES = {
  owner: {
    key: 'owner', name: '销售负责人', data_scope: 5,
    desc: '全部功能：客户、知识库、任务、数据、汇报、AI 助手管理',
    nav: ['customer', 'knowledge', 'tag', 'task', 'data', 'report', 'assistant', 'settings'],
  },
  sales: {
    key: 'sales', name: '一线销售', data_scope: 1,
    desc: '客户、知识库、任务；看不到经营数据与汇报',
    nav: ['customer', 'knowledge', 'task', 'settings'],
  },
  boss: {
    key: 'boss', name: '企业老板', data_scope: 5,
    desc: '只读数据与汇报，不直接操作系统',
    nav: ['data', 'report', 'settings'],
    readonly: true,
  },
};

/* ------------------------------------------------------------------ 密码 */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const check = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(check, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

/* ------------------------------------------------------------------ 行映射 */
const rowUser = (r) => r && ({
  id: r.id, username: r.username, name: r.name, avatar: r.avatar,
  role: r.role, title: r.title, dept: r.dept,
  workspace_id: r.workspace_id, created_at: r.created_at,
  last_login_at: r.last_login_at,
});

function publicUser(u) {
  if (!u) return null;
  const r = ROLES[u.role] || ROLES.sales;
  return {
    id: u.id, username: u.username, name: u.name, avatar: u.avatar,
    role: u.role, role_name: r.name, title: u.title, dept: u.dept,
    data_scope: r.data_scope, nav: r.nav, readonly: !!r.readonly,
    workspace_id: u.workspace_id,
  };
}

/* ------------------------------------------------------------------ 初始化演示账号 */
function ensureDemoUser() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (n > 0) return false;
  db.prepare(`INSERT INTO users
    (id,username,password_hash,name,avatar,role,title,dept,workspace_id,invite_code,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    'U01', 'chenli', hashPassword('123456'), '陈立', '陈',
    'owner', '销售负责人', '销售部', DEMO_WS, '', new Date().toISOString());
  return true;
}
ensureDemoUser();

/* ------------------------------------------------------------------ 邀请码 */
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

function createInvite({ created_by, note, max_uses, expires_days } = {}) {
  let code = makeCode();
  while (db.prepare('SELECT code FROM invites WHERE code=?').get(code)) code = makeCode();
  db.prepare(`INSERT INTO invites (code,created_by,note,max_uses,used_count,expires_at,created_at,disabled)
    VALUES (?,?,?,?,?,?,?,0)`).run(
    code, created_by || '', note || '',
    Number(max_uses) > 0 ? Number(max_uses) : 10, 0,
    expires_days ? Dplus(Number(expires_days)) : null,
    new Date().toISOString());
  return db.prepare('SELECT * FROM invites WHERE code=?').get(code);
}

function checkInvite(code) {
  if (!code) return { ok: false, error: '需要邀请码才能注册' };
  const inv = db.prepare('SELECT * FROM invites WHERE code=?').get(String(code).trim().toUpperCase());
  if (!inv) return { ok: false, error: '邀请码不存在' };
  if (inv.disabled) return { ok: false, error: '这个邀请码已被停用' };
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { ok: false, error: '邀请码已过期' };
  if (inv.used_count >= inv.max_uses) return { ok: false, error: '邀请码使用次数已用完' };
  return { ok: true, invite: inv };
}

/* ------------------------------------------------------------------ 为新用户准备演示数据 */
/** 让新注册的朋友一进来就有东西可看，而不是一片空白 */
function seedWorkspace(wsId, name, userId) {
  const CUST = [
    ['星辰科技', '互联网', '陈默', '技术负责人', '13800001101', 'high', 2, ['高意向', '技术负责人', '已报价', '官网咨询']],
    ['华兴医疗', '医疗健康', '刘芳', '采购决策人', '13800001102', 'high', 5, ['高意向', '采购决策人', '商务谈判', '展会获客']],
    ['远航物流', '企业服务', '孙浩', '行业老总', '13800001103', 'mid', 1, ['中意向', '行业老总', '需求确认', '老客转介']],
    ['育才教育', '教育培训', '周敏', '一线使用者', '13800001104', 'high', 11, ['高意向', '一线使用者', '方案沟通', '竞品接触中']],
    ['泰和保险', '金融保险', '吴强', '采购决策人', '13800001105', 'mid', 23, ['中意向', '采购决策人', '方案沟通', '价格敏感']],
    ['恒达制造', '智能制造', '郑涛', '行业老总', '13800001106', 'low', 33, ['低意向', '行业老总', '需求确认', '长期沉默']],
    ['鲜丰连锁', '零售连锁', '冯丽', '采购决策人', '13800001107', 'high', 3, ['高意向', '采购决策人', '已报价', '官网咨询']],
    ['中天设计', '建筑工程', '许诺', '技术负责人', '13800001108', 'mid', 8, ['中意向', '技术负责人', '方案沟通', '广告投放']],
  ];
  const STAGE_OF = (t) => t.includes('商务谈判') ? '商务谈判'
    : t.includes('已报价') ? '已报价'
    : t.includes('方案沟通') ? '方案沟通' : '需求确认';

  const ic = db.prepare(`INSERT INTO customers
    (id,company_name,industry,contact_name,contact_position,contact_phone,owner_id,owner_name,
     level,stage,status,tags,last_follow_at,days_since_follow,contact_count,external_userid,created_at,updated_at,workspace_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  CUST.forEach((r, i) => {
    const [company, industry, contact, position, phone, level, gap, tags] = r;
    ic.run(uid('C'), company, industry, contact, position, phone, userId, name,
      level, STAGE_OF(tags), level === 'high' ? '高意向' : level === 'mid' ? '活跃状态' : '需跟进',
      S(tags), D(gap), gap, 2 + (i % 6), 'wm' + Date.now() + i, D(10 + i), D(i), wsId);
  });

  const itasks = db.prepare(`INSERT INTO tasks
    (id,title,description,due_at,priority,status,owner_id,owner_name,customer_id,customer_name,source,created_at,completed_at,workspace_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  CUST.slice(0, 5).forEach((r, i) => {
    itasks.run(uid('T'), '联系 ' + r[0] + ' 确认下一步', '', Dplus(1 + i), i < 2 ? 'high' : 'mid',
      i === 0 ? 'doing' : 'todo', userId, name, null, r[0], 'manual', D(i), null, wsId);
  });

  // 知识库给一份通用资料，让检索和问答能立刻用起来
  const SEED = require('./seed-kb.js');
  const ik = db.prepare(`INSERT INTO kb_items
    (id,category,title,content,type,file_type,tags,used_count,source,created_at,updated_at,workspace_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  SEED.forEach((k, i) => {
    ik.run(uid('K'), k.category, k.title, k.content, k.type || 'text',
      k.file_type || null, S(k.tags || []), k.used_count || 0, 'seed', D(20 - i * 0.5), D(20 - i * 0.5), wsId);
  });

  const icd = db.prepare(`INSERT INTO cards
    (id,type,title,metric,sub,source,size,ord,added_by,note,warn,bar,workspace_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  [
    ['kpi', '在管客户', 'total', 'high', null, 'sm', 0, 0],
    ['kpi', '本周跟进', 'followWeek', 'followTotal', null, 'sm', 0, 0],
    ['kpi', '流失风险', 'risk', null, null, 'sm', 1, 0],
    ['kpi', '任务完成', 'taskDone', 'taskTotal', null, 'sm', 0, 1],
    ['funnel', '转化漏斗', null, null, null, 'half', 0, 0],
    ['bars', '行业分布', null, null, 'byIndustry', 'half', 0, 0],
    ['table', '按负责人', null, null, 'byOwner', 'full', 0, 0],
    ['attention', '需要立即关注', null, null, 'attention', 'full', 0, 0],
  ].forEach((r, i) => {
    icd.run(uid('D'), r[0], r[1], r[2], r[3], r[4], r[5], i + 1, 'builtin', '', r[6], r[7], wsId);
  });
}

/* ------------------------------------------------------------------ 注册 / 登录 */
function register({ username, password, name, invite_code }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (u.length < 3) return { ok: false, error: '账号至少 3 个字符' };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { ok: false, error: '账号只能包含字母、数字和下划线' };
  if (p.length < 6) return { ok: false, error: '密码至少 6 位' };
  if (db.prepare('SELECT id FROM users WHERE username=?').get(u)) return { ok: false, error: '这个账号已经被注册了' };

  const inv = checkInvite(invite_code);
  if (!inv.ok) return inv;

  const wsId = 'ws-' + crypto.randomBytes(6).toString('hex');
  const displayName = String(name || '').trim() || u;
  const id = uid('U');

  db.prepare(`INSERT INTO users
    (id,username,password_hash,name,avatar,role,title,dept,workspace_id,invite_code,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, u, hashPassword(p), displayName, displayName[0] || '友',
    'owner', '销售负责人', '销售部', wsId, inv.invite.code, new Date().toISOString());

  db.prepare('UPDATE invites SET used_count = used_count + 1 WHERE code=?').run(inv.invite.code);

  seedWorkspace(wsId, displayName, id);

  const token = issueToken(id);
  const row = rowUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  return { ok: true, token, user: publicUser(row), workspace_seeded: true };
}

function issueToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(token, userId, new Date().toISOString(), Dplus(SESSION_DAYS));
  return token;
}

function login(username, password) {
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, error: '账号或密码不正确' };
  }
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), row.id);
  const token = issueToken(row.id);
  return { ok: true, token, user: publicUser(rowUser(row)) };
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

function userByToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (s.expires_at && new Date(s.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  return publicUser(rowUser(row));
}

/* ------------------------------------------------------------------ 权限辅助 */
function scopeFilter(user, field = 'owner_id') {
  if (!user) return () => false;
  if (user.data_scope >= 3) return () => true;
  if (user.data_scope === 1) return (row) => row[field] === user.id;
  return () => true;
}

function can(user, action) {
  if (!user) return false;
  const r = ROLES[user.role];
  if (!r) return false;
  if (r.readonly && ['write', 'delete', 'configure'].includes(action)) return false;
  if (user.role === 'sales' && ['report.view', 'data.view', 'assistant.manage'].includes(action)) return false;
  return true;
}

/* ------------------------------------------------------------------ 对外接口 */
const api = {
  ROLES,
  hashPassword, verifyPassword,
  register, login, logout, userByToken, publicUser, scopeFilter, can,

  demoAccounts() {
    const row = db.prepare("SELECT * FROM users WHERE username='chenli'").get();
    if (!row) return [];
    const pu = publicUser(rowUser(row));
    return [{ username: 'chenli', password: '123456', name: pu.name, role: pu.role,
              role_name: pu.role_name, desc: '内置演示账号，含 24 家客户的完整数据' }];
  },

  /** 供 db.reset 复用：给指定工作区重新灌数据 */
  seedWorkspacePublic: seedWorkspace,

  createInvite,
  listInvites: () => db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all(),

  disableInvite(code) {
    const r = db.prepare('SELECT * FROM invites WHERE code=?').get(code);
    if (!r) return false;
    db.prepare('UPDATE invites SET disabled=? WHERE code=?').run(r.disabled ? 0 : 1, code);
    return true;
  },

  removeInvite(code) {
    if (!db.prepare('SELECT code FROM invites WHERE code=?').get(code)) return false;
    db.prepare('DELETE FROM invites WHERE code=?').run(code);
    return true;
  },

  listUsers: () => db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map((r) => {
    const u = rowUser(r);
    const pu = publicUser(u);
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE workspace_id=?').get(u.workspace_id).c;
    return { ...pu, created_at: u.created_at, last_login_at: u.last_login_at, customer_count: cnt };
  }),

  removeUser(id, operatorId) {
    if (id === operatorId) return { ok: false, error: '不能删除自己' };
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!row) return { ok: false, error: '用户不存在' };
    if (row.username === 'chenli') return { ok: false, error: '内置演示账号不能删除' };
    const ws = row.workspace_id;
    const convIds = db.prepare('SELECT id FROM conversations WHERE workspace_id=?').all(ws).map((c) => c.id);
    convIds.forEach((cid) => db.prepare('DELETE FROM messages WHERE conversation_id=?').run(cid));
    ['customers', 'followups', 'tasks', 'kb_items', 'conversations', 'cards', 'changes']
      .forEach((t) => db.prepare('DELETE FROM ' + t + ' WHERE workspace_id=?').run(ws));
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    return { ok: true };
  },

  stats: () => ({
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    invites: db.prepare('SELECT COUNT(*) AS c FROM invites').get().c,
    active_invites: db.prepare('SELECT COUNT(*) AS c FROM invites WHERE disabled=0 AND used_count < max_uses').get().c,
    sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
  }),
};

module.exports = api;
