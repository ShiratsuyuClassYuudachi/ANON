import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SLIDES = [
  {
    title: '欢迎使用 ANON',
    body: '面向活动组织团队的全流程协作工具。\n\n核心概念很简单：一个「项目」就是一场活动；项目内按 Tab 分区（待办/财务/物料/账号/现场）；每个成员有角色，角色决定权限——你只会看到有权限的功能。',
  },
  {
    title: '四步快速上手',
    body: '1. 建项目：首页「新建项目」，填名称与日期\n2. 邀请成员：项目内「成员」Tab 生成邀请链接发给伙伴\n3. 开工：待办追踪进度、财务记账分摊、物料管理版本、账号记录平台密码\n4. 现场：建任务模块分配人力，成员确认后打印任务单发放',
  },
  {
    title: '随时可查的文档中心',
    body: '右上角头像菜单 →「帮助文档」，每个功能都有图文说明与真实截图。\n\n接下来将带你快速浏览界面要点（可随时跳过）。',
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
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {SLIDES.map((_, i) => (
              <span key={i} className={`size-1.5 rounded-full ${i === idx ? 'bg-primary' : 'bg-muted'}`} />
            ))}
          </div>
          <span className="flex-1" />
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
