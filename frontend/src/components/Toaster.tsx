import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/theme';

export function Toaster() {
  const { mode } = useTheme();
  return <SonnerToaster theme={mode} position="top-center" richColors closeButton />;
}
