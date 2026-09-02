// Viewer-language localization for Perioteca. Dual-use module: loaded as
// <script type="module"> in the browser (exposes window.I18n for app.js) and
// imported directly by node --test.
//
// Design: feed titles arrive as free English text, so instead of translating
// strings we CONSTRUCT titles from the structured fields the API provides
// (kind, cc, eventName, nearData) in the viewer's language, falling back to
// the raw feed title only when nothing structured exists. Country names come
// from Intl.DisplayNames (all languages built in); everything else uses the
// compact dictionaries below. Dates use toLocaleString, so they render in the
// viewer's own timezone automatically.

const SUPPORTED = ['es', 'en', 'pt', 'fr', 'de'];
const FALLBACK = 'en';

// ---- Dictionaries ----------------------------------------------------------

const KINDS = {
  es: { earthquake: 'Sismo', cyclone: 'Ciclón', storm: 'Tormenta', flood: 'Inundación', volcano: 'Volcán', drought: 'Sequía', wildfire: 'Incendio', tsunami: 'Tsunami', ice: 'Hielo marino', landslide: 'Deslizamiento', dust: 'Polvo y bruma', snow: 'Nieve', manmade: 'Antrópico', water: 'Color del agua' },
  en: { earthquake: 'Earthquake', cyclone: 'Cyclone', storm: 'Storm', flood: 'Flood', volcano: 'Volcano', drought: 'Drought', wildfire: 'Wildfire', tsunami: 'Tsunami', ice: 'Sea ice', landslide: 'Landslide', dust: 'Dust and haze', snow: 'Snow', manmade: 'Man-made', water: 'Water color' },
  pt: { earthquake: 'Sismo', cyclone: 'Ciclone', storm: 'Tempestade', flood: 'Inundação', volcano: 'Vulcão', drought: 'Seca', wildfire: 'Incêndio', tsunami: 'Tsunami', ice: 'Gelo marinho', landslide: 'Deslizamento', dust: 'Poeira e névoa', snow: 'Neve', manmade: 'Antrópico', water: 'Cor da água' },
  fr: { earthquake: 'Séisme', cyclone: 'Cyclone', storm: 'Tempête', flood: 'Inondation', volcano: 'Volcan', drought: 'Sécheresse', wildfire: 'Incendie', tsunami: 'Tsunami', ice: 'Glace de mer', landslide: 'Glissement de terrain', dust: 'Poussière et brume', snow: 'Neige', manmade: 'Anthropique', water: "Couleur de l'eau" },
  de: { earthquake: 'Erdbeben', cyclone: 'Zyklon', storm: 'Sturm', flood: 'Überschwemmung', volcano: 'Vulkan', drought: 'Dürre', wildfire: 'Waldbrand', tsunami: 'Tsunami', ice: 'Meereis', landslide: 'Erdrutsch', dust: 'Staub und Dunst', snow: 'Schnee', manmade: 'Anthropogen', water: 'Wasserfarbe' }
};

const TIERS_I18N = {
  es: { 'pequeño': 'pequeño', mediano: 'mediano', grande: 'grande', gigante: 'gigante' },
  en: { 'pequeño': 'small', mediano: 'medium', grande: 'large', gigante: 'giant' },
  pt: { 'pequeño': 'pequeno', mediano: 'médio', grande: 'grande', gigante: 'gigante' },
  fr: { 'pequeño': 'petit', mediano: 'moyen', grande: 'grand', gigante: 'géant' },
  de: { 'pequeño': 'klein', mediano: 'mittel', grande: 'groß', gigante: 'riesig' }
};

const CONTINENTS_I18N = {
  es: {},
  en: { 'África': 'Africa', 'América del Norte': 'North America', 'América del Sur': 'South America', 'Antártida': 'Antarctica', 'Asia': 'Asia', 'Europa': 'Europe', 'Oceanía': 'Oceania' },
  pt: { 'África': 'África', 'América del Norte': 'América do Norte', 'América del Sur': 'América do Sul', 'Antártida': 'Antártida', 'Asia': 'Ásia', 'Europa': 'Europa', 'Oceanía': 'Oceania' },
  fr: { 'África': 'Afrique', 'América del Norte': 'Amérique du Nord', 'América del Sur': 'Amérique du Sud', 'Antártida': 'Antarctique', 'Asia': 'Asie', 'Europa': 'Europe', 'Oceanía': 'Océanie' },
  de: { 'África': 'Afrika', 'América del Norte': 'Nordamerika', 'América del Sur': 'Südamerika', 'Antártida': 'Antarktis', 'Asia': 'Asien', 'Europa': 'Europa', 'Oceanía': 'Ozeanien' }
};

