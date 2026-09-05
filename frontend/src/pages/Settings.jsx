import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Shield, MessageSquare, Bell, Calendar, MapPin, Truck, Plus, Trash2, Key, Cpu, ExternalLink, CheckCircle2, Image, Upload, Mail } from 'lucide-react';
import { api, API_URL, FILES_URL } from '../api';
import axios from 'axios';
import Swal from 'sweetalert2';

let googlePlacesLoaderPromise = null;

function parseGoogleLocationMeta(value) {
  if (!value) return { address: '', placeId: '', lat: null, lng: null, mapsUrl: '' };
  if (typeof value === 'object' && !Array.isArray(value)) {
    return {
      address: String(value.address || value.formatted_address || ''),
      placeId: String(value.placeId || value.place_id || ''),
      lat: value.lat !== undefined && value.lat !== null ? Number(value.lat) : null,
      lng: value.lng !== undefined && value.lng !== null ? Number(value.lng) : null,
      mapsUrl: String(value.mapsUrl || value.locationLink || '')
    };
  }

  const raw = String(value).trim();
  if (!raw) return { address: '', placeId: '', lat: null, lng: null, mapsUrl: '' };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        address: String(parsed.address || parsed.formatted_address || ''),
        placeId: String(parsed.placeId || parsed.place_id || ''),
        lat: parsed.lat !== undefined && parsed.lat !== null ? Number(parsed.lat) : null,
        lng: parsed.lng !== undefined && parsed.lng !== null ? Number(parsed.lng) : null,
        mapsUrl: String(parsed.mapsUrl || parsed.locationLink || '')
      };
    }
  } catch (error) {
    // plain text fallback
  }

  return { address: raw, placeId: '', lat: null, lng: null, mapsUrl: '' };
}

const DEFAULT_DELIVERY_MENU_OPTIONS = {
  orderTypes: { delivery: true, order: true },
  fulfillmentMethods: { delivery: true, pickup: true, local: true }
};

const BUSINESS_CATEGORY_OPTIONS = [
  'Açaí',
  'Adega',
  'Árabe',
  'Assados',
  'Bakery',
  'Barbearia',
  'Bebidas',
  'Brasileira',
  'Cafeteria',
  'Carnes',
  'Churrascaria',
  'Comida Fit',
  'Comida Japonesa',
  'Comida Típica',
  'Confeitaria',
  'Doces & Bolos',
  'Esfiharia',
  'Frutos do Mar',
  'Gelateria',
  'Hambúrguer',
  'Italiana',
  'Lanches',
  'Loja de Conveniência',
  'Marmitaria',
  'Massas',
  'Padaria',
  'Pastelaria',
  'Pet Shop',
  'Pizza',
  'Pizzaria',
  'Presentes',
  'Saudável',
  'Sorvetes',
  'Sushi',
  'Vegana',
  'Vegetariana'
];

function normalizeDeliveryMenuOptions(value) {
  const base = {
    orderTypes: { ...DEFAULT_DELIVERY_MENU_OPTIONS.orderTypes },
    fulfillmentMethods: { ...DEFAULT_DELIVERY_MENU_OPTIONS.fulfillmentMethods }
  };

  if (!value) return base;

  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      return base;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return base;
  }

  const orderTypes = parsed.orderTypes && typeof parsed.orderTypes === 'object' ? parsed.orderTypes : {};
  const fulfillmentMethods = parsed.fulfillmentMethods && typeof parsed.fulfillmentMethods === 'object' ? parsed.fulfillmentMethods : {};

  return {
    orderTypes: {
      delivery: orderTypes.delivery !== false,
      order: orderTypes.order !== false
    },
    fulfillmentMethods: {
      delivery: fulfillmentMethods.delivery !== false,
      pickup: fulfillmentMethods.pickup !== false,
      local: fulfillmentMethods.local !== false
    }
  };
}

function loadGooglePlaces(apiKey) {
  if (window.google?.maps?.places?.Autocomplete) {
    return Promise.resolve(window.google.maps.places);
  }

  if (googlePlacesLoaderPromise) {
    return googlePlacesLoaderPromise;
  }

  if (!apiKey) {
    return Promise.reject(new Error('missing-google-api-key'));
  }

  googlePlacesLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = `dzSettingsGooglePlacesReady_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement('script');

    window[callbackName] = () => {
      try {
        delete window[callbackName];
      } catch (error) {
        window[callbackName] = undefined;
      }
      resolve(window.google?.maps?.places || null);
    };

    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`;
    script.onerror = () => {
      try {
        delete window[callbackName];
      } catch (error) {
        window[callbackName] = undefined;
      }
      reject(new Error('google-maps-load-failed'));
    };
    document.head.appendChild(script);
  });

  return googlePlacesLoaderPromise;
}

