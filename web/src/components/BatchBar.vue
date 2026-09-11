<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  count: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  actions: { type: Array, default: () => [] },   // [{key,label,danger?,options?:[{value,label}]}]
  noun: { type: String, default: '项' },
});
const emit = defineEmits(['do', 'select-all', 'clear']);

const confirmAction = ref(null);
const pickedValue = ref('');

function run(a) {
  if (a.options) {
    pickedValue.value = a.options[0].value;
    confirmAction.value = a;
    return;
  }
  if (a.danger) { confirmAction.value = a; return; }
  emit('do', { action: a.key, value: null });
  confirmAction.value = null;
}

function ok() {
  const a = confirmAction.value;
  const v = a.options ? pickedValue.value : null;
  emit('do', { action: a.key, value: v });
  confirmAction.value = null;
  pickedValue.value = '';
}

const cur = computed(() => confirmAction.value);
</script>

<template>
  <transition name="bar">
    <div v-if="count > 0" class="bbar">
      <div class="bb-left">
        <button class="bb-all" @click="emit('select-all')">
          已选 <b>{{ count }}</b> / {{ total }} {{ noun }}
        </button>
        <button class="bb-clear" @click="emit('clear')">取消选择</button>
      </div>

      <div class="bb-actions">
        <button
          v-for="a in actions" :key="a.key"
          class="btn btn-sm" :class="{ 'btn-danger': a.danger }"
          @click="run(a)"
        >{{ a.label }}</button>
      </div>

      <!-- 二次确认 -->
      <transition name="fade">
        <div v-if="cur" class="bb-confirm">
          <template v-if="cur.options">
            <span class="bc-t">选择要设置的{{ cur.label.replace('批量', '') }}：</span>
            <select v-model="pickedValue" class="bc-sel">
              <option v-for="o in cur.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </template>
          <template v-else>
            <span class="bc-t danger">确认{{ cur.label }} <b>{{ count }}</b> {{ noun }}？此操作不可撤销。</span>
          </template>
          <button class="btn btn-sm btn-primary" @click="ok">确认</button>
          <button class="btn btn-sm" @click="confirmAction = null">取消</button>
        </div>
      </transition>
    </div>
  </transition>
</template>

<style scoped>
.bbar {
  position: relative; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin: 0 20px 10px; padding: 8px 12px;
  background: var(--ink); color: #fff; border-radius: var(--r-3);
  box-shadow: var(--sh-3);
}
.bb-left { display: flex; align-items: center; gap: 10px; }
.bb-all { border: 0; background: transparent; color: #fff; font-size: 12.5px; }
.bb-all b { color: #FFD9A0; font-weight: 700; }
.bb-clear {
  border: 1px solid rgba(255,255,255,.22); background: transparent; color: rgba(255,255,255,.72);
  border-radius: var(--r-pill); padding: 3px 10px; font-size: 11px;
}
.bb-clear:hover { border-color: rgba(255,255,255,.4); color: #fff; }
.bb-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.bb-actions .btn {
  background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.18); color: #fff;
}
.bb-actions .btn:hover { background: rgba(255,255,255,.18); }
.bb-actions .btn-danger { background: rgba(179,58,43,.85); border-color: rgba(179,58,43,1); }
.bb-actions .btn-danger:hover { background: var(--red); }

.bb-confirm {
  position: absolute; inset: 0; background: var(--ink);
  border-radius: var(--r-3); display: flex; align-items: center;
  gap: 10px; padding: 0 14px; z-index: 5;
}
.bc-t { font-size: 12.5px; flex: 1; }
.bc-t.danger { color: #FFC9C0; }
.bc-t b { color: #FFD9A0; }
.bc-sel {
  height: 26px; border-radius: var(--r-1); border: 1px solid rgba(255,255,255,.22);
  background: rgba(255,255,255,.1); color: #fff; font-size: 12px; padding: 0 8px;
}
.bc-sel option { color: #000; }

.bar-enter-active, .bar-leave-active { transition: opacity .18s, transform .18s; }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(-6px); }
.fade-enter-active, .fade-leave-active { transition: opacity .14s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
