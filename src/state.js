// Central in-memory state — no localStorage, all persistence via Supabase

export const state = {
  draws: [],        // Draw[] assembled from Supabase
  activeTab: 0,
  currentUser: null,   // Profile | null
  lockSchedules: [],   // lock_schedules rows for active draw
}

export function activeDraw() {
  return state.draws[state.activeTab] || null
}

export function hasActiveDraw() {
  return state.draws.some(d => d.is_active)
}

export function applyTheme(slam) {
  document.body.className = slam ? 'theme-' + slam : ''
}

export const isMobile = () => window.matchMedia('(max-width: 768px)').matches