const Settings = () => {
  const [activeTab, setActiveTab] = useState('business');
  const [loading, setLoading] = useState(true);
  const [calendars, setCalendars] = useState([]);
  const [settings, setSettings] = useState({
    businessName: '',
    businessCategory: '',
    prepTime: '',
    businessAddress: '',
    businessPlaceId: '',
    businessLat: null,
    businessLng: null,
    businessMapsUrl: '',
    openaiKey: '',
    claudeKey: '',
    activeModel: 'openai',
    googleApiKey: '',
    gcalCalendarId: '',
    deliveryRules: [],
    managerJid: '',
    deliveryJid: '',
    mercadopagoToken: '',
    mercadopagoPublicKey: '',
    dailyMaxOrders: 10,
    gcalSyncHour: 6,
    reportHour: 7,
    reportEnabled: false,
    gcalRefreshToken: '',
    gcalEnabled: false,
    reminderHours: 2,
    dailyDeliveryItems: DEFAULT_DELIVERY_MENU_OPTIONS,
    pixReceiverName: '',
    pixReceiverKey: '',
    maxDeliveryKm: 15,
    freeDeliveryEnabled: false,
    freeDeliveryKm: 0,
    deliveryMode: 'hibrido',
    allowCashOnDelivery: true
  });
  const [slots, setSlots] = useState([]);
  const [, setLoadingSlots] = useState(true);
  const [marketingAssets, setMarketingAssets] = useState([]);
  const [uploadName, setUploadName] = useState('');
  const fileInputRef = useRef(null);
  const businessAddressRef = useRef(null);
  const [acceptOrders, setAcceptOrders] = useState(true);
  const [savingAcceptOrders, setSavingAcceptOrders] = useState(false);
  const [canUseMercadoPago, setCanUseMercadoPago] = useState(false);

  const fetchStoreSettings = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      setAcceptOrders(res.data?.acceptOrders !== false);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadSettings = async () => {
    try {
      const res = await api.get('/config/keys');
      if (res.data) {
        const { slug: _ignoredSlug, ...dataWithoutSlug } = res.data;
        const parsedLocation = parseGoogleLocationMeta(dataWithoutSlug.businessLocation);
        setSettings({
          ...dataWithoutSlug,
          openaiKey: dataWithoutSlug.openai || '',
          claudeKey: dataWithoutSlug.claude || '',
          googleApiKey: dataWithoutSlug.googleApiKey || '',
          gcalCalendarId: dataWithoutSlug.gcalCalendarId || '',
          businessCategory: dataWithoutSlug.businessCategory || '',
          prepTime: dataWithoutSlug.prepTime || '',
          businessAddress: dataWithoutSlug.businessAddress || parsedLocation.address || '',
          businessPlaceId: dataWithoutSlug.businessPlaceId || parsedLocation.placeId || '',
          businessLat: dataWithoutSlug.businessLat ?? parsedLocation.lat ?? null,
          businessLng: dataWithoutSlug.businessLng ?? parsedLocation.lng ?? null,
          businessMapsUrl: dataWithoutSlug.businessMapsUrl || parsedLocation.mapsUrl || '',
          dailyDeliveryItems: normalizeDeliveryMenuOptions(dataWithoutSlug.dailyDeliveryItems),
          deliveryRules: typeof dataWithoutSlug.deliveryRules === 'string'
            ? JSON.parse(dataWithoutSlug.deliveryRules || '[]')
            : (Array.isArray(dataWithoutSlug.deliveryRules) ? dataWithoutSlug.deliveryRules : []),
          reminderHours: dataWithoutSlug.reminderHours || 2,
          mercadopagoToken: dataWithoutSlug.mercadopagoToken || '',
          mercadopagoPublicKey: dataWithoutSlug.mercadopagoPublicKey || '',
          maxDeliveryKm: dataWithoutSlug.maxDeliveryKm || 15,
          freeDeliveryEnabled: dataWithoutSlug.freeDeliveryEnabled ?? false,
          freeDeliveryKm: dataWithoutSlug.freeDeliveryKm ?? 0,
          deliveryMode: dataWithoutSlug.deliveryMode || 'hibrido',
          allowCashOnDelivery: dataWithoutSlug.allowCashOnDelivery ?? true
        });

        if (dataWithoutSlug.gcalRefreshToken) {
          fetchCalendars();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const attachBusinessAddressAutocomplete = async () => {
    const input = businessAddressRef.current;
    const apiKey = String(settings.googleApiKey || '').trim();

    if (!input || input.dataset.autocompleteReady === '1' || input.dataset.autocompleteReady === 'loading') {
      return;
    }
    if (!apiKey) {
      return;
    }

    input.dataset.autocompleteReady = 'loading';

    try {
      await loadGooglePlaces(apiKey);
      if (!window.google?.maps?.places?.Autocomplete) {
        input.dataset.autocompleteReady = 'error';
        return;
      }

      const autocomplete = new window.google.maps.places.Autocomplete(input, {
        types: ['address'],
        componentRestrictions: { country: 'br' }
      });

      if (typeof autocomplete.setFields === 'function') {
        autocomplete.setFields(['place_id', 'formatted_address', 'geometry', 'name']);
      }

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace ? autocomplete.getPlace() : null;
        const formatted = place?.formatted_address || place?.name || input.value.trim();
        const lat = place?.geometry?.location && typeof place.geometry.location.lat === 'function'
          ? place.geometry.location.lat()
          : null;
        const lng = place?.geometry?.location && typeof place.geometry.location.lng === 'function'
          ? place.geometry.location.lng()
          : null;
        const mapsUrl = place?.place_id
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatted)}&query_place_id=${encodeURIComponent(place.place_id)}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatted)}`;

        setSettings(prev => ({
          ...prev,
          businessAddress: formatted,
          businessPlaceId: place?.place_id || '',
          businessLat: lat,
          businessLng: lng,
          businessMapsUrl: mapsUrl
        }));

        input.value = formatted;
      });

      input.dataset.autocompleteReady = '1';
    } catch (error) {
      console.error('Erro ao carregar autocomplete do endereço:', error);
      input.dataset.autocompleteReady = 'error';
    }
  };

  const connectGoogle = () => {
    const token = localStorage.getItem('hotwhats_token');
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const win = window.open(`${API_URL}/auth/google?token=${token}`, 'google_auth', `width=${width},height=${height},left=${left},top=${top}`);

    const checkTimer = setInterval(() => {
      if (win.closed) {
        clearInterval(checkTimer);
        loadSettings();
      }
    }, 1000);
  };

  const fetchCalendars = async () => {
    try {
      const res = await api.get('/auth/google/calendars');
      setCalendars(res.data);
    } catch (err) {
      console.error('Erro ao buscar calendários:', err);
    }
  };

  useEffect(() => {
    // Se estiver no popup de sucesso do Google, fecha a janela
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal_success')) {
      window.close();
      return;
    }
    loadSettings();
    loadSlots();
    fetchStoreSettings();

    loadMarketingAssets();
    api.get('/billing/me').then(({ data }) => {
      setCanUseMercadoPago(Boolean(data?.plan?.paymentGateway));
    }).catch(() => setCanUseMercadoPago(false));
  }, [fetchStoreSettings]);

  const loadSlots = async () => {
    try {
      const res = await api.get('/config/slots');
      setSlots(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSlots(false);
    }
  };

  const loadMarketingAssets = async () => {
    try {
      const res = await api.get('/marketing-assets');
      setMarketingAssets(res.data);
    } catch (err) { console.error(err); }
  };

  const handleUploadAsset = async () => {
    if (!fileInputRef.current?.files[0] || !uploadName.trim()) {
      Swal.fire('Atenção', 'Preencha o nome e selecione uma imagem.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('name', uploadName);
    formData.append('file', fileInputRef.current.files[0]);
    formData.append('secret', 'BlinkMediaSecret123!');
    formData.append('size', '800'); // Tamanho para marketing assets 

    try {
      // 1. Sobe o arquivo para o bucket PHP
      const uploadRes = await axios.post(`${FILES_URL}/upload.php`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (uploadRes.data.success) {
        // 2. Salva a referência da URL no banco de dados do Node.js
        await api.post('/marketing-assets', {
          name: uploadName,
          url: uploadRes.data.url // Passamos a URL final do bucket
        });

        setUploadName('');
        fileInputRef.current.value = '';
        await loadMarketingAssets();
        Swal.fire({ title: 'Foto adicionada!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
      } else {
        throw new Error(uploadRes.data.error || 'Erro no servidor de arquivos');
      }
    } catch (err) {
      console.error(err);
      Swal.fire('Erro', 'Não foi possível subir a imagem: ' + (err.message || ''), 'error');
    }
  };

  const handleDeleteAsset = async (id) => {
    const { isConfirmed } = await Swal.fire({ title: 'Remover foto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Não' });
    if (!isConfirmed) return;
    await api.delete(`/marketing-assets/${id}`);
    await loadMarketingAssets();
  };

  const handleSaveSlots = async () => {
    try {
      await api.post('/config/slots', { slots });
      Swal.fire({ title: 'Horários Atualizados!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível salvar os horários.', 'error');
    }
  };
  const handleAcceptOrdersChange = async (nextValue) => {
    setAcceptOrders(nextValue);
    setSavingAcceptOrders(true);
    try {
      await api.post('/settings', { acceptOrders: nextValue });
    } catch (err) {
      console.error(err);
      setAcceptOrders(!nextValue);
      Swal.fire({
        title: 'Erro',
        text: 'Não foi possível salvar a configuração de encomendas.',
        icon: 'error',
        confirmButtonColor: '#3b82f6'
      });
    } finally {
      setSavingAcceptOrders(false);
    }
  };
  const handleSave = async () => {
    try {
      const { slug: _ignoredSlug, googleApiKey: _ignoredGoogleApiKey, ...safeSettings } = settings;
      const payload = {
        ...safeSettings,
        openai: safeSettings.openaiKey,
        claude: safeSettings.claudeKey,
        deliveryRules: JSON.stringify(safeSettings.deliveryRules),
        dailyDeliveryItems: JSON.stringify(normalizeDeliveryMenuOptions(safeSettings.dailyDeliveryItems))
      };
      await api.post('/config/keys', payload);
      await loadSettings(); // Recarrega para garantir que o estado local bata com o banco (especialmente GCal)
      Swal.fire({ title: 'Configurações Salvas!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Erro', 'Não foi possível salvar.', 'error');
    }
  };


  const addDeliveryRule = () => setSettings(s => ({ ...s, deliveryRules: [...s.deliveryRules, { maxKm: 5, fee: 10, allowCash: true }] }));
  const updateRule = (idx, field, val) => {
    const rules = [...settings.deliveryRules];
    rules[idx][field] = parseFloat(val);
    setSettings(s => ({ ...s, deliveryRules: rules }));
  };

  const tabs = [
    { id: 'business', label: 'Empresa', icon: Shield },
    { id: 'delivery', label: 'Logística & Frete', icon: Truck },
    { id: 'schedules', label: 'Horários', icon: Calendar },
    { id: 'bot', label: 'Integrações (IA/GCal)', icon: Cpu },
    { id: 'marketing', label: 'Mídias de Marketing', icon: Image }
  ];

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando configurações...</div>;

  return (
    <div className="settings-page" style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="settings-header" style={{ marginBottom: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>Configurações</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie o cérebro e a logística da sua plataforma</p>
        </div>
        <button
          onClick={activeTab === 'schedules' ? handleSaveSlots : handleSave}
          style={{ display: activeTab === 'marketing' ? 'none' : 'flex', alignItems: 'center', gap: '8px', padding: '12px 25px', borderRadius: '12px' }}
          className="btn btn-primary"
        >
          <Save size={20} /> Salvar {activeTab === 'schedules' ? 'Horários' : 'Tudo'}
        </button>
      </div>

      <div className="settings-layout" style={{ display: 'flex', gap: '30px' }}>
        <div className="settings-nav" style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`settings-tab ${activeTab === t.id ? 'settings-tab-active' : ''}`}
              style={{
                ...tabStyle,
                backgroundColor: activeTab === t.id ? 'rgba(93, 183, 44, 0.10)' : 'transparent',
                color: activeTab === t.id ? '#5db72c' : 'var(--text-secondary)',
                borderColor: activeTab === t.id ? 'rgba(93, 183, 44, 0.30)' : 'rgba(15, 23, 42, 0.08)'
              }}
            >
              <t.icon size={20} /> {t.label}
            </button>
          ))}
        </div>

        <div className="card settings-main-card" style={{ flex: 1, padding: '40px', borderRadius: '20px' }}>
          {activeTab === 'business' && (
            <div className="settings-business-section">
              <div className="settings-business-head">
                <div>
                  <h3 className="settings-business-title">Perfil do Negócio</h3>
                  <p className="settings-business-desc">Configure o que aparece no cardápio público e no diretório.</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleAcceptOrdersChange(!acceptOrders)}
                  disabled={savingAcceptOrders}
                  className={`settings-status-pill ${acceptOrders ? 'is-on' : 'is-off'}`}
                  aria-pressed={acceptOrders}
                >
                  <span className="settings-status-pill__mark" aria-hidden="true">
                    <CheckCircle2 size={14} />
                  </span>
                  <span className="settings-status-pill__text">
                    <strong>{savingAcceptOrders ? 'Salvando...' : 'Aceitar encomendas'}</strong>
                    <small>{acceptOrders ? 'Mostra a aba de encomendas no cardápio público.' : 'Cardápio de encomendas oculto para clientes.'}</small>
                  </span>
                </button>
              </div>

              <div className="settings-section-card settings-section-card--accent">
                <div className="settings-card-head">
                  <Shield size={18} />
                  <span>Categoria do Negócio</span>
                </div>
                <input
                  {...inp}
                  list="business-category-list"
                  value={settings.businessCategory || ''}
                  onChange={e => setSettings({ ...settings, businessCategory: e.target.value })}
                  placeholder="Ex: Pizza, Marmitaria, Açaí, Confeitaria"
                />
                <datalist id="business-category-list">
                  {BUSINESS_CATEGORY_OPTIONS.map(option => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <p className="settings-helper">Essa categoria alimenta o diretório público e a home estilo iFood.</p>
              </div>

              <div className="settings-grid settings-grid--two">
                <div className="settings-section-card">
                  <label style={labelStyle}>Tipos de pedidos</label>
                  <div className="settings-option-grid settings-option-grid--two">
                    {[
                      { key: 'delivery', label: 'Delivery' },
                      { key: 'order', label: 'Encomendas' }
                    ].map(item => {
                      const checked = !!settings.dailyDeliveryItems?.orderTypes?.[item.key];
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSettings(s => ({
                            ...s,
                            dailyDeliveryItems: {
                              ...normalizeDeliveryMenuOptions(s.dailyDeliveryItems),
                              orderTypes: {
                                ...normalizeDeliveryMenuOptions(s.dailyDeliveryItems).orderTypes,
                                [item.key]: !checked
                              }
                            }
                          }))}
                          className={`settings-toggle-card ${checked ? 'is-on' : ''}`}
                        >
                          <span>{item.label}</span>
                          <span className="settings-switch" aria-hidden="true">
                            <span className="settings-switch__thumb" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="settings-section-card">
                  <label style={labelStyle}>Métodos de retirada</label>
                  <div className="settings-option-grid settings-option-grid--stack">
                    {[
                      { key: 'delivery', label: 'Delivery' },
                      { key: 'pickup', label: 'Retirada na loja' },
                      { key: 'local', label: 'Consumo no local' }
                    ].map(item => {
                      const checked = !!settings.dailyDeliveryItems?.fulfillmentMethods?.[item.key];
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSettings(s => {
                            const current = normalizeDeliveryMenuOptions(s.dailyDeliveryItems);
                            return {
                              ...s,
                              dailyDeliveryItems: {
                                ...current,
                                fulfillmentMethods: {
                                  ...current.fulfillmentMethods,
                                  [item.key]: !checked
                                }
                              }
                            };
                          })}
                          className={`settings-toggle-card settings-toggle-card--full ${checked ? 'is-on' : ''}`}
                        >
                          <span>{item.label}</span>
                          <span className="settings-switch" aria-hidden="true">
                            <span className="settings-switch__thumb" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="settings-helper">O cardápio só exibe as opções que estiverem ativadas aqui.</p>
                </div>
              </div>

              <div className="settings-section-card">
                <label style={labelStyle}>Tempo de preparo</label>
                <input
                  {...inp}
                  type="text"
                  value={settings.prepTime || ''}
                  onChange={e => setSettings({ ...settings, prepTime: e.target.value })}
                  placeholder="Ex: 30-45"
                />
                <p className="settings-helper">Exibido no cabeçalho do cardápio público como tempo estimado de entrega.</p>
              </div>

              <div className="settings-grid settings-grid--two">
                <div className="settings-section-card">
                  <label style={labelStyle}>Nome Fantasia</label>
                  <input {...inp} value={settings.businessName} onChange={e => setSettings({ ...settings, businessName: e.target.value })} placeholder="Nome da sua loja" />
                </div>
                <div className="settings-section-card">
                  <label style={labelStyle}>Endereço completo</label>
                  <input
                    {...inp}
                    ref={businessAddressRef}
                    value={settings.businessAddress}
                    onFocus={attachBusinessAddressAutocomplete}
                    onChange={e => setSettings({ ...settings, businessAddress: e.target.value, businessPlaceId: '', businessLat: null, businessLng: null, businessMapsUrl: '' })}
                    placeholder="Rua, número, bairro, cidade e estado"
                  />
                  <p className="settings-helper">Selecione uma sugestão do Google para registrar a posição correta.</p>
                </div>
              </div>

              <div className="settings-grid settings-grid--two">
                <div className="settings-section-card">
                  <label style={labelStyle}>ID / Número do Administrador</label>
                  <input {...inp} value={settings.managerJid} onChange={e => setSettings({ ...settings, managerJid: e.target.value })} placeholder="Ex: 5521..." />
                </div>
                <div className="settings-section-card">
                  <label style={labelStyle}>Capacidade de Pedidos / Dia</label>
                  <input {...inp} type="number" value={settings.dailyMaxOrders} onChange={e => setSettings({ ...settings, dailyMaxOrders: parseInt(e.target.value) })} />
                </div>
              </div>

              <div className="settings-section-card settings-section-card--warning">
                <div className="settings-card-head settings-card-head--warning">
                  <Shield size={18} />
                  <span>Dados para Validação de Pix</span>
                </div>
                <div className="settings-grid settings-grid--two">
                  <div>
                    <label style={microLabel}>Nome do Recebedor Oficial</label>
                    <input {...inp} value={settings.pixReceiverName || ''} onChange={e => setSettings({ ...settings, pixReceiverName: e.target.value })} placeholder="Ex: Linda Cake Ltda" />
                  </div>
                  <div>
                    <label style={microLabel}>Chave Pix Oficial (CPF / CNPJ / Cel)</label>
                    <input {...inp} value={settings.pixReceiverKey || ''} onChange={e => setSettings({ ...settings, pixReceiverKey: e.target.value })} placeholder="Ex: 12.345..." />
                  </div>
                </div>
                <p className="settings-helper">A Lily usará esses dados para conferir se o Pix enviado pelo cliente caiu na conta certa.</p>
              </div>

              <div className="settings-section-card settings-section-card--notice">
                <div className="settings-card-head settings-card-head--notice">
                  <Bell size={18} />
                  <span>Lembrete Automático de Retirada</span>
                </div>
                <div className="settings-reminder-grid">
                  <div>
                    <label style={microLabel}>Horas de antecedência para enviar o lembrete</label>
                    <div className="settings-reminder-inline">
                      <input {...inp} className="settings-reminder-input" type="number" value={settings.reminderHours} onChange={e => setSettings({ ...settings, reminderHours: parseInt(e.target.value) })} />
                      <span className="settings-reminder-text">horas antes da retirada</span>
                    </div>
                  </div>
                  <div className="settings-reminder-copy">
                    O sistema enviará uma mensagem automática ao cliente lembrando do horário agendado.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'delivery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div className="settings-subcard" style={subCard}>
                <label style={{ ...labelStyle, marginBottom: '10px' }}>Modo de Cálculo do Frete</label>
                <select {...inp} value={settings.deliveryMode} onChange={e => setSettings({ ...settings, deliveryMode: e.target.value })}>
                  <option value="hibrido">Híbrido (Regras DB + App)</option>
                  <option value="manual">Manual (Apenas Regras DB)</option>
                  <option value="automatico">Automático (Apenas App)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', gridColumn: '1 / -1' }}>
                <input type="checkbox" checked={settings.allowCashOnDelivery} onChange={e => setSettings({ ...settings, allowCashOnDelivery: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                <label style={{ fontSize: '14px', fontWeight: 600 }}>Permitir pagamento em Dinheiro (quando calculado pelo App)</label>
              </div>

              {settings.deliveryMode !== 'automatico' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Tabela de Preços por Distância</label>
                    <button onClick={addDeliveryRule} style={smallLink}>+ Adicionar Faixa</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {settings.deliveryRules.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Nenhuma regra configurada. O frete será manual.</p>}
                    {settings.deliveryRules.map((rule, idx) => (
                      <div key={idx} style={{ ...ruleRow, gridTemplateColumns: 'auto 70px auto auto 90px auto auto', gap: '10px' }}>
                        <span>Até</span>
                        <input {...inp} style={smallInp} type="number" value={rule.maxKm} onChange={e => updateRule(idx, 'maxKm', e.target.value)} />
                        <span>KM</span>
                        <span style={{ marginLeft: '5px' }}>Taxa: R$</span>
                        <input {...inp} style={smallInp} type="number" value={rule.fee} onChange={e => updateRule(idx, 'fee', e.target.value)} />

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '10px' }}>
                          <input
                            type="checkbox"
                            checked={rule.allowCash !== false}
                            onChange={e => {
                              const rules = [...settings.deliveryRules];
                              rules[idx].allowCash = e.target.checked;
                              setSettings(s => ({ ...s, deliveryRules: rules }));
                            }}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => {
                            const rules = [...settings.deliveryRules];
                            rules[idx].allowCash = rules[idx].allowCash === false ? true : false;
                            setSettings(s => ({ ...s, deliveryRules: rules }));
                          }}>Aceitar Dinheiro</span>
                        </div>

                        <button onClick={() => setSettings(s => ({ ...s, deliveryRules: s.deliveryRules.filter((_, i) => i !== idx) }))} style={delBtn}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label style={labelStyle}>WhatsApp do Entregador (Notificações)</label>
                <input {...inp} value={settings.deliveryJid} onChange={e => setSettings({ ...settings, deliveryJid: e.target.value })} placeholder="JID para aviso de delivery" />
              </div>
              <div className="settings-subcard" style={subCard}>
                <label style={{ ...labelStyle, marginBottom: '10px' }}>Frete gratis por distancia</label>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, freeDeliveryEnabled: !settings.freeDeliveryEnabled })}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    background: settings.freeDeliveryEnabled ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    fontWeight: 700
                  }}
                >
                  <span>{settings.freeDeliveryEnabled ? 'Ativado' : 'Desativado'}</span>
                  <span style={{
                    width: '46px',
                    height: '26px',
                    borderRadius: '999px',
                    padding: '3px',
                    background: settings.freeDeliveryEnabled ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: settings.freeDeliveryEnabled ? 'flex-end' : 'flex-start'
                  }}>
                    <span style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: settings.freeDeliveryEnabled ? '#22c55e' : '#d1d5db'
                    }} />
                  </span>
                </button>
              </div>
              <div className="settings-subcard" style={subCard}>
                <label style={{ ...labelStyle, marginBottom: '10px' }}>Km gratis</label>
                <input {...inp} type="number" step="0.1" min="0" value={settings.freeDeliveryKm} onChange={e => setSettings({ ...settings, freeDeliveryKm: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
          )}

          {activeTab === 'schedules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Horários de Funcionamento</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Defina quando a Lily pode aceitar pedidos e as regras de retirada.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day, idx) => {
                  const slot = slots.find(s => s.dayOfWeek === idx);
                  return (
                    <div key={idx} style={{ ...ruleRow, gridTemplateColumns: '120px 1fr 1fr auto' }}>
                      <span style={{ fontWeight: 700 }}>{day}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Abre:</label>
                        <input
                          {...inp}
                          style={smallInp}
                          type="time"
                          value={slot?.startTime || '09:00'}
                          onChange={e => {
                            const newSlots = [...slots.filter(s => s.dayOfWeek !== idx), { dayOfWeek: idx, startTime: e.target.value, endTime: slot?.endTime || '20:00' }];
                            setSlots(newSlots.sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Fecha:</label>
                        <input
                          {...inp}
                          style={smallInp}
                          type="time"
                          value={slot?.endTime || '20:00'}
                          onChange={e => {
                            const newSlots = [...slots.filter(s => s.dayOfWeek !== idx), { dayOfWeek: idx, startTime: slot?.startTime || '09:00', endTime: e.target.value }];
                            setSlots(newSlots.sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: slot ? '#3b82f6' : 'var(--text-muted)' }}>
                          {slot ? 'ABERTO' : 'FECHADO'}
                        </span>
                        <button
                          onClick={() => {
                            if (slot) {
                              setSlots(slots.filter(s => s.dayOfWeek !== idx));
                            } else {
                              setSlots([...slots, { dayOfWeek: idx, startTime: '09:00', endTime: '20:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
                            }
                          }}
                          style={{
                            width: '44px',
                            height: '22px',
                            backgroundColor: slot ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${slot ? '#3b82f6' : 'var(--border-color)'}`,
                            borderRadius: '20px',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.3s'
                          }}
                        >
                          <div style={{
                            width: '14px',
                            height: '14px',
                            backgroundColor: slot ? '#3b82f6' : 'var(--text-muted)',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: '3px',
                            left: slot ? '25px' : '3px',
                            transition: 'all 0.3s',
                            boxShadow: slot ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none'
                          }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {activeTab === 'bot' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Motores de Inteligência</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px' }}>
                <div>
                  <label style={labelStyle}>Modelo de IA Ativo</label>
                  <select {...inp} value={settings.activeModel} onChange={e => setSettings({ ...settings, activeModel: e.target.value })}>
                    <option value="openai">OpenAI GPT-4o (Recomendado)</option>
                    <option value="openai-mini">OpenAI GPT-4o Mini (Econômico)</option>
                    <option value="openai-nano">OpenAI GPT-4.1 Nano</option>
                    <option value="claude">Anthropic Claude 3.5 Sonnet</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '25px' }}>
                  <input type="checkbox" checked={settings.reportEnabled} onChange={e => setSettings({ ...settings, reportEnabled: e.target.checked })} style={{ width: '18px', height: '18px' }} />
                  <label style={{ fontSize: '14px', fontWeight: 600 }}>Ativar Relatório Diário por WhatsApp</label>
                </div>
              </div>

              <div className="settings-subcard" style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <MessageSquare size={20} color="#10b981" />
                  <span style={{ fontWeight: 800 }}>Chaves de API</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={microLabel}>OpenAI API Key</label>
                    <input {...inp} type="password" value={settings.openaiKey} onChange={e => setSettings({ ...settings, openaiKey: e.target.value })} placeholder="sk-..." />
                  </div>
                  <div>
                    <label style={microLabel}>Anthropic (Claude) API Key</label>
                    <input {...inp} type="password" value={settings.claudeKey} onChange={e => setSettings({ ...settings, claudeKey: e.target.value })} placeholder="sk-ant-..." />
                  </div>
                </div>
              </div>

              <div style={{ ...subCard, borderLeftColor: '#3b82f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <Shield size={20} color="#3b82f6" />
                  <span style={{ fontWeight: 800 }}>Mercado Pago</span>
                  {!canUseMercadoPago && <span style={{ marginLeft: 'auto', padding: '4px 9px', borderRadius: '999px', background: '#fff1dc', color: '#9a5a00', fontSize: '11px', fontWeight: 800 }}>PLANO ILIMITADO</span>}
                </div>
                {!canUseMercadoPago && <div style={{ padding: '16px', borderRadius: '12px', background: '#f7faf5', border: '1px solid #d9e5d2' }}><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>Receba pagamentos online com PIX e cartão e confirme pedidos automaticamente. Esse recurso está disponível no plano Ilimitado.</p><button type="button" onClick={() => window.location.assign('/comprar')} style={{ marginTop: '12px', padding: '10px 14px', border: 0, borderRadius: '10px', background: 'var(--accent-primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Fazer upgrade</button></div>}
                <div style={{ display: canUseMercadoPago ? 'grid' : 'none', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <label style={microLabel}>Access Token (Chave de API)</label>
                    <input {...inp} type="password" value={settings.mercadopagoToken || ''} onChange={e => setSettings({ ...settings, mercadopagoToken: e.target.value })} placeholder="APP_USR-..." />
                  </div>
                  <div>
                    <label style={microLabel}>Public Key</label>
                    <input {...inp} type="password" value={settings.mercadopagoPublicKey || ''} onChange={e => setSettings({ ...settings, mercadopagoPublicKey: e.target.value })} placeholder="APP_USR-..." />
                  </div>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '5px' }}>Usado para gerar links de pagamento automáticos e garantir que a cozinha só receba pedidos pagos.</p>
              </div>

              <div style={{ ...subCard, borderLeftColor: '#f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Calendar size={20} color="#f59e0b" />
                    <span style={{ fontWeight: 800 }}>Google Calendar</span>
                  </div>
                  {settings.gcalRefreshToken ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '13px', fontWeight: 800 }}>
                        <CheckCircle2 size={16} /> CONECTADO
                      </div>
                      <button onClick={connectGoogle} style={{ ...smallLink, color: '#3b82f6', fontSize: '12px' }}>
                        Reconectar
                      </button>
                      <button
                        onClick={async () => {
                          Swal.fire({
                            title: 'Sincronizando...',
                            text: 'Buscando eventos no Google Agenda',
                            allowOutsideClick: false,
                            didOpen: () => Swal.showLoading()
                          });
                          try {
                            const res = await api.post('/orders/calendar-sync');
                            Swal.fire({ title: 'Sincronizado!', text: `${res.data.synced} eventos atualizados.`, icon: 'success', timer: 2000, showConfirmButton: false });
                          } catch (err) {
                            Swal.fire('Erro na Sincronização', err.response?.data?.error || 'Não foi possível conectar ao Google.', 'error');
                          }
                        }}
                        style={{ ...smallLink, color: '#ef4444', fontSize: '12px' }}
                      >
                        Sincronizar Manualmente
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.post('/auth/google/disconnect');
                            setSettings({ ...settings, gcalRefreshToken: '', gcalAccessToken: '', gcalCalendarId: '' });
                            setCalendars([]);
                            Swal.fire('Desconectado', 'Sua conta do Google foi removida.', 'info');
                          } catch (err) {
                            Swal.fire('Erro', 'Falha ao desconectar do Google.', 'error');
                          }
                        }}
                        style={{ ...smallLink, color: '#ef4444', fontSize: '12px' }}
                      >
                        Desconectar
                      </button>
                    </div>
                  ) : (
                    <button onClick={connectGoogle} style={{ ...smallLink, color: '#f59e0b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <ExternalLink size={16} /> Conectar Google Agenda
                    </button>
                  )}
                </div>

                <label style={microLabel}>Agenda para Gravar Pedidos</label>
                <select {...inp} value={settings.gcalCalendarId} onChange={e => setSettings({ ...settings, gcalCalendarId: e.target.value })}>
                  <option value="">Selecione um calendário...</option>
                  {calendars.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.primary ? '(Principal)' : ''}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <label style={microLabel}>Hora da Sincronização (H)</label>
                    <input {...inp} type="number" value={settings.gcalSyncHour} onChange={e => setSettings({ ...settings, gcalSyncHour: parseInt(e.target.value) })} />
                  </div>
                  <div>
                    <label style={microLabel}>Hora do Relatório (H)</label>
                    <input {...inp} type="number" value={settings.reportHour} onChange={e => setSettings({ ...settings, reportHour: parseInt(e.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          )}



          {activeTab === 'marketing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '10px' }}>
                <h3 style={{ fontWeight: 800, fontSize: '20px' }}>Galeria de Mídias da Lily</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '5px' }}>Envie aqui as fotos que a Lily usará para postar Stories no WhatsApp quando você pedir.</p>
              </div>

              {/* Upload */}
              <div className="settings-subcard" style={subCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <Upload size={20} color="#10b981" />
                  <span style={{ fontWeight: 800 }}>Adicionar Nova Foto</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={microLabel}>Nome (ex: "Vulcão Chocolate")</label>
                    <input {...inp} value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Nome que a Lily vai reconhecer" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={microLabel}>Selecionar Imagem</label>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ ...inp.style, padding: '10px', cursor: 'pointer' }} />
                  </div>
                  <button onClick={handleUploadAsset} className="btn btn-primary" style={{ padding: '14px 20px', borderRadius: '12px', whiteSpace: 'nowrap' }}>
                    <Upload size={18} /> Subir Foto
                  </button>
                </div>
              </div>

              {/* Galeria */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
                {marketingAssets.length === 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '30px' }}>Nenhuma foto na galeria ainda.</p>
                )}
                {marketingAssets.map(asset => (
                  <div key={asset.id} style={{ borderRadius: '14px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', position: 'relative' }}>
                    <img
                      src={asset.url && asset.url.startsWith('http') ? asset.url : `${API_URL}${asset.url || asset.path}`}
                      alt={asset.name}
                      style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{asset.name}</span>
                      <button onClick={() => handleDeleteAsset(asset.id)} style={delBtn}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
      <style>{`
        .settings-business-section {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .settings-business-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border-color);
        }

        .settings-business-title {
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .settings-business-desc {
          margin: 6px 0 0;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .settings-status-pill {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid rgba(93, 183, 44, 0.22);
          background: rgba(93, 183, 44, 0.08);
          color: var(--text-primary);
          cursor: pointer;
          text-align: left;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        }

        .settings-status-pill:hover {
          transform: translateY(-1px);
          border-color: rgba(93, 183, 44, 0.34);
        }

        .settings-status-pill:disabled {
          opacity: 0.7;
          cursor: wait;
          transform: none;
        }

        .settings-status-pill.is-off {
          border-color: rgba(239, 68, 68, 0.20);
          background: rgba(239, 68, 68, 0.07);
        }

        .settings-status-pill.is-off .settings-status-pill__mark {
          background: rgba(239, 68, 68, 0.14);
          color: #ef4444;
        }

        .settings-status-pill__mark {
          width: 28px;
          height: 28px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(93, 183, 44, 0.14);
          color: #5db72c;
          flex: 0 0 auto;
        }

        .settings-status-pill__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .settings-status-pill__text strong {
          font-size: 13px;
          font-weight: 800;
          color: inherit;
        }

        .settings-status-pill__text small {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .settings-section-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 22px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
        }

        .settings-section-card--accent {
          border-left: 5px solid var(--primary);
        }

        .settings-section-card--warning {
          border-left: 5px solid #ef4444;
        }

        .settings-section-card--notice {
          border-left: 5px solid #f59e0b;
        }

        .settings-card-head {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          font-weight: 800;
          color: var(--text-primary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .settings-card-head--warning {
          color: #ef4444;
        }

        .settings-card-head--notice {
          color: #f59e0b;
        }

        .settings-helper {
          margin: 0;
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.45;
        }

        .settings-grid {
          display: grid;
          gap: 20px;
        }

        .settings-grid--two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .settings-option-grid {
          display: grid;
          gap: 12px;
        }

        .settings-option-grid--two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .settings-option-grid--stack {
          grid-template-columns: 1fr;
        }

        .settings-toggle-card {
          width: 100%;
          padding: 16px 18px;
          border-radius: 16px;
          border: 1px solid rgba(93, 183, 44, 0.18);
          background: rgba(255, 255, 255, 0.72);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        }

        .settings-toggle-card:hover {
          transform: translateY(-1px);
          border-color: rgba(93, 183, 44, 0.32);
        }

        .settings-toggle-card.is-on {
          background: rgba(93, 183, 44, 0.12);
          border-color: rgba(93, 183, 44, 0.42);
          color: #5db72c;
        }

        .settings-toggle-card--full {
          width: 100%;
        }

        .settings-switch {
          width: 52px;
          height: 28px;
          padding: 3px;
          border-radius: 999px;
          background: #d5d9df;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          flex: 0 0 auto;
          transition: background 0.15s ease, justify-content 0.15s ease;
          box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05);
        }

        .settings-toggle-card.is-on .settings-switch {
          background: rgba(93, 183, 44, 0.30);
          justify-content: flex-end;
        }

        .settings-switch__thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.16);
        }

        .settings-toggle-card.is-on .settings-switch__thumb {
          background: #5db72c;
        }

        .settings-reminder-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          align-items: start;
        }

        .settings-reminder-inline {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .settings-reminder-input {
          width: 110px !important;
        }

        .settings-reminder-text {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        @media (min-width: 1024px) {
          .settings-page {
            max-width: 1380px !important;
            padding: 28px 24px 40px !important;
          }

          .settings-header {
            margin-bottom: 24px !important;
            padding-bottom: 18px;
            border-bottom: 1px solid rgba(15, 23, 42, 0.08);
          }

          .settings-header h2,
          .settings-header p {
            color: #0f172a !important;
          }

          .settings-layout {
            display: grid !important;
            grid-template-columns: 250px minmax(0, 1fr) !important;
            gap: 24px !important;
            align-items: start;
          }

          .settings-nav {
            width: auto !important;
            gap: 12px !important;
          }

          .settings-tab {
            background: #ffffff !important;
            color: #475569 !important;
            border: 1px solid rgba(15, 23, 42, 0.08) !important;
            border-radius: 16px !important;
            box-shadow: none !important;
            transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
          }

          .settings-tab:hover {
            transform: translateY(-1px);
            color: #0f172a !important;
            border-color: rgba(93, 183, 44, 0.18) !important;
          }

          .settings-tab-active {
            background: rgba(93, 183, 44, 0.08) !important;
            color: #0f172a !important;
            border-color: rgba(93, 183, 44, 0.30) !important;
          }

          .settings-main-card {
            background: #ffffff !important;
            border: 1px solid rgba(15, 23, 42, 0.08) !important;
            box-shadow: none !important;
            color: #0f172a !important;
          }

          .settings-main-card h3,
          .settings-main-card h4,
          .settings-main-card .settings-business-title,
          .settings-main-card .settings-business-desc,
          .settings-main-card .settings-helper,
          .settings-main-card .settings-card-head,
          .settings-main-card label,
          .settings-main-card p {
            color: #0f172a !important;
          }

          .settings-business-head {
            padding-bottom: 20px;
          }

          .settings-status-pill {
            min-width: 324px;
          }

          .settings-section-card {
            background: #ffffff !important;
            border: 1px solid rgba(15, 23, 42, 0.08) !important;
            box-shadow: none !important;
          }

          .settings-section-card--accent {
            background: linear-gradient(180deg, rgba(93, 183, 44, 0.04), rgba(255, 255, 255, 0.96)) !important;
          }

          .settings-grid--two {
            gap: 18px;
          }

          .settings-option-card {
            background: #ffffff !important;
            border: 1px solid rgba(15, 23, 42, 0.08) !important;
            color: #0f172a !important;
          }

          .settings-option-card:hover {
            border-color: rgba(93, 183, 44, 0.26) !important;
          }

          .settings-option-card.is-on {
            color: #5db72c !important;
            background: rgba(93, 183, 44, 0.08) !important;
            border-color: rgba(93, 183, 44, 0.32) !important;
          }

          .settings-switch {
            background: rgba(15, 23, 42, 0.10);
          }

          .settings-option-card.is-on .settings-switch {
            background: rgba(93, 183, 44, 0.24);
          }

          .settings-main-card .settings-subcard {
            background: #f8fafc !important;
            border: 1px solid rgba(15, 23, 42, 0.08) !important;
            border-left-color: var(--primary, #3b82f6) !important;
          }

          .settings-main-card input,
          .settings-main-card select,
          .settings-main-card textarea {
            background: #ffffff !important;
            color: #0f172a !important;
            border-color: rgba(15, 23, 42, 0.12) !important;
          }

          .settings-main-card select option {
            background: #ffffff !important;
            color: #0f172a !important;
          }

        }
      `}</style>
    </div>
  );
};

// Styles
const tabStyle = { display: 'flex', alignItems: 'center', gap: '15px', padding: '18px', borderRadius: '15px', border: 'none', fontWeight: 700, fontSize: '15px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left', width: '100%' };
const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' };
const microLabel = { display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 800 };
const inp = { style: { width: '100%', padding: '14px 18px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: '#fff', fontSize: '15px', outline: 'none', transition: 'border-color 0.2s' } };
const subCard = { backgroundColor: 'rgba(255,255,255,0.03)', padding: '25px', borderRadius: '18px', borderLeft: '5px solid #3b82f6' };
const ruleRow = { display: 'grid', gridTemplateColumns: 'auto 90px auto auto 100px auto', gap: '15px', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', padding: '15px 20px', borderRadius: '12px' };
const smallInp = { ...inp.style, padding: '10px 15px', textAlign: 'center' };
const smallLink = { border: 'none', background: 'none', color: '#3b82f6', fontWeight: 800, fontSize: '14px', cursor: 'pointer' };
const delBtn = { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: 'auto', padding: '5px' };

export default Settings;

