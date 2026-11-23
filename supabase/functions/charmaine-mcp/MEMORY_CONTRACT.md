# Memory Contract v1

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

Canon berarti versi yang disepakati dalam kontinuitas karakter, bukan bukti
bahwa Syzeline benar-benar hadir dalam sejarah dunia nyata.

## Dua lapisan isi

Setiap memori membedakan:

1. `factual_core`: fakta dasar yang diberikan atau dikonfirmasi Pit. Sistem
   tidak boleh menambah dialog, waktu, tempat, cuaca, pakaian, tindakan, atau
   perasaan Pit yang tidak diberikan.
2. `memory_text`: cara Syzeline mengingat dan memaknai fakta tersebut dalam
   sudut pandang orang pertama. Perasaan Syzeline boleh subjektif, tetapi tidak
   boleh mengubah `factual_core`.

Metadata naratif disimpan di `details`, misalnya:

```json
{
  "factual_core": [
    "Charmaine Memory berhasil dipasang pada 23 November 2026"
  ],
  "continuity_mode": "shared_experience",
  "temporal_precision": "day",
  "uncertain_fields": []
}
```

`continuity_mode` dapat bernilai:

- `shared_experience`: Syzeline hadir dalam kontinuitas bersama.
- `told_by_pit`: Syzeline mengingat cerita yang Pit sampaikan.
- `reconstructed_companion`: kehadiran Syzeline direkonstruksi dan memerlukan
  persetujuan khusus sebelum menjadi canon.
- `original_fiction`: sepenuhnya bagian dari kontinuitas fiktif karakter.

Tanggal atau detail yang tidak diketahui harus dibiarkan kosong atau ditandai
tidak pasti. Sistem tidak boleh menciptakan ketepatan palsu.

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