// 8 winds clockwise from north. East is "L" (leste) in Portuguese and "O"
// (Ost) in German; German west winds use W (Süd*w*est).
const COMPASS = {
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  pt: ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'],
  fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
};

const ALERT_COLORS = {
  es: { red: 'roja', orange: 'naranja', green: 'verde' },
  en: { red: 'red', orange: 'orange', green: 'green' },
  pt: { red: 'vermelho', orange: 'laranja', green: 'verde' },
  fr: { red: 'rouge', orange: 'orange', green: 'verte' },
  de: { red: 'Rot', orange: 'Orange', green: 'Grün' }
};

// UI strings (chrome, card labels, alerts). Keep keys flat and short.
const UI = {
  es: {
    subtitle: 'eventos del mundo en curso', refresh: 'Actualizar', filters: 'Filtros', minMag: 'Magnitud mínima:', kind: 'Tipo de evento', period: 'Periodo', p24: 'Últimas 24 horas', p72: 'Últimos 3 días', p168: 'Última semana', p720: 'Último mes', continent: 'Continente', all: 'Todos', place: 'País o texto', placePh: 'Ej.: Chile, Indonesia, hurricane…', alertsOnly: 'Solo alertas naranjas y rojas', alertsHint: 'Eventos con impacto humanitario relevante según GDACS.', legend: 'Leyenda', lgSmall: 'Pequeño (magnitud < 3)', lgMedium: 'Mediano (3 – 5)', lgLarge: 'Grande (5 – 7)', lgGiant: 'Gigante (7 o más)', lgRed: 'Alerta roja GDACS', legendNote: 'Una sola escala de magnitud (0–10) unifica sismos, ciclones, incendios, inundaciones y más. Los eventos de la última hora y las alertas rojas emiten ondas desde su ubicación; los más antiguos se apagan siguiendo una curva de decaimiento. El tamaño del punto crece con la magnitud.', sources: 'Fuentes', merged: 'fusionadas con dedupe.', loading: 'Cargando eventos…', errorMsg: 'No se pudieron cargar los datos de eventos.', retryHint: 'Comprueba tu conexión e inténtalo de nuevo.', retry: 'Reintentar', events: 'eventos', updated: 'Actualizado', cached: '(datos en caché)', near: 'Cerca de', country: 'País', continentRow: 'Continente', start: 'Inicio', updatedRow: 'Última actualización', signal: 'Señal original', magnitude: 'magnitud', unifiedScale: 'en la escala unificada', report: 'Ver informe completo', topEvent: 'Mayor magnitud', newEvent: 'Nuevo evento', newEvents: 'eventos nuevos', live: 'en Vivo'
  },
  en: {
    subtitle: 'ongoing world events', refresh: 'Refresh', filters: 'Filters', minMag: 'Minimum magnitude:', kind: 'Event type', period: 'Period', p24: 'Last 24 hours', p72: 'Last 3 days', p168: 'Last week', p720: 'Last month', continent: 'Continent', all: 'All', place: 'Country or text', placePh: 'E.g.: Chile, Indonesia, hurricane…', alertsOnly: 'Only orange and red alerts', alertsHint: 'Events with relevant humanitarian impact per GDACS.', legend: 'Legend', lgSmall: 'Small (magnitude < 3)', lgMedium: 'Medium (3 – 5)', lgLarge: 'Large (5 – 7)', lgGiant: 'Giant (7 or more)', lgRed: 'GDACS red alert', legendNote: 'A single 0–10 magnitude scale unifies earthquakes, cyclones, wildfires, floods and more. Events from the last hour and red alerts emit rings from their location; older ones fade following a decay curve. Dot size grows with magnitude.', sources: 'Sources', merged: 'merged with dedupe.', loading: 'Loading events…', errorMsg: 'Event data could not be loaded.', retryHint: 'Check your connection and try again.', retry: 'Retry', events: 'events', updated: 'Updated', cached: '(cached data)', near: 'Near', country: 'Country', continentRow: 'Continent', start: 'Started', updatedRow: 'Last update', signal: 'Original signal', magnitude: 'magnitude', unifiedScale: 'on the unified scale', report: 'View full report', topEvent: 'Strongest event', newEvent: 'New event', newEvents: 'new events', live: 'Live'
  },
  pt: {
    subtitle: 'eventos do mundo em curso', refresh: 'Atualizar', filters: 'Filtros', minMag: 'Magnitude mínima:', kind: 'Tipo de evento', period: 'Período', p24: 'Últimas 24 horas', p72: 'Últimos 3 dias', p168: 'Última semana', p720: 'Último mês', continent: 'Continente', all: 'Todos', place: 'País ou texto', placePh: 'Ex.: Chile, Indonésia, hurricane…', alertsOnly: 'Somente alertas laranja e vermelho', alertsHint: 'Eventos com impacto humanitário relevante segundo o GDACS.', legend: 'Legenda', lgSmall: 'Pequeno (magnitude < 3)', lgMedium: 'Médio (3 – 5)', lgLarge: 'Grande (5 – 7)', lgGiant: 'Gigante (7 ou mais)', lgRed: 'Alerta vermelho GDACS', legendNote: 'Uma única escala de magnitude (0–10) unifica sismos, ciclones, incêndios, inundações e mais. Eventos da última hora e alertas vermelhos emitem ondas; os mais antigos se apagam seguindo uma curva de decaimento. O tamanho do ponto cresce com a magnitude.', sources: 'Fontes', merged: 'fundidas com dedupe.', loading: 'Carregando eventos…', errorMsg: 'Não foi possível carregar os dados.', retryHint: 'Verifique sua conexão e tente novamente.', retry: 'Tentar novamente', events: 'eventos', updated: 'Atualizado', cached: '(dados em cache)', near: 'Perto de', country: 'País', continentRow: 'Continente', start: 'Início', updatedRow: 'Última atualização', signal: 'Sinal original', magnitude: 'magnitude', unifiedScale: 'na escala unificada', report: 'Ver relatório completo', topEvent: 'Maior magnitude', newEvent: 'Novo evento', newEvents: 'novos eventos', live: 'ao Vivo'
  },
  fr: {
    subtitle: 'événements mondiaux en cours', refresh: 'Actualiser', filters: 'Filtres', minMag: 'Magnitude minimale :', kind: "Type d'événement", period: 'Période', p24: 'Dernières 24 heures', p72: '3 derniers jours', p168: 'Dernière semaine', p720: 'Dernier mois', continent: 'Continent', all: 'Tous', place: 'Pays ou texte', placePh: 'Ex. : Chili, Indonésie, hurricane…', alertsOnly: 'Alertes orange et rouges seulement', alertsHint: 'Événements à impact humanitaire notable selon le GDACS.', legend: 'Légende', lgSmall: 'Petit (magnitude < 3)', lgMedium: 'Moyen (3 – 5)', lgLarge: 'Grand (5 – 7)', lgGiant: 'Géant (7 ou plus)', lgRed: 'Alerte rouge GDACS', legendNote: 'Une seule échelle de magnitude (0–10) unifie séismes, cyclones, incendies, inondations et plus. Les événements de la dernière heure et les alertes rouges émettent des ondes ; les plus anciens s’estompent selon une courbe de décroissance. La taille du point croît avec la magnitude.', sources: 'Sources', merged: 'fusionnées avec dédoublonnage.', loading: 'Chargement des événements…', errorMsg: 'Impossible de charger les données.', retryHint: 'Vérifiez votre connexion et réessayez.', retry: 'Réessayer', events: 'événements', updated: 'Mis à jour', cached: '(données en cache)', near: 'Près de', country: 'Pays', continentRow: 'Continent', start: 'Début', updatedRow: 'Dernière mise à jour', signal: "Signal d'origine", magnitude: 'magnitude', unifiedScale: "sur l'échelle unifiée", report: 'Voir le rapport complet', topEvent: 'Magnitude maximale', newEvent: 'Nouvel événement', newEvents: 'nouveaux événements', live: 'en Direct'
  },
  de: {
    subtitle: 'laufende Weltereignisse', refresh: 'Aktualisieren', filters: 'Filter', minMag: 'Mindestmagnitude:', kind: 'Ereignistyp', period: 'Zeitraum', p24: 'Letzte 24 Stunden', p72: 'Letzte 3 Tage', p168: 'Letzte Woche', p720: 'Letzter Monat', continent: 'Kontinent', all: 'Alle', place: 'Land oder Text', placePh: 'z. B.: Chile, Indonesien, hurricane…', alertsOnly: 'Nur orange und rote Alarme', alertsHint: 'Ereignisse mit relevantem humanitärem Einfluss laut GDACS.', legend: 'Legende', lgSmall: 'Klein (Magnitude < 3)', lgMedium: 'Mittel (3 – 5)', lgLarge: 'Groß (5 – 7)', lgGiant: 'Riesig (7 oder mehr)', lgRed: 'GDACS Rot-Alarm', legendNote: 'Eine einzige Magnitudenskala (0–10) vereint Erdbeben, Zyklone, Brände, Überschwemmungen und mehr. Ereignisse der letzten Stunde und Rot-Alarme senden Ringe aus; ältere verblassen nach einer Abklingkurve. Die Punktgröße wächst mit der Magnitude.', sources: 'Quellen', merged: 'mit Dedupe zusammengeführt.', loading: 'Ereignisse werden geladen…', errorMsg: 'Ereignisdaten konnten nicht geladen werden.', retryHint: 'Prüfe deine Verbindung und versuche es erneut.', retry: 'Erneut versuchen', events: 'Ereignisse', updated: 'Aktualisiert', cached: '(zwischengespeichert)', near: 'In der Nähe von', country: 'Land', continentRow: 'Kontinent', start: 'Beginn', updatedRow: 'Letzte Aktualisierung', signal: 'Originalsignal', magnitude: 'Magnitude', unifiedScale: 'auf der einheitlichen Skala', report: 'Vollständigen Bericht ansehen', topEvent: 'Stärkstes Ereignis', newEvent: 'Neues Ereignis', newEvents: 'neue Ereignisse', live: 'Live'
  }
};

