import React, { useState, useEffect } from 'react';
import { Palette, Layout as LayoutIcon, Globe, Upload, Save, Eye, CheckCircle, RefreshCw } from 'lucide-react';
import { api, API_URL } from '../api';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

const COLOR_FIELDS = [
    'accentColor',
    'buttonColor',
    'accentColorOrders',
    'buttonColorOrders',
    'buttonTextColor',
    'backgroundColor',
    'textColor'
];

const normalizeHexColor = (value, fallback = '#ffffff') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
        return `#${raw.slice(1).split('').map((c) => c + c).join('').toLowerCase()}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(raw)) {
        return raw.toLowerCase();
    }
    const rgbMatch = raw.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
        return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
    }
    if (raw.toLowerCase() === 'transparent') return fallback;
    return fallback;
};

const getFeaturedSizeHint = (count) => {
    const visibleCount = Math.max(1, Number(count) || 1);
    const railWidth = 900;
    const gap = 16;
    const width = Math.max(140, Math.floor((railWidth - (gap * (visibleCount - 1))) / visibleCount));
    const height = Math.min(230, Math.max(90, Math.round((width * 9) / 16)));
    const ratioNote = width <= 410 ? 'Mantem 16:9 em larguras menores.' : 'Altura limitada a 230px em telas maiores.';
    return `Tamanho recomendado: ${width} x ${height}px. ${ratioNote}`;
};

const SiteSettings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        slug: '',
        active: true,
        businessName: '',
        logoUrl: '',
        faviconUrl: '',
        accentColor: '#ff4d6d',
        buttonColor: '#ff4d6d',
        accentColorOrders: '#4a2c2a',
        buttonColorOrders: '#4a2c2a',
        buttonTextColor: '#ffffff',
        backgroundColor: '#ffffff',
        textColor: '#333333',
        menuTheme: 'dark',
        featuredCountDesktop: 4,
        featuredCountTablet: 2,
        featuredCountMobile: 1,
        seoDescription: '',
        pixelId: '',
        googleAnalyticsId: '',
        microsoftClarityId: ''
    });
    const isDarkMenuTheme = (settings.menuTheme || 'dark') === 'dark';
    const previewTheme = isDarkMenuTheme ? {
        bg: normalizeHexColor(settings.backgroundColor, '#07150d'),
        surface: normalizeHexColor(settings.backgroundColor, '#07150d'),
        surfaceSoft: `${normalizeHexColor(settings.backgroundColor, '#07150d')}f2`,
        text: normalizeHexColor(settings.textColor, '#ffffff'),
        textMuted: 'rgba(255,255,255,0.72)',
        border: `color-mix(in srgb, ${normalizeHexColor(settings.accentColor, '#6cb649')} 16%, transparent)`,
        accent: normalizeHexColor(settings.accentColor, '#6cb649'),
        buttonBg: normalizeHexColor(settings.buttonColor, normalizeHexColor(settings.accentColor, '#6cb649')),
        buttonText: normalizeHexColor(settings.buttonTextColor, '#ffffff'),
        cardBg: 'rgba(255,255,255,0.04)',
        cardSurface: `color-mix(in srgb, ${normalizeHexColor(settings.backgroundColor, '#07150d')} 90%, #ffffff 10%)`
    } : {
        bg: settings.backgroundColor || '#ffffff',
        surface: settings.backgroundColor || '#ffffff',
        surfaceSoft: `${settings.backgroundColor || '#ffffff'}f2`,
        text: settings.textColor || '#333333',
        textMuted: 'rgba(102,102,102,0.7)',
        border: 'rgba(0,0,0,0.08)',
        accent: settings.accentColor || '#ff4d6d',
        buttonBg: settings.buttonColor || '#ff4d6d',
        buttonText: settings.buttonTextColor || '#ffffff',
        cardBg: '#fff',
        cardSurface: '#f4f4f5'
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const res = await api.get('/settings');
            if (res.data) {
                const normalizedColors = COLOR_FIELDS.reduce((acc, key) => {
                    acc[key] = normalizeHexColor(res.data[key], key === 'accentColorOrders' || key === 'buttonColorOrders' ? '#4a2c2a' : acc[key] || settings[key]);
                    return acc;
                }, {});
                setSettings(prev => ({
                    ...prev,
                    ...res.data,
                    active: res.data.active ?? true,
                    menuTheme: res.data.menuTheme || 'dark',
                    ...normalizedColors,
                    featuredCountDesktop: Number.isFinite(Number(res.data.featuredCountDesktop)) ? Number(res.data.featuredCountDesktop) : 4,
                    featuredCountTablet: Number.isFinite(Number(res.data.featuredCountTablet)) ? Number(res.data.featuredCountTablet) : 2,
                    featuredCountMobile: Number.isFinite(Number(res.data.featuredCountMobile)) ? Number(res.data.featuredCountMobile) : 1
                }));
            }
        } catch (err) {
            console.error('Erro ao carregar configurações:', err);
            toast.error('Erro ao carregar as configurações do site.');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const colorPayload = COLOR_FIELDS.reduce((acc, key) => {
                acc[key] = normalizeHexColor(settings[key], key === 'accentColorOrders' || key === 'buttonColorOrders' ? '#4a2c2a' : '#ffffff');
                return acc;
            }, {});
            const payload = {
                slug: settings.slug,
                businessName: settings.businessName,
                logoUrl: settings.logoUrl,
                faviconUrl: settings.faviconUrl,
                active: settings.active,
                ...colorPayload,
                menuTheme: settings.menuTheme,
                featuredCountDesktop: settings.featuredCountDesktop,
                featuredCountTablet: settings.featuredCountTablet,
                featuredCountMobile: settings.featuredCountMobile,
                seoDescription: settings.seoDescription,
                pixelId: settings.pixelId,
                googleAnalyticsId: settings.googleAnalyticsId,
                microsoftClarityId: settings.microsoftClarityId
            };
            await api.post('/settings', payload);
            toast.success('Identidade visual salva com sucesso!');
        } catch (err) {
            console.error('Erro ao salvar:', err);
            toast.error('Erro ao salvar: ' + (err.response?.data?.error || 'Erro interno do servidor'));
        } finally {
            setSaving(false);
        }
    };

    const [slugStatus, setSlugStatus] = useState({ available: null, suggestion: '' });
    const [checkingSlug, setCheckingSlug] = useState(false);

    const checkSlugAvailability = async (val) => {
        if (!val || val.length < 3) return;
        if (String(val || '').trim().toLowerCase() === String(settings.slug || '').trim().toLowerCase()) {
            setSlugStatus({ available: true, suggestion: '' });
            return;
        }
        setCheckingSlug(true);
        try {
            const res = await api.get(`/public/check-slug/${val}`, {
                params: { currentSlug: settings.slug || '' }
            });
            setSlugStatus({ available: res.data.available, suggestion: res.data.suggestion || '' });
        } catch (err) {
            console.error(err);
        } finally {
            setCheckingSlug(false);
        }
    };

    const handleSlugChange = (e) => {
        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        setSettings({ ...settings, slug: val });
        setSlugStatus({ available: null, suggestion: '' });
    };

    const compressImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    const MAX_SIZE = 600;
                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                            type: 'image/webp',
                            lastModified: Date.now(),
                        });
                        resolve(compressedFile);
                    }, 'image/webp', 0.8);
                };
            };
        });
    };

    const handleUpload = async (type, e) => {
        const file = e.target.files[0];
        if (!file) return;

        const tId = toast.loading(`Otimizando e enviando ${type === 'logo' ? 'Logo' : 'Ícone'}...`);

        try {
            const compressedFile = await compressImage(file);

            const formData = new FormData();
            formData.append('file', compressedFile);
            formData.append('secret', 'BlinkMediaSecret123!');
            // Envia 200px para a logo para ter nitidez em telas Retina, mas ser muito leve
            formData.append('size', type === 'logo' ? '200' : '64');

            // Upload direto para o servidor de arquivos PHP
            const res = await axios.post('https://files.hotwhats.com.br/upload.php', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.success) {
                setSettings(prev => ({ ...prev, [type === 'logo' ? 'logoUrl' : 'faviconUrl']: res.data.url }));
                toast.success(`${type === 'logo' ? 'Logo' : 'Ícone'} atualizado!`, { id: tId });
            } else {
                throw new Error(res.data.error || 'Erro desconhecido');
            }
        } catch (err) {
            console.error('Erro no upload:', err);
            toast.error('Erro no upload: ' + (err.message || 'Falha na conexão'), { id: tId });
        }
    };

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '15px' }}>
            <RefreshCw className="animate-spin" size={32} color="var(--accent-primary)" />
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Carregando Identidade Visual...</p>
        </div>
    );

    return (
        <motion.div
            className="site-settings-page"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ maxWidth: '1100px', margin: '0 auto', padding: '30px' }}
        >
            <header className="site-settings-header" style={{ marginBottom: '35px' }}>
                <h1 className="site-settings-title" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    Identidade Visual do Site
                </h1>
                <p className="site-settings-muted" style={{ color: 'var(--text-secondary)', marginTop: '5px' }}>Personalize as cores e mídias do seu cardápio digital público.</p>
            </header>
            <label className="site-settings-theme-toggle-wrap" style={labelStyle}>
                <button
                    className="site-settings-theme-toggle"
                    type="button"
                    onClick={() => setSettings({ ...settings, menuTheme: (settings.menuTheme || 'dark') === 'dark' ? 'light' : 'dark' })}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        borderRadius: '14px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 700
                    }}
                >
                    <span>{(settings.menuTheme || 'dark') === 'dark' ? 'Modo Escuro' : 'Modo Claro'}</span>
                    <span style={{
                        width: '52px',
                        height: '28px',
                        borderRadius: '999px',
                        padding: '3px',
                        background: 'transparent',
                        border: '1px solid rgba(15,23,42,0.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: (settings.menuTheme || 'dark') === 'dark' ? 'flex-end' : 'flex-start'
                    }}>
                        <span style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: (settings.menuTheme || 'dark') === 'dark' ? '#6cb649' : '#d1d5db',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                        }} />
                    </span>
                </button>
            </label>

            <div className="site-settings-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '30px' }}>

                {/* CONFIGURAÇÕES */}
                <div className="site-settings-content" style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>

                    <section className="card site-settings-section site-settings-span-2" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)' }}>
                        <h3 className="site-settings-section-title" style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <CheckCircle size={18} color="var(--accent-primary)" />
                            Destaques do Cardapio
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
                            {[
                                { id: 'featuredCountDesktop', label: 'Desktop' },
                                { id: 'featuredCountTablet', label: 'Tablet' },
                                { id: 'featuredCountMobile', label: 'Mobile' }
                            ].map((item) => (
                                <div key={item.id}>
                                    <label className="site-settings-field-label" style={labelStyle}>{item.label}</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="12"
                                        style={inputStyle}
                                        value={settings[item.id] ?? ''}
                                        onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })}
                                    />
                                </div>
                            ))}
                        </div>
                        <p style={hintStyle}>Define quantos itens aparecem em destaque no desktop, tablet e mobile.</p>
                        <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
                            {[
                                { id: 'featuredCountDesktop', label: 'Desktop' },
                                { id: 'featuredCountTablet', label: 'Tablet' },
                                { id: 'featuredCountMobile', label: 'Mobile' }
                            ].map(item => (
                                <div key={`${item.id}-hint`} style={{ padding: '10px 12px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
                                    <p className="site-settings-muted" style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{item.label}</p>
                                    <p style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700 }}>{getFeaturedSizeHint(settings[item.id])}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="card site-settings-section site-settings-span-2" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)' }}>
                        <h3 className="site-settings-section-title" style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <CheckCircle size={18} color="var(--accent-primary)" />
                            Cardápio Público
                        </h3>

                        <label className="site-settings-field-label" style={labelStyle}>🔗 Link do Cardápio (Slug)</label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px 15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', fontSize: '14px', flexShrink: 0 }}>
                                hotwhats.com.br/
                            </div>
                            <input
                                style={{ ...inputStyle, flex: '1 1 280px' }}
                                value={settings.slug || ''}
                                onChange={handleSlugChange}
                                placeholder="nome-da-sua-loja"
                            />
                            <button
                                onClick={() => checkSlugAvailability(settings.slug)}
                                disabled={checkingSlug || !settings.slug}
                                className="btn btn-outline"
                                style={{ padding: '12px 20px', borderRadius: '12px', fontSize: '14px' }}
                            >
                                {checkingSlug ? '...' : 'Verificar'}
                            </button>
                            {settings.slug && slugStatus.available === true && (
                                <a
                                    href={`https://hotwhats.com.br/${settings.slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary"
                                    style={{ padding: '12px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}
                                >
                                    Abrir
                                </a>
                            )}
                        </div>
                        {slugStatus.available === true && <p style={{ fontSize: '12px', color: '#10b981', marginTop: '8px', fontWeight: 800 }}>✓ Link disponível!</p>}
                        {slugStatus.available === false && (
                            <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px', fontWeight: 700 }}>
                                ✕ Este link já está em uso. {slugStatus.suggestion && <>Sugestão: <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3b82f6' }} onClick={() => { setSettings({ ...settings, slug: slugStatus.suggestion }); setSlugStatus({ available: true, suggestion: '' }); }}>{slugStatus.suggestion}</span></>}
                            </p>
                        )}
                        <p className="site-settings-muted" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                            Esse endereço será usado no cardápio público e na home do diretório.
                        </p>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={!!settings.active}
                                onChange={(e) => setSettings({ ...settings, active: e.target.checked })}
                                style={{ width: '16px', height: '16px', accentColor: '#22c55e' }}
                            />
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Loja ativa no diretório</span>
                        </label>
                        <p className="site-settings-muted" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                            Se desativar, a loja sai da home e da lista pública.
                        </p>
                    </section>

                    {/* Sessão de Imagens */}
                    <section className="card site-settings-section" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)' }}>
                        <h3 className="site-settings-section-title" style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <LayoutIcon size={18} color="var(--accent-primary)" />
                            Mídias Principais
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '25px' }}>
                            {/* Logo */}
                            <div>
                                <label className="site-settings-field-label" style={labelStyle}>Logo do Cardápio</label>
                                <div style={uploadBox}>
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} alt="Logo" />
                                    ) : (
                                        <Upload color="var(--text-muted)" size={28} />
                                    )}
                                    <input type="file" accept="image/png, image/jpeg, image/jpg, image/webp" onChange={(e) => handleUpload('logo', e)} style={fileInput} />
                                </div>
                                <p className="site-settings-muted" style={hintStyle}>PNG transparente recomendado</p>
                            </div>

                            {/* Favicon */}
                            <div>
                                <label className="site-settings-field-label" style={labelStyle}>Ícone da Aba (Favicon)</label>
                                <div style={uploadBox}>
                                    {settings.faviconUrl ? (
                                        <img src={settings.faviconUrl} style={{ width: '48px', height: '48px', objectFit: 'contain' }} alt="Favicon" />
                                    ) : (
                                        <Globe color="var(--text-muted)" size={28} />
                                    )}
                                    <input type="file" accept="image/png, image/jpeg, image/jpg, image/webp" onChange={(e) => handleUpload('favicon', e)} style={fileInput} />
                                </div>
                                <p className="site-settings-muted" style={hintStyle}>Formato quadrado (32x32px)</p>
                            </div>
                        </div>
                    </section>

                    {/* Sessão de Cores */}
                    <section className="card site-settings-section" style={{ padding: '30px', borderLeft: '5px solid #10b981' }}>
                        <h3 className="site-settings-section-title" style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Palette size={18} color="#10b981" />
                            Paleta de Cores do Site
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Sessão Delivery */}
                            <div>
                                <h4 className="site-settings-section-subtitle" style={{ fontSize: '14px', fontWeight: 800, color: '#10b981', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Aba Delivery (Entrega)</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'accentColor', label: 'Cor de Destaque', desc: 'Preços e ícones' },
                                        { id: 'buttonColor', label: 'Cor do Botão', desc: 'Botão finalizar' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p className="site-settings-color-label" style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p className="site-settings-muted" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    type="text"
                                                    value={settings[item.id] || ''}
                                                    onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })}
                                                    onBlur={(e) => setSettings({ ...settings, [item.id]: normalizeHexColor(e.target.value, settings[item.id]) })}
                                                    placeholder="#rrggbb"
                                                    style={{ ...colorTextInput, width: '110px' }}
                                                />
                                                <input type="color" value={normalizeHexColor(settings[item.id], '#ffffff')} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value.toLowerCase() })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Sessão Encomendas */}
                            <div>
                                <h4 className="site-settings-section-subtitle" style={{ fontSize: '14px', fontWeight: 800, color: '#4a2c2a', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Aba Encomendas</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'accentColorOrders', label: 'Cor de Destaque (Encomendas)', desc: 'Preços e ícones' },
                                        { id: 'buttonColorOrders', label: 'Cor do Botão (Encomendas)', desc: 'Botão finalizar' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p className="site-settings-color-label" style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p className="site-settings-muted" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    type="text"
                                                    value={settings[item.id] || ''}
                                                    onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })}
                                                    onBlur={(e) => setSettings({ ...settings, [item.id]: normalizeHexColor(e.target.value, settings[item.id]) })}
                                                    placeholder="#rrggbb"
                                                    style={{ ...colorTextInput, width: '110px' }}
                                                />
                                                <input type="color" value={normalizeHexColor(settings[item.id], '#ffffff')} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value.toLowerCase() })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Sessão Geral */}
                            <div>
                                <h4 className="site-settings-section-subtitle" style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Gerais</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'buttonTextColor', label: 'Texto do Botão', desc: 'Cor do texto no botão' },
                                        { id: 'backgroundColor', label: 'Fundo do Site', desc: 'Fundo do cardápio' },
                                        { id: 'textColor', label: 'Cor dos Textos', desc: 'Nomes e descrições' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p className="site-settings-color-label" style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p className="site-settings-muted" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    type="text"
                                                    value={settings[item.id] || ''}
                                                    onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })}
                                                    onBlur={(e) => setSettings({ ...settings, [item.id]: normalizeHexColor(e.target.value, settings[item.id]) })}
                                                    placeholder="#rrggbb"
                                                    style={{ ...colorTextInput, width: '110px' }}
                                                />
                                                <input type="color" value={normalizeHexColor(settings[item.id], '#ffffff')} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value.toLowerCase() })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Sessão de Tracking e SEO */}
                    <section className="card site-settings-section site-settings-span-2" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)', marginTop: '25px' }}>
                        <h3 className="site-settings-section-title" style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Globe size={18} color="var(--accent-primary)" />
                            SEO e Rastreamento
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div>
                                <label className="site-settings-field-label" style={labelStyle}>Descrição do Cardápio (Google e WhatsApp)</label>
                                <textarea
                                    style={{ ...inputStyle, minHeight: '80px', resize: 'none' }}
                                    value={settings.seoDescription || ''}
                                    onChange={e => setSettings({ ...settings, seoDescription: e.target.value })}
                                    placeholder="Ex: Peça online as melhores pizzas da cidade. Entrega rápida!"
                                />
                                <p className="site-settings-muted" style={hintStyle}>Aparece na busca do Google e na prévia de links do WhatsApp.</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                                <div>
                                    <label style={labelStyle}>Pixel do Meta (Facebook)</label>
                                    <input
                                        type="text"
                                        style={inputStyle}
                                        value={settings.pixelId || ''}
                                        onChange={e => setSettings({ ...settings, pixelId: e.target.value })}
                                        placeholder="Ex: 1234567890"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Google Analytics 4</label>
                                    <input
                                        type="text"
                                        style={inputStyle}
                                        value={settings.googleAnalyticsId || ''}
                                        onChange={e => setSettings({ ...settings, googleAnalyticsId: e.target.value })}
                                        placeholder="Ex: G-XXXXX"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Microsoft Clarity</label>
                                    <input
                                        type="text"
                                        style={inputStyle}
                                        value={settings.microsoftClarityId || ''}
                                        onChange={e => setSettings({ ...settings, microsoftClarityId: e.target.value })}
                                        placeholder="Ex: abcdefghij"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="site-settings-save btn btn-primary"
                        style={{ padding: '18px', fontSize: '16px', borderRadius: '15px' }}
                    >
                        {saving ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />}
                        {saving ? 'Salvando...' : 'Salvar Identidade Visual'}
                    </button>
                </div>

                {/* PREVIEW */}
                <div className="site-settings-preview" style={{ position: 'sticky', top: '90px', height: 'fit-content' }}>
                    <div style={{ marginBottom: '15px', textAlign: 'center' }}>
                        <h4 className="site-settings-preview-title" style={{ fontSize: '14px', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <Eye size={16} color="var(--accent-primary)" />
                            Simulador de Celular
                        </h4>
                    </div>

                    {/* Smartphone Mockup */}
                    <div style={phoneFrame}>
                        <div style={phoneNotch}></div>

                        <div style={{ ...phoneScreen, backgroundColor: previewTheme.bg, color: previewTheme.text }}>
                            <div style={{ padding: '20px', paddingBottom: '10px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                <div style={{ width: '50px', height: '50px', backgroundColor: previewTheme.surfaceSoft, borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '50%' }} />
                                    ) : (
                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: previewTheme.surface }}></div>
                                    )}
                                </div>
                                <h1 style={{ fontSize: '18px', fontWeight: 900, color: previewTheme.text }}>{settings.businessName || 'Sua Loja'}</h1>
                            </div>
                            <div style={{ padding: '0 15px', display: 'flex', gap: '8px', borderBottom: `1px solid ${previewTheme.border}`, marginBottom: '15px' }}>
                                <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, padding: '5px 10px', color: previewTheme.accent, borderBottom: `2px solid ${previewTheme.accent}` }}>Entrega</span>
                                <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, padding: '5px 10px' }}>Encomendas</span>
                            </div>

                            <div style={{ padding: '0 15px', display: 'flex', gap: '8px', overflowX: 'hidden' }}>
                                <div style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, backgroundColor: previewTheme.cardSurface, color: previewTheme.text, border: `1px solid ${previewTheme.border}` }}>Bolos</div>
                                <div style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, backgroundColor: previewTheme.cardSurface, color: previewTheme.text, border: `1px solid ${previewTheme.border}` }}>Doces</div>
                            </div>

                            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {[1, 2].map(i => (
                                    <div key={i} style={{ padding: '10px', backgroundColor: previewTheme.cardBg, borderRadius: '12px', display: 'flex', gap: '10px', boxShadow: isDarkMenuTheme ? '0 2px 8px rgba(0,0,0,0.18)' : '0 2px 8px rgba(0,0,0,0.05)', border: `1px solid ${previewTheme.border}` }}>
                                        <div style={{ width: '60px', height: '60px', backgroundColor: previewTheme.cardSurface, borderRadius: '8px' }}></div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ width: '80%', height: '10px', backgroundColor: isDarkMenuTheme ? 'rgba(255,255,255,0.2)' : '#e4e4e7', borderRadius: '4px', marginBottom: '6px' }}></div>
                                            <div style={{ width: '70%', height: '10px', backgroundColor: isDarkMenuTheme ? 'rgba(255,255,255,0.2)' : '#e4e4e7', borderRadius: '4px', marginBottom: '6px' }}></div>
                                            <div style={{ fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', paddingLeft: '5px' }}>R$ 45,00</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div style={{
                                position: 'absolute',
                                bottom: '20px',
                                left: '15px',
                                right: '15px',
                                padding: '15px',
                                borderRadius: '12px',
                                backgroundColor: previewTheme.buttonBg,
                                color: previewTheme.buttonText,
                                textAlign: 'center',
                                fontWeight: 900,
                                fontSize: '12px',
                                boxShadow: isDarkMenuTheme ? '0 4px 15px rgba(0,0,0,0.22)' : '0 4px 15px rgba(0,0,0,0.1)'
                            }}>
                                FINALIZAR PEDIDO
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <style>{`
              @media (min-width: 1024px) {
                .site-settings-page {
                  max-width: 1380px !important;
                  padding: 28px 24px 40px !important;
                }

                .site-settings-page .site-settings-header .site-settings-title,
                .site-settings-page .site-settings-header .site-settings-muted,
                .site-settings-page .site-settings-preview-title {
                  color: #0f172a !important;
                }

                .site-settings-layout {
                  grid-template-columns: minmax(0, 1fr) 360px !important;
                  gap: 24px !important;
                  align-items: start;
                }

                .site-settings-content {
                  display: grid !important;
                  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                  gap: 20px !important;
                }

                .site-settings-span-2 {
                  grid-column: 1 / -1;
                }

                .site-settings-content .card {
                  background: #ffffff !important;
                  border: 1px solid rgba(15, 23, 42, 0.08) !important;
                  box-shadow: none !important;
                }

                .site-settings-content .site-settings-title,
                .site-settings-content .site-settings-section-title,
                .site-settings-content .site-settings-section-subtitle,
                .site-settings-content .site-settings-field-label,
                .site-settings-content .site-settings-color-label,
                .site-settings-content .site-settings-theme-toggle,
                .site-settings-content .site-settings-preview-title,
                .site-settings-content h1,
                .site-settings-content h3,
                .site-settings-content h4,
                .site-settings-content label {
                  color: #0f172a !important;
                }

                .site-settings-save {
                  color: #ffffff !important;
                }

                .site-settings-content .site-settings-muted,
                .site-settings-content p {
                  color: #475569 !important;
                }

                .site-settings-content input,
                .site-settings-content textarea,
                .site-settings-content select {
                  background: #ffffff !important;
                  color: #0f172a !important;
                  border-color: rgba(15, 23, 42, 0.12) !important;
                }

                .site-settings-theme-toggle {
                  background: transparent !important;
                  border: 1px solid rgba(15, 23, 42, 0.12) !important;
                  box-shadow: none !important;
                  color: #0f172a !important;
                }

                .site-settings-theme-toggle > span:first-child {
                  color: #0f172a !important;
                }

                .site-settings-save {
                  grid-column: 1 / -1;
                }
              }
            `}</style>
        </motion.div>
    );
};

// Styles
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' };
const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
const hintStyle = { fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' };
const uploadBox = { position: 'relative', height: '120px', backgroundColor: 'var(--bg-tertiary)', border: '2px dashed var(--border-color)', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'all 0.2s' };
const fileInput = { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' };
const colorRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border-color)' };
const colorTextInput = { padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'monospace', outline: 'none', width: '110px' };
const colorPicker = { width: '36px', height: '36px', borderRadius: '8px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' };
const phoneFrame = { width: '310px', height: '580px', margin: '0 auto', backgroundColor: '#18181b', borderRadius: '40px', border: '8px solid #27272a', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden' };
const phoneNotch = { position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '100px', height: '18px', backgroundColor: '#27272a', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', zIndex: 10 };
const phoneScreen = { width: '100%', height: '100%', overflow: 'hidden', position: 'relative' };

export default SiteSettings;

