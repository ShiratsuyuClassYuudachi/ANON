import { cn } from '@/lib/utils';

/** 品牌标识：应用图标 + ANON 字样（图标与 PWA/主屏图标同源 /icons/icon-192.png） */
export default function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src="/icons/icon-192.png" alt="" className="size-7 rounded-lg shadow-sm" />
      <span className="text-lg font-bold tracking-wide text-primary">ANON</span>
    </span>
  );
}
