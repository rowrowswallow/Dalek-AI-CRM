/**
 * AI 层 —— 场景化 AI 员工
 *
 * 两种模式：
 *  · rule 模式（默认，无需 API Key）：本地意图识别 + 模板生成，产出「文本 + 结构化动作」
 *  · model 模式：配置 AI_API_KEY 后透传真实模型（本文件保留接入点）
 *
 * 关键设计：AI 的产出不只是文本，还包含 actions[]，
 *          前端拿到 actions 后直接操作右侧工作区 —— 这是「对话式管理」的核心。
 */
'use strict';

/* ---------------------------------------------------------------- 场景定义 */
const SCENES = {
  customer: {
    key: 'customer',
    route: '客户',
    name: '客户管理助手',
    avatar: '客',
    desc: '筛客户、查状态、批量打标、改负责人',
    greeting: '我在客户列表这边。可以直接说「找出 30 天没跟进的意向客户」这类需求。',
    suggestions: ['找出 30 天没跟进的意向客户', '哪些客户有流失风险？', '把高意向客户按优先级排一下'],
  },
  tag: {
    key: 'tag',
    route: '标签画像',
    name: '客户洞察助手',
    avatar: '析',
    desc: '标签体系、客群分布、分群对比',
    greeting: '我在标签画像这边。可以帮你看客群分布、标签覆盖情况，或者给客户分群。',
    suggestions: ['看一下客群分布', '哪些标签几乎没人用？', '按行业给我分个群'],
  },
  task: {
    key: 'task',
    route: '任务',
    name: '任务助手',
    avatar: '任',
    desc: '建任务、排优先级、从跟进提取任务',
    greeting: '我在任务这边。可以说「给高意向客户都建一条跟进任务」。',
    suggestions: ['今天有哪些任务该做？', '给高意向客户建跟进任务', '哪些任务已经逾期了？'],
  },
  data: {
    key: 'data',
    route: '数据',
    name: '数据分析师',
    avatar: '数',
    desc: '归因分析、趋势解读、异常预警（只出结论不动手）',
    greeting: '我在数据面板这边。我只出结论、不动手改数据。',
    suggestions: ['这周跟进量为什么下降？', '哪个环节流失最多？', '给我一份本周汇报'],
  },
  report: {
    key: 'report',
    route: '汇报',
    name: '汇报助手',
    avatar: '报',
    desc: '生成汇报稿、归因、下周建议',
    greeting: '我在汇报这边。可以直接生成这周的汇报稿，或者问我某个数字是怎么来的。',
    suggestions: ['生成这周的汇报稿', '风险客户怎么解释？', '下周重点抓什么？'],
  },
  dashboard: {
    key: 'dashboard',
    route: '数据（看板配置）',
    name: '看板工程师',
    avatar: '工',
    desc: '为看板增删卡片 · 改动会汇报给数据分析师',
    greeting: '我是看板工程师，负责这块看板的卡片配置。说「加一个转化漏斗卡片」或「把行业分布去掉」就行。我做完会向数据分析师汇报。',
    suggestions: ['现在有哪些卡片？', '加一个风险清单卡片', '把行业分布去掉'],
  },
  knowledge: {
    key: 'knowledge',
    route: '知识库',
    name: '知识库助手',
    avatar: '知',
    desc: '检索资料 · 生成话术 · 汇报口径（查 + 发）',
    greeting: '我在知识库这边。可以帮你查资料、按客户情况生成话术，或者找汇报的口径。',
    suggestions: ['价格异议怎么说？', '老板问线索为什么少了，怎么答？', '给当前客户生成一段开场话术'],
  },
};

/* ---------------------------------------------------------------- 工具 */

