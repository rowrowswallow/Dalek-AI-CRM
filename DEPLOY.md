# 部署与上线指南

本文档覆盖三件事：**本地跑起来 → 部署到服务器 → 接进企业微信**。

---

## 一、本地启动

```bash
cd aicrm
node server/index.js          # 后端 → http://127.0.0.1:8787

# 另开一个终端
cd aicrm/web
npm install
npm run dev                   # 前端 → http://127.0.0.1:5273
```

登录：`chenli` / `123456`

首次启动会自动创建 `data/aicrm.db` 并灌入演示数据。

**重置演示数据**：
```bash
curl -X POST http://127.0.0.1:8787/api/admin/reset
```

---

## 二、部署到服务器

### 2.1 环境要求

| 项 | 要求 |
|---|---|
| Node.js | **≥ 22.5**（需要内置的 `node:sqlite`） |
| 内存 | ≥ 512MB |
| 磁盘 | ≥ 1GB |
| 系统 | Linux / macOS / Windows 均可 |

**不需要安装数据库** —— SQLite 是 Node 内置的。

### 2.2 构建前端

```bash
cd aicrm/web
npm install
npm run build          # 产物在 web/dist/
```

后端会自动托管 `web/dist`（访问 `http://服务器IP:8787/` 就是完整应用）。

### 2.3 用 pm2 常驻

```bash
npm i -g pm2
cd aicrm
pm2 start server/index.js --name aicrm
pm2 save && pm2 startup      # 开机自启
pm2 logs aicrm               # 看日志
```

### 2.4 Nginx 反代 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE（AI 流式对话）必须关缓冲，否则回复会卡住不出来
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

> **`proxy_buffering off` 是关键** —— 漏了这行，AI 回复会等到全部生成完才一次性显示。

### 2.5 环境变量（可选）

```bash
PORT=8787                 # 后端端口
AI_API_KEY=sk-xxx         # 服务端统一配 Key（用户就不用自己填）
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen-plus
```

**两种 AI 供给模式**：

| 模式 | 配置方式 | 适合 |
|---|---|---|
| **用户自带 Key** | 不设 `AI_API_KEY`，用户在「系统设置 → AI 服务」自己填 | 早期验证、不想垫成本 |
| **服务端统一供给** | 设 `AI_API_KEY`，用户开箱即用 | 商业化（需自己承担 Token 成本） |

优先级：**用户在设置页填的 > 环境变量 > 本地规则引擎**。

---

## 三、接进企业微信（抽屉）

### 3.1 先理解一件事

**抽屉不是装在销售的手机上的。** 它是管理员在企业微信后台**填一个网址**，
配完之后销售在客户聊天窗口底部就会多出一个图标。

```
你把抽屉页部署到公网 HTTPS
   → 客户企业管理员进「客户联系 → 聊天工具」填上你的网址
   → 销售打开客户单聊 → 底部出现图标 → 点开就是抽屉
```

**销售端零操作，也不需要装任何 App。**

### 3.2 两种接入模式

| | 自建应用 | 第三方应用 / 服务商 |
|---|---|---|
| 谁配置 | **每个客户企业自己配** | 你上架应用，客户一键授权 |
| 你需要什么 | 无 | **企业资质 + 服务商认证 + 上架审核** |
| 适合阶段 | **MVP 验证** | 产品化 |
| 客户体感 | 「要配一下」 | 「点一下开通」 |

**建议**：MVP 阶段用自建应用，找 3–5 个愿意配合的客户手把手配；跑通后再申请服务商。

### 3.3 自建应用配置步骤（发给客户管理员）

> **前提**：你已经把前端部署到了公网 HTTPS，例如 `https://your-domain.com`

**第一步：创建自建应用**

