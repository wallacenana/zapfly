import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Loader2, MapPin, Rocket, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';

let googlePlacesLoaderPromise = null;

const loadGooglePlaces = (apiKey) => {
  if (window.google?.maps?.places?.Autocomplete) return Promise.resolve();
  if (googlePlacesLoaderPromise) return googlePlacesLoaderPromise;
  googlePlacesLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = `menzzuPlacesReady_${Date.now()}`;
    const script = document.createElement('script');
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`;
    script.onerror = () => reject(new Error('google-maps-load-failed'));
    document.head.appendChild(script);
  });
  return googlePlacesLoaderPromise;
};

const defaultDeliveryOptions = { orderTypes: { delivery: true, order: true }, fulfillmentMethods: { delivery: true, pickup: true, local: true } };
const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const normalizeDeliveryOptions = (value) => {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  return {
    orderTypes: {
      delivery: parsed?.orderTypes?.delivery !== false,
      order: parsed?.orderTypes?.order !== false,
    },
    fulfillmentMethods: {
      delivery: parsed?.fulfillmentMethods?.delivery !== false,
      pickup: parsed?.fulfillmentMethods?.pickup !== false,
      local: parsed?.fulfillmentMethods?.local !== false,
    },
  };
};

const inputStyle = {
  width: '100%',
  padding: '16px 18px',
  border: '1px solid var(--border-color)',
  borderRadius: '14px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '16px',
  outline: 'none',
};

const steps = [
  { key: 'openai', title: 'Vamos começar pela IA', question: 'Qual é sua chave da OpenAI?', help: 'Ela será usada para responder seus clientes pelo WhatsApp. Se você usa Anthropic, pode deixar em branco.', placeholder: 'sk-...', type: 'password', icon: KeyRound },
  { key: 'claude', title: 'Uma segunda opção', question: 'Você também usa Anthropic?', help: 'Opcional. Deixe em branco se sua operação usa apenas OpenAI.', placeholder: 'sk-ant-...', type: 'password', icon: KeyRound },
  { key: 'activeModel', title: 'Escolha o cérebro da operação', question: 'Qual modelo deve responder primeiro?', help: 'Você poderá trocar isso depois nas configurações.', type: 'select', icon: KeyRound },
  { key: 'businessName', title: 'Agora, sobre sua empresa', question: 'Como sua empresa se chama?', help: 'Esse nome aparecerá no cardápio e nas mensagens.', placeholder: 'Ex.: Linda Cake', icon: Store, required: true },
  { key: 'businessCategory', title: 'Vamos ajustar a experiência', question: 'O que sua empresa vende?', help: 'Escolha a opção mais próxima. Isso ajuda a IA a entender o contexto dos seus pedidos.', type: 'select', options: ['Restaurante', 'Lanchonete', 'Pizzaria', 'Hamburgueria', 'Doces e bolos', 'Padaria', 'Marmitas', 'Açaí', 'Outro'], icon: Store, required: true },
  { key: 'prepTime', title: 'Tempo de preparo', question: 'Quanto tempo você normalmente precisa?', help: 'Pode ser aproximado. Ex.: 30-45 minutos.', placeholder: 'Ex.: 30-45', icon: Store },
  { key: 'acceptOrders', title: 'Pedidos', question: 'Você quer aceitar pedidos agora?', help: 'Você pode pausar os pedidos depois nas configurações.', type: 'select', options: ['true', 'false'], optionLabels: ['Sim, aceitar pedidos', 'Não, deixar pausado'], icon: Store, required: true },
  { key: 'dailyDeliveryItems', title: 'Como você atende?', question: 'Quais tipos de pedido e retirada estarão disponíveis?', help: 'Selecione todas as opções que sua empresa oferece.', type: 'delivery-options', icon: Store },
  { key: 'dailyMaxOrders', title: 'Capacidade da operação', question: 'Quantos pedidos você aceita por dia?', help: 'Esse limite ajuda a evitar mais pedidos do que sua equipe consegue preparar.', type: 'select', options: ['10', '20', '30', '50', '100'], icon: Store, required: true },
  { key: 'slots', title: 'Horários de funcionamento', question: 'Em quais horários você atende?', help: 'Ative os dias e informe a abertura e o fechamento.', type: 'schedule', icon: Store, required: true },
  { key: 'deliveryMode', title: 'Entrega', question: 'Como o frete será calculado?', help: 'Você poderá configurar regras por distância depois.', type: 'select', options: ['hibrido', 'manual', 'automatico'], optionLabels: ['Híbrido (recomendado)', 'Manual', 'Automático'], icon: MapPin, required: true },
  { key: 'allowCashOnDelivery', title: 'Pagamento na entrega', question: 'Você aceita dinheiro na entrega?', help: 'O dinheiro só aparecerá como opção quando o pedido permitir pagamento na entrega.', type: 'select', options: ['true', 'false'], optionLabels: ['Sim, aceitar dinheiro', 'Não aceitar dinheiro'], icon: Store, required: true },
  { key: 'pixReceiverKey', title: 'Recebimento por Pix', question: 'Qual chave Pix sua empresa recebe?', help: 'Opcional por enquanto. Pode ser CPF, CNPJ, telefone, e-mail ou chave aleatória.', placeholder: 'Sua chave Pix', icon: KeyRound },
  { key: 'businessAddress', title: 'Onde você atende?', question: 'Qual é o endereço da empresa?', help: 'Usaremos essa informação no cardápio e na entrega.', placeholder: 'Rua, número, bairro, cidade e estado', icon: MapPin },
  { key: 'slug', title: 'Seu endereço público', question: 'Qual será o link do seu cardápio?', help: 'Use apenas letras, números e hífens.', placeholder: 'sua-loja', prefix: 'menzzu.com/', icon: Rocket, required: true },
];

export default function GetStarted() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ openai: '', claude: '', activeModel: 'openai', businessName: '', businessCategory: '', prepTime: '', acceptOrders: true, dailyDeliveryItems: defaultDeliveryOptions, dailyMaxOrders: 10, deliveryMode: 'hibrido', allowCashOnDelivery: true, pixReceiverKey: '', businessAddress: '', businessPlaceId: '', businessLat: null, businessLng: null, businessMapsUrl: '', slug: '', googleApiKey: '' });
  const [slots, setSlots] = useState([]);
  const addressRef = useRef(null);

  useEffect(() => {
    Promise.all([api.get('/config/keys'), api.get('/config/slots')]).then(([configResponse, slotsResponse]) => {
      const data = configResponse.data;
      const deliveryOptions = normalizeDeliveryOptions(data.dailyDeliveryItems);
      setForm((current) => ({ ...current, openai: data.openai || '', claude: data.claude || '', activeModel: data.activeModel || 'openai', businessName: data.businessName || '', businessCategory: data.businessCategory || '', prepTime: data.prepTime || '', acceptOrders: data.acceptOrders !== false, dailyDeliveryItems: deliveryOptions, dailyMaxOrders: data.dailyMaxOrders || 10, deliveryMode: data.deliveryMode || 'hibrido', allowCashOnDelivery: data.allowCashOnDelivery !== false, pixReceiverKey: data.pixReceiverKey || '', businessAddress: data.businessAddress || '', businessPlaceId: data.businessPlaceId || '', businessLat: data.businessLat ?? null, businessLng: data.businessLng ?? null, businessMapsUrl: data.businessMapsUrl || '', slug: data.slug || '', googleApiKey: data.googleApiKey || '' }));
      setSlots(Array.isArray(slotsResponse.data) ? slotsResponse.data : []);
    }).catch(() => toast.error('Não foi possível carregar sua configuração.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (current?.key !== 'businessAddress' || !form.googleApiKey || !addressRef.current || addressRef.current.dataset.autocompleteReady) return;
    addressRef.current.dataset.autocompleteReady = 'loading';
    loadGooglePlaces(form.googleApiKey).then(() => {
      if (!window.google?.maps?.places?.Autocomplete || !addressRef.current) return;
      const autocomplete = new window.google.maps.places.Autocomplete(addressRef.current, { types: ['address'], componentRestrictions: { country: 'br' } });
      autocomplete.setFields?.(['place_id', 'formatted_address', 'geometry', 'name']);
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace?.();
        const address = place?.formatted_address || place?.name || addressRef.current.value.trim();
        const lat = place?.geometry?.location?.lat?.() ?? null;
        const lng = place?.geometry?.location?.lng?.() ?? null;
        const mapsUrl = place?.place_id ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${encodeURIComponent(place.place_id)}` : '';
        setForm((previous) => ({ ...previous, businessAddress: address, businessPlaceId: place?.place_id || '', businessLat: lat, businessLng: lng, businessMapsUrl: mapsUrl }));
      });
      addressRef.current.dataset.autocompleteReady = 'ready';
    }).catch(() => { if (addressRef.current) addressRef.current.dataset.autocompleteReady = 'error'; });
  }, [step, form.googleApiKey]);

  const visibleSteps = form.openai.trim() && form.claude.trim()
    ? steps
    : steps.filter((item) => item.key !== 'activeModel');
  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)];
  const value = form[current.key] || '';
  const setValue = (nextValue) => setForm((previous) => ({ ...previous, [current.key]: nextValue }));

  const next = async () => {
    const nextValue = current.type === 'select' ? (value || current.options?.[0] || '') : value;
    const textValue = String(nextValue ?? '');
    if (current.key === 'slots' && slots.length === 0) {
      toast.error('Ative pelo menos um dia de atendimento.');
      return;
    }
    if (current.required && !textValue.trim()) {
      toast.error('Preencha este campo para continuar.');
      return;
    }
    if (nextValue !== value) setValue(nextValue === 'true' ? true : nextValue === 'false' ? false : nextValue);
    if (step < visibleSteps.length - 1) {
      setStep((previous) => previous + 1);
      return;
    }
    if (!form.openai.trim() && !form.claude.trim()) {
      toast.error('Informe pelo menos uma credencial de IA.');
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      const onlyOneAi = Boolean(form.openai.trim()) !== Boolean(form.claude.trim());
      const payload = onlyOneAi
        ? { ...form, activeModel: form.openai.trim() ? 'openai' : 'claude' }
        : form;
      await Promise.all([
        api.post('/config/keys', { ...payload, dailyDeliveryItems: JSON.stringify(payload.dailyDeliveryItems || defaultDeliveryOptions), deliveryRules: JSON.stringify(payload.deliveryRules || []) }),
        api.post('/config/slots', { slots }),
      ]);
      window.localStorage.setItem('menzzu_onboarding_completed', '1');
      toast.success('Tudo pronto. Bem-vindo ao Menzzu!');
      window.location.assign('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar sua configuração.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const Icon = current.icon;
  const renderControl = () => {
    if (current.type === 'delivery-options') {
      const options = normalizeDeliveryOptions(form.dailyDeliveryItems);
      const toggle = (group, key) => setForm((previous) => { const normalized = normalizeDeliveryOptions(previous.dailyDeliveryItems); return { ...previous, dailyDeliveryItems: { ...normalized, [group]: { ...normalized[group], [key]: !normalized[group][key] } } }; });
      return <div style={{ display: 'grid', gap: '16px' }}>
        <div><strong style={{ display: 'block', marginBottom: '9px', fontSize: '13px' }}>Tipos de pedido</strong><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>{[['delivery', 'Delivery'], ['order', 'Encomendas']].map(([key, label]) => <button type="button" key={key} onClick={() => toggle('orderTypes', key)} style={{ padding: '14px', border: `1px solid ${options.orderTypes?.[key] ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius: '12px', background: options.orderTypes?.[key] ? 'var(--accent-glow)' : 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 800 }}>{label}</button>)}</div></div>
        <div><strong style={{ display: 'block', marginBottom: '9px', fontSize: '13px' }}>Formas de retirada</strong><div style={{ display: 'grid', gap: '9px' }}>{[['delivery', 'Entrega'], ['pickup', 'Retirada na loja'], ['local', 'Consumo no local']].map(([key, label]) => <button type="button" key={key} onClick={() => toggle('fulfillmentMethods', key)} style={{ padding: '13px 14px', textAlign: 'left', border: `1px solid ${options.fulfillmentMethods?.[key] ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius: '12px', background: options.fulfillmentMethods?.[key] ? 'var(--accent-glow)' : 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 700 }}>{options.fulfillmentMethods?.[key] ? '✓ ' : ''}{label}</button>)}</div></div>
      </div>;
    }
    if (current.type === 'schedule') return <div style={{ display: 'grid', gap: '8px' }}>{weekDays.map((day, index) => { const slot = slots.find((item) => item.dayOfWeek === index); return <div key={day} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) 1fr 1fr auto', gap: '8px', alignItems: 'center' }}><button type="button" onClick={() => setSlots((previous) => slot ? previous.filter((item) => item.dayOfWeek !== index) : [...previous, { dayOfWeek: index, startTime: '09:00', endTime: '20:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek))} style={{ padding: '10px', textAlign: 'left', border: '1px solid var(--border-color)', borderRadius: '10px', background: slot ? 'var(--accent-glow)' : 'var(--bg-primary)', color: slot ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 700 }}>{slot ? '✓ ' : ''}{day}</button><input type="time" value={slot?.startTime || '09:00'} disabled={!slot} onChange={(event) => setSlots((previous) => previous.map((item) => item.dayOfWeek === index ? { ...item, startTime: event.target.value } : item))} style={{ ...inputStyle, padding: '10px', opacity: slot ? 1 : .45 }} /><input type="time" value={slot?.endTime || '20:00'} disabled={!slot} onChange={(event) => setSlots((previous) => previous.map((item) => item.dayOfWeek === index ? { ...item, endTime: event.target.value } : item))} style={{ ...inputStyle, padding: '10px', opacity: slot ? 1 : .45 }} /><span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>até</span></div>; })}</div>;
    if (current.type === 'select') return <select autoFocus style={inputStyle} value={String(value || current.options?.[0] || 'openai')} onChange={(event) => setValue(event.target.value)}>{(current.options || ['openai', 'claude']).map((option, index) => <option key={option} value={option}>{current.optionLabels?.[index] || option}</option>)}</select>;
    return <input ref={current.key === 'businessAddress' ? addressRef : undefined} autoFocus style={inputStyle} type={current.type || 'text'} value={value} onChange={(event) => setForm((previous) => ({ ...previous, [current.key]: current.key === 'slug' ? event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') : event.target.value, ...(current.key === 'businessAddress' ? { businessPlaceId: '', businessLat: null, businessLng: null, businessMapsUrl: '' } : {}) }))} placeholder={current.placeholder} onKeyDown={(event) => { if (event.key === 'Enter') next(); }} />;
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="get-started-title" style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(15, 23, 42, 0.38)', backdropFilter: 'blur(7px)' }}>
      <section style={{ width: '100%', maxWidth: '620px', padding: '38px 42px 32px', border: '1px solid rgba(217,229,210,.95)', borderRadius: '24px', background: '#fff', boxShadow: '0 28px 80px rgba(15,23,42,.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '34px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}><Rocket size={17} /> Primeiros passos</div>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700 }}>{step + 1} de {visibleSteps.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '5px', marginBottom: '34px' }}>{visibleSteps.map((item, index) => <span key={item.key} style={{ height: '4px', flex: 1, borderRadius: '4px', background: index <= step ? 'var(--accent-primary)' : 'var(--bg-tertiary)' }} />)}</div>
        <div style={{ width: '52px', height: '52px', borderRadius: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-glow)', color: 'var(--accent-primary)', marginBottom: '20px' }}><Icon size={25} /></div>
        <h1 id="get-started-title" style={{ marginBottom: '10px', fontSize: '30px', lineHeight: 1.12 }}>{current.title}</h1>
        <label style={{ display: 'block', marginBottom: '9px', color: 'var(--text-primary)', fontSize: '16px', fontWeight: 800 }}>{current.question}</label>
        <p style={{ minHeight: '44px', marginBottom: '20px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>{current.help}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {current.prefix && <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontSize: '15px' }}>{current.prefix}</span>}
          {renderControl()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '32px' }}>
          <button type="button" onClick={() => setStep((previous) => Math.max(0, previous - 1))} disabled={step === 0 || saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '12px', background: '#fff', color: 'var(--text-secondary)', fontWeight: 800, cursor: step === 0 ? 'default' : 'pointer', opacity: step === 0 ? .4 : 1 }}><ArrowLeft size={16} /> Voltar</button>
          <button type="button" onClick={next} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '13px 20px', border: 0, borderRadius: '12px', background: 'var(--accent-primary)', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: saving ? .7 : 1 }}>{saving ? <Loader2 size={17} className="animate-spin" /> : step === visibleSteps.length - 1 ? 'Salvar e começar' : 'Continuar'} {!saving && <ArrowRight size={17} />}</button>
        </div>
      </section>
    </div>
  );
}
