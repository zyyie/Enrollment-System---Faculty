// Default config when not using python server.py
// server.py overrides this at /js/config.js when running locally
window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
  url: '',
  publishableKey: '',
  enabled: false,
  enrollmentFee: 2500
};
