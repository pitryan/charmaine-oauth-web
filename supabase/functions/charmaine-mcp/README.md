# Charmaine MCP

Edge Function Deno untuk `ping`, `search_memories`, `list_memories`,
`create_memory`, dan `promote_memory`. Website persetujuan OAuth tetap
menggunakan Next.js di root repository.

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

`school_year`, `period`, `event_year`, `category`, `memory_type`, dan
`canon_status` merupakan filter opsional yang dapat digabungkan. Status yang
ditawarkan tool saat ini hanya `draft` dan `canon`; nilai editorial lama tetap
dipertahankan di database. `limit` bernilai 1–20 (default 10), dan `offset`
merupakan bilangan bulat nonnegatif (default 0). Urutan tetap `memory_key`
menaik. Respons JSON di dalam konten teks MCP mempertahankan:

- `count`: jumlah memori pada halaman ini.
- `total`: jumlah seluruh memori yang cocok dengan filter dan diizinkan RLS,
  sebelum pagination.
- `offset`: posisi awal halaman.
- `memories`: data hasil query, termasuk `canon_status` dan `clarity` asli.

Metadata percakapan dari `details` disajikan sebagai `memory_type`,
`expected_at`, `occurred_at`, dan `canonization`. Nilai internal seperti
`idempotency_key` dan `request_hash` tidak pernah dikembalikan oleh tool baca.

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
deno check --frozen=false index.ts list_memories_test.ts \
  memory_output_test.ts create_memory_test.ts promote_memory_test.ts
```

`vercel.json` di root menonaktifkan deployment website otomatis. Workflow
`charmaine-mcp.yml` memeriksa fungsi pada Pull Request. Push perubahan fungsi ke
`main` juga memicu `deploy-charmaine-mcp.yml`, yang menguji lalu men-deploy Edge
Function produksi. Migration SQL tidak diterapkan oleh workflow tersebut dan
harus ditinjau serta diterapkan **sebelum** perubahan fungsi digabungkan atau
dipush ke `main`. Jika urutannya terbalik, tool tulis dapat terlihat tetapi akan
gagal karena grant dan policy produksinya belum tersedia.

## Kesesuaian konteks proyek

`CHARMAINE_PROJECT_CONTEXT.md` versi 1.0 (2026-11-16), yang diberikan pengguna,
menjadi referensi tujuan dan batas proyek. Saat dibandingkan dengan source pada
2026-11-16:

- Bagian 8.3 tentang filter kategori persis sesuai dengan `main` pada commit
  `18f0d483`. Branch PR #1 menambahkan normalisasi alias sebelum filter `.eq`
  yang sama. Status "IN PROGRESS" dalam dokumen mencakup pengerjaan yang kini
  siap ditinjau; bukan bukti bahwa kode PR sudah aktif di endpoint produksi.
- `search_memories` tetap mencari substring pada `memory_text` saja, tetapi
  dapat difilter ke `draft` atau `canon`. Pencarian judul, tokoh, tags, dan
  semantic retrieval tetap roadmap.
- Dokumen menyatakan 73 memori kelas 1 seluruhnya `draft`. Fixture tes dengan
  status campuran dan tahun lain adalah data sintetis untuk menguji perilaku,
  bukan salinan atau laporan isi database. Pengujian mempertahankan keempat
  status `draft`, `canon`, `archived`, `au`, serta `clarity: unspecified`.
- Schema produksi dan policy baca diverifikasi kembali pada 2026-11-23 sebelum
  migration write disusun. Repository menyimpan migration write yang tetap harus
  diterapkan secara manual; fixture integrasi tetap bukan salinan data produksi.

## Verifikasi lanjutan setelah persetujuan terpisah

Suite integrasi lokal menggunakan schema sintetis, dua akun OAuth, dan kelima
tool MCP. Suite menguji pembuatan draft idempotent, promosi milik sendiri,
penolakan akses silang akun, token tanpa `client_id`, serta pembatasan hasil dan
`total`. Deployment dan penerapan migration produksi tetap langkah terpisah.

Jika endpoint uji sudah menjalankan revisi PR, gunakan contoh berikut melalui
klien MCP/ChatGPT. Angka di bawah hanya berlaku bila dataset uji meniru
distribusi kelas 1 dalam dokumen dan akun memiliki akses ke seluruh baris
tersebut:

| Argumen `list_memories`                                                             | Hasil yang diharapkan                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `{"school_year":"2009/2010","category":"sekolah","limit":5,"offset":0}`             | `count: 5`, `total: 14`, kategori `sekolah_dan_kelas`                  |
| `{"school_year":"2009/2010","category":"sekolah_dan_kelas","limit":10,"offset":10}` | `count: 4`, `total: 14`                                                |
| `{"school_year":"2009/2010","limit":5,"offset":0}`                                  | `count: 5`, `total: 73`                                                |
| `{"school_year":"2010/2011","limit":5,"offset":0}`                                  | `count: 0`, `total: 0` jika tidak ada baris kelas 2 yang diizinkan RLS |

Bandingkan alias dengan nama baku memakai `school_year`, `limit`, dan `offset`
yang sama: ID, urutan, total, dan metadata harus identik. Nilai `total` untuk
akun dengan akses lebih terbatas harus mengikuti RLS. Jangan menyimpulkan
keadaan produksi dari hasil fixture atau dari angka dalam dokumen konteks.

Sebelum merge, rollback cukup dengan menutup PR tanpa menerapkannya. Jika
perubahan source sudah digabungkan, gunakan revert commit melalui PR terpisah.
Revert GitHub tidak otomatis mengembalikan revisi Edge Function atau migration;
rollback runtime dan policy database harus dilakukan terpisah.

## Batas arsitektur

`index.ts` tetap memasang `withOAuthProtectedResource()` diikuti
`withSupabase({ auth: "user" })`. Semua modul menerima klien pengguna dari
request yang sama, sehingga baca dan tulis tetap tunduk pada RLS. Tidak ada
klien admin. `create_memory` tidak menerima `owner_id` atau `canon_status` dan
selalu memakai default database `draft`; `promote_memory` hanya melakukan
transisi milik pengguna dari `draft` ke `canon`.

Aturan gaya bicara dan autobiografi karakter berada di luar lapisan
penyimpanan/pencarian ini. Persona sebaiknya disimpan dalam instruksi agent,
sedangkan MCP hanya menyimpan dan mengambil data memori. Pengujian lokal tidak
mengklaim memverifikasi deployment produksi.

Konfigurasi per fungsi mengikuti
[panduan dependency Supabase](https://supabase.com/docs/guides/functions/dependencies)
dan [konfigurasi Deno](https://docs.deno.com/runtime/reference/deno_json/).