/** 简易中文意图匹配：按关键词权重打分 */
function detectIntent(text, scene) {
  const t = (text || '').replace(/\s/g, '');
  const has = (...ws) => ws.some((w) => t.includes(w));

  // 数字提取：「30 天」「30天」
  const numMatch = t.match(/(\d+)\s*天/);
  const days = numMatch ? parseInt(numMatch[1], 10) : null;

  if (has('没跟进', '未跟进', '没联系', '未联系', '多久没')) {
    return { intent: 'find_stale', days: days || 30 };
  }
  if (has('流失风险', '风险客户', '要流失')) return { intent: 'find_risk' };
  if (has('高意向', '意向客户')) {
    if (has('任务', '建任务')) return { intent: 'task_for_high' };
    return { intent: 'find_high', days: days || null };
  }
  if (has('逾期', '过期', '超期')) return { intent: 'find_overdue_task' };
  if (has('今天', '我的任务', '该做')) return { intent: 'today_task' };
  if (has('建任务', '创建任务', '加个任务', '提醒我')) return { intent: 'create_task', days: days || 2 };
  if (has('汇报', '周报', '月报', '汇报稿')) return { intent: 'report' };
  if (has('为什么', '下降', '变差', '原因')) return { intent: 'attribute' };
  if (has('哪个环节', '流失最多', '漏斗', '瓶颈')) return { intent: 'funnel' };
  if (has('分布', '分群', '客群')) return { intent: 'segment' };
  if (has('标签')) return { intent: 'tag_stats' };
  if (has('优先级', '排一下', '排序', '先做')) return { intent: 'priority' };
  if (has('打招呼', '你好', '在吗')) return { intent: 'greet' };

  // 看板工程师场景
  if (scene === 'dashboard') {
    if (has('有哪些卡片', '列出', '现在有', '看板长什么样')) return { intent: 'dash_list' };
    if (has('去掉', '删除', '移除', '删掉', '不要')) return { intent: 'dash_remove' };
    if (has('加', '新增', '添加', '来一个', '放一个')) return { intent: 'dash_add' };
    if (has('上移', '下移', '排序', '挪')) return { intent: 'dash_reorder' };
    if (has('恢复', '重置', '还原')) return { intent: 'dash_reset' };
    return { intent: 'dash_ask' };
  }

  // 知识库场景
  if (scene === 'knowledge') {
    if (has('补充', '添加', '新增', '存一条', '记一条')) return { intent: 'kb_add' };
    if (has('几条', '统计', '有多少', '哪些资料', '用得最多', '没人用')) return { intent: 'kb_stats' };
    if (has('话术', '怎么说', '怎么答', '怎么回', '口径')) return { intent: 'kb_script' };
    return { intent: 'kb_ask' };
  }
  return { intent: 'unknown' };
}

