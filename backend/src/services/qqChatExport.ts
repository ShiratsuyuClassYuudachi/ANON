import crypto from 'crypto';
import { Types } from 'mongoose';
import { File, type FileDoc } from '../models/File';
import { storeBuffer } from './storage';

/**
 * QQ 聊天记录（合并转发 message_type=102 / 引用 message_type=103）→ Markdown。
 * 解析为纯函数、无 IO，便于单测；exportMessagesToFile 负责落存储与 File 文档。
 * 事件形状见官方文档 group_message_create / c2c_message_create：msg_elements 递归，
 * 被引用内容嵌在 103 的 msg_elements 中（结构化元素或「=== 消息 N ===」扁平文本）。
 */

export interface ExportMessage {
  author: string;
  text: string;
  images: { url: string; name?: string }[];
  files?: { url: string; name: string }[];
  voiceText?: string;
  quote?: { author: string; text: string };
  card?: { title: string; desc?: string; url?: string };
}

export interface ParseResult {
  messages: ExportMessage[];
  truncated: boolean;
}

const MAX_MESSAGES = 500;
const MAX_TEXT = 4000;
const MAX_QUOTE_TEXT = 200;
const MAX_DEPTH = 3;

// 外部输入：全部窄化为可选字典后逐字段校验消费
type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function authorName(author: unknown): string {
  const a = asDict(author);
  const username = asStr(a?.username).trim();
  if (username) return username;
  const openid = asStr(a?.member_openid) || asStr(a?.user_openid) || asStr(a?.id);
  return openid ? openid.slice(0, 6) : '未知';
}

/** 扁平形态：「=== 消息 N ===」分块；[关联消息] 引入「--- 第N条 ---」子块，缩进层级 = 嵌套层级 */
const FLAT_TEST_RE = /===\s*消息\s*\d+\s*===/;
const RE_MSG_START = /^===\s*消息\s*\d+\s*===\s*$/;
const RE_SUB_START = /^---\s*第\s*\d+\s*条\s*---\s*$/;
const RE_FIELD = /^\[(消息内容|发送者|消息类型|关联消息)\]\s?([\s\S]*)$/;
const RE_ATTACH = /^\[附件\d+\]\s?([\s\S]*)$/;
const RE_ATTACH_URL = /(?:^|\s)URL:(\S+)/;
const RE_ATTACH_NAME = /文件名:(\S+)/;
// 「类型:视频 文件名:abc.mp4 尺寸:1140x640 大小:90.4MB [URL:...]」→ 类型/文件名/大小/URL（文件名可含空格）
const RE_ATTACH_META = /^类型:([^\s]+)\s+文件名:([\s\S]+?)(?:\s+尺寸:\S+)?\s+大小:([^\s]+)(?:\s+URL:(\S+))?\s*$/;

interface RawMsg {
  author: string;
  textLines: string[];
  type: string;
  attachLines: string[];
  children: RawMsg[];
}

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

function isSeparator(line: string): boolean {
  return RE_MSG_START.test(line) || RE_SUB_START.test(line);
}

