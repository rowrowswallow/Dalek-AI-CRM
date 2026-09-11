/**
 * 智能录入引擎
 *
 * 三种输入源统一转成结构化字段：
 *   ① 语音 → 浏览器端先转文字，再走本模块的文本解析
 *   ② 图片 → 交给支持视觉的模型做 OCR，再走文本解析
 *   ③ 附件/粘贴 → CSV 批量解析，或自由文本解析
 *
 * 设计原则：**没有配模型也要能用** —— 文本解析全部是规则实现，
 * 模型只在「图片 OCR」和「复杂语义」两处加分。
 */
'use strict';

/* ------------------------------------------------------------------ 通用提取 */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function pickPhone(t) {
  const m = t.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/) || t.match(/\d{3,4}[-\s]?\d{7,8}/);
  return m ? m[0].replace(/[-\s]/g, '') : '';
}

function pickEmail(t) {
  const m = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return m ? m[0] : '';
}

/** 公司名：常见后缀直接匹配；否则取「XX公司/XX集团」样式的片段 */
function pickCompany(t) {
  const suf = '(?:有限公司|股份有限公司|集团|科技|网络|信息|数据|软件|医疗|教育|物流|制造|实业|商贸|连锁|银行|保险|地产|建筑|传媒|文化|能源|环保|生物|药业|食品|餐饮|酒店|旅游|咨询|事务所|研究院|中心|工厂|门店)';
  const m = t.match(new RegExp('([\\u4e00-\\u9fa5A-Za-z0-9]{2,18}' + suf + ')'));
  if (m) return m[1];
  // 「叫/名叫/客户是/公司是 XXX」
  const m2 = t.match(/(?:叫|名叫|客户(?:是|叫)?|公司(?:是|叫)?|名称[:：]?)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,20})/);
  return m2 ? m2[1].replace(/[，,。.、]$/, '') : '';
}

