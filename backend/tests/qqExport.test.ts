import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { config } from '../src/config';
import { File } from '../src/models/File';
import { InviteCode } from '../src/models/InviteCode';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { parseForwardPayload, renderMarkdown } from '../src/services/qqChatExport';
import { handleQQEvent } from '../src/services/qqEvents';
import { createSuperAdmin, registerUser } from './helpers';

// 拦截 QQ 发送（同 qq.test.ts 的模块边界 mock 模式）
vi.mock('../src/services/qqApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/qqApi')>();
  return {
    ...mod,
    sendC2CMessage: vi.fn().mockResolvedValue(true),
    sendGroupMessage: vi.fn().mockResolvedValue(true),
  };
});

import { sendC2CMessage, sendGroupMessage } from '../src/services/qqApi';
const sendC2CMock = vi.mocked(sendC2CMessage);
const sendGroupMock = vi.mocked(sendGroupMessage);

/** 官方文档示例形状的结构化合并转发（102） */
const structuredForward = {
  id: 'ROBOT1.0_fwd',
  message_type: 102,
  content: '[聊天记录]',
  msg_elements: [
    { msg_idx: 'R1', message_type: 0, author: { username: '小明', member_openid: 'U1' }, content: '大家早上好呀' },
    {
      msg_idx: 'R2',
      message_type: 0,
      author: { username: '小红', member_openid: 'U2' },
      content: '分享一张今天的风景照',
      attachments: [
        {
          content_type: 'image/jpeg',
          filename: 'photo.jpg',
          url: 'https://multimedia.nt.qq.com.cn/download?appid=1',
          width: 1920,
          height: 1080,
          size: 256000,
        },
      ],
    },
    {
      msg_idx: 'R3',
      message_type: 103,
      author: { username: '小华', member_openid: 'U3' },
      content: '这个建议很有帮助',
      msg_elements: [{ msg_idx: 'R0', message_type: 0, author: { username: '小明' }, content: '每天坚持阅读半小时' }],
    },
    {
      msg_idx: 'R4',
      message_type: 0,
      author: { username: '小赵', member_openid: 'U4' },
      content: '',
      attachments: [{ content_type: 'voice', filename: 'v.silk', url: 'https://x/v.silk', asr_refer_text: '明天下午三点开会' }],
    },
    {
      msg_idx: 'R5',
      message_type: 3,
      author: { username: '小孙', member_openid: 'U5' },
      content: '[卡片消息] 小程序',
      ark_data: { ark_type: 'miniapp', ark_name: '小程序', fields: { title: '每日打卡', desc: '快来打卡', jump_url: 'https://x.com/app' } },
    },
  ],
};

