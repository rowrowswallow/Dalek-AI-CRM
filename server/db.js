/**
 * 数据层 —— SQLite（node:sqlite 内置，零依赖）
 *
 * 特点：
 *  · 单文件数据库 data/aicrm.db，重启不丢
 *  · 首次启动自动建表 + 灌入演示数据
 *  · 所有实体统一在此定义，业务模块只调 query 方法
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'aicrm.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ------------------------------------------------------------------ 建表 */
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  contact_position TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  owner_id TEXT DEFAULT 'U01',
  owner_name TEXT DEFAULT '陈立',
  level TEXT DEFAULT 'mid',
  stage TEXT DEFAULT '需求确认',
  status TEXT DEFAULT '活跃状态',
  tags TEXT DEFAULT '[]',
  last_follow_at TEXT,
  days_since_follow INTEGER DEFAULT 0,
  contact_count INTEGER DEFAULT 0,
  external_userid TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT DEFAULT '',
  content TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  key_points TEXT DEFAULT '[]',
  node_times TEXT DEFAULT '[]',
  next_action TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  created_by TEXT DEFAULT '我',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_at TEXT,
  priority TEXT DEFAULT 'mid',
  status TEXT DEFAULT 'todo',
  owner_id TEXT DEFAULT 'U01',
  owner_name TEXT DEFAULT '陈立',
  customer_id TEXT,
  customer_name TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  created_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS tag_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  color TEXT,
  tags TEXT DEFAULT '[]',
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kb_items (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'product',
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'text',
  file_type TEXT,
  tags TEXT DEFAULT '[]',
  used_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  assistant_id TEXT,
  title TEXT DEFAULT '新对话',
  context TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT,
  text TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  at TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'kpi',
  title TEXT,
  metric TEXT,
  sub TEXT,
  source TEXT,
  size TEXT DEFAULT 'half',
  ord INTEGER DEFAULT 0,
  added_by TEXT DEFAULT 'builtin',
  note TEXT DEFAULT '',
  warn INTEGER DEFAULT 0,
  bar INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  from_who TEXT,
  from_name TEXT,
  reports_to TEXT,
  action TEXT,
  summary TEXT,
  card_id TEXT,
  at TEXT
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY,
  type TEXT,
  action TEXT,
  at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fu_customer ON followups(customer_id);
CREATE INDEX IF NOT EXISTS idx_task_customer ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_kb_cat ON kb_items(category);
`);

/* ------------------------------------------------------------------ 工具 */
const J = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const S = (v) => JSON.stringify(v || []);

/* ------------------------------------------------------------------ 演示数据 */
const now = Date.now();
const D = (days) => new Date(now - days * 864e5).toISOString();
const Dplus = (days) => new Date(now + days * 864e5).toISOString();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const SEED_CUSTOMERS = [
  ['云启数据科技', '互联网', '周明远', '技术负责人', '13800001001', '陈立', 'high', 3, ['高意向', '技术负责人', '方案沟通', '官网咨询']],
  ['恒信医疗集团', '医疗健康', '李静', '采购决策人', '13800001002', '陈立', 'high', 6, ['高意向', '采购决策人', '商务谈判', '展会获客']],
  ['远洋物流', '企业服务', '王海涛', '行业老总', '13800001003', '赵敏', 'mid', 0, ['中意向', '行业老总', '需求确认', '老客转介']],
  ['佳和教育', '教育培训', '孙丽', '一线使用者', '13800001004', '赵敏', 'high', 12, ['高意向', '一线使用者', '已报价', '竞品接触中']],
  ['金诚保险', '金融保险', '吴国强', '采购决策人', '13800001005', '陈立', 'mid', 21, ['中意向', '采购决策人', '方案沟通', '价格敏感']],
  ['万隆制造', '智能制造', '郑建国', '行业老总', '13800001006', '王涛', 'low', 34, ['低意向', '行业老总', '需求确认', '长期沉默']],
  ['品鲜生连锁', '零售连锁', '冯雪', '采购决策人', '13800001007', '赵敏', 'high', 2, ['高意向', '采购决策人', '已报价', '官网咨询']],
  ['天工建筑设计', '建筑工程', '许超', '技术负责人', '13800001008', '王涛', 'mid', 9, ['中意向', '技术负责人', '方案沟通', '展会获客']],
  ['蓝湖软件', '企业服务', '何雨欣', '技术负责人', '13800001009', '陈立', 'high', 1, ['高意向', '技术负责人', '商务谈判', '老客转介']],
  ['华康药业', '医疗健康', '马建国', '采购决策人', '13800001010', '王涛', 'mid', 15, ['中意向', '采购决策人', '需求确认', '广告投放']],
  ['星野文旅', '生活服务', '林小雅', '行业老总', '13800001011', '赵敏', 'low', 41, ['低意向', '行业老总', '需求确认', '长期沉默', '预算未批']],
  ['中科智测', '企业服务', '邓峰', '技术负责人', '13800001012', '陈立', 'mid', 5, ['中意向', '技术负责人', '方案沟通', '官网咨询']],
  ['悦活健身', '生活服务', '苏婷', '行业老总', '13800001013', '王涛', 'low', 27, ['低意向', '行业老总', '需求确认', '价格敏感']],
  ['广联通信', '互联网', '蒋文博', '采购决策人', '13800001014', '赵敏', 'high', 4, ['高意向', '采购决策人', '商务谈判', '展会获客']],
  ['青竹环保', '智能制造', '范琳', '技术负责人', '13800001015', '陈立', 'mid', 11, ['中意向', '技术负责人', '方案沟通', '老客转介']],
  ['尚品家居', '零售连锁', '蔡明轩', '行业老总', '13800001016', '王涛', 'low', 52, ['低意向', '行业老总', '长期沉默', '官网咨询']],
  ['速达供应链', '企业服务', '袁浩', '采购决策人', '13800001017', '赵敏', 'high', 7, ['高意向', '采购决策人', '已报价', '竞品接触中']],
  ['明德律所', '企业服务', '崔文', '行业老总', '13800001018', '陈立', 'mid', 18, ['中意向', '行业老总', '需求确认', '老客转介']],
  ['博采传媒', '文化传媒', '殷子涵', '一线使用者', '13800001019', '王涛', 'low', 31, ['低意向', '一线使用者', '需求确认', '广告投放']],
  ['联信地产', '建筑工程', '罗志刚', '采购决策人', '13800001020', '赵敏', 'high', 8, ['高意向', '采购决策人', '方案沟通', '展会获客']],
  ['优行出行', '互联网', '唐悦', '技术负责人', '13800001021', '陈立', 'mid', 14, ['中意向', '技术负责人', '需求确认', '官网咨询']],
  ['金沙餐饮', '零售连锁', '谭伟', '行业老总', '13800001022', '王涛', 'low', 46, ['低意向', '行业老总', '长期沉默', '价格敏感']],
  ['智联人力', '企业服务', '贺兰', '采购决策人', '13800001023', '赵敏', 'high', 2, ['高意向', '采购决策人', '商务谈判', '老客转介']],
  ['鹏程新能源', '智能制造', '傅强', '技术负责人', '13800001024', '陈立', 'mid', 20, ['中意向', '技术负责人', '方案沟通', '广告投放']],
];

const SEED_TAGS = [
  ['意向度', '#C05621', ['高意向', '中意向', '低意向', '已报价', '已成交']],
  ['客群类型', '#2F6F4E', ['行业老总', '技术负责人', '采购决策人', '一线使用者']],
  ['业务阶段', '#3B6EA5', ['需求确认', '方案沟通', '商务谈判', '合同签署']],
  ['风险', '#B33A2B', ['价格敏感', '竞品接触中', '长期沉默', '预算未批']],
  ['来源', '#7A6A9B', ['官网咨询', '老客转介', '展会获客', '广告投放']],
];

const STAGE_OF = (tags) =>
  tags.includes('已成交') ? '已成交'
  : tags.includes('商务谈判') ? '商务谈判'
  : tags.includes('已报价') ? '已报价'
  : tags.includes('方案沟通') ? '方案沟通' : '需求确认';

const SEED_KB = require('./seed-kb.js');

function seed() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  if (n > 0) return false;

  const ic = db.prepare(`INSERT INTO customers
    (id,company_name,industry,contact_name,contact_position,contact_phone,owner_id,owner_name,
     level,stage,status,tags,last_follow_at,days_since_follow,contact_count,external_userid,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  SEED_CUSTOMERS.forEach((r, i) => {
    const [company, industry, contact, position, phone, owner, level, gap, tags] = r;
    const id = 'C' + String(1001 + i);
    ic.run(id, company, industry, contact, position, phone,
      'U' + (owner === '陈立' ? '01' : owner === '赵敏' ? '02' : '03'), owner,
      level, STAGE_OF(tags), level === 'high' ? '高意向' : level === 'mid' ? '活跃状态' : '需跟进',
      S(tags), D(gap), gap, 3 + (i % 9), 'wm' + (1000000000 + i * 7919), D(30 + gap), D(Math.max(0, gap - 1)));
  });

  const it = db.prepare('INSERT INTO tag_groups (name,color,tags,sort) VALUES (?,?,?,?)');
  SEED_TAGS.forEach((g, i) => it.run(g[0], g[1], S(g[2]), i));

  // 跟进记录
  const PAINS = ['客户数据分散', '跟进记录靠记忆', '销售报表手工汇总', '客户分层不清晰', '线索转化率低', '团队协作信息不同步'];
  const POINTS = ['数据迁移成本', '实施周期', '后续服务响应', '与现有系统的对接', '按人数计费的方式'];
  const TPL = [
    '与{contact}沟通了{pain}的问题，对方表示目前用 Excel 手工统计，效率很低。约定下周提供方案对比。',
    '电话回访，对方提到预算需要上级审批，预计月底有结果。',
    '客户主动咨询了报价细节，对{point}比较关注，已发送报价单。',
    '拜访客户现场，{contact}带我们看了实际使用场景。核心痛点是{point}。',
    '微信沟通，客户反馈竞品也在接触，主要是价格因素。',
    '发送了行业案例集，客户表示会内部讨论。',
    '客户提出希望增加定制化功能，已同步产品团队评估。',
    '跟进合同流程，对方财务已审批，等待法务确认。',
  ];
  const ifu = db.prepare(`INSERT INTO followups
    (id,customer_id,customer_name,content,summary,key_points,node_times,next_action,source,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  SEED_CUSTOMERS.forEach((r, ci) => {
    const [company, , contact, , , owner, , gap] = r;
    const id = 'C' + String(1001 + ci);
    const cnt = 2 + (ci % 4);
    for (let k = 0; k < cnt; k++) {
      const content = TPL[(ci + k) % TPL.length]
        .replace(/\{contact\}/g, contact)
        .replace(/\{pain\}/g, PAINS[(ci + k) % PAINS.length])
        .replace(/\{point\}/g, POINTS[(ci + k) % POINTS.length]);
      const days = Math.max(0, gap - k * 5);
      ifu.run(uid('F'), id, company, content, content.slice(0, 34) + '…', '[]', '[]',
        k === 0 ? '按约定提供方案对比材料' : '', k === 1 ? 'ai' : 'manual', owner, D(days));
    }
  });

  // 任务
  const TT = [
    ['为{company}准备方案对比材料', 'high', 2], ['回访{company}确认预算审批进度', 'high', 1],
    ['向{company}发送报价单并电话确认', 'mid', 3], ['整理{company}的需求清单同步产品团队', 'mid', 5],
    ['预约{company}现场演示', 'high', 6], ['跟进{company}法务审核进度', 'high', 2],
    ['发送{company}行业案例集', 'low', 8],
  ];
  const itk = db.prepare(`INSERT INTO tasks
    (id,title,description,due_at,priority,status,owner_id,owner_name,customer_id,customer_name,source,created_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  SEED_CUSTOMERS.slice(0, 16).forEach((r, i) => {
    const [company, , , , , owner] = r;
    const t = TT[i % TT.length];
    const id = 'C' + String(1001 + i);
    itk.run(uid('T'), t[0].replace('{company}', company), '', Dplus(t[2]), t[1],
      i % 5 === 0 ? 'done' : i % 4 === 0 ? 'doing' : 'todo',
      'U' + (owner === '陈立' ? '01' : owner === '赵敏' ? '02' : '03'), owner, id, company,
      i % 3 === 0 ? 'ai' : i % 3 === 1 ? 'followup' : 'manual', D(2 + (i % 7)),
      i % 5 === 0 ? D(1) : null);
  });

  // 知识库
  const ik = db.prepare(`INSERT INTO kb_items
    (id,category,title,content,type,file_type,tags,used_count,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  SEED_KB.forEach((k, i) => {
    ik.run('K' + (2001 + i), k.category, k.title, k.content, k.type || 'text',
      k.file_type || null, S(k.tags || []), k.used_count || 0, 'seed', D(40 - i), D(40 - i));
  });

  // 看板卡片
  const icd = db.prepare(`INSERT INTO cards
    (id,type,title,metric,sub,source,size,ord,added_by,note,warn,bar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  [
    ['D01', 'kpi', '在管客户', 'total', 'high', null, 'sm', 1, 0, 0],
    ['D02', 'kpi', '本周跟进', 'followWeek', 'followTotal', null, 'sm', 2, 0, 0],
    ['D03', 'kpi', '流失风险', 'risk', null, null, 'sm', 3, 1, 0],
    ['D04', 'kpi', '任务完成', 'taskDone', 'taskTotal', null, 'sm', 4, 0, 1],
    ['D05', 'funnel', '转化漏斗', null, null, null, 'half', 5, 0, 0],
    ['D06', 'bars', '行业分布', null, null, 'byIndustry', 'half', 6, 0, 0],
    ['D07', 'table', '按负责人', null, null, 'byOwner', 'full', 7, 0, 0],
    ['D08', 'attention', '需要立即关注', null, null, 'attention', 'full', 8, 0, 0],
  ].forEach((r) => icd.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], 'builtin', '', r[8], r[9]));

  return true;
}

const seeded = seed();

module.exports = {
  db, J, S, uid, D, Dplus, seeded, DB_FILE,
  reset() {
    ['messages', 'conversations', 'changes', 'cards', 'kb_items', 'tasks', 'followups', 'tag_groups', 'customers']
      .forEach((t) => db.exec('DELETE FROM ' + t));
    seed();
  },
};
