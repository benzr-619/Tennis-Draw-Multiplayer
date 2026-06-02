// ESM resolve hook: redirect the app's ./supabase.js to our fake stub so the
// real picks.js / data.js modules load in plain Node (no Vite import.meta.env).
export async function resolve(specifier, context, next) {
  if (specifier === './supabase.js' || specifier.endsWith('/src/supabase.js')) {
    return {
      url: new URL('./fake-supabase.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return next(specifier, context)
}
