# lavalink

Komponen server Lavalink untuk audio streaming musik.

## Isi Utama
- `application.yml`: konfigurasi server Lavalink.
- `logs/`, `lavalink_server.log`: log proses Lavalink.

Catatan:
- Binary `Lavalink.jar`, plugin, dan Java runtime tidak perlu disimpan di Git.
- Untuk deployment Docker, binary Lavalink diunduh saat image build.
- Untuk runtime non-Docker, aplikasi akan memakai Java sistem jika `lavalink/jre/bin/java` tidak ada.

## Aturan
- Ubah `application.yml` saat perlu tuning koneksi/audio.
- Pantau log jika playback bermasalah.
