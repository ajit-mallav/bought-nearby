import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors } from "../theme";
import { NycMapProps } from "../types";
import { markerPosition } from "../utils/geo";

export default function NycMap({ stores, onSelectStore }: NycMapProps) {
  return (
    <View style={styles.map}>
      <View style={styles.gridLineVertical} />
      <View style={styles.gridLineHorizontal} />
      <View style={styles.userMarker}>
        <Ionicons name="navigate" size={15} color="white" />
      </View>
      {stores.map((store, index) => {
        const position = markerPosition(store);
        return (
          <Pressable
            key={store.id}
            style={[styles.marker, position as ViewStyle]}
            onPress={() => onSelectStore(store)}
          >
            <Text style={styles.markerText}>{index + 1}</Text>
          </Pressable>
        );
      })}
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
        <Text style={styles.noticeText}>Simplified map on this platform — full interactive map is on web.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
    backgroundColor: colors.greenSoft,
    overflow: "hidden",
  },
  gridLineVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "48%",
    width: 8,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  gridLineHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "48%",
    height: 8,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  userMarker: {
    position: "absolute",
    left: "49%",
    top: "49%",
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "white",
    zIndex: 3,
  },
  marker: {
    position: "absolute",
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  markerText: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
  },
  notice: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noticeText: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
});
