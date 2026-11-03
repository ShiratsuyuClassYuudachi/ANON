import type { ReactNode } from 'react';
import Logo from './Logo';
import { ModeToggle } from '../theme';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** 认证/邀请页共用壳：桌面双列品牌区与表单卡，移动端单列。 */
export default function AuthShell({ title, description, children, footer }: Props) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[.95fr_1.05fr]">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <aside className="hidden grid-rows-[auto_1fr] border-r bg-primary/5 p-12 text-foreground lg:grid xl:p-16">
        <Logo size="lg" />
        <div className="flex flex-col justify-center space-y-3">
          <h1 className="max-w-md text-[32px] font-bold leading-[40px] tracking-tight xl:text-[36px] xl:leading-[44px]">
            面向活动组织团队的全流程协作工具
          </h1>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            待办排期、财务分摊、物料资料、平台账号与现场执行，一个项目页全部装下。
          </p>
        </div>
      </aside>
      <main className="flex items-start justify-center px-4 pt-20 pb-10 lg:items-center lg:py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex flex-col items-start gap-2 lg:hidden">
            <Logo size="lg" />
            <p className="text-sm text-muted-foreground">面向活动组织团队的全流程协作工具</p>
          </div>
          <Card className="w-full shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              {children}
              {footer && <div className="mt-4 text-sm text-muted-foreground">{footer}</div>}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
