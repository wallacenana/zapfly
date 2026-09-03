import React, { useState, useEffect } from 'react';
import { api, API_URL } from '../api';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { 
  ShoppingBag, 
  Clock, 
  MapPin, 
  User, 
  Phone, 
  X, 
  Plus, 
  Minus, 
  CheckCircle,
  ChevronRight,
  ArrowRight,
  Cake,
  Calendar
} from 'lucide-react';

import { useParams } from 'react-router-dom';

const Menu = () => {
  const { slug } = useParams();
  const [storeInfo, setStoreInfo] = useState({ name: 'Carregando...', products: [] });
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('delivery'); // 'delivery' or 'order'
  const [cart, setCart] = useState([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [orderComplete, setOrderComplete] = useState(null);
  
  // User Info from LocalStorage
  const [userInfo, setUserInfo] = useState(() => {
    const saved = localStorage.getItem('linda_cake_user');
    return saved ? JSON.parse(saved) : { name: '', phone: '', address: '' };
  });

  const [checkoutData, setCheckoutData] = useState({
    scheduledDate: '',
    scheduledTime: '',
    address: userInfo.address || ''
  });

  useEffect(() => {
    fetchStoreData();
  }, [slug]);

  useEffect(() => {
    localStorage.setItem('linda_cake_user', JSON.stringify(userInfo));
  }, [userInfo]);

  const fetchStoreData = async () => {
    try {
      // Se não tiver slug na URL (caso de teste /menu), tentamos um padrão ou erro
      const targetSlug = slug || 'linda-cake'; 
      const res = await api.get(`/public/menu/${targetSlug}`);
      setStoreInfo({
        name: res.data.businessName,
        products: res.data.products
      });
      setProducts(res.data.products);
    } catch (err) {
      console.error('Error fetching store data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => p.category === activeTab);

  const addToCart = (product, variation = null) => {
    const itemKey = variation ? `${product.id}-${variation.name}` : product.id;
    const existing = cart.find(item => item.itemKey === itemKey);

    if (existing) {
      setCart(cart.map(item => 
        item.itemKey === itemKey ? { ...item, quantity: item.quantity + 1 } : item
      ));
    } else {
      setCart([...cart, { 
        ...product, 
        itemKey, 
        variation, 
        quantity: 1,
        price: variation ? variation.price : product.price
      }]);
    }
  };

  const removeFromCart = (itemKey) => {
    const existing = cart.find(item => item.itemKey === itemKey);
    if (existing.quantity > 1) {
      setCart(cart.map(item => 
        item.itemKey === itemKey ? { ...item, quantity: item.quantity - 1 } : item
      ));
    } else {
      setCart(cart.filter(item => item.itemKey !== itemKey));
    }
  };

  const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  const handleCheckout = async () => {
    if (!userInfo.name || !userInfo.phone) {
      alert('Por favor, preencha seu nome e telefone.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        slug,
        clientName: userInfo.name,
        clientPhone: userInfo.phone,
        product: cart[0].name + (cart[0].variation ? ` (${cart[0].variation.name})` : ''),
        quantity: cart[0].quantity,
        type: activeTab,
        deliveryAddress: activeTab === 'delivery' ? checkoutData.address : null,
        scheduledDate: activeTab === 'order' ? checkoutData.scheduledDate : null,
        scheduledTime: activeTab === 'order' ? checkoutData.scheduledTime : null,
        carrinho_itens_extras: cart.slice(1).map(item => ({
          name: item.name + (item.variation ? ` (${item.variation.name})` : ''),
          price: item.price,
          quantity: item.quantity
        }))
      };

      const res = await api.post('/orders', payload);
      setOrderComplete(res.data);
      setCart([]);
      setIsCheckoutOpen(false);
    } catch (err) {
      alert('Erro ao processar pedido: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  if (orderComplete) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <Motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center"
        >
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} />
          </div>
          <h2 className="text-3xl font-bold mb-2">Pedido Realizado!</h2>
          <p className="text-slate-400 mb-8">
            Seu pedido foi registrado com sucesso. A Lily já enviou uma notificação para o seu WhatsApp.
          </p>

          {orderComplete.paymentLink && (
            <a 
              href={orderComplete.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all mb-4"
            >
              Pagar Agora (Mercado Pago)
            </a>
          )}

          <button 
            onClick={() => setOrderComplete(null)}
            className="text-slate-500 hover:text-white transition-colors"
          >
            Fazer outro pedido
          </button>
        </Motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans pb-32">
      {/* Header Premium */}
      <header className="relative h-64 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-pink-500/20 to-transparent z-0" />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10" />
        
        <div className="relative z-10 text-center px-4">
          <Motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="w-16 h-16 bg-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-pink-500/40">
              <Cake className="text-white" size={32} />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight mb-1">{storeInfo.name}</h1>
            <p className="text-pink-300 font-medium uppercase tracking-widest text-xs">Confeitaria Artesanal</p>
          </Motion.div>
        </div>
      </header>

      {/* Navegação de Categorias */}
      <div className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-white/5 py-4 px-4">
        <div className="max-w-2xl mx-auto flex bg-slate-900 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('delivery')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all font-bold ${activeTab === 'delivery' ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Clock size={18} />
            Pronta Entrega
          </button>
          <button
            onClick={() => setActiveTab('order')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all font-bold ${activeTab === 'order' ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Calendar size={18} />
            Encomendar
          </button>
        </div>
      </div>

      <main className="max-w-2xl mx-auto p-4 mt-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 animate-pulse">Buscando doçuras...</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/50 rounded-3xl border border-white/5">
                <ShoppingBag className="mx-auto text-slate-700 mb-4" size={48} />
                <p className="text-slate-500">Nenhum item disponível nesta categoria.</p>
              </div>
            ) : (
              filteredProducts.map(product => {
                const variations = typeof product.variations === 'string' ? JSON.parse(product.variations || '[]') : (product.variations || []);
                
                return (
                  <Motion.div
                    key={product.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-slate-900 border border-white/5 rounded-3xl overflow-hidden hover:border-pink-500/30 transition-all group"
                  >
                    <div className="p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-white group-hover:text-pink-400 transition-colors">{product.name}</h3>
                          <p className="text-slate-400 text-sm mt-1">{product.description || 'Sem descrição disponível.'}</p>
                        </div>
                        {variations.length === 0 && (
                          <span className="bg-pink-500/10 text-pink-400 font-black px-3 py-1 rounded-full text-sm">
                            R$ {parseFloat(product.price).toFixed(2)}
                          </span>
                        )}
                      </div>

                      {variations.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Opções disponíveis:</p>
                          {variations.map(v => (
                            <button
                              key={v.name}
                              onClick={() => addToCart(product, v)}
                              className="flex justify-between items-center bg-slate-800/50 hover:bg-pink-500 hover:text-white p-3 rounded-2xl transition-all group/var"
                            >
                              <span className="font-medium">{v.name}</span>
                              <div className="flex items-center gap-3">
                                <span className="font-bold opacity-80 text-sm">R$ {parseFloat(v.price).toFixed(2)}</span>
                                <div className="bg-white/10 p-1 rounded-lg group-hover/var:bg-white/20">
                                  <Plus size={16} />
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => addToCart(product)}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-pink-500 text-white font-bold rounded-2xl transition-all"
                        >
                          <Plus size={18} />
                          Adicionar ao Carrinho
                        </button>
                      )}
                    </div>
                  </Motion.div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Floating Cart Button */}
      <AnimatePresence>
        {cart.length > 0 && !isCheckoutOpen && (
          <Motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 left-4 right-4 z-50 max-w-2xl mx-auto"
          >
            <button
              onClick={() => setIsCheckoutOpen(true)}
              className="w-full bg-pink-500 text-white h-16 rounded-2xl shadow-2xl shadow-pink-500/40 flex items-center justify-between px-8 hover:scale-[1.02] active:scale-95 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="bg-white/20 w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm">
                  {cart.reduce((acc, i) => acc + i.quantity, 0)}
                </div>
                <span className="font-black text-lg uppercase tracking-tight">Ver Carrinho</span>
              </div>
              <div className="flex items-center gap-2 font-black text-xl">
                R$ {cartTotal.toFixed(2)}
                <ChevronRight size={20} />
              </div>
            </button>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Checkout Sidebar/Modal Overlay */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center p-0 md:p-4">
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            
            <Motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="relative w-full max-w-xl bg-slate-900 rounded-t-[2.5rem] md:rounded-[2.5rem] overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-2xl font-black text-white">Seu Pedido</h2>
                <button 
                  onClick={() => setIsCheckoutOpen(false)}
                  className="p-2 bg-slate-800 text-slate-400 rounded-full hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Itens do Carrinho */}
                <div className="space-y-4">
                  {cart.map(item => (
                    <div key={item.itemKey} className="flex items-center justify-between bg-slate-800/30 p-4 rounded-2xl border border-white/5">
                      <div className="flex-1">
                        <h4 className="font-bold text-white leading-tight">{item.name}</h4>
                        {item.variation && <p className="text-xs text-pink-400 font-medium">{item.variation.name}</p>}
                        <p className="text-slate-500 font-bold mt-1 text-sm">R$ {item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-3 bg-slate-800 rounded-xl p-1">
                        <button onClick={() => removeFromCart(item.itemKey)} className="p-2 text-pink-500 hover:bg-pink-500/10 rounded-lg">
                          <Minus size={16} />
                        </button>
                        <span className="font-black text-sm w-4 text-center">{item.quantity}</span>
                        <button onClick={() => addToCart(item, item.variation)} className="p-2 text-pink-500 hover:bg-pink-500/10 rounded-lg">
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dados do Cliente */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-pink-500">
                    <User size={18} />
                    <h3 className="font-black uppercase tracking-widest text-xs">Dados de Contato</h3>
                  </div>
                  <div className="grid gap-3">
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                      <input 
                        type="text" 
                        placeholder="Seu Nome Completo"
                        value={userInfo.name}
                        onChange={(e) => setUserInfo({ ...userInfo, name: e.target.value })}
                        className="w-full bg-slate-800 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white focus:border-pink-500 outline-none transition-all"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                      <input 
                        type="text" 
                        placeholder="WhatsApp (com DDD)"
                        value={userInfo.phone}
                        onChange={(e) => setUserInfo({ ...userInfo, phone: e.target.value })}
                        className="w-full bg-slate-800 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white focus:border-pink-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Detalhes de Entrega/Agendamento */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-pink-500">
                    {activeTab === 'delivery' ? <MapPin size={18} /> : <Clock size={18} />}
                    <h3 className="font-black uppercase tracking-widest text-xs">
                      {activeTab === 'delivery' ? 'Endereço para Entrega' : 'Data e Hora da Retirada'}
                    </h3>
                  </div>
                  
                  {activeTab === 'delivery' ? (
                    <div className="relative">
                      <MapPin className="absolute left-4 top-4 text-slate-600" size={18} />
                      <textarea 
                        placeholder="Rua, número, bairro e referências..."
                        value={checkoutData.address}
                        onChange={(e) => setCheckoutData({ ...checkoutData, address: e.target.value })}
                        className="w-full bg-slate-800 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white focus:border-pink-500 outline-none transition-all min-h-[100px]"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <input 
                        type="date" 
                        value={checkoutData.scheduledDate}
                        onChange={(e) => setCheckoutData({ ...checkoutData, scheduledDate: e.target.value })}
                        className="bg-slate-800 border border-white/5 rounded-2xl py-4 px-4 text-white focus:border-pink-500 outline-none transition-all"
                      />
                      <input 
                        type="time" 
                        value={checkoutData.scheduledTime}
                        onChange={(e) => setCheckoutData({ ...checkoutData, scheduledTime: e.target.value })}
                        className="bg-slate-800 border border-white/5 rounded-2xl py-4 px-4 text-white focus:border-pink-500 outline-none transition-all"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 bg-slate-800/50 border-t border-white/5">
                <div className="flex justify-between items-center mb-6 px-2">
                  <span className="text-slate-400 font-bold">Total do Pedido</span>
                  <span className="text-3xl font-black text-white">R$ {cartTotal.toFixed(2)}</span>
                </div>
                <button
                  onClick={handleCheckout}
                  disabled={loading}
                  className="w-full h-16 bg-pink-500 hover:bg-pink-400 disabled:bg-slate-700 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl shadow-pink-500/20"
                >
                  {loading ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      Confirmar e Pagar
                      <ArrowRight size={20} />
                    </>
                  )}
                </button>
              </div>
            </Motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
      `}} />
    </div>
  );
};

export default Menu;
