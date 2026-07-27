export interface HelpSection {
  heading?: string;
  paragraphs: string[];
  image?: { src: string; alt: string; caption?: string };
}
export interface HelpChapter {
  key: string;
  title: string;
  sections: HelpSection[];
}

export const HELP_CHAPTERS: HelpChapter[] = [
  {
    key: 'quick-start',
    title: '快速上手',
    sections: [
      {
        heading: '注册与加入团队',
        paragraphs: [
          '普通成员凭邀请码注册：邀请码由超级管理员在「管理」页创建并分发，每个仅限使用一次。',
          '登录态 30 天有效，过期后重新登录即可。',
        ],
      },
      {
        heading: '创建项目',
        paragraphs: [
          '进入「项目」页，填写项目名称（可同时填开始/结束日期）后创建，创建者自动成为「主办」。',
          '你参与的所有活动都列在项目列表里，点卡片即可进入项目工作台。',
        ],
        image: { src: '/help/projects.png', alt: '项目列表', caption: '项目列表：所有你参与的活动' },
      },
      {
        heading: '邀请成员进项目',
        paragraphs: [
          '进入项目 →「成员」Tab → 选择角色 →「生成链接」，把链接发给对方；对方登录后打开链接点「接受邀请」即加入。',
          '不指定用户的链接是开放链接，任何登录用户都可接受；链接一次性，默认 72 小时有效。',
        ],
      },
    ],
  },
  {
    key: 'todos',
    title: '待办',
    sections: [
      {
        heading: '创建待办',
        paragraphs: [
          '在「待办」Tab 顶部表单填写标题与类别（如 美工/宣发/后勤），可设置节点时间、到期时间与提醒时间，并勾选指派人。',
        ],
        image: { src: '/help/tab-todos.png', alt: '待办 Tab', caption: '待办 Tab：创建、筛选与完成' },
      },
      {
        heading: '完成待办',
        paragraphs: [
          '点待办卡片上的「完成」，可填写完成备注并上传附件凭证，确认后卡片划线标记已完成。',
          '被指派人或持待办管理权限的管理者可完成，完成人有记录。',
        ],
      },
      {
        heading: '筛选、提醒与模板',
        paragraphs: [
          '筛选栏支持按类别、指派人、状态过滤，并可按创建时间、到期时间或节点时间排序；配置 SMTP 后，系统会对到点的待办向指派人发邮件提醒。',
          '「导出为模板」把当前待办存成 JSON；新项目里「导入模板」并锚定开始或结束日期，系统按时间偏移自动重算每个待办的时间——系列活动复用神器。',
        ],
      },
    ],
  },
  {
    key: 'finance',
    title: '财务',
    sections: [
      {
        heading: '门票与记账',
        paragraphs: [
          '点「门票设置」可维护多个票种（如 预售票/现场票），各设单价与数量；门票收入实时计入项目盈亏。',
          '记一笔账：选择支出/收入与金额，指定实际付款人；可勾选参与平摊人（不勾选 = 全体成员平摊），并可上传凭证附件。',
        ],
        image: { src: '/help/tab-finance.png', alt: '财务 Tab', caption: '财务 Tab：记账与汇总' },
      },
      {
        heading: '汇总与结算',
        paragraphs: [
          '汇总卡片实时显示门票收入、记账收入、总支出与盈亏；「按人净额」正数表示应收回，负数表示应付出。',
          '「建议转账」自动算出最简转账列表（谁转给谁多少钱），按此执行即可结清所有垫付与分配。',
        ],
      },
      {
        heading: '权限与导出',
        paragraphs: [
          '主办或财务管理者可查看全部账目、设置门票，并按人导出 CSV（UTF-8 带 BOM，Excel 直接打开不乱码）。',
          '其他身份默认只能添加账目，且仅能看到、修改、删除自己添加的账目。',
        ],
      },
    ],
  },
  {
    key: 'materials',
    title: '物料',
    sections: [
      {
        heading: '类型与资源',
        paragraphs: [
          '先「新建类型」（如 海报、宣传图、场地图），再在类型下「新建资源」，点资源的「上传新版本」选择文件即生成 v1。',
        ],
        image: { src: '/help/tab-materials.png', alt: '物料 Tab', caption: '物料 Tab：类型与资源' },
      },
      {
        heading: '版本与预览',
        paragraphs: [
          '每次上传版本号 +1，列表始终展示最新版；版本下拉可切换并下载任意历史版本。',
          '图片上传时自动生成 WebP 预览图，列表加载快；点击放大时才加载原图。',
        ],
      },
      {
        heading: '可见范围',
        paragraphs: [
          '类型或资源卡片上点「可见范围」，勾选成员和/或角色后保存；留空 = 全体成员可见。',
          '可见范围优先于权限点：即使有管理权限，不在范围内也看不到该条目，下载接口同样强制。',
        ],
      },
    ],
  },
  {
    key: 'accounts',
    title: '账号',
    sections: [
      {
        heading: '三种记录模式',
        paragraphs: [
          '完整账号：记录平台 + 账号 + 密码，适合团队共用的宣传账号。',
          '仅账号（OTP 辅助）：账号在某成员手机上，页面直接显示该成员的联系方式，方便他人登录时索取验证码；仅联系人：记录合作方、场地方等联系方式。',
        ],
        image: { src: '/help/tab-accounts.png', alt: '账号 Tab', caption: '账号 Tab：平台账号管理' },
      },
      {
        heading: '密码的两种加密方式',
        paragraphs: [
          '默认浏览器端加密：密码在你的浏览器内加密后才上传，服务端只存密文，即使数据库泄露也无法解出。注意：保险库口令遗忘无法找回，请妥善保管。',
          '也可勾选服务端密钥加密，由服务端加解密，适合团队共享账号、不想挨个传递口令的场景。',
        ],
      },
      {
        heading: '可见范围',
        paragraphs: ['与物料相同：每个账号可设置仅指定成员/角色可见，优先级高于权限点。'],
      },
    ],
  },
  {
    key: 'work',
    title: '现场',
    sections: [
      {
        heading: '任务模块与分配',
        paragraphs: [
          '主办（或现场管理者）在「现场」Tab 建任务模块：填写名称、时间、地点、所需人力，并勾选分配成员；模块可随时编辑或删除。',
        ],
        image: { src: '/help/tab-work.png', alt: '现场 Tab', caption: '现场 Tab：任务模块与确认' },
      },
      {
        heading: '成员确认',
        paragraphs: ['成员在「现场」Tab 看到自己的分配后点「确认」，系统记录确认时间与确认人。'],
      },
      {
        heading: '打印任务单',
        paragraphs: [
          '「打印任务单」生成 A4 版式页：任务表格（模块/时间/地点/工作内容/确认状态）加签字、日期栏，用浏览器「打印 → 另存为 PDF」即可分发。',
          '管理者还可按成员打印，或「打印全员任务单」每人一页分页连排。',
        ],
        image: { src: '/help/work-sheet.png', alt: '任务单打印版式', caption: '任务单打印版式（A4）' },
      },
    ],
  },
  {
    key: 'permissions',
    title: '权限与角色',
    sections: [
      {
        heading: '预置角色',
        paragraphs: [
          '创建项目的人自动成为「主办」，拥有全部权限。',
          '预置角色还有美工、宣发、一般 staff，分别带有上传文件、完成待办、记账等常见权限组合。',
        ],
        image: { src: '/help/tab-members.png', alt: '成员 Tab', caption: '成员 Tab：邀请与角色调整' },
      },
      {
        heading: '自定义角色',
        paragraphs: [
          '在项目内「角色」Tab 输入角色名、勾选权限点即可创建；已有角色可修改权限后保存，无成员使用的角色可删除。',
          '成员的角色可在「成员」Tab 的成员卡片上随时下拉切换，立即生效。',
        ],
      },
      {
        heading: '可见范围优先',
        paragraphs: [
          '物料与平台账号支持「仅指定成员/角色可见」，可见范围优先于权限点：即使拥有管理权限，不在可见范围内也看不到该条目。',
          '超级管理员不受可见范围限制。',
        ],
      },
    ],
  },
];
