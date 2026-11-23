# Integrasi OAuth dan RLS lokal

Suite ini menjalankan Supabase terpisah di Docker, dua akun uji, dan 12 memori
sintetis. Runner menyalin implementasi `charmaine-mcp` dari checkout yang diuji,
sehingga pengujian HTTP memakai fungsi dan PostgreSQL lokal yang nyata. Schema
di `supabase/migrations/` adalah **model pengujian dari dokumen konteks**, bukan
ekspor schema produksi atau bukti bahwa policy produksi identik.

## Menjalankan

Prasyarat pada `PATH`: Deno **2.9.8**, Supabase CLI **3.1.0**, serta Docker CLI
dengan engine lokal aktif. Runner menolak versi CLI berbeda dan Docker remote;
socket Unix atau named pipe lokal diperlukan. Pengunduhan image/dependency
pertama memerlukan jaringan. Tidak diperlukan login Supabase, project link, file
`.env`, atau kredensial hosted.

Dari root repository:

```sh
deno task --config tests/integration/deno.json check
deno task --config tests/integration/deno.json test:guards
deno task --config tests/integration/deno.json lint
deno task --config tests/integration/deno.json fmt
deno task --config tests/integration/deno.json test
```

Empat perintah pertama memeriksa tipe, pembatas alamat lokal, lint, dan format.
Perintah terakhir menyalakan stack dan menjalankan integrasi. Hasil pemeriksaan
statis atau guard tidak membuktikan bahwa integrasi lulus.

| Kegunaan                                             |  Port |
| ---------------------------------------------------- | ----: |
| API/Auth/PostgREST/Edge Function                     | 55431 |
| PostgreSQL                                           | 55432 |
| Redirect callback OAuth, hanya diperiksa sebagai URL | 55430 |
| Shadow database                                      | 55429 |

HTTP hanya diizinkan ke `http://127.0.0.1:55431`; redirect diperiksa manual
tanpa diikuti otomatis. Tidak ada server callback pada port 55430. Runner
menolak memulai jika port API sudah dipakai. Pastikan port database/shadow juga
tersedia.

## Siklus dan batas akses

Runner membuat direktori unik `.work/run-*` dan project ID
`charmaine-integration-*`, lalu menyalin konfigurasi, migration model uji,
source, dan lockfile fungsi. Signing key ES256 dan password baru dibuat setiap
run; file sementara berada di `.work/` yang diabaikan Git.

Subprocess memakai environment terbatas dan `SUPABASE_HOME` terpisah. Token
hosted dan konfigurasi Supabase dari environment tidak diteruskan. Runner
membaca status lokal dalam memori, membuat akun A/B melalui Auth Admin API
lokal, lalu memasukkan fixture melalui REST dengan service-role hanya saat
bootstrap. Output status berisi kredensial tidak dicetak.

Proses assertion hanya menerima URL lokal, publishable key, dan akun uji.
Service-role dan private signing key tidak diteruskan. Token pengguna diperoleh
melalui OAuth authorization-code dengan PKCE; akses file dan subprocess ditolak
saat assertion. `verify_jwt = false` pada gateway lokal membiarkan discovery
mencapai fungsi; middleware OAuth dan klien pengguna di `index.ts` tetap utuh.
JWT lokal sengaja berumur pendek untuk menguji kedaluwarsa tanpa token palsu.

Setelah berhasil maupun assertion gagal, `finally` menghentikan hanya project
milik run dengan `stop --no-backup`, lalu menghapus direktori sementara setelah
stack berhenti. Jika proses dipaksa berhenti (termasuk Ctrl-C) atau cleanup
gagal, temukan direktori `.work/run-*` milik run dan project ID dari
`supabase/config.toml` di dalamnya. Hentikan hanya pasangan itu:

```sh
supabase stop --no-backup --project-id <owned-project-id> --workdir <owned-run-directory>
```

Sesudah stack berhenti, hapus hanya direktori run yang telah diverifikasi berada
di `tests/integration/.work/`. Jangan gunakan `--all`, menghapus project lain,
atau menyimpan file key sementara sebagai artifact/log.

## Fixture dan ekspektasi

`fixtures.ts` menyediakan `makeMemories(ownerA, ownerB)` dan `EXPECTED`.
Identitas pemilik berasal dari akun baru. UUID/key/timestamp record
deterministik; cerita hanya teks penanda
`LOCAL FIXTURE shared-fixture A_ONLY/B_ONLY <key>`. Semua memakai
`clarity: unspecified`, `origin: synthetic_local_integration`, dan
`details.synthetic: true`.

| Filter              | Total A | Total B |
| ------------------- | ------: | ------: |
| Tanpa filter        |       9 |       3 |
| Tahun 2009/2010     |       6 |       1 |
| Tahun 2010/2011     |       3 |       2 |
| sekolah             |       3 |       2 |
| sekolah + 2009/2010 |       2 |       1 |

Key berselang antarpemilik. Pada limit 2, halaman A dimulai `001,003`, lalu
`005,007`; B `002,004`, lalu `006`. Total tetap 9 dan 3. Penanda `A_ONLY`/
`B_ONLY` menguji kebocoran `search_memories`. Ketujuh kategori dan keempat
status editorial disertakan; metadata harus tetap seperti fixture.

Model RLS memberi `authenticated` SELECT, INSERT kolom terbatas, dan UPDATE
hanya untuk `canon_status` serta `details`. Semua policy mensyaratkan
`owner_id = auth.uid()` dan klaim `client_id` tidak kosong. Insert tidak dapat
menentukan `owner_id` atau `canon_status`, sedangkan update hanya mengizinkan
transisi draft milik sendiri menjadi canon. Hak `anon`/`PUBLIC` dicabut. Token
login biasa tanpa `client_id` tidak memperoleh atau menulis baris memori. Grant
service-role hanya dipakai untuk bootstrap fixture lokal.

## Cakupan verifikasi

Suite menguji HTTP OAuth/consent, kelima tool MCP, filter, pagination, exact
total, idempotensi create, promosi draft ke canon, dan isolasi RLS dua pengguna.
Tidak menjalankan browser Next.js atau klien ChatGPT, tidak membuktikan kesamaan
konfigurasi produksi, dan bukan audit keamanan menyeluruh. Pencabutan grant
tidak harus langsung membatalkan JWT yang belum kedaluwarsa pada verifier JWKS;
jangan mengasumsikan introspeksi sesi.

Workflow `.github/workflows/charmaine-integration.yml` menjalankan stack
container sementara di GitHub Actions tanpa secret hosted atau deployment. Host
Windows saat penyiapan belum memiliki Docker; hasil integrasi harus diambil dari
run lengkap atau CI, bukan dari pemeriksaan statis.

Pemeriksaan manual terpisah pada lingkungan uji masih diperlukan untuk tampilan
login/consent dan navigasi callback Next.js di browser, serta koneksi dan
pemilihan tool dalam percakapan ChatGPT. Pengujian itu tidak dijalankan oleh
task ini. Tidak ada perintah link, push database, atau deployment dalam runner.
