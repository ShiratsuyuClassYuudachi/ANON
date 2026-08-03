/** 演示环境角标：fixed 右下角，全页面常显（含登录页/现场模式）；打印时隐藏 */
export default function DemoBadge() {
  if (import.meta.env.VITE_DEMO !== 'true') return null;
  return (
    <div className="fixed bottom-3 right-3 z-50 print:hidden" title="数据为示例，修改保留于本会话，关闭标签页即还原">
      <span className="rounded-full border border-amber-500/40 bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white shadow">
        演示环境
      </span>
    </div>
  );
}
