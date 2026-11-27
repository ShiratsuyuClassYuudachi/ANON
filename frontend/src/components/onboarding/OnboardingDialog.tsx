import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SLIDES = [
  {
    title: '欢迎使用 ANON',
    body: '专为漫展、演出与同人企划团队打造的活动全流程协作工具。\n\n在这里，一场活动就是一个独立协作册，按「看板、待办、财务、物料、账号、现场、工具」清晰分章；每位成员按角色持有权限，界面只呈现与你相关的板块。',
  },
  {
    title: '四步跑通一场活动',
    body: '1. 立项建册：在「我的活动」新建活动并设定开展日期\n2. 召集伙伴：在「成员」生成邀请链接，临时支援人员无需注册也能直接建档排班\n3. 筹备推进：开展倒排追踪待办、登记收支自动算出平摊结算、归档两级分类设计稿与实物台账\n4. 现场收官：提前打印排班单，开展当天切入「现场模式」离线打卡、控台推进与登记失物',
  },
  {
    title: '随时查阅图文指南',
    body: '点击头像菜单中的「帮助中心」，即可按筹备全流程查阅图文教程并支持全文检索。\n\n接下来用一分钟带你快速认清各处入口（可随时跳过）。',
  },
];

export function OnboardingDialog({
  open,
  onSkip,
  onStartTour,
}: {
  open: boolean;
  onSkip: () => void;
  onStartTour: () => void;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) setIdx(0); }, [open]);
  const last = idx === SLIDES.length - 1;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSkip()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{SLIDES[idx].title}</DialogTitle>
          <DialogDescription className="sr-only">新手引导 {idx + 1}/{SLIDES.length}</DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-line text-sm leading-6">{SLIDES[idx].body}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>跳过</Button>
          {last ? (
            <Button size="sm" onClick={onStartTour}>开始导览</Button>
          ) : (
            <Button size="sm" onClick={() => setIdx(idx + 1)}>下一步</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
