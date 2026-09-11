/** 知识库演示数据（从 knowledge.js 抽出，供 db.js 首次灌数） */
'use strict';

module.exports = [
  /* 产品文档 */
  { category: 'product', title: '产品功能总览', type: 'file', file_type: 'PDF', used_count: 18, tags: ['产品', '对外'],
    content: '覆盖客户管理、跟进记录、标签画像、任务协同、数据看板、一键汇报六大模块。支持与主流 CRM 数据互通。' },
  { category: 'product', title: '报价体系说明', type: 'file', file_type: 'XLSX', used_count: 31, tags: ['价格', '对外'],
    content: '标准版按坐席数计费，年付。实施费一次性收取。支持私有化部署单独报价。三年期合同可享折扣。' },
  { category: 'product', title: '实施流程与周期', used_count: 12, tags: ['交付', '对外'],
    content: '标准实施分四步：需求确认（1 周）→ 数据迁移（1-2 周）→ 用户培训（3 天）→ 试运行（2 周）。整体约 4-6 周。' },
  { category: 'product', title: '数据安全与合规说明', type: 'file', file_type: 'PDF', used_count: 7, tags: ['安全', '对外'],
    content: '数据传输全程加密，支持私有化部署。已通过等保三级。客户数据可导出，支持一键清空。' },

  /* 方案资料 */
  { category: 'solution', title: '企业服务行业解决方案', type: 'file', file_type: 'PDF', used_count: 9, tags: ['行业方案'],
    content: '针对 B2B 企业服务的销售流程特点，重点解决线索多、跟进散、转化难追溯的问题。已服务 120+ 家同行业客户。' },
  { category: 'solution', title: '与竞品的差异化对比', type: 'file', file_type: 'PDF', used_count: 14, tags: ['竞品', '异议处理'],
    content: '相比通用 CRM，我们更聚焦销售负责人的决策与汇报场景；相比对话式工具，我们提供可追溯的归因结论。' },
  { category: 'solution', title: '客户成功案例：某连锁零售品牌', type: 'card', used_count: 16, tags: ['案例', '促单'],
    content: '上线 3 个月后，销售周报制作时间从平均 4 小时降至 20 分钟，客户跟进覆盖率从 62% 提升到 91%。' },

  /* 话术库 */
  { category: 'script', title: '开场破冰话术', used_count: 42, tags: ['开场'],
    content: '您好，我是 XX 的小李。看到您在关注销售管理这块，我们最近帮几家同行业的公司做了跟进流程的梳理，想跟您交流一下他们的做法，不知道您这边现在是怎么管的？' },
  { category: 'script', title: '价格异议处理', used_count: 27, tags: ['异议处理', '价格'],
    content: '理解您对成本的关注。我们的计费是按实际使用的坐席数来的，您可以先上一个小组试用。按您现在的团队规模算，折算到每天每人不到一杯咖啡的成本，但省下来的是销售每周 4 小时的报表时间。' },
  { category: 'script', title: '竞品对比话术', used_count: 21, tags: ['异议处理', '竞品'],
    content: '您提到的产品我们也了解。区别主要在于：他们更偏重记录客户信息，我们更偏重帮您判断该跟谁、以及怎么向上汇报。如果您的痛点主要是「团队跟不过来」，那我们的匹配度会更高一些。' },
  { category: 'script', title: '促单话术：下一步推进', used_count: 19, tags: ['促单'],
    content: '既然方案方向没问题，我建议我们先做一个小范围试点。您选 5 个销售，我们用两周把流程跑通，您看效果再决定要不要全员推广。我这边下周一可以先把试点方案发您。' },
  { category: 'script', title: '长期沉默客户唤醒', used_count: 11, tags: ['唤醒', '沉默客户'],
    content: '张总您好，好久没联系了。上次聊到您在关注团队跟进效率这块，不知道现在进展怎么样？我们最近上线了一个新功能，可以直接从聊天记录里自动整理跟进，想着可能对您有用，就发您看看。' },

  /* 汇报资料 ★ 竞品都没有 */
  { category: 'report', title: '周报模板（标准结构）', used_count: 24, tags: ['模板'],
    content: '一、整体情况：新增/累计跟进、在管客户数、高意向数、任务完成率。\n二、需要关注的问题：风险客户、阶段堆积、跟进量分布。\n三、下周计划：优先级最高的三件事 + 需要的支持。' },
  { category: 'report', title: '老板最关心的 5 个问题', used_count: 33, tags: ['要点', '向上沟通'],
    content: '① 这个月能签多少？（不是跟进了多少）② 线索转化率有没有提升？③ 团队里谁的表现最好、谁需要帮助？④ 钱花在哪了、ROI 是多少？⑤ 下个月的增长点在哪？\n\n——汇报时主动回答这五个，比罗列动作有效得多。' },
  { category: 'report', title: '如何解释「线索变少了」', used_count: 15, tags: ['归因', '向上沟通'],
    content: '不要只说「线索少了」。要拆成三层：\n① 哪个渠道少了（对比上期数据）\n② 是投放量下降还是转化率下降（区分开）\n③ 我们已经做了什么补救（具体动作 + 预期效果）\n\n结论先行：本月线索环比下降 X%，主因是 A 渠道投放缩减；我们已把预算向 B 渠道倾斜，预计下月回升至 Y 水平。' },
  { category: 'report', title: '如何解释「客户跟丢了」', used_count: 9, tags: ['归因', '向上沟通'],
    content: '把「跟丢」定义清楚：超过 21 天无互动的非低意向客户。\n然后给出分层：其中高意向 X 家、中意向 Y 家。\n最后给动作：已按优先级排入下周跟进计划，Top 5 由我本人负责。\n\n关键是不要把「跟丢」说成意外，要说成有定义、有监控、有应对的指标。' },
  { category: 'report', title: '季度汇报结构', used_count: 6, tags: ['模板', '季度'],
    content: '① 结果（对目标的完成度）② 归因（做对了什么、做错了什么）③ 系统（沉淀了什么可复用的东西）④ 下季度打法（目标 + 打法 + 资源需求）\n\n季度汇报的重点是「系统」，不是「结果」——老板要看的是你能不能持续产出。' },

  /* 会议纪要 */
  { category: 'meeting', title: '客户需求调研会议纪要（示例）', used_count: 5, tags: ['会议'],
    content: '参会：客户 IT 负责人、销售总监。核心诉求：现有 CRM 录入太重，销售不愿用。决策流程：需 IT + 销售双签，预计 Q3 走预算。下一步：提供轻量化方案对比。' },

  /* 合同文件 */
  { category: 'contract', title: '标准服务合同模板', type: 'file', file_type: 'DOCX', used_count: 8, tags: ['合同'],
    content: '含服务范围、交付标准、付款方式（3-4-3）、保密条款、数据归属条款、违约责任。' },
  { category: 'contract', title: '报价单模板', type: 'file', file_type: 'XLSX', used_count: 20, tags: ['报价'],
    content: '含版本对比、坐席数、实施费、增值服务、折扣说明。支持一键导出 PDF。' },
];
