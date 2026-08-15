import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import NycMap from "./src/components/NycMap";
import { loadDatabaseState, saveDatabaseState } from "./src/data/database";
import { CATEGORIES, CATEGORY_EMOJI, friendFeed, starterPurchases, starterRankings, starterWants, stores } from "./src/data/seed";
import { colors } from "./src/theme";
import { Category, ComparisonSession, FeedEvent, Purchase, Store, WantedItem } from "./src/types";
import { distanceMiles } from "./src/utils/geo";
import { insertAtRank, rankOf, rankedPurchasesForCategory, sanitizePurchases, sanitizeRankings, scoreForRank, scoreOf, topLifetimePurchases } from "./src/utils/ranking";

const STORAGE_KEY = "@bought-nearby:v1";
const DEFAULT_LOCATION = { lat: 40.7359, lng: -73.9911, label: "Union Square demo location" };

type TabKey = "feed" | "add" | "search" | "map" | "profile";
type DraftPurchase = {
  mode: "bought" | "want";
  itemName: string;
  storeName: string;
  storeLink: string;
  price: string;
  category: Category;
  notes: string;
  photoUri?: string;
};

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: "feed", label: "Feed", icon: "sparkles-outline" },
  { key: "add", label: "Log", icon: "add-circle-outline" },
  { key: "search", label: "Search", icon: "search-outline" },
  { key: "map", label: "Map", icon: "map-outline" },
  { key: "profile", label: "Shelf", icon: "person-circle-outline" },
];

const emptyDraft = (): DraftPurchase => ({
  mode: "bought",
  itemName: "",
  storeName: "",
  storeLink: "",
  price: "",
  category: "Clothing",
  notes: "",
});

