import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BellRing,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  HardHat,
  Info,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Rocket,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import {
  HELP_CHAPTERS,
  HELP_GROUPS,
  HELP_QUICK_TOPICS,
  type HelpCalloutTone,
  type HelpChapter,
  type HelpIconName,
  type HelpSection,
} from '../components/help/content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ICONS: Record<HelpIconName, LucideIcon> = {
  Rocket,
  Route,
  LayoutDashboard,
  ListChecks,
  Wallet,
  FolderKanban,
  KeyRound,
  HardHat,
  Sparkles,
  BellRing,
  ShieldCheck,
};

interface SearchHit {
  anchor: string;
  chapterKey: string;
  chapterTitle: string;
  groupLabel: string;
  heading?: string;
  snippet?: string;
}

/** 去除轻量内联标记（`**bold**` 与 `` `code` ``），用于纯文本检索与摘要截取 */
function stripInlineMarkup(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/** 安全渲染轻量内联标记：支持 **加粗** 与 `内联代码/权限点`，不解析任何 HTML */
function RichText({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {tok.slice(2, -2)}
            </strong>
          );
        }
        if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-foreground"
            >
              {tok.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={i}>{tok}</Fragment>;
      })}
    </>
  );
}

/** 截取命中词前后上下文摘录 */
function buildSnippet(raw: string, query: string): string {
  const clean = stripInlineMarkup(raw);
  const idx = clean.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return clean.slice(0, 90);
  const start = Math.max(0, idx - 28);
  const end = Math.min(clean.length, idx + query.length + 52);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

/** 搜索结果关键词高亮（大小写不敏感） */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const clean = stripInlineMarkup(text);
  const q = query.trim();
  if (!q) return clean;
  const idx = clean.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return clean;
  return (
    <>
      {clean.slice(0, idx)}
      <mark className="rounded-sm bg-warning-soft px-0.5 font-medium text-warning-soft-foreground">
        {clean.slice(idx, idx + q.length)}
      </mark>
      {clean.slice(idx + q.length)}
    </>
  );
}

/** 提取小节内全部可检索文本块 */
function sectionTexts(s: HelpSection): string[] {
  const blocks: string[] = [];
  if (s.summary) blocks.push(s.summary);
  if (s.paragraphs) blocks.push(...s.paragraphs);
  if (s.steps) blocks.push(...s.steps);
  if (s.bullets) {
    for (const b of s.bullets) blocks.push(b.label ? `${b.label}：${b.text}` : b.text);
  }
  if (s.table) {
    blocks.push(s.table.headers.join(' · '));
    for (const row of s.table.rows) blocks.push(row.join(' · '));
  }
  if (s.callout) blocks.push(s.callout.title ? `${s.callout.title}：${s.callout.text}` : s.callout.text);
  if (s.image?.caption) blocks.push(s.image.caption);
  return blocks;
}

const CALLOUT_STYLES: Record<HelpCalloutTone, { icon: LucideIcon; box: string; iconCls: string }> = {
  tip: {
    icon: Lightbulb,
    box: 'border-primary/25 bg-primary/5',
    iconCls: 'text-primary',
  },
  info: {
    icon: Info,
    box: 'border-border bg-muted/50',
    iconCls: 'text-muted-foreground',
  },
  warning: {
    icon: AlertTriangle,
    box: 'border-warning/35 bg-warning-soft/50',
    iconCls: 'text-warning-soft-foreground',
  },
};