/** 消费一个消息块：字段行 + 多行续行 + [关联消息] 子作用域；遇同级/上级分隔符或 dedent 停止 */
function parseFlatBlock(lines: string[], start: number, sepIndent: number): { msg: RawMsg; next: number } {
  const msg: RawMsg = { author: '未知', textLines: [], type: '', attachLines: [], children: [] };
  let inContent = false;
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    const ind = indentOf(raw);
    if (!line || ind < sepIndent || (isSeparator(line) && ind <= sepIndent)) {
      if (line) break;
      i++;
      continue;
    }
    if (line.startsWith('---')) {
      i++;
      continue; // 「---」开头行永不作续行
    }
    const field = RE_FIELD.exec(line);
    if (field) {
      inContent = field[1] === '消息内容';
      if (field[1] === '消息内容') {
        if (field[2]) msg.textLines.push(field[2]);
      } else if (field[1] === '发送者') {
        const name = field[2].trim();
        if (name) msg.author = name;
      } else if (field[1] === '消息类型') {
        msg.type = field[2].trim();
      } else {
        // [关联消息]：子块分隔符与本行同缩进，递归解析
        const sub = parseFlatScope(lines, i + 1, RE_SUB_START, ind);
        msg.children = sub.msgs;
        i = sub.next;
        continue;
      }
      i++;
      continue;
    }
    const attach = RE_ATTACH.exec(line);
    if (attach) {
      inContent = false;
      msg.attachLines.push(attach[1]);
      i++;
      continue;
    }
    if (line.startsWith('[卡片消息]')) {
      i++;
      continue; // 卡片压缩重复行（与多行摘要内容重复）
    }
    if (inContent) msg.textLines.push(line); // 多行正文续行
    i++;
  }
  return { msg, next: i };
}

/** 消费一段同级消息序列：sepRe 分隔、分隔符缩进 == sepIndent；前言/上级分隔符/dedent 交还上层 */
function parseFlatScope(
  lines: string[],
  start: number,
  sepRe: RegExp,
  sepIndent: number,
): { msgs: RawMsg[]; next: number } {
  const msgs: RawMsg[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    const ind = indentOf(raw);
    if (!line) {
      i++;
      continue;
    }
    if (sepRe.test(line) && ind === sepIndent) {
      const block = parseFlatBlock(lines, i + 1, sepIndent);
      msgs.push(block.msg);
      i = block.next;
      continue;
    }
    // 首个块之前的前言（如「[xxx的聊天记录]」标题）跳过；此后遇非本级内容交还上层
    if (msgs.length === 0 && ind >= sepIndent && !isSeparator(line)) {
      i++;
      continue;
    }
    break;
  }
  return { msgs, next: i };
}

/** RawMsg → ExportMessage：合并转发消息发 header 并递归展开（过深折叠占位）；其余 [关联消息] 子块作引用 */
function convertFlatMsg(raw: RawMsg, depth: number, out: ExportMessage[]): void {
  if (raw.type === '合并转发消息') {
    if (depth >= MAX_DEPTH) {
      out.push({ author: raw.author, text: '[嵌套聊天记录（层级过深，已略）]', images: [] });
      return;
    }
    out.push({ author: raw.author, text: `📁 ${raw.textLines.join('\n')}`.trimEnd(), images: [] });
    for (const child of raw.children) convertFlatMsg(child, depth + 1, out);
    return;
  }
  const textLines = [...raw.textLines];
  const images: { url: string; name?: string }[] = [];
  for (const att of raw.attachLines) {
    const meta = RE_ATTACH_META.exec(att);
    const url = meta?.[4] ?? RE_ATTACH_URL.exec(att)?.[1];
    const isImage = meta ? meta[1] === '图片' : att.includes('类型:图片');
    if (url && isImage) {
      images.push({ url, name: meta?.[2] ?? RE_ATTACH_NAME.exec(att)?.[1] });
    } else if (meta) {
      // 视频/文件等无下载链接：渲染为「[视频] 文件名（大小）」
      textLines.push(`[${meta[1]}] ${meta[2]}（${meta[3]}）`);
    } else {
      textLines.push(`[附件] ${att}`);
    }
  }
  const text = clip(textLines.join('\n'), MAX_TEXT);
  const quoteText = clip(
    raw.children
      .map((c) => c.textLines.join(' '))
      .filter(Boolean)
      .join(' / '),
    MAX_QUOTE_TEXT,
  );
  if (!text && images.length === 0 && !quoteText) return; // 空消息（仅发送者等）丢弃
  const msg: ExportMessage = { author: raw.author, text, images };
  if (quoteText) msg.quote = { author: '未知', text: quoteText };
  out.push(msg);
}

