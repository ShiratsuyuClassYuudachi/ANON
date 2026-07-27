import { cn } from '@/lib/utils';

/** 品牌标识：渐变方块 + ANON 字样，随主题色变化 */
export default function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-sm font-black text-primary-foreground shadow-sm"
      >
        A
      </span>
      <span className="text-lg font-bold tracking-wide text-primary">ANON</span>
    </span>
  );
}
