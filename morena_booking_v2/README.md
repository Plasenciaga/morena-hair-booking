# MORENA Booking Website

Eigenständiger Full-Stack-Prototyp für eine Hairstyling-Website mit Terminbuchung.

## Funktionen

- Responsive Landingpage im warmen Beige/Schwarz/Rosé-Stil
- Services mit Preis und Dauer
- Freie Slots werden live aus SQLite geladen
- Kundinnen können einen verfügbaren Slot verbindlich buchen
- Doppelbuchungen werden serverseitig verhindert
- Admin-Login unter `/admin`
- Admin kann freie Datum/Uhrzeit-Slots anlegen und löschen
- Admin kann Services/Preise hinzufügen und deaktivieren
- Admin sieht alle Buchungen
- E-Mail-Bestätigung an Kundin
- E-Mail-Benachrichtigung an die Inhaberin
- SQLite-Datenbank, keine externe Datenbank nötig

## Lokal starten

Benötigt: Python 3.10+.

### macOS / Linux

```bash
cd morena_booking
export ADMIN_EMAIL="deine-admin-mail@example.com"
export ADMIN_PASSWORD="EIN-SEHR-SICHERES-PASSWORT"
export OWNER_EMAIL="buchungen@example.com"

# SMTP Beispiel, Daten bei deinem Mailanbieter nachsehen:
export SMTP_HOST="smtp.example.com"
export SMTP_PORT="587"
export SMTP_USER="buchungen@example.com"
export SMTP_PASSWORD="DEIN-SMTP-PASSWORT"
export SMTP_FROM="buchungen@example.com"
export SMTP_TLS="1"

python3 server.py
```

### Windows PowerShell

```powershell
cd morena_booking
$env:ADMIN_EMAIL="deine-admin-mail@example.com"
$env:ADMIN_PASSWORD="EIN-SEHR-SICHERES-PASSWORT"
$env:OWNER_EMAIL="buchungen@example.com"
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_PORT="587"
$env:SMTP_USER="buchungen@example.com"
$env:SMTP_PASSWORD="DEIN-SMTP-PASSWORT"
$env:SMTP_FROM="buchungen@example.com"
$env:SMTP_TLS="1"

python server.py
```

Dann öffnen:

- Website: http://localhost:8000
- Admin: http://localhost:8000/admin

## Wichtig zu E-Mails

Ohne SMTP-Konfiguration werden Buchungen trotzdem gespeichert. E-Mails werden dann nur in der Server-Konsole ausgegeben.

Für produktiven Betrieb kannst du z.B. SMTP von deinem Mailanbieter, Google Workspace, Microsoft 365, Brevo, Postmark oder Resend verwenden. Bei Gmail/Google Workspace sollte ein App-Passwort bzw. eine dafür geeignete SMTP-Konfiguration benutzt werden.

## Vor echtem Deployment

1. `ADMIN_EMAIL` und `ADMIN_PASSWORD` zwingend setzen.
2. HTTPS benutzen.
3. SMTP korrekt konfigurieren.
4. Eigene Bilder in die Seite einsetzen.
5. Impressum / Datenschutz ergänzen, insbesondere weil personenbezogene Daten gespeichert werden.
6. Backup der `booking.db` einrichten.
7. Für öffentliches Hosting einen persistenten Datenträger nutzen, damit SQLite nicht bei einem Redeploy verschwindet.

## Eigene Fotos einsetzen

Die graubraunen Platzhalter in `public/index.html` können durch `<img>`-Elemente ersetzt werden, z.B.:

```html
<img src="/images/portrait.jpg" alt="Morena Hairstylistin">
```

Lege Bilder dann unter `public/images/` ab.

## Instagram

Der Footer verweist bereits auf:
https://www.instagram.com/morenas.beautys/

## Sicherheits-Hinweis

Der Prototyp ist absichtlich schlank. Für eine stark frequentierte öffentliche Buchungsplattform wären zusätzlich sinnvoll:

- persistente serverseitige Sessions
- Rate Limiting
- CSRF-Schutz
- Passwort-Reset
- Storno-/Umbuchungsworkflow
- Kalender-Synchronisation
- DSGVO-/Schweizer-DSG-konforme Datenschutzhinweise

## Freie Termine verwalten

Im Adminbereich unter `/admin` gibt es jetzt zwei Möglichkeiten:

- **Mehrere Slots für einen Tag:** Datum, Von/Bis und Abstand wählen, dann „ZEITEN ERSTELLEN“.
- **Einzelner Slot:** eine bestimmte Datum/Uhrzeit-Kombination speichern.

Nur diese freien Slots erscheinen auf der Kundenseite. Ist die Liste leer, zeigt die Kundenseite bewusst „Keine freien Termine“ an.

### Railway: wichtig für dauerhafte Termine

Damit freie Slots und Buchungen nach einem neuen Deployment nicht verschwinden:

1. In Railway ein **Volume** an den Web-Service hängen.
2. Mount Path: `/data`
3. Variable setzen: `DB_PATH=/data/booking.db`

Ohne Volume verwendet die App eine lokale SQLite-Datei im Container, die bei einem Redeploy verloren gehen kann.
