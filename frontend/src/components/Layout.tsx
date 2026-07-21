import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ThemeToggle } from '../theme';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <>
      <header className="app-header">
        <strong>ANON</strong>
        <Link to="/projects">项目</Link>
        <Link to="/me">我的</Link>
        {user?.isSuperAdmin && <Link to="/admin">管理</Link>}
        <span className="spacer" />
        <ThemeToggle />
        <button
          className="ghost"
          onClick={() => {
            logout();
            nav('/login');
          }}
        >
          退出
        </button>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
