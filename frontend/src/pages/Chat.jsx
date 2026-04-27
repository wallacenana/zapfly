import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
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
  Bot,
  Users,
  Trash2,
  Zap
} from 'lucide-react';
import axios from 'axios';
import { api, API_URL, socket } from '../api';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  }
});


// const socket = io('http://localhost:3001'); // Removido, agora vem do ../api

const Chat = () => {
  const { jid: urlJid } = useParams();
  const [instances, setInstances] = useState([]);
  const [activeInstance, setActiveInstance] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);

  // Auto-selecionar contato se vier via URL (Kanban link)
  useEffect(() => {
    if (urlJid && contacts.length > 0 && !activeContact) {
      const decodedJid = decodeURIComponent(urlJid);
      const contact = contacts.find(c => c.jid === decodedJid);
      if (contact) {
        setActiveContact(contact);
      }
    }
  }, [urlJid, contacts, activeContact]);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showContactInfo, setShowContactInfo] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [presences, setPresences] = useState({});
  const [chatPage, setChatPage] = useState(0);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { x, y, type, data }

  const sentinelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const PAGE_SIZE = 40;

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
        // Instead of refetching full list, we just update the local order or fetch page 0
        fetchChats(activeInstance.id, true);

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

    socket.on('presence_update', (data) => {
      setPresences(prev => ({ ...prev, [data.jid]: { status: data.status, lastSeen: data.lastSeen } }));
    });

    socket.on('message_status_update', (data) => {
      if (activeInstance && data.instanceId === activeInstance.id) {
        setMessages(prev => prev.map(m =>
          m.id === data.msgId ? { ...m, status: data.status } : m
        ));
      }
    });

    socket.on('chat_update', (data) => {
      if (activeInstance && data.instanceId === activeInstance.id) {
        setContacts(prev => prev.map(c => 
          c.jid === data.jid ? { ...c, ...data } : c
        ));
        
        if (activeContact && activeContact.jid === data.jid) {
          setActiveContact(prev => ({ ...prev, ...data }));
        }
      }
    });

    return () => {
      socket.off('new_message');
      socket.off('presence_update');
      socket.off('message_status_update');
      socket.off('chat_update');
    };
  }, [activeInstance, activeContact]);

  useEffect(() => {
    if (activeInstance) {
      // Só dispara a busca se tiver 3+ caracteres ou se estiver limpando (vazio)
      if (searchTerm.length === 0 || searchTerm.length >= 3) {
        fetchChats(activeInstance.id, true);
        setActiveContact(null);
        setMessages([]);
      }
    }
  }, [activeInstance, filterType, searchTerm]);

  // IntersectionObserver — carrega mais ao chegar no fim da lista
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMoreChats && !loadingMore && !loadingChats && activeInstance) {
        setLoadingMore(true);
        setChatPage(p => {
          const nextPage = p + 1;
          const actualSearch = searchTerm.length >= 3 ? searchTerm : '';
          api.get(`/instances/${activeInstance.id}/chats`, {
            params: { skip: nextPage * PAGE_SIZE, take: PAGE_SIZE, search: actualSearch }
          }).then(res => {
            const { chats, hasMore } = res.data;
            setContacts(prev => {
              const newItems = chats.filter(c => !prev.some(p => p.id === c.id));
              return [...prev, ...newItems];
            });
            setHasMoreChats(hasMore);
          }).catch(console.error).finally(() => setLoadingMore(false));
          return nextPage;
        });
      }
    }, { threshold: 0.1 });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMoreChats, loadingMore, loadingChats, activeInstance]);

  // Auto-fetch messages when active contact changes
  useEffect(() => {
    if (activeContact && activeInstance) {
      fetchMessages(activeInstance.id, activeContact.jid);
      
      // Marcar como lido ao abrir
      const lastReceived = messages.filter(m => !m.fromMe).slice(-1)[0];
      if (lastReceived) {
        api.post(`/instances/${activeInstance.id}/chats/read`, {
          jid: activeContact.jid,
          msgId: lastReceived.id
        });
        // Update local UI
        setContacts(prev => prev.map(c => c.id === activeContact.id ? { ...c, unread: 0 } : c));
      }
    }
  }, [activeContact, activeInstance]);

  // Handle Global Click to close context menu
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const fetchInstances = async () => {
    try {
      const res = await api.get('/instances');
      setInstances(res.data);
      if (res.data.length > 0 && !activeInstance) setActiveInstance(res.data[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchChats = async (instanceId, reset = false) => {
    if (reset) {
      setContacts([]);
      setChatPage(0);
      setHasMoreChats(true);
    }
    const skip = reset ? 0 : chatPage * PAGE_SIZE;
    setLoadingChats(reset);
    try {
      const isGroup = filterType === 'groups' ? true : filterType === 'private' ? false : undefined;
      const actualSearch = searchTerm.length >= 3 ? searchTerm : '';
      const params = { skip, take: PAGE_SIZE, search: actualSearch, ...(isGroup !== undefined && { group: isGroup }) };
      const res = await api.get(`/instances/${instanceId}/chats`, { params });
      const { chats, hasMore } = res.data;
      setContacts(prev => {
        if (reset) return chats;
        const newItems = chats.filter(c => !prev.some(p => p.id === c.id));
        return [...prev, ...newItems];
      });
      setHasMoreChats(hasMore);
      if (!reset) setChatPage(p => p + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingChats(false);
      setLoadingMore(false);
    }
  };

  const fetchMessages = async (instanceId, jid) => {
    setLoadingMessages(true);
    try {
      const res = await api.get(`/instances/${instanceId}/messages/${encodeURIComponent(jid)}`);
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
      const response = await api.post(`/instances/${activeInstance.id}/send`, {
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
      Toast.fire({
        icon: 'error',
        title: 'Erro ao enviar mensagem'
      });
      setInputMessage(textToSend);
    }
  };

  const toggleAI = async () => {
    if (!activeContact || !activeInstance) return;
    try {
      const newState = !activeContact.aiEnabled;
      await api.patch(`/instances/${activeInstance.id}/chats/${activeContact.jid}`, {
        aiEnabled: newState
      });
      setActiveContact({ ...activeContact, aiEnabled: newState });
      // Update contacts list to reflect state
      setContacts(prev => prev.map(c => c.id === activeContact.id ? { ...c, aiEnabled: newState } : c));
    } catch (err) {
      console.error(err);
    }
  };

  const getProfilePic = async (jid) => {
    try {
      const res = await api.get(`/instances/${activeInstance.id}/profile-pic/${jid}`);
      return res.data.url;
    } catch {
      return null;
    }
  };

  const MessageAvatar = ({ jid }) => {
    const [url, setUrl] = useState(null);
    useEffect(() => {
      getProfilePic(jid).then(setUrl);
    }, [jid]);

    return (
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: 'var(--bg-tertiary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        border: '1px solid var(--border-color)'
      }}>
        {url ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <User size={18} color="var(--text-muted)" />}
      </div>
    );
  };

  const formatMessage = (text) => {
    if (!text) return '';

    // 1. Handle markdown links: [text](url)
    let formatted = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: inherit; text-decoration: underline; font-weight: bold;">$1</a>');

    // 2. Handle raw URLs (that are not already inside an <a> tag)
    formatted = formatted.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: inherit; text-decoration: underline;">$1</a>');

    // 3. Handle WhatsApp bold (*text*)
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');

    return <div dangerouslySetInnerHTML={{ __html: formatted.replace(/\n/g, '<br/>') }} />;
  };

  const handleMessageContextMenu = (e, msg) => {
    e.preventDefault();
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
      type: 'message',
      data: msg
    });
  };

  const handleChatContextMenu = (e, contact) => {
    e.preventDefault();
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
      type: 'chat',
      data: contact
    });
  };

  const deleteMessage = async () => {
    if (!contextMenu?.data) return;
    const msg = contextMenu.data;
    try {
      await api.post(`/instances/${activeInstance.id}/messages/delete`, {
        jid: activeContact.jid,
        msgId: msg.id,
        fromMe: msg.fromMe,
        forEveryone: true // Por padrão, apaga para todos se possível
      });
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      Toast.fire({ icon: 'success', title: 'Mensagem apagada' });
    } catch (err) {
      Toast.fire({ icon: 'error', title: 'Erro ao apagar mensagem' });
    }
    setContextMenu(null);
  };

  const markAsUnread = async (contact) => {
    try {
      await api.patch(`/instances/${activeInstance.id}/chats/${contact.jid}/unread`);
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, unread: 1 } : c));
      Toast.fire({ icon: 'success', title: 'Marcado como não lido' });
    } catch (err) {
      console.error(err);
    }
    setContextMenu(null);
  };

  const deleteChat = (contact) => {
    Swal.fire({
      title: 'Excluir conversa?',
      text: 'Isso apagará todas as mensagens e resetará os fluxos deste contato.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--danger)',
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      customClass: { popup: 'swal2-dark-popup' }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await api.delete(`/instances/${activeInstance.id}/chats/${encodeURIComponent(contact.jid)}`);
          setContacts(prev => prev.filter(c => c.id !== contact.id));
          if (activeContact?.id === contact.id) setActiveContact(null);
          Toast.fire({ icon: 'success', title: 'Conversa excluída' });
        } catch (err) {
          Toast.fire({ icon: 'error', title: 'Erro ao excluir conversa' });
        }
      }
    });
    setContextMenu(null);
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
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={() => setFilterType('all')}
                style={{ flex: 1, padding: '6px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: filterType === 'all' ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: filterType === 'all' ? '#fff' : 'var(--text-secondary)' }}>
                Todos
              </button>
              <button
                onClick={() => setFilterType('private')}
                style={{ flex: 1, padding: '6px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: filterType === 'private' ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: filterType === 'private' ? '#fff' : 'var(--text-secondary)' }}>
                Privado
              </button>
              <button
                onClick={() => setFilterType('groups')}
                style={{ flex: 1, padding: '6px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: filterType === 'groups' ? 'var(--accent-primary)' : 'var(--bg-tertiary)', color: filterType === 'groups' ? '#fff' : 'var(--text-secondary)' }}>
                Grupos
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingChats ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                <div className="animate-spin" style={{ width: '20px', height: '20px', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
              </div>
            ) : (contacts?.length === 0 || !contacts) ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
                Nenhuma conversa encontrada nesta instância.
              </div>
            ) : contacts
              .filter(c => {
                if (filterType === 'private') return !c.isGroup;
                if (filterType === 'groups') return c.isGroup;
                return true;
              })
              .map(contact => (
                <div
                  key={contact.id}
                  onClick={() => setActiveContact(contact)}
                  onContextMenu={(e) => handleChatContextMenu(e, contact)}
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
                    borderRadius: '12px',
                    backgroundColor: contact.isGroup ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: contact.isGroup ? '#3b82f6' : 'var(--text-muted)',
                    position: 'relative',
                    flexShrink: 0
                  }}>
                    {contact.isGroup ? <Users size={20} /> : <User size={20} />}
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {contact.name || contact.jid?.split('@')[0] || '—'}
                        </span>
                        {contact.inFlow && (
                          <Zap size={12} fill="#3b82f6" color="#3b82f6" style={{ flexShrink: 0 }} />
                        )}
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{contact.time}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.lastMsg || contact.jid?.split('@')[0] || '—'}</p>
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

              {/* Sentinel — dispara o IntersectionObserver */}
              <div ref={sentinelRef} style={{ height: '1px' }} />

              {/* Loading more indicator */}
              {loadingMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }}>
                  <div className="animate-spin" style={{ width: '16px', height: '16px', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                </div>
              )}

              {!hasMoreChats && contacts.length > 0 && (
                <div style={{ textAlign: 'center', padding: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Todas as conversas carregadas
                </div>
              )}
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
                      <h3 style={{ fontSize: '15px', fontWeight: 700 }}>{activeContact.name || activeContact.jid?.split('@')[0]}</h3>
                      {activeContact.aiEnabled && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '16px',
                          height: '16px',
                          backgroundColor: 'rgba(16, 185, 129, 0.1)',
                          borderRadius: '50%',
                          border: '1px solid rgba(16, 185, 129, 0.2)'
                        }}>
                          <div className="pulse-green"></div>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const p = presences[activeContact?.jid];
                      if (!p || p.status === 'unavailable') {
                        return p?.lastSeen
                          ? <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
                              visto por último {new Date(p.lastSeen * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          : <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>offline</p>;
                      }
                      if (p.status === 'composing') return <p style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>digitando...</p>;
                      if (p.status === 'recording') return <p style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>gravando áudio...</p>;
                      if (p.status === 'available') return <p style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>online</p>;
                      return <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>offline</p>;
                    })()}
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
                      onChange={() => { }} // Controlled by div click
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
                    onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                    style={{
                      alignSelf: msg.fromMe ? 'flex-end' : 'flex-start',
                      maxWidth: '70%',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start'
                    }}
                  >
                    {!msg.fromMe && activeContact?.isGroup && (
                      <div style={{ marginTop: '4px', flexShrink: 0 }}>
                        <MessageAvatar jid={msg.participant} />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.fromMe ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: msg.fromMe ? '16px 16px 0 16px' : '16px 16px 16px 0',
                        backgroundColor: msg.fromMe ? (activeInstance?.color || 'var(--accent-primary)') : 'var(--bg-secondary)',
                        color: msg.fromMe ? '#fff' : 'var(--text-primary)',
                        fontSize: '14px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                        border: msg.fromMe ? 'none' : '1px solid var(--border-color)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        position: 'relative'
                      }}>
                        {/* SENDER INFO */}
                        {msg.participant && !msg.fromMe && activeContact?.isGroup && (
                          <div
                            onClick={() => {
                              // Logic to switch to private chat
                              const privateJid = msg.participant.includes(':') ? msg.participant.split(':')[0] + '@s.whatsapp.net' : msg.participant;
                              const existing = contacts.find(c => c.jid === privateJid);
                              if (existing) {
                                setActiveContact(existing);
                              } else {
                                Toast.fire({ icon: 'info', title: 'Iniciando conversa privada...' });
                                // We'd need a way to create a temporary contact or wait for a message
                              }
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer' }}
                          >
                            <span style={{ fontWeight: 800, color: '#ff8a00', fontSize: '12px' }}>{msg.senderName || 'Membro'}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>~{msg.participant.split('@')[0]}</span>
                          </div>
                        )}

                        {/* QUOTED MESSAGE */}
                        {msg.quotedText && (
                          <div style={{
                            padding: '8px 10px',
                            backgroundColor: 'rgba(0,0,0,0.05)',
                            borderLeft: '4px solid var(--accent-primary)',
                            borderRadius: '4px',
                            marginBottom: '8px',
                            fontSize: '12px',
                            opacity: 0.8
                          }}>
                            <div style={{ fontWeight: 800, marginBottom: '2px', color: 'var(--accent-primary)' }}>
                              {msg.quotedParticipant?.split('@')[0] || 'Resposta'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {msg.quotedText}
                            </div>
                          </div>
                        )}

                        {formatMessage(msg.text)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{msg.time}</span>
                        {msg.fromMe && (
                          <span style={{ display: 'flex', alignItems: 'center', color: (msg.status === 'read' || msg.status === 4) ? '#34b7f1' : 'var(--text-muted)' }}>
                            {(msg.status === 'sent' || msg.status === 2)
                              ? <Check size={12} />
                              : <CheckCheck size={12} />}
                          </span>
                        )}
                      </div>
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
                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>Cliente ZAP Fly</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CONTEXT MENU */}
      {contextMenu && (
        <div style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          backgroundColor: '#18181b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 9999,
          minWidth: '220px',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          {contextMenu.type === 'message' && (
            <>
              <div onClick={() => {
                Swal.fire({
                  title: 'Apagar mensagem?',
                  text: contextMenu.data.fromMe ? "Deseja apagar para todos ou apenas para você?" : "Deseja apagar esta mensagem?",
                  icon: 'warning',
                  showCancelButton: true,
                  showDenyButton: contextMenu.data.fromMe,
                  confirmButtonText: 'Apagar para mim',
                  denyButtonText: 'Apagar para todos',
                  cancelButtonText: 'Cancelar',
                  customClass: { popup: 'swal2-dark-popup' }
                }).then((result) => {
                  if (result.isConfirmed) deleteMessage(false);
                  else if (result.isDenied) deleteMessage(true);
                });
              }} className="ctx-menu-item"><Trash2 size={16} /> Apagar mensagem</div>
              <div className="ctx-menu-item"><Send size={16} style={{ transform: 'rotate(-45deg)' }} /> Encaminhar</div>
            </>
          )}
          {contextMenu.type === 'chat' && (
            <>
              <div onClick={() => markAsUnread(contextMenu.data)} className="ctx-menu-item">
                <Check size={16} /> Marcar como não lida
              </div>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
              <div onClick={() => deleteChat(contextMenu.data)} className="ctx-menu-item text-danger" style={{ color: '#ef4444' }}>
                <Trash2 size={16} /> Excluir conversa
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// CSS inline para hover no menu de contexto
const styleTag = document.createElement("style");
styleTag.innerHTML = `
  .swal2-dark-popup { background: #1e1e20 !important; color: #fff !important; }
  .ctx-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    font-size: 13px;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.2s ease;
    color: var(--text-primary);
    font-weight: 500;
  }
  .ctx-menu-item:hover {
    background-color: rgba(255,255,255,0.06);
  }
  .ctx-menu-item.text-danger:hover {
    background-color: rgba(239, 68, 68, 0.1);
    color: #f87171 !important;
  }
`;
document.head.appendChild(styleTag);

export default Chat;
