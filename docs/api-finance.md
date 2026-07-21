# ANON API 接口文档（财务模块）

基址：开发环境 `http://localhost:4000`，前端经 Vite 代理 `/api`。
所有接口均需请求头 `Authorization: Bearer <token>`，且要求为项目成员（超级管理员不受限）。
通用约定（错误格式、时间格式等）同 `docs/api.md`。

- 金额在接口内部一律为**整数分**（`amountCents` / `ticketPriceCents`）；创建/编辑时以元（最多两位小数）提交，服务端转换为分
- 增删改需 `finance:manage` 权限（`project:manage` 等价全部权限）；查看与导出任一项目成员即可

## 数据类型

```ts
interface TxUser { userId: string; name: string }
interface TransactionItem {
  id: string; type: 'income' | 'expense'; amountCents: number; note: string;
  payer: TxUser;                 // 支出=付款人；收入=收款人
  splitAmong: TxUser[];          // 参与平摊人，空数组 = 全体成员
  createdBy: string; createdByName: string; createdAt: string;
  attachments: { id: string; filename: string }[];
}
interface FinanceSummary {
  ticketPriceCents: number; ticketCount: number;
  ticketIncomeCents: number;     // = ticketPriceCents × ticketCount
  incomeCents: number;           // 记账收入（不含门票）
  expenseCents: number;          // 全部记账支出
  profitCents: number;           // = ticketIncomeCents + incomeCents − expenseCents
  perUser: { userId: string; name: string; netCents: number }[];   // 覆盖全体项目成员
  settlement: { from: TxUser; to: TxUser; amountCents: number }[];
}
```

### 净额与建议转账口径

- 门票收入视为项目公款，不挂在任何成员名下
- expense 由付款人垫付（净额 +金额）；`splitAmong` 非空时仅在平摊人之间均摊（净额 −份额）
- income 视为付款人代收款（净额 −金额）
- 公款池盈余 = 门票收入 + 记账收入 − 全员支出（`splitAmong` 为空的支出），按全体成员均摊并入净额
- 除不尽的余数按成员 userId 排序每人多摊 1 分，保证合计精确
- 建议转账为净额为负者向为正者转账的贪心结算列表；成员净额合计与公款（门票等）的差额由项目公款补齐/回收

---

### GET /api/projects/:id/finance

账目列表 + 汇总（任一项目成员）。
响应 200：`{ transactions: TransactionItem[], summary: FinanceSummary }`（transactions 按创建时间倒序）

### POST /api/projects/:id/finance（finance:manage）

新建账目。支持两种请求体：

- `application/json`：`{ type: 'income'|'expense', amount: number|string（元，最多两位小数）, note?: string, payerUserId: string, splitAmong?: string[] }`
- `multipart/form-data`：同名字段（`splitAmong` 为 JSON 字符串或逗号分隔）+ `files`（凭证附件，最多 10 个，单个 ≤ 20MB）

校验：`amount` 必须为正且最多两位小数；`payerUserId`、`splitAmong` 必须是项目成员。
响应 201：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`

### PATCH /api/projects/:id/finance/:txId（finance:manage）

编辑账目（JSON，字段均可选）：`{ type?, amount?, note?, payerUserId?, splitAmong? }`。不修改附件。
响应 200：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### DELETE /api/projects/:id/finance/:txId（finance:manage）

响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### PATCH /api/projects/:id/finance/ticket（finance:manage）

设置门票价与售票数（存于 Project，实时计入汇总）。
请求：`{ ticketPrice: number|string（元，≥0，最多两位小数）, ticketCount: number（整数，≥0） }`
响应 200：`{ ticketPriceCents: number, ticketCount: number }`
错误：400 `bad_request`；403 `forbidden`

### GET /api/projects/:id/finance/export?userId=（成员）

导出某成员相关账目（其为付款人、或 `splitAmong` 为空、或其在 `splitAmong` 中）的 CSV。
`userId` 缺省为当前用户；必须是项目成员。
响应 200：`text/csv; charset=utf-8`，UTF-8 **带 BOM**，`Content-Disposition: attachment`。
列：`日期,类型,金额(元),付款人,参与平摊,备注,添加人`（`参与平摊` 为「全员」或成员名以「、」连接；按创建时间升序）。
错误：400 `bad_request`（userId 非项目成员）
