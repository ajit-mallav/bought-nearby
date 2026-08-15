import { Ionicons } from "@expo/vector-icons";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text as NativeText,
  TextInput,
  type TextProps,
  View,
} from "react-native";

import NycMap from "./src/components/NycMap";
import { loadDatabaseState, saveDatabaseState } from "./src/data/database";
import { CATEGORIES, ITEM_TYPES, STYLE_FILTERS, friendFeed, starterPurchases, starterRankings, starterWants, stores } from "./src/data/seed";
import { colors, feedColors, fonts, layout } from "./src/theme";
import { Category, ComparisonSession, FeedEvent, ItemType, Purchase, Store, StyleFilter, WantedItem } from "./src/types";
import { distanceMiles } from "./src/utils/geo";
import { insertAtRank, rankOf, rankedPurchasesForCategory, sanitizePurchases, sanitizeRankings, scoreForRank, scoreOf, topLifetimePurchases } from "./src/utils/ranking";

const STORAGE_KEY = "@bought-nearby:v1";
const PROFILE_KEY = "@bought-nearby:profile:v1";

type ProfileSection = "bought" | "recs";
type ProfileInfo = {
  name: string;
  handle: string;
  neighborhood: string;
  avatarUri?: string;
  goal2026?: number;
};

const defaultProfile: ProfileInfo = { name: "Tej Chakravarthy", handle: "Tejchak", neighborhood: "" };
const DEFAULT_LOCATION = { lat: 40.7359, lng: -73.9911, label: "Union Square" };

type TabKey = "feed" | "add" | "search" | "map" | "profile";
type DraftPurchase = {
  mode: "bought" | "want";
  itemName: string;
  storeName: string;
  storeLink: string;
  price: string;
  category: Category;
  styleTag: StyleFilter;
  itemType: ItemType;
  notes: string;
  photoUri?: string;
};

type PlaceSearchResult = {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  address?: Record<string, string | undefined>;
};

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: "feed", label: "Home", icon: "sparkles-outline" },
  { key: "map", label: "Map", icon: "map-outline" },
  { key: "add", label: "Add", icon: "add" },
  { key: "search", label: "Search", icon: "search-outline" },
  { key: "profile", label: "Me", icon: "person-circle-outline" },
];

function currentStreakWeeks(purchases: Purchase[]): number {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let streak = 0;
  while (
    purchases.some((purchase) => {
      const age = now - new Date(purchase.createdAt).getTime();
      return age >= streak * weekMs && age < (streak + 1) * weekMs;
    })
  ) {
    streak += 1;
  }
  return streak;
}

const emptyDraft = (): DraftPurchase => ({
  mode: "bought",
  itemName: "",
  storeName: "",
  storeLink: "",
  price: "",
  category: "Clothing",
  styleTag: STYLE_FILTERS[0],
  itemType: ITEM_TYPES[0],
  notes: "",
});

function firstMatchingStyleTag(tags: string[]): StyleFilter | undefined {
  return STYLE_FILTERS.find((style) => tags.some((tag) => tag.toLowerCase() === style.toLowerCase()));
}

const appFonts = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
};

function fontFamilyForWeight(weight: unknown) {
  if (weight === "bold") return fonts.bold;
  const numericWeight = typeof weight === "number" ? weight : Number(String(weight ?? "400").replace(/[^0-9]/g, ""));
  if (numericWeight >= 900) return fonts.black;
  if (numericWeight >= 800) return fonts.extraBold;
  if (numericWeight >= 700) return fonts.bold;
  if (numericWeight >= 600) return fonts.semiBold;
  if (numericWeight >= 500) return fonts.medium;
  return fonts.regular;
}

function Text({ style, ...props }: TextProps) {
  const flattenedStyle = StyleSheet.flatten(style);
  return <NativeText {...props} style={[styles.appText, style, { fontFamily: fontFamilyForWeight(flattenedStyle?.fontWeight) }]} />;
}

export default function App() {
  const [fontsLoaded] = useFonts(appFonts);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return <BoughtNearbyApp />;
}

