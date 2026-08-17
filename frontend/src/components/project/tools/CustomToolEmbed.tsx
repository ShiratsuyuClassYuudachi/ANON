import { useEffect, useRef } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { CustomTool } from '../../../types';
import { registerLaunchTarget } from '../../../lib/toolLaunch';
import { Button } from '@/components/ui/button';

interface Props {
  tool: CustomTool;
  /** passToken 工具的启动令牌；经 postMessage 握手投递，不进 URL */
  launchToken: string | null;
  onBack: () => void;
}

/**
 * 自定义工具页内嵌入视图：顶部操作行 + iframe（sandbox 不放行 top-navigation，防外部页劫持顶层跳转）。
 * iframe src 为干净登记 URL；passToken 令牌由 registerLaunchTarget 经握手投递。
 */
export default function CustomToolEmbed({ tool, launchToken, onBack }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!launchToken || !win) return;
    return registerLaunchTarget(win, tool.url, launchToken); // dispose 随卸载/依赖变化
  }, [launchToken, tool.url]);

  const openExternal = () => {
    if (tool.passToken && launchToken) {
      // 需要 opener 通道回发令牌，不能用 noreferrer（其实现隐含 noopener）；
      // 同一 5 分钟令牌投递给第二扇窗合法——插件后端兑换结果相同
      const w = window.open(tool.url, '_blank');
      if (w) registerLaunchTarget(w, tool.url, launchToken);
      return;
    }
    window.open(tool.url, '_blank', 'noreferrer');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{tool.name}</p>
          {tool.description && <p className="truncate text-sm text-muted-foreground">{tool.description}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={openExternal}>
          <ExternalLink className="size-4" /> 新窗口打开
        </Button>
      </div>
      <div className="h-[calc(100dvh-15rem)] min-h-96 overflow-hidden rounded-md border bg-background">
        <iframe
          ref={iframeRef}
          src={tool.url}
          title={tool.name}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          allow="clipboard-read; clipboard-write; fullscreen"
          className="h-full w-full"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        内容无法显示？对方站点可能禁止被嵌入（X-Frame-Options / frame-ancestors）。可点击「新窗口打开」，或让该站点在
        frame-ancestors 中允许本系统域名。
      </p>
    </div>
  );
}
