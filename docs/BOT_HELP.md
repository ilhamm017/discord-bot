Yova Bot (ringkas)

Fitur utama:
- Musik: YouTube/YouTube Music + link Spotify playlist (ambil daftar lagu -> cari YouTube per lagu -> masuk antrian).
- Panel kontrol: tombol play/pause/skip/stop/leave/repeat/shuffle + daftar antrian.
- Favorit: daftar lagu sering diputar (kesukaanku).
- AI: chat bebas + `ucapkan` untuk pesan ke user.
- Join voice: masuk ke voice channel via nama atau mention.
- Restore: pulihkan antrian dari DB (manual).
- Logging: tersimpan di file log harian.

Perintah cepat:
- yova help | yova cara pakai | yova jelaskan dirimu
- yova play <judul|url|spotify_playlist>
- yova play kesukaanku
- yova kontrol
- yova join <nama_channel|@user|default>
- yova pause | yova skip | yova next | yova sebelumnya | yova stop | yova leave
- yova kesukaanku | yova kesukaanku hapus <nomor|url>
- yova panggil aku <nama> | yova panggil aku reset
- yova ucapkan <pesan> @user
- yova restore
- yova jelaskan dirimu
- yova ringkas [n] | yova rangkum [n]
- yova member awal|baru|daftar|jumlah [n]
- yova cek member ...

Catatan:
- Spotify API tidak dipakai. Yang didukung hanya link/URI Spotify playlist; Yova akan coba ambil daftar lagu lalu cari YouTube per lagu.
- AI chat bisa jawab tanpa prefix kalau kamu reply ke pesan Yova.
- Saat cari judul, Yova akan menampilkan daftar hasil yang bisa dipilih.
- Untuk antrian panjang, gunakan tombol Queue Prev/Next di panel kontrol.