export default function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramChapter = searchParams.get('chapter');
  const activeKey = HELP_CHAPTERS.some((c) => c.key === paramChapter) ? paramChapter! : HELP_CHAPTERS[0].key;

  const [query, setQuery] = useState('');
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<{ src: string; alt: string; caption?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentIdx = Math.max(
    0,
    HELP_CHAPTERS.findIndex((c) => c.key === activeKey),
  );
  const current: HelpChapter = HELP_CHAPTERS[currentIdx] ?? HELP_CHAPTERS[0];
  const prevChapter = currentIdx > 0 ? HELP_CHAPTERS[currentIdx - 1] : null;
  const nextChapter = currentIdx < HELP_CHAPTERS.length - 1 ? HELP_CHAPTERS[currentIdx + 1] : null;
  const currentGroupLabel = HELP_GROUPS.find((g) => g.key === current.group)?.label ?? '';
  const ChapterIcon = ICONS[current.icon];

  const q = query.trim();

  // 按 `/` 快捷键聚焦搜索框（不在输入框内时）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 全文检索索引：覆盖标题、导语、段落、步骤、列表、表格与提示框
  const hits = useMemo<SearchHit[]>(() => {
    if (!q) return [];
    const lq = q.toLowerCase();
    const results: SearchHit[] = [];
    for (const ch of HELP_CHAPTERS) {
      const groupLabel = HELP_GROUPS.find((g) => g.key === ch.group)?.label ?? '';
      const titleHit = ch.title.toLowerCase().includes(lq);
      const subHit = stripInlineMarkup(ch.subtitle).toLowerCase().includes(lq);
      if (titleHit || subHit) {
        results.push({
          anchor: ch.key,
          chapterKey: ch.key,
          chapterTitle: ch.title,
          groupLabel,
          snippet: subHit ? buildSnippet(ch.subtitle, q) : ch.subtitle,
        });
      }
      for (const sec of ch.sections) {
        const anchor = `${ch.key}-${sec.id}`;
        const headingHit = sec.heading.toLowerCase().includes(lq);
        const matchedBlock = sectionTexts(sec).find((b) => stripInlineMarkup(b).toLowerCase().includes(lq));
        if (!headingHit && !matchedBlock) continue;
        results.push({
          anchor,
          chapterKey: ch.key,
          chapterTitle: ch.title,
          groupLabel,
          heading: sec.heading,
          snippet: matchedBlock ? buildSnippet(matchedBlock, q) : sec.summary,
        });
      }
    }
    return results;
  }, [q]);

  const switchChapter = (key: string) => {
    setQuery('');
    setSearchParams(key === HELP_CHAPTERS[0].key ? {} : { chapter: key }, { replace: false });
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const jumpToSection = (chapterKey: string, sectionId?: string) => {
    setQuery('');
    setSearchParams(chapterKey === HELP_CHAPTERS[0].key ? {} : { chapter: chapterKey }, { replace: false });
    const targetAnchor = sectionId ? `${chapterKey}-${sectionId}` : chapterKey;
    setPendingAnchor(targetAnchor);
  };

  const jumpFromHit = (hit: SearchHit) => {
    setQuery('');
    setSearchParams(hit.chapterKey === HELP_CHAPTERS[0].key ? {} : { chapter: hit.chapterKey }, { replace: false });
    setPendingAnchor(hit.anchor);
  };

  // 切章渲染完成后滚动至锚点并触发短暂高亮
  useEffect(() => {
    if (!pendingAnchor) return;
    const target = pendingAnchor;
    setPendingAnchor(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      setFlashId(target);
    });
  }, [pendingAnchor, activeKey]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1800);
    return () => clearTimeout(timer);
  }, [flashId]);

  // 懒加载图片撑高页面时二次校正锚点位置；用户主动滚动立即释放
  useEffect(() => {
    if (!flashId) return;
    const el = document.getElementById(flashId);
    if (!el) return;
    const root = el.parentElement ?? el;
    const onImgLoad = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'IMG') el.scrollIntoView({ block: 'start' });
    };
    const stop = () => root.removeEventListener('load', onImgLoad, true);
    root.addEventListener('load', onImgLoad, true);
    window.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('touchmove', stop, { passive: true, once: true });
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
    };
  }, [flashId]);

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">帮助中心与使用教程</h2>
            <p className="text-xs text-muted-foreground sm:text-sm">
              覆盖活动全流程实战打法与全部模块操作指南 · 共 {HELP_CHAPTERS.length} 章
            </p>
          </div>
        </div>
      </div>

      {/* 搜索与移动端章节切换栏（移动端吸顶，保留 data-tour 锚点供引导导览高亮） */}
      <div
        className="sticky top-14 z-30 -mx-4 bg-background/95 px-4 pb-2.5 pt-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
        data-tour="docs-content"
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="搜索功能、操作步骤、QQ 指令或权限（按 / 快速聚焦）…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* 移动端章节下拉切换 */}
          <div className="w-36 shrink-0 md:hidden">
            <Select value={activeKey} onValueChange={switchChapter}>
              <SelectTrigger className="w-full" aria-label="选择帮助章节">
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

        {/* 热门话题直达（仅桌面或非搜索态展示紧凑横向条） */}
        {!q && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 max-md:hidden">
            <span className="text-xs text-muted-foreground">高频直达：</span>
            {HELP_QUICK_TOPICS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => jumpToSection(t.chapterKey, t.sectionId)}
                className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 搜索结果态 vs 章节阅读态 */}
      {q ? (
        hits.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">没有找到与「{q}」相关的说明</p>
              <p className="text-xs text-muted-foreground">可尝试换用更简短的关键词，如「倒排」「分摊」「大屏」「失物」「绑定码」</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setQuery('')}>
                返回章节目录
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>找到 {hits.length} 条匹配内容，点击直达对应段落</span>
              <button type="button" onClick={() => setQuery('')} className="hover:text-foreground hover:underline">
                退出搜索（Esc）
              </button>
            </div>
            {hits.map((h) => (
              <button
                key={h.anchor}
                type="button"
                onClick={() => jumpFromHit(h)}
                className="block w-full rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/60"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[11px] font-normal">
                    {h.groupLabel}
                  </Badge>
                  <span>{h.chapterTitle}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {h.heading ? <Highlight text={h.heading} query={q} /> : <Highlight text={`${h.chapterTitle}（章节概览）`} query={q} />}
                </div>
                {h.snippet && (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    <Highlight text={h.snippet} query={q} />
                  </p>
                )}
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="flex items-start gap-6">
          {/* 桌面端分组侧边目录（吸顶） */}
          <nav
            aria-label="帮助章节导航"
            className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-52 shrink-0 flex-col gap-4 overflow-y-auto pr-1 md:flex"
          >
            {HELP_GROUPS.map((grp) => {
              const items = HELP_CHAPTERS.filter((c) => c.group === grp.key);
              return (
                <div key={grp.key} className="space-y-1">
                  <div className="px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {grp.label}
                  </div>
                  {items.map((c) => {
                    const Icon = ICONS[c.icon];
                    const active = c.key === activeKey;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => switchChapter(c.key)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground/80 hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{c.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* 正文阅读区 */}
          <article id={current.key} className="min-w-0 flex-1 scroll-mt-32 space-y-5 md:scroll-mt-20">
            {/* 章节题头卡 + 本章小节锚点 */}
            <Card>
              <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ChapterIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-muted-foreground">{currentGroupLabel}</div>
                    <h3 className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">{current.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      <RichText text={current.subtitle} />
                    </p>
                  </div>
                </div>

                {current.sections.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
                    <span className="text-xs text-muted-foreground">本章小节：</span>
                    {current.sections.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => jumpToSection(current.key, sec.id)}
                        className="rounded-md bg-muted/70 px-2.5 py-1 text-xs text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {sec.heading}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 各小节内容卡片 */}
            {current.sections.map((sec, idx) => {
              const sid = `${current.key}-${sec.id}`;
              const CalloutIcon = sec.callout ? CALLOUT_STYLES[sec.callout.tone].icon : null;
              return (
                <section
                  key={sec.id}
                  id={sid}
                  className={cn(
                    'scroll-mt-32 rounded-xl border bg-card p-4 transition-colors sm:p-5 md:scroll-mt-20',
                    flashId === sid && 'ring-2 ring-primary/50 bg-accent/30',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <h4 className="text-base font-semibold tracking-tight">{sec.heading}</h4>
                  </div>

                  {sec.summary && (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      <RichText text={sec.summary} />
                    </p>
                  )}

                  {sec.paragraphs && sec.paragraphs.length > 0 && (
                    <div className="mt-3 space-y-2.5">
                      {sec.paragraphs.map((p, pi) => (
                        <p key={pi} className="break-words text-sm leading-7 text-foreground/90">
                          <RichText text={p} />
                        </p>
                      ))}
                    </div>
                  )}

                  {sec.steps && sec.steps.length > 0 && (
                    <ol className="mt-3.5 space-y-2.5">
                      {sec.steps.map((step, si) => (
                        <li key={si} className="flex items-start gap-2.5 text-sm leading-7">
                          <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                            {si + 1}
                          </span>
                          <span className="min-w-0 flex-1 break-words text-foreground/90">
                            <RichText text={step} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {sec.bullets && sec.bullets.length > 0 && (
                    <ul className="mt-3.5 space-y-2.5">
                      {sec.bullets.map((b, bi) => (
                        <li key={bi} className="flex items-start gap-2.5 text-sm leading-7">
                          <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                          <span className="min-w-0 flex-1 break-words text-foreground/90">
                            {b.label && (
                              <strong className="font-semibold text-foreground">{b.label}：</strong>
                            )}
                            <RichText text={b.text} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {sec.table && (
                    <div className="mt-4 overflow-x-auto rounded-lg border">
                      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            {sec.table.headers.map((th, ti) => (
                              <th key={ti} className="px-3 py-2.5 text-xs font-semibold text-foreground">
                                {th}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {sec.table.rows.map((row, ri) => (
                            <tr key={ri} className="align-top">
                              {row.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className={cn(
                                    'px-3 py-2.5 leading-relaxed break-words',
                                    ci === 0 ? 'whitespace-nowrap font-medium text-foreground' : 'text-foreground/85',
                                  )}
                                >
                                  <RichText text={cell} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sec.callout && CalloutIcon && (
                    <div
                      className={cn(
                        'mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed',
                        CALLOUT_STYLES[sec.callout.tone].box,
                      )}
                    >
                      <CalloutIcon className={cn('mt-0.5 size-4 shrink-0', CALLOUT_STYLES[sec.callout.tone].iconCls)} />
                      <div className="min-w-0 flex-1 space-y-0.5 break-words">
                        {sec.callout.title && (
                          <div className="font-semibold text-foreground">{sec.callout.title}</div>
                        )}
                        <div className="text-foreground/85">
                          <RichText text={sec.callout.text} />
                        </div>
                      </div>
                    </div>
                  )}

                  {sec.image && (
                    <button
                      type="button"
                      onClick={() => setZoomImage(sec.image!)}
                      className="group mt-4 block w-full cursor-zoom-in rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`放大查看：${sec.image.alt}`}
                    >
                      <figure className="overflow-hidden rounded-lg border bg-muted/20">
                        <div className="relative">
                          <img src={sec.image.src} alt={sec.image.alt} loading="lazy" className="w-full" />
                          <span className="pointer-events-none absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-opacity group-hover:text-foreground">
                            <ZoomIn className="size-3.5" />
                            点击放大
                          </span>
                        </div>
                        {sec.image.caption && (
                          <figcaption className="border-t bg-card px-3 py-2 text-xs text-muted-foreground">
                            {sec.image.caption}
                          </figcaption>
                        )}
                      </figure>
                    </button>
                  )}
                </section>
              );
            })}

            {/* 章节底部上一章 / 下一章切换卡 */}
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              {prevChapter ? (
                <button
                  type="button"
                  onClick={() => switchChapter(prevChapter.key)}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/60"
                >
                  <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">上一章</div>
                    <div className="truncate text-sm font-medium text-foreground">{prevChapter.title}</div>
                  </div>
                </button>
              ) : (
                <div className="hidden sm:block" />
              )}

              {nextChapter && (
                <button
                  type="button"
                  onClick={() => switchChapter(nextChapter.key)}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-right transition-colors hover:border-primary/40 hover:bg-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">下一章</div>
                    <div className="truncate text-sm font-medium text-foreground">{nextChapter.title}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              )}
            </div>
          </article>
        </div>
      )}

      {/* 截图全屏放大弹窗 */}
      <Dialog open={zoomImage !== null} onOpenChange={(open) => !open && setZoomImage(null)}>
        <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto p-3 sm:p-4">
          <DialogTitle className="text-sm font-medium">{zoomImage?.alt ?? '界面截图预览'}</DialogTitle>
          {zoomImage && (
            <div className="space-y-2">
              <img src={zoomImage.src} alt={zoomImage.alt} className="w-full rounded-md border" />
              {zoomImage.caption && <p className="text-xs text-muted-foreground">{zoomImage.caption}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
