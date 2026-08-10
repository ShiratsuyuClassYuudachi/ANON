import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  className: string;
  onClick: () => void;
  /** 默认取 label；同名行并列时测试/读屏需带上下文 */
  ariaLabel?: string;
}

interface SwipeCtl {
  open: boolean;
  toggle: () => void;
}

const ACTION_W = 72;

/**
 * 侧滑卡片：水平拖动（触屏/鼠标）从右缘拉出操作按钮，松手按阈值吸附开/关。
 * 触屏竖滚不受影响（touch-action: pan-y，方向判定后竖向手势让位浏览器）；
 * 打开后点击卡片内容或行外任意处收起；children render-prop 暴露 open/toggle 供行内放展开把手。
 */
export default function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: (ctl: SwipeCtl) => ReactNode }) {
  const width = actions.length * ACTION_W;
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; base: number; decided: boolean } | null>(null);
  const suppressClick = useRef(false);

  const snapTo = (o: boolean) => {
    setOpen(o);
    setOffset(o ? -width : 0);
  };

  // 打开后点击行外任意处收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) snapTo(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: offset, decided: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        gesture.current = null; // 竖向滚动让位
        return;
      }
      g.decided = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset(Math.max(-width, Math.min(0, g.base + dx)));
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g?.decided) return;
    suppressClick.current = true; // 拖动收尾的 click 不触发内容点击/收起
    snapTo(Math.abs(offset) > width * 0.4);
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      snapTo(false);
    }
  };

  return (
    <div ref={rootRef} className="relative overflow-hidden rounded-xl">
      <div data-slot="swipe-actions" className="absolute inset-y-0 right-0 flex" style={{ width }} aria-hidden={!open}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            tabIndex={open ? 0 : -1}
            aria-label={a.ariaLabel ?? a.label}
            className={`flex w-[72px] flex-col items-center justify-center gap-1 text-xs font-medium ${a.className}`}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
              snapTo(false);
            }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <div
        data-slot="swipe-content"
        className={`relative select-none ${dragging ? '' : 'transition-transform duration-200'}`}
        style={{ transform: `translateX(${offset}px)`, touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClickCapture={onClickCapture}
      >
        {children({ open, toggle: () => snapTo(!open) })}
      </div>
    </div>
  );
}
