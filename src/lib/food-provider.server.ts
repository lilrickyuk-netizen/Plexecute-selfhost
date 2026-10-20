// Food data providers (V3 §48). Production primary: fatsecret Platform. Public reference: USDA FoodData Central.
// Credentials come only from env: FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET, FATSECRET_REGION (e.g. GB), USDA_FDC_API_KEY.
import type { ProviderFood } from "./nutrition-engine";
export type { ProviderFood };

let fsToken: { value: string; exp: number } | null = null;

function fsConfigured() {
  return !!(process.env["FATSECRET_CLIENT_ID"] && process.env["FATSECRET_CLIENT_SECRET"]);
}

async function fatsecretToken(): Promise<string> {
  if (fsToken && fsToken.exp > Date.now() + 60_000) return fsToken.value;
  const id = process.env["FATSECRET_CLIENT_ID"]!;
  const secret = process.env["FATSECRET_CLIENT_SECRET"]!;
  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${id}:${secret}`),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env["FATSECRET_SCOPE"] ?? "premier barcode",
    }),
  });
  if (!res.ok) throw new Error(`fatsecret auth ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  fsToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function fsGet(path: string, params: Record<string, string>) {
  const token = await fatsecretToken();
  const qs = new URLSearchParams({ ...params, format: "json" });
  const region = process.env["FATSECRET_REGION"];
  if (region) qs.set("region", region);
  const res = await fetch(`https://platform.fatsecret.com/rest/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await (
    await import("./usage.server")
  ).recordUsage({
    userId: null,
    provider: "fatsecret",
    feature: `food_${path.split("/")[0]}`,
    unit: "requests",
    quantity: 1,
    ok: res.ok,
  });
  if (!res.ok) throw new Error(`fatsecret ${path} ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

type FsServing = {
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  serving_description?: string;
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fiber?: string;
  is_default?: string;
};
type FsFood = {
  food_id: string;
  food_name: string;
  brand_name?: string;
  servings?: { serving: FsServing | FsServing[] };
  food_attributes?: { allergens?: { allergen: { name: string; value: string }[] } };
};

function mapFs(f: FsFood, barcode: string | null = null): ProviderFood | null {
  const list = f.servings?.serving
    ? Array.isArray(f.servings.serving)
      ? f.servings.serving
      : [f.servings.serving]
    : [];
  const metric = list.filter(
    (s) =>
      (s.metric_serving_unit === "g" || s.metric_serving_unit === "ml") &&
      Number(s.metric_serving_amount) > 0,
  );
  const s = metric.find((x) => x.is_default === "1") ?? metric[0];
  if (!s) return null;
  const g = Number(s.metric_serving_amount);
  const per = (v?: string) => Math.round((Number(v ?? 0) / g) * 1000) / 10;
  return {
    source: "fatsecret",
    source_ref: f.food_id,
    name: f.food_name,
    brand: f.brand_name ?? null,
    barcode,
    kcal_100g: per(s.calories),
    protein_100g: per(s.protein),
    carbs_100g: per(s.carbohydrate),
    fat_100g: per(s.fat),
    fibre_100g: s.fiber == null ? null : per(s.fiber),
    serving_g: g,
    serving_label: s.serving_description ?? null,
    allergens: (f.food_attributes?.allergens?.allergen ?? [])
      .filter((a) => a.value === "1")
      .map((a) => a.name.toLowerCase()),
    attribution: "Powered by fatsecret",
  };
}

/** USDA's shared DEMO_KEY (30 requests/hour per IP) is allowed only outside production; production needs USDA_FDC_API_KEY. */
export function usdaKey() {
  return (
    process.env["USDA_FDC_API_KEY"] ||
    (process.env["APP_ENV"] === "production" ? undefined : "DEMO_KEY")
  );
}
const FDC = {
  kcal: [1008, 2047, 2048],
  protein: [1003],
  carbs: [1005],
  fat: [1004],
  fibre: [1079],
};
type FdcFood = {
  fdcId: number;
  dataType?: string;
  description: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients: { nutrientId: number; value: number; unitName?: string }[];
};
function mapFdc(f: FdcFood): ProviderFood {
  const get = (ids: number[]) => {
    for (const id of ids) {
      const n = f.foodNutrients.find((x) => x.nutrientId === id);
      if (n) return n.unitName === "kJ" ? n.value / 4.184 : n.value;
    }
    return 0;
  };
  const fib = f.foodNutrients.find((x) => x.nutrientId === 1079);
  return {
    source: "usda_fdc",
    source_ref: String(f.fdcId),
    name: f.description,
    brand: f.brandName ?? f.brandOwner ?? null,
    barcode: f.gtinUpc ?? null,
    kcal_100g: Math.round(get(FDC.kcal)),
    protein_100g: get(FDC.protein),
    carbs_100g: get(FDC.carbs),
    fat_100g: get(FDC.fat),
    fibre_100g: fib ? fib.value : null,
    serving_g: f.servingSizeUnit?.toLowerCase() === "g" ? (f.servingSize ?? null) : null,
    serving_label: f.householdServingFullText ?? null,
    allergens: [],
    attribution: "USDA FoodData Central (public domain)",
  };
}

export function providerStatus() {
  return {
    fatsecret: fsConfigured(),
    usda: !!usdaKey(),
    usdaKey: !!process.env["USDA_FDC_API_KEY"],
    barcode: fsConfigured(),
  };
}

export async function searchFoods(
  q: string,
): Promise<{ foods: ProviderFood[]; provider: string; degraded: boolean }> {
  if (fsConfigured()) {
    try {
      const j = await fsGet("foods/search/v3", {
        search_expression: q,
        max_results: "20",
        include_food_attributes: "true",
      });
      const raw =
        (j["foods_search"] as { results?: { food?: FsFood[] } } | undefined)?.results?.food ?? [];
      return {
        foods: raw.map((f) => mapFs(f)).filter((x): x is ProviderFood => !!x),
        provider: "fatsecret",
        degraded: false,
      };
    } catch (e) {
      console.error("fatsecret search failed", e);
    }
  }
  const key = usdaKey();
  if (!key) throw new Error("Food search is not switched on yet.");
  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=20&dataType=Foundation,SR%20Legacy,Branded`,
  );
  if (!res.ok) throw new Error("Food search is temporarily unavailable.");
  const j = (await res.json()) as { foods?: FdcFood[] };
  const rank = (f: FdcFood) =>
    f.dataType === "Foundation" ? 0 : f.dataType === "SR Legacy" ? 1 : 2;
  return {
    foods: [...(j.foods ?? [])]
      .sort((a, b) => rank(a) - rank(b))
      .map(mapFdc)
      .filter((f) => f.kcal_100g > 0 || f.protein_100g > 0),
    provider: "usda_fdc",
    degraded: fsConfigured(),
  };
}

export async function barcodeLookup(code: string): Promise<ProviderFood | null> {
  if (fsConfigured()) {
    const j = await fsGet("food/barcode/find-by-id/v1", { barcode: code.padStart(13, "0") });
    const id = (j["food_id"] as { value?: string } | undefined)?.value;
    if (!id || id === "0") return null;
    const f = await fsGet("food/v4", { food_id: id, include_food_attributes: "true" });
    return mapFs(f["food"] as FsFood, code);
  }
  // Public reference fallback: USDA branded foods carry GTIN/UPC.
  const key = usdaKey();
  if (!key) return null;
  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(code)}&dataType=Branded&pageSize=5`,
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { foods?: FdcFood[] };
  const hit = (j.foods ?? []).find(
    (f) => f.gtinUpc && f.gtinUpc.replace(/^0+/, "") === code.replace(/^0+/, ""),
  );
  return hit ? mapFdc(hit) : null;
}
