// Add future categories and their unambiguous aliases here. Canonical names
// are automatically accepted, including space/hyphen-separated variants.
export const CATEGORY_ALIASES = {
  rumah_dan_keluarga: ["rumah", "keluarga"],
  sekolah_dan_kelas: ["sekolah", "kelas", "sd"],
  teman_dan_permainan: ["teman", "permainan", "main"],
  kantin_dan_perjalanan: ["kantin", "perjalanan"],
  hobi_dan_imajinasi: ["hobi", "imajinasi"],
  hal_kecil_yang_membekas: ["hal kecil", "momen kecil"],
  kesan_sepintas_tentang_pit: ["pit", "kesan tentang pit"],
} as const;

function categoryKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

const categoriesByAlias = new Map<string, string>();
for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
  for (const alias of [category, ...aliases]) {
    const key = categoryKey(alias);
    const existing = categoriesByAlias.get(key);
    if (existing !== undefined && existing !== category) {
      throw new Error(`Ambiguous category alias: ${alias}`);
    }
    categoriesByAlias.set(key, category);
  }
}

export function normalizeCategory(category: string): string {
  // Unknown categories remain exact filters; never fall back to all memories.
  return categoriesByAlias.get(categoryKey(category)) ?? category;
}
