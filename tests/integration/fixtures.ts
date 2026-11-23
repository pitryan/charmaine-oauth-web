// Synthetic local integration fixtures only; no production IDs or story content.
// Interleaved keys expose pagination/count bugs that accidentally cross owners.
const ROWS = [
  ["A", "001", "sekolah_dan_kelas", "2009/2010", "draft"],
  ["B", "002", "sekolah_dan_kelas", "2009/2010", "draft"],
  ["A", "003", "sekolah_dan_kelas", "2009/2010", "canon"],
  ["B", "004", "sekolah_dan_kelas", "2010/2011", "canon"],
  ["A", "005", "sekolah_dan_kelas", "2010/2011", "archived"],
  ["B", "006", "rumah_dan_keluarga", "2010/2011", "archived"],
  ["A", "007", "rumah_dan_keluarga", "2009/2010", "au"],
  ["A", "009", "teman_dan_permainan", "2010/2011", "draft"],
  ["A", "011", "kantin_dan_perjalanan", "2009/2010", "canon"],
  ["A", "013", "hobi_dan_imajinasi", "2009/2010", "archived"],
  ["A", "015", "hal_kecil_yang_membekas", "2009/2010", "au"],
  ["A", "017", "kesan_sepintas_tentang_pit", "2010/2011", "draft"],
] as const;

export type SyntheticMemory = {
  id: string;
  memory_key: string;
  owner_id: string;
  title: string;
  memory_text: string;
  perspective: "charmaine";
  period: string;
  school_year: string;
  event_year: number;
  category: string;
  people: string[];
  tags: string[];
  emotion: string;
  clarity: "unspecified";
  origin: "synthetic_local_integration";
  canon_status: "draft" | "canon" | "archived" | "au";
  importance: number;
  details: {
    synthetic: true;
    fixture_owner: "A" | "B";
    memory_type?: "plan";
    expected_at?: string;
  };
  created_at: string;
};

/** Owners come from the isolated local Auth Admin API, never from production. */
export function makeMemories(
  ownerA: string,
  ownerB: string,
): SyntheticMemory[] {
  return ROWS.map(([owner, suffix, category, school_year, canon_status]) => {
    const memory_key = `LOCAL-${suffix}`;
    return {
      id: `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
      memory_key,
      owner_id: owner === "A" ? ownerA : ownerB,
      title: `LOCAL FIXTURE ${memory_key}`,
      memory_text: `LOCAL FIXTURE shared-fixture ${owner}_ONLY ${memory_key}`,
      perspective: "charmaine",
      period: "local-integration-fixture",
      school_year,
      event_year: Number(school_year.slice(0, 4)),
      category,
      people: [],
      tags: ["local-integration", "synthetic"],
      emotion: "fixture",
      clarity: "unspecified",
      origin: "synthetic_local_integration",
      canon_status,
      importance: 1,
      details: suffix === "017"
        ? {
          synthetic: true,
          fixture_owner: owner,
          memory_type: "plan",
          expected_at: "2030-01-01T09:00:00+07:00",
        }
        : { synthetic: true, fixture_owner: owner },
      created_at: `2020-01-01T00:00:${
        String(Number(suffix)).padStart(2, "0")
      }.000Z`,
    };
  });
}

// Independent expected key lists; each list's length is its RLS-visible total.
export const EXPECTED = {
  ownerA: {
    all: [
      "LOCAL-001",
      "LOCAL-003",
      "LOCAL-005",
      "LOCAL-007",
      "LOCAL-009",
      "LOCAL-011",
      "LOCAL-013",
      "LOCAL-015",
      "LOCAL-017",
    ],
    year2009: [
      "LOCAL-001",
      "LOCAL-003",
      "LOCAL-007",
      "LOCAL-011",
      "LOCAL-013",
      "LOCAL-015",
    ],
    year2010: ["LOCAL-005", "LOCAL-009", "LOCAL-017"],
    school: ["LOCAL-001", "LOCAL-003", "LOCAL-005"],
    schoolYear2009: ["LOCAL-001", "LOCAL-003"],
  },
  ownerB: {
    all: ["LOCAL-002", "LOCAL-004", "LOCAL-006"],
    year2009: ["LOCAL-002"],
    year2010: ["LOCAL-004", "LOCAL-006"],
    school: ["LOCAL-002", "LOCAL-004"],
    schoolYear2009: ["LOCAL-002"],
  },
} as const;
