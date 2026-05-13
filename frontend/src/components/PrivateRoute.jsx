import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function PrivateRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#09090b'
      }}>
        <Loader2 size={40} color="#3b82f6" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
