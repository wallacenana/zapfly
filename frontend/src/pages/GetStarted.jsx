import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, KeyRound, MapPin, Rocket, Store, Wifi } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';

const inputStyle = {
  width: '100%',
  padding: '13px 14px',
  border: '1px solid var(--border-color)',
  borderRadius: '12px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
};

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontWeight: 800,
};

const StepIcon = ({ icon: Icon, active, complete }) => (
  <div style={{ width: '38px', height: '38px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: complete ? 'var(--accent-primary)' : active ? 'var(--accent-glow)' : 'var(--bg-tertiary)', color: complete ? '#fff' : active ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
    {complete ? <CheckCircle2 size={19} /> : <Icon size={19} />}
  </div>
);

export default function GetStarted() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    slug: '',
    openai: '',
    claude: '',
    activeModel: 'openai',
    businessName: '',
    businessCategory: '',
    prepTime: '',
    businessAddress: '',
    acceptOrders: true,
  });

  useEffect(() => {
    api.get('/config/keys').then(({ data }) => {
      setForm((current) => ({ ...current, ...data, openai: data.openai || '', claude: data.claude || '' }));
    }).catch(() => toast.error('Não foi possível carregar sua configuração.')).finally(() => setLoading(false));
  }, []);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const saveAndContinue = async () => {
    if (step === 0 && !form.openai.trim() && !form.claude.trim()) {
      toast.error('Informe pelo menos uma credencial de IA.');
      return;
    }
    if (step === 1 && (!form.businessName.trim() || !form.businessCategory.trim())) {
      toast.error('Informe o nome e a categoria da empresa.');
      return;
    }
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }
    setSaving(true);
    try {
      await api.post('/config/keys', form);
      toast.success('Configuração inicial salva.');
      navigate('/dashboard', { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar a configuração.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-secondary)' }}>Carregando configuração inicial...</div>;

  const steps = [
    { title: 'Conecte sua IA', description: 'Escolha o provedor que responderá seus clientes.', icon: KeyRound },
    { title: 'Configure sua empresa', description: 'Esses dados aparecem no cardápio e nas mensagens.', icon: Store },
    { title: 'Ative a operação', description: 'Defina o endereço, o link público e comece a vender.', icon: Rocket },
  ];

  return (
    <main style={{ minHeight: '100vh', padding: '28px', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em' }}><Rocket size={16} /> Primeiros passos</div>
          <h1 style={{ margin: '10px 0 8px', fontSize: '34px' }}>Vamos colocar seu Menzzu para funcionar</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '680px', lineHeight: 1.6 }}>Preencha o essencial agora. O restante pode ser ajustado depois nas configurações.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: '10px' }}>
            {steps.map((item, index) => (
              <button key={item.title} type="button" onClick={() => index <= step && setStep(index)} style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '14px', textAlign: 'left', border: `1px solid ${index === step ? 'rgba(93,183,44,.35)' : 'var(--border-color)'}`, borderRadius: '16px', background: index === step ? 'var(--accent-glow)' : 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: index <= step ? 'pointer' : 'default', opacity: index > step ? .62 : 1 }}>
                <StepIcon icon={item.icon} active={index === step} complete={index < step} />
                <span><strong style={{ display: 'block', fontSize: '13px' }}>{item.title}</strong><small style={{ display: 'block', marginTop: '3px', color: 'var(--text-secondary)', lineHeight: 1.35 }}>{item.description}</small></span>
              </button>
            ))}
          </div>

          <section style={{ padding: '28px', border: '1px solid var(--border-color)', borderRadius: '22px', background: 'var(--bg-secondary)', boxShadow: 'var(--card-shadow)' }}>
            {step === 0 && <>
              <h2 style={{ marginBottom: '8px' }}>Credenciais da inteligência artificial</h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '22px' }}>A chave fica vinculada somente à sua conta. Use OpenAI ou Anthropic; uma delas já é suficiente.</p>
              <div style={{ display: 'grid', gap: '18px' }}>
                <div><label style={labelStyle}>Chave OpenAI</label><input style={inputStyle} type="password" value={form.openai} onChange={(event) => update('openai', event.target.value)} placeholder="sk-..." /></div>
                <div><label style={labelStyle}>Chave Anthropic (opcional)</label><input style={inputStyle} type="password" value={form.claude} onChange={(event) => update('claude', event.target.value)} placeholder="sk-ant-..." /></div>
                <div><label style={labelStyle}>Modelo principal</label><select style={inputStyle} value={form.activeModel || 'openai'} onChange={(event) => update('activeModel', event.target.value)}><option value="openai">OpenAI</option><option value="claude">Anthropic</option></select></div>
              </div>
            </>}

            {step === 1 && <>
              <h2 style={{ marginBottom: '8px' }}>Informações da empresa</h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '22px' }}>Essas informações orientam a IA e aparecem para quem acessar seu cardápio.</p>
              <div style={{ display: 'grid', gap: '18px' }}>
                <div><label style={labelStyle}>Nome da empresa</label><input style={inputStyle} value={form.businessName} onChange={(event) => update('businessName', event.target.value)} placeholder="Ex.: Linda Cake" /></div>
                <div><label style={labelStyle}>Categoria</label><input style={inputStyle} value={form.businessCategory} onChange={(event) => update('businessCategory', event.target.value)} placeholder="Ex.: Doces e bolos" /></div>
                <div><label style={labelStyle}>Tempo médio de preparo</label><input style={inputStyle} value={form.prepTime} onChange={(event) => update('prepTime', event.target.value)} placeholder="Ex.: 30-45" /></div>
              </div>
            </>}

            {step === 2 && <>
              <h2 style={{ marginBottom: '8px' }}>Ative seu cardápio</h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '22px' }}>Finalize os dados públicos e depois conecte o WhatsApp e cadastre os produtos.</p>
              <div style={{ display: 'grid', gap: '18px' }}>
                <div><label style={labelStyle}>Endereço da empresa</label><div style={{ position: 'relative' }}><MapPin size={17} color="var(--text-muted)" style={{ position: 'absolute', left: '13px', top: '14px' }} /><input style={{ ...inputStyle, paddingLeft: '40px' }} value={form.businessAddress} onChange={(event) => update('businessAddress', event.target.value)} placeholder="Rua, número, bairro, cidade e estado" /></div></div>
                <div><label style={labelStyle}>Endereço do cardápio</label><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>menzzu.com/</span><input style={inputStyle} value={form.slug} onChange={(event) => update('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="sua-loja" /></div></div>
                <div style={{ padding: '14px', borderRadius: '14px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}><Wifi size={16} color="var(--accent-primary)" style={{ verticalAlign: 'middle', marginRight: '7px' }} />Depois de salvar, abra <Link to="/connections" style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>Conexões</Link> para conectar seu WhatsApp.</div>
              </div>
            </>}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '28px' }}>
              <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || saving} style={{ padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontWeight: 800, cursor: step === 0 ? 'default' : 'pointer', opacity: step === 0 ? .45 : 1 }}>Voltar</button>
              <button type="button" onClick={saveAndContinue} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 18px', border: 0, borderRadius: '12px', background: 'var(--accent-primary)', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: saving ? .7 : 1 }}>{saving ? 'Salvando...' : step === 2 ? 'Salvar e começar' : 'Continuar'} <ArrowRight size={17} /></button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
