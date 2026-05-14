import React, { useState, useEffect } from 'react';
import { Palette, Layout, Globe, Upload, Save, Eye, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { api, API_URL } from '../api';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const SiteSettings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        businessName: '',
        logoUrl: '',
        faviconUrl: '',
        accentColor: '#ff4d6d',
        buttonColor: '#ff4d6d',
        buttonTextColor: '#ffffff',
        backgroundColor: '#ffffff',
        textColor: '#333333'
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
            // Filtramos apenas os campos necessários para evitar erro 500 por campos inexistentes no modelo
            const payload = {
                businessName: settings.businessName,
                logoUrl: settings.logoUrl,
                faviconUrl: settings.faviconUrl,
                accentColor: settings.accentColor,
                buttonColor: settings.buttonColor,
                buttonTextColor: settings.buttonTextColor,
                backgroundColor: settings.backgroundColor,
                textColor: settings.textColor
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

        const tId = toast.loading(`Enviando ${type === 'logo' ? 'Logo' : 'Ícone'}...`);
        try {
            const res = await api.post('/marketing/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setSettings(prev => ({ ...prev, [type === 'logo' ? 'logoUrl' : 'faviconUrl']: res.data.url }));
            toast.success(`${type === 'logo' ? 'Logo' : 'Ícone'} atualizado!`, { id: tId });
        } catch (err) {
            toast.error('Erro no upload.', { id: tId });
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full text-white gap-4">
            <RefreshCw className="animate-spin" size={32} />
            <p className="font-medium">Carregando Identidade Visual...</p>
        </div>
    );

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-8 max-w-7xl mx-auto"
        >
            <header className="mb-10">
                <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
                    <Palette className="text-pink-500" size={32} />
                    Personalização do Site
                </h1>
                <p className="text-slate-400 mt-2">Dê a cara da sua marca para o seu cardápio digital</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                
                {/* CONFIGURAÇÕES */}
                <div className="space-y-8">
                    
                    {/* Sessão de Imagens */}
                    <section className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 space-y-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                            <Layout className="text-blue-400" size={20} />
                            Elementos Visuais
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Logo */}
                            <div className="space-y-3">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Logo do Cardápio</label>
                                <div className="relative group overflow-hidden bg-slate-800 rounded-2xl aspect-square flex items-center justify-center border-2 border-dashed border-slate-700 hover:border-pink-500/50 transition-all">
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} className="w-full h-full object-contain p-4" alt="Logo" />
                                    ) : (
                                        <Upload className="text-slate-600 group-hover:text-pink-500 transition-colors" size={32} />
                                    )}
                                    <input 
                                        type="file" 
                                        onChange={(e) => handleUpload('logo', e)}
                                        className="absolute inset-0 opacity-0 cursor-pointer" 
                                    />
                                </div>
                                <p className="text-[10px] text-slate-500 text-center">PNG ou JPG transparente (Recomendado)</p>
                            </div>

                            {/* Favicon */}
                            <div className="space-y-3">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Favicon (Ícone da Aba)</label>
                                <div className="relative group overflow-hidden bg-slate-800 rounded-2xl aspect-square flex items-center justify-center border-2 border-dashed border-slate-700 hover:border-blue-500/50 transition-all">
                                    {settings.faviconUrl ? (
                                        <img src={settings.faviconUrl} className="w-16 h-16 object-contain" alt="Favicon" />
                                    ) : (
                                        <Globe className="text-slate-600 group-hover:text-blue-500 transition-colors" size={32} />
                                    )}
                                    <input 
                                        type="file" 
                                        onChange={(e) => handleUpload('favicon', e)}
                                        className="absolute inset-0 opacity-0 cursor-pointer" 
                                    />
                                </div>
                                <p className="text-[10px] text-slate-500 text-center">Formato .ico ou .png circular</p>
                            </div>
                        </div>
                    </section>

                    {/* Sessão de Cores */}
                    <section className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 space-y-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                            <Palette className="text-pink-400" size={20} />
                            Paleta de Cores
                        </h3>

                        <div className="space-y-4">
                            {[
                                { id: 'accentColor', label: 'Cor de Destaque (Accent)', desc: 'Ícones e elementos secundários' },
                                { id: 'buttonColor', label: 'Cor dos Botões', desc: 'Botão principal de finalizar pedido' },
                                { id: 'buttonTextColor', label: 'Cor do Texto do Botão', desc: 'Texto dentro do botão principal' },
                                { id: 'backgroundColor', label: 'Cor do Fundo do Site', desc: 'Cor geral de fundo do cardápio' },
                                { id: 'textColor', label: 'Cor do Texto Geral', desc: 'Títulos e descrições de produtos' },
                            ].map((item) => (
                                <div key={item.id} className="flex items-center justify-between p-4 bg-slate-800/40 rounded-2xl border border-slate-700/50">
                                    <div>
                                        <p className="text-sm font-bold text-white">{item.label}</p>
                                        <p className="text-[11px] text-slate-500">{item.desc}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-mono text-slate-400 uppercase">{settings[item.id]}</span>
                                        <input 
                                            type="color" 
                                            value={settings[item.id]}
                                            onChange={(e) => setSettings({ ...settings, [item.id]: e.target.value })}
                                            className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-none"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full py-4 bg-gradient-to-r from-pink-600 to-rose-500 text-white rounded-2xl font-black text-lg shadow-xl shadow-pink-900/20 hover:scale-[1.02] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                        {saving ? <RefreshCw className="animate-spin" size={24} /> : <Save size={24} />}
                        {saving ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}
                    </button>
                </div>

                {/* PREVIEW EM TEMPO REAL (SMARTPHONE) */}
                <div className="hidden lg:flex flex-col items-center sticky top-8">
                    <div className="mb-4 text-center">
                        <h4 className="text-white font-bold flex items-center gap-2">
                            <Eye className="text-blue-400" size={18} />
                            Prévia Real
                        </h4>
                        <p className="text-xs text-slate-500">Veja como seus clientes verão seu site</p>
                    </div>

                    <div className="relative w-[320px] h-[640px] bg-slate-950 rounded-[3rem] border-[8px] border-slate-800 shadow-2xl overflow-hidden">
                        {/* Notch */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-b-2xl z-20"></div>

                        {/* Conteúdo do Site Simulado */}
                        <div className="w-full h-full overflow-y-auto" style={{ backgroundColor: settings.backgroundColor }}>
                            {/* Header do Site */}
                            <div className="p-6 text-center space-y-4 pt-12">
                                <div className="w-20 h-20 mx-auto rounded-2xl bg-white/10 flex items-center justify-center shadow-lg">
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} className="max-w-[80%] max-h-[80%] object-contain" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-slate-200/20"></div>
                                    )}
                                </div>
                                <h1 className="text-xl font-black" style={{ color: settings.textColor }}>
                                    {settings.businessName || 'Sua Loja'}
                                </h1>
                            </div>

                            {/* Categorias */}
                            <div className="px-4 flex gap-2 overflow-x-auto pb-4">
                                {['Promoções', 'Bolos', 'Doces'].map((cat, i) => (
                                    <div key={cat} className="px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap" 
                                        style={{ 
                                            backgroundColor: i === 0 ? settings.buttonColor : 'rgba(0,0,0,0.05)',
                                            color: i === 0 ? settings.buttonTextColor : settings.textColor
                                        }}
                                    >
                                        {cat}
                                    </div>
                                ))}
                            </div>

                            {/* Produtos */}
                            <div className="p-4 space-y-4">
                                {[1, 2].map(i => (
                                    <div key={i} className="bg-white rounded-2xl p-3 shadow-sm flex gap-3 border border-slate-100">
                                        <div className="w-20 h-20 bg-slate-100 rounded-xl flex-shrink-0"></div>
                                        <div className="flex-1 space-y-1">
                                            <div className="h-4 w-3/4 bg-slate-200 rounded"></div>
                                            <div className="h-3 w-1/2 bg-slate-100 rounded"></div>
                                            <div className="h-5 w-1/4 rounded mt-2" style={{ backgroundColor: `${settings.accentColor}20`, color: settings.accentColor }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Botão Flutuante */}
                            <div className="absolute bottom-6 left-4 right-4 p-4 rounded-2xl shadow-2xl flex items-center justify-center font-black text-sm"
                                style={{ backgroundColor: settings.buttonColor, color: settings.buttonTextColor }}>
                                FINALIZAR PEDIDO (2 itens)
                            </div>
                        </div>
                    </div>
                    
                    <div className="mt-6 flex items-center gap-4 bg-slate-900/80 px-6 py-3 rounded-full border border-slate-800">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="text-emerald-500" size={16} />
                            <span className="text-[11px] text-slate-300 font-medium italic">Responsivo</span>
                        </div>
                        <div className="w-px h-4 bg-slate-700"></div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="text-emerald-500" size={16} />
                            <span className="text-[11px] text-slate-300 font-medium italic">Otimizado</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SiteSettings;
