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

/** 认证/邀请页共用壳：≥lg 左侧品牌区（随主题主色）+ 右侧表单卡；<lg 单列紧凑品牌头 */
export default function AuthShell({ title, description, children, footer }: Props) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 50% at 20% 0%, rgb(255 255 255 / 0.14), transparent), radial-gradient(ellipse 50% 40% at 90% 100%, rgb(0 0 0 / 0.12), transparent)',
          }}
        />
        <Logo
          size="lg"
          wordmarkClassName="text-primary-foreground"
          className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700"
        />
        <div className="relative space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
          <h1 className="max-w-md text-3xl font-bold leading-snug tracking-tight xl:text-4xl">
            面向活动组织团队的全流程协作工具
          </h1>
          <p className="max-w-sm text-sm text-primary-foreground/80">
            待办排期、财务分摊、物料资料、平台账号与现场执行，一个项目页全部装下。
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500">
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            <Logo size="lg" />
            <p className="text-sm text-muted-foreground">面向活动组织团队的全流程协作工具</p>
          </div>
          <Card className="w-full shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">{title}</CardTitle>
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
