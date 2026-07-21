import { useEffect, useState, type CSSProperties } from 'react';
import { getToken } from '../api/client';

interface Props {
  src: string;
  alt?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

/** 需登录鉴权的图片：fetch + Blob 转 objectURL 展示 */
export default function AuthImg({ src, alt, style, onClick }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    fetch(src, { headers: { Authorization: `Bearer ${getToken()}` } })
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

  if (failed) return null;
  if (!url) return <span className="muted">加载中…</span>;
  return <img src={url} alt={alt ?? ''} style={style} onClick={onClick} />;
}
