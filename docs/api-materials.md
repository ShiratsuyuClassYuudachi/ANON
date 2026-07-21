# ANON API 接口文档——物料管理（第二阶段）

基址与通用约定同 `docs/api.md`。所有接口均需 `Authorization: Bearer <token>`，且为项目成员。
新增权限点：`materials:manage`（查看类操作项目成员即可，增删改需该权限或 `project:manage`）。

## 可见范围（visibility）

```ts
interface Visibility { userIds: string[]; roleNames: string[] }
```

- 空（两个数组均为空）= 不限制，走权限点判定。
- 非空 = 仅列出的用户或角色可见；**可见范围优先于权限点**；超级管理员不受限。
- 资源的 visibility 优先于所属类型的 visibility（资源非空用资源的，否则用类型的）。
- 列表接口直接过滤不可见项；单项获取/下载不可见资源返回 403 `forbidden`。

## 数据类型

```ts
interface ResourceTypeItem { id: string; name: string; visibility: Visibility }
interface ResourceItem {
  id: string; typeId: string; name: string; description: string;
  visibility: Visibility; latestVersion: number; hasPreview: boolean; createdAt: string;
}
interface ResourceVersionItem {
  version: number; note: string; hasPreview: boolean;
  createdBy: string; createdAt: string;
  file: { id: string; filename: string; mime: string; size: number } | null;
}
```

## 资源类型

### GET /api/projects/:id/materials/types

列出可见类型（成员）。
响应 200：`{ types: ResourceTypeItem[] }`

### POST /api/projects/:id/materials/types（materials:manage）

请求：`{ name: string, visibility?: Visibility }`
响应 201：`{ type: ResourceTypeItem }`

### PATCH /api/projects/:id/materials/types/:typeId（materials:manage）

请求（均可选）：`{ name?: string, visibility?: Visibility }`
响应 200：`{ type: ResourceTypeItem }`

### DELETE /api/projects/:id/materials/types/:typeId（materials:manage）

类型下仍有资源时返回 400 `bad_request`。
响应 200：`{ ok: true }`

## 资源

### GET /api/projects/:id/materials

列出可见资源（成员）。查询参数：`typeId`（可选，按类型筛选）。
响应 200：`{ resources: ResourceItem[] }`

### POST /api/projects/:id/materials（materials:manage）

请求：`{ typeId: string, name: string, description?: string, visibility?: Visibility }`
响应 201：`{ resource: ResourceItem }`

### GET /api/projects/:id/materials/:resourceId

响应 200：`{ resource: ResourceItem }`；不可见返回 403。

### PATCH /api/projects/:id/materials/:resourceId（materials:manage）

请求（均可选）：`{ name?: string, description?: string, typeId?: string, visibility?: Visibility }`
响应 200：`{ resource: ResourceItem }`

### DELETE /api/projects/:id/materials/:resourceId（materials:manage）

删除资源及其全部版本与文件。
响应 200：`{ ok: true }`

## 版本

### POST /api/projects/:id/materials/:resourceId/versions（materials:manage）

multipart 上传新版本，字段：`file`（必填，≤20MB）、`note`（可选）。版本号自动递增并成为当前版。
mime 为 `image/*` 时自动生成 WebP 预览（宽 ≤800px，体积 ≤100KB，存 `uploads/previews/`）。
响应 201：`{ version: ResourceVersionItem }`

### GET /api/projects/:id/materials/:resourceId/versions

按版本号倒序（成员 + 可见范围）。
响应 200：`{ versions: ResourceVersionItem[] }`

### GET /api/projects/:id/materials/:resourceId/versions/:version/download

下载指定版本原文件（成员 + 可见范围）。
响应 200：文件流（`Content-Disposition: attachment`）

### GET /api/projects/:id/materials/:resourceId/preview

当前（最新）版本的预览图（成员 + 可见范围）。
响应 200：`image/webp`；无预览但当前版本是图片时回退原图；否则 404 `not_found`。

---

## 前端说明

- 项目工作台新增「物料」Tab（`MaterialsTab.tsx`）：类型筛选、资源卡片、预览图、版本下拉与下载、上传新版本、可见范围编辑（成员多选 + 角色多选）。
- 预览图与原图均需鉴权，前端使用 `AuthImg` 组件（fetch + Blob → objectURL）；点击预览图全屏加载原图。
