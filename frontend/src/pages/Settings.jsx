import React, { useState, useEffect } from 'react';
import { Save, Key, Shield, Cpu, Loader2, Globe } from 'lucide-react';
import axios from 'axios';

const Settings = () => {
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState({
    openai: '',
    claude: '',
    activeModel: 'openai'
  });

  useEffect(() => {
    // Carregar chaves salvas (mock ou API)
    axios.get('http://localhost:3001/config/keys')
      .then(res => setKeys(prev => ({ ...prev, ...res.data })))
      .catch(err => console.error(err));
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await axios.post('http://localhost:3001/config/keys', keys);
      alert('Configurações de API salvas com sucesso!');
    } catch (err) {
      alert('Erro ao salvar chaves.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Configurações do Sistema</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Gerencie suas chaves de API e preferências de Inteligência Artificial</p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
        {/* OpenAI Section */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', fontWeight: 600 }}>
            <div style={{ padding: '6px', backgroundColor: 'rgba(16, 163, 127, 0.1)', color: '#10a37f', borderRadius: '6px' }}>
              <Cpu size={18} />
            </div>
            OpenAI API Key
          </label>
          <div style={{ position: 'relative' }}>
            <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="password" 
              value={keys.openai}
              onChange={(e) => setKeys({...keys, openai: e.target.value})}
              placeholder="sk-..."
              style={{ 
                width: '100%', 
                padding: '12px 12px 12px 40px', 
                borderRadius: '8px', 
                backgroundColor: 'var(--bg-tertiary)', 
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)'
              }}
            />
          </div>
        </div>

        {/* Claude Section */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', fontWeight: 600 }}>
            <div style={{ padding: '6px', backgroundColor: 'rgba(217, 119, 87, 0.1)', color: '#d97757', borderRadius: '6px' }}>
              <Globe size={18} />
            </div>
            Anthropic Claude API Key
          </label>
          <div style={{ position: 'relative' }}>
            <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="password" 
              value={keys.claude}
              onChange={(e) => setKeys({...keys, claude: e.target.value})}
              placeholder="key-..."
              style={{ 
                width: '100%', 
                padding: '12px 12px 12px 40px', 
                borderRadius: '8px', 
                backgroundColor: 'var(--bg-tertiary)', 
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)'
              }}
            />
          </div>
        </div>

        {/* Model Preference */}
        <div>
          <label style={{ display: 'block', marginBottom: '12px', fontWeight: 600 }}>Modelo Ativo Padrão</label>
          <select 
            value={keys.activeModel}
            onChange={(e) => setKeys({...keys, activeModel: e.target.value})}
            style={{ 
              width: '100%', 
              padding: '12px', 
              borderRadius: '8px', 
              backgroundColor: 'var(--bg-tertiary)', 
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)'
            }}
          >
            <option value="openai">OpenAI (GPT-4o / gpt-4o-mini)</option>
            <option value="claude">Anthropic Claude (3.5 Sonnet / Haiku)</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /> Salvar Configurações</>}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: '20px', border: '1px solid rgba(16, 185, 129, 0.2)', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}>
        <div style={{ display: 'flex', gap: '15px' }}>
          <Shield size={24} color="var(--success)" />
          <div>
            <h4 style={{ color: 'var(--success)', marginBottom: '5px' }}>Segurança de Dados</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Suas chaves de API são armazenadas de forma segura e nunca são compartilhadas. 
              Elas são usadas apenas para processar as mensagens dos seus clientes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
