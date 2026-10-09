import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { downloadFile } from '../api/client';
import { Button } from '@/components/ui/button';

/** QQ 聊天记录导出下载页：/dl/:id?name=... 进入即带主站登录态触发下载，未登录由 RequireAuth 跳登录 */
export default function DownloadFile() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const name = sp.get('name') ?? '聊天记录导出.md';
  const [err, setErr] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    downloadFile(id, name).catch((e) => setErr(e instanceof Error ? e.message : '下载失败'));
  }, [id, name]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      {err ? (
        <>
          <p className="text-destructive">{err}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            重试
          </Button>
        </>
      ) : (
        <>
          <Download className="h-8 w-8 animate-bounce text-muted-foreground" />
          <p className="text-sm text-muted-foreground">已开始下载「{name}」，如未开始请检查浏览器拦截后刷新重试。</p>
        </>
      )}
    </div>
  );
}
