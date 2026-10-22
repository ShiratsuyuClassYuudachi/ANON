import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadQqAttachment, QQ_FILE_LIMIT } from '../src/services/qqAttachments';

const url = 'https://multimedia.nt.qq.com.cn/a?token=temporary';
const mock = () => {
  const fetcher = vi.fn(async () => new Response('abc', { headers: { 'content-type': 'text/plain' } }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
};
afterEach(() => vi.unstubAllGlobals());

describe('QQ 附件受限下载', () => {
  it.each(['https://127.0.0.1/a', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'https://multimedia.nt.qq.com.cn.evil.example/a', 'https://user:password@multimedia.nt.qq.com.cn/a', 'https://multimedia.nt.qq.com.cn:8443/a'])('下载前拒绝不可信地址 %s', async (raw) => {
    const f = mock(); await expect(downloadQqAttachment({ url: raw }, 50 * 1024 * 1024)).rejects.toThrow(); expect(f).not.toHaveBeenCalled();
  });
  it('QQ 相对协议链接可用，文件名去除路径和控制字符，保留中文', async () => {
    mock(); const result = await downloadQqAttachment({ url: '//gchat.qpic.cn/a', filename: '../资料\u0000.txt' }, 100);
    expect(result.filename).toBe('资料.txt'); expect(result.buffer.toString()).toBe('abc'); expect(result.mime).toBe('text/plain');
  });
  it('重定向到内网被阻止且不发第二次请求', async () => {
    const f = mock(); f.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://localhost/secrets' } }));
    await expect(downloadQqAttachment({ url }, 100)).rejects.toThrow(); expect(f).toHaveBeenCalledTimes(1);
  });
  it('QQ CDN 之间重定向受限跟随，环路最多四次请求', async () => {
    const f = mock(); f.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://gchat.qpic.cn/a' } }));
    expect((await downloadQqAttachment({ url }, 100)).buffer.toString()).toBe('abc'); expect(f).toHaveBeenCalledTimes(2);
    f.mockClear().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(downloadQqAttachment({ url }, 100)).rejects.toThrow('重定向失败'); expect(f).toHaveBeenCalledTimes(4);
  });
  it('依据流中实际字节限制大小，忽略伪造的小 content-length', async () => {
    const f = mock(); f.mockResolvedValueOnce(new Response('123456', { headers: { 'content-length': '1' } }));
    await expect(downloadQqAttachment({ url }, 5)).rejects.toThrow('超出');
    f.mockResolvedValueOnce(new Response('a', { headers: { 'content-length': String(QQ_FILE_LIMIT + 1) } }));
    await expect(downloadQqAttachment({ url }, 50 * 1024 * 1024)).rejects.toThrow('超出');
  });
  it('下载失败、空内容和没有下载链接均不返回文件', async () => {
    const f = mock(); f.mockResolvedValueOnce(new Response('过期', { status: 403 }));
    await expect(downloadQqAttachment({ url }, 100)).rejects.toThrow('已失效');
    f.mockResolvedValueOnce(new Response(''));
    await expect(downloadQqAttachment({ url }, 100)).rejects.toThrow('内容为空');
    await expect(downloadQqAttachment({ filename: 'a.txt' }, 100)).rejects.toThrow('未提供');
  });
});
