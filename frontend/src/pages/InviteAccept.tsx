import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ThemeToggle } from '../theme';

interface InviteInfo {
  projectName: string;
  roleName: string;
  expiresAt: string;
  targeted: boolean;
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ invite: InviteInfo }>(`/api/invites/${token}`)
      .then((d) => setInfo(d.invite))
      .catch((e) => setErr(e.message));
  }, [token]);

  const accept = async () => {
    try {
      const d = await api<{ projectId: string }>(`/api/invites/${token}/accept`, { body: {} });
      nav(`/p/${d.projectId}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <ThemeToggle />
      <h1>项目邀请</h1>
      {err && <p className="error">{err}</p>}
      {info && (
        <div className="card">
          <p>
            邀请你加入 <strong>{info.projectName}</strong>，身份为 <span className="chip">{info.roleName}</span>
          </p>
          <p className="muted">有效期至 {info.expiresAt.slice(0, 10)}</p>
          <button onClick={accept}>接受邀请</button>
        </div>
      )}
    </div>
  );
}
