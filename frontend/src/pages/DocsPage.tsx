import { useState } from 'react';
import { HELP_CHAPTERS } from '../components/help/content';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function DocsPage() {
  const [chapter, setChapter] = useState(HELP_CHAPTERS[0].key);
  const [zoom, setZoom] = useState<string | null>(null);
  const current = HELP_CHAPTERS.find((c) => c.key === chapter) ?? HELP_CHAPTERS[0];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">帮助文档</h2>

      {/* 移动端章节切换 */}
      <div className="md:hidden">
        <Select value={chapter} onValueChange={setChapter}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HELP_CHAPTERS.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-4">
        {/* 桌面端章节列表 */}
        <nav className="hidden w-40 shrink-0 flex-col gap-1 md:flex">
          {HELP_CHAPTERS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChapter(c.key)}
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                c.key === chapter && 'bg-accent font-medium',
              )}
            >
              {c.title}
            </button>
          ))}
        </nav>

        {/* 内容区 */}
        <div className="min-w-0 flex-1 space-y-6">
          {current.sections.map((s, i) => (
            <section key={i} className="space-y-2">
              {s.heading && <h3 className="text-base font-semibold">{s.heading}</h3>}
              {s.paragraphs.map((p, j) => (
                <p key={j} className="text-sm leading-7">
                  {p}
                </p>
              ))}
              {s.image && (
                <button
                  type="button"
                  onClick={() => setZoom(s.image!.src)}
                  className="block w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`放大查看：${s.image.alt}`}
                >
                  <figure className="overflow-hidden rounded-lg border bg-card">
                    <img src={s.image.src} alt={s.image.alt} loading="lazy" className="w-full" />
                    {s.image.caption && (
                      <figcaption className="border-t px-3 py-2 text-xs text-muted-foreground">{s.image.caption}</figcaption>
                    )}
                  </figure>
                </button>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* 图片放大 */}
      <Dialog open={zoom !== null} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-5xl p-2">
          <DialogTitle className="sr-only">截图放大</DialogTitle>
          {zoom && <img src={zoom} alt="截图放大" className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
