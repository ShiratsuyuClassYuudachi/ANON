# Web Push 推送通知设计

> 对应实施计划 `docs/superpowers/plans/2026-07-31-webpush.md`。在通知管线（`services/notifications.ts`）之上新增第二个渠道 `WebPushChannel`，业务调用点零改动。

## 1. 配置（VAPID）

| 环境变量 | 说明 |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` 生成；缺任一则推送渠道静默禁用 |
| `VAPID_SUBJECT` | 默认 `mailto:anon@localhost` |

公/私钥未配置时 `deliver()` 直接返回（视为成功）——与邮件存根一致，不阻塞 cron 去重标记；`GET /api/push/config` 返回 `publicKey: null`，前端据此不展示订阅入口。

## 2. 订阅存储

`PushSubscription { userId, endpoint, p256dh, auth, userAgent }`，唯一索引 `{ userId, endpoint }`（同端点 upsert 更新密钥）；每用户上限 20 条，超出淘汰最旧。endpoint 校验：https（或 localhost http）+ URL-safe base64 密钥。

```
GET    /api/push/config          → { publicKey | null }   （需登录）
POST   /api/push/subscription    → upsert（需登录）
DELETE /api/push/subscription    → 按 endpoint 删除（需登录）
```

## 3. 渠道行为

- 载荷 JSON：`{ title, body, url: payload.link ?? '/', tag: type:projectId, type, projectId }` —— `tag` 用于同一项目同类型通知折叠。
- `TTL = 86400s`：设备离线超过 1 天不投递，避免陈旧提醒。
- 失败处理：404/410（订阅失效）→ 从库中清除；其余错误仅记日志。**渠道不抛错**——推送是尽力而为，邮件仍是可靠渠道，cron 去重语义不受影响。

## 4. 前端

- `lib/push.ts`：`subscribePush()`（幂等复用现有订阅；权限 default 时触发浏览器询问）、`unsubscribePush()`。
- `PushBanner`（Layout 内）：权限已授权 → 静默订阅；从未询问 → 展示一次开启条（「暂不」写入 localStorage 不再出现）；不支持/未配置/被拒绝 → 不展示。
- Service Worker：vite-plugin-pwa `generateSW` 不支持自定义监听，`scripts/patch-sw.mjs` 在构建后向 `dist/sw.js` 追加 `push`（`showNotification`）与 `notificationclick`（`clients.matchAll` → navigate/focus 或 `openWindow` 跳转 payload.url）两个监听。开发模式（dev server）无推送处理，需构建后验证。

## 5. 明确不做

- 通知偏好设置（按事件类型开关推送）、badge 未读数、推送点击后标记已读回传——留待站内通知中心统一做。
