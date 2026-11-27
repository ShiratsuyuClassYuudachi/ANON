import { isIOS } from '../lib/pwaInstall';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * PWA 手动安装指引弹层（无输入框用 Dialog）。
 * 由「更多」Sheet 的「安装应用」入口在无法弹原生安装框时打开——Sheet 关闭会卸载子树，
 * 故本弹层须挂在 Sheet 外（ProjectHome 平级），由父级持有 open 状态。
 */
export default function PwaInstallGuide({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>将 ANON 添加到主屏幕</DialogTitle>
          <DialogDescription>添加后可像独立应用一样从桌面一键打开，活动现场弱网加载更稳。</DialogDescription>
        </DialogHeader>
        {isIOS() ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>点击浏览器底部的「分享」按钮</li>
            <li>在菜单中选择「添加到主屏幕」</li>
            <li>点击右上角「添加」完成</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>打开浏览器右上角菜单（⋮ 或 ⋯）</li>
            <li>选择「安装应用」或「添加到主屏幕」</li>
            <li>按提示确认即可</li>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
