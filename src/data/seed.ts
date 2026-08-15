import { Category, FeedEvent, Purchase, RankingMap, Store } from "../types";

export const CATEGORIES: Category[] = ["Clothing"];

export const CATEGORY_EMOJI: Record<Category, string> = {
  Clothing: "🧥",
};

export const emptyRankings = (): RankingMap => ({
  Clothing: [],
});

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

export const starterPurchases: Purchase[] = [
  {
    id: "p-jacket",
    itemName: "Vintage denim jacket",
    storeName: "Beacon's Closet",
    price: 54,
    category: "Clothing",
    createdAt: daysAgo(14),
    isLocalStore: true,
    photoUri:
      "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=900&q=80",
    notes: "Already my weekend uniform.",
  },
  {
    id: "p-linen-set",
    itemName: "Linen summer set",
    storeName: "Sincerely, Tommy",
    price: 118,
    category: "Clothing",
    createdAt: daysAgo(9),
    isLocalStore: true,
    photoUri:
      "https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80",
    notes: "Breathable enough for the subway platform in August.",
  },
  {
    id: "p-oxford",
    itemName: "Slim oxford shirt",
    storeName: "Rothmans",
    price: 98,
    category: "Clothing",
    createdAt: daysAgo(21),
    isLocalStore: true,
    photoUri:
      "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80",
    notes: "Tailored fit without a trip to the tailor.",
  },
  {
    id: "p-flannel",
    itemName: "Resale flannel shirt",
    storeName: "Buffalo Exchange",
    price: 22,
    category: "Clothing",
    createdAt: daysAgo(3),
    isLocalStore: true,
    photoUri:
      "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=80",
    notes: "Broken in already, exactly how I like it.",
  },
];

export const starterRankings: RankingMap = {
  Clothing: ["p-linen-set", "p-jacket", "p-oxford", "p-flannel"],
};

export const friendFeed: FeedEvent[] = [
  {
    id: "f-1",
    actor: "Maya",
    avatar: "M",
    itemName: "Linen summer set",
    category: "Clothing",
    storeName: "Sincerely, Tommy",
    rank: 1,
    score: 10,
    createdAt: daysAgo(0.8),
    photoUri:
      "https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80",
    isLocalStore: true,
  },
  {
    id: "f-2",
    actor: "Sarah",
    avatar: "S",
    itemName: "Cropped trench coat",
    category: "Clothing",
    storeName: "Buffalo Exchange",
    rank: 2,
    score: 8.6,
    createdAt: daysAgo(1.4),
    photoUri:
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80",
    isLocalStore: true,
  },
  {
    id: "f-3",
    actor: "Dylan",
    avatar: "D",
    itemName: "Wool overcoat",
    category: "Clothing",
    storeName: "Rothmans",
    rank: 3,
    score: 7.4,
    createdAt: daysAgo(2.5),
    photoUri:
      "https://images.unsplash.com/photo-1544923246-77307dd654cb?auto=format&fit=crop&w=900&q=80",
    isLocalStore: true,
  },
];

export const stores: Store[] = [
  {
    id: "s-beacons",
    name: "Beacon's Closet",
    category: "Clothing",
    neighborhood: "Williamsburg",
    borough: "Brooklyn",
    address: "74 Guernsey St, Brooklyn, NY",
    lat: 40.7259,
    lng: -73.9539,
    tags: ["vintage", "resale", "local"],
    description: "Treasure-hunt resale racks and strong outerwear finds.",
    link: "https://beaconscloset.com",
    rating: 4.5,
    photoUri:
      "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "s-tommy",
    name: "Sincerely, Tommy",
    category: "Clothing",
    neighborhood: "Bed-Stuy",
    borough: "Brooklyn",
    address: "343 Tompkins Ave, Brooklyn, NY",
    lat: 40.6837,
    lng: -73.9445,
    tags: ["boutique", "coffee", "local"],
    description: "Curated Brooklyn boutique championing independent designers.",
    link: "https://www.sincerelytommy.com",
    rating: 4.9,
    photoUri:
      "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "s-rothmans",
    name: "Rothmans",
    category: "Clothing",
    neighborhood: "Union Square",
    borough: "Manhattan",
    address: "200 Park Ave S, New York, NY",
    lat: 40.7368,
    lng: -73.9884,
    tags: ["menswear", "tailoring", "local"],
    description: "Union Square menswear institution with sharp tailoring and staff style advice.",
    link: "https://www.rothmansny.com",
    rating: 4.6,
    photoUri:
      "https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "s-buffalo",
    name: "Buffalo Exchange",
    category: "Clothing",
    neighborhood: "Williamsburg",
    borough: "Brooklyn",
    address: "504 Driggs Ave, Brooklyn, NY",
    lat: 40.7147,
    lng: -73.9571,
    tags: ["resale", "vintage", "trade-in"],
    description: "Buy-sell-trade vintage and resale racks with a rotating mix.",
    link: "https://www.buffaloexchange.com",
    rating: 4.3,
    photoUri:
      "https://images.unsplash.com/photo-1567113463300-102a7eb3cb26?auto=format&fit=crop&w=600&q=80",
  },
];
