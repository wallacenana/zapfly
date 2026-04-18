import { MessageSquare, Users, Activity, Zap } from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
    <div style={{ 
      backgroundColor: `rgba(${color}, 0.1)`, 
      color: `rgb(${color})`, 
      padding: '16px', 
      borderRadius: '12px' 
    }}>
      <Icon size={24} />
    </div>
    <div>
      <h3 style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '4px', fontWeight: 500 }}>{title}</h3>
      <p style={{ fontSize: '28px', fontWeight: 700 }}>{value}</p>
    </div>
  </div>
);

const Dashboard = () => {
  return (
    <div style={{ padding: '30px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <StatCard title="Mensagens Hoje" value="1,248" icon={MessageSquare} color="59, 130, 246" />
        <StatCard title="Contatos Ativos" value="842" icon={Users} color="16, 185, 129" />
        <StatCard title="Fluxos Executados" value="45" icon={Zap} color="245, 158, 11" />
        <StatCard title="Taxa de Resposta" value="98%" icon={Activity} color="139, 92, 246" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div className="card">
          <h2 style={{ fontSize: '18px', marginBottom: '20px' }}>Atividade Recente</h2>
          <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Gráfico de mensagens será exibido aqui
          </div>
        </div>
        
        <div className="card">
          <h2 style={{ fontSize: '18px', marginBottom: '20px' }}>Status da Conexão</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></div>
                <span style={{ fontWeight: 500 }}>Suporte Principal</span>
              </div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Conectado</span>
            </div>
            
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
              Conectar Novo Número
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
