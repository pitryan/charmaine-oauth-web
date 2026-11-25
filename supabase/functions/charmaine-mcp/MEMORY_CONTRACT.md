# Memory Contract v2

## Tujuan

`charmaine_memories` menyimpan ingatan autobiografis jangka panjang Syzeline,
bukan daftar tugas, kalender, atau project tracker.

Memori baru hanya memakai tiga jenis:

- `event`: sesuatu yang telah terjadi.
- `fact`: informasi yang dianggap benar dalam konteksnya.
- `state`: keadaan yang benar pada suatu masa.

Rencana biasa tidak disimpan sebagai memori. Jika momen membuat keputusan memang
penting, simpan kejadian yang sudah terjadi, misalnya "hari ketika kami
memutuskan membangun Charmaine Memory". Data lama bertipe `plan` tetap dapat
dibaca untuk kompatibilitas, tetapi pembuatan memori baru tidak menerimanya.

## Draft dan canon

- `draft` adalah calon ingatan yang belum dikonfirmasi. Draft tidak boleh
  digunakan Syzeline sebagai fakta pasti.
- `canon` adalah versi ingatan yang secara eksplisit telah disetujui pemilik
  sebagai benar dalam kontinuitas Pit-Syzeline.
- Memori selalu dibuat sebagai `draft`.
- Promosi ke `canon` hanya terjadi setelah perintah yang jelas seperti "jadikan
  canon". Persetujuan tidak boleh disimpulkan dari jawaban samar, emoji, atau
  kelanjutan percakapan biasa.
- Tool promosi mewajibkan `memory_key`, judul yang diharapkan, dan konfirmasi
  persis `JADIKAN CANON`. Promosi dijalankan sebagai satu transaksi atomik agar
  tidak menimpa koreksi yang berlangsung bersamaan.

Canon berarti versi yang disepakati dalam kontinuitas karakter, bukan bukti
bahwa Syzeline benar-benar hadir dalam sejarah dunia nyata.

## Dua lapisan isi

Setiap memori membedakan:

1. `factual_core`: satu atau lebih fakta dasar yang diberikan atau dikonfirmasi
   Pit. Field ini wajib untuk setiap memori baru. Sistem tidak boleh menambah
   dialog, waktu, tempat, cuaca, pakaian, tindakan, atau perasaan Pit yang tidak
   diberikan.
2. `memory_text`: cara Syzeline mengingat dan memaknai fakta tersebut dalam
   sudut pandang orang pertama. Perasaan Syzeline boleh subjektif, tetapi tidak
   boleh mengubah `factual_core`.

`perspective` selalu dikunci ke `charmaine`. Ingatan tentang cerita Pit tetap
ditulis sebagai pengalaman batin Syzeline yang mendengar cerita tersebut, bukan
dengan mengganti perspektif record menjadi Pit.

Metadata semantik disimpan di `details`, tetapi diterima dan dikembalikan
sebagai argumen serta output MCP bertipe. Metadata internal seperti
`idempotency_key` dan `request_hash` tidak pernah dikembalikan oleh tool baca.
Contoh:

```json
{
  "factual_core": [
    "Charmaine Memory berhasil dipasang pada 23 November 2026"
  ],
  "continuity_mode": "shared_experience",
  "temporal_precision": "day",
  "occurred_on": "2026-11-23",
  "uncertain_fields": []
}
```

`continuity_mode` dapat bernilai:

- `shared_experience`: Syzeline hadir dalam kontinuitas bersama.
- `told_by_pit`: Syzeline mengingat cerita yang Pit sampaikan.
- `reconstructed_companion`: kehadiran Syzeline direkonstruksi. Sifat
  rekonstruksi ini harus dijelaskan secara eksplisit sebelum konfirmasi canon
  yang sama diberikan.
- `original_fiction`: sepenuhnya bagian dari kontinuitas fiktif karakter.

