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

`vercel.json` di root menonaktifkan deployment otomatis untuk `main` dan branch
review `codex/list-memories-category-aliases`, sesuai
[konfigurasi Git Vercel](https://vercel.com/docs/project-configuration/git-configuration).
Blokir `main` harus tetap ada saat merge agar perubahan GitHub tidak memicu
deployment website. Pengaktifan kembali deployment Vercel dan deployment manual
Edge Function Supabase merupakan langkah terpisah setelah persetujuan pengguna.
Workflow MCP hanya menjalankan pemeriksaan dan tidak melakukan deployment.

## Kesesuaian konteks proyek

`CHARMAINE_PROJECT_CONTEXT.md` versi 1.0 (2026-11-16), yang diberikan pengguna,
menjadi referensi tujuan dan batas proyek. Saat dibandingkan dengan source pada
2026-11-16:

- Bagian 8.3 tentang filter kategori persis sesuai dengan `main` pada commit
  `18f0d483`. Branch PR #1 menambahkan normalisasi alias sebelum filter `.eq`
  yang sama. Status "IN PROGRESS" dalam dokumen mencakup pengerjaan yang kini
  siap ditinjau; bukan bukti bahwa kode PR sudah aktif di endpoint produksi.
- `search_memories` tetap mencari substring pada `memory_text` saja. Pencarian
  judul, tokoh, tags, semantic retrieval, dan tool editorial tetap roadmap.
- Dokumen menyatakan 73 memori kelas 1 seluruhnya `draft`. Fixture tes dengan
  status campuran dan tahun lain adalah data sintetis untuk menguji perilaku,
  bukan salinan atau laporan isi database. Pengujian mempertahankan keempat
  status `draft`, `canon`, `archived`, `au`, serta `clarity: unspecified`.
- Detail schema, `owner_id = auth.uid()`, dan syarat klaim OAuth `client_id`
  dilaporkan oleh dokumen. Repository belum memiliki migration/policy/seed untuk
  memverifikasi atau mereproduksi keadaan database itu. PR ini tidak mengubah
  maupun mengaudit ulang kebijakan produksi.

## Verifikasi lanjutan setelah persetujuan terpisah

Langkah berikutnya adalah review PR, lalu menyiapkan pengujian integrasi lokal
atau staging dengan schema dan RLS yang telah diperiksa, data sintetis, serta
dua akun uji. Uji OAuth login, approve/deny consent, token tidak
valid/kedaluwarsa, ketiga tool MCP, serta pembatasan hasil dan `total` untuk
masing-masing pengguna. Persiapan lingkungan dan deployment bukan bagian dari PR
alias ini.

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
Revert GitHub tidak otomatis mengembalikan revisi Edge Function; rollback
runtime setelah deployment memerlukan persetujuan terpisah. Tidak ada
migrasi/data yang perlu di-rollback dalam perubahan ini.

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
