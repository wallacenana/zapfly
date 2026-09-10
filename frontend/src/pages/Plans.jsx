import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Loader2, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';

const formatPrice = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const cycleLabels = { monthly: 'Mensal', semiannual: 'Semestral', annual: 'Anual' };
const cycleSuffix = { monthly: '/mês', semiannual: '/mês', annual: '/mês' };
const planCopy = {
  basic: { badge: 'Iniciantes', description: 'Para começar com uma operação simples e organizada.' },
  professional: { badge: 'Recomendado', description: 'Para negócios em expansão que precisam de agilidade.' },
  unlimited: { badge: 'Alta performance', description: 'Automação completa para operações em grande escala.' }
};

const featureRows = [
  { label: 'Cadastro de produtos', value: (plan) => plan.productLimit === null ? 'Ilimitados' : `Até ${plan.productLimit}` },
  { label: 'Fluxos de automação', value: (plan) => plan.flowLimit === null ? 'Ilimitados' : `${plan.flowLimit} ${plan.flowLimit === 1 ? 'automação' : 'automações'}` },
  { label: 'Vendas, pedidos e clientes', value: () => 'Sem limite' },
  { label: 'Integração Google Calendar', value: (plan) => plan.calendar ? 'Incluso' : 'Não incluso' },
  { label: 'Mercado Pago para PIX e cartão', value: (plan) => plan.paymentGateway ? 'Incluso' : 'Não incluso' }
];

const faqs = [
  ['Como funciona o período de 7 dias grátis?', 'O período de teste dura 7 dias a partir da criação da conta, sem exigir cartão. Durante o teste, a conta utiliza os recursos do plano Básico.'],
  ['Posso trocar de plano ou cancelar a qualquer momento?', 'Sim. Você pode trocar de plano ou cancelar a assinatura sem fidelidade, conforme as condições da sua assinatura.'],
  ['Quais pagamentos estão disponíveis em cada plano?', 'O Mercado Pago, para receber PIX e cartão dos seus clientes, está disponível apenas no plano Ilimitado. A assinatura dos planos é processada pela Abacate Pay.']
];

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [trial, setTrial] = useState({ enabled: true, days: 7 });
  const [cycle, setCycle] = useState('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState('');
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    api.get('/billing/plans')
      .then(({ data }) => { setPlans(data.plans || []); setTrial(data.trial || { enabled: true, days: 7 }); })
      .catch(() => toast.error('Não foi possível carregar os planos.'))
      .finally(() => setLoading(false));
  }, []);

  const checkout = async (planKey) => {
    setCheckoutPlan(planKey);
    try {
      const { data } = await api.post('/billing/checkout', { planKey, cycle });
      if (!data?.url) throw new Error('Checkout sem URL.');
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Não foi possível iniciar o pagamento.');
      setCheckoutPlan('');
    }
  };

  const getPlan = (key) => plans.find((plan) => plan.key === key);
  const monthlyPlan = getPlan('professional') || plans[0];
  const selectedCycle = monthlyPlan?.cycles?.find((item) => item.key === cycle);
  const monthlyPrice = monthlyPlan?.price || 0;
  const discount = selectedCycle && monthlyPrice ? Math.round((1 - selectedCycle.price / monthlyPrice) * 100) : 0;

  return (
    <div className="plans-page">
      <header className="plans-topbar">
        <Link to="/conta"><ArrowLeft size={14} /> Minha conta</Link>
        {trial.enabled && <span className="plans-trial-pill"><span /> Período de teste ativo</span>}
      </header>
      <main className="plans-main">
        <section className="plans-intro">
          <span className="plans-eyebrow">Planos Menzzu</span>
          <h1>Escolha o ritmo da sua operação</h1>
          <p>Venda sem limite. Os planos variam pela estrutura e automação que você precisa para escalar seu negócio.</p>
        </section>

        <div className="plans-cycle-row">
          <div className="plans-cycle-switch">
            {Object.entries(cycleLabels).map(([key, label]) => <button key={key} className={cycle === key ? 'is-active' : ''} onClick={() => setCycle(key)}>{label}{key !== 'monthly' && discount > 0 && <small>-{discount}%</small>}</button>)}
          </div>
          {trial.enabled && <div className="plans-trial-note"><ShieldCheck size={15} /> {trial.days} dias grátis em todos os planos, sem fidelidade</div>}
        </div>

        {loading ? <div className="plans-loading"><Loader2 className="spin" /></div> : <section className="plans-grid">
          {plans.map((plan) => {
            const selected = plan.cycles?.find((item) => item.key === cycle);
            const copy = planCopy[plan.key] || {};
            const highlighted = plan.key === 'professional';
            return <article key={plan.key} className={`plan-card${highlighted ? ' is-highlighted' : ''}`}>
              {highlighted && <div className="plan-popular"><span>●</span> Mais popular</div>}
              <div>
                <div className="plan-card-heading"><h2>{plan.name}</h2><span>{copy.badge}</span></div>
                <p className="plan-description">{copy.description}</p>
                <div className="plan-price"><strong>{formatPrice(selected?.price ?? plan.price)}</strong><span>{cycleSuffix[cycle]}</span></div>
                <p className="plan-free"><Check size={14} /> {trial.days} dias grátis sem cartão</p>
                <div className="plan-divider" />
                <ul>{featureRows.map((row) => <li key={row.label} className={row.value(plan) === 'Não incluso' ? 'is-disabled' : ''}>{row.value(plan) === 'Não incluso' ? <X size={15} /> : <Check size={15} />}<span>{row.value(plan)}</span><small>{row.label}</small></li>)}</ul>
              </div>
              <button className="plan-action" onClick={() => checkout(plan.key)} disabled={Boolean(checkoutPlan)}>{checkoutPlan === plan.key ? 'Abrindo pagamento...' : `Assinar ${plan.name}`} <span>→</span></button>
            </article>;
          })}
        </section>}

        <p className="plans-payment-note"><span>▣</span> Pagamento recorrente via cartão processado com segurança pela <strong>Abacate Pay</strong>.</p>

        <section className="plans-comparison">
          <button className="plans-section-toggle" onClick={() => setComparisonOpen(!comparisonOpen)}><span><strong>Comparativo detalhado de recursos</strong><small>Veja o que está incluso em cada nível de assinatura</small></span><span>{comparisonOpen ? 'Ocultar tabela' : 'Ver tabela completa'} <ChevronDown size={15} className={comparisonOpen ? 'is-open' : ''} /></span></button>
          {comparisonOpen && <div className="comparison-scroll"><table><thead><tr><th>Recurso / funcionalidade</th>{plans.map((plan) => <th key={plan.key} className={plan.key === 'professional' ? 'is-highlighted' : ''}>{plan.name}</th>)}</tr></thead><tbody>{featureRows.map((row) => <tr key={row.label}><td>{row.label}</td>{plans.map((plan) => <td key={plan.key} className={row.value(plan) === 'Não incluso' ? 'is-disabled' : ''}>{row.value(plan)}</td>)}</tr>)}</tbody></table></div>}
        </section>

        <section className="plans-faq"><h2>Perguntas frequentes</h2>{faqs.map(([question, answer], index) => <div className="faq-item" key={question}><button onClick={() => setOpenFaq(openFaq === index ? null : index)}><strong>{question}</strong><span>{openFaq === index ? '−' : '+'}</span></button>{openFaq === index && <p>{answer}</p>}</div>)}</section>
      </main>
    </div>
  );
}
