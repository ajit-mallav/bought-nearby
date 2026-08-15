import "leaflet/dist/leaflet.css";
import L from "leaflet";
import React, { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { StyleSheet, View } from "react-native";

import { colors } from "../theme";
import { NycMapProps } from "../types";

const NYC_MAX_BOUNDS: L.LatLngBoundsExpression = [
  [40.49, -74.28],
  [40.92, -73.68],
];

function userIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${colors.ink};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function storeIcon(store: { photoUri: string; rating: number }) {
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:3px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.3);background:${colors.soft};">
          <img src="${store.photoUri}" style="width:100%;height:100%;object-fit:cover;" />
        </div>
        <div style="margin-top:-4px;background:${colors.accent};color:white;font-size:10px;font-weight:800;border-radius:999px;padding:1px 6px;border:2px solid white;">★ ${store.rating.toFixed(1)}</div>
      </div>
    `,
    iconSize: [46, 58],
    iconAnchor: [23, 30],
  });
}

function BoundsWatcher({
  stores,
  onVisibleStoresChange,
}: {
  stores: NycMapProps["stores"];
  onVisibleStoresChange: NycMapProps["onVisibleStoresChange"];
}) {
  const map = useMapEvents({
    moveend: () => report(),
    zoomend: () => report(),
  });

  function report() {
    const bounds = map.getBounds();
    const visible = stores.filter((store) => bounds.contains([store.lat, store.lng])).map((store) => store.id);
    onVisibleStoresChange(visible);
  }

  useEffect(() => {
    report();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, map]);

  return null;
}

export default function NycMap({ stores, userLocation, onSelectStore, onVisibleStoresChange }: NycMapProps) {
  const center: [number, number] = [userLocation.lat, userLocation.lng];
  const uIcon = useMemo(() => userIcon(), []);

  return (
    <View style={styles.wrapper}>
      <MapContainer
        center={center}
        zoom={14}
        minZoom={10}
        maxZoom={18}
        maxBounds={NYC_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={center} icon={uIcon} />
        {stores.map((store) => (
          <Marker
            key={store.id}
            position={[store.lat, store.lng]}
            icon={storeIcon(store)}
            eventHandlers={{ click: () => onSelectStore(store) }}
          />
        ))}
        <BoundsWatcher stores={stores} onVisibleStoresChange={onVisibleStoresChange} />
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 320,
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
});
