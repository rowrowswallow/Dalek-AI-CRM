<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { api, track } from '../api.js';

const ctx = inject('aicrm');

const tab = ref('ai');
const invites = ref([]);
const users = ref([]);
const invStats = ref(null);
const newInvite = ref({ note: '', max_uses: 5, expires_days: 30 });
const creating = ref(false);
const host = ref(location.origin);
const cfg = ref(null);
const providers = ref([]);
const form = ref({ provider: 'dashscope', base_url: '', api_key: '', model: '', temperature: 0.6, max_tokens: 1500, system_extra: '', enabled: true });
const showKey = ref(false);
const testing = ref(false);
const testResult = ref(null);
const saving = ref(false);
const msg = ref('');

const cur = computed(() => providers.value.find((p) => p.key === form.value.provider));

async function load() {
  const r = await api.getAiSettings();
  if (!r.ok) return;
  cfg.value = r;
  providers.value = r.providers || [];
  const a = r.ai || {};
  form.value = {
    provider: a.provider || 'dashscope',
    base_url: a.base_url || '',
    api_key: '',                      // 不回显真实密钥
    model: a.model || '',
    temperature: a.temperature ?? 0.6,
    max_tokens: a.max_tokens ?? 1500,
    system_extra: a.system_extra || '',
    enabled: a.enabled !== false,
  };
}

function pickProvider(key) {
  form.value.provider = key;
  const p = providers.value.find((x) => x.key === key);
  if (p) {
    form.value.base_url = p.base_url;
    if (p.models && p.models.length) form.value.model = p.models[0];
    else form.value.model = '';
  }
  testResult.value = null;
}

async function save() {
  saving.value = true; msg.value = '';
  const r = await api.saveAiSettings({ ai: form.value });
  saving.value = false;
  if (r.ok) { cfg.value = r; msg.value = '已保存'; await ctx.reloadMeta(); setTimeout(() => (msg.value = ''), 2000); }
  track('ai_config_save', { provider: form.value.provider, model: form.value.model });
}

async function test() {
  testing.value = true; testResult.value = null;
  await api.saveAiSettings({ ai: form.value });   // 先保存再测，避免测了个旧配置
  const r = await api.testAiSettings();
  testing.value = false;
  testResult.value = r.result || r;
  await load();
  track('ai_config_test', { ok: !!(r.result && r.result.ok) });
}

async function clearKey() {
  await api.clearAiSettings();
  await load();
  testResult.value = null;
  msg.value = '已清除 API Key，回到本地规则引擎';
  await ctx.reloadMeta();
  setTimeout(() => (msg.value = ''), 2500);
}

async function loadAuth() {
  const [i, u] = await Promise.all([api.invites(), api.users()]);
  if (i.ok) { invites.value = i.list; invStats.value = i.stats; }
  if (u.ok) users.value = u.list;
}

async function makeInvite() {
  creating.value = true;
  const r = await api.createInvite(newInvite.value);
  creating.value = false;
  if (r.ok) {
    await loadAuth();
    ctx.flash('邀请码已生成');
    track('invite_create', { code: r.invite.code });
  }
}

async function copyInvite(code) {
  const link = host.value + '/?invite=' + code;
  try { await navigator.clipboard.writeText(link); ctx.flash('注册链接已复制'); }
  catch { ctx.flash(link); }
}

async function toggleInvite(code) {
  await api.toggleInvite(code);
  await loadAuth();
}

async function removeInvite(code) {
  if (!confirm('删除这个邀请码？已经用它注册的账号不受影响。')) return;
  await api.removeInvite(code);
  await loadAuth();
  ctx.flash('已删除');
}

async function removeUser(u) {
  if (!confirm(`删除用户「${u.name}」及其全部数据？此操作不可撤销。`)) return;
  const r = await api.removeUser(u.id);
  if (!r.ok) { ctx.flash(r.error || '删除失败'); return; }
  await loadAuth();
  ctx.flash('已删除该用户及其数据');
}