/** 人名：2-4 个汉字，常见姓氏开头 */
function pickName(t) {
  const m = t.match(/(?:联系人|对接人|负责人|客户|张总|李总|王总|刘总|陈总)\s*[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
  if (m && m[1].length <= 4) return m[1];
  const m2 = t.match(/([\u4e00-\u9fa5]{2,4})(?:先生|女士|总|经理|总监|主任)/);
  return m2 ? m2[1] : '';
}

function pickIndustry(t) {
  const MAP = [
    ['互联网', /互联网|软件|SaaS|平台|APP|小程序|电商|在线/],
    ['企业服务', /企业服务|咨询|人力|法务|财税|外包|SaaS/],
    ['医疗健康', /医疗|医院|健康|药业|生物|医药|器械/],
    ['教育培训', /教育|培训|学校|学院|课程|教培/],
    ['智能制造', /制造|工厂|智能|自动化|设备|机械|能源|新能源/],
    ['零售连锁', /零售|连锁|商超|超市|门店|餐饮|便利|家居/],
    ['金融保险', /金融|保险|银行|证券|基金|投资|理财/],
    ['建筑工程', /建筑|工程|设计|地产|房产|装修|施工/],
    ['生活服务', /生活服务|健身|文旅|酒店|旅游|美容|家政/],
    ['文化传媒', /传媒|文化|广告|影视|内容|视频/],
  ];
  for (const [name, re] of MAP) if (re.test(t)) return name;
  return '';
}

function pickDate(t) {
  const now = new Date();
  const d = (n) => new Date(now.getTime() + n * 864e5);
  if (/今天|今日/.test(t)) return d(0);
  if (/明天|明日/.test(t)) return d(1);
  if (/后天/.test(t)) return d(2);
  const week = t.match(/(下?)([一二三四五六日天])/);
  if (week && /周|星期|礼拜/.test(t)) {
    const target = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[week[2]];
    let diff = (target - (now.getDay() || 7) + 7) % 7;
    if (week[1] === '下' || diff === 0) diff += 7;
    return d(diff);
  }
  const md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (md) {
    const y = now.getFullYear();
    const dt = new Date(y, +md[1] - 1, +md[2]);
    if (dt < now) dt.setFullYear(y + 1);
    return dt;
  }
  const nd = t.match(/(\d{1,3})\s*(?:天后|天以后|个?工作日后)/);
  if (nd) return d(+nd[1]);
  const nd2 = t.match(/(\d{1,2})\s*天后/);
  if (nd2) return d(+nd2[1]);
  return null;
}

/* ------------------------------------------------------------------ 各实体解析 */
function parseCustomer(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const out = {
    company_name: pickCompany(t),
    contact_name: pickName(t),
    contact_phone: pickPhone(t),
    industry: pickIndustry(t),
    level: /高意向|很有意向|重点|热|着急|尽快|马上/.test(t) ? 'high'
      : /低意向|没兴趣|不考虑|算了/.test(t) ? 'low' : 'mid',
    tags: [],
    _confidence: 0,
    _source: 'rule',
  };
  if (/采购|老板|总|负责|决策/.test(t)) out.contact_position = '采购决策人';
  else if (/技术|IT|开发|运维/.test(t)) out.contact_position = '技术负责人';
  if (/价格|报价|预算|贵|便宜/.test(t)) out.tags.push('价格敏感');
  if (/竞品|对比|其他家/.test(t)) out.tags.push('竞品接触中');
  if (/朋友介绍|转介绍|老客户介绍/.test(t)) out.tags.push('老客转介');
  if (/展会/.test(t)) out.tags.push('展会获客');
  if (/官网|网站|咨询/.test(t)) out.tags.push('官网咨询');
  if (/广告|投放/.test(t)) out.tags.push('广告投放');

  const email = pickEmail(t);
  if (email) out.email = email;

  const filled = ['company_name', 'contact_name', 'contact_phone', 'industry'].filter((k) => out[k]).length;
  out._confidence = Math.min(0.95, 0.35 + filled * 0.16);
  return out;
}

function parseTask(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const dt = pickDate(t);
  const out = {
    title: t.replace(/^(帮我|给我|请|麻烦)?\s*(建|创建|加|新增|安排)(一?个|一?条)?(任务|待办|提醒)?[:：]?/, '').trim().slice(0, 60) || '新任务',
    due_at: dt ? dt.toISOString() : null,
    priority: /紧急|重要|优先|尽快|马上|今天/.test(t) ? 'high'
      : /不急|有空|稍后|下周/.test(t) ? 'low' : 'mid',
    source: 'ai',
    _confidence: dt ? 0.85 : 0.6,
  };
  const who = t.match(/@([\u4e00-\u9fa5]{2,4})|让([\u4e00-\u9fa5]{2,4})(?:去|来|负责)/);
  if (who) out.owner_name = who[1] || who[2];
  out.description = t.length > 60 ? t : '';
  return out;
}

function parseKnowledge(text) {
  const t = String(text || '').trim();
  const first = t.split(/[\n。.！!？?]/)[0] || '';
  const cat = /话术|怎么(说|回|答)|异议|开场/.test(t) ? 'script'
    : /汇报|老板|周报|月报|向上/.test(t) ? 'report'
    : /会议|纪要|参会/.test(t) ? 'meeting'
    : /合同|报价单|协议/.test(t) ? 'contract'
    : /方案|案例|行业/.test(t) ? 'solution' : 'product';
  const tags = [];
  if (/价格|报价/.test(t)) tags.push('价格');
  if (/竞品/.test(t)) tags.push('竞品');
  if (/异议/.test(t)) tags.push('异议处理');
  if (/向上|汇报|老板/.test(t)) tags.push('向上沟通');
  if (/开场/.test(t)) tags.push('开场');
  return {
    title: first.slice(0, 30) || '未命名资料',
    content: t,
    category: cat,
    tags,
    _confidence: first ? 0.8 : 0.4,
  };
}

/* ------------------------------------------------------------------ 批量导入 */
/** 解析 CSV / TSV / 粘贴表格 → 行对象数组 */
function parseTable(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return { headers: [], rows: [] };

  // 分隔符判定：优先制表符，其次逗号，其次多空格
  const firstLine = raw.split('\n')[0];
  const delim = firstLine.includes('\t') ? '\t'
    : firstLine.includes(',') ? ','
    : firstLine.includes('，') ? '，'
    : /\s{2,}/.test(firstLine) ? /\s{2,}/ : ',';

  const cut = (line) => (delim instanceof RegExp ? line.split(delim) : line.split(delim))
    .map((s) => s.trim().replace(/^["']|["']$/g, ''));

  const lines = raw.split('\n').filter((l) => l.trim());
  const headers = cut(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = cut(l);
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] === undefined ? '' : cells[i]; });
    return o;
  });
  return { headers, rows };
}

/** 表头智能映射：中文列名 → 我们的字段 */
function mapHeader(h) {
  const s = String(h || '').trim();
  const RULES = [
    [['公司', '企业', '客户名称', '客户', 'company'], 'company_name'],
    [['联系人', '姓名', '对接人', 'contact', 'name'], 'contact_name'],
    [['电话', '手机', '联系方式', 'phone', 'mobile'], 'contact_phone'],
    [['职位', '职务', '岗位', 'position'], 'contact_position'],
    [['行业', 'industry'], 'industry'],
    [['意向', '等级', '级别', 'level'], 'level'],
    [['标签', 'tag'], 'tags'],
    [['负责人', '销售', 'owner'], 'owner_name'],
    [['备注', '说明', 'remark'], 'remark'],
    [['标题', '任务', '待办', 'title'], 'title'],
    [['内容', '正文', 'content'], 'content'],
    [['分类', '类别', 'category'], 'category'],
    [['截止', '到期', 'due'], 'due_at'],
    [['优先级', 'priority'], 'priority'],
    [['描述', '详情', 'description'], 'description'],
  ];
  for (const [keys, field] of RULES) {
    if (keys.some((k) => s.toLowerCase().includes(k.toLowerCase()))) return field;
  }
  return s;
}

function mapRows(headers, rows) {
  const map = headers.map(mapHeader);
  return rows.map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      const f = map[i];
      let v = r[h];
      if (v === undefined || v === '') return;
      if (f === 'tags') v = String(v).split(/[，,、;；\s]+/).filter(Boolean);
      if (f === 'level') {
        if (/高/.test(v)) v = 'high'; else if (/低/.test(v)) v = 'low'; else v = 'mid';
      }
      if (f === 'priority') {
        if (/高|紧急/.test(v)) v = 'high'; else if (/低|不急/.test(v)) v = 'low'; else v = 'mid';
      }
      o[f] = v;
    });
    return o;
  });
}

