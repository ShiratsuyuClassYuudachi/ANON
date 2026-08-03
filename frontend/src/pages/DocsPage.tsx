import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { HELP_CHAPTERS } from '../components/help/content';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Hit {
  anchor: string; // 目标元素 id：小节为 `${chapterKey}-${index}`，整章为 chapterKey
  chapterKey: string;
  chapterTitle: string;
  heading?: string; // 小节标题（整章命中时无）
  snippet?: string; // 含命中词的段落摘录
}

/** 截取命中位置前后 30/50 字的摘录，保证命中词完整包含在窗口内 */
function snippetOf(p: string, q: string): string {
  const i = p.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, i - 30);
  const end = Math.min(p.length, i + q.length + 50);
  return `${start > 0 ? '…' : ''}${p.slice(start, end)}${end < p.length ? '…' : ''}`;
}

/** 高亮 text 中第一处 q（大小写不敏感） */
function Hi({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-500/40">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function DocsPage() {
  const [chapter, setChapter] = useState(HELP_CHAPTERS[0].key);
  const [zoom, setZoom] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const current = HELP_CHAPTERS.find((c) => c.key === chapter) ?? HELP_CHAPTERS[0];
  const q = query.trim();

  const hits = useMemo<Hit[]>(() => {
    if (!q) return [];
    const lq = q.toLowerCase();
    const out: Hit[] = [];
    for (const c of HELP_CHAPTERS) {
      if (c.title.toLowerCase().includes(lq)) {
        out.push({ anchor: c.key, chapterKey: c.key, chapterTitle: c.title });
      }
      c.sections.forEach((s, i) => {
        const hitHeading = s.heading?.toLowerCase().includes(lq);
        const para = s.paragraphs.find((p) => p.toLowerCase().includes(lq));
        if (!hitHeading && !para) return;
        out.push({
          anchor: `${c.key}-${i}`,
          chapterKey: c.key,
          chapterTitle: c.title,
          heading: s.heading,
          snippet: para ? snippetOf(para, q) : undefined,
        });
      });
    }
    return out;
  }, [q]);

  const jump = (h: Hit) => {
    setChapter(h.chapterKey);
    setQuery('');
    setAnchor(h.anchor);
  };

  // 手动切章（移动端下拉/桌面侧栏）：清空搜索并回页面顶部，避免残留上一章的滚动位置
  const switchChapter = (key: string) => {
    setChapter(key);
    setQuery('');
    window.scrollTo(0, 0);
  };

  // 跳转后滚动到目标并短暂高亮；anchor 用完即清空，保证重复点击同一结果仍触发
  useEffect(() => {
    if (!anchor) return;
    setAnchor(null);
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    setFlash(anchor);
  }, [anchor]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // 懒加载截图撑开布局后目标会漂移：高亮窗口内捕获图片 load 事件重新定位；用户主动滚动则停止校正
  useEffect(() => {
    if (!flash) return;
    const el = document.getElementById(flash);
    if (!el) return;
    const container = el.parentElement ?? el;
    const onLoad = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'IMG') el.scrollIntoView({ block: 'start' });
    };
    const cancel = () => container.removeEventListener('load', onLoad, true);
    container.addEventListener('load', onLoad, true);
    window.addEventListener('wheel', cancel, { passive: true, once: true });
    window.addEventListener('touchmove', cancel, { passive: true, once: true });
    return () => {
      cancel();
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchmove', cancel);
    };
  }, [flash]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">帮助文档</h2>

      {/* 全文搜索（移动端吸顶，桌面端随流）；移动端章节切换与搜索同排固定 */}
      <div className="sticky top-14 z-30 -mx-4 mt-0 bg-background px-4 pb-2 pt-4 md:static md:mx-0 md:mt-4 md:bg-transparent md:px-0 md:pb-0 md:pt-0">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索帮助内容…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              className="pl-8"
            />
          </div>
          {/* 移动端章节切换 */}
          <div className="w-32 shrink-0 md:hidden">
            <Select value={chapter} onValueChange={switchChapter}>
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
        </div>
      </div>

      {q ? (
        hits.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">没有与「{q}」匹配的内容</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">找到 {hits.length} 条相关内容</p>
            {hits.map((h) => (
              <button
                key={h.anchor}
                type="button"
                onClick={() => jump(h)}
                className="block w-full rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent"
              >
                <div className="text-xs text-muted-foreground">{h.chapterTitle}</div>
                {h.heading ? (
                  <div className="text-sm font-medium">
                    <Hi text={h.heading} q={q} />
                  </div>
                ) : (
                  !h.snippet && <div className="text-sm font-medium">{h.chapterTitle}（整章）</div>
                )}
                {h.snippet && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    <Hi text={h.snippet} q={q} />
                  </p>
                )}
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="flex items-start gap-4">
            {/* 桌面端章节列表（吸顶） */}
            <nav className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-40 shrink-0 flex-col gap-1 overflow-y-auto md:flex">
              {HELP_CHAPTERS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => switchChapter(c.key)}
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
            <div id={current.key} className="min-w-0 flex-1 scroll-mt-32 space-y-6 md:scroll-mt-20">
              {current.sections.map((s, i) => {
                const sid = `${current.key}-${i}`;
                return (
                  <section
                    key={i}
                    id={sid}
                    className={cn(
                      '-mx-2 scroll-mt-32 space-y-2 rounded-lg px-2 py-1 transition-colors md:scroll-mt-20',
                      flash === sid && 'bg-accent',
                    )}
                  >
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
                );
              })}
            </div>
          </div>
        </>
      )}

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
