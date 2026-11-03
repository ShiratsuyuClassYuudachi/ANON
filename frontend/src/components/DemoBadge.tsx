/** 演示环境角标：fixed 右下角，全页面常显（含登录页/现场模式）；打印时隐藏 */
export default function DemoBadge() {
  if (import.meta.env.VITE_DEMO !== 'true') return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 md:bottom-3 print:hidden" title="数据为示例，修改保留于本会话，关闭标签页即还原">
      <span className="rounded-full border border-warning/40 bg-warning/90 px-3 py-1 text-xs font-semibold text-warning-foreground shadow">
        演示环境
      </span>
    </div>
  );
}
