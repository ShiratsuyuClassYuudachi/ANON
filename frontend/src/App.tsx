import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api/client';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { OnboardingDialog } from './components/onboarding/OnboardingDialog';
import { startTour } from './components/onboarding/tour';
import { Skeleton } from './components/ui/skeleton';
import Admin from './pages/Admin';
import DocsPage from './pages/DocsPage';
import InviteAccept from './pages/InviteAccept';
import Login from './pages/Login';
import Me from './pages/Me';
import OnsitePage from './pages/OnsitePage';
import ProjectHome from './pages/ProjectHome';
import Projects from './pages/Projects';
import Register from './pages/Register';
import WorkSheetPrint from './pages/WorkSheetPrint';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function OnboardingGate() {
  const { user, refresh } = useAuth();
  const location = useLocation();
  const [showSlides, setShowSlides] = useState(false);
  useEffect(() => {
    if (user && !user.onboardedAt && location.pathname === '/projects') setShowSlides(true);
  }, [user, location.pathname]);
  const finish = async (tour: boolean) => {
    setShowSlides(false);
    try {
      await api('/api/me/onboarded', { method: 'POST', body: {} });
      await refresh();
    } catch {
      /* 落库失败不阻塞用户 */
    }
    if (tour) startTour(() => {});
  };
  if (!user) return null;
  return <OnboardingDialog open={showSlides} onSkip={() => finish(false)} onStartTour={() => finish(true)} />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/invite/:token"
          element={
            <RequireAuth>
              <InviteAccept />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:id/work-sheet/print"
          element={
            <RequireAuth>
              <WorkSheetPrint />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/p/:id" element={<ProjectHome />} />
          <Route path="/p/:id/onsite" element={<OnsitePage />} />
          <Route path="/me" element={<Me />} />
          <Route path="/help" element={<DocsPage />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
      <OnboardingGate />
    </>
  );
}