describe('parseForwardPayload', () => {
  it('解析结构化合并转发：作者、文本、图片、语音、卡片', () => {
    const { messages, truncated } = parseForwardPayload(structuredForward);
    expect(truncated).toBe(false);
    expect(messages).toHaveLength(5);
    expect(messages[0]).toMatchObject({ author: '小明', text: '大家早上好呀' });
    expect(messages[1]).toMatchObject({
      author: '小红',
      text: '分享一张今天的风景照',
      images: [{ url: 'https://multimedia.nt.qq.com.cn/download?appid=1', name: 'photo.jpg' }],
    });
    expect(messages[3]).toMatchObject({ author: '小赵', voiceText: '明天下午三点开会' });
    expect(messages[4]).toMatchObject({
      author: '小孙',
      card: { title: '每日打卡', desc: '快来打卡', url: 'https://x.com/app' },
    });
  });

  it('转发内的引用消息（103 元素）提取为 quote', () => {
    const { messages } = parseForwardPayload(structuredForward);
    expect(messages[2]).toMatchObject({
      author: '小华',
      text: '这个建议很有帮助',
      quote: { author: '小明', text: '每天坚持阅读半小时' },
    });
  });

  it('扁平文本形态（=== 消息 N ===）切分为多条', () => {
    // 官方群事件示例 3：引用回复合并转发时被引用内容的形状
    const flat = {
      message_type: 103,
      content: ' ',
      msg_elements: [
        {
          content:
            '=== 消息 1 ===\n[消息内容] 今天的学习计划已完成\n\n=== 消息 2 ===\n[消息内容] 很棒！继续保持\n\n=== 消息 3 ===\n[消息内容] 好的，一起进步！',
        },
      ],
      message_scene: { ext: ['ref_msg_idx=TMP_x', 'msg_idx=R9'] },
    };
    const { messages } = parseForwardPayload(flat);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ author: '未知', text: '今天的学习计划已完成' });
    expect(messages[2]).toMatchObject({ text: '好的，一起进步！' });
  });

  it('真实 C2C 合并转发载荷：顶层 content 扁平文本，含发送者/卡片/引用', () => {
    // 2026-10-08 实测 spike 捕获的真实形状：无 msg_elements，整段拍平在顶层 content
    const real = {
      id: 'ROBOT1.0_real',
      message_type: 102,
      author: { user_openid: 'U1', username: '' },
      content:
        '[抹茶喵的聊天记录]\n' +
        '=== 消息 1 ===\n' +
        '[消息内容] 乐队名字：社恐群像症\n' +
        '演奏曲目：\n' +
        '天使にふれたよ!—轻音少女\n' +
        "Don't say \"lazy\"—轻音少女\n" +
        '[发送者] 抹茶喵\n' +
        '\n' +
        '=== 消息 2 ===\n' +
        '[消息内容] [卡片消息] 小程序\n' +
        '摘要: [QQ小程序]【社恐群像症Live】秒針を噛む\n' +
        'title: 【社恐群像症Live】秒針を噛む 乐队cover现场\n' +
        '[发送者] 抹茶喵\n' +
        '[消息类型] 卡片消息\n' +
        '[卡片消息] 小程序 摘要:[QQ小程序]【社恐群像症Live】秒針を噛む title:【社恐群像症Live】秒針を噛む 乐队cover现场\n' +
        '\n' +
        '=== 消息 3 ===\n' +
        '[消息内容] 这个是线上合奏的一版\n' +
        '[发送者] 抹茶喵\n' +
        '[关联消息]\n' +
        '--- 第1条 ---\n' +
        '    [消息内容] [QQ小程序]【云乐队】梦限大 超还原\n' +
        '    [消息类型] 引用消息\n',
    };
    const { messages } = parseForwardPayload(real);
    expect(messages).toHaveLength(3);
    expect(messages[0].author).toBe('抹茶喵');
    expect(messages[0].text).toContain('乐队名字：社恐群像症');
    expect(messages[0].text).toContain('天使にふれたよ!');
    // 卡片：保留摘要/title 等多行内容，剔除末尾压缩重复行
    expect(messages[1].text).toContain('title: 【社恐群像症Live】秒針を噛む 乐队cover现场');
    expect(messages[1].text).not.toContain('[卡片消息] 小程序 摘要:');
    // 引用：[关联消息] 缩进块 → quote
    expect(messages[2]).toMatchObject({ author: '抹茶喵', text: '这个是线上合奏的一版' });
    expect(messages[2].quote?.text).toContain('梦限大');
    // 标题头不进入任何消息
    expect(messages.some((m) => m.text.includes('的聊天记录'))).toBe(false);
  });

  it('嵌套合并转发：递归展开并按层级缩进解析（实测双层嵌套形状）', () => {
    // 2026-10-08 实测：[消息类型] 合并转发消息 的 [关联消息] 子块是转发内容（递归），
    // 普通消息的 [关联消息] 子块是引用；[附件N] 为附件行；空内容消息丢弃
    const nested = {
      message_type: 102,
      content:
        '[群聊的聊天记录]\n' +
        '=== 消息 1 ===\n' +
        '[消息内容] [斯大林的聊天记录]\n' +
        '[发送者] 斯大林\n' +
        '[消息类型] 合并转发消息\n' +
        '[关联消息]\n' +
        '--- 第1条 ---\n' +
        '    [消息内容] [小戮不是小戳和斯大林的聊天记录]\n' +
        '    [发送者] 斯大林\n' +
        '    [消息类型] 合并转发消息\n' +
        '    [关联消息]\n' +
        '    --- 第1条 ---\n' +
        '        [消息内容] STELLAR乐队\n' +
        '        歌单\n' +
        '        影色舞\n' +
        '        [发送者] 小戮不是小戳\n' +
        '    --- 第2条 ---\n' +
        '        [发送者] 小戮不是小戳\n' +
        '        [附件1] 类型:视频 文件名:abc.mp4 尺寸:1140x640 大小:90.4MB\n' +
        '    --- 第3条 ---\n' +
        '        [消息内容] 这个不好说得看具体情况！\n' +
        '        [发送者] 斯大林\n' +
        '        [关联消息]\n' +
        '        --- 第1条 ---\n' +
        '            [消息内容] 之后歌单还可以变动吗\n' +
        '            [消息类型] 引用消息\n' +
        '=== 消息 2 ===\n' +
        '[发送者] 斯大林\n' +
        '=== 消息 3 ===\n' +
        '[消息内容] 追加一个乐队\n' +
        '[发送者] 斯大林\n',
    };
    const { messages } = parseForwardPayload(nested);
    expect(messages.map((m) => `${m.author}:${m.text.split('\n')[0]}`)).toEqual([
      '斯大林:📁 [斯大林的聊天记录]',
      '斯大林:📁 [小戮不是小戳和斯大林的聊天记录]',
      '小戮不是小戳:STELLAR乐队',
      '小戮不是小戳:[视频] abc.mp4（90.4MB）',
      '斯大林:这个不好说得看具体情况！',
      '斯大林:追加一个乐队',
    ]);
    // 多行正文保留
    expect(messages[2].text).toBe('STELLAR乐队\n歌单\n影色舞');
    // 嵌套内的引用正常提取
    expect(messages[4].quote?.text).toBe('之后歌单还可以变动吗');
  });

  it('图片附件行提取 URL 进 images', () => {
    const withImage = {
      message_type: 102,
      content:
        '[群聊的聊天记录]\n=== 消息 1 ===\n[发送者] sumimi\n[附件1] 类型:图片 文件名:a.png 尺寸:1180x1662 大小:135.2KB URL:https://multimedia.nt.qq.com.cn/download?appid=1\n',
    };
    const { messages } = parseForwardPayload(withImage);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      author: 'sumimi',
      images: [{ url: 'https://multimedia.nt.qq.com.cn/download?appid=1', name: 'a.png' }],
    });
  });

  it('扁平嵌套超过深度上限折叠为占位', () => {
    const deep = {
      message_type: 102,
      content:
        '[群聊的聊天记录]\n=== 消息 1 ===\n[消息内容] [L1的聊天记录]\n[发送者] A\n[消息类型] 合并转发消息\n[关联消息]\n' +
        '--- 第1条 ---\n    [消息内容] [L2的聊天记录]\n    [发送者] A\n    [消息类型] 合并转发消息\n    [关联消息]\n' +
        '    --- 第1条 ---\n        [消息内容] [L3的聊天记录]\n        [发送者] A\n        [消息类型] 合并转发消息\n        [关联消息]\n' +
        '        --- 第1条 ---\n            [消息内容] 最深层的消息\n            [发送者] B\n',
    };
    const { messages } = parseForwardPayload(deep);
    expect(messages.some((m) => m.text.includes('最深层的消息'))).toBe(false);
    expect(messages.some((m) => m.text.includes('嵌套'))).toBe(true);
  });

  it('连续解析相同扁平 payload 结果稳定（回归：全局正则 lastIndex 污染）', () => {
    const flat = {
      message_type: 103,
      msg_elements: [{ content: '=== 消息 1 ===\n[消息内容] 甲\n\n=== 消息 2 ===\n[消息内容] 乙' }],
    };
    for (let i = 0; i < 3; i++) {
      expect(parseForwardPayload(flat).messages).toHaveLength(2);
    }
  });

  it('嵌套合并转发递归展开，超过深度上限以占位消息标注', () => {
    const leaf = { msg_idx: 'L', message_type: 0, author: { username: 'A' }, content: '最里层' };
    const nest = (depth: number): Record<string, unknown> =>
      depth === 0
        ? leaf
        : { msg_idx: `N${depth}`, message_type: 102, author: { username: `N${depth}` }, content: '[聊天记录]', msg_elements: [nest(depth - 1)] };
    const { messages } = parseForwardPayload({ message_type: 102, msg_elements: [nest(5)] });
    // 深度 ≤3 展开，更深层折叠为占位
    expect(messages.some((m) => m.text === '最里层')).toBe(false);
    expect(messages.some((m) => m.text.includes('嵌套'))).toBe(true);
  });

  it('超过 500 条截断并标注 truncated', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({
      msg_idx: `M${i}`,
      message_type: 0,
      author: { username: 'A' },
      content: `msg ${i}`,
    }));
    const { messages, truncated } = parseForwardPayload({ message_type: 102, msg_elements: many });
    expect(messages).toHaveLength(500);
    expect(truncated).toBe(true);
  });

  it('空载荷与普通消息返回空列表', () => {
    expect(parseForwardPayload({}).messages).toEqual([]);
    expect(parseForwardPayload({ message_type: 0, content: 'hi' }).messages).toEqual([]);
    expect(parseForwardPayload(null).messages).toEqual([]);
  });

  it('作者昵称为空时退化为 openid 前 6 位，再退化为「未知」', () => {
    const { messages } = parseForwardPayload({
      message_type: 102,
      msg_elements: [
        { message_type: 0, author: { username: '', member_openid: 'ABCDEF123456' }, content: 'a' },
        { message_type: 0, content: 'b' },
      ],
    });
    expect(messages[0].author).toBe('ABCDEF');
    expect(messages[1].author).toBe('未知');
  });
});