/* ------------------------------------------------------------------ 图片 OCR（需模型） */
async function ocrImage(base64, cfg) {
  if (!cfg || !cfg.api_key) {
    throw new Error('图片识别需要先在「系统设置 → AI 服务」配置一个支持视觉的模型');
  }
  const r = await fetch(String(cfg.base_url).replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请把这张图片里的所有文字准确提取出来，只输出文字本身，不要解释、不要加markdown标记。如果是名片或表格，按「字段：值」逐行输出。' },
          { type: 'image_url', image_url: { url: base64 } },
        ],
      }],
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status));
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error('模型没有返回识别结果');
  return text.trim();
}

/* ------------------------------------------------------------------ 模型增强解析（可选） */
async function llmParse(entity, text, cfg) {
  if (!cfg || !cfg.api_key) return null;
  const SCHEMA = {
    customer: '{company_name, contact_name, contact_phone, contact_position, industry(限选项), level(high|mid|low), tags(字符串数组)}',
    task: '{title, description, due_at(ISO8601或null), priority(high|mid|low), owner_name}',
    kb: '{title, content, category(product|solution|script|report|meeting|contract), tags(字符串数组)}',
  }[entity];
  const r = await fetch(String(cfg.base_url).replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是信息抽取引擎。只输出 JSON，不要任何解释、不要 markdown 代码块。缺失的字段填 null 或空数组。' },
        { role: 'user', content: '从下面这段内容里抽取字段，按此结构输出：' + SCHEMA + '\n\n内容：\n' + text.slice(0, 2000) },
      ],
      temperature: 0.1,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(40000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  let raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const o = JSON.parse(raw);
    o._source = 'model';
    o._confidence = 0.9;
    return o;
  } catch { return null; }
}

module.exports = { parseCustomer, parseTask, parseKnowledge, parseTable, mapRows, mapHeader, ocrImage, llmParse, pickDate };
