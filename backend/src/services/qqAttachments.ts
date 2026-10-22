import path from 'path';
import { AppError } from '../utils/errors';

export const QQ_FILE_LIMIT = 20 * 1024 * 1024;
const badFile = (message: string) => new AppError(400, 'bad_request', message);

/** 仅从 QQ 附件 CDN 抓取，重定向逐跳复核，禁止任意 URL 和内网回源。 */
function attachmentUrl(raw: string): URL {
  const url = new URL(raw.startsWith('//') ? `https:${raw}` : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname;
  const allowed = host === 'multimedia.nt.qq.com.cn' || host === 'qpic.cn' || host.endsWith('.qpic.cn')
    || host === 'c2c-download.qq.com' || host.endsWith('.ftn.qq.com');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed) {
    throw badFile('附件地址不是受支持的 QQ 下载地址，请直接发送文件或图片。');
  }
  return url;
}

export async function downloadQqAttachment(raw: unknown, remaining: number): Promise<{ filename: string; mime: string; buffer: Buffer }> {
  if (!raw || typeof raw !== 'object') throw badFile('未收到有效附件，请重新发送。');
  const a = raw as Record<string, unknown>;
  if (typeof a.url !== 'string' || !a.url) throw badFile('QQ 未提供附件下载链接，请重新发送或在网页上传。');
  const limit = Math.min(QQ_FILE_LIMIT, remaining);
  if (typeof a.size === 'number' && a.size > limit) throw badFile('附件超限：单文件最多20MB，每次合计最多50MB。');
  let url = attachmentUrl(a.url);
  const signal = AbortSignal.timeout(20_000);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetch(url, { redirect: 'manual', signal, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
      Referer: 'https://multimedia.nt.qq.com.cn/',
    } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || hop === 3) throw badFile('附件下载重定向失败，请重新发送。');
      url = attachmentUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw badFile('附件链接已失效或下载失败，请重新发送。'); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw badFile('附件超出单文件20MB或本次50MB限制。'); }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw badFile('附件超出单文件20MB或本次50MB限制。');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!size) throw badFile('附件内容为空，请重新发送。');
    const mime = (typeof a.content_type === 'string' && a.content_type.includes('/') ? a.content_type
      : response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().slice(0, 100);
    const fallback = mime.startsWith('image/') ? `图片.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[mime] ?? 'bin'}` : 'QQ附件';
    const filename = path.posix.basename((typeof a.filename === 'string' ? a.filename : '').replace(/\\/g, '/'))
      .replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) || fallback;
    return { filename, mime, buffer: Buffer.concat(chunks, size) };
  }
  throw badFile('附件下载失败，请重新发送。');
}
