import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { CustomTool } from '../../../types';
import { Button } from '@/components/ui/button';

interface Props {
  tool: CustomTool;
  url: string;
  onBack: () => void;
}

/** 自定义工具页内嵌入视图：顶部操作行 + iframe（sandbox 不放行 top-navigation，防外部页劫持顶层跳转） */
export default function CustomToolEmbed({ tool, url, onBack }: Props) {
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
        <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
          <ExternalLink className="size-4" /> 新窗口打开
        </Button>
      </div>
      <div className="h-[calc(100dvh-15rem)] min-h-96 overflow-hidden rounded-md border bg-background">
        <iframe
          src={url}
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