describe('renderMarkdown', () => {
  it('渲染标题、正文、引用、图片、语音、卡片', () => {
    const { messages } = parseForwardPayload(structuredForward);
    const md = renderMarkdown(messages, false);
    expect(md).toContain('# QQ 聊天记录导出');
    expect(md).toContain('共 5 条');
    expect(md).toContain('**小明**：');
    expect(md).toContain('大家早上好呀');
    expect(md).toContain('![photo.jpg](https://multimedia.nt.qq.com.cn/download?appid=1)');
    expect(md).toContain('> 引用 **小明**：每天坚持阅读半小时');
    expect(md).toContain('[语音] 明天下午三点开会');
    expect(md).toContain('[链接卡片] 每日打卡');
    expect(md).toContain('https://x.com/app');
  });

  it('truncated 时文末标注截断', () => {
    const md = renderMarkdown([{ author: 'A', text: 'x', images: [] }], true);
    expect(md).toContain('截断');
  });

  it('附注渲染为文末引用块', () => {
    const md = renderMarkdown([{ author: 'A', text: 'x', images: [] }], false, ['注：测试附注']);
    expect(md).toContain('> 注：测试附注');
  });
});

// --- 事件接入集成 ---

describe('QQ 聊天记录导出事件', () => {
  let owner: { token: string; user: { id: string } };
  let staff: { token: string; user: { id: string } };
  let projectId: string;

  beforeEach(async () => {
    sendC2CMock.mockClear();
    sendGroupMock.mockClear();
    // 默认禁网：导出时的图片抓取走 mock，个别用例再覆盖为成功路径
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no net')));
    config.qq.appId = 'qq-test-appid';
    config.qq.appSecret = 'qq-test-secret';
    config.publicBaseUrl = 'https://app.example.com';

    owner = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    staff = await registerUser('C1', 's@example.com', 'Staff');
    const p = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '导出测试活动' });
    projectId = p.body.project.id;
    const inv = await request(app)
      .post(`/api/projects/${projectId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ roleName: '一般staff' });
    await request(app)
      .post(`/api/invites/${inv.body.token}/accept`)
      .set('Authorization', `Bearer ${staff.token}`);
  });

  // config 跨测试文件共享：收尾还原（同 qq.test.ts 约定）
  afterAll(() => {
    config.qq.appId = '';
    config.qq.appSecret = '';
    config.publicBaseUrl = '';
    vi.unstubAllGlobals();
  });

  it('图片抓取成功时内嵌为 data URI（QQ 签名链接过后即失效）', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } })),
    );
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
    await handleQQEvent('C2C_MESSAGE_CREATE', { ...structuredForward, id: 'e8', author: { user_openid: 'U-C2C' } });
    const f = await File.findOne({ uploadedBy: staff.user.id });
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toContain(`![photo.jpg](data:image/png;base64,${png.toString('base64')})`);
    expect(down.text).not.toContain('无法下载');
  });

  it('图片抓取失败时转为「[图片] 文件名」文本并注明（死链不保留）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no net')));
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
    await handleQQEvent('C2C_MESSAGE_CREATE', { ...structuredForward, id: 'e9', author: { user_openid: 'U-C2C' } });
    const f = await File.findOne({ uploadedBy: staff.user.id });
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toContain('[图片] photo.jpg');
    expect(down.text).not.toContain('multimedia.nt.qq.com.cn');
    expect(down.text).toContain('无法下载');
  });

  it('C2C 合并转发：未绑定用户收到绑定引导且不建档', async () => {
    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'e1',
      author: { user_openid: 'U-X' },
      content: '[聊天记录]',
      message_type: 102,
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: 'hi' }],
    });
    expect(sendC2CMock).toHaveBeenCalledWith('U-X', expect.stringContaining('绑定'), { msgId: 'e1' });
    expect(await File.countDocuments()).toBe(0);
  });

  it('C2C 合并转发：已绑定用户导出为个人文件，回复 /dl/ 链接且本人可下载', async () => {
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
    await handleQQEvent('C2C_MESSAGE_CREATE', { ...structuredForward, id: 'e2', author: { user_openid: 'U-C2C' } });
    const f = await File.findOne({ uploadedBy: staff.user.id });
    expect(f).toBeTruthy();
    expect(f!.projectId).toBeFalsy();
    expect(sendC2CMock).toHaveBeenCalledWith('U-C2C', expect.stringContaining(`/dl/${f!._id}`), { msgId: 'e2' });
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    // GBK 默认环境（Windows 记事本等）靠 BOM 识别 UTF-8，缺 BOM 会乱码
    expect(down.text.charCodeAt(0)).toBe(0xfeff);
    expect(down.text).toContain('QQ 聊天记录导出');
    expect(down.text).toContain('每天坚持阅读半小时');
  });

  it('群引用回复转发 + 「导出」：按群绑定项目归属，成员可下载', async () => {
    await Project.findByIdAndUpdate(projectId, { $push: { qqGroups: { groupOpenId: 'G1', types: [] } } });
    await User.findByIdAndUpdate(staff.user.id, {
      $push: { qqMemberIds: { groupOpenId: 'G1', memberOpenId: 'M1' } },
    });
    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'e3',
      group_openid: 'G1',
      content: '导出',
      message_type: 103,
      author: { member_openid: 'M1', username: 'Staff' },
      mentions: [{ bot: true }],
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: '周五前交海报' }],
    });
    const f = await File.findOne({ projectId });
    expect(f).toBeTruthy();
    expect(f!.uploadedBy.toString()).toBe(staff.user.id);
    expect(sendGroupMock).toHaveBeenCalledWith('G1', expect.stringContaining(`/dl/${f!._id}`), { msgId: 'e3' });
    const down = await request(app).get(`/api/files/${f!._id}`).set('Authorization', `Bearer ${staff.token}`);
    expect(down.status).toBe(200);
    expect(down.text).toContain('周五前交海报');
  });

  it('群导出触发但群未绑定项目 → 提示绑定且不建档', async () => {
    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'e4',
      group_openid: 'G-NOPE',
      content: '导出',
      message_type: 103,
      author: { member_openid: 'M9' },
      mentions: [{ bot: true }],
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: 'hi' }],
    });
    expect(sendGroupMock).toHaveBeenCalledWith('G-NOPE', expect.stringContaining('绑定'), { msgId: 'e4' });
    expect(await File.countDocuments()).toBe(0);
  });

  it('群普通引用消息（不含「导出」）不触发导出', async () => {
    await Project.findByIdAndUpdate(projectId, { $push: { qqGroups: { groupOpenId: 'G1', types: [] } } });
    await handleQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'e5',
      group_openid: 'G1',
      content: '收到',
      message_type: 103,
      author: { member_openid: 'M1' },
      mentions: [{ bot: true }],
      msg_elements: [{ message_type: 0, author: { username: '小明' }, content: 'hi' }],
    });
    expect(sendGroupMock).not.toHaveBeenCalled();
    expect(await File.countDocuments()).toBe(0);
  });

  it('PUBLIC_BASE_URL 未配置 → 回复配置缺失提示且不建档', async () => {
    config.publicBaseUrl = '';
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
    await handleQQEvent('C2C_MESSAGE_CREATE', { ...structuredForward, id: 'e6', author: { user_openid: 'U-C2C' } });
    expect(sendC2CMock).toHaveBeenCalledWith('U-C2C', expect.stringContaining('PUBLIC_BASE_URL'), { msgId: 'e6' });
    expect(await File.countDocuments()).toBe(0);
  });

  it('转发解析为空 → 回复「未能解析」且不建档', async () => {
    await User.findByIdAndUpdate(staff.user.id, { qqOpenId: 'U-C2C' });
    await handleQQEvent('C2C_MESSAGE_CREATE', {
      id: 'e7',
      author: { user_openid: 'U-C2C' },
      content: '[聊天记录]',
      message_type: 102,
      msg_elements: [],
    });
    expect(sendC2CMock).toHaveBeenCalledWith('U-C2C', expect.stringContaining('未能'), { msgId: 'e7' });
    expect(await File.countDocuments()).toBe(0);
  });
});
