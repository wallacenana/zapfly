import React, { useEffect, useState } from 'react';
import { Clipboard, Globe2, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';

const statusLabels = {
  not_configured: 'Não configurado',
  pending: 'Aguardando validação',
  active: 'Ativo',
  ssl_pending: 'SSL em emissão',
  blocked: 'Bloqueado',
};

const DomainSettings = () => {
  const [domain, setDomain] = useState('');
  const [domainData, setDomainData] = useState({ customDomainStatus: 'not_configured', cloudflareValidationRecords: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadDomain = async () => {
    try {
      const response = await api.get('/settings/custom-domain');
      setDomain(response.data.customDomain || '');
      setDomainData(response.data || {});
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível consultar o domínio.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDomain(); }, []);

  const provisionDomain = async () => {
    setWorking(true);
    try {
      const response = await api.post('/settings/custom-domain', { domain });
      setDomainData(response.data || {});
      setDomain(response.data.customDomain || '');
      toast.success(response.data.customDomainStatus === 'active' ? 'Domínio ativo!' : 'Domínio enviado para validação.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível configurar o domínio.');
    } finally {
      setWorking(false);
    }
  };

  const removeDomain = async () => {
    setWorking(true);
    try {
      const response = await api.post('/settings/custom-domain', { domain: '' });
      setDomainData(response.data || {});
      setDomain('');
      toast.success('Domínio removido.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível remover o domínio.');
    } finally {
      setWorking(false);
    }
  };

  const copyValue = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado.');
    } catch {
      toast.error('Não foi possível copiar automaticamente.');
    }
  };

  const status = domainData.customDomainStatus || 'not_configured';
  const records = Array.isArray(domainData.cloudflareValidationRecords) ? domainData.cloudflareValidationRecords : [];

  return (
    <main style={{ minHeight: '100vh', padding: '34px', background: '#f6f8f3', color: '#0f172a' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ marginBottom: '26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#5db72c', marginBottom: '8px' }}>
            <Globe2 size={24} />
            <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Configurações</span>
          </div>
          <h1 style={{ margin: 0, fontSize: '30px' }}>Domínio personalizado</h1>
          <p style={{ color: '#64748b', marginTop: '8px' }}>Use o endereço da sua marca para abrir o cardápio, com SSL gerenciado pela Cloudflare.</p>
        </div>

        <section style={cardStyle}>
          <h2 style={headingStyle}>1. Cadastre o domínio</h2>
          <p style={mutedStyle}>Aceitamos domínio raiz ou subdomínio. Informe somente o endereço, sem <code>https://</code> e sem barra no final.</p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').trim())}
              placeholder="menu.minhaloja.com.br"
              style={{ ...inputStyle, flex: '1 1 360px' }}
            />
            <button onClick={provisionDomain} disabled={working || !domain} style={primaryButton}>
              {working ? <LoaderCircle className="animate-spin" size={17} /> : <Globe2 size={17} />}
              {working ? 'Processando...' : 'Provisionar domínio'}
            </button>
          </div>
          {domainData.customDomainLastError && <p style={{ ...errorStyle, marginTop: '12px' }}>{domainData.customDomainLastError}</p>}
        </section>

        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h2 style={headingStyle}>2. Status da conexão</h2>
              <p style={mutedStyle}>A Cloudflare precisa validar o domínio e emitir o certificado antes do acesso funcionar em HTTPS.</p>
            </div>
            <button onClick={loadDomain} disabled={loading || working} style={secondaryButton}><RefreshCw size={16} /> Atualizar status</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', fontWeight: 800 }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: status === 'active' ? '#16a34a' : '#f59e0b' }} />
            {statusLabels[status] || status}
            {domainData.cloudflareSslStatus && <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 600 }}>SSL: {domainData.cloudflareSslStatus}</span>}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={headingStyle}>3. Configure o DNS do domínio</h2>
          <p style={mutedStyle}>A Menzzu não consegue editar automaticamente o DNS de um domínio que está em outra conta. Copie o registro abaixo no provedor onde o domínio está hospedado.</p>
          <div style={recordStyle}>
            <div><strong>Tipo</strong><span>CNAME</span></div>
            <div><strong>Nome</strong><span>{domain || 'seu-subdominio'}</span></div>
            <div><strong>Destino</strong><span>{domainData.cloudflareTarget || 'customers.menzzu.com'}</span></div>
            <button onClick={() => copyValue(domainData.cloudflareTarget || 'customers.menzzu.com')} style={copyButton}><Clipboard size={15} /> Copiar destino</button>
          </div>
          {records.map((record, index) => (
            <div style={{ ...recordStyle, marginTop: '10px' }} key={`${record.name}-${index}`}>
              <div><strong>{record.type}</strong><span>{record.name}</span></div>
              <div><strong>Valor</strong><span>{record.value}</span></div>
              <button onClick={() => copyValue(record.value)} style={copyButton}><Clipboard size={15} /> Copiar valor</button>
            </div>
          ))}
          <p style={{ ...mutedStyle, marginTop: '14px' }}>Depois de salvar o DNS, aguarde a propagação e clique em “Atualizar status”.</p>
        </section>

        {domain && <button onClick={removeDomain} disabled={working} style={dangerButton}><Trash2 size={16} /> Remover domínio personalizado</button>}
      </div>
    </main>
  );
};

const cardStyle = { background: '#fff', border: '1px solid #d9e5d2', borderRadius: '18px', padding: '24px', marginBottom: '18px', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' };
const headingStyle = { margin: 0, fontSize: '18px' };
const mutedStyle = { color: '#64748b', fontSize: '14px', lineHeight: 1.55 };
const errorStyle = { color: '#b91c1c', fontSize: '13px', fontWeight: 700 };
const inputStyle = { padding: '13px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', color: '#0f172a', outline: 'none' };
const primaryButton = { display: 'inline-flex', alignItems: 'center', gap: '8px', border: 0, borderRadius: '10px', padding: '13px 16px', background: '#5db72c', color: '#fff', fontWeight: 800, cursor: 'pointer' };
const secondaryButton = { display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '10px 13px', background: '#fff', color: '#334155', fontWeight: 800, cursor: 'pointer' };
const dangerButton = { display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid #fecaca', borderRadius: '10px', padding: '11px 14px', background: '#fff1f2', color: '#b91c1c', fontWeight: 800, cursor: 'pointer' };
const copyButton = { display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px 10px', background: '#f0fdf4', color: '#15803d', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const recordStyle = { display: 'grid', gridTemplateColumns: 'minmax(90px, 0.5fr) minmax(160px, 1.4fr) minmax(160px, 2fr) auto', gap: '12px', alignItems: 'center', padding: '14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '13px' };

export default DomainSettings;