function parseFlat(content: string): ExportMessage[] | null {
  if (!FLAT_TEST_RE.test(content)) return null;
  // 首块前为「[xxx的聊天记录]」标题或空，由 parseFlatScope 作为前言跳过
  const { msgs } = parseFlatScope(content.split('\n'), 0, RE_MSG_START, 0);
  const out: ExportMessage[] = [];
  for (const m of msgs) convertFlatMsg(m, 1, out);
  return out.length > 0 ? out : null;
}

interface ParseBudget {
  left: number;
  truncated: boolean;
}

function parseElement(el: Dict, depth: number, budget: ParseBudget): ExportMessage[] {
  const content = asStr(el.content);
  // 扁平文本优先：一个元素可能承载整段转发的文本化内容
  const flat = content ? parseFlat(content) : null;
  if (flat) {
    if (flat.length > budget.left) budget.truncated = true;
    const out = flat.slice(0, budget.left);
    budget.left -= out.length;
    return out;
  }
  if (el.message_type === 102) {
    // 嵌套合并转发：深度内递归展开，过深折叠为占位（占位本身即标注，不算截断）
    if (depth >= MAX_DEPTH) {
      if (budget.left <= 0) {
        budget.truncated = true;
        return [];
      }
      budget.left -= 1;
      return [{ author: authorName(el.author), text: '[嵌套聊天记录（层级过深，已略）]', images: [] }];
    }
    return parseElements(el.msg_elements, depth + 1, budget);
  }
  if (budget.left <= 0) {
    if (elementHasContent(el)) budget.truncated = true;
    return [];
  }
  const msg: ExportMessage = { author: authorName(el.author), text: clip(content.trim(), MAX_TEXT), images: [] };
  for (const rawAtt of Array.isArray(el.attachments) ? el.attachments : []) {
    const att = asDict(rawAtt);
    if (!att) continue;
    const ct = asStr(att.content_type);
    const url = asStr(att.url);
    if (ct === 'voice') {
      const asr = asStr(att.asr_refer_text).trim();
      if (asr) msg.voiceText = clip(asr, MAX_TEXT);
    } else if (ct.startsWith('image/')) {
      if (url) msg.images.push({ url, name: asStr(att.filename) || undefined });
    } else if (url) {
      (msg.files ??= []).push({ url, name: asStr(att.filename) || '附件' });
    }
  }
  const ark = asDict(el.ark_data);
  if (ark) {
    const fields = asDict(ark.fields) ?? {};
    const title = asStr(fields.title) || asStr(ark.prompt) || asStr(ark.ark_name);
    if (title) {
      msg.card = { title, desc: asStr(fields.desc) || undefined, url: asStr(fields.jump_url) || undefined };
    }
  }
  if (el.message_type === 103) {
    const quoted = (Array.isArray(el.msg_elements) ? el.msg_elements : []).map(asDict).find(Boolean);
    if (quoted) {
      const quoteText = clip(asStr(quoted.content).trim(), MAX_QUOTE_TEXT);
      if (quoteText) msg.quote = { author: authorName(quoted.author), text: quoteText };
    }
  }
  // 内容全空（无文本/图片/语音/卡片/文件）的元素跳过
  if (!msg.text && msg.images.length === 0 && !msg.files?.length && !msg.voiceText && !msg.card && !msg.quote) return [];
  budget.left -= 1;
  return [msg];
}

/** 元素是否携带可消费内容（截断标注只统计有内容的丢弃） */
function elementHasContent(el: Dict): boolean {
  return Boolean(
    asStr(el.content).trim() ||
      (Array.isArray(el.attachments) && el.attachments.length > 0) ||
      (Array.isArray(el.msg_elements) && el.msg_elements.length > 0) ||
      asDict(el.ark_data),
  );
}

