/**
 * 账号系统 + 权限
 *
 * 角色设计对齐 PRD 的三类用户：
 *   owner  销售负责人（核心用户）——全部功能
 *   sales  一线销售（重要用户）——客户/知识库/任务，看不到经营数据与汇报
 *   boss   企业老板（次要用户）——只读数据与汇报
 *
 * 数据范围沿用 PRD 的 5 级：1 本人 / 2 含下属 / 3 本部门 / 4 含子部门 / 5 全部
 */
'use strict';

const crypto = require('crypto');

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

const USERS = [
  { id: 'U01', username: 'chenli', password: '123456', name: '陈立',
    role: 'owner', dept: '销售部', title: '销售负责人', avatar: '陈' },
];

/* 会话令牌：内存存储（原型环境） */
const sessions = new Map();

function login(username, password) {
  const u = USERS.find((x) => x.username === username);
  if (!u || u.password !== password) return { ok: false, error: '账号或密码不正确' };
  const token = crypto.randomBytes(18).toString('hex');
  sessions.set(token, { userId: u.id, at: Date.now() });
  return { ok: true, token, user: publicUser(u) };
}

function logout(token) { sessions.delete(token); }

function userByToken(token) {
  const s = sessions.get(token);
  if (!s) return null;
  const u = USERS.find((x) => x.id === s.userId);
  return u ? publicUser(u) : null;
}

function publicUser(u) {
  const r = ROLES[u.role] || ROLES.sales;
  return {
    id: u.id, username: u.username, name: u.name, avatar: u.avatar,
    role: u.role, role_name: r.name, title: u.title, dept: u.dept,
    data_scope: r.data_scope, nav: r.nav, readonly: !!r.readonly,
  };
}

/** 数据范围过滤（原型简化：owner/boss 看全部，sales 只看自己的） */
function scopeFilter(user, field = 'owner_id') {
  if (!user) return () => false;
  if (user.data_scope >= 3) return () => true;
  if (user.data_scope === 1) return (row) => row[field] === user.id;
  return () => true;
}

/** 演示账号清单（当前只保留销售负责人） */
function demoAccounts() {
  return USERS.map((u) => {
    const pu = publicUser(u);
    return { username: u.username, password: u.password, name: pu.name,
             role: pu.role, role_name: pu.role_name, desc: ROLES[pu.role].desc };
  });
}

function can(user, action) {
  if (!user) return false;
  const r = ROLES[user.role];
  if (!r) return false;
  if (r.readonly && ['write', 'delete', 'configure'].includes(action)) return false;
  if (user.role === 'sales' && ['report.view', 'data.view', 'assistant.manage'].includes(action)) return false;
  return true;
}

module.exports = { ROLES, USERS, login, logout, userByToken, publicUser, scopeFilter, can, demoAccounts };