const modeText = computed(() => {
  const m = cfg.value && cfg.value.effective;
  return m === 'user' ? '你自己的 API（已生效）'
    : m === 'env' ? '环境变量配置（已生效）'
    : '本地规则引擎（未配置 Key）';
});

onMounted(async () => { await load(); await loadAuth(); });
</script>

<template>
  <div class="view">
    <header class="vh">
      <div>
        <h1 class="vh-t">系统设置</h1>
        <p class="vh-s">配置 AI 服务、查看账号信息</p>
      </div>
      <div class="tabs">
        <button :class="{ on: tab === 'ai' }" @click="tab = 'ai'">AI 服务</button>
        <button :class="{ on: tab === 'account' }" @click="tab = 'account'; loadAuth()">账号与邀请</button>
      </div>
    </header>

    <div class="scroll">
      <!-- ============ AI 服务 ============ -->
      <template v-if="tab === 'ai'">
        <!-- 当前状态 -->
        <div class="card status" :class="cfg && cfg.effective">
          <div class="grow">
            <div class="st-l">当前 AI 引擎</div>
            <div class="st-v">{{ modeText }}</div>
            <div class="st-s">
              <template v-if="cfg && cfg.effective === 'user'">
                模型 {{ cfg.ai.model }} · 密钥 {{ cfg.ai.api_key_masked }}
              </template>
              <template v-else-if="cfg && cfg.effective === 'env'">
                来自环境变量 AI_API_KEY
              </template>
              <template v-else>
                未配置 API Key 时，AI 助手走**内置规则引擎**——只能识别固定说法，
                换个问法就会答非所问。<b>填上自己的 Key 即可用真实大模型。</b>
              </template>
            </div>
          </div>
          <div class="st-badge" :class="cfg && cfg.effective">{{ cfg && cfg.effective === 'rule' ? '规则' : '大模型' }}</div>
        </div>

        <!-- 服务商 -->
        <div class="card sec">
          <div class="sec-h">① 选择服务商</div>
          <div class="providers">
            <button
              v-for="p in providers" :key="p.key"
              class="prov" :class="{ on: form.provider === p.key }"
              @click="pickProvider(p.key)"
            >
              <div class="pv-n">{{ p.name }}</div>
              <div class="pv-note">{{ p.note || '—' }}</div>
            </button>
          </div>
        </div>

        <!-- 配置 -->
        <div class="card sec">
          <div class="sec-h">② 填写配置</div>

          <label class="fld">
            <span>Base URL</span>
            <input v-model="form.base_url" placeholder="https://api.example.com/v1" />
          </label>
          <div class="tip">只填到 <code>/v1</code> 即可，系统会自动补 <code>/chat/completions</code></div>

          <label class="fld">
            <span>API Key</span>
            <div class="keyrow">
              <input
                v-model="form.api_key" :type="showKey ? 'text' : 'password'"
                :placeholder="cfg && cfg.ai.has_key ? '已保存（' + cfg.ai.api_key_masked + '），留空则不变' : 'sk-...'"
              />
              <button class="btn btn-sm" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
            </div>
          </label>

          <label class="fld">
            <span>模型名</span>
            <div class="keyrow">
              <input v-model="form.model" placeholder="qwen-plus" list="model-list" />
              <datalist id="model-list">
                <option v-for="m in (cur && cur.models) || []" :key="m" :value="m" />
              </datalist>
            </div>
          </label>
          <div v-if="cur && cur.models && cur.models.length" class="tip">
            推荐：{{ cur.models.join(' / ') }}
          </div>

          <div class="row gap12" style="margin-top:10px">
            <label class="mini-fld">
              <span>温度 {{ form.temperature }}</span>
              <input v-model.number="form.temperature" type="range" min="0" max="1" step="0.1" />
            </label>
            <label class="mini-fld">
              <span>最大输出 tokens</span>
              <input v-model.number="form.max_tokens" type="number" min="100" max="8000" step="100" class="num" />
            </label>
          </div>

          <label class="fld" style="margin-top:10px">
            <span>附加要求</span>
            <textarea v-model="form.system_extra" rows="2"
                      placeholder="会追加到系统提示词后，比如：回答尽量简短，用销售的口吻" />
          </label>

          <div class="acts">
            <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存配置' }}</button>
            <button class="btn" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
            <button class="btn" v-if="cfg && cfg.ai.has_key" @click="clearKey">清除 Key</button>
            <span v-if="msg" class="ok">{{ msg }}</span>
          </div>

          <div v-if="testResult" class="test" :class="{ ok: testResult.ok, bad: !testResult.ok }">
            <b>{{ testResult.ok ? '✓ 连接成功' : '✗ 连接失败' }}</b>
            <span>{{ testResult.msg }}</span>
            <span v-if="testResult.latency" class="dim">· {{ testResult.latency }}ms</span>
          </div>

          <div v-if="cfg && cfg.ai.last_test_at" class="last">
            上次测试：{{ new Date(cfg.ai.last_test_at).toLocaleString('zh-CN') }}
            · {{ cfg.ai.last_test_ok ? '成功' : '失败' }}
          </div>
        </div>

        <!-- 说明 -->
        <div class="card sec help">
          <div class="sec-h">③ 怎么拿到 Key</div>
          <div class="hl">
            <div><b>阿里云百炼</b> 新用户有免费额度，登录后到「API-KEY 管理」创建</div>
            <div><b>DeepSeek</b> 性价比高，注册后在「API keys」创建</div>
            <div><b>智谱 GLM</b> 的 <code>glm-4-flash</code> 有免费档，适合先跑通</div>
          </div>
          <div class="note">
            配置只保存在<strong>你自己的服务器</strong>（<code>data/settings.json</code>），
            不会上传到任何第三方。密钥在前端只回显后四位。
          </div>
        </div>
      </template>

      <!-- ============ 账号与邀请 ============ -->
      <template v-else>
        <div class="card sec" v-if="ctx && ctx.user.value">
          <div class="sec-h">当前账号</div>
          <div class="acct">
            <div class="ac-av">{{ ctx.user.value.avatar }}</div>
            <div class="grow">
              <div class="ac-n">{{ ctx.user.value.name }} <span class="tag">{{ ctx.user.value.role_name }}</span></div>
              <div class="ac-s">{{ ctx.user.value.title }} · {{ ctx.user.value.dept }} · {{ ctx.user.value.username }}</div>
            </div>
          </div>
          <div class="kv">
            <div><span>数据范围</span><b>{{ ['', '本人', '本人及下属', '本部门', '本部门及子部门', '全部'][ctx.user.value.data_scope] }}</b></div>
            <div><span>可见模块</span><b>{{ ctx.user.value.nav.join(' / ') }}</b></div>
            <div><span>工作区</span><b class="mono">{{ ctx.user.value.workspace_id }}</b></div>
          </div>
        </div>

        <!-- 邀请码 -->
        <div class="card sec">
          <div class="sec-h">
            邀请码
            <span class="dim" style="font-weight:400;font-size:11px">
              共 {{ invites.length }} 个 · {{ invStats ? invStats.active_invites : 0 }} 个可用
            </span>
          </div>

          <div class="inv-form">
            <input v-model="newInvite.note" class="fi" placeholder="备注（给谁用，比如：老王）" />
            <label class="fi-num">
              可用次数
              <input v-model.number="newInvite.max_uses" type="number" min="1" max="100" />
            </label>
            <label class="fi-num">
              有效天数
              <input v-model.number="newInvite.expires_days" type="number" min="1" max="365" />
            </label>
            <button class="btn btn-primary btn-sm" :disabled="creating" @click="makeInvite">
              {{ creating ? '生成中…' : '+ 生成邀请码' }}
            </button>
          </div>

          <div v-if="invites.length" class="inv-list">
            <div v-for="i in invites" :key="i.code" class="inv" :class="{ off: i.disabled || i.used_count >= i.max_uses }">
              <div class="iv-code mono">{{ i.code }}</div>
              <div class="grow">
                <div class="iv-note">{{ i.note || '（无备注）' }}</div>
                <div class="iv-meta">
                  {{ i.used_count }} / {{ i.max_uses }} 次
                  <span v-if="i.expires_at"> · {{ new Date(i.expires_at).toLocaleDateString('zh-CN') }} 到期</span>
                  <span v-if="i.disabled" class="pill warn" style="margin-left:6px">已停用</span>
                  <span v-else-if="i.used_count >= i.max_uses" class="pill" style="margin-left:6px">已用完</span>
                </div>
              </div>
              <button class="btn btn-sm" @click="copyInvite(i.code)">复制链接</button>
              <button class="btn btn-sm" @click="toggleInvite(i.code)">{{ i.disabled ? '启用' : '停用' }}</button>
              <button class="btn btn-sm del" @click="removeInvite(i.code)">删</button>
            </div>
          </div>
          <div v-else class="dim" style="font-size:12px">
            还没有邀请码。生成一个，把链接发给朋友，他就能自己注册并拿到独立的数据。
          </div>
        </div>

        <!-- 用户 -->
        <div class="card sec">
          <div class="sec-h">已注册用户<span class="dim" style="font-weight:400;font-size:11px">{{ users.length }} 个</span></div>
          <table class="ut">
            <thead><tr><th>用户</th><th>账号</th><th>客户数</th><th>注册时间</th><th>最近登录</th><th></th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><b>{{ u.name }}</b> <span class="tag">{{ u.role_name }}</span></td>
                <td class="mono">{{ u.username }}</td>
                <td>{{ u.customer_count }}</td>
                <td>{{ u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '—' }}</td>
                <td>{{ u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN') : '从未' }}</td>
                <td>
                  <button v-if="u.username !== 'chenli' && ctx.user.value.id !== u.id"
                          class="btn btn-sm del" @click="removeUser(u)">删除</button>
                  <span v-else class="dim" style="font-size:11px">内置</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.vh { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px 12px; gap: 16px; }
.vh-t { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.vh-s { margin: 3px 0 0; font-size: 12px; color: var(--ink-3); }
.tabs { display: flex; border: 1px solid var(--line); border-radius: var(--r-2); overflow: hidden; }
.tabs button { border: 0; background: var(--surface); padding: 6px 14px; font-size: 12px; color: var(--ink-3); }
.tabs button.on { background: var(--ink); color: #fff; }

.scroll { flex: 1; overflow: auto; padding: 0 20px 24px; display: flex; flex-direction: column; gap: 12px; max-width: 900px; }
.card { padding: 13px 15px; }
.sec-h { font-size: 12.5px; font-weight: 650; color: var(--ink-2); margin-bottom: 11px; }

.status { display: flex; align-items: center; gap: 14px; }
.status.user { border-color: var(--green); background: var(--green-soft); }
.status.rule { border-color: var(--amber); background: var(--amber-soft); }
.status.env { border-color: var(--blue); background: var(--blue-soft); }
.st-l { font-size: 11px; color: var(--ink-3); }
.st-v { font-size: 15px; font-weight: 650; margin-top: 2px; }
.st-s { font-size: 11.5px; color: var(--ink-2); margin-top: 5px; line-height: 1.65; }
.st-s b { color: var(--accent); }
.st-badge {
  font-size: 12px; font-weight: 650; padding: 5px 12px; border-radius: var(--r-pill);
  background: var(--surface); color: var(--ink-2); flex: 0 0 auto;
}
.st-badge.user { background: var(--green); color: #fff; }
.st-badge.rule { background: var(--amber); color: #fff; }
.st-badge.env { background: var(--blue); color: #fff; }

.providers { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.prov {
  text-align: left; border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-2); padding: 9px 11px; transition: all .16s var(--ease);
}
.prov:hover { border-color: var(--line-strong); }
.prov.on { border-color: var(--accent); background: var(--accent-soft); }
.pv-n { font-size: 12.5px; font-weight: 600; }
.pv-note { font-size: 10.5px; color: var(--ink-3); margin-top: 2px; }

.fld { display: block; margin-bottom: 10px; }
.fld > span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 5px; }
.fld input, .fld textarea {
  width: 100%; padding: 8px 11px; font-size: 13px; border: 1px solid var(--line);
  border-radius: var(--r-2); background: var(--surface-2); outline: 0; color: var(--ink);
  font-family: inherit; resize: vertical;
}
.fld input:focus, .fld textarea:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.keyrow { display: flex; gap: 6px; }
.keyrow input { flex: 1; }
.tip { font-size: 11px; color: var(--ink-3); margin: -5px 0 10px; }
.tip code, .card code { font-family: var(--mono); font-size: 11px; background: var(--bg-sunken); padding: 1px 5px; border-radius: 3px; }

.row.gap12 { display: flex; gap: 12px; }
.mini-fld { flex: 1; }
.mini-fld > span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 5px; }
.mini-fld input[type=range] { width: 100%; accent-color: var(--accent); }
.num { width: 100%; padding: 7px 10px; font-size: 12.5px; border: 1px solid var(--line); border-radius: var(--r-2); background: var(--surface-2); outline: 0; }

.acts { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.ok { font-size: 12px; color: var(--green); }

.test {
  margin-top: 11px; padding: 10px 12px; border-radius: var(--r-2);
  font-size: 12px; line-height: 1.6; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline;
}
.test.ok { background: var(--green-soft); color: var(--green); }
.test.bad { background: var(--red-soft); color: var(--red); }
.test b { font-weight: 650; }
.last { font-size: 10.5px; color: var(--ink-4); margin-top: 8px; }

.help .hl { display: flex; flex-direction: column; gap: 7px; font-size: 12px; line-height: 1.65; color: var(--ink-2); }
.note {
  margin-top: 11px; padding: 9px 11px; border-radius: var(--r-2);
  background: var(--green-soft); font-size: 11.5px; color: var(--green); line-height: 1.65;
}

.inv-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.fi {
  flex: 1; min-width: 160px; height: 32px; padding: 0 10px; font-size: 12.5px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface-2); outline: 0; color: var(--ink);
}
.fi:focus { border-color: var(--accent-line); }
.fi-num { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-3); }
.fi-num input {
  width: 62px; height: 32px; padding: 0 8px; font-size: 12.5px;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface-2); outline: 0; color: var(--ink);
}

.inv-list { display: flex; flex-direction: column; gap: 7px; }
.inv {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: var(--r-2); background: var(--surface-2);
}
.inv.off { opacity: .5; }
.iv-code {
  font-size: 14px; font-weight: 650; letter-spacing: 2px; color: var(--accent);
  background: var(--accent-soft); padding: 4px 10px; border-radius: var(--r-1);
}
.iv-note { font-size: 12.5px; }
.iv-meta { font-size: 10.5px; color: var(--ink-4); margin-top: 2px; }

.ut { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ut th { text-align: left; font-weight: 500; color: var(--ink-3); font-size: 11.5px; padding: 0 10px 8px; border-bottom: 1px solid var(--line); }
.ut td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft); }
.mono { font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); }
.btn.del { color: var(--red); border-color: rgba(179,58,43,.3); }
.btn.del:hover { background: var(--red-soft); border-color: var(--red); }

.acct { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
.ac-av { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-size: 16px; font-weight: 650; }
.ac-n { font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 6px; }
.ac-s { font-size: 11.5px; color: var(--ink-3); margin-top: 3px; }
.kv { display: flex; flex-direction: column; gap: 7px; font-size: 12px; }
.kv > div { display: flex; gap: 10px; }
.kv span { flex: 0 0 76px; color: var(--ink-3); }
.kv b { font-weight: 550; }
</style>
