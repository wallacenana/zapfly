const prisma = require('./prisma');

function parseLocationValue(value) {
  if (!value) {
    return {
      address: '',
      placeId: '',
      lat: null,
      lng: null,
      mapsUrl: ''
    };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return {
      address: String(value.address || value.formatted_address || ''),
      placeId: String(value.placeId || value.place_id || ''),
      lat: value.lat !== undefined && value.lat !== null && value.lat !== '' ? Number(value.lat) : null,
      lng: value.lng !== undefined && value.lng !== null && value.lng !== '' ? Number(value.lng) : null,
      mapsUrl: String(value.mapsUrl || value.locationLink || '')
    };
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return {
      address: '',
      placeId: '',
      lat: null,
      lng: null,
      mapsUrl: ''
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parseLocationValue(parsed);
    }
  } catch (error) {
    // plain text fallback
  }

  return {
    address: raw,
    placeId: '',
    lat: null,
    lng: null,
    mapsUrl: ''
  };
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanDefined(input = {}) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
}

function buildStoreProfileData(payload = {}) {
  const legacyLocation = parseLocationValue(payload.businessLocation);
  const address = String(payload.businessAddress ?? legacyLocation.address ?? '').trim();
  const placeId = String(payload.businessPlaceId ?? legacyLocation.placeId ?? '').trim();
  const inputLat = toNumberOrNull(payload.businessLat);
  const inputLng = toNumberOrNull(payload.businessLng);
  const lat = inputLat !== null && inputLat !== 0 ? inputLat : legacyLocation.lat;
  const lng = inputLng !== null && inputLng !== 0 ? inputLng : legacyLocation.lng;
  const prepTime = String(payload.prepTime || '').trim();
  const maxDeliveryKm = toNumberOrNull(payload.maxDeliveryKm);
  const freeDeliveryKm = toNumberOrNull(payload.freeDeliveryKm);
  const customDomain = payload.customDomain !== undefined
    ? String(payload.customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
    : undefined;

  return cleanDefined({
    businessName: payload.businessName !== undefined ? String(payload.businessName || '').trim() : undefined,
    businessCategory: payload.businessCategory !== undefined ? String(payload.businessCategory || '').trim() : undefined,
    prepTime: prepTime || undefined,
    businessAddress: address || undefined,
    businessPlaceId: placeId || undefined,
    businessLat: lat,
    businessLng: lng,
    businessMapsUrl: String(payload.businessMapsUrl || legacyLocation.mapsUrl || '').trim() || undefined,
    logoUrl: payload.logoUrl !== undefined ? String(payload.logoUrl || '').trim() : undefined,
    faviconUrl: payload.faviconUrl !== undefined ? String(payload.faviconUrl || '').trim() : undefined,
    accentColor: payload.accentColor !== undefined ? String(payload.accentColor || '').trim() : undefined,
    buttonColor: payload.buttonColor !== undefined ? String(payload.buttonColor || '').trim() : undefined,
    accentColorOrders: payload.accentColorOrders !== undefined ? String(payload.accentColorOrders || '').trim() : undefined,
    buttonColorOrders: payload.buttonColorOrders !== undefined ? String(payload.buttonColorOrders || '').trim() : undefined,
    buttonTextColor: payload.buttonTextColor !== undefined ? String(payload.buttonTextColor || '').trim() : undefined,
    backgroundColor: payload.backgroundColor !== undefined ? String(payload.backgroundColor || '').trim() : undefined,
    textColor: payload.textColor !== undefined ? String(payload.textColor || '').trim() : undefined,
    seoDescription: payload.seoDescription !== undefined ? String(payload.seoDescription || '').trim() : undefined,
    pixelId: payload.pixelId !== undefined ? String(payload.pixelId || '').trim() : undefined,
    googleAnalyticsId: payload.googleAnalyticsId !== undefined ? String(payload.googleAnalyticsId || '').trim() : undefined,
    microsoftClarityId: payload.microsoftClarityId !== undefined ? String(payload.microsoftClarityId || '').trim() : undefined,
    acceptOrders: payload.acceptOrders !== undefined ? !!payload.acceptOrders : undefined,
    active: payload.active !== undefined ? !!payload.active : undefined,
    maxDeliveryKm: maxDeliveryKm ?? undefined,
    freeDeliveryEnabled: payload.freeDeliveryEnabled !== undefined ? !!payload.freeDeliveryEnabled : undefined,
    freeDeliveryKm: payload.freeDeliveryEnabled ? (freeDeliveryKm ?? undefined) : undefined,
    deliveryMode: payload.deliveryMode !== undefined ? String(payload.deliveryMode || '').trim() : undefined,
    allowCashOnDelivery: payload.allowCashOnDelivery !== undefined ? !!payload.allowCashOnDelivery : undefined,
    menuTheme: payload.menuTheme !== undefined ? String(payload.menuTheme || 'light').trim().toLowerCase() : undefined,
    customDomain: customDomain !== undefined ? (customDomain || null) : undefined
  });
}

function buildStoreProfileFallback(setting = {}, user = null) {
  const legacyLocation = parseLocationValue(setting.businessLocation);

  return {
    businessName: setting.businessName || user?.name || '',
    businessCategory: setting.businessCategory || '',
    prepTime: setting.prepTime || '',
    businessAddress: setting.businessAddress || legacyLocation.address || '',
    businessPlaceId: legacyLocation.placeId || '',
    businessLat: legacyLocation.lat,
    businessLng: legacyLocation.lng,
    businessMapsUrl: legacyLocation.mapsUrl || '',
    logoUrl: setting.logoUrl || '',
    faviconUrl: setting.faviconUrl || '',
    accentColor: setting.accentColor || '#82F026',
    buttonColor: setting.buttonColor || '#82F026',
    accentColorOrders: setting.accentColorOrders || '#82F026',
    buttonColorOrders: setting.buttonColorOrders || '#82F026',
    buttonTextColor: setting.buttonTextColor || '#ffffff',
    backgroundColor: setting.backgroundColor || '#ffffff',
    textColor: setting.textColor || '#333333',
    seoDescription: setting.seoDescription || '',
    pixelId: setting.pixelId || '',
    googleAnalyticsId: setting.googleAnalyticsId || '',
    microsoftClarityId: setting.microsoftClarityId || '',
    acceptOrders: setting.acceptOrders ?? true,
    active: setting.active ?? user?.active ?? true,
    maxDeliveryKm: setting.maxDeliveryKm ?? 15,
    freeDeliveryEnabled: setting.freeDeliveryEnabled ?? false,
    freeDeliveryKm: setting.freeDeliveryKm ?? null,
    deliveryMode: setting.deliveryMode || 'hibrido',
    allowCashOnDelivery: setting.allowCashOnDelivery ?? true,
    featuredCountDesktop: Number.isFinite(Number(setting.featuredCountDesktop)) ? Number(setting.featuredCountDesktop) : 4,
    featuredCountTablet: Number.isFinite(Number(setting.featuredCountTablet)) ? Number(setting.featuredCountTablet) : 2,
    featuredCountMobile: Number.isFinite(Number(setting.featuredCountMobile)) ? Number(setting.featuredCountMobile) : 1,
    menuTheme: setting.menuTheme || 'light',
    customDomain: setting.customDomain || ''
  };
}

function mergeStoreProfile({ setting = null, storeProfile = null, user = null } = {}) {
  const fallback = buildStoreProfileFallback(setting || {}, user || null);
  const profile = storeProfile || {};
  const mergedLocation = {
    address: profile.businessAddress || fallback.businessAddress || '',
    placeId: profile.businessPlaceId || fallback.businessPlaceId || '',
    lat: profile.businessLat ?? fallback.businessLat ?? null,
    lng: profile.businessLng ?? fallback.businessLng ?? null,
    mapsUrl: profile.businessMapsUrl || fallback.businessMapsUrl || ''
  };

  return {
    ...(setting || {}),
    ...(storeProfile || {}),
    ...fallback,
    businessName: profile.businessName ?? fallback.businessName,
    businessCategory: profile.businessCategory ?? fallback.businessCategory,
    prepTime: profile.prepTime ?? fallback.prepTime,
    businessAddress: mergedLocation.address,
    businessPlaceId: mergedLocation.placeId,
    businessLat: mergedLocation.lat,
    businessLng: mergedLocation.lng,
    businessMapsUrl: mergedLocation.mapsUrl,
    businessLocation: mergedLocation,
    logoUrl: profile.logoUrl ?? fallback.logoUrl,
    faviconUrl: profile.faviconUrl ?? fallback.faviconUrl,
    accentColor: profile.accentColor ?? fallback.accentColor,
    buttonColor: profile.buttonColor ?? fallback.buttonColor,
    accentColorOrders: profile.accentColorOrders ?? fallback.accentColorOrders,
    buttonColorOrders: profile.buttonColorOrders ?? fallback.buttonColorOrders,
    buttonTextColor: profile.buttonTextColor ?? fallback.buttonTextColor,
    backgroundColor: profile.backgroundColor ?? fallback.backgroundColor,
    textColor: profile.textColor ?? fallback.textColor,
    seoDescription: profile.seoDescription ?? fallback.seoDescription,
    pixelId: profile.pixelId ?? fallback.pixelId,
    googleAnalyticsId: profile.googleAnalyticsId ?? fallback.googleAnalyticsId,
    microsoftClarityId: profile.microsoftClarityId ?? fallback.microsoftClarityId,
    acceptOrders: profile.acceptOrders ?? fallback.acceptOrders,
    active: profile.active ?? fallback.active,
    maxDeliveryKm: profile.maxDeliveryKm ?? fallback.maxDeliveryKm,
    freeDeliveryEnabled: profile.freeDeliveryEnabled ?? fallback.freeDeliveryEnabled,
    freeDeliveryKm: profile.freeDeliveryKm ?? fallback.freeDeliveryKm,
    deliveryMode: profile.deliveryMode ?? fallback.deliveryMode,
    allowCashOnDelivery: profile.allowCashOnDelivery ?? fallback.allowCashOnDelivery,
    featuredCountDesktop: profile.featuredCountDesktop ?? fallback.featuredCountDesktop,
    featuredCountTablet: profile.featuredCountTablet ?? fallback.featuredCountTablet,
    featuredCountMobile: profile.featuredCountMobile ?? fallback.featuredCountMobile,
    menuTheme: profile.menuTheme ?? fallback.menuTheme,
    customDomain: profile.customDomain ?? fallback.customDomain
  };
}

async function upsertStoreProfile(userId, payload = {}) {
  const data = buildStoreProfileData(payload);
  const existing = await prisma.storeProfile.findUnique({ where: { userId } }).catch(() => null);

  if (existing) {
    return prisma.storeProfile.update({
      where: { userId },
      data
    });
  }

  return prisma.storeProfile.create({
    data: {
      userId,
      ...data
    }
  });
}

module.exports = {
  parseLocationValue,
  toNumberOrNull,
  buildStoreProfileData,
  buildStoreProfileFallback,
  mergeStoreProfile,
  upsertStoreProfile
};
