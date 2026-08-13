import type { CSSProperties } from 'react';
import { useAuthorizedObjectUrl } from './AuthMedia';

interface Props {
  src: string;
  alt?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

/** 需登录鉴权的图片：fetch + Blob 转 objectURL 展示 */
export default function AuthImg({ src, alt, style, onClick }: Props) {
  const { url, failed } = useAuthorizedObjectUrl(src);
  if (failed) return null;
  if (!url) return <span className="text-sm text-muted-foreground">加载中…</span>;
  return <img src={url} alt={alt ?? ''} style={style} onClick={onClick} />;
}
