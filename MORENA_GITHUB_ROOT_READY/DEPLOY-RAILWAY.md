# MORENA online auf Railway bringen

## 1. GitHub
Erstelle ein neues leeres GitHub-Repository und lade den **Inhalt dieses Ordners** hoch.

## 2. Railway
- Neues Railway-Projekt erstellen
- **Deploy from GitHub repo** wählen
- Das Repository auswählen
- Railway erkennt den `Dockerfile` automatisch

## 3. Persistente Datenbank
Damit Buchungen nach Deployments erhalten bleiben:
- Beim Service ein **Volume** hinzufügen
- Mount Path: `/data`
- Variable setzen: `DB_PATH=/data/booking.db`

## 4. Variablen
Im Railway-Service unter **Variables** mindestens setzen:

```text
BUSINESS_NAME=MORENA Hair Experience
ADMIN_EMAIL=DEINE_ADMIN_EMAIL
ADMIN_PASSWORD=EIN_LANGES_SICHERES_PASSWORT
OWNER_EMAIL=MAIL_DER_INHABERIN
DB_PATH=/data/booking.db
```

Für Gmail SMTP zusätzlich:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=DEINE_GMAIL_ADRESSE
SMTP_PASSWORD=DEIN_GOOGLE_APP_PASSWORT
SMTP_FROM=DEINE_GMAIL_ADRESSE
SMTP_TLS=1
```

## 5. Öffentliche Adresse
Im Railway-Service unter **Settings / Networking** eine Railway-Domain erzeugen.
Danach ist die Website öffentlich erreichbar.

Adminbereich:

```text
https://DEINE-RAILWAY-DOMAIN/admin
```

## 6. Eigene Domain
Später unter **Settings / Networking / Custom Domain** die eigene Domain hinzufügen und die angezeigten DNS-Einträge beim Domainanbieter setzen.

## Vor Veröffentlichung
- Standardpasswort niemals verwenden
- Datenschutzerklärung und Impressum/Kontaktdaten ergänzen
- Buchung und E-Mail-Versand einmal vollständig testen

## Design-Update mit Bildern
Diese Version enthält bereits zugeschnittene WebP-Bilder unter `public/images/` und benötigt keine zusätzlichen Bild-Uploads, um wie die Referenz auszusehen. Das Portrait neben „hi, ich bin MORENA“ wurde bewusst nicht übernommen.
