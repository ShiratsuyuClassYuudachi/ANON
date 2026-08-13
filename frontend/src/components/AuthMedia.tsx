import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { authorizedFetch } from '../api/client';

/** 需登录鉴权的资源：fetch + Blob 转 objectURL（AuthImg/AuthMedia 共用） */
export function useAuthorizedObjectUrl(src: string): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    authorizedFetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return { url, failed };
}

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown';

/** mime（+文件名兜底）→ 预览渲染类别；服务端 hasPreview 已按白名单把关，前端仅按前缀归类，不维护第二份白名单 */
export function previewKindOf(mime: string | undefined | null, filename?: string | null): PreviewKind | null {
  if (mime?.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'text/markdown' || (filename != null && /\.(md|markdown)$/i.test(filename))) return 'markdown';
  return null;
}

// 仓库无 @tailwindcss/typography，就地映射 react-markdown 元素样式
const mdComponents: Components = {
  h1: (p) => <h1 className="mb-3 mt-4 text-xl font-bold" {...p} />,
  h2: (p) => <h2 className="mb-2 mt-4 text-lg font-semibold" {...p} />,
  h3: (p) => <h3 className="mb-2 mt-3 text-base font-semibold" {...p} />,
  p: (p) => <p className="mb-2 leading-6" {...p} />,
  a: (p) => <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />,
  ul: (p) => <ul className="mb-2 list-disc pl-5" {...p} />,
  ol: (p) => <ol className="mb-2 list-decimal pl-5" {...p} />,
  li: (p) => <li className="mb-0.5" {...p} />,
  code: (p) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]" {...p} />,
  pre: (p) => <pre className="mb-2 overflow-auto rounded bg-muted p-3 text-xs" {...p} />,
  blockquote: (p) => <blockquote className="mb-2 border-l-2 pl-3 text-muted-foreground" {...p} />,
  hr: (p) => <hr className="my-3" {...p} />,
  table: (p) => <table className="mb-2 border-collapse text-sm" {...p} />,
  th: (p) => <th className="border px-2 py-1 text-left" {...p} />,
  td: (p) => <td className="border px-2 py-1 text-left" {...p} />,
};

interface Props {
  src: string;
  kind: 'pdf' | 'video' | 'audio' | 'markdown';
  alt?: string;
  className?: string;
}

/** 需登录鉴权的非图片预览：PDF iframe / 音视频标签 / Markdown 渲染；解码或拉取失败走统一失败态 */
export default function AuthMedia({ src, kind, alt, className }: Props) {
  const { url, failed: fetchFailed } = useAuthorizedObjectUrl(src);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState<string | null>(null);

  // markdown 需要文本而非 objectURL
  useEffect(() => {
    if (kind !== 'markdown') return;
    let cancelled = false;
    setText(null);
    setFailed(false);
    authorizedFetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, kind]);

  // markdown 文本解码失败（如 ProRes mov）也走同一失败态
  const broken = failed || (kind !== 'markdown' && fetchFailed);
  if (broken) {
    return <p className="p-4 text-sm text-muted-foreground">无法预览该文件，请下载后查看。</p>;
  }
  if (kind === 'markdown') {
    if (text === null) return <span className="text-sm text-muted-foreground">加载中…</span>;
    return (
      <div className={className}>
        <ReactMarkdown components={mdComponents}>{text}</ReactMarkdown>
      </div>
    );
  }
  if (!url) return <span className="text-sm text-muted-foreground">加载中…</span>;
  if (kind === 'pdf') return <iframe src={url} title={alt ?? ''} className={className} />;
  if (kind === 'video') {
    return <video src={url} controls className={className} onError={() => setFailed(true)} />;
  }
  return <audio src={url} controls className={className} onError={() => setFailed(true)} />;
}
