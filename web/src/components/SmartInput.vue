<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { api, track } from '../api.js';

/* ------------------------------------------------------------------
   智能录入：语音 / 图片识别 / 附件批量导入 / 自由文本
   三种来源统一转成结构化字段，通过 @fill 抛给父表单
------------------------------------------------------------------ */
const props = defineProps({
  entity: { type: String, default: 'customer' },   // customer | task | kb
  hint: { type: String, default: '' },
});
const emit = defineEmits(['fill', 'batch', 'error']);

const mode = ref('');              // '' | text | voice | image | file
const text = ref('');
const busy = ref(false);
const status = ref('');
const err = ref('');
const listening = ref(false);
const batchPreview = ref(null);
const fileInput = ref(null);
const imageInput = ref(null);
const recognition = ref(null);

const PLACEHOLDER = computed(() => {
  if (props.entity === 'task') return '比如：让赵敏明天下午联系蓝湖软件确认合同条款，比较急';
  if (props.entity === 'kb') return '比如：客户要求延长试用期怎么回——先问清顾虑，再给两周试点方案，强调按坐席计费可以随时调整';
  return '比如：张总那边是上海某某科技有限公司，电话13800001001，做医疗器械的，对价格比较在意，让我下周给方案';
});

const ACCEPT_HINT = computed(() =>
  props.entity === 'customer' ? '支持 CSV / TSV / 从 Excel 直接复制粘贴' : '支持 CSV / TSV / 从 Excel 直接复制粘贴');

/* ---------------------------------------------------------- 语音 */
function startVoice() {
  err.value = '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    err.value = '当前浏览器不支持语音识别，请用 Chrome / Edge，或直接粘贴文字';
    return;
  }
  try {
    const r = new SR();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      text.value = finalText + interim;
    };
    r.onerror = (e) => {
      listening.value = false;
      if (e.error === 'not-allowed') err.value = '麦克风权限被拒绝，请在浏览器地址栏允许后重试';
      else if (e.error !== 'aborted') err.value = '语音识别出错：' + e.error;
    };
    r.onend = () => { listening.value = false; };
    r.start();
    recognition.value = r;
    listening.value = true;
    mode.value = 'voice';
    track('smart_input', { entity: props.entity, mode: 'voice' });
  } catch (e) {
    err.value = '无法启动语音识别：' + e.message;
  }
}

function stopVoice() {
  if (recognition.value) { try { recognition.value.stop(); } catch {} }
  listening.value = false;
}

/* ---------------------------------------------------------- 文本解析 */
async function doParse() {
  const t = text.value.trim();
  if (!t) return;
  busy.value = true; err.value = ''; status.value = '正在解析…';
  try {
    const r = await api.extractText(props.entity, t);
    if (!r.ok) { err.value = r.error || '解析失败'; return; }
    emit('fill', r.fields);
    const n = Object.keys(r.fields).filter((k) => !k.startsWith('_') && r.fields[k]).length;
    status.value = `已识别 ${n} 个字段（${r.fields._source === 'rule' ? '规则' : '模型'}）`;
    track('smart_input', { entity: props.entity, mode: 'text', fields: n });
    setTimeout(() => (status.value = ''), 2600);
  } finally {
    busy.value = false;
  }
}

/* ---------------------------------------------------------- 图片 OCR */
function pickImage() { imageInput.value && imageInput.value.click(); }

async function onImage(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { err.value = '图片不能超过 4MB'; return; }
  busy.value = true; err.value = ''; status.value = '正在识别图片…';
  try {
    const b64 = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(f);
    });
    const r = await api.extractOcr(props.entity, b64);
    if (!r.ok) { err.value = r.error; return; }
    text.value = r.text;
    emit('fill', r.fields);
    status.value = '图片已识别';
    track('smart_input', { entity: props.entity, mode: 'image' });
    setTimeout(() => (status.value = ''), 2600);
  } finally {
    busy.value = false;
  }
}

/* ---------------------------------------------------------- 附件批量 */
function pickFile() { fileInput.value && fileInput.value.click(); }

async function onFile(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;

  busy.value = true; err.value = ''; batchPreview.value = null;
  try {
    let all = [], headers = null;
    for (const f of files) {
      const t = await f.text();
      const r = await api.extractTable(t);
      if (!r.ok) { err.value = `${f.name}：${r.error}`; continue; }
      if (!headers) headers = r.headers;
      all = all.concat(r.rows.map((x) => ({ ...x, _file: f.name })));
    }
    if (!all.length) { err.value = '没有解析到可导入的数据'; return; }
    batchPreview.value = { headers, rows: all, files: files.map((f) => f.name) };
    status.value = `解析到 ${all.length} 条记录`;
    track('smart_input', { entity: props.entity, mode: 'file', rows: all.length, files: files.length });
  } catch (er) {
    err.value = '读取文件失败：' + er.message;
  } finally {
    busy.value = false;
  }
}

function confirmBatch() {
  if (!batchPreview.value) return;
  emit('batch', batchPreview.value.rows);
  batchPreview.value = null;
  status.value = '';
}

/** 直接把粘贴的表格文本解析成批量 */
async function parsePastedTable() {
  const t = text.value.trim();
  if (!t) return;
  busy.value = true; err.value = '';
  try {
    const r = await api.extractTable(t);
    if (!r.ok) { err.value = r.error; return; }
    batchPreview.value = { headers: r.headers, rows: r.rows, files: ['粘贴内容'] };
    status.value = `解析到 ${r.count} 条记录`;
  } finally { busy.value = false; }
}