function BoughtNearbyApp() {
  const [selectedTab, setSelectedTab] = useState<TabKey>("feed");
  const [purchases, setPurchases] = useState<Purchase[]>(starterPurchases);
  const [rankings, setRankings] = useState(starterRankings);
  const [wants, setWants] = useState<WantedItem[]>(starterWants);
  const [draft, setDraft] = useState<DraftPurchase>(emptyDraft());
  const [itemTypeDropdownOpen, setItemTypeDropdownOpen] = useState(false);
  const [placeSearchVisible, setPlaceSearchVisible] = useState(false);
  const [placeSearchTerm, setPlaceSearchTerm] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [homeSearchActive, setHomeSearchActive] = useState(false);
  const homeSearchInputRef = useRef<TextInput>(null);
  const homeSearchProgress = useRef(new Animated.Value(0)).current;
  const [searchStyle, setSearchStyle] = useState<StyleFilter | "All">("All");
  const [searchPriceTiers, setSearchPriceTiers] = useState<Set<1 | 2 | 3 | 4>>(new Set());
  const [searchMinRating, setSearchMinRating] = useState<number | null>(null);
  const [activeSearchFilter, setActiveSearchFilter] = useState<"type" | "cost" | "rating" | null>(null);
  const [mapStyle, setMapStyle] = useState<StyleFilter | "All">("All");

  function togglePriceTier(tier: 1 | 2 | 3 | 4) {
    setSearchPriceTiers((current) => {
      const next = new Set(current);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [locationMessage, setLocationMessage] = useState("Showing nearby stores around Union Square.");
  const [selectedShop, setSelectedShop] = useState<Store | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());

  function toggleLike(id: string) {
    setLikedPostIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [profile, setProfile] = useState<ProfileInfo>(defaultProfile);
  const [profileSection, setProfileSection] = useState<ProfileSection | null>(null);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editDraft, setEditDraft] = useState<ProfileInfo>(defaultProfile);
  const [friendsModal, setFriendsModal] = useState<"followers" | "following" | null>(null);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [customGoalOpen, setCustomGoalOpen] = useState(false);
  const [customGoalValue, setCustomGoalValue] = useState("");

  useEffect(() => {
    Animated.timing(homeSearchProgress, {
      toValue: homeSearchActive ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && homeSearchActive) homeSearchInputRef.current?.focus();
    });
  }, [homeSearchActive, homeSearchProgress]);

  useEffect(() => {
    if (selectedTab !== "feed" && homeSearchActive) setHomeSearchActive(false);
  }, [homeSearchActive, selectedTab]);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then(async (raw) => {
        if (!isMounted) return;

        const localState = raw
          ? (JSON.parse(raw) as { purchases?: Purchase[]; rankings?: typeof starterRankings; wants?: WantedItem[] })
          : null;
        const databaseState = await loadDatabaseState();
        const savedState = databaseState ?? localState;

        if (savedState?.purchases && savedState.rankings) {
          const cleanedPurchases = sanitizePurchases(savedState.purchases);
          setPurchases(cleanedPurchases);
          setRankings(sanitizeRankings(cleanedPurchases, savedState.rankings));
          setWants(savedState.wants ?? []);
        }

        if (!databaseState && localState?.purchases && localState.rankings) {
          await saveDatabaseState({ purchases: localState.purchases, rankings: localState.rankings, wants: localState.wants ?? [] });
        }
      })
      .catch(() => {
        showToast("Saved data could not be loaded. Showing your current recommendations.");
      })
      .finally(() => {
        if (isMounted) setHydrated(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state = { purchases, rankings, wants };
    Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)),
      saveDatabaseState(state),
    ]).catch(() => {
      showToast("Could not sync this change. It will retry next time.");
    });
  }, [hydrated, purchases, rankings, wants]);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => {
        if (raw) setProfile({ ...defaultProfile, ...(JSON.parse(raw) as Partial<ProfileInfo>) });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)).catch(() => {});
  }, [hydrated, profile]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const purchasesById = useMemo(() => new Map(purchases.map((purchase) => [purchase.id, purchase])), [purchases]);

  const userFeed = useMemo<FeedEvent[]>(() => {
    const events: FeedEvent[] = [];

    for (const purchase of purchases) {
      const rank = rankOf(purchase.id, purchase.category, rankings);
      const score = scoreOf(purchase.id, purchase.category, rankings);
      if (!rank || score === undefined) continue;

      const event: FeedEvent = {
        id: `you-${purchase.id}`,
        actor: "You",
        avatar: "Y",
        avatarUri: "https://i.pravatar.cc/150?img=68",
        itemName: purchase.itemName,
        category: purchase.category,
        storeName: purchase.storeName,
        rank,
        score,
        createdAt: purchase.createdAt,
      };
      if (purchase.photoUri) event.photoUri = purchase.photoUri;
      if (purchase.notes) event.notes = purchase.notes;
      if (typeof purchase.isLocalStore === "boolean") event.isLocalStore = purchase.isLocalStore;
      events.push(event);
    }

    return events.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 12);
  }, [purchases, rankings]);

  const feedEvents = useMemo(
    () => [...userFeed, ...friendFeed].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [userFeed],
  );

  const localPurchaseCount = purchases.filter((purchase) => purchase.isLocalStore).length;
  const rankedCount = CATEGORIES.reduce((sum, category) => sum + rankings[category].length, 0);
  const topItems = topLifetimePurchases(purchases, rankings, 8);
  const wantedStoreIds = useMemo(() => new Set(wants.map((want) => want.sourceStoreId).filter((id): id is string => !!id)), [wants]);

  const friendProfiles = useMemo(() => {
    const latestByActor = new Map<string, FeedEvent>();
    for (const event of friendFeed) {
      const current = latestByActor.get(event.actor);
      if (!current || +new Date(event.createdAt) > +new Date(current.createdAt)) latestByActor.set(event.actor, event);
    }
    return [...latestByActor.values()];
  }, []);

  const leaderboardRows = useMemo(() => {
    const counts = new Map<string, { avatar: string; count: number }>();
    for (const event of friendFeed) {
      const entry = counts.get(event.actor) ?? { avatar: event.avatar, count: 0 };
      entry.count += 1;
      counts.set(event.actor, entry);
    }
    const rows = [
      { name: `${profile.name} (you)`, avatar: profile.name.trim()[0]?.toUpperCase() ?? "Y", count: rankedCount, isYou: true },
      ...[...counts.entries()].map(([name, entry]) => ({ name, avatar: entry.avatar, count: entry.count, isYou: false })),
    ];
    return rows.sort((a, b) => b.count - a.count);
  }, [profile.name, rankedCount]);

  const recommendedStores = useMemo(() => {
    const boughtFrom = new Set(purchases.map((purchase) => purchase.storeName.toLowerCase()));
    return stores
      .filter((store) => !boughtFrom.has(store.name.toLowerCase()))
      .map((store) => {
        const friendBuys = friendFeed.filter((event) => event.storeName.toLowerCase() === store.name.toLowerCase()).length;
        const savedWants = wants.filter((want) => want.storeName.toLowerCase() === store.name.toLowerCase()).length;
        return { store, match: Math.min(99, Math.round(store.rating * 19 + friendBuys * 2 + savedWants * 3)) };
      })
      .sort((a, b) => b.match - a.match);
  }, [purchases, wants]);

  function showToast(message: string) {
    setToast(message);
  }

  function updateDraft(update: Partial<DraftPurchase>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function placeName(place: PlaceSearchResult) {
    return place.name || place.address?.shop || place.address?.retail || place.address?.amenity || place.display_name.split(",")[0]?.trim() || "Selected shop";
  }

  function placeSubtitle(place: PlaceSearchResult) {
    const parts = place.display_name.split(",").map((part) => part.trim()).filter(Boolean);
    return parts.slice(1, 4).join(", ") || place.display_name;
  }

  function googleMapsUrlForPlace(place: PlaceSearchResult) {
    const query = encodeURIComponent(`${placeName(place)} ${place.display_name}`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  function openPlaceSearch() {
    setPlaceSearchTerm(draft.storeName);
    setPlaceSearchResults([]);
    setPlaceSearchError(null);
    setPlaceSearchVisible(true);
  }

  async function searchPlaces(query = placeSearchTerm) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setPlaceSearchError("Type a shop name first.");
      return;
    }

    setPlaceSearchLoading(true);
    setPlaceSearchError(null);
    try {
      const params = new URLSearchParams({
        format: "jsonv2",
        addressdetails: "1",
        limit: "8",
        bounded: "1",
        countrycodes: "us",
        viewbox: "-74.28,40.92,-73.68,40.49",
        q: `${cleanQuery} clothing store NYC`,
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!response.ok) throw new Error("Place search failed");
      const results = (await response.json()) as PlaceSearchResult[];
      setPlaceSearchResults(results);
      if (results.length === 0) setPlaceSearchError("No NYC shops found. Try a more specific name or neighborhood.");
    } catch {
      setPlaceSearchError("Could not search places right now. You can still type the shop manually.");
    } finally {
      setPlaceSearchLoading(false);
    }
  }

  function selectPlace(place: PlaceSearchResult) {
    updateDraft({
      storeName: placeName(place),
      storeLink: googleMapsUrlForPlace(place),
    });
    setPlaceSearchVisible(false);
    showToast(`${placeName(place)} added from map search.`);
  }

  async function pickImage() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast("Photo permission is needed to attach item photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.82,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        updateDraft({ photoUri: result.assets[0].uri });
      }
    } catch {
      showToast("Photo picker is unavailable in this environment.");
    }
  }

  function useSamplePhoto() {
    const sample = starterPurchases.find((purchase) => purchase.category === draft.category) ?? starterPurchases[0];
    updateDraft({ photoUri: sample.photoUri });
    showToast("Photo added.");
  }

  function saveWant(itemName: string, storeName: string) {
    const matchedStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
    const want: WantedItem = {
      id: `w-${Date.now()}`,
      itemName,
      storeName,
      storeLink: draft.storeLink.trim() || matchedStore?.link,
      category: draft.category,
      styleTag: draft.styleTag,
      itemType: draft.itemType,
      photoUri: draft.photoUri || matchedStore?.photoUri,
      notes: draft.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
      sourceStoreId: matchedStore?.id,
    };

    setWants((current) => [want, ...current.filter((existing) => existing.id !== want.id)]);
    setDraft(emptyDraft());
    showToast(`${want.itemName} was added to your want-to-buy list.`);
  }

  function submitPurchase() {
    const itemName = draft.itemName.trim();
    const storeName = draft.storeName.trim();
    if (!itemName || !storeName) {
      showToast("Add an item name and store first.");
      return;
    }

    if (draft.mode === "want") {
      saveWant(itemName, storeName);
      return;
    }

    const cleanPrice = Number(draft.price.replace(/[^0-9.]/g, ""));
    const matchedStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
    const purchase: Purchase = {
      id: `p-${Date.now()}`,
      itemName,
      storeName,
      storeLink: draft.storeLink.trim() || matchedStore?.link,
      price: Number.isFinite(cleanPrice) && cleanPrice > 0 ? cleanPrice : undefined,
      category: draft.category,
      styleTag: draft.styleTag,
      itemType: draft.itemType,
      photoUri: draft.photoUri,
      notes: draft.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
      isLocalStore: matchedStore ? matchedStore.tags.includes("local") : true,
    };

    const existingRanking = rankings[purchase.category];
    setPurchases((current) => [purchase, ...current]);
    setDraft(emptyDraft());
    setSelectedTab("add");

    if (existingRanking.length === 0) {
      setRankings((current) => insertAtRank(current, purchase.category, purchase.id, 0));
      showToast(`${purchase.itemName} is #1 in ${purchase.category}.`);
      return;
    }

    setComparison({
      newPurchaseId: purchase.id,
      category: purchase.category,
      low: 0,
      high: existingRanking.length,
      mid: Math.floor(existingRanking.length / 2),
      comparisons: 0,
    });
  }

  function answerComparison(newItemIsBetter: boolean) {
    if (!comparison) return;

    const nextLow = newItemIsBetter ? comparison.low : comparison.mid + 1;
    const nextHigh = newItemIsBetter ? comparison.mid : comparison.high;
    const comparisons = comparison.comparisons + 1;

    if (nextLow >= nextHigh) {
      const purchase = purchasesById.get(comparison.newPurchaseId);
      setRankings((current) => insertAtRank(current, comparison.category, comparison.newPurchaseId, nextLow));
      setComparison(null);
      setSelectedTab("profile");
      showToast(
        purchase
          ? `${purchase.itemName} landed at #${nextLow + 1} in ${comparison.category} after ${comparisons} comparison${comparisons === 1 ? "" : "s"}.`
          : "Ranking saved.",
      );
      return;
    }

    setComparison({
      ...comparison,
      low: nextLow,
      high: nextHigh,
      mid: Math.floor((nextLow + nextHigh) / 2),
      comparisons,
    });
  }

  function skipComparisonToBottom() {
    if (!comparison) return;
    const purchase = purchasesById.get(comparison.newPurchaseId);
    setRankings((current) => insertAtRank(current, comparison.category, comparison.newPurchaseId, current[comparison.category].length));
    setComparison(null);
    showToast(purchase ? `${purchase.itemName} was placed at the bottom for now.` : "Ranking skipped.");
  }

  async function resetDemoData() {
    setPurchases(starterPurchases);
    setRankings(starterRankings);
    setWants(starterWants);
    setComparison(null);
    setDraft(emptyDraft());
    await AsyncStorage.removeItem(STORAGE_KEY);
    showToast("App data reset.");
  }

  async function shareProfile() {
    setProfileMenuVisible(false);
    const top = topItems[0];
    const shopCount = new Set(purchases.map((purchase) => purchase.storeName)).size;
    const message = `${profile.name} (@${profile.handle}) on Bought Nearby — ${purchases.length} local finds from ${shopCount} NYC shops.${top ? ` Current #1: ${top.purchase.itemName} from ${top.purchase.storeName}.` : ""}`;

    if (Platform.OS === "web") {
      const nav = typeof navigator === "undefined" ? undefined : navigator;
      if (nav?.share) {
        try {
          await nav.share({ text: message });
          return;
        } catch {
          // fall through to clipboard
        }
      }
      if (nav?.clipboard) {
        try {
          await nav.clipboard.writeText(message);
          showToast("Profile summary copied to clipboard.");
          return;
        } catch {
          // fall through
        }
      }
      showToast("Sharing is unavailable in this browser.");
      return;
    }

    try {
      await Share.share({ message });
    } catch {
      showToast("Sharing is unavailable here.");
    }
  }

  function openEditProfile() {
    setEditDraft({
      name: profile.name,
      handle: profile.handle,
      neighborhood: profile.neighborhood,
      ...(profile.avatarUri ? { avatarUri: profile.avatarUri } : {}),
    });
    setProfileMenuVisible(false);
    setEditingProfile(true);
  }

  function saveProfile() {
    const name = editDraft.name.trim();
    const handle = editDraft.handle.trim().replace(/^@/, "");
    if (!name || !handle) {
      showToast("Name and handle are both required.");
      return;
    }
    setProfile((current) => {
      const next: ProfileInfo = { ...current, name, handle, neighborhood: editDraft.neighborhood.trim() };
      if (editDraft.avatarUri) next.avatarUri = editDraft.avatarUri;
      else delete next.avatarUri;
      return next;
    });
    setEditingProfile(false);
    showToast("Profile updated.");
  }

  async function pickAvatar() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast("Photo permission is needed to set an avatar.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      const uri = result.canceled ? undefined : result.assets[0]?.uri;
      if (uri) setEditDraft((current) => ({ ...current, avatarUri: uri }));
    } catch {
      showToast("Photo picker is unavailable in this environment.");
    }
  }

  function setYearGoal(goal: number) {
    setProfile((current) => ({ ...current, goal2026: goal }));
    setCustomGoalOpen(false);
    setCustomGoalValue("");
    showToast(`2026 goal set: ${goal} local finds.`);
  }

  async function requestLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Location permission was denied. Showing stores near Union Square instead.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({});
      setUserLocation({ lat: current.coords.latitude, lng: current.coords.longitude, label: "Your current location" });
      setLocationMessage("Sorted stores by your current location.");
    } catch {
      setLocationMessage("Could not access your location. Showing stores near Union Square instead.");
    }
  }

  function renderBody() {
    switch (selectedTab) {
      case "feed":
        return renderFeed();
      case "add":
        return renderAdd();
      case "search":
        return renderSearch();
      case "profile":
        return renderProfile();
      default:
        return renderFeed();
    }
  }

  function renderFeed() {
    const underThreeDollars = [...stores]
      .filter((store) => store.priceTier < 3)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10);
    const mostPopular = [...stores].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 10);
    const thriftStores = [...stores].filter((store) => store.isThrift).sort((a, b) => b.rating - a.rating).slice(0, 10);
    const friendPosts = feedEvents.filter((event) => event.actor !== "You");
    const homeSearchScale = homeSearchProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });
    const homeSearchHelperOpacity = homeSearchProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
    const homeSearchHelperHeight = homeSearchProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 42] });

    return (
      <View style={styles.homeScreen}>
        <View style={styles.homeTopRow}>
          <Image source={require("./assets/logo-horizontal.png")} style={styles.homeLogoHorizontal} resizeMode="contain" />
        </View>

        <Animated.View style={[styles.homeSearchBar, homeSearchActive && styles.homeSearchBarActive, { transform: [{ scale: homeSearchScale }] }]}>
          {homeSearchActive ? (
            <View style={styles.homeSearchInputRow}>
              <Ionicons name="search-outline" size={20} color={feedColors.teal} />
              <TextInput
                ref={homeSearchInputRef}
                style={styles.homeSearchInput}
                placeholder="Search for a store, member, or item"
                placeholderTextColor={colors.muted}
                value={searchTerm}
                onChangeText={setSearchTerm}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => setSelectedTab("search")}
              />
              <Pressable
                hitSlop={10}
                onPress={() => {
                  setSearchTerm("");
                  setHomeSearchActive(false);
                }}
              >
                <Text style={styles.homeSearchCancelText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.homeSearchPressable} onPress={() => setHomeSearchActive(true)}>
              <Ionicons name="search-outline" size={20} color={feedColors.teal} />
              <Text style={styles.homeSearchText}>Search for a store, member, or item</Text>
            </Pressable>
          )}
        </Animated.View>
        <Animated.View style={[styles.homeSearchHelper, { height: homeSearchHelperHeight, opacity: homeSearchHelperOpacity }]}>
          <Text style={styles.homeSearchHelperText}>Start typing here, then press search for full results.</Text>
          <Pressable style={styles.homeSearchHelperButton} onPress={() => setSelectedTab("search")}>
            <Text style={styles.homeSearchHelperButtonText}>View all</Text>
          </Pressable>
        </Animated.View>

        <FeaturedRow title="Under $$$" stores={underThreeDollars} onSelect={setSelectedShop} />
        <FeaturedRow title="Most popular" stores={mostPopular} onSelect={setSelectedShop} />
        <FeaturedRow title="Top thrift stores" stores={thriftStores} onSelect={setSelectedShop} />

        <SectionHeader title="Your Feed" action={`${friendPosts.length} posts`} />
        {friendPosts.map((event) => (
          <FeedPostCard
            key={event.id}
            event={event}
            liked={likedPostIds.has(event.id)}
            onToggleLike={() => toggleLike(event.id)}
            onPressStore={() => openStoreByName(event.storeName)}
            onComment={() => showToast("Comments are coming soon.")}
            onSend={() => showToast(`Send "${event.itemName}" to a friend — coming soon.`)}
          />
        ))}
      </View>
    );
  }

  function openStoreByName(name: string) {
    const match = stores.find((store) => store.name.toLowerCase() === name.toLowerCase());
    if (match) setSelectedShop(match);
  }

  function saveStoreWant(store: Store) {
    const alreadySaved = wants.some((want) => want.sourceStoreId === store.id && want.itemName === `Shop ${store.name}`);
    if (alreadySaved) {
      showToast(`${store.name} is already on your want-to-shop list.`);
      return;
    }

    const want: WantedItem = {
      id: `w-${Date.now()}`,
      itemName: `Shop ${store.name}`,
      storeName: store.name,
      storeLink: store.link,
      category: store.category,
      styleTag: firstMatchingStyleTag(store.tags),
      photoUri: store.photoUri,
      notes: `Saved from the map to visit ${store.neighborhood}.`,
      createdAt: new Date().toISOString(),
      sourceStoreId: store.id,
    };
    setWants((current) => [want, ...current]);
    showToast(`${store.name} was added to your want-to-shop list.`);
  }

  function startLogFromStore(store: Store) {
    setDraft({
      ...emptyDraft(),
      mode: "bought",
      storeName: store.name,
      storeLink: store.link ?? "",
      category: store.category,
      styleTag: firstMatchingStyleTag(store.tags) ?? STYLE_FILTERS[0],
    });
    setSelectedShop(null);
    setSelectedTab("add");
  }

  function convertWantToDraft(want: WantedItem) {
    setDraft({
      ...emptyDraft(),
      mode: "bought",
      itemName: want.itemName.startsWith("Shop ") ? "" : want.itemName,
      storeName: want.storeName,
      storeLink: want.storeLink ?? "",
      category: want.category,
      styleTag: want.styleTag ?? STYLE_FILTERS[0],
      itemType: want.itemType ?? ITEM_TYPES[0],
      notes: want.notes ?? "",
      photoUri: want.photoUri,
    });
    setWants((current) => current.filter((item) => item.id !== want.id));
    setSelectedShop(null);
    setSelectedTab("add");
    showToast("Want moved into the purchase logger.");
  }

  function renderAdd() {
    const isWantMode = draft.mode === "want";
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.cardKicker}>Purchase log</Text>
          <Text style={styles.cardTitle}>{isWantMode ? "What do you want to buy?" : "What did you buy?"}</Text>
          <Text style={styles.cardSubtitle}>
            {isWantMode
              ? "Save things or stores you want to check out, like Beli's want-to-go list but for shopping."
              : "Add a photo, store, and category. Then the app asks binary comparison questions to bubble it into your ranked shelf."}
          </Text>

          <View style={styles.segmentedControl}>
            <Pressable style={[styles.segmentButton, !isWantMode && styles.segmentButtonActive]} onPress={() => updateDraft({ mode: "bought" })}>
              <Ionicons name="checkmark-circle-outline" size={17} color={!isWantMode ? "white" : colors.ink} />
              <Text style={[styles.segmentText, !isWantMode && styles.segmentTextActive]}>Bought</Text>
            </Pressable>
            <Pressable style={[styles.segmentButton, isWantMode && styles.segmentButtonActive]} onPress={() => updateDraft({ mode: "want" })}>
              <Ionicons name="bookmark-outline" size={17} color={isWantMode ? "white" : colors.ink} />
              <Text style={[styles.segmentText, isWantMode && styles.segmentTextActive]}>Want</Text>
            </Pressable>
          </View>

          <View style={styles.photoPickerRow}>
            <PhotoPreview uri={draft.photoUri} category={draft.category} size="large" />
            <View style={styles.photoActions}>
              <Pressable style={styles.secondaryButton} onPress={pickImage}>
                <Ionicons name="images-outline" size={18} color={colors.ink} />
                <Text style={styles.secondaryButtonText}>Choose photo</Text>
              </Pressable>
              <Pressable style={styles.ghostButton} onPress={useSamplePhoto}>
                <Text style={styles.ghostButtonText}>Use stock photo</Text>
              </Pressable>
            </View>
          </View>

          <FormLabel label="Item name" />
          <TextInput
            style={styles.input}
            placeholder="e.g. Vintage denim jacket"
            placeholderTextColor={colors.muted}
            value={draft.itemName}
            onChangeText={(itemName) => updateDraft({ itemName })}
          />

          <FormLabel label="Store or link" />
          <View style={styles.storeLookupRow}>
            <TextInput
              style={[styles.input, styles.storeLookupInput]}
              placeholder="e.g. Beacon's Closet"
              placeholderTextColor={colors.muted}
              value={draft.storeName}
              onChangeText={(storeName) => updateDraft({ storeName })}
            />
            <Pressable style={styles.storeLookupButton} onPress={openPlaceSearch}>
              <Ionicons name="map-outline" size={17} color="white" />
              <Text style={styles.storeLookupButtonText}>Find</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, styles.inputSpacing]}
            placeholder="Optional product/store URL"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            value={draft.storeLink}
            onChangeText={(storeLink) => updateDraft({ storeLink })}
          />

          <Modal visible={placeSearchVisible} transparent animationType="slide" onRequestClose={() => setPlaceSearchVisible(false)}>
            <View style={styles.placeSearchBackdrop}>
              <View style={styles.placeSearchSheet}>
                <View style={styles.placeSearchHeader}>
                  <View>
                    <Text style={styles.filterSheetTitle}>Find a shop</Text>
                    <Text style={styles.placeSearchSubtitle}>Search NYC places and fill the store field.</Text>
                  </View>
                  <Pressable style={styles.placeSearchCloseButton} onPress={() => setPlaceSearchVisible(false)}>
                    <Ionicons name="close" size={20} color={colors.ink} />
                  </Pressable>
                </View>
                <View style={styles.placeSearchInputRow}>
                  <TextInput
                    style={[styles.input, styles.placeSearchInput]}
                    placeholder="Search Beacon's Closet, vintage SoHo..."
                    placeholderTextColor={colors.muted}
                    value={placeSearchTerm}
                    onChangeText={setPlaceSearchTerm}
                    autoCapitalize="words"
                    returnKeyType="search"
                    onSubmitEditing={() => searchPlaces()}
                  />
                  <Pressable style={styles.placeSearchButton} onPress={() => searchPlaces()} disabled={placeSearchLoading}>
                    <Text style={styles.placeSearchButtonText}>{placeSearchLoading ? "..." : "Search"}</Text>
                  </Pressable>
                </View>
                <Text style={styles.placeSearchHint}>Uses OpenStreetMap place search. Selected shops link out to Google Maps.</Text>
                {!!placeSearchError && <Text style={styles.placeSearchError}>{placeSearchError}</Text>}
                <ScrollView style={styles.placeSearchResults} keyboardShouldPersistTaps="handled">
                  {placeSearchResults.map((place) => (
                    <Pressable key={String(place.place_id)} style={styles.placeResultRow} onPress={() => selectPlace(place)}>
                      <View style={styles.placeResultIcon}>
                        <Ionicons name="storefront-outline" size={18} color={feedColors.teal} />
                      </View>
                      <View style={styles.placeResultContent}>
                        <Text style={styles.placeResultTitle}>{placeName(place)}</Text>
                        <Text style={styles.placeResultSubtitle} numberOfLines={2}>{placeSubtitle(place)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                    </Pressable>
                  ))}
                  {!placeSearchLoading && placeSearchResults.length === 0 && !placeSearchError && (
                    <Text style={styles.placeSearchEmpty}>Search for a store name to see map results.</Text>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>

          <View style={styles.twoColumnRow}>
            <View style={styles.flexOne}>
              <FormLabel label={isWantMode ? "Target price" : "Price"} />
              <TextInput
                style={styles.input}
                placeholder={isWantMode ? "Optional" : "$48"}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={draft.price}
                onChangeText={(price) => updateDraft({ price })}
              />
            </View>
            <View style={styles.flexOne}>
              <FormLabel label="Clothing Item" />
              <Pressable style={styles.filterButton} onPress={() => setItemTypeDropdownOpen(true)}>
                <Text style={styles.filterButtonText} numberOfLines={1}>{draft.itemType}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.ink} />
              </Pressable>
            </View>
          </View>

          <Modal visible={itemTypeDropdownOpen} transparent animationType="fade" onRequestClose={() => setItemTypeDropdownOpen(false)}>
            <Pressable style={styles.filterModalBackdrop} onPress={() => setItemTypeDropdownOpen(false)}>
              <Pressable style={styles.filterSheet} onPress={(event) => event.stopPropagation()}>
                <Text style={styles.filterSheetTitle}>Clothing Item</Text>
                {ITEM_TYPES.map((option) => (
                  <Pressable
                    key={option}
                    style={styles.filterOptionRow}
                    onPress={() => {
                      updateDraft({ itemType: option });
                      setItemTypeDropdownOpen(false);
                    }}
                  >
                    <Text style={styles.filterOptionText}>{option}</Text>
                    {draft.itemType === option && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                  </Pressable>
                ))}
              </Pressable>
            </Pressable>
          </Modal>

          <FormLabel label="Notes" />
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Why was it worth it?"
            placeholderTextColor={colors.muted}
            multiline
            value={draft.notes}
            onChangeText={(notes) => updateDraft({ notes })}
          />

          <Pressable style={styles.primaryButton} onPress={submitPurchase}>
            <Ionicons name={isWantMode ? "bookmark-outline" : "git-compare-outline"} size={18} color="white" />
            <Text style={styles.primaryButtonText}>{isWantMode ? "Save to wants" : "Save & rank"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  function renderSearch() {
    const normalized = searchTerm.trim().toLowerCase();
    const destinationForStore = (storeName: string, fallbackTab: TabKey = "profile") => () => {
      const store = stores.find((candidate) => candidate.name.toLowerCase() === storeName.toLowerCase());
      if (store) {
        setSelectedShop(store);
        return;
      }
      setSelectedTab(fallbackTab);
    };
    const storeForName = (storeName: string) =>
      stores.find((candidate) => candidate.name.toLowerCase() === storeName.toLowerCase());
    const purchaseRows = purchases.map((purchase) => ({
      id: `purchase-${purchase.id}`,
      type: "Your shelf",
      title: purchase.itemName,
      subtitle: purchase.storeName,
      category: purchase.category,
      matchStore: storeForName(purchase.storeName),
      image: purchase.photoUri,
      meta: rankOf(purchase.id, purchase.category, rankings)
        ? `#${rankOf(purchase.id, purchase.category, rankings)} • ${scoreOf(purchase.id, purchase.category, rankings)} score`
        : "Awaiting rank",
      body: purchase.notes,
      onPress: destinationForStore(purchase.storeName),
    }));
    const wantRows = wants.map((want) => ({
      id: `want-${want.id}`,
      type: "Want to buy",
      title: want.itemName,
      subtitle: want.storeName,
      category: want.category,
      matchStore: storeForName(want.storeName),
      image: want.photoUri,
      meta: "Saved for later",
      body: want.notes,
      onPress: destinationForStore(want.storeName),
    }));
    const friendRows = friendFeed.map((event) => ({
      id: `friend-${event.id}`,
      type: `${event.actor}'s shelf`,
      title: event.itemName,
      subtitle: event.storeName,
      category: event.category,
      matchStore: storeForName(event.storeName),
      image: event.photoUri,
      meta: `#${event.rank} • ${event.score} score`,
      body: event.isLocalStore ? "Local store find" : undefined,
      onPress: destinationForStore(event.storeName, "feed"),
    }));
    const storeRows = stores.map((store) => ({
      id: `store-${store.id}`,
      type: "Nearby store",
      title: store.name,
      subtitle: `${store.neighborhood}, ${store.borough}`,
      category: store.category,
      matchStore: store,
      image: store.photoUri,
      meta: store.tags.join(" • "),
      body: store.description,
      onPress: () => setSelectedShop(store),
    }));

    const rows = [...purchaseRows, ...wantRows, ...friendRows, ...storeRows].filter((row) => {
      const styleMatch = storeMatchesStyle(row.matchStore?.tags ?? [], searchStyle);
      const priceMatch = searchPriceTiers.size === 0 || (!!row.matchStore && searchPriceTiers.has(row.matchStore.priceTier));
      const ratingMatch = searchMinRating === null || (!!row.matchStore && row.matchStore.rating * 2 > searchMinRating);
      const text = `${row.title} ${row.subtitle} ${row.meta} ${row.body ?? ""}`.toLowerCase();
      return styleMatch && priceMatch && ratingMatch && (!normalized || text.includes(normalized));
    });

    return (
      <View style={styles.searchScreen}>
        <View style={styles.searchHeaderRow}>
          <View>
            <Text style={styles.searchEyebrow}>Discover</Text>
            <Text style={styles.searchPageTitle}>Find something nearby</Text>
          </View>
          <Image source={require("./assets/icon-mark.png")} style={styles.searchLogoMark} resizeMode="contain" />
        </View>

        <View style={styles.searchBarActive}>
          <Ionicons name="search-outline" size={20} color={feedColors.teal} />
          <TextInput
            style={styles.searchBarInput}
            placeholder="Stores, members, or items"
            placeholderTextColor={feedColors.ink}
            value={searchTerm}
            onChangeText={setSearchTerm}
            autoFocus
            accessibilityLabel="Search stores, members, or items"
            returnKeyType="search"
          />
          {!!searchTerm && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" style={styles.searchClearButton} onPress={() => setSearchTerm("")}>
              <Ionicons name="close" size={16} color={feedColors.ink} />
            </Pressable>
          )}
        </View>

        <View style={styles.searchFilterRow}>
          <Pressable style={styles.filterButton} onPress={() => setActiveSearchFilter("type")}>
            <Text style={styles.filterButtonText} numberOfLines={1}>{searchStyle === "All" ? "Store type" : searchStyle}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.ink} />
          </Pressable>
          <Pressable style={styles.filterButton} onPress={() => setActiveSearchFilter("cost")}>
            <Text style={styles.filterButtonText} numberOfLines={1}>
              {searchPriceTiers.size === 0 ? "Cost" : [...searchPriceTiers].sort().map((tier) => "$".repeat(tier)).join(", ")}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.ink} />
          </Pressable>
          <Pressable style={styles.filterButton} onPress={() => setActiveSearchFilter("rating")}>
            <Text style={styles.filterButtonText} numberOfLines={1}>{searchMinRating === null ? "Rating" : `>${searchMinRating.toFixed(1)}`}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.ink} />
          </Pressable>
        </View>

        <Modal visible={activeSearchFilter !== null} transparent animationType="fade" onRequestClose={() => setActiveSearchFilter(null)}>
          <Pressable style={styles.filterModalBackdrop} onPress={() => setActiveSearchFilter(null)}>
            <Pressable style={styles.filterSheet} onPress={(event) => event.stopPropagation()}>
              {activeSearchFilter === "type" && (
                <>
                  <Text style={styles.filterSheetTitle}>Store Type</Text>
                  {(["All", ...STYLE_FILTERS] as (StyleFilter | "All")[]).map((option) => (
                    <Pressable
                      key={option}
                      style={styles.filterOptionRow}
                      onPress={() => {
                        setSearchStyle(option);
                        setActiveSearchFilter(null);
                      }}
                    >
                      <Text style={styles.filterOptionText}>{option}</Text>
                      {searchStyle === option && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                    </Pressable>
                  ))}
                </>
              )}
              {activeSearchFilter === "cost" && (
                <>
                  <Text style={styles.filterSheetTitle}>Cost</Text>
                  {([1, 2, 3, 4] as const).map((tier) => {
                    const active = searchPriceTiers.has(tier);
                    return (
                      <Pressable key={tier} style={styles.filterOptionRow} onPress={() => togglePriceTier(tier)}>
                        <Text style={styles.filterOptionText}>{"$".repeat(tier)}</Text>
                        {active && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                      </Pressable>
                    );
                  })}
                  <Pressable style={styles.filterDoneButton} onPress={() => setActiveSearchFilter(null)}>
                    <Text style={styles.filterDoneButtonText}>Done</Text>
                  </Pressable>
                </>
              )}
              {activeSearchFilter === "rating" && (
                <>
                  <Text style={styles.filterSheetTitle}>Store rating</Text>
                  {[null, 9, 8, 7, 6].map((threshold) => (
                    <Pressable
                      key={String(threshold)}
                      style={styles.filterOptionRow}
                      onPress={() => {
                        setSearchMinRating(threshold);
                        setActiveSearchFilter(null);
                      }}
                    >
                      <Text style={styles.filterOptionText}>{threshold === null ? "All ratings" : `>${threshold.toFixed(1)}`}</Text>
                      {searchMinRating === threshold && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                    </Pressable>
                  ))}
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        <View style={styles.searchResultsHeader}>
          <Text style={styles.searchSectionTitle}>{normalized ? `Results for “${searchTerm.trim()}”` : "Browse nearby"}</Text>
          <Text style={styles.searchCountText}>{rows.length} {rows.length === 1 ? "result" : "results"}</Text>
        </View>
        {rows.length === 0 ? (
          <EmptyState icon="search-outline" title="No matches yet" body="Try another category or log a purchase to build your searchable shelves." />
        ) : (
          <View style={styles.searchResultsList}>
            {rows.map((row, index) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.title}`}
                style={({ pressed }) => [styles.searchResultCard, index === rows.length - 1 && styles.searchResultCardLast, pressed && styles.searchResultCardPressed]}
                key={row.id}
                onPress={row.onPress}
              >
                <PhotoPreview uri={row.image} category={row.category} size="small" />
                <View style={styles.resultContent}>
                  <Text style={styles.searchResultType}>{row.type}</Text>
                  <Text style={styles.searchResultTitle} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.searchResultSubtitle} numberOfLines={1}>{row.subtitle}</Text>
                  <Text style={styles.searchResultMeta}>{row.meta}</Text>
                </View>
                <View style={styles.searchResultArrow}>
                  <Ionicons name="chevron-forward" size={15} color={feedColors.teal} />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderMap() {
    const categoryStores = stores
      .filter((store) => storeMatchesStyle(store.tags, mapStyle))
      .map((store) => ({ ...store, distance: distanceMiles(userLocation, store) }))
      .sort((a, b) => a.distance - b.distance);

    return (
      <View style={styles.mapScreen}>
        <View style={styles.mapHeaderCard}>
          <View style={styles.mapHeaderRow}>
            <View>
              <Text style={styles.cardKicker}>Nearby map</Text>
              <Text style={styles.cardTitle}>Stores around you</Text>
            </View>
            <Pressable style={styles.locateButton} onPress={requestLocation}>
              <Ionicons name="navigate-outline" size={18} color={colors.ink} />
              <Text style={styles.locateButtonText}>Near me</Text>
            </Pressable>
          </View>
          <Text style={styles.cardSubtitle}>{locationMessage}</Text>
          <StylePicker selected={mapStyle} onSelect={setMapStyle} compact />
        </View>

        <View style={styles.mapFill}>
          <NycMap stores={categoryStores} userLocation={userLocation} onSelectStore={setSelectedShop} />
        </View>
      </View>
    );
  }

  function renderShopDetail(store: Store) {
    const openMaps = () => {
      const query = encodeURIComponent(`${store.name} ${store.address}`);
      const url = Platform.OS === "ios" ? `maps:0,0?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
      Linking.openURL(url);
    };
    const shopFeed = feedEvents.filter((event) => event.storeName.toLowerCase() === store.name.toLowerCase());
    const shopWants = wants.filter((want) => want.storeName.toLowerCase() === store.name.toLowerCase());
    const isWantedStore = wantedStoreIds.has(store.id);

    return (
      <View style={styles.screen}>
        <Image source={{ uri: store.photoUri }} style={styles.shopHeroImage} resizeMode="cover" />
        <View style={styles.card}>
          <View style={styles.resultTopRow}>
            <Text style={styles.resultType}>{store.category}</Text>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={13} color={ratingColorFor(store.rating * 2)} />
              <Text style={[styles.ratingBadgeText, { color: ratingColorFor(store.rating * 2) }]}>{store.rating.toFixed(1)}</Text>
            </View>
          </View>
          <Text style={styles.cardTitle}>{store.name}</Text>
          <Text style={styles.cardSubtitle}>{store.neighborhood}, {store.borough}</Text>
          <Pressable style={styles.addressRow} onPress={openMaps}>
            <Ionicons name="location-outline" size={17} color={colors.accent} />
            <Text style={styles.addressText}>{store.address}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
          <Text style={styles.resultBody}>{store.description}</Text>
          <View style={styles.shopActionRow}>
            <Pressable style={styles.shopPrimaryAction} onPress={() => startLogFromStore(store)}>
              <Ionicons name="bag-add-outline" size={17} color="white" />
              <Text style={styles.shopPrimaryActionText}>Log purchase</Text>
            </Pressable>
            <Pressable style={styles.shopSecondaryAction} onPress={() => saveStoreWant(store)}>
              <Ionicons name={isWantedStore ? "bookmark" : "bookmark-outline"} size={17} color={colors.ink} />
              <Text style={styles.shopSecondaryActionText}>{isWantedStore ? "Wanted" : "Want"}</Text>
            </Pressable>
          </View>
          {store.link ? (
            <>
              <Pressable style={styles.shopOnlineAction} onPress={() => Linking.openURL(store.link!)}>
                <Ionicons name="storefront-outline" size={17} color={colors.ink} />
                <Text style={styles.shopSecondaryActionText}>Shop this store online</Text>
                <Ionicons name="open-outline" size={15} color={colors.muted} />
              </Pressable>
              <Text style={styles.shopCommissionNote}>NearBuy earns a small commission on online orders.</Text>
            </>
          ) : null}
          <View style={styles.tagRow}>
            {store.tags.map((tag) => (
              <Text key={tag} style={styles.tag}>{tag}</Text>
            ))}
          </View>
        </View>

        <SectionHeader title="Bought here" action={`${shopFeed.length} logged`} />
        {shopFeed.length === 0 ? (
          <EmptyState icon="bag-handle-outline" title="Nothing logged yet" body="No purchases have been logged at this store yet." />
        ) : (
          shopFeed.map((event) => (
            <FeedPostCard
              key={event.id}
              event={event}
              liked={likedPostIds.has(event.id)}
              onToggleLike={() => toggleLike(event.id)}
              onPressStore={() => setSelectedShop(store)}
              onComment={() => showToast("Comments are coming soon.")}
              onSend={() => showToast(`Send "${event.itemName}" to a friend — coming soon.`)}
            />
          ))
        )}

        <SectionHeader title="Want to buy here" action={`${shopWants.length} saved`} />
        {shopWants.length === 0 ? (
          <EmptyState icon="bookmark-outline" title="No wants saved" body="Tap Want to save this shop, or save a specific item from the Log tab." />
        ) : (
          shopWants.map((want) => <WantRow key={want.id} want={want} onBought={() => convertWantToDraft(want)} />)
        )}
      </View>
    );
  }

  function renderProfile() {
    if (profileSection) return renderProfileSection(profileSection);

    const streakWeeks = currentStreakWeeks(purchases);
    const shopCount = new Set(purchases.map((purchase) => purchase.storeName)).size;
    const yourRank = leaderboardRows.findIndex((row) => row.isYou) + 1;
    const yearCount = purchases.filter((purchase) => new Date(purchase.createdAt).getFullYear() === new Date().getFullYear()).length;
    const goalProgress = profile.goal2026 ? Math.min(100, Math.round((yearCount / profile.goal2026) * 100)) : 0;
    const photoTiles = topItems.filter((entry) => !!entry.purchase.photoUri).slice(0, 5);

    return (
      <View style={styles.homeScreen}>
        <View style={styles.homeTopRow}>
          <Image source={require("./assets/logo-horizontal.png")} style={styles.homeLogoHorizontal} resizeMode="contain" />
          <Pressable style={[styles.profileMenuButton, styles.profileMenuButtonFloating]} onPress={() => setProfileMenuVisible(true)} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={20} color={feedColors.ink} />
          </Pressable>
        </View>

        <View style={styles.profileHeader}>
          <Pressable onPress={openEditProfile}>
            {profile.avatarUri ? (
              <Image source={{ uri: profile.avatarUri }} style={styles.profileHeaderAvatar} />
            ) : (
              <View style={[styles.profileHeaderAvatar, styles.profileHeaderAvatarFallback]}>
                <Text style={styles.heroAvatarText}>{profile.name.trim()[0]?.toUpperCase() ?? "Y"}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileHeaderName}>{profile.name}</Text>
            <Text style={styles.profileHeaderSub}>@{profile.handle}</Text>
            <Pressable onPress={openEditProfile} hitSlop={8}>
              <Text style={styles.profileNeighborhoodLink}>{profile.neighborhood ? `📍 ${profile.neighborhood}` : "+ Add neighborhood"}</Text>
            </Pressable>
            <View style={styles.profileActionRow}>
              <Pressable style={styles.profileFollowButton} onPress={openEditProfile}>
                <Text style={styles.profileFollowButtonText}>Edit profile</Text>
              </Pressable>
              <Pressable style={styles.profileIconTarget} onPress={shareProfile} hitSlop={4}>
                <Ionicons name="paper-plane-outline" size={22} color={feedColors.teal} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.profileStatsRow}>
          <Pressable style={styles.profileStatItem} onPress={() => setProfileSection("bought")}>
            <Text style={styles.profileStatValue}>{purchases.length}</Text>
            <Text style={styles.profileStatLabel}>Bought</Text>
          </Pressable>
          <Pressable style={styles.profileStatItem} onPress={() => setFriendsModal("followers")}>
            <Text style={styles.profileStatValue}>{friendProfiles.length}</Text>
            <Text style={styles.profileStatLabel}>Followers</Text>
          </Pressable>
          <Pressable style={styles.profileStatItem} onPress={() => setFriendsModal("following")}>
            <Text style={styles.profileStatValue}>{friendProfiles.length}</Text>
            <Text style={styles.profileStatLabel}>Following</Text>
          </Pressable>
        </View>

        {photoTiles.length > 0 && (
          <>
            <View style={styles.profilePhotoGrid}>
              {photoTiles.map((entry, index) => (
                <Pressable
                  key={entry.purchase.id}
                  style={[styles.profilePhotoTile, index === photoTiles.length - 1 && photoTiles.length % 2 === 1 && styles.profilePhotoTileWide]}
                  onPress={() => openStoreByName(entry.purchase.storeName)}
                >
                  <Image source={{ uri: entry.purchase.photoUri }} style={styles.profilePhotoImage} resizeMode="cover" />
                  <View style={styles.profilePhotoBadge}>
                    <Text style={styles.profilePhotoBadgeText}>{entry.score}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.profileViewAll} onPress={() => setProfileSection("bought")}>
              <Text style={styles.profileAddLink}>View all finds →</Text>
            </Pressable>
          </>
        )}

        <View style={styles.moduleGrid}>
          <Pressable style={styles.moduleTile} onPress={() => setLeaderboardVisible(true)}>
            <Ionicons name="trophy" size={20} color={feedColors.teal} />
            <Text style={styles.moduleValue}>#{yourRank}</Text>
            <Text style={styles.moduleLabel}>Rank Nearby</Text>
          </Pressable>
          <Pressable style={styles.moduleTile} onPress={() => setProfileSection("recs")}>
            <Ionicons name="heart-circle" size={20} color={feedColors.teal} />
            <Text style={styles.moduleValue}>{recommendedStores.length}</Text>
            <Text style={styles.moduleLabel}>Recs for You</Text>
          </Pressable>
          <Pressable style={styles.moduleTile} onPress={() => setProfileSection("bought")}>
            <Ionicons name="flame" size={20} color={feedColors.teal} />
            <Text style={styles.moduleValue}>{streakWeeks}w</Text>
            <Text style={styles.moduleLabel}>Streak</Text>
          </Pressable>
        </View>

        <View style={styles.profileGoalCard}>
          {profile.goal2026 ? (
            <>
              <View style={styles.profileGoalHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.profileGoalTitle}>2026 goal: {profile.goal2026} local finds</Text>
                  <Text style={styles.profileGoalBody}>{yearCount} logged this year — {Math.max(profile.goal2026 - yearCount, 0)} to go.</Text>
                </View>
                <Text style={styles.profileGoalEmoji}>🏆</Text>
              </View>
              <View style={styles.goalProgressTrack}>
                <View style={[styles.goalProgressFill, { width: `${goalProgress}%` as `${number}%` }]} />
              </View>
              <Pressable onPress={() => setProfile(({ goal2026: _dropped, ...rest }) => rest)} hitSlop={8}>
                <Text style={styles.profileAddLink}>Change goal</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.profileGoalHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.profileGoalTitle}>Set your 2026 goal</Text>
                  <Text style={styles.profileGoalBody}>
                    You bought from {shopCount} shops so far.{"\n"}How many local finds do you want in 2026?
                  </Text>
                </View>
                <Text style={styles.profileGoalEmoji}>🏆</Text>
              </View>
              <View style={styles.profileGoalPillRow}>
                {[20, 50, 100].map((goal) => (
                  <Pressable key={goal} style={styles.profileGoalPill} onPress={() => setYearGoal(goal)}>
                    <Text style={styles.profileGoalPillText}>{goal}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.profileGoalPill} onPress={() => setCustomGoalOpen((open) => !open)}>
                  <Text style={styles.profileGoalPillText}>Customize</Text>
                </Pressable>
              </View>
              {customGoalOpen && (
                <View style={styles.customGoalRow}>
                  <TextInput
                    style={[styles.input, styles.flexOne]}
                    placeholder="e.g. 75"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    value={customGoalValue}
                    onChangeText={setCustomGoalValue}
                  />
                  <Pressable
                    style={styles.customGoalButton}
                    onPress={() => {
                      const parsed = Number(customGoalValue);
                      if (!Number.isInteger(parsed) || parsed <= 0) {
                        showToast("Enter a whole number above zero.");
                        return;
                      }
                      setYearGoal(parsed);
                    }}
                  >
                    <Text style={styles.primaryButtonText}>Set</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </View>

        <SectionHeader title="Lifetime worth-it list" action="Top scores" />
        {topItems.map((entry, index) => (
          <RankedRow
            key={entry.purchase.id}
            purchase={entry.purchase}
            rank={entry.rank}
            score={entry.score}
            eyebrow={`#${index + 1} overall`}
          />
        ))}

      </View>
    );
  }

  function renderProfileSection(section: ProfileSection) {
    const titles: Record<ProfileSection, string> = { bought: "Bought", recs: "Recs for You" };
    return (
      <View style={styles.homeScreen}>
        <Pressable style={styles.backRow} onPress={() => setProfileSection(null)} hitSlop={8}>
          <View style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </View>
          <Text style={styles.profileSectionTitle}>{titles[section]}</Text>
        </Pressable>

        {section === "bought" && (
          <>
            {CATEGORIES.map((category) => {
              const ranked = rankedPurchasesForCategory(category, purchases, rankings);
              if (ranked.length === 0) return null;
              return (
                <View key={category} style={styles.shelfCard}>
                  <View style={styles.shelfHeader}>
                    <Text style={styles.shelfTitle}>{category}</Text>
                    <Text style={styles.shelfCount}>{ranked.length} ranked</Text>
                  </View>
                  {ranked.map((purchase, index) => (
                    <RankedRow key={purchase.id} purchase={purchase} rank={index + 1} score={scoreForRank(index, rankings[category].length)} />
                  ))}
                </View>
              );
            })}
            {purchases.length === 0 && (
              <EmptyState icon="bag-handle-outline" title="Nothing bought yet" body="Log a purchase from the Add tab to start your ranked shelves." />
            )}
          </>
        )}

        {section === "recs" &&
          (recommendedStores.length === 0 ? (
            <EmptyState icon="heart-outline" title="No recs yet" body="You have bought from every nearby store already. Log more finds to unlock new recs." />
          ) : (
            recommendedStores.map(({ store, match }) => (
              <Pressable key={store.id} style={styles.resultCard} onPress={() => setSelectedShop(store)}>
                <PhotoPreview uri={store.photoUri} category={store.category} size="small" />
                <View style={styles.resultContent}>
                  <Text style={styles.resultType}>{match}% match</Text>
                  <Text style={styles.resultTitle}>{store.name}</Text>
                  <Text style={styles.resultSubtitle}>{store.neighborhood}, {store.borough}</Text>
                  <Text style={styles.resultMeta}>{store.tags.join(" • ")}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))
          ))}
      </View>
    );
  }

  const activeTab = tabs.find((tab) => tab.key === selectedTab) ?? tabs[0];
  const currentComparisonItem = comparison ? purchasesById.get(rankings[comparison.category][comparison.mid]) : undefined;
  const newComparisonItem = comparison ? purchasesById.get(comparison.newPurchaseId) : undefined;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.outerShell}>
        <View style={styles.appShell}>
          {(selectedShop || (selectedTab !== "feed" && selectedTab !== "search" && selectedTab !== "profile")) && (
            <View style={styles.topBar}>
              {selectedShop ? (
                <Pressable style={styles.backRow} onPress={() => setSelectedShop(null)}>
                  <View style={styles.backButton}>
                    <Ionicons name="chevron-back" size={20} color={colors.ink} />
                  </View>
                  <Text style={styles.appContext} numberOfLines={1}>{selectedShop.name}</Text>
                </Pressable>
              ) : selectedTab === "add" || selectedTab === "search" || selectedTab === "map" ? (
                <View style={styles.topBarLogoWrap}>
                  <Image source={require("./assets/logo-horizontal.png")} style={styles.topBarLogo} resizeMode="contain" />
                </View>
              ) : (
                <View>
                  <BrandMark />
                  <Text style={styles.appContext}>{activeTab.label}</Text>
                </View>
              )}
            </View>
          )}

          {!selectedShop && selectedTab === "map" ? (
            <View style={styles.content}>{renderMap()}</View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
              {selectedShop ? renderShopDetail(selectedShop) : renderBody()}
            </ScrollView>
          )}

          <View style={styles.tabBar}>
            {tabs.map((tab) => {
              const isActive = selectedTab === tab.key;
              const isAddTab = tab.key === "add";
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tabItem, isActive && styles.tabItemActive, isAddTab && styles.tabItemAdd]}
                  onPress={() => {
                    setSelectedShop(null);
                    setProfileSection(null);
                    setSelectedTab(tab.key);
                  }}
                >
                  <Ionicons name={tab.icon as keyof typeof Ionicons.glyphMap} size={isAddTab ? 24 : 21} color={isAddTab ? "white" : isActive ? colors.ink : colors.muted} />
                  <Text style={[styles.tabText, isAddTab && styles.tabTextAdd, isActive && !isAddTab && styles.tabTextActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {!!toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <Modal visible={profileMenuVisible} animationType="fade" transparent onRequestClose={() => setProfileMenuVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setProfileMenuVisible(false)}>
          <View style={styles.compareSheet}>
            <View style={styles.compareHandle} />
            <Pressable style={styles.menuRow} onPress={openEditProfile}>
              <Ionicons name="create-outline" size={20} color={colors.ink} />
              <Text style={styles.menuRowText}>Edit profile</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={shareProfile}>
              <Ionicons name="share-outline" size={20} color={colors.ink} />
              <Text style={styles.menuRowText}>Share profile</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                setProfileMenuVisible(false);
                resetDemoData();
              }}
            >
              <Ionicons name="refresh-outline" size={20} color={feedColors.teal} />
              <Text style={styles.menuRowText}>Reset app data</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={editingProfile} animationType="slide" transparent onRequestClose={() => setEditingProfile(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.compareSheet}>
            <View style={styles.compareHandle} />
            <Text style={styles.cardTitle}>Edit profile</Text>
            <View style={styles.editAvatarRow}>
              {editDraft.avatarUri ? (
                <Image source={{ uri: editDraft.avatarUri }} style={styles.editAvatarPreview} />
              ) : (
                <View style={[styles.editAvatarPreview, styles.editAvatarPlaceholder]}>
                  <Text style={styles.profileAvatarText}>{editDraft.name.trim()[0]?.toUpperCase() ?? "?"}</Text>
                </View>
              )}
              <Pressable style={styles.secondaryButton} onPress={pickAvatar}>
                <Ionicons name="images-outline" size={18} color={colors.ink} />
                <Text style={styles.secondaryButtonText}>Choose photo</Text>
              </Pressable>
            </View>
            <FormLabel label="Name" />
            <TextInput style={styles.input} value={editDraft.name} onChangeText={(name) => setEditDraft((current) => ({ ...current, name }))} />
            <FormLabel label="Handle" />
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              value={editDraft.handle}
              onChangeText={(handle) => setEditDraft((current) => ({ ...current, handle }))}
            />
            <FormLabel label="Neighborhood" />
            <TextInput
              style={styles.input}
              placeholder="e.g. Union Square"
              placeholderTextColor={colors.muted}
              value={editDraft.neighborhood}
              onChangeText={(neighborhood) => setEditDraft((current) => ({ ...current, neighborhood }))}
            />
            <View style={styles.profileButtonRow}>
              <Pressable style={styles.profilePillButton} onPress={() => setEditingProfile(false)}>
                <Text style={styles.profilePillButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.profilePillButton, styles.profilePillPrimary]} onPress={saveProfile}>
                <Text style={[styles.profilePillButtonText, styles.profilePillPrimaryText]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!friendsModal} animationType="slide" transparent onRequestClose={() => setFriendsModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.compareSheet}>
            <View style={styles.compareHandle} />
            <Text style={styles.cardTitle}>{friendsModal === "followers" ? "Followers" : "Following"}</Text>
            <Text style={styles.cardSubtitle}>Tap a friend to visit the shop behind their latest ranked find.</Text>
            {friendProfiles.map((friend) => (
              <Pressable
                key={friend.actor}
                style={styles.friendRow}
                onPress={() => {
                  setFriendsModal(null);
                  openStoreByName(friend.storeName);
                }}
              >
                <View style={styles.feedAvatar}>
                  <Text style={styles.feedAvatarText}>{friend.avatar}</Text>
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.rankedTitle}>{friend.actor}</Text>
                  <Text style={styles.rankedMeta}>Latest: {friend.itemName} #{friend.rank} at {friend.storeName}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
            <Pressable style={styles.profilePillButton} onPress={() => setFriendsModal(null)}>
              <Text style={styles.profilePillButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={leaderboardVisible} animationType="slide" transparent onRequestClose={() => setLeaderboardVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.compareSheet}>
            <View style={styles.compareHandle} />
            <Text style={styles.cardTitle}>Rank Nearby</Text>
            <Text style={styles.cardSubtitle}>Ranked by items placed on shelves. Log and rank more finds to climb.</Text>
            {leaderboardRows.map((row, index) => (
              <View key={row.name} style={[styles.friendRow, row.isYou && styles.leaderRowYou]}>
                <Text style={styles.leaderRank}>#{index + 1}</Text>
                <View style={styles.feedAvatar}>
                  <Text style={styles.feedAvatarText}>{row.avatar}</Text>
                </View>
                <Text style={[styles.rankedTitle, styles.flexOne]}>{row.name}</Text>
                <Text style={styles.rankedMeta}>{row.count} ranked</Text>
              </View>
            ))}
            <Pressable style={styles.profilePillButton} onPress={() => setLeaderboardVisible(false)}>
              <Text style={styles.profilePillButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!comparison && !!currentComparisonItem && !!newComparisonItem} animationType="slide" transparent onRequestClose={skipComparisonToBottom}>
        <View style={styles.modalBackdrop}>
          <View style={styles.compareSheet}>
            {!!comparison && !!currentComparisonItem && !!newComparisonItem && (
              <>
                <View style={styles.compareHandle} />
                <Text style={styles.cardKicker}>Rank {comparison.category}</Text>
                <Text style={styles.compareTitle}>Which item would you rather have?</Text>
                <Text style={styles.compareSubtitle}>
                  Tap the item you prefer. Comparison {comparison.comparisons + 1} narrows the shelf using binary insertion.
                </Text>

                <View style={styles.compareItemsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${newComparisonItem.itemName}`}
                    style={({ pressed }) => [styles.compareItemCard, styles.compareItemCardPressable, pressed && styles.compareItemCardPressed]}
                    onPress={() => answerComparison(true)}
                  >
                    <Text style={styles.compareLabel}>New</Text>
                    <PhotoPreview uri={newComparisonItem.photoUri} category={newComparisonItem.category} size="medium" />
                    <Text style={styles.compareItemTitle}>{newComparisonItem.itemName}</Text>
                    <Text style={styles.compareStore}>{newComparisonItem.storeName}</Text>
                    <Text style={styles.compareTapHint}>Tap to rank higher</Text>
                  </Pressable>
                  <View style={styles.compareVersus}>
                    <Text style={styles.compareVersusText}>vs</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${currentComparisonItem.itemName}`}
                    style={({ pressed }) => [styles.compareItemCard, styles.compareItemCardPressable, pressed && styles.compareItemCardPressed]}
                    onPress={() => answerComparison(false)}
                  >
                    <Text style={styles.compareLabel}>Current #{comparison.mid + 1}</Text>
                    <PhotoPreview uri={currentComparisonItem.photoUri} category={currentComparisonItem.category} size="medium" />
                    <Text style={styles.compareItemTitle}>{currentComparisonItem.itemName}</Text>
                    <Text style={styles.compareStore}>{currentComparisonItem.storeName}</Text>
                    <Text style={styles.compareTapHint}>Tap to keep higher</Text>
                  </Pressable>
                </View>

                <Pressable style={styles.skipButton} onPress={skipComparisonToBottom}>
                  <Text style={styles.skipButtonText}>Skip and place at bottom</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function BrandMark({ size = "default" }: { size?: "default" | "large" }) {
  const isLarge = size === "large";
  return (
    <View style={styles.brandRow}>
      <Image source={require("./assets/logo.png")} style={isLarge ? styles.brandLogoLarge : styles.brandLogo} resizeMode="contain" />
      <View style={styles.brandChip}>
        <Text style={[styles.brandText, isLarge && styles.brandTextLarge]}>
          <Text style={styles.brandNear}>Near</Text>
          <Text style={styles.brandBuy}>Buy</Text>
        </Text>
      </View>
    </View>
  );
}

function FeaturedRow({ title, stores: featuredStores, onSelect }: { title: string; stores: Store[]; onSelect: (store: Store) => void }) {
  if (featuredStores.length === 0) return null;
  return (
    <View style={styles.featuredSection}>
      <Text style={styles.featuredTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredRow}>
        {featuredStores.map((store) => (
          <Pressable key={store.id} style={styles.featuredCard} onPress={() => onSelect(store)}>
            <Image source={{ uri: store.photoUri }} style={styles.featuredImage} resizeMode="cover" />
            <Text style={styles.featuredCardName} numberOfLines={1}>{store.name}</Text>
            <View style={styles.featuredCardMeta}>
              <Text style={styles.featuredPrice}>{"$".repeat(store.priceTier)}</Text>
              <View style={styles.featuredRatingRow}>
                <Ionicons name="star" size={11} color={feedColors.teal} />
                <Text style={styles.featuredRatingText}>{store.rating.toFixed(1)}</Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ratingColorFor(score: number) {
  if (score >= 7) return colors.ratingGood;
  if (score >= 4) return colors.ratingMid;
  return colors.ratingBad;
}

function storeMatchesStyle(tags: string[], style: StyleFilter | "All") {
  if (style === "All") return true;
  return tags.some((tag) => tag.toLowerCase() === style.toLowerCase());
}

function FeedPostCard({
  event,
  liked,
  onToggleLike,
  onPressStore,
  onComment,
  onSend,
}: {
  event: FeedEvent;
  liked: boolean;
  onToggleLike: () => void;
  onPressStore: () => void;
  onComment: () => void;
  onSend: () => void;
}) {
  const store = stores.find((candidate) => candidate.name.toLowerCase() === event.storeName.toLowerCase());
  const location = store ? `${store.borough}, NY` : undefined;
  const gallery = [event.photoUri, ...(store?.galleryPhotos ?? [])]
    .filter((uri): uri is string => !!uri)
    .filter((uri, index, all) => all.indexOf(uri) === index)
    .slice(0, 3);

  return (
    <View style={styles.postCard}>
      <View style={styles.postHeaderRow}>
        <Image source={{ uri: event.avatarUri }} style={styles.postAvatar} />
        <View style={styles.postHeaderText}>
          <Text style={styles.postActorLine}>
            <Text style={styles.postActor}>{event.actor}</Text> ranked {event.itemName} #{event.rank}
          </Text>
          <Pressable onPress={onPressStore}>
            <Text style={styles.postLocation}>
              {event.storeName}
              {location ? ` • ${location}` : ""}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.postRating, { color: ratingColorFor(event.score) }]}>{event.score.toFixed(1)}</Text>
      </View>

      {gallery.length > 0 && (
        <View style={styles.postGallery}>
          {gallery.map((uri, index) => (
            <Image key={`${event.id}-${index}`} source={{ uri }} style={styles.postGalleryImage} resizeMode="cover" />
          ))}
        </View>
      )}

      {!!event.notes && <Text style={styles.postNotes}>{event.notes}</Text>}

      <View style={styles.postActionsRow}>
        <Pressable style={styles.postActionButton} onPress={onToggleLike}>
          <Ionicons name={liked ? "heart" : "heart-outline"} size={20} color={liked ? colors.ratingBad : feedColors.teal} />
        </Pressable>
        <Pressable style={styles.postActionButton} onPress={onComment}>
          <Ionicons name="chatbubble-outline" size={19} color={feedColors.teal} />
        </Pressable>
        <Pressable style={styles.postActionButton} onPress={onSend}>
          <Ionicons name="paper-plane-outline" size={19} color={feedColors.teal} />
        </Pressable>
      </View>

      <Text style={styles.postTimestamp}>{timeAgo(event.createdAt)}</Text>
    </View>
  );
}

function StylePicker({
  selected,
  onSelect,
  includeAll = true,
  compact,
}: {
  selected: StyleFilter | "All";
  onSelect: (style: StyleFilter | "All") => void;
  includeAll?: boolean;
  compact?: boolean;
}) {
  const values: (StyleFilter | "All")[] = includeAll ? ["All", ...STYLE_FILTERS] : [...STYLE_FILTERS];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.categoryRow, compact && styles.categoryRowCompact]}>
      {values.map((style) => {
        const active = selected === style;
        return (
          <Pressable key={style} style={[styles.categoryPill, active && styles.categoryPillActive]} onPress={() => onSelect(style)}>
            <Text style={[styles.categoryPillText, active && styles.categoryPillTextActive]}>{style}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PhotoPreview({ uri, size }: { uri?: string; category: Category; size: "small" | "medium" | "large" }) {
  const dimensions = size === "large" ? styles.photoLarge : size === "medium" ? styles.photoMedium : styles.photoSmall;
  const iconSize = size === "large" ? 34 : size === "medium" ? 26 : 20;
  if (uri) {
    return <Image source={{ uri }} style={[styles.photoBase, dimensions]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.photoBase, dimensions, styles.photoPlaceholder]}>
      <Ionicons name="shirt-outline" size={iconSize} color={colors.muted} />
    </View>
  );
}

function FormLabel({ label }: { label: string }) {
  return <Text style={styles.formLabel}>{label}</Text>;
}

function StatCard({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.statCard}>
      {!!icon && <Ionicons name={icon} size={16} color={colors.accent} style={styles.statIcon} />}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!action && <Text style={styles.sectionAction}>{action}</Text>}
    </View>
  );
}

function FeedCard({ event, onPress }: { event: FeedEvent; onPress?: () => void }) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.feedCard} {...(onPress ? { onPress } : {})}>
      <View style={styles.feedAvatar}>
        <Text style={styles.feedAvatarText}>{event.avatar}</Text>
      </View>
      <PhotoPreview uri={event.photoUri} category={event.category} size="small" />
      <View style={styles.feedContent}>
        <Text style={styles.feedTitle}>
          <Text style={styles.feedActor}>{event.actor}</Text> ranked {event.itemName} #{event.rank}
        </Text>
        <Text style={styles.feedMeta}>
          {event.storeName} • {timeAgo(event.createdAt)}
        </Text>
        {event.isLocalStore && <Text style={styles.localChip}>Local store find</Text>}
      </View>
      <View style={styles.feedScorePill}>
        <Text style={styles.feedScoreValue}>{event.score}</Text>
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
    </Wrapper>
  );
}

function RankedRow({ purchase, rank, score, eyebrow }: { purchase: Purchase; rank: number; score: number; eyebrow?: string }) {
  return (
    <View style={styles.rankedRow}>
      <View style={styles.rankBubble}>
        <Text style={styles.rankBubbleText}>{rank}</Text>
      </View>
      <PhotoPreview uri={purchase.photoUri} category={purchase.category} size="small" />
      <View style={styles.rankedContent}>
        {!!eyebrow && <Text style={styles.resultType}>{eyebrow}</Text>}
        <Text style={styles.rankedTitle}>{purchase.itemName}</Text>
        <Text style={styles.rankedMeta}>{purchase.storeName} • {formatPrice(purchase.price)}</Text>
      </View>
      <View style={styles.scorePill}>
        <Text style={styles.scoreText}>{score}</Text>
      </View>
    </View>
  );
}

function WantRow({ want, onBought }: { want: WantedItem; onBought: () => void }) {
  return (
    <View style={styles.wantRow}>
      <PhotoPreview uri={want.photoUri} category={want.category} size="small" />
      <View style={styles.rankedContent}>
        <Text style={styles.resultType}>Want to buy</Text>
        <Text style={styles.rankedTitle}>{want.itemName}</Text>
        <Text style={styles.rankedMeta}>{want.storeName} • saved {timeAgo(want.createdAt)}</Text>
        {!!want.notes && <Text style={styles.wantNote}>{want.notes}</Text>}
      </View>
      <Pressable style={styles.boughtButtonSmall} onPress={onBought}>
        <Ionicons name="checkmark" size={16} color="white" />
      </Pressable>
    </View>
  );
}

function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={32} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function formatPrice(price?: number) {
  if (!price) return "No price";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: price % 1 === 0 ? 0 : 2 }).format(price);
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  appText: {
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  outerShell: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  appShell: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.background,
  },
  topBar: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topBarLogoWrap: {
    flex: 1,
    alignItems: "center",
  },
  topBarLogo: {
    height: 34,
    aspectRatio: 1023 / 343,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  brandLogoLarge: {
    width: 46,
    height: 46,
    borderRadius: 13,
  },
  brandChip: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  brandText: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  brandTextLarge: {
    fontSize: 24,
  },
  brandNear: {
    color: "white",
  },
  brandBuy: {
    color: colors.accent,
  },
  appContext: {
    color: colors.muted,
    marginTop: 2,
    fontWeight: "700",
    flexShrink: 1,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 14,
    backgroundColor: colors.soft2,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 28,
  },
  screen: {
    gap: 16,
  },
  homeScreen: {
    gap: 16,
    paddingTop: 8,
  },
  searchScreen: {
    gap: layout.sectionGap,
    paddingTop: 18,
    backgroundColor: feedColors.background,
  },
  searchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  searchEyebrow: {
    color: feedColors.teal,
    fontFamily: fonts.black,
    fontWeight: "900",
    fontSize: 12,
    marginBottom: 4,
  },
  searchPageTitle: {
    color: feedColors.ink,
    fontFamily: fonts.black,
    fontWeight: "900",
    fontSize: 25,
    letterSpacing: -0.7,
  },
  searchLogoMark: {
    width: 42,
    height: 48,
  },
  homeSearchBar: {
    backgroundColor: feedColors.tealSoft,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: 18,
    minHeight: 52,
    justifyContent: "center",
  },
  homeSearchBarActive: {
    backgroundColor: colors.surface,
    borderColor: feedColors.teal,
    shadowColor: feedColors.teal,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  homeSearchPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  homeSearchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  homeSearchInput: {
    flex: 1,
    color: feedColors.ink,
    fontFamily: fonts.semiBold,
    fontSize: 16,
    fontWeight: "700",
    paddingVertical: 4,
  },
  homeSearchText: {
    color: feedColors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  homeSearchCancelText: {
    color: feedColors.teal,
    fontSize: 14,
    fontWeight: "900",
  },
  homeSearchHelper: {
    overflow: "hidden",
    marginTop: -8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  homeSearchHelperText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  homeSearchHelperButton: {
    borderRadius: 999,
    backgroundColor: feedColors.teal,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  homeSearchHelperButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  searchBarActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: feedColors.tealSoft,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: layout.controlRadius,
    paddingHorizontal: 14,
    minHeight: layout.controlHeight,
  },
  searchBarInput: {
    flex: 1,
    color: feedColors.ink,
    fontFamily: fonts.semiBold,
    fontSize: 15,
    paddingVertical: 11,
  },
  searchClearButton: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchResultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  searchSectionTitle: {
    color: feedColors.ink,
    fontFamily: fonts.black,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: -0.3,
  },
  searchCountText: {
    color: feedColors.ink,
    fontFamily: fonts.semiBold,
    fontWeight: "700",
    fontSize: 12,
    opacity: 0.55,
  },
  searchResultsList: {
    overflow: "hidden",
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: layout.contentRadius,
  },
  searchResultCard: {
    backgroundColor: feedColors.background,
    borderBottomWidth: 1,
    borderBottomColor: feedColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchResultCardLast: {
    borderBottomWidth: 0,
  },
  searchResultCardPressed: {
    backgroundColor: feedColors.tealSoft,
  },
  searchResultType: {
    color: feedColors.teal,
    fontFamily: fonts.black,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  searchCategoryBadge: {
    color: feedColors.ink,
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: "800",
    opacity: 0.56,
  },
  searchResultTitle: {
    color: feedColors.ink,
    fontFamily: fonts.extraBold,
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: -0.2,
  },
  searchResultSubtitle: {
    color: feedColors.teal,
    fontFamily: fonts.semiBold,
    fontWeight: "700",
    fontSize: 12,
  },
  searchResultMeta: {
    color: feedColors.ink,
    fontFamily: fonts.bold,
    fontWeight: "800",
    fontSize: 11,
  },
  searchResultArrow: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: 22,
    backgroundColor: feedColors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  homeTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  homeLogoHorizontal: {
    height: 44,
    aspectRatio: 1023 / 343,
  },
  featuredSection: {
    gap: 10,
  },
  featuredTitle: {
    color: feedColors.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  featuredRow: {
    gap: 12,
    paddingRight: 4,
  },
  featuredCard: {
    width: 140,
    gap: 4,
  },
  featuredImage: {
    width: 140,
    height: 100,
    borderRadius: 16,
    backgroundColor: feedColors.tealSoft,
  },
  featuredCardName: {
    color: feedColors.ink,
    fontWeight: "900",
    fontSize: 13,
    marginTop: 4,
  },
  featuredCardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  featuredPrice: {
    color: feedColors.teal,
    fontWeight: "900",
    fontSize: 12,
  },
  featuredRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  featuredRatingText: {
    color: feedColors.ink,
    fontWeight: "800",
    fontSize: 12,
  },
  postCard: {
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: 24,
    padding: 14,
    gap: 10,
  },
  postHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  postAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: feedColors.tealSoft,
  },
  postHeaderText: {
    flex: 1,
    gap: 2,
  },
  postActorLine: {
    color: feedColors.ink,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  postActor: {
    fontWeight: "900",
  },
  postLocation: {
    color: feedColors.teal,
    fontSize: 12,
    fontWeight: "700",
  },
  postRating: {
    fontSize: 18,
    fontWeight: "900",
  },
  postGallery: {
    flexDirection: "row",
    gap: 6,
  },
  postGalleryImage: {
    flex: 1,
    height: 110,
    borderRadius: 14,
    backgroundColor: feedColors.tealSoft,
  },
  postNotes: {
    color: feedColors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  postActionsRow: {
    flexDirection: "row",
    gap: 18,
  },
  postActionButton: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  postTimestamp: {
    color: feedColors.ink,
    fontSize: 11,
    fontWeight: "700",
    opacity: 0.6,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 30,
    padding: 20,
    gap: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroBadgeText: {
    color: colors.ink,
    fontWeight: "900",
    fontSize: 12,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 32,
    lineHeight: 35,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
  },
  matchScoreBadge: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 66,
    borderRadius: 18,
    backgroundColor: colors.ink,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  matchScoreValue: {
    color: "white",
    fontWeight: "900",
    fontSize: 17,
  },
  matchScoreLabel: {
    color: colors.soft,
    fontWeight: "800",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  beliPathRow: {
    flexDirection: "row",
    gap: 8,
  },
  beliPathStep: {
    flex: 1,
    backgroundColor: colors.soft2,
    borderRadius: 17,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  beliPathNumber: {
    color: colors.accent,
    fontWeight: "900",
    fontSize: 17,
  },
  beliPathLabel: {
    color: colors.ink,
    fontWeight: "900",
    marginTop: 2,
    fontSize: 12,
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.soft2,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIcon: {
    marginBottom: 4,
  },
  statValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  statLabel: {
    color: colors.muted,
    marginTop: 2,
    fontWeight: "700",
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: colors.accent,
    shadowOpacity: 0.23,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
  },
  homeActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  homeActionButton: {
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: colors.soft,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButtonWide: {
    backgroundColor: colors.soft,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontWeight: "900",
  },
  ghostButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostButtonText: {
    color: colors.accent,
    fontWeight: "900",
  },
  sectionHeader: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  sectionAction: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  feedCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedAvatar: {
    width: 34,
    height: 34,
    borderRadius: 13,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  feedAvatarText: {
    color: "white",
    fontWeight: "900",
  },
  feedContent: {
    flex: 1,
    gap: 3,
  },
  feedTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  feedActor: {
    fontWeight: "900",
  },
  feedMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  feedScorePill: {
    minWidth: 44,
    borderRadius: 999,
    backgroundColor: colors.ink,
    paddingHorizontal: 9,
    paddingVertical: 7,
    alignItems: "center",
  },
  feedScoreValue: {
    color: "white",
    fontWeight: "900",
    fontSize: 13,
  },
  localChip: {
    alignSelf: "flex-start",
    overflow: "hidden",
    backgroundColor: colors.greenSoft,
    color: colors.green,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardKicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 25,
    lineHeight: 29,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  photoPickerRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  photoActions: {
    flex: 1,
    gap: 8,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: colors.soft2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 11,
  },
  segmentButtonActive: {
    backgroundColor: colors.ink,
  },
  segmentText: {
    color: colors.ink,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: "white",
  },
  photoBase: {
    backgroundColor: colors.soft,
    borderRadius: 18,
  },
  photoLarge: {
    width: 128,
    height: 128,
  },
  photoMedium: {
    width: 104,
    height: 104,
  },
  photoSmall: {
    width: 58,
    height: 58,
    borderRadius: 16,
  },
  photoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  formLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.ink,
    fontFamily: fonts.semiBold,
    fontWeight: "700",
    fontSize: 15,
  },
  inputSpacing: {
    marginTop: -6,
  },
  storeLookupRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  storeLookupInput: {
    flex: 1,
  },
  storeLookupButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: feedColors.teal,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  storeLookupButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  placeSearchBackdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 33, 27, 0.45)",
    justifyContent: "flex-end",
  },
  placeSearchSheet: {
    maxHeight: "82%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    gap: 12,
  },
  placeSearchHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  placeSearchSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 10,
  },
  placeSearchCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: colors.soft2,
    alignItems: "center",
    justifyContent: "center",
  },
  placeSearchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  placeSearchInput: {
    flex: 1,
  },
  placeSearchButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  placeSearchButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  placeSearchHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  placeSearchError: {
    color: colors.ratingBad,
    fontSize: 13,
    fontWeight: "800",
  },
  placeSearchResults: {
    maxHeight: 360,
  },
  placeResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  placeResultIcon: {
    width: 38,
    height: 38,
    borderRadius: 15,
    backgroundColor: feedColors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  placeResultContent: {
    flex: 1,
  },
  placeResultTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  placeResultSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  placeSearchEmpty: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    paddingVertical: 24,
  },
  textArea: {
    minHeight: 86,
    textAlignVertical: "top",
  },
  searchInput: {
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 14,
    color: colors.ink,
    fontFamily: fonts.bold,
    fontWeight: "800",
    fontSize: 16,
  },
  searchFilterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    minHeight: layout.touchTarget,
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  filterButtonText: {
    flex: 1,
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
  },
  filterModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 33, 27, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  filterSheet: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 10,
    gap: 2,
  },
  filterSheetTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  filterOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 12,
  },
  filterOptionText: {
    color: colors.ink,
    fontWeight: "700",
    fontSize: 15,
  },
  filterDoneButton: {
    marginTop: 6,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  filterDoneButtonText: {
    color: "white",
    fontWeight: "900",
  },
  twoColumnRow: {
    flexDirection: "row",
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  categoryRow: {
    gap: 8,
    paddingVertical: 2,
  },
  categoryRowCompact: {
    paddingVertical: 8,
  },
  categoryPill: {
    borderRadius: 999,
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  categoryPillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  categoryPillText: {
    color: colors.ink,
    fontWeight: "900",
    fontSize: 13,
  },
  categoryPillTextActive: {
    color: "white",
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 12,
    flexDirection: "row",
    gap: 12,
  },
  resultCardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  resultChevron: {
    alignSelf: "center",
  },
  resultContent: {
    flex: 1,
    gap: 3,
  },
  resultTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  resultType: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  categoryBadge: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  resultTitle: {
    color: colors.ink,
    fontWeight: "900",
    fontSize: 17,
    letterSpacing: -0.2,
  },
  resultSubtitle: {
    color: colors.muted,
    fontWeight: "700",
  },
  resultMeta: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 12,
  },
  resultBody: {
    color: colors.muted,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 3,
  },
  mapScreen: {
    flex: 1,
  },
  mapHeaderCard: {
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  mapFill: {
    flex: 1,
  },
  mapHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  locateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.soft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  locateButtonText: {
    color: colors.ink,
    fontWeight: "900",
    fontSize: 12,
  },
  shopHeroImage: {
    width: "100%",
    height: 200,
    borderRadius: 24,
    backgroundColor: colors.soft,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ratingBadgeText: {
    color: colors.accentDark,
    fontWeight: "900",
    fontSize: 12,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  addressText: {
    flex: 1,
    color: colors.ink,
    fontWeight: "700",
  },
  shopActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  shopPrimaryAction: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  shopPrimaryActionText: {
    color: "white",
    fontWeight: "900",
  },
  shopSecondaryAction: {
    minWidth: 110,
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  shopSecondaryActionText: {
    color: colors.ink,
    fontWeight: "900",
  },
  shopOnlineAction: {
    backgroundColor: colors.soft2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  shopCommissionNote: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    marginTop: -4,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  tag: {
    color: colors.muted,
    backgroundColor: colors.soft2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "800",
  },
  heroAvatarText: {
    color: "white",
    fontSize: 26,
    fontWeight: "900",
  },
  moduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  moduleTile: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: 20,
    padding: 14,
    gap: 3,
  },
  moduleValue: {
    color: feedColors.ink,
    fontSize: 22,
    fontWeight: "900",
  },
  moduleLabel: {
    color: "#7C8DA0",
    fontSize: 12,
    fontWeight: "700",
  },
  profileMenuButtonFloating: {
    position: "absolute",
    right: 0,
  },
  profileMenuButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: feedColors.border,
    backgroundColor: feedColors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 2,
  },
  profileHeaderAvatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
  },
  profileHeaderAvatarFallback: {
    backgroundColor: feedColors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  profileHeaderName: {
    color: feedColors.ink,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  profileHeaderSub: {
    color: "#7C8DA0",
    fontSize: 14,
    fontWeight: "600",
  },
  profileNeighborhoodLink: {
    color: feedColors.teal,
    fontSize: 14,
    fontWeight: "700",
  },
  profileActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  profileFollowButton: {
    backgroundColor: feedColors.teal,
    borderRadius: 999,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  profileIconTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  profileFollowButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "800",
  },
  profileStatsRow: {
    flexDirection: "row",
    marginTop: 2,
  },
  profileStatItem: {
    flex: 1,
    gap: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  profileStatValue: {
    color: feedColors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  profileStatLabel: {
    color: "#7C8DA0",
    fontSize: 14,
    fontWeight: "600",
  },
  profilePhotoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  profilePhotoTile: {
    flexBasis: "47%",
    flexGrow: 1,
    height: 132,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: feedColors.tealSoft,
  },
  profilePhotoTileWide: {
    flexBasis: "100%",
    height: 150,
  },
  profilePhotoImage: {
    width: "100%",
    height: "100%",
  },
  profilePhotoBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: feedColors.teal,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  profilePhotoBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  profileViewAll: {
    alignSelf: "flex-end",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  profileAvatarText: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
  },
  profileAddLink: {
    color: feedColors.teal,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  profileButtonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  profilePillButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: feedColors.border,
    backgroundColor: feedColors.background,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
  },
  profilePillButtonText: {
    color: feedColors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  profilePillPrimary: {
    backgroundColor: feedColors.teal,
    borderColor: feedColors.teal,
  },
  profilePillPrimaryText: {
    color: "white",
  },
  profileSectionTitle: {
    color: feedColors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  goalProgressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    overflow: "hidden",
  },
  goalProgressFill: {
    height: "100%",
    backgroundColor: feedColors.teal,
    borderRadius: 999,
  },
  customGoalRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  customGoalButton: {
    backgroundColor: feedColors.teal,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
  },
  menuRowText: {
    color: feedColors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
  },
  leaderRowYou: {
    backgroundColor: feedColors.tealSoft,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  leaderRank: {
    color: feedColors.teal,
    fontSize: 15,
    fontWeight: "900",
    width: 32,
  },
  editAvatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  editAvatarPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  editAvatarPlaceholder: {
    backgroundColor: feedColors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  profileGoalCard: {
    borderWidth: 1,
    borderColor: feedColors.border,
    backgroundColor: feedColors.tealSoft,
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  profileGoalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  profileGoalTitle: {
    color: feedColors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  profileGoalBody: {
    color: feedColors.ink,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  profileGoalEmoji: {
    fontSize: 40,
  },
  profileGoalPillRow: {
    flexDirection: "row",
    gap: 8,
  },
  profileGoalPill: {
    borderWidth: 1,
    borderColor: feedColors.border,
    backgroundColor: feedColors.background,
    borderRadius: 999,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  profileGoalPillText: {
    color: feedColors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  shelfCard: {
    backgroundColor: feedColors.background,
    borderWidth: 1,
    borderColor: feedColors.border,
    borderRadius: 26,
    padding: 14,
    gap: 6,
  },
  shelfHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  shelfTitle: {
    color: feedColors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  shelfCount: {
    color: "#7C8DA0",
    fontWeight: "800",
    fontSize: 12,
  },
  rankedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  wantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
  },
  rankBubble: {
    width: 32,
    height: 32,
    borderRadius: 13,
    backgroundColor: colors.soft2,
    alignItems: "center",
    justifyContent: "center",
  },
  rankBubbleText: {
    color: colors.ink,
    fontWeight: "900",
  },
  rankedContent: {
    flex: 1,
  },
  rankedTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  rankedMeta: {
    color: colors.muted,
    fontWeight: "700",
    marginTop: 2,
  },
  wantNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 4,
  },
  boughtButtonSmall: {
    width: 38,
    height: 38,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  scorePill: {
    minWidth: 48,
    borderRadius: 999,
    backgroundColor: colors.ink,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  scoreText: {
    color: "white",
    fontWeight: "900",
  },
  resetButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 15,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  resetButtonText: {
    color: colors.accent,
    fontWeight: "900",
  },
  tabBar: {
    flexDirection: "row",
    gap: 7,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 6,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    minHeight: layout.touchTarget,
    paddingVertical: 6,
    gap: 2,
  },
  tabItemActive: {
    backgroundColor: colors.soft,
  },
  tabItemAdd: {
    backgroundColor: colors.ink,
    borderRadius: 20,
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  tabText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.ink,
  },
  tabTextAdd: {
    color: "white",
  },
  toast: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 96,
    alignItems: "center",
  },
  toastText: {
    overflow: "hidden",
    backgroundColor: colors.ink,
    color: "white",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(33, 26, 22, 0.5)",
    justifyContent: "flex-end",
  },
  compareSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 20,
    gap: 14,
  },
  compareHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 4,
  },
  compareTitle: {
    color: colors.ink,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  compareSubtitle: {
    color: colors.muted,
    lineHeight: 20,
    fontWeight: "700",
  },
  compareItemsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  compareItemCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 10,
    gap: 7,
    alignItems: "center",
  },
  compareItemCardPressable: {
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
  },
  compareItemCardPressed: {
    borderColor: colors.accent,
    backgroundColor: colors.greenSoft,
    transform: [{ scale: 0.98 }],
  },
  compareLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  compareItemTitle: {
    color: colors.ink,
    fontWeight: "900",
    textAlign: "center",
  },
  compareStore: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  compareTapHint: {
    color: colors.accentDark,
    backgroundColor: colors.greenSoft,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  compareVersus: {
    justifyContent: "center",
  },
  compareVersusText: {
    color: colors.muted,
    fontWeight: "900",
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 6,
  },
  skipButtonText: {
    color: colors.muted,
    fontWeight: "900",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 28,
    gap: 9,
  },
  emptyTitle: {
    color: colors.ink,
    fontWeight: "900",
    fontSize: 17,
  },
  emptyBody: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 19,
    fontWeight: "700",
  },
});
