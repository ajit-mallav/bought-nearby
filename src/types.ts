export type Category = "Clothing";

export type Purchase = {
  id: string;
  itemName: string;
  storeName: string;
  storeLink?: string;
  price?: number;
  category: Category;
  photoUri?: string;
  createdAt: string;
  notes?: string;
  friendName?: string;
  friendAvatar?: string;
  isLocalStore?: boolean;
};

export type RankingMap = Record<Category, string[]>;

export type Store = {
  id: string;
  name: string;
  category: Category;
  neighborhood: string;
  borough: "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";
  address: string;
  lat: number;
  lng: number;
  tags: string[];
  description: string;
  link?: string;
  rating: number;
  photoUri: string;
};

export type FeedEvent = {
  id: string;
  actor: string;
  avatar: string;
  itemName: string;
  category: Category;
  storeName: string;
  rank: number;
  score: number;
  createdAt: string;
  photoUri?: string;
  isLocalStore?: boolean;
};

export type ComparisonSession = {
  newPurchaseId: string;
  category: Category;
  low: number;
  high: number;
  mid: number;
  comparisons: number;
};

export type UserLocation = { lat: number; lng: number; label: string };

export type NycMapProps = {
  stores: (Store & { distance: number })[];
  userLocation: UserLocation;
  onSelectStore: (store: Store) => void;
  onVisibleStoresChange: (storeIds: string[]) => void;
};