const looksLikeTable = computed(() => {
  const t = text.value;
  if (!t) return false;
  const lines = t.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  return /\t/.test(t) || (t.match(/,|，/g) || []).length >= 2;
});

function reset() {
  text.value = ''; err.value = ''; status.value = ''; mode.value = '';
  batchPreview.value = null;
}
defineExpose({ reset });

onBeforeUnmount(() => { stopVoice(); });
</script>

<template>
  <div class="si">
    <!-- 工具条 -->
    <div class="si-bar">
      <span class="si-label">智能录入</span>
      <button class="sib" :class="{ on: mode === 'voice' && listening }" :disabled="busy"
              @click="listening ? stopVoice() : startVoice()">
        <span class="ico">🎙</span>{{ listening ? '停止' : '语音' }}
      </button>
      <button class="sib" :disabled="busy" @click="pickImage">
        <span class="ico">🖼</span>图片识别
      </button>
      <button class="sib" :disabled="busy" @click="pickFile">
        <span class="ico">📎</span>附件批量
      </button>
      <span class="grow" />
      <span v-if="status" class="si-status">{{ status }}</span>
      <span v-if="busy" class="si-dot" />
    </div>

    <input ref="imageInput" type="file" accept="image/*" style="display:none" @change="onImage" />
    <input ref="fileInput" type="file" multiple accept=".csv,.tsv,.txt,.md,text/*" style="display:none" @change="onFile" />

    <!-- 录音波形 -->
    <div v-if="listening" class="si-rec">
      <span class="rec-dot" />
      <span>正在聆听…（说完点「停止」，然后点「识别填入」）</span>
    </div>

    <!-- 文本框 -->
    <textarea
      v-model="text" class="si-ta" rows="3"
      :placeholder="hint || PLACEHOLDER"
      @keydown.ctrl.enter="doParse"
    />

    <div class="si-acts">
      <button class="btn btn-sm btn-primary" :disabled="busy || !text.trim()" @click="doParse">
        ✦ 识别填入
      </button>
      <button v-if="looksLikeTable" class="btn btn-sm" :disabled="busy" @click="parsePastedTable">
        按表格解析
      </button>
      <button class="btn btn-sm btn-ghost" @click="reset">清空</button>
      <span class="dim si-tip">{{ ACCEPT_HINT }}</span>
    </div>

    <div v-if="err" class="si-err">{{ err }}</div>

    <!-- 批量预览 -->
    <div v-if="batchPreview" class="si-batch fade-up">
      <div class="sb-h">
        <span>将导入 <b>{{ batchPreview.rows.length }}</b> 条（来自 {{ batchPreview.files.join('、') }}）</span>
        <div class="row gap6">
          <button class="btn btn-sm btn-accent" @click="confirmBatch">确认导入</button>
          <button class="btn btn-sm" @click="batchPreview = null">取消</button>
        </div>
      </div>
      <div class="sb-table">
        <table>
          <thead><tr><th v-for="h in batchPreview.headers.slice(0, 5)" :key="h">{{ h }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in batchPreview.rows.slice(0, 4)" :key="i">
              <td v-for="h in batchPreview.headers.slice(0, 5)" :key="h">{{ String(r[h] || '').slice(0, 16) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="batchPreview.rows.length > 4" class="dim" style="font-size:11px;padding:5px 0">
          …还有 {{ batchPreview.rows.length - 4 }} 条
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.si { border: 1px solid var(--line); border-radius: var(--r-3); padding: 10px; background: var(--surface-2); }
.si-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.si-label { font-size: 11.5px; color: var(--ink-3); margin-right: 2px; }
.sib {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 10px; font-size: 11.5px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--surface); color: var(--ink-2); transition: all .16s var(--ease);
}
.sib:hover:not(:disabled) { border-color: var(--accent-line); color: var(--accent); }
.sib.on { background: var(--red); border-color: var(--red); color: #fff; }
.sib:disabled { opacity: .45; cursor: not-allowed; }
.ico { font-size: 12px; }
.si-status { font-size: 11px; color: var(--green); }
.si-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  animation: pulse 1s infinite;
}

.si-rec {
  display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--red);
  padding: 6px 9px; margin-bottom: 7px; background: var(--red-soft); border-radius: var(--r-2);
}
.rec-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red); animation: pulse 1s infinite; }

.si-ta {
  width: 100%; padding: 8px 10px; font-size: 12.5px; line-height: 1.65;
  border: 1px solid var(--line); border-radius: var(--r-2);
  background: var(--surface); outline: 0; color: var(--ink); resize: vertical; font-family: inherit;
}
.si-ta:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }

.si-acts { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.si-tip { font-size: 10.5px; margin-left: auto; }
.si-err {
  margin-top: 8px; padding: 7px 10px; border-radius: var(--r-2);
  background: var(--red-soft); color: var(--red); font-size: 11.5px; line-height: 1.6;
}

.si-batch {
  margin-top: 10px; padding: 10px; border-radius: var(--r-2);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.sb-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.sb-h b { color: var(--accent); }
.sb-table { overflow-x: auto; background: var(--surface); border-radius: var(--r-1); }
.sb-table table { width: 100%; border-collapse: collapse; font-size: 11px; }
.sb-table th { text-align: left; padding: 5px 8px; background: var(--bg-sunken); color: var(--ink-3); font-weight: 500; white-space: nowrap; }
.sb-table td { padding: 5px 8px; border-top: 1px solid var(--line-soft); white-space: nowrap; }
</style>
