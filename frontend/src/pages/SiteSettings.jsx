import React, { useState, useEffect } from 'react';
import { Palette, Layout as LayoutIcon, Globe, Upload, Save, Eye, CheckCircle, RefreshCw } from 'lucide-react';
import { api, API_URL } from '../api';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

const SiteSettings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
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
        seoDescription: '',
        pixelId: '',
        googleAnalyticsId: '',
        microsoftClarityId: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const res = await api.get('/settings');
            if (res.data) {
                setSettings(prev => ({ ...prev, ...res.data }));
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
            const payload = {
                businessName: settings.businessName,
                logoUrl: settings.logoUrl,
                faviconUrl: settings.faviconUrl,
                accentColor: settings.accentColor,
                buttonColor: settings.buttonColor,
                accentColorOrders: settings.accentColorOrders,
                buttonColorOrders: settings.buttonColorOrders,
                buttonTextColor: settings.buttonTextColor,
                backgroundColor: settings.backgroundColor,
                textColor: settings.textColor,
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

    const handleUpload = async (type, e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('secret', 'BlinkMediaSecret123!'); // Chave exigida pelo seu PHP

        const tId = toast.loading(`Enviando ${type === 'logo' ? 'Logo' : 'Ícone'}...`);
        try {
            // Upload direto para o servidor de arquivos PHP
            const res = await axios.post('https://files.digizap.com.br/upload.php', formData, {
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
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ maxWidth: '1100px', margin: '0 auto', padding: '30px' }}
        >
            <header style={{ marginBottom: '35px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Palette color="var(--accent-primary)" size={32} />
                    Identidade Visual do Site
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginTop: '5px' }}>Personalize as cores e mídias do seu cardápio digital público.</p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '30px' }}>
                
                {/* CONFIGURAÇÕES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                    
                    {/* Sessão de Imagens */}
                    <section className="card" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <LayoutIcon size={18} color="var(--accent-primary)" />
                            Mídias Principais
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '25px' }}>
                            {/* Logo */}
                            <div>
                                <label style={labelStyle}>Logo do Cardápio</label>
                                <div style={uploadBox}>
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} alt="Logo" />
                                    ) : (
                                        <Upload color="var(--text-muted)" size={28} />
                                    )}
                                    <input type="file" onChange={(e) => handleUpload('logo', e)} style={fileInput} />
                                </div>
                                <p style={hintStyle}>PNG transparente recomendado</p>
                            </div>

                            {/* Favicon */}
                            <div>
                                <label style={labelStyle}>Ícone da Aba (Favicon)</label>
                                <div style={uploadBox}>
                                    {settings.faviconUrl ? (
                                        <img src={settings.faviconUrl} style={{ width: '48px', height: '48px', objectFit: 'contain' }} alt="Favicon" />
                                    ) : (
                                        <Globe color="var(--text-muted)" size={28} />
                                    )}
                                    <input type="file" onChange={(e) => handleUpload('favicon', e)} style={fileInput} />
                                </div>
                                <p style={hintStyle}>Formato quadrado (32x32px)</p>
                            </div>
                        </div>
                    </section>

                    {/* Sessão de Cores */}
                    <section className="card" style={{ padding: '30px', borderLeft: '5px solid #10b981' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Palette size={18} color="#10b981" />
                            Paleta de Cores do Site
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Sessão Delivery */}
                            <div>
                                <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#10b981', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Aba Delivery (Entrega)</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'accentColor', label: 'Cor de Destaque', desc: 'Preços e ícones' },
                                        { id: 'buttonColor', label: 'Cor do Botão', desc: 'Botão finalizar' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{settings[item.id]}</span>
                                                <input type="color" value={settings[item.id]} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Sessão Encomendas */}
                            <div>
                                <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#4a2c2a', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Aba Encomendas</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'accentColorOrders', label: 'Cor de Destaque (Encomendas)', desc: 'Preços e ícones' },
                                        { id: 'buttonColorOrders', label: 'Cor do Botão (Encomendas)', desc: 'Botão finalizar' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{settings[item.id]}</span>
                                                <input type="color" value={settings[item.id]} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Sessão Geral */}
                            <div>
                                <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cores Gerais</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { id: 'buttonTextColor', label: 'Texto do Botão', desc: 'Cor do texto no botão' },
                                        { id: 'backgroundColor', label: 'Fundo do Site', desc: 'Fundo do cardápio' },
                                        { id: 'textColor', label: 'Cor dos Textos', desc: 'Nomes e descrições' },
                                    ].map(item => (
                                        <div key={item.id} style={colorRow}>
                                            <div>
                                                <p style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{item.label}</p>
                                                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{settings[item.id]}</span>
                                                <input type="color" value={settings[item.id]} onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })} style={colorPicker} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Sessão de Tracking e SEO */}
                    <section className="card" style={{ padding: '30px', borderLeft: '5px solid var(--accent-primary)', marginTop: '25px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Globe size={18} color="var(--accent-primary)" />
                            SEO e Rastreamento
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div>
                                <label style={labelStyle}>Descrição do Cardápio (Google e WhatsApp)</label>
                                <textarea 
                                    style={{ ...inputStyle, minHeight: '80px', resize: 'none' }} 
                                    value={settings.seoDescription || ''} 
                                    onChange={e => setSettings({...settings, seoDescription: e.target.value})}
                                    placeholder="Ex: Peça online as melhores pizzas da cidade. Entrega rápida!"
                                />
                                <p style={hintStyle}>Aparece na busca do Google e na prévia de links do WhatsApp.</p>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                                <div>
                                    <label style={labelStyle}>Pixel do Meta (Facebook)</label>
                                    <input 
                                        type="text" 
                                        style={inputStyle} 
                                        value={settings.pixelId || ''} 
                                        onChange={e => setSettings({...settings, pixelId: e.target.value})}
                                        placeholder="Ex: 1234567890"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Google Analytics 4</label>
                                    <input 
                                        type="text" 
                                        style={inputStyle} 
                                        value={settings.googleAnalyticsId || ''} 
                                        onChange={e => setSettings({...settings, googleAnalyticsId: e.target.value})}
                                        placeholder="Ex: G-XXXXX"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Microsoft Clarity</label>
                                    <input 
                                        type="text" 
                                        style={inputStyle} 
                                        value={settings.microsoftClarityId || ''} 
                                        onChange={e => setSettings({...settings, microsoftClarityId: e.target.value})}
                                        placeholder="Ex: abcdefghij"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="btn btn-primary"
                        style={{ padding: '18px', fontSize: '16px', borderRadius: '15px' }}
                    >
                        {saving ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />}
                        {saving ? 'Salvando...' : 'Salvar Identidade Visual'}
                    </button>
                </div>

                {/* PREVIEW */}
                <div style={{ position: 'sticky', top: '90px', height: 'fit-content' }}>
                    <div style={{ marginBottom: '15px', textAlign: 'center' }}>
                        <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <Eye size={16} color="var(--accent-primary)" />
                            Simulador de Celular
                        </h4>
                    </div>

                    {/* Smartphone Mockup */}
                    <div style={phoneFrame}>
                        <div style={phoneNotch}></div>
                        
                        <div style={{ ...phoneScreen, backgroundColor: settings.backgroundColor }}>
                            {/* Header */}
                            <div style={{ padding: '40px 20px 20px', textAlign: 'center' }}>
                                <div style={{ width: '70px', height: '70px', margin: '0 auto 15px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }}>
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    ) : (
                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                                    )}
                                </div>
                                <h1 style={{ fontSize: '18px', fontWeight: 900, color: settings.textColor }}>{settings.businessName || 'Sua Loja'}</h1>
                            </div>

                            {/* Mini Menu */}
                            <div style={{ padding: '0 15px', display: 'flex', gap: '8px', overflowX: 'hidden' }}>
                                <div style={{ padding: '6px 15px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, backgroundColor: settings.buttonColor, color: settings.buttonTextColor }}>Bolos</div>
                                <div style={{ padding: '6px 15px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(0,0,0,0.05)', color: settings.textColor }}>Doces</div>
                            </div>

                            {/* Product List */}
                            <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {[1, 2].map(i => (
                                    <div key={i} style={{ padding: '10px', backgroundColor: '#fff', borderRadius: '12px', display: 'flex', gap: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                                        <div style={{ width: '60px', height: '60px', backgroundColor: '#f4f4f5', borderRadius: '8px' }}></div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ width: '70%', height: '10px', backgroundColor: '#e4e4e7', borderRadius: '4px', marginBottom: '6px' }}></div>
                                            <div style={{ width: '40%', height: '14px', borderRadius: '4px', backgroundColor: `${settings.accentColor}20`, color: settings.accentColor, fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', paddingLeft: '5px' }}>R$ 45,00</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Finalizar Button */}
                            <div style={{ 
                                position: 'absolute', 
                                bottom: '20px', 
                                left: '15px', 
                                right: '15px', 
                                padding: '15px', 
                                borderRadius: '12px', 
                                backgroundColor: settings.buttonColor, 
                                color: settings.buttonTextColor,
                                textAlign: 'center',
                                fontWeight: 900,
                                fontSize: '12px',
                                boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
                            }}>
                                FINALIZAR PEDIDO
                            </div>
                        </div>
                    </div>
                </div>

            </div>
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
const colorPicker = { width: '36px', height: '36px', borderRadius: '8px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' };
const phoneFrame = { width: '310px', height: '580px', margin: '0 auto', backgroundColor: '#18181b', borderRadius: '40px', border: '8px solid #27272a', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden' };
const phoneNotch = { position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '100px', height: '18px', backgroundColor: '#27272a', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', zIndex: 10 };
const phoneScreen = { width: '100%', height: '100%', overflow: 'hidden', position: 'relative' };

export default SiteSettings;