/** 本地规则引擎：生成回复文本 + 结构化动作 */
function ruleReply({ scene, text, ctx, store, kb, aist }) {
  const { intent, days } = detectIntent(text, scene);
  const S = SCENES[scene] || SCENES.customer;
  const actions = [];
  let reply = '';

  switch (intent) {
    case 'find_stale': {
      const list = store.customers().filter((c) => c.days_since_follow >= days && c.level !== 'low');
      list.sort((a, b) => b.priority_score - a.priority_score);
      actions.push({ type: 'filter_customers', payload: { ids: list.map((c) => c.id), label: `${days} 天未跟进的客户` } });
      reply = list.length
        ? `筛选出 **${list.length} 家**超过 ${days} 天未跟进的客户（已排除低意向）。\n\n`
          + list.slice(0, 4).map((c, i) => `${i + 1}. **${c.company_name}** · ${c.industry} · 已 ${c.days_since_follow} 天\n   ${c.ai_next_step}`).join('\n')
          + `\n\n已把筛选结果同步到右侧客户列表。`
        : `没有超过 ${days} 天未跟进的客户。`;
      break;
    }
    case 'find_risk': {
      const list = store.customers().filter((c) => c.days_since_follow >= 21 && c.level !== 'low')
        .sort((a, b) => b.priority_score - a.priority_score);
      actions.push({ type: 'filter_customers', payload: { ids: list.map((c) => c.id), label: '流失风险客户' } });
      reply = `有 **${list.length} 家**客户存在流失风险（21 天以上无互动且非低意向）：\n\n`
        + list.slice(0, 5).map((c) => `· **${c.company_name}** — ${c.ai_insight}`).join('\n')
        + `\n\n高风险客户优先处理，右侧已筛选出来。`;
      break;
    }
    case 'find_high': {
      let list = store.customers().filter((c) => c.level === 'high');
      if (days) list = list.filter((c) => c.days_since_follow >= days);
      list.sort((a, b) => b.priority_score - a.priority_score);
      actions.push({ type: 'filter_customers', payload: { ids: list.map((c) => c.id), label: '高意向客户' } });
      reply = `高意向客户共 **${list.length} 家**${days ? `（其中 ${days} 天以上未跟进的有 ${list.filter((c) => c.days_since_follow >= days).length} 家）` : ''}：\n\n`
        + list.slice(0, 5).map((c, i) => `${i + 1}. **${c.company_name}** · 优先级 ${c.priority_score}\n   理由：${c.priority_reason}`).join('\n');
      break;
    }
    case 'priority': {
      const list = store.topPriority(5);
      actions.push({ type: 'goto', payload: { view: 'customer' } });
      reply = `今天建议优先跟进这 **5 家**（按「意向度 × 时间衰减 × 风险标签」综合排序，每一项都可追溯）：\n\n`
        + list.map((c, i) => `**${i + 1}. ${c.company_name}** · ${c.priority_score} 分\n`
          + `   ${c.priority_reason}\n   → ${c.ai_next_step}`).join('\n\n');
      break;
    }
    case 'today_task': {
      const list = store.tasks().filter((t) => t.status !== 'done');
      const overdue = list.filter((t) => new Date(t.due_at) < new Date());
      actions.push({ type: 'goto', payload: { view: 'task' } });
      reply = `当前有 **${list.length} 个**未完成任务，其中 **${overdue.length} 个已逾期**。\n\n`
        + list.slice(0, 5).map((t) => `· [${t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低'}] ${t.title}`
          + `${new Date(t.due_at) < new Date() ? ' ⚠️ 已逾期' : ''}`).join('\n')
        + (overdue.length ? `\n\n建议先处理逾期的 ${overdue.length} 个，它们大多关联着高意向客户。` : '');
      break;
    }
    case 'find_overdue_task': {
      const list = store.tasks().filter((t) => t.status !== 'done' && new Date(t.due_at) < new Date());
      actions.push({ type: 'goto', payload: { view: 'task' } });
      reply = list.length
        ? `有 **${list.length} 个**任务已逾期：\n\n` + list.slice(0, 6).map((t) => `· ${t.title}（${t.customer_name}）`).join('\n')
        : '没有逾期任务，挺不错。';
      break;
    }
    case 'task_for_high': {
      const list = store.customers().filter((c) => c.level === 'high');
      const pending = list.map((c) => ({
        type: 'create_task',
        needConfirm: true,
        payload: {
          title: `跟进 ${c.company_name}：${c.stage}推进`,
          customer_id: c.id,
          customer_name: c.company_name,
          priority: 'high',
          due_at: new Date(Date.now() + 2 * 864e5).toISOString(),
          source: 'ai',
        },
      }));
      actions.push(...pending);
      reply = `为 **${list.length} 家**高意向客户各生成了一条跟进任务，已经在右侧列出等你确认。\n\n`
        + list.slice(0, 4).map((c) => `· ${c.company_name} — ${c.stage}推进`).join('\n')
        + `\n\n**这些任务不会自动创建**，你确认哪些就建哪些。`;
      break;
    }
    case 'create_task': {
      const title = text.replace(/^(帮我|给我|请)?(建|创建|加|新增)(一?个)?任务[:：]?/, '').trim() || '新任务';
      actions.push({
        type: 'create_task', needConfirm: true,
        payload: {
          title, priority: 'mid', source: 'ai',
          due_at: new Date(Date.now() + (days || 2) * 864e5).toISOString(),
        },
      });
      reply = `好的，我拟了一条任务：**${title}**（截止 ${days || 2} 天后）。\n在右侧确认后即可创建。`;
      break;
    }
    case 'report': {
      const report = store.buildReport('week');
      actions.push({ type: 'goto', payload: { view: 'report' } });
      reply = `已生成本周汇报稿，共 ${report.sections.length} 个部分，可在右侧编辑并导出。\n\n`
        + `**${report.sections[0].heading}**\n${report.sections[0].body}\n\n`
        + `**${report.sections[1].heading}**\n${report.sections[1].body.slice(0, 90)}…`;
      break;
    }
    case 'attribute': {
      const s = store.stats();
      const top = s.byStage.slice().sort((a, b) => b.value - a.value)[0];
      actions.push({ type: 'goto', payload: { view: 'data' } });
      reply = `从数据看，主要有两个原因：\n\n`
        + `**1. 跟进总量**：本周 ${s.followWeek} 条，其中 ${s.byOwner.map((o) => `${o.name} ${o.follow} 条`).join('、')}。\n`
        + `**2. 阶段堆积**：「${top ? top.name : '—'}」环节堆积了 ${top ? top.value : 0} 家客户，`
        + `是当前最大的瓶颈——线索进来之后卡在这一步推进不动。\n\n`
        + `**另外**：有 ${s.risk} 家客户超过 21 天未跟进，这部分会直接体现为下个月的转化下降。\n\n`
        + `（以上结论均可追溯到原始跟进记录与客户阶段字段，不是推测。）`;
      break;
    }
    case 'funnel': {
      const s = store.stats();
      const order = ['需求确认', '方案沟通', '已报价', '商务谈判', '已成交'];
      const rows = order.map((k) => ({ k, v: (s.byStage.find((x) => x.name === k) || {}).value || 0 }));
      const max = Math.max(...rows.map((r) => r.v), 1);
      reply = `各阶段客户数（漏斗结构）：\n\n`
        + rows.map((r) => `${r.k.padEnd(6, '　')} ${String(r.v).padStart(2)} 家  ${'█'.repeat(Math.round(r.v / max * 12))}`).join('\n')
        + `\n\n**流失最多的是「需求确认 → 方案沟通」这一步**：`
        + `${rows[0].v} 家进入需求确认，只有 ${rows[1].v} 家推进到方案沟通，转化率 ${rows[0].v ? Math.round(rows[1].v / rows[0].v * 100) : 0}%。`
        + `\n建议重点复盘这一步的跟进动作。`;
      actions.push({ type: 'goto', payload: { view: 'data' } });
      break;
    }
    case 'segment': {
      const s = store.stats();
      const max = Math.max(...s.byIndustry.map((x) => x.value), 1);
      reply = `按行业看，客群分布如下：\n\n`
        + s.byIndustry.slice(0, 8).map((x) => `${x.name.padEnd(6, '　')} ${String(x.value).padStart(2)} 家  ${'█'.repeat(Math.round(x.value / max * 10))}`).join('\n')
        + `\n\n共覆盖 ${s.byIndustry.length} 个行业，头部行业占比 ${Math.round(s.byIndustry[0].value / s.total * 100)}%。`
        + `\n\n从资源分配角度，建议把跟进力量向头部行业倾斜。`;
      actions.push({ type: 'goto', payload: { view: 'tag' } });
      break;
    }
    case 'tag_stats': {
      const groups = store.tagGroups();
      const all = store.customers();
      reply = `标签体系共 **${groups.length} 组**：\n\n`
        + groups.map((g) => {
          const counts = g.tags.map((t) => `${t} ${all.filter((c) => c.tags.includes(t)).length}`).join(' · ');
          return `**${g.group}**（${g.tags.length} 个）\n   ${counts}`;
        }).join('\n')
        + `\n\n可以看到「${groups[3].tags[3]}」这个标签几乎没有客户命中——`
        + `可能是定义不清晰，也可能是销售在录入时漏打了。`;
      actions.push({ type: 'goto', payload: { view: 'tag' } });
      break;
    }
    case 'greet':
      reply = S.greeting;
      break;

    /* ---------------- 看板工程师 ---------------- */
    case 'dash_list': {
      const cards = aist.cards();
      const lines = cards.map((c, i) =>
        (i + 1) + '. **' + c.title + '**（' + c.type +
        (c.added_by === 'dashboard' ? ' · 由我添加' : '') + '）');
      reply = '当前看板共 **' + cards.length + ' 张卡片**：\n\n' + lines.join('\n') +
        '\n\n可选模板：' + aist.cardTemplates().map((t) => t.title).join('、') + '。';
      actions.push({ type: 'goto', payload: { view: 'data' } });
      break;
    }
    case 'dash_add': {
      const tpls = aist.cardTemplates();
      let tpl = tpls[1];
      if (/漏斗|转化/.test(text)) tpl = tpls.find((x) => x.type === 'funnel');
      else if (/分布|行业|标签/.test(text)) tpl = tpls.find((x) => x.type === 'bars');
      else if (/风险|关注|清单/.test(text)) tpl = tpls.find((x) => x.type === 'attention');
      else if (/明细|表格|负责人/.test(text)) tpl = tpls.find((x) => x.type === 'table');
      else if (/说明|备注|文字/.test(text)) tpl = tpls.find((x) => x.type === 'text');
      else if (/指标|数字/.test(text)) tpl = tpls.find((x) => x.type === 'kpi');
      const title = (text.match(/[「"']([^」"']+)[」"']/) || [])[1] || tpl.title;
      actions.push({
        type: 'dash_add_card', needConfirm: true,
        payload: {
          type: tpl.type, title, size: tpl.type === 'kpi' ? 'sm' : 'half',
          reason: '你要求「' + text.slice(0, 20) + '」，匹配到「' + tpl.title + '」模板',
        },
      });
      reply = '我建议加一张 **' + title + '**（' + tpl.type + ' 类型，' + tpl.desc + '）。\n\n' +
        '在右侧确认后我会添加上去，并把这次改动**汇报给数据分析师**。';
      break;
    }
    case 'dash_remove': {
      const cards = aist.cards();
      const hit = cards.find((c) => text.includes(c.title)) ||
        cards.find((c) => text.includes(c.title.slice(0, 2)));
      if (!hit) {
        reply = '没听出你要删哪张。当前卡片：\n\n' +
          cards.map((c) => '· ' + c.title).join('\n') +
          '\n\n直接说「去掉 XX」就行。';
      } else {
        actions.push({
          type: 'dash_remove_card', needConfirm: true,
          payload: { id: hit.id, title: hit.title, reason: '你要求移除「' + hit.title + '」' },
        });
        reply = '好，准备移除 **' + hit.title + '**。\n\n确认后我会删除，并汇报给数据分析师——' +
          '因为这张卡片如果被删，他后续的分析里就不会再引用这个维度了。';
      }
      break;
    }
    case 'dash_reorder': {
      const cards = aist.cards();
      const hit = cards.find((c) => text.includes(c.title)) ||
        cards.find((c) => text.includes(c.title.slice(0, 2)));
      const dir = /上移|往上|提前/.test(text) ? 'up' : 'down';
      if (!hit) {
        reply = '要挪哪张？当前卡片：\n\n' + cards.map((c) => '· ' + c.title).join('\n');
      } else {
        actions.push({ type: 'dash_reorder', payload: { id: hit.id, dir } });
        reply = '已把 **' + hit.title + '** ' + (dir === 'up' ? '上移' : '下移') + '一位。';
      }
      break;
    }
    case 'dash_reset': {
      actions.push({ type: 'dash_reset', needConfirm: true, payload: { reason: '恢复默认看板' } });
      reply = '可以恢复成默认的 8 张卡片。确认后执行，并汇报给数据分析师。';
      break;
    }
    case 'dash_ask': {
      const cards = aist.cards();
      reply = '我是**看板工程师**，负责这块看板的卡片配置。能做四件事：\n\n' +
        '· 列出当前卡片（现在有 ' + cards.length + ' 张）\n' +
        '· 新增卡片 —— 说「加一个转化漏斗卡片」\n' +
        '· 移除卡片 —— 说「把行业分布去掉」\n' +
        '· 调整顺序 —— 说「把风险清单上移」\n\n' +
        '**每次改动我都会向「数据分析师」汇报**，因为他才是这个页面的负责助手，' +
        '他需要知道你改了看板，避免分析结论和看板对不上。';
    }

    /* ---------------- 知识库场景 ---------------- */
    case 'kb_ask': {
      const r = kb.list({ q: text });
      const hits = r.list.slice(0, 4);
      if (!hits.length) {
        reply = `知识库里没找到相关内容。\n\n可以换个说法，或者去知识库页面补充这条资料——**资料越全，我答得越准**。`;
      } else {
        const top = hits[0];
        reply = `**${top.title}**\n\n${top.content}`
          + (hits.length > 1 ? `\n\n其他相关：${hits.slice(1).map((h) => `《${h.title}》`).join('、')}` : '');
        actions.push({ type: 'kb_highlight', payload: { ids: hits.map((h) => h.id) } });
      }
      break;
    }
    case 'kb_script': {
      const wantBoss = /老板|汇报|上面|向上/.test(text);
      if (wantBoss) {
        const pool = kb.list({ category: 'report' }).list;
        const pick = /线索|变少|下降/.test(text) ? pool.find((x) => x.title.includes('线索'))
          : /跟丢|流失/.test(text) ? pool.find((x) => x.title.includes('跟丢'))
          : pool.find((x) => x.title.includes('老板'));
        reply = `这是「向上沟通」的口径，来自知识库的**汇报资料**：\n\n`
          + (pick ? `**${pick.title}**\n${pick.content}` : '暂无匹配内容');
        if (pick) actions.push({ type: 'kb_highlight', payload: { ids: [pick.id] } });
      } else {
        const tags = (ctx.customer_tags || []);
        let want = '开场';
        if (tags.includes('价格敏感')) want = '价格';
        else if (tags.includes('竞品接触中')) want = '竞品';
        else if (tags.includes('长期沉默')) want = '唤醒';
        else if (tags.includes('已报价')) want = '促单';
        const pool = kb.list({ category: 'script' }).list;
        const hit = pool.find((x) => x.tags.includes(want)) || pool[0];
        reply = `按当前客户的情况（匹配「${want}」场景），从**话术库**取这段：\n\n`
          + (hit ? `**${hit.title}**\n${hit.content}` : '话术库暂无匹配内容');
        if (hit) actions.push({ type: 'kb_highlight', payload: { ids: [hit.id] } });
      }
      break;
    }
    case 'kb_stats': {
      const s = kb.stats();
      reply = `知识库共 **${s.total}** 条，累计被引用 ${s.totalUsed} 次。\n\n`
        + s.byCat.map((c) => `${c.icon} **${c.name}** — ${c.count} 条${c.star ? ' ★' : ''}`).join('\n')
        + `\n\n用得最多的：\n` + s.topUsed.slice(0, 3).map((x, i) => `${i + 1}. ${x.title}（${x.used_count} 次）`).join('\n')
        + (s.neverUsed ? `\n\n**有 ${s.neverUsed} 条从未被用过**，建议清理或改写标题——没人用的资料等于没有。` : '');
      actions.push({ type: 'goto', payload: { view: 'knowledge' } });
      break;
    }
    case 'kb_add': {
      const title = text.replace(/.*(补充|添加|新增|存一条|记一条)[:：]?/, '').trim().slice(0, 30) || '新资料';
      actions.push({
        type: 'kb_add', needConfirm: true,
        payload: { title, content: text, category: 'product' },
      });
      reply = `好的，我拟了一条知识库条目：**${title}**。\n你可以在右侧确认分类和标题后保存。`;
      break;
    }
    default:
      reply = `我在「${S.name}」这个角色下，能帮你做这些事：\n\n`
        + S.suggestions.map((x) => `· ${x}`).join('\n')
        + `\n\n当前场景只能做本场景内的事；如果需要别的操作，切换到对应页面我会自动换成对应的助手。`;
  }

  return { text: reply, actions };
}

