// Server-side Google Maps Platform access for Journey Planning. Calls go straight to Google with a
// server-only GOOGLE_MAPS_API_KEY. Cost-conscious: geocodes are cached,
// routes are only recalculated when something changed or a recheck is due.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { recordUsage } from "@/lib/usage.server";
import { normMode, type JourneyMode } from "@/lib/journeys";

type Db = SupabaseClient<Database>;

function mapsKey(): string {
  const maps = process.env["GOOGLE_MAPS_API_KEY"];
  if (!maps) throw new Error("Google Maps is not switched on yet.");
  return maps;
}

/** Maps the old connector-gateway paths onto Google's own API hosts. */
export function googleMapsUrl(path: string, key: string): { url: string; keyHeader: boolean } {
  if (path.startsWith("/maps/api/")) {
    const sep = path.includes("?") ? "&" : "?";
    return {
      url: `https://maps.googleapis.com${path}${sep}key=${encodeURIComponent(key)}`,
      keyHeader: false,
    };
  }
  if (path.startsWith("/routes/")) {
    return { url: `https://routes.googleapis.com${path.slice("/routes".length)}`, keyHeader: true };
  }
  if (path.startsWith("/places/")) {
    return { url: `https://places.googleapis.com${path.slice("/places".length)}`, keyHeader: true };
  }
  throw new Error(`Unsupported Google Maps path: ${path}`);
}

async function gatewayFetch(
  path: string,
  init: RequestInit,
  userId: string | null,
  feature: string,
): Promise<Response> {
  const key = mapsKey();
  const target = googleMapsUrl(path, key);
  const res = await fetch(target.url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(target.keyHeader ? { "X-Goog-Api-Key": key } : {}),
      ...(init.headers ?? {}),
    },
  });
  await recordUsage({
    userId,
    provider: "google_maps",
    feature,
    unit: "requests",
    quantity: 1,
    ok: res.ok,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`google_maps ${feature} failed [${res.status}]: ${body.slice(0, 300)}`);
    throw new Error(`maps_${feature}_failed`);
  }
  return res;
}

export type LatLng = { lat: number; lng: number };
export type GeocodeResult = LatLng & { formatted: string };

/** Geocode an address, using the server-side cache first (cost control). */
export async function geocode(
  db: Db,
  address: string,
  userId: string | null,
): Promise<GeocodeResult> {
  const query = address.trim().toLowerCase();
  if (!query) throw new Error("invalid_address");
  const { data: hit } = await db
    .from("geocode_cache")
    .select("lat,lng,formatted")
    .eq("query", query)
    .maybeSingle();
  if (hit) return { lat: hit.lat, lng: hit.lng, formatted: hit.formatted };
  const res = await gatewayFetch(
    `/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}`,
    { method: "GET" },
    userId,
    "geocoding",
  );
  const json = (await res.json()) as {
    status: string;
    results?: { geometry: { location: { lat: number; lng: number } }; formatted_address: string }[];
  };
  const r = json.results?.[0];
  if (json.status !== "OK" || !r) throw new Error("invalid_address");
  const out = {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    formatted: r.formatted_address,
  };
  await db.from("geocode_cache").upsert({ query, ...out }, { onConflict: "query" });
  return out;
}

export type RouteResult = {
  durationMin: number;
  distanceM: number;
  trafficAware: boolean;
  /** Transit only: Google's suggested departure/arrival when an arrival target was given. */
  transitDepart?: string;
  transitArrive?: string;
};

function parseDuration(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(s);
  return m?.[1] ? Math.ceil(parseFloat(m[1]) / 60) : null;
}

/**
 * Compute a route. Drive uses TRAFFIC_AWARE with a departure time; transit uses the target
 * arrival time so Google picks the right services; walking is time-independent.
 */
export async function computeRoute(
  userId: string | null,
  args: { origin: LatLng; dest: LatLng; mode: JourneyMode; departAt?: Date; arriveBy?: Date },
): Promise<RouteResult> {
  const mode = normMode(args.mode);
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: args.origin.lat, longitude: args.origin.lng } } },
    destination: { location: { latLng: { latitude: args.dest.lat, longitude: args.dest.lng } } },
    travelMode: mode === "drive" ? "DRIVE" : mode === "transit" ? "TRANSIT" : "WALK",
    computeAlternativeRoutes: false,
  };
  if (mode === "drive") {
    body["routingPreference"] = "TRAFFIC_AWARE";
    body["departureTime"] = (args.departAt ?? new Date()).toISOString();
  } else if (mode === "transit") {
    if (args.arriveBy) body["arrivalTime"] = args.arriveBy.toISOString();
    else body["departureTime"] = (args.departAt ?? new Date()).toISOString();
  }
  const res = await gatewayFetch(
    "/routes/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
    },
    userId,
    `routes_${mode}`,
  );
  const json = (await res.json()) as {
    routes?: { duration?: string; distanceMeters?: number }[];
  };
  const route = json.routes?.[0];
  const durationMin = parseDuration(route?.duration);
  if (!route || durationMin == null) throw new Error("no_route");
  return {
    durationMin,
    distanceM: route.distanceMeters ?? 0,
    trafficAware: mode === "drive",
  };
}

export type PlaceMatch = { id: string; name: string; address: string; lat: number; lng: number };

/** Resolve a free-text destination ("the gym", a business name) to candidate places. */
export async function searchPlaces(
  userId: string | null,
  text: string,
  bias?: LatLng,
): Promise<PlaceMatch[]> {
  const res = await gatewayFetch(
    "/places/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: text,
        pageSize: 5,
        ...(bias
          ? {
              locationBias: {
                circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 },
              },
            }
          : {}),
      }),
    },
    userId,
    "places_search",
  );
  const json = (await res.json()) as {
    places?: {
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
    }[];
  };
  return (json.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? text,
      address: p.formattedAddress ?? "",
      lat: p.location!.latitude,
      lng: p.location!.longitude,
    }));
}
