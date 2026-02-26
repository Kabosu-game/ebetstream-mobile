// ========================================
// CONFIGURATION UNIQUE - DÉFINITIVE
// UNE SEULE CONSTANTE À MODIFIER POUR TOUT CHANGER
// ========================================

// API de production - utilisée quand aucune URL n'est forcée via .env
export const PRODUCTION_API_URL = 'https://acmpt.online/api';
export const PRODUCTION_BASE_URL = 'https://acmpt.online';

// Priorité au .env : VITE_API_BASE_URL / VITE_STORAGE_BASE_URL (aligné avec le projet web)
const envApiUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const envStorageUrl = import.meta.env.VITE_STORAGE_BASE_URL as string | undefined;
const envPublicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;

const isNativeApp = typeof (window as any).Capacitor !== 'undefined';
const isDevHost = typeof window !== 'undefined' && !isNativeApp && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const isDevelopment = !isNativeApp && (import.meta.env.DEV || isDevHost);

// URL UNIQUE de l'API : .env > sinon app native = prod, dev = /api, prod = acmpt.online
export const API_BASE_URL = envApiUrl && envApiUrl.trim() !== ''
  ? envApiUrl.replace(/\/+$/, '')
  : (isNativeApp ? PRODUCTION_API_URL : (isDevelopment ? '/api' : PRODUCTION_API_URL));

const storageFromApi = API_BASE_URL.startsWith('http') ? API_BASE_URL.replace(/\/api\/?$/, '') : '';
export const API_URL = envStorageUrl && envStorageUrl.trim() !== ''
  ? envStorageUrl.replace(/\/+$/, '')
  : (envApiUrl ? storageFromApi : (isDevelopment ? '' : PRODUCTION_BASE_URL));
export const STORAGE_BASE_URL = envStorageUrl && envStorageUrl.trim() !== ''
  ? envStorageUrl.replace(/\/+$/, '')
  : (API_BASE_URL.startsWith('http') ? API_BASE_URL.replace(/\/api\/?$/, '') : (isDevelopment ? '/api' : PRODUCTION_BASE_URL));
export const API_TIMEOUT = 60000;

// Origine publique pour les liens partagés (stream, challenge live).
// En app Capacitor : doit pointer vers le site web (spectateurs ouvrent le lien en navigateur).
// En browser : origin actuel. Définir VITE_PUBLIC_APP_URL en .env pour forcer (ex: https://acmpt.online).
export const PUBLIC_APP_ORIGIN =
  (envPublicAppUrl && envPublicAppUrl.trim() !== '' ? envPublicAppUrl.replace(/\/+$/, '') : null) ||
  (isNativeApp ? PRODUCTION_BASE_URL : (typeof window !== 'undefined' ? window.location.origin : ''));

// Helper pour obtenir les URLs complètes
export const getApiUrl = (endpoint: string): string => {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  return `${API_BASE_URL}/${cleanEndpoint}`;
};

export const getStorageUrl = (path: string): string => {
  if (!path) return '';
  
  // Si c'est déjà une URL complète, la retourner
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Nettoyer le chemin
  const cleanPath = path.replace(/^\/+/, '');
  return `${STORAGE_BASE_URL}/api/storage/${cleanPath}`;
};

// Helper universel pour corriger les URLs d'images
export const correctImageUrl = (url: string): string => {
  if (!url) return '';
  
  // Si c'est déjà une URL complète
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Remplacer toutes les URLs localhost/127.0.0.1 par notre URL unique
    url = url.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//g, `${API_URL}/`);
    
    // Si l'URL contient déjà /api/storage/, la laisser telle quelle
    if (url.includes('/api/storage/')) {
      return url;
    }
    
    // S'assurer que l'URL utilise /api/storage/
    if (url.includes('/storage/') && !url.includes('/api/storage/')) {
      url = url.replace(/(https?:\/\/[^\/]+)\/storage\//g, `$1/api/storage/`);
    }
    
    return url;
  }
  
  // Si c'est un chemin relatif, utiliser getStorageUrl
  return getStorageUrl(url);
};

// URLs de production pour compatibilité
export const PRODUCTION_URLS = {
  API: PRODUCTION_API_URL,
  STORAGE: PRODUCTION_BASE_URL,
  BASE: PRODUCTION_BASE_URL
};

// Export par défaut pour compatibilité
export default {
  API_URL,
  API_BASE_URL,
  STORAGE_BASE_URL,
  getApiUrl,
  getStorageUrl,
  correctImageUrl,
  PRODUCTION_URLS
};
