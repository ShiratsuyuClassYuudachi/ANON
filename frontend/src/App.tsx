import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Admin from './pages/Admin';
import InviteAccept from './pages/InviteAccept';
import Login from './pages/Login';
import Me from './pages/Me';
import ProjectHome from './pages/ProjectHome';
import Projects from './pages/Projects';
import Register from './pages/Register';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page">加载中…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
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
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/p/:id" element={<ProjectHome />} />
        <Route path="/me" element={<Me />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
    </Routes>
  );
}
