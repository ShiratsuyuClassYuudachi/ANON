# 账号管理 API（平台账号）

挂载于 `/api/projects/:id/accounts`，需登录且为项目成员。查看类操作要求成员身份且通过可见范围（visibility）校验；增删改需 `accounts:manage` 权限（`project:manage`/超管等价拥有）。

## 数据模型

- `platform`：平台（QQ/小红书/B站/微博/其他）
- `account`：账号或联系方式
- `mode`：`full`（账号+密码）/ `otp`（仅账号+添加人，便于索取二步验证码）/ `contact`（联系人，无密码）
- `passwordCipher`：仅 full 模式存在。`cipherKeySource: 'user'`（默认）为浏览器端加密密文，格式 `ANONv1:<salt_b64>:<iv_b64>:<data_b64>`（PBKDF2-SHA256 100000 次 + AES-GCM，口令仅存于用户浏览器）；`cipherKeySource: 'server'` 为服务端 AES-256-GCM 密文（密钥 = SHA-256(`PLATFORM_CRYPTO_KEY`，缺省回退 `JWT_SECRET`)）
- `visibility`：`{ userIds: [], roleNames: [] }`，空 = 不限制；非空时仅列出的用户/角色可见，优先于权限点；超管不受限

## GET /api/projects/:id/accounts

成员。查询参数：`platform`（可选筛选）。返回当前用户可见的账号列表（不含密文/明文）。

```json
{ "accounts": [{ "id", "platform", "account", "mode", "cipherKeySource": "user"|"server"|null, "hasPassword": true, "note", "addedBy": { "userId", "name", "contacts": [{ "platform", "value" }] }, "visibility": { "userIds": [], "roleNames": [] }, "createdAt" }] }
```

## POST /api/projects/:id/accounts

`accounts:manage`。body：`{ platform, account, mode, note?, visibility? }`。

- mode 为 `full` 时二选一：
  - 浏览器加密（默认）：`{ passwordCipher: "ANONv1:..." }`（前端用保险库口令加密后的密文，服务端原样存储）
  - 服务端加密：`{ cipherKeySource: "server", password: "明文" }`（服务端加密后存储）
- `otp`/`contact` 模式不传密码字段。

返回 `201 { account }`。

## PATCH /api/projects/:id/accounts/:accountId

`accounts:manage` 且在可见范围内。可更新 `platform`、`account`、`mode`、`note`、`visibility`；改密码传 `password`（server）或 `passwordCipher`（user，仅 full 模式）；mode 改为非 full 时清除密码。返回 `{ account }`。

## DELETE /api/projects/:id/accounts/:accountId

`accounts:manage` 且在可见范围内。返回 `{ ok: true }`。

## POST /api/projects/:id/accounts/:accountId/reveal

成员且在可见范围内。仅 full 模式：

- server 模式：返回 `{ password: "明文" }`
- user 模式：返回 `{ cipher: "ANONv1:..." }`，前端提示输入保险库口令后用 WebCrypto 本地解密

非 full 模式或无密码返回 400。