function parseElements(elements: unknown, depth: number, budget: ParseBudget): ExportMessage[] {
  const out: ExportMessage[] = [];
  for (const raw of Array.isArray(elements) ? elements : []) {
    if (budget.left <= 0) {
      const el = asDict(raw);
      if (el && elementHasContent(el)) budget.truncated = true;
      continue;
    }
    const el = asDict(raw);
    if (!el) continue;
    out.push(...parseElement(el, depth, budget));
  }
  return out;
}

/** 解析 102（合并转发）或 103（引用）事件载荷为归一化消息列表 */
export function parseForwardPayload(d: unknown): ParseResult {
  const payload = asDict(d);
  if (!payload) return { messages: [], truncated: false };
  const budget: ParseBudget = { left: MAX_MESSAGES, truncated: false };
  const messages = parseElements(payload.msg_elements, 1, budget);
  // 实测回退：C2C 合并转发无 msg_elements，整段拍平在顶层 content
  if (messages.length === 0) {
    const flat = parseFlat(asStr(payload.content));
    if (flat) {
      if (flat.length > budget.left) budget.truncated = true;
      return { messages: flat.slice(0, budget.left), truncated: budget.truncated };
    }
  }
  return { messages, truncated: budget.truncated };
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))}KB`;
}

/** 直发消息（收集模式）→ ExportMessage：图片附件即时抓取内嵌（URL 为短时效签名），视频/文件仅记元信息 */
export async function collectDirectMessage(
  content: string,
  attachments: unknown,
  author: string,
): Promise<ExportMessage[]> {
  const msg: ExportMessage = { author, text: clip(content.trim(), MAX_TEXT), images: [] };
  const textExtra: string[] = [];
  for (const rawAtt of Array.isArray(attachments) ? attachments : []) {
    const att = asDict(rawAtt);
    if (!att) continue;
    const ct = asStr(att.content_type);
    const url = asStr(att.url);
    const name = asStr(att.filename) || '未命名';
    if (ct === 'voice') {
      const asr = asStr(att.asr_refer_text).trim();
      if (asr) msg.voiceText = clip(asr, MAX_TEXT);
      continue;
    }
    if (ct.startsWith('image/')) {
      const r = url ? await fetchImageDataUri(url) : null;
      if (r) msg.images.push({ url: r.uri, name });
      else textExtra.push(`[图片] ${name}（临时链接已失效）`);
      continue;
    }
    // 视频/文件：体积大且链接短时效，仅记元信息
    const type = ct.startsWith('video/') ? '视频' : '文件';
    const size = typeof att.size === 'number' ? `（${humanSize(att.size)}）` : '';
    textExtra.push(`[${type}] ${name}${size}`);
  }
  msg.text = [msg.text, ...textExtra].filter(Boolean).join('\n');
  if (!msg.text && msg.images.length === 0 && !msg.voiceText) return [];
  return [msg];
}

/** 渲染为线性转录 markdown（首行标题含导出时间与条数；notes 追加为文末引用块） */
export function renderMarkdown(messages: ExportMessage[], truncated: boolean, notes: string[] = []): string {
  const exportedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const lines: string[] = [`# QQ 聊天记录导出（${exportedAt}，共 ${messages.length} 条）`, ''];
  for (const m of messages) {
    if (m.quote) lines.push(`> 引用 **${m.quote.author}**：${m.quote.text}`, '');
    lines.push(`**${m.author}**：`);
    if (m.text) lines.push(m.text);
    for (const img of m.images) lines.push(`![${img.name ?? '图片'}](${img.url})`);
    for (const f of m.files ?? []) lines.push(`[附件] ${f.name} (${f.url})`);
    if (m.voiceText) lines.push(`[语音] ${m.voiceText}`);
    if (m.card) {
      const parts = [`[链接卡片] ${m.card.title}`];
      if (m.card.desc) parts.push(` — ${m.card.desc}`);
      if (m.card.url) parts.push(` (${m.card.url})`);
      lines.push(parts.join(''));
    }
    lines.push('');
  }
  if (truncated) lines.push(`> 注：内容过多，已截断为前 ${MAX_MESSAGES} 条。`, '');
  for (const n of notes) lines.push(`> ${n}`, '');
  return lines.join('\n');
}

