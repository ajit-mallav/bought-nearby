export const NYC_BOUNDS = { minLat: 40.56, maxLat: 40.82, minLng: -74.05, maxLng: -73.89 };

export function distanceMiles(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
) {
  const radius = 3958.8;
  const dLat = degreesToRadians(destination.lat - origin.lat);
  const dLng = degreesToRadians(destination.lng - origin.lng);
  const lat1 = degreesToRadians(origin.lat);
  const lat2 = degreesToRadians(destination.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

export function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function markerPosition(point: { lat: number; lng: number }) {
  const left = ((point.lng - NYC_BOUNDS.minLng) / (NYC_BOUNDS.maxLng - NYC_BOUNDS.minLng)) * 100;
  const top = ((NYC_BOUNDS.maxLat - point.lat) / (NYC_BOUNDS.maxLat - NYC_BOUNDS.minLat)) * 100;
  return {
    left: `${Math.max(5, Math.min(92, left))}%`,
    top: `${Math.max(5, Math.min(88, top))}%`,
  };
}
