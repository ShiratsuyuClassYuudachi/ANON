import { cn } from '@/lib/utils';

/** 品牌标识：应用图标 + ANON 字样（图标与 PWA/主屏图标同源 /icons/icon-192.png） */
export default function Logo({
  className,
  size = 'md',
  wordmarkClassName,
}: {
  className?: string;
  size?: 'md' | 'lg';
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src="/icons/icon-192.png" alt="" className={cn('rounded-lg shadow-sm', size === 'lg' ? 'size-10' : 'size-7')} />
      <span className={cn('font-bold tracking-wide', size === 'lg' ? 'text-2xl' : 'text-lg', wordmarkClassName ?? 'text-primary')}>
        ANON
      </span>
    </span>
  );
}