export default function App() {
  const [selectedTab, setSelectedTab] = useState<TabKey>("feed");
  const [purchases, setPurchases] = useState<Purchase[]>(starterPurchases);
  const [rankings, setRankings] = useState(starterRankings);
  const [wants, setWants] = useState<WantedItem[]>(starterWants);
  const [draft, setDraft] = useState<DraftPurchase>(emptyDraft());
  const [comparison, setComparison] = useState<ComparisonSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchCategory, setSearchCategory] = useState<Category | "All">("All");
  const [mapCategory, setMapCategory] = useState<Category | "All">("All");
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [locationMessage, setLocationMessage] = useState("Showing a demo starting point in Union Square.");
  const [selectedShop, setSelectedShop] = useState<Store | null>(null);

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
        showToast("Starting with demo data — saved data could not be loaded.");
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
        itemName: purchase.itemName,
        category: purchase.category,
        storeName: purchase.storeName,
        rank,
        score,
        createdAt: purchase.createdAt,
      };
      if (purchase.photoUri) event.photoUri = purchase.photoUri;
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

  function showToast(message: string) {
    setToast(message);
  }

  function updateDraft(update: Partial<DraftPurchase>) {
    setDraft((current) => ({ ...current, ...update }));
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
    showToast("Sample photo added for the demo.");
  }

  function saveWant(itemName: string, storeName: string) {
    const matchedStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
    const want: WantedItem = {
      id: `w-${Date.now()}`,
      itemName,
      storeName,
      storeLink: draft.storeLink.trim() || matchedStore?.link,
      category: draft.category,
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
    showToast("Demo data reset.");
  }

  async function requestLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Location permission was denied, so the demo location is still being used.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({});
      setUserLocation({ lat: current.coords.latitude, lng: current.coords.longitude, label: "Your current location" });
      setLocationMessage("Sorted stores by your current location.");
    } catch {
      setLocationMessage("Could not access GPS here, so the demo location is still being used.");
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
    return (
      <View style={styles.screen}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Ionicons name="shirt-outline" size={18} color={colors.ink} />
            <Text style={styles.heroBadgeText}>NYC clothing discovery</Text>
          </View>
          <Text style={styles.heroTitle}>Bought Nearby</Text>
          <Text style={styles.heroSubtitle}>
            Log what you bought, compare it against your own closet, and help friends find the smaller clothing stores worth visiting.
          </Text>
          <View style={styles.statRow}>
            <StatCard icon="trophy-outline" label="Ranked" value={String(rankedCount)} />
            <StatCard icon="storefront-outline" label="Local logs" value={String(localPurchaseCount)} />
            <StatCard icon="bookmark-outline" label="Wants" value={String(wants.length)} />
          </View>
          <Pressable style={styles.primaryButton} onPress={() => setSelectedTab("add")}>
            <Ionicons name="camera-outline" size={19} color="white" />
            <Text style={styles.primaryButtonText}>Log a purchase</Text>
          </Pressable>
        </View>

        <SectionHeader title="Friend activity" action="Beli-style rankings" />
        {feedEvents.map((event) => (
          <FeedCard key={event.id} event={event} onPress={() => openStoreByName(event.storeName)} />
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
      notes: want.notes ?? "",
      photoUri: want.photoUri,
    });
    setWants((current) => current.filter((item) => item.id !== want.id));
    setSelectedShop(null);
    setSelectedTab("add");
    showToast("Want moved into the purchase logger.");
  }

  function renderAdd() {
    const categoryCount = rankings[draft.category].length;
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
                <Text style={styles.ghostButtonText}>Use sample</Text>
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
          <TextInput
            style={styles.input}
            placeholder="e.g. Beacon's Closet"
            placeholderTextColor={colors.muted}
            value={draft.storeName}
            onChangeText={(storeName) => updateDraft({ storeName })}
          />
          <TextInput
            style={[styles.input, styles.inputSpacing]}
            placeholder="Optional product/store URL"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            value={draft.storeLink}
            onChangeText={(storeLink) => updateDraft({ storeLink })}
          />

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
              <FormLabel label="Category" />
              <Text style={styles.comparisonHint}>{isWantMode ? `${wants.length} wants saved` : `${categoryCount} already ranked`}</Text>
            </View>
          </View>

          <CategoryPicker selected={draft.category} onSelect={(category) => category !== "All" && updateDraft({ category })} />

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

        <View style={styles.infoStrip}>
          <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
          <Text style={styles.infoStripText}>
            {isWantMode
              ? "Wants work like a shopping version of Beli's want-to-go list. Convert one into a ranked purchase after you buy it."
              : `Binary insertion means item #${categoryCount + 1} takes about ${Math.max(1, Math.ceil(Math.log2(categoryCount + 1)))} quick comparison${Math.max(1, Math.ceil(Math.log2(categoryCount + 1))) === 1 ? "" : "s"}.`}
          </Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  function renderSearch() {
    const normalized = searchTerm.trim().toLowerCase();
    const purchaseRows = purchases.map((purchase) => ({
      id: `purchase-${purchase.id}`,
      type: "Your shelf",
      title: purchase.itemName,
      subtitle: purchase.storeName,
      category: purchase.category,
      image: purchase.photoUri,
      meta: rankOf(purchase.id, purchase.category, rankings)
        ? `#${rankOf(purchase.id, purchase.category, rankings)} • ${scoreOf(purchase.id, purchase.category, rankings)} score`
        : "Awaiting rank",
      body: purchase.notes,
    }));
    const wantRows = wants.map((want) => ({
      id: `want-${want.id}`,
      type: "Want to buy",
      title: want.itemName,
      subtitle: want.storeName,
      category: want.category,
      image: want.photoUri,
      meta: "Saved for later",
      body: want.notes,
    }));
    const friendRows = friendFeed.map((event) => ({
      id: `friend-${event.id}`,
      type: `${event.actor}'s shelf`,
      title: event.itemName,
      subtitle: event.storeName,
      category: event.category,
      image: event.photoUri,
      meta: `#${event.rank} • ${event.score} score`,
      body: event.isLocalStore ? "Local store find" : undefined,
    }));
    const storeRows = stores.map((store) => ({
      id: `store-${store.id}`,
      type: "Nearby store",
      title: store.name,
      subtitle: `${store.neighborhood}, ${store.borough}`,
      category: store.category,
      image: store.photoUri,
      meta: store.tags.join(" • "),
      body: store.description,
    }));

    const rows = [...purchaseRows, ...wantRows, ...friendRows, ...storeRows].filter((row) => {
      const categoryMatch = searchCategory === "All" || row.category === searchCategory;
      const text = `${row.title} ${row.subtitle} ${row.meta} ${row.body ?? ""}`.toLowerCase();
      return categoryMatch && (!normalized || text.includes(normalized));
    });

    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.cardKicker}>Search</Text>
          <Text style={styles.cardTitle}>Find similar items and stores</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search denim jacket, vintage, boutique..."
            placeholderTextColor={colors.muted}
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          <CategoryPicker selected={searchCategory} onSelect={setSearchCategory} includeAll />
        </View>

        <SectionHeader title={`${rows.length} result${rows.length === 1 ? "" : "s"}`} action="Shelf + wants + friends + stores" />
        {rows.length === 0 ? (
          <EmptyState icon="search-outline" title="No matches yet" body="Try another category or log a purchase to build your searchable shelves." />
        ) : (
          rows.map((row) => (
            <View style={styles.resultCard} key={row.id}>
              <PhotoPreview uri={row.image} category={row.category} size="small" />
              <View style={styles.resultContent}>
                <View style={styles.resultTopRow}>
                  <Text style={styles.resultType}>{row.type}</Text>
                  <Text style={styles.categoryBadge}>{CATEGORY_EMOJI[row.category]} {row.category}</Text>
                </View>
                <Text style={styles.resultTitle}>{row.title}</Text>
                <Text style={styles.resultSubtitle}>{row.subtitle}</Text>
                <Text style={styles.resultMeta}>{row.meta}</Text>
                {!!row.body && <Text style={styles.resultBody}>{row.body}</Text>}
              </View>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderMap() {
    const categoryStores = stores
      .filter((store) => mapCategory === "All" || store.category === mapCategory)
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
          <CategoryPicker selected={mapCategory} onSelect={setMapCategory} includeAll compact />
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
            <Text style={styles.resultType}>{CATEGORY_EMOJI[store.category]} {store.category}</Text>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={13} color={colors.accent} />
              <Text style={styles.ratingBadgeText}>{store.rating.toFixed(1)}</Text>
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
          shopFeed.map((event) => <FeedCard key={event.id} event={event} />)
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
    return (
      <View style={styles.screen}>
        <View style={styles.profileCard}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>Y</Text>
          </View>
          <Text style={styles.profileTitle}>Your ranked shelves</Text>
          <Text style={styles.profileSubtitle}>Scores are derived from rank position — no manual 0–10 entry needed.</Text>
          <View style={styles.statRow}>
            <StatCard icon="bag-handle-outline" label="Purchases" value={String(purchases.length)} />
            <StatCard icon="trophy-outline" label="Ranked" value={String(rankedCount)} />
            <StatCard icon="bookmark-outline" label="Wants" value={String(wants.length)} />
          </View>
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

        <SectionHeader title="Want to buy" action={`${wants.length} saved`} />
        {wants.length === 0 ? (
          <EmptyState icon="bookmark-outline" title="No wants yet" body="Use Want mode in Log or save stores from the map to build your shopping shortlist." />
        ) : (
          wants.map((want) => <WantRow key={want.id} want={want} onBought={() => convertWantToDraft(want)} />)
        )}

        <SectionHeader title="Shelves by category" action="Top 10 each" />
        {CATEGORIES.map((category) => {
          const ranked = rankedPurchasesForCategory(category, purchases, rankings).slice(0, 10);
          if (ranked.length === 0) return null;
          return (
            <View key={category} style={styles.shelfCard}>
              <View style={styles.shelfHeader}>
                <Text style={styles.shelfTitle}>{CATEGORY_EMOJI[category]} {category}</Text>
                <Text style={styles.shelfCount}>{ranked.length} ranked</Text>
              </View>
              {ranked.map((purchase, index) => (
                <RankedRow
                  key={purchase.id}
                  purchase={purchase}
                  rank={index + 1}
                  score={scoreForRank(index, rankings[category].length)}
                />
              ))}
            </View>
          );
        })}

        <Pressable style={styles.resetButton} onPress={resetDemoData}>
          <Ionicons name="refresh-outline" size={18} color={colors.accent} />
          <Text style={styles.resetButtonText}>Reset demo data</Text>
        </Pressable>
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
          <View style={styles.topBar}>
            {selectedShop ? (
              <Pressable style={styles.backRow} onPress={() => setSelectedShop(null)}>
                <View style={styles.backButton}>
                  <Ionicons name="chevron-back" size={20} color={colors.ink} />
                </View>
                <Text style={styles.appContext} numberOfLines={1}>{selectedShop.name}</Text>
              </Pressable>
            ) : (
              <View>
                <Text style={styles.appName}>Bought Nearby</Text>
                <Text style={styles.appContext}>{activeTab.label}</Text>
              </View>
            )}
            <View style={styles.logoMark}>
              <Ionicons name="bag-handle" size={23} color="white" />
            </View>
          </View>

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
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tabItem, isActive && styles.tabItemActive]}
                  onPress={() => {
                    setSelectedShop(null);
                    setSelectedTab(tab.key);
                  }}
                >
                  <Ionicons name={tab.icon as keyof typeof Ionicons.glyphMap} size={21} color={isActive ? colors.ink : colors.muted} />
                  <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
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

      <Modal visible={!!comparison && !!currentComparisonItem && !!newComparisonItem} animationType="slide" transparent onRequestClose={skipComparisonToBottom}>
        <View style={styles.modalBackdrop}>
          <View style={styles.compareSheet}>
            {!!comparison && !!currentComparisonItem && !!newComparisonItem && (
              <>
                <View style={styles.compareHandle} />
                <Text style={styles.cardKicker}>Rank {CATEGORY_EMOJI[comparison.category]} {comparison.category}</Text>
                <Text style={styles.compareTitle}>Was this better than your {currentComparisonItem.itemName}?</Text>
                <Text style={styles.compareSubtitle}>
                  Comparison {comparison.comparisons + 1}. Your answer narrows the shelf using binary insertion.
                </Text>

                <View style={styles.compareItemsRow}>
                  <View style={styles.compareItemCard}>
                    <Text style={styles.compareLabel}>New</Text>
                    <PhotoPreview uri={newComparisonItem.photoUri} category={newComparisonItem.category} size="medium" />
                    <Text style={styles.compareItemTitle}>{newComparisonItem.itemName}</Text>
                    <Text style={styles.compareStore}>{newComparisonItem.storeName}</Text>
                  </View>
                  <View style={styles.compareVersus}>
                    <Text style={styles.compareVersusText}>vs</Text>
                  </View>
                  <View style={styles.compareItemCard}>
                    <Text style={styles.compareLabel}>Current #{comparison.mid + 1}</Text>
                    <PhotoPreview uri={currentComparisonItem.photoUri} category={currentComparisonItem.category} size="medium" />
                    <Text style={styles.compareItemTitle}>{currentComparisonItem.itemName}</Text>
                    <Text style={styles.compareStore}>{currentComparisonItem.storeName}</Text>
                  </View>
                </View>

                <Pressable style={styles.primaryButton} onPress={() => answerComparison(true)}>
                  <Ionicons name="thumbs-up-outline" size={18} color="white" />
                  <Text style={styles.primaryButtonText}>Yes, rank it higher</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonWide} onPress={() => answerComparison(false)}>
                  <Ionicons name="thumbs-down-outline" size={18} color={colors.ink} />
                  <Text style={styles.secondaryButtonText}>No, keep it lower</Text>
                </Pressable>
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

function CategoryPicker({
  selected,
  onSelect,
  includeAll,
  compact,
}: {
  selected: Category | "All";
  onSelect: (category: Category | "All") => void;
  includeAll?: boolean;
  compact?: boolean;
}) {
  const values = includeAll ? (["All", ...CATEGORIES] as (Category | "All")[]) : CATEGORIES;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.categoryRow, compact && styles.categoryRowCompact]}>
      {values.map((category) => {
        const active = selected === category;
        return (
          <Pressable key={category} style={[styles.categoryPill, active && styles.categoryPillActive]} onPress={() => onSelect(category)}>
            <Text style={[styles.categoryPillText, active && styles.categoryPillTextActive]}>
              {category === "All" ? "🌎" : CATEGORY_EMOJI[category]} {category}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PhotoPreview({ uri, category, size }: { uri?: string; category: Category; size: "small" | "medium" | "large" }) {
  const dimensions = size === "large" ? styles.photoLarge : size === "medium" ? styles.photoMedium : styles.photoSmall;
  if (uri) {
    return <Image source={{ uri }} style={[styles.photoBase, dimensions]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.photoBase, dimensions, styles.photoPlaceholder]}>
      <Text style={styles.photoEmoji}>{CATEGORY_EMOJI[category]}</Text>
    </View>
  );
}

function FormLabel({ label }: { label: string }) {
  return <Text style={styles.formLabel}>{label}</Text>;
}

function StatCard({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.statCard}>
      {!!icon && <Ionicons name={icon} size={16} color="white" style={styles.statIcon} />}
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
          <Text style={styles.feedActor}>{event.actor}</Text> ranked {event.itemName} #{event.rank} in {event.category}
        </Text>
        <Text style={styles.feedMeta}>
          {event.storeName} • {event.score}/10 • {timeAgo(event.createdAt)}
        </Text>
        {event.isLocalStore && <Text style={styles.localChip}>Local store find</Text>}
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
    maxWidth: 520,
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
  appName: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.6,
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
  logoMark: {
    width: 46,
    height: 46,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  screen: {
    gap: 16,
  },
  heroCard: {
    backgroundColor: colors.ink,
    borderRadius: 30,
    padding: 22,
    gap: 16,
    overflow: "hidden",
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.yellow,
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
    color: "white",
    fontSize: 38,
    lineHeight: 40,
    fontWeight: "900",
    letterSpacing: -1.3,
  },
  heroSubtitle: {
    color: colors.soft,
    fontSize: 16,
    lineHeight: 23,
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 18,
    padding: 12,
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
  photoEmoji: {
    fontSize: 30,
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
    fontWeight: "700",
    fontSize: 15,
  },
  inputSpacing: {
    marginTop: -6,
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
    fontWeight: "800",
    fontSize: 16,
  },
  twoColumnRow: {
    flexDirection: "row",
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  comparisonHint: {
    color: colors.muted,
    backgroundColor: colors.soft2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontWeight: "800",
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
  infoStrip: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.soft2,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoStripText: {
    flex: 1,
    color: colors.muted,
    lineHeight: 19,
    fontWeight: "700",
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
  profileCard: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 30,
    padding: 22,
    gap: 13,
  },
  avatarLarge: {
    width: 74,
    height: 74,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.24)",
  },
  avatarLargeText: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
  },
  profileTitle: {
    color: "white",
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  profileSubtitle: {
    color: colors.soft,
    textAlign: "center",
    lineHeight: 20,
    fontWeight: "600",
  },
  shelfCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  shelfCount: {
    color: colors.muted,
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
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 8,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    paddingVertical: 8,
    gap: 2,
  },
  tabItemActive: {
    backgroundColor: colors.soft,
  },
  tabText: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.ink,
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
