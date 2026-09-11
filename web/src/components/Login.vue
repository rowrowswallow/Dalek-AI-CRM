<script setup>
import { ref, onMounted } from 'vue';
import { api, track } from '../api.js';

const emit = defineEmits(['ok', 'register']);

const accounts = ref([]);
const username = ref('chenli');
const password = ref('123456');
const err = ref('');
const loading = ref(false);

async function submit(u, p) {
  err.value = '';
  loading.value = true;
  const r = await api.login(u ?? username.value, p ?? password.value);
  loading.value = false;
  if (!r.ok) { err.value = r.error || '登录失败'; return; }
  localStorage.setItem('aicrm:token', r.token);
  localStorage.setItem('aicrm:user', JSON.stringify(r.user));
  track('page_view', { page: 'login_success', role: r.user.role });
  emit('ok', r.user);
}

function quick(a) {
  username.value = a.username;
  password.value = a.password;
  submit(a.username, a.password);
}

onMounted(async () => {
  const r = await api.accounts();
  if (r.ok) accounts.value = r.accounts;
});
</script>

<template>
  <div class="login">
    <!-- 左：品牌 -->
    <div class="brand">
      <div class="brand-inner">
        <div class="logo">A</div>
        <h1>让决策有依据<br />让汇报不用熬夜</h1>
        <p class="sub">
          面向销售负责人的 AI 决策与汇报工作台。<br />
          今天该抓谁、怎么向老板解释——这两件事交给它。
        </p>
        <div class="feats">
          <div class="feat"><span class="fi">◐</span><div><b>对话式管理</b><i>AI 员工随页面自动切换</i></div></div>
          <div class="feat"><span class="fi">▯</span><div><b>企微内嵌抽屉</b><i>聊天窗口里顺手管理客户</i></div></div>
          <div class="feat"><span class="fi">✎</span><div><b>一键汇报</b><i>数据进，汇报稿出</i></div></div>
        </div>
      </div>
    </div>

    <!-- 右：表单 -->
    <div class="form-side">
      <div class="form-card">
        <h2>欢迎回来</h2>
        <p class="fs">登录后进入你的工作台</p>

        <label class="fld"><span>账号</span>
          <input v-model="username" placeholder="用户名" @keydown.enter="submit()" />
        </label>
        <label class="fld"><span>密码</span>
          <input v-model="password" type="password" placeholder="密码" @keydown.enter="submit()" />
        </label>

        <div v-if="err" class="err">{{ err }}</div>

        <button class="btn-submit" :disabled="loading" @click="submit()">
          {{ loading ? '登录中…' : '立即登录 →' }}
        </button>

        <div class="back">
          还没有账号？<a @click="emit('register')">用邀请码注册</a>
        </div>

        <div class="divider"><span>演示账号（点击直接登录）</span></div>
        <div class="quick">
          <button v-for="a in accounts" :key="a.username" class="quick-item" @click="quick(a)">
            <div class="qi-top"><b>{{ a.name }}</b><span class="qi-role">{{ a.role_name }}</span></div>
            <div class="qi-desc">{{ a.desc }}</div>
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
  color: #F5F1EA; display: flex; align-items: center; justify-content: center;
  padding: 48px;
}
.brand-inner { max-width: 400px; }
.logo {
  width: 44px; height: 44px; border-radius: var(--r-3);
  background: var(--accent); color: #fff; display: grid; place-items: center;
  font-size: 20px; font-weight: 700; margin-bottom: 36px;
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

.form-side { flex: 1; display: grid; place-items: center; padding: 40px; }
.form-card { width: 100%; max-width: 380px; }
.form-card h2 { font-size: 24px; margin: 0 0 6px; font-weight: 650; letter-spacing: -.4px; }
.fs { font-size: 12.5px; color: var(--ink-3); margin: 0 0 26px; }

.fld { display: block; margin-bottom: 14px; }
.fld span { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 6px; }
.fld input {
  width: 100%; height: 40px; padding: 0 13px; font-size: 13.5px;
  border: 1px solid var(--line); border-radius: var(--r-3);
  background: var(--surface); outline: 0; color: var(--ink);
  transition: border-color .16s, box-shadow .16s;
}
.fld input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }

.err {
  padding: 8px 11px; border-radius: var(--r-2); background: var(--red-soft);
  color: var(--red); font-size: 12px; margin-bottom: 12px;
}

.btn-submit {
  width: 100%; height: 42px; border: 0; border-radius: var(--r-3);
  background: var(--ink); color: #fff; font-size: 13.5px; font-weight: 550;
  transition: background .16s;
}
.btn-submit:hover:not(:disabled) { background: #000; }
.btn-submit:disabled { opacity: .5; cursor: not-allowed; }

.back { text-align: center; font-size: 12.5px; color: var(--ink-3); margin-top: 14px; }
.back a { color: var(--accent); cursor: pointer; }
.divider {
  display: flex; align-items: center; gap: 10px; margin: 24px 0 14px;
  font-size: 11px; color: var(--ink-4);
}
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }

.quick { display: flex; flex-direction: column; gap: 7px; }
.quick-item {
  text-align: left; border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-2); padding: 9px 11px; transition: all .16s var(--ease);
}
.quick-item:hover { border-color: var(--accent-line); background: var(--accent-soft); }
.qi-top { display: flex; align-items: center; gap: 7px; }
.qi-top b { font-size: 12.5px; font-weight: 600; }
.qi-role {
  font-size: 10.5px; padding: 1px 7px; border-radius: var(--r-1);
  background: var(--bg-sunken); color: var(--ink-3);
}
.qi-desc { font-size: 11px; color: var(--ink-3); margin-top: 3px; line-height: 1.5; }

@media (max-width: 900px) {
  .brand { display: none; }
}
</style>
