/** Turns a member-shared phone GPS fix into a pickup address. Uses Google Maps when its key is set, else OpenStreetMap (no key). Never invents an address. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  try {
    if (key) {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
      );
      const j = (await r.json()) as { results?: { formatted_address?: string }[] };
      const a = j.results?.[0]?.formatted_address;
      if (a) return a;
    }
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`,
      {
        headers: {
          "User-Agent": "Plexecute/1.0 (support@plexecute.io)",
          "Accept-Language": "en-GB",
        },
      },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { display_name?: string };
    return j.display_name ?? null;
  } catch {
    return null;
  }
}

export async function describeLocation(l: { lat: number; lng: number; accuracy: number }) {
  const lat = Number(l.lat.toFixed(6));
  const lng = Number(l.lng.toFixed(6));
  const addr = await reverseGeocode(lat, lng);
  return `[Member's current phone location, shared just now: ${addr ? `near ${addr}` : "address not found"} (GPS ${lat}, ${lng}, accurate to about ${l.accuracy} m). Use it as the pickup or starting point when they say "here", "my location" or "where I am"; confirm the exact pickup spot with them before booking if accuracy is over 100 m.]`;
}
