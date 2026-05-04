import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      console.error('Auth error:', error);
      navigate('/?error=' + error, { replace: true });
      return;
    }

    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    login(token).finally(() => {
      navigate('/map', { replace: true });
    });
  }, [searchParams, login, navigate]);

  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>Logging you in...</p>
    </div>
  );
}