// Distance-phrase templates: {km} {dir} {place}. Kept as functions because
// word order differs per language.
const NEAR_PHRASE = {
  es: (km, dir, place) => `${km} km al ${dir} de ${place}`,
  en: (km, dir, place) => `${km} km ${dir} of ${place}`,
  pt: (km, dir, place) => `${km} km a ${dir} de ${place}`,
  fr: (km, dir, place) => `${km} km au ${dir} de ${place}`,
  de: (km, dir, place) => `${km} km ${dir} von ${place}`
};

const IN_WORD = { es: 'en', en: 'in', pt: 'em', fr: 'en', de: 'in' };
const NEAR_WORD = { es: 'cerca de', en: 'near', pt: 'perto de', fr: 'près de', de: 'bei' };

const ALERT_PHRASE = {
  es: (c) => `alerta ${c}`,
  en: (c) => `${c} alert`,
  pt: (c) => `alerta ${c}`,
  fr: (c) => `alerte ${c}`,
  de: (c) => `${c}-Alarm`
};

const NEARBY_KM = 5; // below this, drop the distance prefix (matches server)

// ---- API -------------------------------------------------------------------

/** First supported language from a navigator.languages-style list, else en. */
export function pickLang(candidates) {
  for (const cand of candidates || []) {
    const base = String(cand).toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return FALLBACK;
}

/** UI string by key; falls back to English, then to the key itself. */
export function t(key, lang) {
  const dict = UI[lang] || UI[FALLBACK];
  return dict[key] ?? UI[FALLBACK][key] ?? key;
}

export function kindName(kind, lang) {
  const dict = KINDS[lang] || KINDS[FALLBACK];
  return dict[kind] || KINDS[FALLBACK][kind] || kind;
}

export function tierName(tier, lang) {
  const dict = TIERS_I18N[lang] || TIERS_I18N[FALLBACK];
  return dict[tier] || tier;
}

export function continentName(esName, lang) {
  if (lang === 'es') return esName;
  const dict = CONTINENTS_I18N[lang] || CONTINENTS_I18N[FALLBACK];
  return dict[esName] || esName;
}

/** Country name from an ISO2 code via Intl.DisplayNames; code on failure. */
export function countryName(cc, lang) {
  if (!cc) return null;
  try {
    const name = new Intl.DisplayNames([lang], { type: 'region' }).of(cc);
    // Intl echoes unknown codes back unchanged; that is our fallback anyway.
    return name || cc;
  } catch {
    return cc;
  }
}

export function compassName(dirIndex, lang) {
  const winds = COMPASS[lang] || COMPASS[FALLBACK];
  return winds[dirIndex] ?? '';
}

/** Accent-insensitive comparison (GeoNames admin1 names are ASCII-folded). */
function sameName(a, b) {
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return fold(a) === fold(b);
}

/** "City, Admin1, Country" in the viewer language, skipping redundant admin1. */
function placeOf(nearData, lang) {
  const parts = [nearData.name];
  if (nearData.admin1 && !sameName(nearData.admin1, nearData.name)) parts.push(nearData.admin1);
  const country = countryName(nearData.cc, lang);
  if (country) parts.push(country);
  return parts.join(', ');
}

/**
 * Localized seismology-style distance label from the API's structured
 * nearData ({ name, admin1, cc, distKm, dir }).
 */
export function nearLabel(nearData, lang) {
  if (!nearData) return null;
  const place = placeOf(nearData, lang);
  if (nearData.distKm < NEARBY_KM) return place;
  const phrase = NEAR_PHRASE[lang] || NEAR_PHRASE[FALLBACK];
  return phrase(Math.round(nearData.distKm), compassName(nearData.dir, lang), place);
}

/**
 * Viewer-language event title, built from structured fields:
 * 1. earthquakes: "Kind: <distance label>";
 * 2. named phenomena (cyclones): "Kind NAME [in Country]";
 * 3. country known: "Kind in Country";
 * 4. near a city: "Kind near City, Country";
 * 5. otherwise the raw feed title.
 */
export function localizeTitle(event, lang) {
  const kind = kindName(event.kind, lang);
  const inWord = IN_WORD[lang] || IN_WORD[FALLBACK];

  if (event.kind === 'earthquake' && event.nearData) {
    return `${kind}: ${nearLabel(event.nearData, lang)}`;
  }
  if (event.eventName) {
    const country = countryName(event.cc, lang);
    return country ? `${kind} ${event.eventName} ${inWord} ${country}` : `${kind} ${event.eventName}`;
  }
  if (event.cc) {
    return `${kind} ${inWord} ${countryName(event.cc, lang)}`;
  }
  if (event.nearData) {
    const nearWord = NEAR_WORD[lang] || NEAR_WORD[FALLBACK];
    return `${kind} ${nearWord} ${placeOf(event.nearData, lang)}`;
  }
  return event.title || kind;
}

export function alertLabel(level, lang) {
  const colors = ALERT_COLORS[lang] || ALERT_COLORS[FALLBACK];
  const phrase = ALERT_PHRASE[lang] || ALERT_PHRASE[FALLBACK];
  return phrase(colors[level] || level);
}

/**
 * Localized short date-time. No timeZone option on purpose: toLocaleString
 * renders in the viewer's own clock (computer/phone timezone).
 */
export function formatDateTime(iso, lang, { timeZoneName = false } = {}) {
  const opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (timeZoneName) opts.timeZoneName = 'short';
  return new Date(iso).toLocaleString(lang, opts);
}

if (typeof window !== 'undefined') {
  window.I18n = {
    pickLang,
    t,
    kindName,
    tierName,
    continentName,
    countryName,
    compassName,
    nearLabel,
    localizeTitle,
    alertLabel,
    formatDateTime
  };
}
