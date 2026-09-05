import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TrialBanner = () => {
  const [trial, setTrial] = useState(null);
  useEffect(() => {
    api.get('/billing/me').then(({ data }) => setTrial(data?.trial)).catch(() => {});
  }, []);
  if (!trial?.active) return null;
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, margin: '-32px -32px 28px', padding: '8px 22px', background: '#fff1dc', borderBottom: '1px solid #f4d7a8', color: '#9a5a00', fontSize: 13 }}><Clock3 size={16} /><span>Trial: {trial.daysLeft} {trial.daysLeft === 1 ? 'dia restante' : 'dias restantes'}</span><Link to="/comprar" style={{ marginLeft: 'auto', color: '#51300a', fontWeight: 800 }}>Assinar agora</Link></div>;
};

export default TrialBanner;
