const PRODUCTION_BACKEND_URL = 'https://backend-discord-lite.vercel.app/api';
const DEVELOPMENT_BACKEND_URL = 'http://localhost:5000/api';

const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL?.trim().replace(/\/+$/, '');

export const BACKEND_URL = configuredBackendUrl
  || (import.meta.env.DEV ? DEVELOPMENT_BACKEND_URL : PRODUCTION_BACKEND_URL);
