export type Category = "Clothing";

export type StyleFilter = "Vintage" | "Thrift" | "Boutique" | "Consignment";

export type Purchase = {
  id: string;
  itemName: string;
  storeName: string;
  storeLink?: string;
  price?: number;
  category: Category;
  styleTag?: StyleFilter;
  photoUri?: string;
  createdAt: string;
  notes?: string;
  friendName?: string;
  friendAvatar?: string;
  isLocalStore?: boolean;
};

export type WantedItem = {
  id: string;
  itemName: string;
  storeName: string;
  storeLink?: string;
  category: Category;
  styleTag?: StyleFilter;
  photoUri?: string;
  createdAt: string;
  notes?: string;
  sourceStoreId?: string;
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
  priceTier: 1 | 2 | 3 | 4;
  reviewCount: number;
  isThrift: boolean;
  galleryPhotos: string[];
};

export type FeedEvent = {
  id: string;
  actor: string;
  avatar: string;
  avatarUri: string;
  itemName: string;
  category: Category;
  storeName: string;
  rank: number;
  score: number;
  createdAt: string;
  photoUri?: string;
  notes?: string;
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
};