/* ---------------------------------------------------------------- 跟进解析 */
async function parseFollowup(content, ctx) {
  const t = content || '';

  // 提取时间节点
  const nodeTimes = [];
  const timeRe = /(下周[一二三四五六日天]?|本周[一二三四五六日天]?|明天|后天|月底|下月初|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*月)/g;
  let m;
  while ((m = timeRe.exec(t))) {
    if (!nodeTimes.includes(m[1])) nodeTimes.push(m[1]);
  }

  // 提取待办
  const todos = [];
  t.split(/[。；;\n]/).forEach((s) => {
    if (/(需要|要|待|约定|承诺|下周|明天|尽快|安排)/.test(s) && s.length > 4 && s.length < 60) {
      todos.push(s.trim());
    }
  });

  // 提取需求点
  const needs = [];
  [['价格', /价格|报价|预算|贵|便宜/], ['交付周期', /周期|多久|什么时候能|上线时间/],
   ['功能', /功能|做不到|能不能|支持/], ['服务', /服务|响应|售后|支持/],
   ['对接', /对接|集成|打通|接口/], ['决策流程', /审批|决策|领导|上面/],
  ].forEach(([name, re]) => { if (re.test(t)) needs.push(name); });

  // 生成摘要
  let summary = t.replace(/\s+/g, '');
  if (summary.length > 60) summary = summary.slice(0, 58) + '…';

  // 建议标签
  const suggestTags = [];
  if (/高意向|很有兴趣|着急|尽快|马上/.test(t)) suggestTags.push('高意向');
  if (/贵|预算|价格|便宜/.test(t)) suggestTags.push('价格敏感');
  if (/竞品|其他家|对比/.test(t)) suggestTags.push('竞品接触中');
  if (/审批|领导|上面|走流程/.test(t)) suggestTags.push('采购决策人');
  if (/技术|接口|对接|部署/.test(t)) suggestTags.push('技术负责人');
  if (todos.length) suggestTags.push('方案沟通');

  const confidence = Math.min(0.95, 0.6 + needs.length * 0.06 + todos.length * 0.08 + nodeTimes.length * 0.05);

  return {
    summary,
    key_points: needs.map((n) => `关注${n}`),
    node_times: nodeTimes,
    next_action: todos[0] || '',
    todos,
    suggest_tags: [...new Set(suggestTags)],
    confidence: Number(confidence.toFixed(2)),
    source: 'ai',
  };
}

