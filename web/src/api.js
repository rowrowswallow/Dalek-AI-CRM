/** 前端 API 客户端 + 轻量埋点 */

const BASE = '';

function token() {
  try { return localStorage.getItem('aicrm:token') || ''; } catch { return ''; }
}

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', 'X-AICRM-Token': token() },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok && r.status >= 500) throw new Error('HTTP ' + r.status);
  return r.json();
}

export const api = {
  meta: () => req('/api/meta'),
  customers: (q = {}) => req('/api/customers?' + new URLSearchParams(q)),
  addCustomer: (body) => req('/api/customers', { method: 'POST', body }),
  customer: (id) => req('/api/customers/' + id),
  updateCustomer: (id, patch) => req('/api/customers/' + id, { method: 'PATCH', body: patch }),
  batchTag: (ids, add, remove = []) => req('/api/customers/batch-tag', { method: 'POST', body: { ids, add, remove } }),
  followups: (customer_id) => req('/api/followups' + (customer_id ? '?customer_id=' + customer_id : '')),
  addFollowup: (body) => req('/api/followups', { method: 'POST', body }),
  parseFollowup: (content, customer_id) => req('/api/followups/ai-parse', { method: 'POST', body: { content, customer_id } }),
  tags: () => req('/api/tags'),
  tasks: (q = {}) => req('/api/tasks?' + new URLSearchParams(q)),
  addTask: (body) => req('/api/tasks', { method: 'POST', body }),
  removeTask: (id) => req('/api/tasks/remove', { method: 'POST', body: { id } }),
  updateTask: (id, patch) => req('/api/tasks/' + id, { method: 'PATCH', body: patch }),
  stats: () => req('/api/stats/overview'),
  priority: () => req('/api/stats/priority'),
  report: (range = 'week') => req('/api/report/generate', { method: 'POST', body: { range } }),
  syncTag: (body) => req('/api/wecom/sync-tag', { method: 'POST', body }),
  updateRemark: (body) => req('/api/wecom/update-remark', { method: 'POST', body }),
  resolveExternal: (eid) => req('/api/wecom/resolve?external_userid=' + encodeURIComponent(eid)),
  feedback: (body) => req('/api/ai/suggestion/feedback', { method: 'POST', body }),

  /* 知识库 / 素材库 */
  kbCategories: () => req('/api/kb/categories'),
  kbStats: () => req('/api/kb/stats'),
  kbList: (q = {}) => req('/api/kb/list?' + new URLSearchParams(q)),
  kbGet: (id) => req('/api/kb/get/' + id),
  kbAdd: (body) => req('/api/kb/add', { method: 'POST', body }),
  kbUpdate: (id, patch) => req('/api/kb/update', { method: 'POST', body: { id, patch } }),
  kbRemove: (id) => req('/api/kb/remove', { method: 'POST', body: { id } }),
  kbUse: (id) => req('/api/kb/use', { method: 'POST', body: { id } }),
  kbAsk: (question) => req('/api/kb/ask', { method: 'POST', body: { question } }),
  kbScript: (body) => req('/api/kb/script', { method: 'POST', body }),

  /* 账号 */
  login: (username, password) => req('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => req('/api/auth/logout', { method: 'POST', body: {} }),
  me: () => req('/api/auth/me'),
  accounts: () => req('/api/auth/accounts'),
  register: (body) => req('/api/auth/register', { method: 'POST', body }),
  invites: () => req('/api/auth/invites'),
  createInvite: (body) => req('/api/auth/invites', { method: 'POST', body }),
  toggleInvite: (code) => req('/api/auth/invites/toggle', { method: 'POST', body: { code } }),
  removeInvite: (code) => req('/api/auth/invites/remove', { method: 'POST', body: { code } }),
  users: () => req('/api/auth/users'),
  removeUser: (id) => req('/api/auth/users/remove', { method: 'POST', body: { id } }),

  /* 批量 */
  batchCustomers: (ids, action, value) => req('/api/batch/customers', { method: 'POST', body: { ids, action, value } }),
  batchTasks: (ids, action, value) => req('/api/batch/tasks', { method: 'POST', body: { ids, action, value } }),
  batchKb: (ids, action, value) => req('/api/batch/kb', { method: 'POST', body: { ids, action, value } }),

  /* AI 助手 */
  assistants: () => req('/api/assistants'),
  assistant: (id) => req('/api/assistants/' + id),
  updateAssistant: (id, patch) => req('/api/assistants/' + id, { method: 'PATCH', body: patch }),

  /* 会话 */
  conversations: (assistant_id) => req('/api/conversations' + (assistant_id ? '?assistant_id=' + assistant_id : '')),
  conversation: (id) => req('/api/conversations/' + id),
  newConversation: (assistant_id, title, context) =>
    req('/api/conversations/new', { method: 'POST', body: { assistant_id, title, context } }),
  clearConversations: (assistant_id) => req('/api/conversations/clear', { method: 'POST', body: { assistant_id } }),

  /* 智能录入 */
  extractText: (entity, text) => req('/api/extract/text', { method: 'POST', body: { entity, text } }),
  extractOcr: (entity, image) => req('/api/extract/ocr', { method: 'POST', body: { entity, image } }),
  extractTable: (text) => req('/api/extract/table', { method: 'POST', body: { text } }),
  importRows: (entity, rows) => req('/api/import/' + entity, { method: 'POST', body: { rows } }),

  /* 系统设置 */
  getAiSettings: () => req('/api/settings/ai'),
  saveAiSettings: (body) => req('/api/settings/ai', { method: 'POST', body }),
  testAiSettings: () => req('/api/settings/ai/test', { method: 'POST', body: {} }),
  clearAiSettings: () => req('/api/settings/ai/clear', { method: 'POST', body: {} }),

  /* 看板 */
  cards: () => req('/api/dashboard/cards'),
  addCard: (body) => req('/api/dashboard/cards/add', { method: 'POST', body }),
  removeCard: (id, reason) => req('/api/dashboard/cards/remove', { method: 'POST', body: { id, reason } }),
  reorderCard: (id, dir) => req('/api/dashboard/cards/reorder', { method: 'POST', body: { id, dir } }),
  resetCards: () => req('/api/dashboard/cards/reset', { method: 'POST', body: {} }),
  resetDemo: () => req('/api/admin/reset', { method: 'POST', body: {} }),
  dashboardChanges: () => req('/api/dashboard/changes'),
};

/**
 * AI 对话 SSE —— 用原生 fetch + ReadableStream 解析（与悟空相同的做法）
 * 事件：delta(增量文本) / action(结构化动作) / done / error
 */
export async function chatStream({ scene, text, context, assistantId, conversationId, onDelta, onAction, onDone, onError, signal }) {
  const t0 = Date.now();
  let firstTokenAt = null;
  try {
    const res = await fetch(BASE + '/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AICRM-Token': token() },
      body: JSON.stringify({ scene, text, context, assistant_id: assistantId, conversation_id: conversationId }),
      signal,
    });
    if (!res.body) throw new Error('no stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const ev = (part.match(/^event:\s*(.+)$/m) || [])[1];
        const dataLine = (part.match(/^data:\s*(.+)$/m) || [])[1];
        if (!ev || !dataLine) continue;
        let data;
        try { data = JSON.parse(dataLine); } catch { continue; }

        if (ev === 'delta') {
          if (firstTokenAt === null) firstTokenAt = Date.now() - t0;
          full += data.text;
          onDelta && onDelta(data.text, full);
        } else if (ev === 'action') {
          onAction && onAction(data.actions || []);
        } else if (ev === 'done') {
          onDone && onDone({ ...data, firstTokenMs: firstTokenAt, totalMs: Date.now() - t0 });
        } else if (ev === 'error') {
          onError && onError(data);
        }
      }
    }
    try { reader.releaseLock(); } catch {}
    return { text: full, firstTokenMs: firstTokenAt, totalMs: Date.now() - t0 };
  } catch (e) {
    if (e.name === 'AbortError') return { aborted: true };
    onError && onError({ message: e.message });
    return { error: e.message };
  }
}

/* -------------------------------------------------- 轻量埋点（按 PRD 第一批 6 个事件） */
const trackQueue = [];
export function track(event, payload = {}) {
  const rec = { event, payload, at: new Date().toISOString() };
  trackQueue.push(rec);
  try {
    const prev = JSON.parse(localStorage.getItem('aicrm:track') || '[]');
    prev.push(rec);
    localStorage.setItem('aicrm:track', JSON.stringify(prev.slice(-300)));
  } catch {}
  if (import.meta.env.DEV) console.debug('[track]', event, payload);
}
export function trackAll() {
  try { return JSON.parse(localStorage.getItem('aicrm:track') || '[]'); } catch { return []; }
}
