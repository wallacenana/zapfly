import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const TrialBanner = ({ embedded = false, global = false, onActiveChange }) => {
  const [trial, setTrial] = useState(null);
  useEffect(() => {
    api.get('/billing/me').then(({ data }) => {
      const nextTrial = data?.trial || null;
      setTrial(nextTrial);
      onActiveChange?.(Boolean(nextTrial?.active));
    }).catch(() => onActiveChange?.(false));
  }, [onActiveChange]);
  if (!trial?.active) return null;
  return <div className={`trial-banner${embedded ? ' is-embedded' : ''}${global ? ' is-global' : ''}`}><Clock3 size={15} /><span>Trial: {trial.daysLeft} {trial.daysLeft === 1 ? 'dia restante' : 'dias restantes'}</span><Link to="/comprar">Assinar agora</Link></div>;
};

export default TrialBanner;
