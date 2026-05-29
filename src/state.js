// Central in-memory state — no localStorage, all persistence via Supabase

export const state = {
  draws: [],        // Draw[] assembled from Supabase
  activeTab: 0,
  currentUser: null,   // Profile | null
  viewingUser: null,   // Profile | null — set when viewing another player's bracket
  lockSchedules: [],   // lock_schedules rows for active draw
}

export function activeDraw() {
  return state.draws[state.activeTab] || null
}

export function applyTheme(slam) {
  document.body.className = slam ? 'theme-' + slam : ''
}
