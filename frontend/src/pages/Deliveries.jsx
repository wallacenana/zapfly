import { Calendar, Plus, RefreshCw, Trash2, Truck, X } from 'lucide-react';
import { api } from '../api';
import { Button, Heading, Tabs, Text } from '../components/ui';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const todayBrazil = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const formatDate = (date) => String(date || '').split('-').reverse().join('/');
const statusLabel = (status) => ({ pending: 'Pendente', production: 'Em producao', ready: 'Pronto', completed: 'Finalizado', waiting_payment: 'Aguardando pagamento', manual: 'Lancamento manual' }[String(status || '').toLowerCase()] || status || 'Pendente');
const emptyManualForm = (date) => ({ deliveryDate: date, clientName: '', deliveryAddress: '', deliveryFee: '', paymentMethod: '', paymentReceived: false, deliveryPerson: '', notes: '' });

function DeliveryMetric({ label, value, caption, tone }) {
  return <article className={`deliveries-metric deliveries-metric--${tone}`}><span>{label}</span><strong>{value}</strong><small>{caption}</small></article>;
}

export default function Deliveries() {
  const [date, setDate] = useState(todayBrazil);
  const [range, setRange] = useState('day');
  const [data, setData] = useState({ summary: {}, entries: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyManualForm(todayBrazil()));
  const [saving, setSaving] = useState(false);

  const loadDeliveries = async ({ silent = false, nextDate = date, nextRange = range } = {}) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const response = await api.get('/dashboard/deliveries', { params: { date: nextDate, range: nextRange } });
      setData(response.data || { summary: {}, entries: [] });
    } catch (err) {
      setError(err?.response?.data?.error || 'Nao foi possivel carregar as entregas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadDeliveries({ nextDate: date, nextRange: range }); }, [date, range]);

  const openManualForm = () => { setForm(emptyManualForm(date)); setFormOpen(true); };
  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const saveManualDelivery = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/dashboard/deliveries/manual', { ...form, deliveryFee: Number(form.deliveryFee) || 0 });
      setFormOpen(false);
      await loadDeliveries({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Nao foi possivel cadastrar a entrega externa.');
    } finally {
      setSaving(false);
    }
  };

  const deleteManualDelivery = async (entry) => {
    if (!window.confirm(`Excluir o lancamento manual de ${entry.clientName || 'entrega externa'}?`)) return;
    try {
      await api.delete(`/dashboard/deliveries/manual/${entry.id}`);
      await loadDeliveries({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Nao foi possivel excluir o lancamento.');
    }
  };

  const summary = data.summary || {};
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const rangeLabel = range === 'week' ? 'nos ultimos 7 dias' : `em ${formatDate(data.date || date)}`;

  return <main className="deliveries-page">
    <header className="deliveries-header">
      <div><div className="dashboard-eyebrow">Operacao de delivery</div><Heading as="h1" level={1}>Entregas e repasses</Heading><Text variant="description">Relatorio por entrega, taxas para repasse e lancamentos externos em um unico lugar.</Text></div>
      <div className="deliveries-actions"><Button variant="secondary" size="sm" onClick={openManualForm}><Plus size={15} /> Entrega externa</Button><Button variant="secondary" size="sm" onClick={() => loadDeliveries({ silent: true })} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar</Button></div>
    </header>

    <section className="deliveries-controls"><Tabs items={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }]} value={range} onChange={setRange} /><label className="deliveries-date"><Calendar size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><span>{range === 'week' ? 'A data selecionada encerra o periodo semanal.' : 'Relatorio da data selecionada.'}</span></section>
    {error ? <div className="dashboard-alert">{error}</div> : null}
    {loading ? <div className="deliveries-loading">Carregando entregas...</div> : <>
      <section className="deliveries-metrics">
        <DeliveryMetric label="Entregas recebidas" value={summary.deliveriesCount || 0} caption={`Confirmadas ${rangeLabel}`} tone="blue" />
        <DeliveryMetric label="Taxas para repasse" value={money.format(Number(summary.deliveryFeesValue) || 0)} caption="Somente entregas recebidas" tone="orange" />
      </section>

      <section className="deliveries-panel">
        <div className="deliveries-panel-head"><div><h2>Conferencia por entrega</h2><p>Somente entregas reais, com pagamento confirmado, entram neste relatorio.</p></div><span><Truck size={16} /> {entries.length} entrega(s)</span></div>
        {entries.length ? <div className="deliveries-table-wrap"><table className="deliveries-table"><thead><tr><th>Origem</th><th>Entrega</th><th>Cliente e endereco</th><th>Status</th><th>Pagamento</th><th>Taxa de entrega</th><th /></tr></thead><tbody>{entries.map((entry) => <tr key={`${entry.origin}-${entry.id}`}><td><span className={`deliveries-origin deliveries-origin--${entry.origin}`}>{entry.origin === 'manual' ? 'Externa' : 'Sistema'}</span></td><td><strong>{entry.origin === 'manual' ? 'Manual' : `#${String(entry.id || '').slice(-4).toUpperCase()}`}</strong><small>{formatDate(String(entry.deliveryDate || '').slice(0, 10))} {entry.scheduledTime || ''}</small></td><td><strong>{entry.clientName || 'Cliente'}</strong><small>{entry.deliveryAddress || 'Endereco nao informado'}{entry.deliveryPerson ? ` - ${entry.deliveryPerson}` : ''}</small></td><td><span className="deliveries-status">{statusLabel(entry.status)}</span></td><td><strong className={entry.paymentReceived ? 'is-paid' : 'is-unpaid'}>{entry.paymentReceived ? 'Confirmado' : 'Pendente'}</strong><small>{entry.paymentMethod || 'A combinar'}</small></td><td className="deliveries-fee">{money.format(Number(entry.deliveryFee) || 0)}</td><td>{entry.origin === 'manual' ? <button type="button" className="deliveries-delete" onClick={() => deleteManualDelivery(entry)} title="Excluir lancamento manual"><Trash2 size={15} /></button> : null}</td></tr>)}</tbody></table></div> : <div className="deliveries-empty">Nenhuma entrega registrada neste periodo.</div>}
      </section>
    </>}

    {formOpen ? <div className="deliveries-modal-backdrop" role="presentation"><form className="deliveries-modal" onSubmit={saveManualDelivery}><div className="deliveries-modal-head"><div><div className="dashboard-eyebrow">Lancamento manual</div><h2>Entrega fora do sistema</h2></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20} /></button></div><p>Registre uma entrega feita por fora do cardapio para ela entrar no relatorio e no repasse.</p><div className="deliveries-form-grid"><label>Data<input type="date" required value={form.deliveryDate} onChange={(event) => updateForm('deliveryDate', event.target.value)} /></label><label>Cliente<input value={form.clientName} onChange={(event) => updateForm('clientName', event.target.value)} placeholder="Nome do cliente" /></label><label className="is-wide">Endereco<input value={form.deliveryAddress} onChange={(event) => updateForm('deliveryAddress', event.target.value)} placeholder="Endereco da entrega" /></label><label>Taxa de entrega<input type="number" min="0" step="0.01" required value={form.deliveryFee} onChange={(event) => updateForm('deliveryFee', event.target.value)} placeholder="0,00" /></label><label>Entregador<input value={form.deliveryPerson} onChange={(event) => updateForm('deliveryPerson', event.target.value)} placeholder="Opcional" /></label><label>Pagamento<select value={form.paymentMethod} onChange={(event) => updateForm('paymentMethod', event.target.value)}><option value="">A combinar</option><option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="cartao">Cartao</option></select></label><label className="is-wide">Observacao<textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="Opcional" /></label></div><label className="deliveries-checkbox"><input type="checkbox" checked={form.paymentReceived} onChange={(event) => updateForm('paymentReceived', event.target.checked)} /> Pagamento do cliente confirmado</label><div className="deliveries-modal-actions"><Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar entrega'}</Button></div></form></div> : null}
  </main>;
}
