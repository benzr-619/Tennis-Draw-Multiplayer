import { supabase } from './supabase.js'
import { state } from './state.js'

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_commissioner')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  state.currentUser = await fetchProfile(data.user.id)
  return state.currentUser
}

export async function signup(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  // Profile row created by trigger; update display_name explicitly in case trigger ran first
  if (data.user) {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      display_name: displayName,
    })
    state.currentUser = await fetchProfile(data.user.id)
  }
  return state.currentUser
}

export async function updateDisplayName(userId, displayName) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId)
  if (error) throw error
  state.currentUser = { ...state.currentUser, display_name: displayName }
}

export async function logout() {
  await supabase.auth.signOut()
  state.currentUser = null
  state.draws = []
  state.activeTab = 0
}

export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  state.currentUser = await fetchProfile(session.user.id)
  return state.currentUser
}
