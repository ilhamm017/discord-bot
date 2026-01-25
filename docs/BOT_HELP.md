Yova Bot (ringkas)

Fitur utama:
- Musik: YouTube/YouTube Music + link Spotify (metadata Spotify -> playback YouTube), pencarian judul menampilkan pilihan YT/Spotify.
- Panel kontrol: tombol play/pause/skip/stop/leave/repeat/shuffle + daftar antrian.
- Favorit: daftar lagu sering diputar (kesukaanku).
- AI: chat bebas + `ucapkan` untuk pesan ke user.
- Join voice: masuk ke voice channel via nama atau mention.
- Restore: pulihkan antrian dari DB (manual).
- Logging: tersimpan di file log harian.

Perintah cepat:
- yova play <judul|url|spotify>
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
- Spotify butuh `spotify_client_id` + `spotify_client_secret` di config.json.
- AI chat bisa jawab tanpa prefix kalau kamu reply ke pesan Yova.
- Saat cari judul, Yova akan menampilkan daftar hasil yang bisa dipilih.
