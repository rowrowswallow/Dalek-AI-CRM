/**
 * 系统设置 —— AI 服务配置（用户自带 API Key）
 *
 * 设计原则：
 *  1. 优先级：用户在设置页填的配置 > 环境变量 > 本地规则引擎
 *  2. 落盘持久化（data/settings.json），重启不丢
 *  3. 密钥只回显后四位，避免明文泄露
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

/* 常见服务商预设 */
const PROVIDERS = [
  { key: 'dashscope', name: '阿里云百炼（通义千问）', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'], note: '新用户有免费额度' },
  { key: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], note: '性价比高' },
  { key: 'moonshot', name: '月之暗面 Kimi', base_url: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'], note: '长上下文' },
  { key: 'zhipu', name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'], note: 'glm-4-flash 有免费档' },
  { key: 'ark', name: '火山方舟（豆包）', base_url: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-32k', 'doubao-lite-4k'], note: '需填接入点 ID 作为模型名' },
  { key: 'hunyuan', name: '腾讯混元', base_url: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-turbo', 'hunyuan-pro'], note: '' },
  { key: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'], note: '国内需代理' },
  { key: 'custom', name: '自定义（任何 OpenAI 兼容接口）', base_url: '', models: [], note: '填入你自己的 base_url 与模型名' },
];

const DEFAULT = {
  ai: {
    enabled: true,
    provider: 'dashscope',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: '',
    model: 'qwen-plus',
    temperature: 0.6,
    max_tokens: 1500,
    system_extra: '',           // 附加在系统提示词后
    last_test_at: null,
    last_test_ok: null,
    last_test_msg: '',
  },
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(FILE)) {
      cache = { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
      cache.ai = { ...DEFAULT.ai, ...(cache.ai || {}) };
    } else {
      cache = JSON.parse(JSON.stringify(DEFAULT));
    }
  } catch (e) {
    cache = JSON.parse(JSON.stringify(DEFAULT));
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[settings] 保存失败:', e.message);
    return false;
  }
}

const mask = (k) => (!k ? '' : k.length <= 8 ? '••••' : k.slice(0, 4) + '••••••' + k.slice(-4));

const api = {
  providers: () => PROVIDERS,

  /** 给前端看的安全版本（密钥脱敏） */
  getSafe() {
    const c = load();
    return {
      ai: {
        ...c.ai,
        api_key: '',
        api_key_masked: mask(c.ai.api_key),
        has_key: !!c.ai.api_key,
      },
      providers: PROVIDERS,
      /** 当前实际生效的模式 */
      effective: api.effectiveMode(),
    };
  },

  /** 内部使用：拿到真实配置 */
  get() { return load().ai; },

  /** 当前生效模式：user(用户配置) | env(环境变量) | rule(本地规则) */
  effectiveMode() {
    const a = load().ai;
    // 只要三项齐全就生效——不额外要求用户去勾一个「启用」开关
    if (a.api_key && a.base_url && a.model) return 'user';
    if (process.env.AI_API_KEY) return 'env';
    return 'rule';
  },

  update(patch) {
    const c = load();
    const prevKey = c.ai.api_key;
    const next = { ...c.ai, ...patch };
    // 前端不回传密钥时保留原值（脱敏显示不覆盖）
    if (patch.api_key === undefined || patch.api_key === '') next.api_key = prevKey;
    if (typeof patch.api_key === 'string' && patch.api_key.startsWith('••')) next.api_key = prevKey;
    c.ai = next;
    save();
    return api.getSafe();
  },

  clearKey() {
    const c = load();
    c.ai.api_key = '';
    c.ai.enabled = false;
    c.ai.last_test_ok = null;
    c.ai.last_test_msg = '';
    save();
    return api.getSafe();
  },

  async test() {
    const a = load().ai;
    const t0 = Date.now();
    const key = a.api_key || process.env.AI_API_KEY;
    const base = a.base_url || process.env.AI_BASE_URL;
    const model = a.model || process.env.AI_MODEL;
    if (!key || !base || !model) {
      const r = { ok: false, msg: '请先填写 API Key、Base URL 和模型名' };
      a.last_test_ok = false; a.last_test_msg = r.msg; a.last_test_at = new Date().toISOString();
      save();
      return r;
    }
    try {
      const res = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '回复「连接成功」四个字即可' }],
          max_tokens: 20,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json().catch(() => ({}));
      const latency = Date.now() - t0;
      if (!res.ok) {
        const msg = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + res.status);
        a.last_test_ok = false; a.last_test_msg = String(msg).slice(0, 160);
        a.last_test_at = new Date().toISOString(); save();
        return { ok: false, msg: a.last_test_msg, latency };
      }
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      a.last_test_ok = true;
      a.last_test_msg = '连接成功：' + text.trim().slice(0, 30);
      a.last_test_at = new Date().toISOString(); save();
      return { ok: true, msg: a.last_test_msg, latency, model };
    } catch (e) {
      const msg = e.name === 'TimeoutError' ? '请求超时（20 秒），检查网络或 Base URL'
        : String(e.message || e).slice(0, 160);
      a.last_test_ok = false; a.last_test_msg = msg;
      a.last_test_at = new Date().toISOString(); save();
      return { ok: false, msg };
    }
  },
};

module.exports = api;