`uncertain_fields` mencatat nama field yang nilainya masih perlu diperlakukan
sebagai tidak pasti. Ketidakpastian tidak boleh disembunyikan dengan narasi yang
terdengar meyakinkan.

## Waktu kejadian

`temporal_precision` selalu memakai salah satu nilai berikut:

- `instant`: waktu dan offset benar-benar diketahui; gunakan `occurred_at`
  berformat RFC 3339.
- `day`: tanggal diketahui tetapi jam tidak; gunakan `occurred_on` berformat
  `YYYY-MM-DD` dan jangan menciptakan jam tengah malam palsu.
- `year`: hanya tahun yang diketahui; gunakan `event_year`.
- `period`: hanya masa yang lebih luas diketahui; gunakan `period`,
  `school_year`, atau `temporal_note`.
- `unknown`: tidak ada jangkar waktu yang cukup kuat.

Representasi yang saling bertentangan ditolak. Jika `event_year` ikut diberikan
bersama waktu atau tanggal yang lebih presisi, tahunnya harus sama. `fact` dan
`state` boleh memakai `unknown`; semua memori boleh tidak memiliki tanggal jika
memang tidak diketahui. Tanggal atau detail yang tidak diketahui harus dibiarkan
kosong atau ditandai tidak pasti. Sistem tidak boleh menciptakan ketepatan
palsu.

Promosi hanya mengubah status draft menjadi canon dan mencatat waktu promosi.
Promosi tidak boleh menambah atau mengganti waktu kejadian. Perubahan waktu
kejadian harus dilakukan sebagai koreksi sehingga hasilnya kembali menjadi draft
untuk ditinjau ulang.

## Pemanggilan kembali

Tool baca mengembalikan `factual_core`, `continuity_mode`, `temporal_precision`,
`uncertain_fields`, serta jangkar waktu yang aman bersama `memory_text`.
Pencarian literal memeriksa judul dan isi cerita. Fakta dasar dan persepsi
Syzeline harus tetap dibaca sebagai dua lapisan yang berbeda ketika memori
digunakan dalam percakapan.

## Koreksi

Koreksi mengganti isi record milik pengguna yang sama, bukan membuat salinan
tersembunyi. Koreksi terhadap draft tetap berstatus `draft`. Koreksi terhadap
canon selalu mengembalikannya menjadi `draft`, sehingga versi yang sudah
diperbaiki harus dikonfirmasi kembali sebelum dapat dipakai sebagai canon.

Sistem tidak menyimpan isi lama di `details`, tabel revisi, atau record arsip.

## Hapus permanen

Penghapusan adalah hard delete berdasarkan `memory_key` dan pemilik dari sesi
OAuth. Setelah berhasil:

- record tidak lagi berada di `charmaine_memories`;
- MCP tidak membuat tombstone, arsip, salinan revisi, atau salinan isi;
- record tidak dapat dicari, dibaca, atau dipromosikan lagi.

Penghapusan harus memakai target yang jelas dan konfirmasi eksplisit. Respons
untuk record yang tidak ada atau milik pengguna lain harus sama agar tidak
membocorkan keberadaan data lintas pemilik.

Karena tidak ada tombstone, `idempotency_key` milik record yang sudah dihapus
menjadi bebas kembali. Klien tidak boleh mengirim ulang permintaan
`create_memory` lama setelah penghapusan karena permintaan itu dapat membuat
record baru dengan isi yang sama.

Kontrak ini menjamin tidak ada retensi di tingkat aplikasi. Retensi yang mungkin
terjadi pada backup, write-ahead log (WAL), atau log infrastruktur Supabase
mengikuti kebijakan penyedia dan tidak boleh diklaim sebagai penghapusan fisik
seketika dari seluruh media cadangan.

## Batas keamanan

Jangan menyimpan password, token, API key, nomor kartu, dokumen identitas
lengkap, alamat rinci, atau rahasia pihak ketiga sebagai memori.
