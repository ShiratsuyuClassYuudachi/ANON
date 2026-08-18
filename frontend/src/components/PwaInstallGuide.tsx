import { Share } from 'lucide-react';
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
          <DialogTitle>安装 ANON 到主屏幕</DialogTitle>
          <DialogDescription>安装后可从主屏幕一键打开，活动当天加载更快。</DialogDescription>
        </DialogHeader>
        {isIOS() ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li className="flex items-center gap-1">
              点 Safari 底部「分享」<Share className="inline size-4" aria-label="分享图标" />
            </li>
            <li>选择「添加到主屏幕」</li>
            <li>点右上角「添加」</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>打开浏览器菜单（右上角 ⋮ 或 ⋯）</li>
            <li>选择「安装应用」或「添加到主屏幕」</li>
            <li>按提示确认安装</li>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
