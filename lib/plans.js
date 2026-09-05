const PLAN_DEFINITIONS = Object.freeze({
  basic: {
    key: 'basic',
    name: 'Básico',
    priceCents: 2990,
    productLimit: 10,
    flowLimit: 1,
    mediaLimit: 20,
    calendar: false,
  },
  professional: {
    key: 'professional',
    name: 'Profissional',
    priceCents: 3990,
    productLimit: 30,
    flowLimit: 3,
    mediaLimit: 50,
    calendar: true,
  },
  unlimited: {
    key: 'unlimited',
    name: 'Ilimitado',
    priceCents: 4990,
    productLimit: null,
    flowLimit: null,
    mediaLimit: 100,
    calendar: true,
    paymentGateway: true,
  },
});

const BILLING_CYCLES = Object.freeze({
  monthly: { key: 'monthly', label: 'Mensal', multiplier: 1 },
  semiannual: { key: 'semiannual', label: 'Semestral', multiplier: 6 * 0.9 },
  annual: { key: 'annual', label: 'Anual', multiplier: 12 * 0.8 },
});

const getCycle = (key) => BILLING_CYCLES[String(key || '').toLowerCase()] || null;
const getCyclePriceCents = (plan, cycleKey) => Math.round(plan.priceCents * (getCycle(cycleKey)?.multiplier || 1));

const getPlan = (key) => PLAN_DEFINITIONS[String(key || '').toLowerCase()] || null;

const getEntitledPlan = async (prisma, userId) => {
  const [subscription, user, setting] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    prisma.platformSetting.findUnique({ where: { id: 'default' } }),
  ]);
  const activeSubscription = subscription && ['active', 'trialing'].includes(String(subscription.status).toLowerCase());
  if (activeSubscription) return getPlan(subscription.planKey);
  const trialDays = Number(setting?.trialDays ?? 7);
  const trialEnabled = setting?.trialEnabled ?? true;
  const trialEndsAt = user?.createdAt ? new Date(user.createdAt.getTime() + trialDays * 86400000) : null;
  if (trialEnabled && trialEndsAt && trialEndsAt > new Date()) return getPlan('basic');
  return null;
};

const hasPlanFeature = async (prisma, userId, feature) => Boolean((await getEntitledPlan(prisma, userId))?.[feature]);

const checkEntitlement = async (prisma, userId, resource, currentCount) => {
  const plan = await getEntitledPlan(prisma, userId);
  if (!plan) return null;
  const limit = plan?.[resource];
  if (limit !== null && limit !== undefined && currentCount >= limit) {
    const error = new Error(`O plano ${plan.name} permite até ${limit} ${resource === 'productLimit' ? 'produtos' : 'automações'}.`);
    error.code = 'PLAN_LIMIT_REACHED';
    error.limit = limit;
    throw error;
  }
  return plan;
};

module.exports = { PLAN_DEFINITIONS, BILLING_CYCLES, getPlan, getCycle, getCyclePriceCents, getEntitledPlan, hasPlanFeature, checkEntitlement };