1. 用管理员账号登录 [企业微信管理后台](https://work.weixin.qq.com/)
2. 进「应用管理 → 应用 → 自建 → 创建应用」
3. 填名称（如「客户助手」）、上传 logo、设置可见范围（建议选销售部门）
4. 创建后记下 **AgentId** 和 **Secret**

**第二步：开通客户联系权限**

1. 进「客户联系 → 权限配置 → 使用范围」，把销售部门的成员加进去
2. 进「客户联系 → 可调用接口的应用」，把刚创建的应用加进去 ← **这步不能漏**

**第三步：配置聊天工具栏**

1. 进「客户联系 → 聊天工具 → 配置」
2. 添加「自定义」工具：
   - 名称：`客户助手`
   - 链接：`https://your-domain.com/drawer.html`
3. 保存

**第四步：验证**

销售打开任意**客户单聊** → 聊天窗口底部工具栏 → 点「客户助手」→ 抽屉打开，
顶部应显示当前客户信息。

### 3.4 代码侧要改的地方

现在是**模拟 JSSDK**。真实环境把 `web/src/Drawer.vue` 的 `initJssdk()` 换掉：

```js
async function initJssdk() {
  // 1. 从后端拿 JSSDK 签名（后端用 access_token 换 jsapi_ticket 再签名）
  const { appId, timestamp, nonceStr, signature } = await api.getJsSdkSignature(location.href);

  wx.config({
    beta: true,
    debug: false,
    appId, timestamp, nonceStr, signature,
    jsApiList: ['getCurExternalContact', 'getCurExternalChat'],
  });

  wx.ready(() => {
    wx.invoke('getCurExternalContact', {}, async (res) => {
      if (res.err_msg === 'getCurExternalContact:ok') {
        // res.userId 就是当前客户的 external_userid
        const r = await api.resolveExternal(res.userId);
        if (r.ok) await selectCustomer(r.customer_id);
      } else {
        jssdkState.value = 'unsupported';   // 降级：允许手动选客户
      }
    });
  });
}
```

后端需要补一个签名接口：

```js
// GET /api/wecom/jssdk-signature?url=<当前页面URL>
// 1. 用 corpid + corpsecret 换 access_token（缓存 2 小时）
// 2. 用 access_token 换 jsapi_ticket（缓存 2 小时）
// 3. 按官方算法签名：sha1(`jsapi_ticket=..&noncestr=..&timestamp=..&url=..`)
```

> 官方文档：`developer.work.weixin.qq.com/document/path/90506`（获取 jsapi_ticket）

### 3.5 抽屉用到的官方接口（都不需要会话存档）

| 用途 | 接口 | 权限要求 |
|---|---|---|
| 取当前客户 | `ww.getCurExternalContact()`（JSSDK） | 客户联系功能权限 + 客户基础信息 |
| 写企业标签 | `externalcontact/mark_tag` | 配置到「可调用接口的应用」 |
| 改客户备注 | `externalcontact/remark` | 同上 |

**「不需要会话存档」是这套方案能成立的根本原因** —— 会话存档要企业付费开通、
凭证不外流，第三方 SaaS 基本拿不到。

### 3.6 上线前提检清单

- [ ] 前端已部署到**公网 HTTPS**（企微要求 HTTPS）
- [ ] 后端配了 `proxy_buffering off`（否则 AI 流式回复会卡）
- [ ] 数据目录 `data/` 已做持久化与备份
- [ ] 已设置管理员密码（现在是硬编码 `123456`，**上线前必须改**）
- [ ] 已在「系统设置 → AI 服务」配好 API Key 并测试通过
- [ ] 客户企业已完成 3.3 的四步配置

---

## 四、上线前必须补的东西

以下是**当前版本还不满足生产要求**的地方，按优先级：

| # | 项目 | 说明 |
|---|---|---|
| 1 | **密码改成哈希存储** | 现在是明文硬编码，必须改 bcrypt + 数据库 |
| 2 | **JWT 或会话过期** | 现在令牌存内存，重启即失效且无过期 |
| 3 | **HTTPS + 安全头** | 需要配 HSTS、CSP、X-Frame-Options 等 |
| 4 | **数据备份** | SQLite 需定时备份 `data/aicrm.db`（含 WAL 文件） |
| 5 | **错误监控** | 接入 Sentry 或自建日志聚合 |
| 6 | **多租户隔离** | 现在单租户；卖给多家客户需要改造 |

---

## 五、常见问题

**Q：AI 回复很慢或卡住？**
检查 Nginx 是否有 `proxy_buffering off`。SSE 被缓冲会等到全部生成完才显示。

**Q：配置了 API Key 但 AI 还是走规则引擎？**
点「系统设置 → AI 服务 → 测试连接」。如果失败，看返回的错误信息
（常见：Key 错误、Base URL 少了 `/v1`、余额不足）。

**Q：图片识别报「需要配置支持视觉的模型」？**
OCR 需要模型支持图片输入。`qwen-plus` 不支持，需要换成 `qwen-vl-max`、
`gpt-4o` 等视觉模型。

**Q：抽屉打开后取不到客户？**
1. 确认 `wx.config` 签名成功（打开 debug: true 看日志）
2. 确认应用已加入「可调用接口的应用」
3. 确认销售在应用的可见范围内
4. 触发入口必须是**客户单聊**（群聊用 `getCurExternalChat`）

**Q：数据库文件多大？会一直涨吗？**
SQLite 单文件，24 客户 + 20 知识条目约 4KB。实际使用中主要增长来自会话消息，
建议定期清理 3 个月前的会话记录。