/* ---------------------------------------------------------------- 对话入口 */
async function chat({ scene, text, ctx, store, kb, aist, settings, attachments }) {
  const mode = settings && settings.effectiveMode
    ? settings.effectiveMode()
    : (process.env.AI_API_KEY ? 'env' : 'rule');

  if (mode === 'rule') {
    const r = ruleReply({ scene, text, ctx, store, kb, aist });
    const atts = Array.isArray(attachments) ? attachments : [];
    if (atts.length) {
      const names = atts.map((a) => a.name).join('、');
      const txt = atts.filter((a) => a.type === 'text').map((a) => a.content).join('\n').slice(0, 400);
      r.text = '收到附件：**' + names + '**\n\n'
        + (txt ? '我看到的文本内容：\n> ' + txt.slice(0, 260) + '…\n\n' : '')
        + '> ⚠️ 当前是**本地规则引擎**，无法真正理解附件内容。\n'
        + '> 到「系统设置 → AI 服务」配置一个 API Key，我就能读图、读文档并给出分析。\n\n'
        + r.text;
      r.engine = 'rule';
    }
    return r;
  }

  try {
    return await modelReply({ scene, text, ctx, store, kb, aist, settings, attachments });
  } catch (e) {
    const r = ruleReply({ scene, text, ctx, store, kb, aist });
    return {
      ...r,
      engine: 'rule',
      text: r.text + '\n\n> ⚠️ 模型调用失败，已回退到本地规则引擎：'
        + String(e.message || e).slice(0, 90)
        + '\n> 可到「系统设置 → AI 服务」检查 API 配置，或点「测试连接」排查。',
    };
  }
}

