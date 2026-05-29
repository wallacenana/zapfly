import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  RefreshCcw, 
  Shield, 
  ShieldCheck, 
  ShieldAlert, 
  Loader2, 
  Copy, 
  X 
} from 'lucide-react';

const emptyForm = {
  name: '',
  email: '',
  role: 'user',
  active: true,
  password: '',
};

const roleLabels = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  user: 'User',
};

const roleColors = {
  superadmin: { bg: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.2)' },
  admin: { bg: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.2)' },
  user: { bg: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: 'rgba(16, 185, 129, 0.2)' },
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const Users = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [resultPassword, setResultPassword] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/auth/users');
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Falha ao carregar usuarios.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const haystack = [
        user.name,
        user.email,
        user.slug,
        user.role,
        user.storeProfile?.businessName,
        user.storeProfile?.businessCategory,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [users, search]);

  const stats = useMemo(() => {
    const total = users.length;
    const superadmins = users.filter((u) => (u.role || '').toLowerCase() === 'superadmin').length;
    const admins = users.filter((u) => (u.role || '').toLowerCase() === 'admin').length;
    const active = users.filter((u) => u.active).length;
    return { total, superadmins, admins, active };
  }, [users]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setResultPassword('');
    setModalOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setForm({
      name: user.name || '',
      email: user.email || '',
      role: (user.role || 'user').toLowerCase(),
      active: Boolean(user.active),
      password: '',
    });
    setResultPassword('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingUser(null);
    setForm(emptyForm);
    setResultPassword('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        active: form.active,
        password: form.password?.trim() || undefined,
      };

      if (editingUser) {
        const { data } = await api.patch(`/auth/users/${editingUser.id}`, {
          ...payload,
          resetPassword: false,
        });
        setResultPassword(data?.tempPassword || '');
      } else {
        const { data } = await api.post('/auth/users', payload);
        setResultPassword(data?.tempPassword || '');
      }

      await loadUsers();
    } catch (err) {
      setError(err?.response?.data?.error || 'Falha ao salvar usuario.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (user) => {
    const confirmed = window.confirm(`Gerar nova senha provisoria para ${user.name}?`);
    if (!confirmed) return;
    setActionLoadingId(user.id);
    setError('');
    try {
      const { data } = await api.patch(`/auth/users/${user.id}`, {
        resetPassword: true,
      });
      setResultPassword(data?.tempPassword || '');
      await loadUsers();
    } catch (err) {
      setError(err?.response?.data?.error || 'Falha ao redefinir senha.');
    } finally {
      setActionLoadingId('');
    }
  };

  const handleDelete = async (user) => {
    const confirmed = window.confirm(`Excluir definitivamente ${user.name}?`);
    if (!confirmed) return;
    setActionLoadingId(user.id);
    setError('');
    try {
      await api.delete(`/auth/users/${user.id}`);
      await loadUsers();
    } catch (err) {
      setError(err?.response?.data?.error || 'Falha ao excluir usuario.');
    } finally {
      setActionLoadingId('');
    }
  };

  const copyPassword = async () => {
    if (!resultPassword) return;
    try {
      await navigator.clipboard.writeText(resultPassword);
    } catch (err) {}
  };

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', marginBottom: '28px' }}>
        <div>
          <p style={{ color: 'var(--accent-primary)', fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Super Admin
          </p>
          <h1 style={{ fontSize: '32px', marginBottom: '6px' }}>Usuarios</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie acessos, niveis e credenciais do painel.</p>
        </div>

        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={18} />
          Adicionar usuario
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total', value: stats.total, icon: Shield },
          { label: 'Super Admins', value: stats.superadmins, icon: ShieldCheck },
          { label: 'Admins', value: stats.admins, icon: ShieldAlert },
          { label: 'Ativos', value: stats.active, icon: Shield },
        ].map((item) => (
          <div key={item.label} className="card" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '14px',
              background: 'var(--accent-glow)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <item.icon size={22} />
            </div>
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '18px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Lista de usuarios</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Somente visivel para superadmin.</p>
          </div>
          <div style={{ position: 'relative', minWidth: '320px', maxWidth: '420px', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, email ou slug"
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '12px 14px 12px 40px',
                outline: 'none',
                fontSize: '14px',
              }}
            />
          </div>
        </div>

        {error ? (
          <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.18)' }}>
            {error}
          </div>
        ) : null}

        {resultPassword ? (
          <div style={{ marginBottom: '16px', padding: '14px 16px', borderRadius: '12px', backgroundColor: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Senha provisoria</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{resultPassword}</div>
            </div>
            <button className="btn btn-secondary" onClick={copyPassword}>
              <Copy size={16} />
              Copiar
            </button>
          </div>
        ) : null}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '50px 0', color: 'var(--text-secondary)' }}>
            <Loader2 size={22} className="animate-spin" />
            <span style={{ marginLeft: '10px' }}>Carregando usuarios...</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '14px 12px' }}>Usuario</th>
                  <th style={{ padding: '14px 12px' }}>Email</th>
                  <th style={{ padding: '14px 12px' }}>Papel</th>
                  <th style={{ padding: '14px 12px' }}>Status</th>
                  <th style={{ padding: '14px 12px' }}>2FA</th>
                  <th style={{ padding: '14px 12px' }}>Criado</th>
                  <th style={{ padding: '14px 12px' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const roleKey = (user.role || 'user').toLowerCase();
                  const colors = roleColors[roleKey] || roleColors.user;
                  return (
                    <tr key={user.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '16px 12px' }}>
                        <div style={{ fontWeight: 700 }}>{user.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{user.slug || '-'}</div>
                      </td>
                      <td style={{ padding: '16px 12px', color: 'var(--text-secondary)' }}>{user.email}</td>
                      <td style={{ padding: '16px 12px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                          borderRadius: '999px',
                          background: colors.bg,
                          color: colors.color,
                          border: `1px solid ${colors.border}`,
                          fontSize: '12px',
                          fontWeight: 700,
                          textTransform: 'capitalize',
                        }}>
                          {roleLabels[roleKey] || roleKey}
                        </span>
                      </td>
                      <td style={{ padding: '16px 12px' }}>
                        <span className={`badge ${user.active ? 'badge-success' : 'badge-warning'}`}>
                          {user.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td style={{ padding: '16px 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                        {user.twoFactorVerified ? `${user.twoFactorMethod || '2FA'} ok` : 'Nao configurado'}
                      </td>
                      <td style={{ padding: '16px 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                        {formatDate(user.createdAt)}
                      </td>
                      <td style={{ padding: '16px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary" onClick={() => openEdit(user)}>
                            <Edit3 size={15} />
                            Editar
                          </button>
                          <button className="btn btn-secondary" onClick={() => handleResetPassword(user)} disabled={actionLoadingId === user.id}>
                            {actionLoadingId === user.id ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                            Resetar senha
                          </button>
                          <button className="btn btn-secondary" onClick={() => handleDelete(user)} disabled={actionLoadingId === user.id} style={{ color: '#f87171' }}>
                            <Trash2 size={15} />
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filteredUsers.length ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      Nenhum usuario encontrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              position: 'relative',
            }}
          >
            <button
              onClick={closeModal}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>

            <div style={{ paddingRight: '44px' }}>
              <p style={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
                {editingUser ? 'Editar usuario' : 'Novo usuario'}
              </p>
              <h2 style={{ fontSize: '26px', marginBottom: '8px' }}>
                {editingUser ? 'Atualizar acesso' : 'Criar acesso'}
              </h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                {editingUser
                  ? 'Altere nome, email, papel ou status de acesso.'
                  : 'Crie uma conta e envie as credenciais por email automaticamente.'}
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Nome</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Nome completo"
                    required
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="email@dominio.com"
                    required
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Perfil</span>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      outline: 'none',
                    }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Ativo</span>
                  <div style={{
                    minHeight: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '0 14px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                  }}>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>Permitir acesso ao sistema</span>
                  </div>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>
                    {editingUser ? 'Nova senha (opcional)' : 'Senha inicial (opcional)'}
                  </span>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Deixe em branco para gerar automaticamente"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      outline: 'none',
                    }}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    Se preencher, essa sera a senha inicial. Se deixar vazio, o sistema gera uma senha aleatoria.
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginTop: '24px', flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                  Ao salvar, o usuario recebe a credencial por email e entra com a senha informada ou gerada automaticamente.
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                    {editingUser ? 'Salvar alterações' : 'Criar usuario'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Users;
