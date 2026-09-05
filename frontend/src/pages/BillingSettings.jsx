import { useEffect, useState } from 'react';
import { api } from '../api';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';

const BillingSettings = () => {
  const [form, setForm] = useState({ trialEnabled: true, trialDays: 7 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/admin/billing/settings').then(({ data }) => setForm({ trialEnabled: data.trialEnabled, trialDays: data.trialDays })).catch(() => toast.error('Falha ao carregar cobrança.')); }, []);
  const save = async () => { setSaving(true); try { const { data } = await api.patch('/admin/billing/settings', form); setForm(data); toast.success('Configuração de trial salva.'); } catch (error) { toast.error(error?.response?.data?.error || 'Falha ao salvar.'); } finally { setSaving(false); } };
  return <div style={{ padding: 32, maxWidth: 850 }}><p style={{ color: 'var(--accent-primary)', fontWeight: 800, textTransform: 'uppercase' }}>Administração</p><h1>Planos e cobrança</h1><p style={{ color: 'var(--text-secondary)' }}>Os produtos recorrentes são criados no Abacate Pay e vinculados ao `.env` do backend.</p><section style={{ marginTop: 24, padding: 24, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 18 }}><h2>Período de teste</h2><label style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '20px 0' }}><input type="checkbox" checked={form.trialEnabled} onChange={(e) => setForm({ ...form, trialEnabled: e.target.checked })} /> Oferecer teste grátis</label><label style={{ display: 'grid', gap: 8, maxWidth: 260 }}>Dias de teste<input type="number" min="0" max="30" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} /></label><button onClick={save} disabled={saving} style={{ marginTop: 22, padding: '12px 18px', border: 0, borderRadius: 10, background: 'var(--accent-primary)', color: '#fff', fontWeight: 800 }}><Save size={16} /> {saving ? 'Salvando...' : 'Salvar configuração'}</button></section></div>;
};
export default BillingSettings;
