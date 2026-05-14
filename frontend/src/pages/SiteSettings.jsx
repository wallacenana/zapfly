import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'react-hot-toast';
import { Palette, Upload, Globe, Save, RefreshCcw, Image as ImageIcon } from 'lucide-react';

const SiteSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    logoUrl: '',
    faviconUrl: '',
    accentColor: '#ff4d6d',
    buttonColor: '#ff4d6d',
    buttonTextColor: '#ffffff',
    backgroundColor: '#ffffff',
    textColor: '#333333',
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      if (res.data) {
        setSettings({
          logoUrl: res.data.logoUrl || '',
          faviconUrl: res.data.faviconUrl || '',
          accentColor: res.data.accentColor || '#ff4d6d',
          buttonColor: res.data.buttonColor || '#ff4d6d',
          buttonTextColor: res.data.buttonTextColor || '#ffffff',
          backgroundColor: res.data.backgroundColor || '#ffffff',
          textColor: res.data.textColor || '#333333',
        });
      }
    } catch (err) {
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/settings', settings);
      toast.success('Configurações salvas com sucesso!');
    } catch (err) {
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e, field) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/marketing/upload', formData);
      setSettings(prev => ({ ...prev, [field]: res.data.path }));
      toast.success('Upload concluído!');
    } catch (err) {
      toast.error('Erro no upload');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCcw className="animate-spin" /></div>;

  return (
    <div className="site-settings-container" style={{ maxWidth: '900px' }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Identidade Visual */}
        <div className="card" style={{ padding: '24px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-6" style={{ color: 'var(--primary-color)' }}>
            <Globe size={20} />
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Identidade Visual</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Logo do Cardápio</label>
              <div className="flex items-center gap-4">
                <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid #ddd' }}>
                  {settings.logoUrl ? <img src={settings.logoUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon color="#999" />}
                </div>
                <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Upload size={16} /> Alterar Logo
                  <input type="file" hidden onChange={(e) => handleFileUpload(e, 'logoUrl')} />
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Favicon (Ícone da Aba)</label>
              <div className="flex items-center gap-4">
                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid #ddd' }}>
                  {settings.faviconUrl ? <img src={settings.faviconUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon size={18} color="#999" />}
                </div>
                <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Upload size={16} /> Alterar Ícone
                  <input type="file" hidden onChange={(e) => handleFileUpload(e, 'faviconUrl')} />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Cores e Estilo */}
        <div className="card" style={{ padding: '24px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-6" style={{ color: 'var(--primary-color)' }}>
            <Palette size={20} />
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Cores e Estilo</h2>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <ColorInput label="Cor de Destaque (Accent)" value={settings.accentColor} onChange={(val) => setSettings({ ...settings, accentColor: val })} />
            <ColorInput label="Cor do Fundo" value={settings.backgroundColor} onChange={(val) => setSettings({ ...settings, backgroundColor: val })} />
            <ColorInput label="Cor do Texto Geral" value={settings.textColor} onChange={(val) => setSettings({ ...settings, textColor: val })} />
            <hr style={{ margin: '10px 0', borderColor: 'var(--border-color)' }} />
            <ColorInput label="Cor dos Botões" value={settings.buttonColor} onChange={(val) => setSettings({ ...settings, buttonColor: val })} />
            <ColorInput label="Cor do Texto do Botão" value={settings.buttonTextColor} onChange={(val) => setSettings({ ...settings, buttonTextColor: val })} />
          </div>
        </div>

      </div>

      {/* Preview Section */}
      <div className="card mt-8" style={{ padding: '24px', borderRadius: '16px', background: settings.backgroundColor, border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>Prévia do Botão</h3>
        <button style={{ 
          backgroundColor: settings.buttonColor, 
          color: settings.buttonTextColor, 
          padding: '12px 30px', 
          borderRadius: '12px', 
          border: 'none', 
          fontWeight: 700,
          boxShadow: `0 4px 14px ${settings.buttonColor}44`
        }}>
          Finalizar Pedido
        </button>
      </div>

      <div className="flex justify-end mt-8">
        <button 
          className="btn btn-primary" 
          onClick={handleSave} 
          disabled={saving}
          style={{ padding: '12px 40px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}
        >
          {saving ? <RefreshCcw className="animate-spin" /> : <Save size={20} />}
          {saving ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
};

const ColorInput = ({ label, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <label style={{ fontSize: '13px', fontWeight: 500 }}>{label}</label>
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <code style={{ fontSize: '12px', color: '#666' }}>{value.toUpperCase()}</code>
      <input 
        type="color" 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        style={{ border: 'none', padding: 0, width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', background: 'none' }}
      />
    </div>
  </div>
);

export default SiteSettings;
