# Charmaine MCP

Edge Function Deno untuk `ping`, `search_memories`, dan `list_memories`. Website
persetujuan OAuth tetap menggunakan Next.js di root repository.

## Filter `list_memories`

| Kategori baku                | Alias                        |
| ---------------------------- | ---------------------------- |
| `rumah_dan_keluarga`         | `rumah`, `keluarga`          |
| `sekolah_dan_kelas`          | `sekolah`, `kelas`, `sd`     |
| `teman_dan_permainan`        | `teman`, `permainan`, `main` |
| `kantin_dan_perjalanan`      | `kantin`, `perjalanan`       |
| `hobi_dan_imajinasi`         | `hobi`, `imajinasi`          |
| `hal_kecil_yang_membekas`    | `hal kecil`, `momen kecil`   |
| `kesan_sepintas_tentang_pit` | `pit`, `kesan tentang pit`   |

Nama baku dan alias dicocokkan setelah trim, lowercase, dan penyamaan pemisah
spasi, underscore, serta tanda hubung. Contoh: `SEKOLAH--DAN KELAS` menjadi
`sekolah_dan_kelas`; `Momen-Kecil` menjadi `hal_kecil_yang_membekas`. Pencocokan
harus lengkap, tanpa fuzzy search, prefix, atau substring. Kategori yang tidak
dikenal tetap diteruskan sebagai filter persis sehingga kategori baru tetap
dapat digunakan langsung dan salah ketik tidak menghilangkan filter.

Tambahkan kategori/alias periode berikutnya ke `CATEGORY_ALIASES` di
`categories.ts`, lalu tambahkan kasus uji. Alias yang bertabrakan antar kategori
ditolak saat modul dimuat. Pemetaan tidak bergantung pada tahun ajaran atau
jumlah memori dan tidak mengubah data tersimpan.

`school_year` tetap merupakan filter persis, misalnya `2009/2010`. Jika kedua
filter diberikan, keduanya harus cocok. `limit` bernilai 1–20 (default 10), dan
`offset` merupakan bilangan bulat nonnegatif (default 0). Urutan tetap
`memory_key` menaik. Respons JSON di dalam konten teks MCP mempertahankan:

- `count`: jumlah memori pada halaman ini.
- `total`: jumlah seluruh memori yang cocok dengan filter dan diizinkan RLS,
  sebelum pagination.
- `offset`: posisi awal halaman.
- `memories`: data hasil query, termasuk `canon_status` dan `clarity` asli.

## Pengujian lokal

Gunakan Deno 2. Dari root repository:

```sh
deno task --config supabase/functions/charmaine-mcp/deno.json check
deno task --config supabase/functions/charmaine-mcp/deno.json test
deno task --config supabase/functions/charmaine-mcp/deno.json lint
deno task --config supabase/functions/charmaine-mcp/deno.json fmt
```

Pengujian memakai fixture sintetis dan melarang akses jaringan, environment,
baca/tulis file saat test berjalan. Pengunduhan dependency pada resolusi modul
pertama tetap memerlukan jaringan. Tidak diperlukan kredensial, server Supabase,
atau data produksi. `deno.lock` mengunci dependency fungsi;
`nodeModulesDir: none` memisahkannya dari dependency Next.js. TypeScript dan
ESLint Next.js mengecualikan `supabase/functions/**`; jalankan pemeriksaan Deno
di atas secara terpisah.

Workflow `.github/workflows/charmaine-mcp.yml` menjalankan keempat pemeriksaan
tersebut pada Pull Request yang mengubah fungsi. Lockfile dibekukan saat
validasi. Untuk pembaruan dependency yang disengaja, jalankan perintah berikut
dari direktori fungsi, lalu tinjau perubahan lockfile:

```sh
deno check --frozen=false index.ts list_memories_test.ts
```

`vercel.json` di root menonaktifkan deployment otomatis hanya untuk branch
review `codex/list-memories-category-aliases`, sesuai
[konfigurasi Git Vercel](https://vercel.com/docs/project-configuration/git-configuration).
Workflow MCP hanya menjalankan pemeriksaan dan tidak melakukan deployment.

## Batas arsitektur

`index.ts` tetap memasang `withOAuthProtectedResource()` diikuti
`withSupabase({ auth: "user" })`. Modul daftar menerima klien pengguna dari
request yang sama, sehingga query dan total tetap tunduk pada RLS. Tidak ada
klien admin, operasi tulis database, atau perubahan status `draft` menjadi
`canon`.

`categories.ts` menangani kosakata pencarian dan `list_memories.ts` menangani
schema, query baca, serta format respons. Aturan gaya bicara dan autobiografi
karakter berada di luar lapisan penyimpanan/pencarian ini. Pengujian lokal tidak
mengklaim memverifikasi kebijakan RLS atau autentikasi pada deployment produksi.

Konfigurasi per fungsi mengikuti
[panduan dependency Supabase](https://supabase.com/docs/guides/functions/dependencies)
dan [konfigurasi Deno](https://docs.deno.com/runtime/reference/deno_json/).