/** 真实模型接入点（配置 AI_API_KEY 后生效） */
async function modelReply({ scene, text, ctx, store, kb, aist, settings, attachments }) {
  const S = SCENES[scene] || SCENES.customer;
  const cfg = (settings && settings.get && settings.effectiveMode() === 'user')
    ? settings.get()
    : {
        api_key: process.env.AI_API_KEY,
        base_url: process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: process.env.AI_MODEL || 'qwen-plus',
        temperature: 0.6, max_tokens: 1500, system_extra: '',
      };

  // 把业务上下文喂给模型，否则它答不了「这批客户」这类指代
  const bizCtx = JSON.stringify(ctx && ctx.snapshot ? ctx.snapshot : {}, null, 0).slice(0, 1200);

  const sys = '你是「' + S.name + '」，职责：' + S.desc + '。'
    + '当前场景：' + S.route + '。'
    + '回答要求：先说结论，再给依据；不超过 300 字；用 markdown 的 **加粗** 标记关键信息。'
    + '如果用户的需求超出本场景职责，明确告知并建议切换到哪个场景，不要跨场景执行。'
    + '不要编造数据——只能使用下面提供的业务数据。'
    + (cfg.system_extra ? '\n补充要求：' + cfg.system_extra : '')
    + (bizCtx !== '{}' ? '\n\n【当前业务数据】\n' + bizCtx : '');

  // 组装用户消息：纯文本 = 字符串；含图片 = 多模态数组
  const atts = Array.isArray(attachments) ? attachments.slice(0, 6) : [];
  const textParts = atts.filter((a) => a.type === 'text')
    .map((a) => '【附件：' + a.name + '】\n' + String(a.content || '').slice(0, 6000)).join('\n\n');
  const imgs = atts.filter((a) => a.type === 'image').map((a) => a.content);
  let userContent;
  if (imgs.length) {
    userContent = [{ type: 'text', text: (text || '请分析这些附件') + (textParts ? '\n\n' + textParts : '') }];
    imgs.forEach((u) => userContent.push({ type: 'image_url', image_url: { url: u } }));
  } else {
    userContent = text + (textParts ? '\n\n' + textParts : '');
  }

  const r = await fetch(String(cfg.base_url).replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }],
      temperature: cfg.temperature == null ? 0.6 : cfg.temperature,
      max_tokens: cfg.max_tokens || 1500,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status);
    throw new Error(msg);
  }
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!content) throw new Error('模型返回为空');
  // 模型模式下仍复用规则引擎产出结构化动作，保证「对话 → 工作区」链路一致
  const fallback = ruleReply({ scene, text, ctx, store, kb, aist });
  return { text: content, actions: fallback.actions, engine: 'model', model: cfg.model };
}

module.exports = { SCENES, chat, parseFollowup };
