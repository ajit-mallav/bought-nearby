import { Category, Purchase, RankingMap } from "../types";
import { CATEGORIES, emptyRankings } from "../data/seed";

export function scoreForRank(index: number, total: number): number {
  if (total <= 1) return 10;
  const score = 10 - (index / (total - 1)) * 10;
  return Math.max(0, Math.round(score * 10) / 10);
}

export function rankOf(purchaseId: string, category: Category, rankings: RankingMap): number | undefined {
  const index = rankings[category]?.indexOf(purchaseId) ?? -1;
  return index >= 0 ? index + 1 : undefined;
}

export function scoreOf(purchaseId: string, category: Category, rankings: RankingMap): number | undefined {
  const list = rankings[category];
  if (!list) return undefined;
  const index = list.indexOf(purchaseId);
  if (index < 0) return undefined;
  return scoreForRank(index, list.length);
}

export function sanitizePurchases(purchases: Purchase[]): Purchase[] {
  const known = new Set<Category>(CATEGORIES);
  return purchases.filter((purchase) => known.has(purchase.category));
}

export function rankedPurchasesForCategory(
  category: Category,
  purchases: Purchase[],
  rankings: RankingMap,
): Purchase[] {
  const byId = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  return rankings[category].map((id) => byId.get(id)).filter((purchase): purchase is Purchase => !!purchase);
}

export function sanitizeRankings(purchases: Purchase[], rankings: RankingMap): RankingMap {
  const idsByCategory = new Map<Category, Set<string>>();
  for (const category of CATEGORIES) idsByCategory.set(category, new Set());

  for (const purchase of purchases) {
    idsByCategory.get(purchase.category)?.add(purchase.id);
  }

  const next = emptyRankings();

  for (const category of CATEGORIES) {
    const ids = idsByCategory.get(category) ?? new Set<string>();
    const seen = new Set<string>();

    for (const id of rankings[category] ?? []) {
      if (ids.has(id) && !seen.has(id)) {
        next[category].push(id);
        seen.add(id);
      }
    }

    for (const id of ids) {
      if (!seen.has(id)) next[category].push(id);
    }
  }

  return next;
}

export function insertAtRank(rankings: RankingMap, category: Category, purchaseId: string, index: number): RankingMap {
  const current = rankings[category].filter((id) => id !== purchaseId);
  const boundedIndex = Math.max(0, Math.min(index, current.length));
  const updated = [...current.slice(0, boundedIndex), purchaseId, ...current.slice(boundedIndex)];
  return {
    ...rankings,
    [category]: updated,
  };
}

export function topLifetimePurchases(purchases: Purchase[], rankings: RankingMap, limit = 10) {
  const byId = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  return CATEGORIES.flatMap((category) =>
    rankings[category]
      .map((id, index) => {
        const purchase = byId.get(id);
        if (!purchase) return undefined;
        return {
          purchase,
          rank: index + 1,
          score: scoreForRank(index, rankings[category].length),
        };
      })
      .filter((entry): entry is { purchase: Purchase; rank: number; score: number } => !!entry),
  )
    .sort((a, b) => b.score - a.score || +new Date(b.purchase.createdAt) - +new Date(a.purchase.createdAt))
    .slice(0, limit);
}
