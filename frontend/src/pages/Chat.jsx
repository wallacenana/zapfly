import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Send, 
  Paperclip, 
  Mic, 
  MoreVertical, 
  Phone, 
  Video, 
  User, 
  Info, 
  X,
  MessageSquare,
  Check,
  CheckCheck,
  Smartphone,
  Bot
} from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

const Chat = () => {
  const [instances, setInstances] = useState([]);
  const [activeInstance, setActiveInstance] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showContactInfo, setShowContactInfo] = useState(true);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchInstances();

    socket.on('new_message', (data) => {
      // If message is for the active instance
      if (activeInstance && data.instanceId === activeInstance.id) {
        const msgJid = data.message.key.remoteJid;
        const msgId = data.message.key.id;
        const text = data.message.message?.conversation || data.message.message?.extendedTextMessage?.text;

        // 1. Update/Refresh contact list for ANY new message
        fetchChats(activeInstance.id);

        // 2. Update message window if it's the current chat
        if (activeContact && activeContact.jid === msgJid) {
            if (text) {
                setMessages(prev => {
                    // Prevent duplicates
                    if (prev.some(m => m.id === msgId)) return prev;
                    
                    return [...prev, {
                        id: msgId,
                        text,
                        fromMe: data.message.key.fromMe,
                        time: new Date(data.message.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        status: 'received'
                    }];
                });
            }
        }
      }
    });

    return () => {
      socket.off('new_message');
    };
  }, [activeInstance, activeContact]);

  useEffect(() => {
    if (activeInstance) {
      fetchChats(activeInstance.id);
      setActiveContact(null);
      setMessages([]);
    }
  }, [activeInstance]);

  // Auto-fetch messages when active contact changes
  useEffect(() => {
    if (activeContact && activeInstance) {
      fetchMessages(activeInstance.id, activeContact.jid);
    }
  }, [activeContact, activeInstance]);

  const fetchInstances = async () => {
    try {
      const res = await axios.get('http://localhost:3001/instances');
      setInstances(res.data);
      if (res.data.length > 0 && !activeInstance) setActiveInstance(res.data[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchChats = async (instanceId) => {
    setLoadingChats(true);
    try {
      const res = await axios.get(`http://localhost:3001/instances/${instanceId}/chats`);
      setContacts(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingChats(false);
    }
  };

  const fetchMessages = async (instanceId, jid) => {
    setLoadingMessages(true);
    try {
      const res = await axios.get(`http://localhost:3001/instances/${instanceId}/messages/${encodeURIComponent(jid)}`);
      setMessages(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !activeContact || !activeInstance) return;
    
    const textToSend = inputMessage;
    setInputMessage('');

    try {
      const response = await axios.post(`http://localhost:3001/instances/${activeInstance.id}/send`, {
        jid: activeContact.jid, // Use real WhatsApp JID
        text: textToSend
      });
      
      // Local update for immediate feedback using the REAL ID from WhatsApp
      const realId = response.data.key.id;
      
      setMessages(prev => {
        if (prev.some(m => m.id === realId)) return prev;
        return [...prev, {
          id: realId,
          text: textToSend,
          fromMe: true,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'sent'
        }];
      });
    } catch (err) {
      alert('Erro ao enviar mensagem');
      setInputMessage(textToSend);
    }
  };

  const toggleAI = async () => {
    if (!activeContact || !activeInstance) return;
    try {
      const newState = !activeContact.aiEnabled;
      await axios.patch(`http://localhost:3001/instances/${activeInstance.id}/chats/${activeContact.jid}`, {
        aiEnabled: newState
      });
      setActiveContact({ ...activeContact, aiEnabled: newState });
      // Update contacts list to reflect state
      setContacts(prev => prev.map(c => c.id === activeContact.id ? { ...c, aiEnabled: newState } : c));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Horizontal Instance Tabs */}
      <div style={{ 
        height: '65px', 
        backgroundColor: 'var(--bg-secondary)', 
        borderBottom: '1px solid var(--border-color)', 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0 20px',
        gap: '12px',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        scrollbarWidth: 'none',
      }}>
        <style>{`
          div::-webkit-scrollbar { display: none; }
          @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          }
          .pulse-green {
            background: #10b981;
            border-radius: 50%;
            width: 10px;
            height: 10px;
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 1);
            animation: pulse 2s infinite;
          }
        `}</style>
        {instances.map(inst => (
          <div 
            key={inst.id}
            onClick={() => setActiveInstance(inst)}
            style={{ 
              padding: '8px 20px', 
              borderRadius: '20px', 
              backgroundColor: activeInstance?.id === inst.id ? inst.color : `${inst.color}15`,
              color: activeInstance?.id === inst.id ? '#fff' : inst.color,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              border: `1px solid ${activeInstance?.id === inst.id ? 'transparent' : `${inst.color}33`}`,
              fontSize: '13px',
              fontWeight: 700,
              boxShadow: activeInstance?.id === inst.id ? `0 4px 15px ${inst.color}44` : 'none',
              transform: activeInstance?.id === inst.id ? 'scale(1.05)' : 'scale(1)'
            }}
          >
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: inst.status === 'connected' ? (activeInstance?.id === inst.id ? '#fff' : '#10b981') : (activeInstance?.id === inst.id ? 'rgba(255,255,255,0.5)' : '#71717a'),
              boxShadow: inst.status === 'connected' ? `0 0 5px ${activeInstance?.id === inst.id ? '#fff' : '#10b981'}` : 'none'
            }}></div>
            {inst.name}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Contacts List */}
        <div style={{ 
          width: '320px', 
          backgroundColor: 'var(--bg-secondary)', 
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Mensagens</h2>
              <div className="btn-icon"><MoreVertical size={18} /></div>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                placeholder="Buscar contatos..."
                style={{ 
                  width: '100%', 
                  padding: '10px 10px 10px 40px', 
                  borderRadius: '10px', 
                  border: '1px solid var(--border-color)', 
                  backgroundColor: 'var(--bg-tertiary)',
                  color: '#fff',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingChats ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                    <div className="animate-spin" style={{ width: '20px', height: '20px', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                </div>
            ) : contacts.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
                    Nenhuma conversa encontrada nesta instância.
                </div>
            ) : contacts.map(contact => (
              <div 
                key={contact.id}
                onClick={() => setActiveContact(contact)}
                style={{ 
                  padding: '15px 20px', 
                  display: 'flex', 
                  gap: '15px', 
                  cursor: 'pointer',
                  backgroundColor: activeContact?.id === contact.id ? 'var(--bg-tertiary)' : 'transparent',
                  borderLeft: activeContact?.id === contact.id ? `4px solid ${activeInstance?.color || 'var(--accent-primary)'}` : '4px solid transparent',
                  transition: 'all 0.1s'
                }}
                className="contact-item"
              >
                <div style={{ 
                  width: '45px', 
                  height: '45px', 
                  borderRadius: '50%', 
                  backgroundColor: 'var(--bg-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <div style={{ position: 'relative' }}>
                    <User size={20} color="var(--text-muted)" />
                    {contact.aiEnabled && (
                      <div className="pulse-green" style={{ 
                        position: 'absolute', 
                        bottom: '-2px', 
                        right: '-2px', 
                        width: '12px', 
                        height: '12px',
                        border: '2px solid var(--bg-secondary)'
                      }}></div>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{contact.time}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.lastMsg || contact.id.split('@')[0]}</p>
                    {contact.unread > 0 && (
                      <span style={{ 
                        backgroundColor: activeInstance?.color || 'var(--accent-primary)', 
                        color: '#fff', 
                        fontSize: '10px', 
                        fontWeight: 800, 
                        padding: '2px 6px', 
                        borderRadius: '10px' 
                      }}>
                        {contact.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Chat Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundImage: 'radial-gradient(var(--border-color) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
          {activeContact ? (
            <>
              {/* Chat Header */}
              <div style={{ 
                height: '70px', 
                padding: '0 25px', 
                backgroundColor: 'rgba(18, 18, 20, 0.8)', 
                backdropFilter: 'blur(10px)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={18} color="var(--text-muted)" />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 700 }}>{activeContact.name}</h3>
                      {activeContact.aiEnabled && (
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px', 
                          backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                          padding: '2px 8px', 
                          borderRadius: '12px',
                          border: '1px solid rgba(16, 185, 129, 0.2)'
                        }}>
                          <div className="pulse-green"></div>
                          <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>IA Ativa</span>
                        </div>
                      )}
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>online</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div 
                    onClick={toggleAI}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      cursor: 'pointer',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      backgroundColor: activeContact.aiEnabled ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-tertiary)',
                      border: `1px solid ${activeContact.aiEnabled ? '#10b981' : 'var(--border-color)'}`,
                      transition: 'all 0.2s'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={activeContact.aiEnabled || false} 
                      onChange={() => {}} // Controlled by div click
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: activeContact.aiEnabled ? '#10b981' : 'var(--text-secondary)' }}>
                      Agente IA ligado
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-icon"><Phone size={18} /></button>
                    <button className="btn-icon"><Video size={18} /></button>
                    <button className="btn-icon" onClick={() => setShowContactInfo(!showContactInfo)}><Info size={18} /></button>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '30px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {loadingMessages && messages.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="animate-spin" style={{ width: '30px', height: '30px', border: '3px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                    </div>
                ) : messages.map(msg => (
                  <div 
                    key={msg.id}
                    style={{ 
                      alignSelf: msg.fromMe ? 'flex-end' : 'flex-start',
                      maxWidth: '70%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: msg.fromMe ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div style={{ 
                      padding: '10px 15px', 
                      borderRadius: msg.fromMe ? '16px 16px 0 16px' : '16px 16px 16px 0',
                      backgroundColor: msg.fromMe ? (activeInstance?.color || 'var(--accent-primary)') : 'var(--bg-secondary)',
                      color: msg.fromMe ? '#fff' : 'var(--text-primary)',
                      fontSize: '14px',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                      border: msg.fromMe ? 'none' : '1px solid var(--border-color)'
                    }}>
                      {msg.text}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{msg.time}</span>
                      {msg.fromMe && (
                        <span style={{ color: msg.status === 'read' || msg.status === 4 ? '#34b7f1' : 'var(--text-muted)' }}>
                          {(msg.status === 'sent' || msg.status === 2) && <Check size={12} />}
                          {(msg.status === 'delivered' || msg.status === 3) && <CheckCheck size={12} />}
                          {(msg.status === 'read' || msg.status === 4) && <CheckCheck size={12} />}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div style={{ padding: '20px 25px', backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)' }}>
                <form 
                    onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                    style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '15px', 
                        backgroundColor: 'var(--bg-tertiary)', 
                        padding: '8px 15px', 
                        borderRadius: '14px',
                        border: '1px solid var(--border-color)'
                    }}
                >
                  <button type="button" className="btn-icon"><Paperclip size={20} /></button>
                  <input 
                    placeholder="Escreva sua mensagem..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    style={{ 
                      flex: 1, 
                      backgroundColor: 'transparent', 
                      border: 'none', 
                      outline: 'none', 
                      color: '#fff', 
                      fontSize: '14px',
                      padding: '8px 0'
                    }}
                  />
                  <button type="button" className="btn-icon"><Mic size={20} /></button>
                  <button 
                    type="submit"
                    style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      backgroundColor: activeInstance?.color || 'var(--accent-primary)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'transform 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                <MessageSquare size={32} />
              </div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Selecione uma conversa</h3>
              <p style={{ fontSize: '14px' }}>Escolha um contato na lista para começar a conversar.</p>
            </div>
          )}
        </div>

        {/* Right Sidebar (Contact Info) */}
        {showContactInfo && activeContact && (
          <div style={{ 
            width: '300px', 
            backgroundColor: 'var(--bg-secondary)', 
            borderLeft: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '14px' }}>Detalhes do Contato</span>
              <button onClick={() => setShowContactInfo(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div style={{ padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ width: '100px', height: '100px', borderRadius: '50%', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '15px' }}>
                <User size={48} color="var(--text-muted)" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '5px' }}>{activeContact.name}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{activeContact.id}</p>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>IDENTIFICADOR</label>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{activeContact.id}</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>TAGS</label>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>Cliente WhatsAPI</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
