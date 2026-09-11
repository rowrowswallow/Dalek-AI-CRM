<script setup>
import { ref, onMounted } from 'vue';
import { api, track } from '../api.js';

const emit = defineEmits(['ok', 'back']);

const form = ref({ username: '', password: '', password2: '', name: '', invite_code: '' });
const err = ref('');
const loading = ref(false);
const demo = ref(null);
const showPwd = ref(false);

/** 支持从链接带邀请码进来：?invite=XXXX */
onMounted(async () => {
  const q = new URLSearchParams(location.search);
  const code = q.get('invite') || q.get('code');
  if (code) form.value.invite_code = code.toUpperCase();
  const r = await api.accounts();
  if (r.ok && r.accounts.length) demo.value = r.accounts[0];
});

async function submit() {
  err.value = '';
  const f = form.value;
  if (!f.username.trim()) { err.value = '请填写账号'; return; }
  if (f.password.length < 6) { err.value = '密码至少 6 位'; return; }
  if (f.password !== f.password2) { err.value = '两次输入的密码不一致'; return; }
  if (!f.invite_code.trim()) { err.value = '请填写邀请码'; return; }

  loading.value = true;
  const r = await api.register({
    username: f.username.trim(),
    password: f.password,
    name: f.name.trim(),
    invite_code: f.invite_code.trim().toUpperCase(),
  });
  loading.value = false;

  if (!r.ok) { err.value = r.error || '注册失败'; return; }
  localStorage.setItem('aicrm:token', r.token);
  localStorage.setItem('aicrm:user', JSON.stringify(r.user));
  track('page_view', { page: 'register_success' });
  emit('ok', r.user);
}
</script>

<template>
  <div class="login">
    <div class="brand">
      <div class="brand-inner">
        <div class="logo">A</div>
        <h1>创建你的账号</h1>
        <p class="sub">
          注册后会给你一份独立的演示数据——8 家客户、若干任务和一个知识库。<br />
          这些数据只属于你，别人看不到，你改坏了也不影响其他人。
        </p>
        <div class="feats">
          <div class="feat"><span class="fi">◐</span><div><b>对话式管理</b><i>AI 助手随页面自动切换</i></div></div>
          <div class="feat"><span class="fi">▯</span><div><b>企微内嵌抽屉</b><i>聊天窗口里顺手管理客户</i></div></div>
          <div class="feat"><span class="fi">✎</span><div><b>一键汇报</b><i>数据进，汇报稿出</i></div></div>
        </div>
      </div>
    </div>

    <div class="form-side">
      <div class="form-card">
        <h2>注册</h2>
        <p class="fs">需要一个邀请码</p>

        <label class="fld"><span>邀请码 *</span>
          <input v-model="form.invite_code" placeholder="8 位字母数字，如 H3E6FR29"
                 style="text-transform:uppercase;letter-spacing:1px" />
        </label>
        <div class="hint">没有邀请码？找给你链接的人要一个。</div>

        <label class="fld"><span>账号 *</span>
          <input v-model="form.username" placeholder="字母、数字、下划线，至少 3 位"
                 @keydown.enter="submit" />
        </label>

        <label class="fld"><span>你的名字</span>
          <input v-model="form.name" placeholder="显示在界面上，可留空" @keydown.enter="submit" />
        </label>

        <label class="fld"><span>密码 *</span>
          <div class="keyrow">
            <input v-model="form.password" :type="showPwd ? 'text' : 'password'"
                   placeholder="至少 6 位" @keydown.enter="submit" />
            <button class="btn btn-sm" @click="showPwd = !showPwd">{{ showPwd ? '隐藏' : '显示' }}</button>
          </div>
        </label>

        <label class="fld"><span>确认密码 *</span>
          <input v-model="form.password2" type="password" placeholder="再输一遍" @keydown.enter="submit" />
        </label>

        <div v-if="err" class="err">{{ err }}</div>

        <button class="btn-submit" :disabled="loading" @click="submit">
          {{ loading ? '创建中…' : '创建账号 →' }}
        </button>

        <div class="back">
          已经有账号了？<a @click="emit('back')">返回登录</a>
        </div>

        <div v-if="demo" class="demo-box">
          <div class="db-t">或者先用内置演示账号看看</div>
          <button class="demo-btn" @click="form.username = demo.username; form.password = demo.password; form.password2 = demo.password; emit('back')">
            <b>{{ demo.name }}</b>
            <span>{{ demo.username }} / {{ demo.password }}</span>
            <em>{{ demo.desc }}</em>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login { display: flex; height: 100vh; background: var(--bg); }