/** 图片抓取上限：QQ 图片链接为客户端上下文临时签名，过后即失效，须在导出时抓取内嵌 */
const EMBED_MAX_IMAGE = 8 * 1024 * 1024;
const EMBED_MAX_TOTAL = 30 * 1024 * 1024;
const EMBED_MAX_COUNT = 50;
const EMBED_CONCURRENCY = 4;

async function fetchImageDataUri(url: string): Promise<{ uri: string; bytes: number } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        Referer: 'https://multimedia.nt.qq.com.cn/',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > EMBED_MAX_IMAGE) return null;
    return { uri: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length };
  } catch {
    return null;
  }
}

/** 抓取远程图片并替换为 data URI（markdown 自包含）；失败/超限保留原链接 */
async function embedRemoteImages(messages: ExportMessage[]): Promise<{ embedded: number; failed: number }> {
  const targets: { url: string; name?: string }[] = [];
  for (const m of messages) for (const img of m.images) if (/^https?:\/\//.test(img.url)) targets.push(img);
  let embedded = 0;
  let failed = 0;
  let totalBytes = 0;
  for (let i = 0; i < targets.length; i += EMBED_CONCURRENCY) {
    await Promise.all(
      targets.slice(i, i + EMBED_CONCURRENCY).map(async (img) => {
        if (embedded + failed >= EMBED_MAX_COUNT || totalBytes >= EMBED_MAX_TOTAL) {
          failed++;
          return;
        }
        const r = await fetchImageDataUri(img.url);
        if (r) {
          img.url = r.uri;
          embedded++;
          totalBytes += r.bytes;
        } else {
          failed++;
        }
      }),
    );
  }
  return { embedded, failed };
}

/** markdown 落存储并创建 File 文档；projectId 缺省表示个人导出（仅本人/超管可下载） */
export async function exportMessagesToFile(
  messages: ExportMessage[],
  truncated: boolean,
  attribution: { projectId?: string | Types.ObjectId; uploadedBy: string | Types.ObjectId },
): Promise<FileDoc> {
  const { failed } = await embedRemoteImages(messages);
  const notes: string[] = [];
  if (messages.some((m) => /^\[(视频|文件|附件)\]/m.test(m.text))) {
    notes.push('注：QQ 合并转发不提供视频与文件的下载链接，此类附件仅保留文件名与大小。');
  }
  if (failed > 0) {
    // 抓取失败的图片是死链（QQ 客户端上下文签名，机器人无法下载）：转为文本占位，不在 markdown 里留死链
    for (const m of messages) {
      const dead = m.images.filter((img) => /^https?:/.test(img.url));
      if (!dead.length) continue;
      m.text = [m.text, ...dead.map((img) => `[图片] ${img.name ?? '未命名'}（临时链接已失效）`)].filter(Boolean).join('\n');
      m.images = m.images.filter((img) => !/^https?:/.test(img.url));
    }
    notes.push(`注：${failed} 张图片的链接为 QQ 客户端临时签名，机器人无法下载，已按「[图片] 文件名」保留。`);
  }
  const md = renderMarkdown(messages, truncated, notes);
  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .replace(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/, '$1$2$3-$4$5$6');
  const filename = `聊天记录导出-${stamp}.md`;
  const key = `qq-exports/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.md`;
  // 前置 BOM（EF BB BF）：GBK 默认环境（Windows 记事本等）据此识别 UTF-8，缺 BOM 会乱码
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(md, 'utf8')]);
  const ref = await storeBuffer(body, key, 'text/markdown; charset=utf-8');
  return File.create({
    ...(attribution.projectId ? { projectId: attribution.projectId } : {}),
    filename,
    path: ref,
    mime: 'text/markdown; charset=utf-8',
    size: body.length,
    uploadedBy: attribution.uploadedBy,
  });
}
