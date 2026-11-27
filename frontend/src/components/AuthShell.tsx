import type { ReactNode } from 'react';
import Logo from './Logo';
import { ModeToggle, StylePicker } from '../theme';

const BRAND_DESCRIPTION = '排期追踪、经费分摊、文件归档、账号保管与现场调度，集中在一册里协作。';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthShell({ title, description, children, footer }: Props) {
  return (
    <div className="editorial grid min-h-dvh bg-background md:grid-cols-[46%_54%]">
      <aside className="hidden grid-rows-[auto_1fr] border-r p-8 md:grid lg:p-12 xl:p-16">
        <Logo size="lg" />
        <div className="flex flex-col justify-center">
          <p className="editorial-title max-w-sm">把一场活动，从立项筹备排到现场收官</p>
          <hr className="mt-4 mb-4 w-10" />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{BRAND_DESCRIPTION}</p>
        </div>
      </aside>
      <main className="grid min-w-0 grid-rows-[auto_1fr] px-4 pt-3 pb-10 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">
          <Logo size="lg" className="md:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden md:inline-flex"><StylePicker /></span>
            <ModeToggle />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[23.75rem] pt-6 md:self-center md:py-10">
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground md:hidden">{BRAND_DESCRIPTION}</p>
          <header className="mb-6 space-y-2">
            <h1 className="editorial-title">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </header>
          {children}
          {footer && <div className="mt-5 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
