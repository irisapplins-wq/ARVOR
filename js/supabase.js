/* Client officiel réutilisable. La Publishable key est destinée au frontend. */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://auosdkqoccwieopyrpgl.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_X4zJmgdrd2-eZNJpKX1nqw_ekAnJIAQ';

  window.arvor = window.arvor || {};
  window.arvor.supabase = null;

  if (!window.supabase?.createClient) return;

  try {
    window.arvor.supabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
    );
  } catch {
    // L’interface affiche une erreur générique sans exposer les détails techniques.
  }
})();