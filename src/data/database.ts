import { RankingMap } from "../types";
import { Purchase } from "../types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export type PersistedAppState = {
  purchases: Purchase[];
  rankings: RankingMap;
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
    .select("purchases, rankings")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    purchases: data.purchases as Purchase[],
    rankings: data.rankings as RankingMap,
  };
}

export async function saveDatabaseState(state: PersistedAppState) {
  if (!isSupabaseConfigured || !supabase) return;

  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase.from("user_app_state").upsert({
    user_id: userId,
    purchases: state.purchases,
    rankings: state.rankings,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}
