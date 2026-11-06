# 🎙️ Line Studio

Deine Freunde öffnen einen Link, tippen auf ihren Namen, geben ihr Passwort ein und nehmen ihre Lines auf.
Aufgenommen wird **unkomprimiert in Studio-Qualität (WAV, 24 Bit, 48 kHz)**, ohne die Filter, mit denen der Browser die Stimme sonst „glättet“.
Du schreibst die Lines in der **Regie** und lädst dort alle Aufnahmen herunter.

---

## Einrichtung (ca. 10 Minuten, alles kostenlos)

### 1. Supabase (Datenbank + Speicher für die Audios)

1. Auf **https://supabase.com** ein Konto erstellen und **New project** anlegen (Name egal, Region z. B. *Frankfurt*). Das Datenbank-Passwort brauchst du später nicht.
2. Links auf **SQL Editor** gehen, den kompletten Inhalt von [`supabase.sql`](supabase.sql) einfügen und **Run** drücken. Es sollte „Success“ erscheinen.
3. Links auf **Project Settings → API** (heißt manchmal auch „Data API“ / „API Keys“) gehen und zwei Dinge kopieren:
   - die **Project URL** (`https://xxxx.supabase.co`)
   - den **anon public** Key (beginnt mit `eyJ…`) **oder** den **publishable** Key (`sb_publishable_…`)
   ⚠️ Niemals den `service_role`- oder `secret`-Key nehmen.

### 2. Website auf GitHub Pages

1. Auf **https://github.com/new** ein neues **Public**-Repository anlegen, z. B. `line-studio`.
2. Auf **„uploading an existing file“** klicken und alle Dateien aus diesem Ordner hineinziehen:
   `index.html`, `app.js`, `recorder.js`, `style.css`, `config.js` (`supabase.sql` und `README.md` sind optional). Dann **Commit changes**.
3. Im Repo die Datei **`config.js`** öffnen, auf den Stift ✏️ klicken und URL + Key aus Schritt 1.3 eintragen. **Commit changes**.
4. **Settings → Pages**: Bei *Source* „Deploy from a branch“ wählen, Branch **main** / **(root)**, **Save**.
5. Nach ca. 1 Minute ist die Seite online unter
   `https://DEIN-NAME.github.io/line-studio/`

### 3. Loslegen

1. Öffne `https://DEIN-NAME.github.io/line-studio/#/admin` (oder klick unten auf der Startseite auf **Regie**).
2. Beim ersten Mal legst du dein **Admin-Passwort** fest. Das geht nur ein einziges Mal, also mach das gleich.
3. **+ Sprecher** → Name (z. B. *Skade*) und Passwort eingeben.
4. Lines ins Textfeld tippen, **eine pro Zeile**, dann **Hinzufügen**.
   Unter jeder Line kannst du eine **Regieanweisung** eintragen (z. B. *„Spider-Man-mäßig, nervös aber hyped“*). Die sieht dein Freund beim Aufnehmen.
5. Mit dem 🔗-Knopf kopierst du den persönlichen Link für den Sprecher. Schick ihm Link + Passwort.

---

## So nimmt dein Freund auf

1. Link öffnen → Passwort eingeben.
2. Großer roter Knopf (oder **Leertaste**): Ein 3-2-1-Countdown läuft, dann wird aufgenommen.
3. Nochmal drücken → Stopp. Der Take wird automatisch hochgeladen und gespeichert.
4. Beliebig viele Takes pro Line. Mit ⭐ markiert er seinen besten (der neueste Favorit ist für dich in der Regie markiert).
5. Mit ← → oder den Pfeiltasten zur nächsten Line.

Über das ⚙️-Symbol kann er sein **Mikrofon auswählen** (z. B. Headset statt Laptop-Mikro), den Pegel prüfen und den Countdown ausschalten.

**Wenn ihr parallel im Discord-Call seid:** Er sollte **Kopfhörer** tragen, sonst landet deine Stimme aus seinen Lautsprechern mit in der Aufnahme.

---

## Aufnahmen abholen

In der **Regie** kannst du:
- jeden Take direkt anhören, als Favorit markieren, einzeln herunterladen oder löschen,
- **Favoriten (ZIP)**: lädt pro Line den besten Take herunter, sauber benannt (`skade_01_erster-tag-am-mit.wav`),
- **Alle Takes (ZIP)**: lädt wirklich alles herunter.

Die Regie aktualisiert sich alle 20 Sekunden von selbst. Du siehst also live, wenn jemand etwas aufgenommen hat.

---

## Gut zu wissen

- **Privatsphäre:** Jeder sieht auf der Startseite nur die Namen. Lines und Aufnahmen gibt es nur mit dem richtigen Passwort. Passwörter werden verschlüsselt gespeichert (bcrypt), du kannst sie also später nicht nachlesen, nur neu setzen (✏️-Knopf).
- **Speicher:** Supabase gratis = 1 GB. Eine 10-Sekunden-Line ist ca. 1,4 MB groß, also passen da etwa 700 Takes rein.
- **Pause:** Supabase pausiert Gratis-Projekte nach 7 Tagen ohne Nutzung. Dann einfach im Supabase-Dashboard auf **Restore** klicken. Die Daten bleiben erhalten.
- **Browser:** Läuft in Chrome, Safari (auch iPhone), Edge und Firefox. Die Seite muss über `https://` geöffnet werden (GitHub Pages macht das automatisch), sonst darf der Browser nicht aufs Mikro.
- **Titel ändern:** In `config.js` bei `TITLE`.
- **Admin-Passwort vergessen?** In Supabase → SQL Editor ausführen:
  `delete from settings where key = 'admin_password_hash';`
  Danach kannst du auf der Regie-Seite ein neues Passwort festlegen.
