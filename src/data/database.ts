import { Purchase, RankingMap, WantedItem } from "../types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export type PersistedAppState = {
  purchases: Purchase[];
  rankings: RankingMap;
  wants?: WantedItem[];
};

async function currentUserId() {
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user.id) return sessionData.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user?.id ?? null;
}

export async function loadDatabaseState(): Promise<PersistedAppState | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const userId = await currentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_app_state")
    .select("purchases, rankings, wants")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    const fallback = await supabase
      .from("user_app_state")
      .select("purchases, rankings")
      .eq("user_id", userId)
      .maybeSingle();
    if (fallback.error) throw error;
    if (!fallback.data) return null;
    return {
      purchases: fallback.data.purchases as Purchase[],
      rankings: fallback.data.rankings as RankingMap,
      wants: [],
    };
  }
  if (!data) return null;

  return {
    purchases: data.purchases as Purchase[],
    rankings: data.rankings as RankingMap,
    wants: (data.wants as WantedItem[] | null) ?? [],
  };
}

export async function saveDatabaseState(state: PersistedAppState) {
  if (!isSupabaseConfigured || !supabase) return;

  const userId = await currentUserId();
  if (!userId) return;

  const payload = {
    user_id: userId,
    purchases: state.purchases,
    rankings: state.rankings,
    wants: state.wants ?? [],
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("user_app_state").upsert(payload);

  if (error) {
    const { wants: _wants, ...fallbackPayload } = payload;
    const fallback = await supabase.from("user_app_state").upsert(fallbackPayload);
    if (fallback.error) throw error;
  }
}
