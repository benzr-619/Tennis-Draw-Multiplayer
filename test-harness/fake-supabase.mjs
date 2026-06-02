// Throwaway test stub that replaces ../src/supabase.js during harness runs.
// A tiny chainable query builder. Reads/writes nothing real — selects return
// whatever the harness staged in globalThis.__FAKE_DB__[table].
function makeQuery(table) {
  const q = {
    _table: table,
    select() { return q },
    eq() { return q },
    order() { return q },
    in() { return q },
    update() { return q },
    insert() { return q },
    upsert() { return q },
    delete() { return q },
    then(resolve) {
      const data = (globalThis.__FAKE_DB__ && globalThis.__FAKE_DB__[table]) || []
      resolve({ data, error: null })
    },
  }
  return q
}

export const supabase = { from: (t) => makeQuery(t) }