.brand {
  flex: 1; background: linear-gradient(150deg, #221E19 0%, #14110E 100%);
  color: #F5F1EA; display: flex; align-items: center; justify-content: center; padding: 48px;
}
.brand-inner { max-width: 400px; }
.logo {
  width: 44px; height: 44px; border-radius: var(--r-3); background: var(--accent); color: #fff;
  display: grid; place-items: center; font-size: 20px; font-weight: 700; margin-bottom: 36px;
}
.brand h1 { font-size: 32px; line-height: 1.35; margin: 0 0 18px; font-weight: 650; letter-spacing: -.5px; }
.sub { font-size: 13px; line-height: 1.85; color: rgba(245,241,234,.62); margin: 0 0 40px; }
.feats { display: flex; flex-direction: column; gap: 18px; }
.feat { display: flex; gap: 13px; align-items: flex-start; }
.fi {
  width: 30px; height: 30px; border-radius: var(--r-2); flex: 0 0 30px;
  background: rgba(255,255,255,.08); display: grid; place-items: center;
  color: var(--accent); font-size: 13px;
}
.feat b { display: block; font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.feat i { font-style: normal; font-size: 11.5px; color: rgba(245,241,234,.5); }

.form-side { flex: 1; display: grid; place-items: center; padding: 40px; overflow-y: auto; }
.form-card { width: 100%; max-width: 380px; padding: 12px 0; }
.form-card h2 { font-size: 24px; margin: 0 0 6px; font-weight: 650; letter-spacing: -.4px; }
.fs { font-size: 12.5px; color: var(--ink-3); margin: 0 0 22px; }

.fld { display: block; margin-bottom: 12px; }
.fld > span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 5px; }
.fld input {
  width: 100%; height: 38px; padding: 0 12px; font-size: 13.5px;
  border: 1px solid var(--line); border-radius: var(--r-3);
  background: var(--surface); outline: 0; color: var(--ink);
  transition: border-color .16s, box-shadow .16s;
}
.fld input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.keyrow { display: flex; gap: 6px; }
.keyrow input { flex: 1; }

.hint { font-size: 11px; color: var(--ink-4); margin: -6px 0 12px; }
.err { padding: 8px 11px; border-radius: var(--r-2); background: var(--red-soft); color: var(--red); font-size: 12px; margin-bottom: 12px; }

.btn-submit {
  width: 100%; height: 42px; border: 0; border-radius: var(--r-3);
  background: var(--ink); color: #fff; font-size: 13.5px; font-weight: 550; transition: background .16s;
}
.btn-submit:hover:not(:disabled) { background: #000; }
.btn-submit:disabled { opacity: .5; cursor: not-allowed; }

.back { text-align: center; font-size: 12.5px; color: var(--ink-3); margin-top: 14px; }
.back a { color: var(--accent); cursor: pointer; }

.demo-box { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line); }
.db-t { font-size: 11.5px; color: var(--ink-4); margin-bottom: 8px; }
.demo-btn {
  width: 100%; text-align: left; border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-2); padding: 10px 12px; transition: all .16s var(--ease);
}
.demo-btn:hover { border-color: var(--accent-line); background: var(--accent-soft); }
.demo-btn b { display: block; font-size: 12.5px; }
.demo-btn span { display: block; font-size: 11px; color: var(--ink-3); margin-top: 3px; font-family: var(--mono); }
.demo-btn em { display: block; font-style: normal; font-size: 10.5px; color: var(--ink-4); margin-top: 4px; }

@media (max-width: 900px) { .brand { display: none; } }
</style>
