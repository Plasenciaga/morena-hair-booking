import os
import json
import base64
import sqlite3
import secrets
import hashlib
import hmac
import smtplib
import ssl
import urllib.request
import urllib.error
from email.message import EmailMessage
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
EMAIL_ASSETS = ROOT / "email-assets"
BOOKING_INFO_IMAGE = EMAIL_ASSETS / "morena-termininfo.jpeg"
DB_PATH = Path(os.getenv("DB_PATH", str(ROOT / "booking.db")))

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "BitteAendern123!")
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "")
BUSINESS_NAME = os.getenv("BUSINESS_NAME", "MORENA Hair Experience")

# Resend (bevorzugt auf Railway Free/Trial/Hobby)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_FROM = os.getenv(
    "RESEND_FROM",
    "MORENA Hair Experience <onboarding@resend.dev>"
).strip()

# SMTP-Fallback, falls später gewünscht/verfügbar
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or OWNER_EMAIL)
SMTP_TLS = os.getenv("SMTP_TLS", "1") == "1"

SESSIONS = {}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        starts_at TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id INTEGER NOT NULL UNIQUE,
        service_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TEXT NOT NULL,
        FOREIGN KEY(slot_id) REFERENCES slots(id),
        FOREIGN KEY(service_id) REFERENCES services(id)
    );
    """)

    count = conn.execute("SELECT COUNT(*) c FROM services").fetchone()["c"]
    if count == 0:
        conn.executemany(
            "INSERT INTO services(name, description, price_cents, duration_minutes) VALUES (?, ?, ?, ?)",
            [
                (
                    "Haircut & Blowout",
                    "Haarschnitt & professionelles Styling für deinen perfekten Look.",
                    5000,
                    90,
                ),
                (
                    "Blowout",
                    "Professionelles Föhnen für Volumen, Glanz und einen perfekten Blow.",
                    2500,
                    60,
                ),
                (
                    "Locken Styling",
                    "Definierte, weiche Locken oder glamouröse Waves.",
                    3500,
                    75,
                ),
            ],
        )

    conn.commit()
    conn.close()


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
    return salt.hex() + "$" + digest.hex()


def verify_password(password, stored):
    salt_hex, digest_hex = stored.split("$", 1)
    salt = bytes.fromhex(salt_hex)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000).hex()
    return hmac.compare_digest(check, digest_hex)


ADMIN_HASH = hash_password(ADMIN_PASSWORD)


def send_email_resend(to_addr, subject, body, attachment_paths=None):
    email_data = {
        "from": RESEND_FROM,
        "to": [to_addr],
        "subject": subject,
        "text": body,
    }

    attachments = []
    for path in attachment_paths or []:
        path = Path(path)
        if not path.exists() or not path.is_file():
            print(f"[ANHANG FEHLT] {path}")
            continue
        attachments.append({
            "filename": path.name,
            "content": base64.b64encode(path.read_bytes()).decode("ascii"),
        })

    if attachments:
        email_data["attachments"] = attachments

    payload = json.dumps(
        email_data,
        ensure_ascii=False,
    ).encode("utf-8")

    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "MorenaHairBooking/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8", errors="replace")
            data = json.loads(raw or "{}")
            print(f"[RESEND OK] An: {to_addr} | id={data.get('id', '-')}")
            return True
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Resend HTTP {exc.code}: {error_body}"
        ) from exc


def send_email_smtp(to_addr, subject, body, attachment_paths=None):
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    for path in attachment_paths or []:
        path = Path(path)
        if not path.exists() or not path.is_file():
            print(f"[ANHANG FEHLT] {path}")
            continue

        data = path.read_bytes()
        suffix = path.suffix.lower()
        if suffix in (".jpg", ".jpeg"):
            maintype, subtype = "image", "jpeg"
        elif suffix == ".png":
            maintype, subtype = "image", "png"
        else:
            maintype, subtype = "application", "octet-stream"

        msg.add_attachment(
            data,
            maintype=maintype,
            subtype=subtype,
            filename=path.name,
        )

    context = ssl.create_default_context()
    if SMTP_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.starttls(context=context)
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    else:
        with smtplib.SMTP_SSL(
            SMTP_HOST, SMTP_PORT, context=context, timeout=20
        ) as server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)

    return True


def send_email(to_addr, subject, body, attachment_paths=None):
    if not to_addr:
        return False

    if RESEND_API_KEY:
        return send_email_resend(
            to_addr,
            subject,
            body,
            attachment_paths=attachment_paths,
        )

    if SMTP_HOST and SMTP_FROM:
        return send_email_smtp(
            to_addr,
            subject,
            body,
            attachment_paths=attachment_paths,
        )

    print(
        f"[EMAIL deaktiviert] An: {to_addr} | Betreff: {subject}\n"
        f"{body}\n"
    )
    return False


def json_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length) if length else b"{}"
    return json.loads(raw.decode("utf-8") or "{}")


def current_user(handler):
    cookie = handler.headers.get("Cookie", "")
    for part in cookie.split(";"):
        if part.strip().startswith("session="):
            token = part.strip().split("=", 1)[1]
            return SESSIONS.get(token)
    return None


class App(BaseHTTPRequestHandler):
    server_version = "MorenaBooking/1.2"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, data, status=200, headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def send_file(self, path):
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type",
            MIME.get(path.suffix.lower(), "application/octet-stream"),
        )
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def require_admin(self):
        if not current_user(self):
            self.send_json({"error": "Nicht angemeldet."}, 401)
            return False
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/services":
            conn = db()
            rows = conn.execute(
                "SELECT * FROM services WHERE active=1 ORDER BY id"
            ).fetchall()
            conn.close()
            self.send_json({"services": [dict(r) for r in rows]})
            return

        if path == "/api/slots":
            conn = db()
            rows = conn.execute("""
                SELECT s.*
                FROM slots s
                LEFT JOIN bookings b
                    ON b.slot_id=s.id AND b.status='confirmed'
                WHERE s.active=1
                  AND b.id IS NULL
                  AND datetime(s.starts_at) >= datetime('now')
                ORDER BY datetime(s.starts_at)
                LIMIT 500
            """).fetchall()
            conn.close()
            self.send_json({"slots": [dict(r) for r in rows]})
            return

        if path == "/api/admin/me":
            user = current_user(self)
            if not user:
                self.send_json({"authenticated": False})
            else:
                self.send_json(
                    {"authenticated": True, "email": user["email"]}
                )
            return

        if path == "/api/admin/bookings":
            if not self.require_admin():
                return
            conn = db()
            rows = conn.execute("""
                SELECT b.*, s.starts_at, sv.name service_name, sv.price_cents
                FROM bookings b
                JOIN slots s ON s.id=b.slot_id
                JOIN services sv ON sv.id=b.service_id
                ORDER BY datetime(s.starts_at) DESC
            """).fetchall()
            conn.close()
            self.send_json({"bookings": [dict(r) for r in rows]})
            return

        if path == "/api/admin/slots":
            if not self.require_admin():
                return
            conn = db()
            rows = conn.execute("""
                SELECT s.*,
                       CASE WHEN b.id IS NULL THEN 0 ELSE 1 END AS booked,
                       b.customer_name,
                       b.customer_email,
                       sv.name service_name
                FROM slots s
                LEFT JOIN bookings b
                    ON b.slot_id=s.id AND b.status='confirmed'
                LEFT JOIN services sv ON sv.id=b.service_id
                ORDER BY datetime(s.starts_at) DESC
                LIMIT 1000
            """).fetchall()
            conn.close()
            self.send_json({"slots": [dict(r) for r in rows]})
            return

        if path == "/api/admin/services":
            if not self.require_admin():
                return
            conn = db()
            rows = conn.execute(
                "SELECT * FROM services ORDER BY id"
            ).fetchall()
            conn.close()
            self.send_json({"services": [dict(r) for r in rows]})
            return

        if path == "/admin":
            self.send_file(PUBLIC / "admin.html")
            return

        if path == "/":
            self.send_file(PUBLIC / "index.html")
            return

        candidate = (PUBLIC / path.lstrip("/")).resolve()
        try:
            candidate.relative_to(PUBLIC.resolve())
        except Exception:
            self.send_error(403)
            return
        self.send_file(candidate)

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/book":
            try:
                data = json_body(self)
                required = [
                    "slot_id",
                    "service_id",
                    "customer_name",
                    "customer_email",
                ]
                if any(
                    not str(data.get(k, "")).strip() for k in required
                ):
                    self.send_json(
                        {"error": "Bitte alle Pflichtfelder ausfüllen."},
                        400,
                    )
                    return

                slot_id = int(data["slot_id"])
                service_id = int(data["service_id"])
                customer_name = str(
                    data["customer_name"]
                ).strip()[:120]
                customer_email = str(
                    data["customer_email"]
                ).strip()[:200]
                customer_phone = str(
                    data.get("customer_phone", "")
                ).strip()[:80]
                note = str(data.get("note", "")).strip()[:1000]

                if "@" not in customer_email:
                    self.send_json(
                        {"error": "Bitte eine gültige E-Mail-Adresse eingeben."},
                        400,
                    )
                    return

                conn = db()
                try:
                    conn.execute("BEGIN IMMEDIATE")

                    slot = conn.execute("""
                        SELECT s.*
                        FROM slots s
                        LEFT JOIN bookings b
                            ON b.slot_id=s.id AND b.status='confirmed'
                        WHERE s.id=?
                          AND s.active=1
                          AND b.id IS NULL
                    """, (slot_id,)).fetchone()

                    service = conn.execute(
                        "SELECT * FROM services WHERE id=? AND active=1",
                        (service_id,),
                    ).fetchone()

                    if not slot:
                        conn.rollback()
                        self.send_json(
                            {
                                "error":
                                "Dieser Termin ist leider nicht mehr verfügbar."
                            },
                            409,
                        )
                        return

                    if not service:
                        conn.rollback()
                        self.send_json(
                            {
                                "error":
                                "Diese Leistung ist nicht verfügbar."
                            },
                            400,
                        )
                        return

                    created_at = datetime.now(
                        timezone.utc
                    ).isoformat(timespec="seconds")

                    cur = conn.execute("""
                        INSERT INTO bookings(
                            slot_id,
                            service_id,
                            customer_name,
                            customer_email,
                            customer_phone,
                            note,
                            created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        slot_id,
                        service_id,
                        customer_name,
                        customer_email,
                        customer_phone,
                        note,
                        created_at,
                    ))

                    booking_id = cur.lastrowid
                    conn.commit()
                finally:
                    conn.close()

                date_text = slot["starts_at"].replace("T", " ")
                price = (
                    f'{service["price_cents"]/100:.2f} CHF'
                    .replace(".00", ".–")
                )

                customer_body = f"""Hallo {customer_name},

dein Termin bei {BUSINESS_NAME} ist bestätigt.

Leistung: {service["name"]}
Termin: {date_text}
Preis: {price}

Im Anhang findest du alle wichtigen Infos für deinen Termin,
inklusive Vorbereitung und Adresse.

Falls du den Termin ändern musst, melde dich bitte direkt bei uns.

Liebe Grüsse
{BUSINESS_NAME}
"""

                owner_body = f"""Neue Buchung #{booking_id}

Kundin: {customer_name}
E-Mail: {customer_email}
Telefon: {customer_phone or "-"}
Leistung: {service["name"]}
Termin: {date_text}
Preis: {price}
Notiz: {note or "-"}
"""

                # WICHTIG:
                # Die Buchung ist bereits gespeichert. Ein E-Mail-Fehler darf
                # deshalb niemals die erfolgreiche Buchung als 500 zurückgeben.
                email_errors = []

                try:
                    sent = send_email(
                        customer_email,
                        f"Terminbestätigung – {BUSINESS_NAME}",
                        customer_body,
                        attachment_paths=[BOOKING_INFO_IMAGE],
                    )
                    if not sent:
                        email_errors.append(
                            "Kunden-E-Mail nicht versendet"
                        )
                except Exception as exc:
                    print(
                        "Customer email error:",
                        repr(exc),
                    )
                    email_errors.append(str(exc))

                if OWNER_EMAIL:
                    try:
                        sent = send_email(
                            OWNER_EMAIL,
                            f"Neue Buchung: {customer_name}",
                            owner_body,
                        )
                        if not sent:
                            email_errors.append(
                                "Owner-E-Mail nicht versendet"
                            )
                    except Exception as exc:
                        print(
                            "Owner email error:",
                            repr(exc),
                        )
                        email_errors.append(str(exc))

                response = {
                    "ok": True,
                    "booking_id": booking_id,
                    "email_sent": not email_errors,
                }
                if email_errors:
                    response["email_warning"] = (
                        "Termin gespeichert, aber E-Mail konnte "
                        "nicht vollständig versendet werden."
                    )

                self.send_json(response)
            except sqlite3.IntegrityError:
                self.send_json(
                    {
                        "error":
                        "Dieser Termin wurde gerade gebucht. "
                        "Bitte einen anderen wählen."
                    },
                    409,
                )
            except Exception as exc:
                print("Booking error:", repr(exc))
                self.send_json(
                    {"error": "Buchung konnte nicht gespeichert werden."},
                    500,
                )
            return

        if path == "/api/admin/login":
            try:
                data = json_body(self)
                email = str(data.get("email", "")).strip()
                password = str(data.get("password", ""))

                if (
                    email == ADMIN_EMAIL
                    and verify_password(password, ADMIN_HASH)
                ):
                    token = secrets.token_urlsafe(32)
                    SESSIONS[token] = {"email": email}
                    self.send_json(
                        {"ok": True},
                        headers={
                            "Set-Cookie":
                            f"session={token}; Path=/; "
                            "HttpOnly; SameSite=Strict"
                        },
                    )
                else:
                    self.send_json(
                        {"error": "Login nicht korrekt."},
                        401,
                    )
            except Exception:
                self.send_json(
                    {"error": "Login fehlgeschlagen."},
                    400,
                )
            return

        if path == "/api/admin/logout":
            cookie = self.headers.get("Cookie", "")
            for part in cookie.split(";"):
                if part.strip().startswith("session="):
                    SESSIONS.pop(
                        part.strip().split("=", 1)[1],
                        None,
                    )
            self.send_json(
                {"ok": True},
                headers={
                    "Set-Cookie":
                    "session=; Path=/; Max-Age=0; HttpOnly"
                },
            )
            return

        if path == "/api/admin/slots":
            if not self.require_admin():
                return
            try:
                data = json_body(self)
                starts_at = str(
                    data.get("starts_at", "")
                ).strip()

                if not starts_at:
                    self.send_json(
                        {"error": "Datum/Uhrzeit fehlt."},
                        400,
                    )
                    return

                conn = db()
                conn.execute(
                    "INSERT INTO slots(starts_at) VALUES (?)",
                    (starts_at,),
                )
                conn.commit()
                conn.close()

                self.send_json({"ok": True})
            except sqlite3.IntegrityError:
                self.send_json(
                    {"error": "Dieser Slot existiert bereits."},
                    409,
                )
            except Exception:
                self.send_json(
                    {"error": "Slot konnte nicht erstellt werden."},
                    400,
                )
            return

        if path == "/api/admin/services":
            if not self.require_admin():
                return
            try:
                data = json_body(self)
                name = str(data.get("name", "")).strip()
                description = str(
                    data.get("description", "")
                ).strip()
                price_cents = int(
                    round(float(data.get("price", 0)) * 100)
                )
                duration = int(
                    data.get("duration_minutes", 60)
                )

                if (
                    not name
                    or price_cents < 0
                    or duration < 1
                ):
                    raise ValueError()

                conn = db()
                conn.execute("""
                    INSERT INTO services(
                        name,
                        description,
                        price_cents,
                        duration_minutes
                    ) VALUES (?, ?, ?, ?)
                """, (
                    name,
                    description,
                    price_cents,
                    duration,
                ))
                conn.commit()
                conn.close()

                self.send_json({"ok": True})
            except Exception:
                self.send_json(
                    {
                        "error":
                        "Leistung konnte nicht gespeichert werden."
                    },
                    400,
                )
            return

        self.send_error(404)

    def do_DELETE(self):
        path = urlparse(self.path).path

        if not self.require_admin():
            return

        if path.startswith("/api/admin/slots/"):
            try:
                slot_id = int(path.rsplit("/", 1)[1])
                conn = db()

                booked = conn.execute(
                    """
                    SELECT COUNT(*) c
                    FROM bookings
                    WHERE slot_id=? AND status='confirmed'
                    """,
                    (slot_id,),
                ).fetchone()["c"]

                if booked:
                    conn.close()
                    self.send_json(
                        {
                            "error":
                            "Gebuchte Termine können nicht "
                            "einfach gelöscht werden."
                        },
                        409,
                    )
                    return

                conn.execute(
                    "DELETE FROM slots WHERE id=?",
                    (slot_id,),
                )
                conn.commit()
                conn.close()

                self.send_json({"ok": True})
            except Exception:
                self.send_json(
                    {"error": "Slot konnte nicht gelöscht werden."},
                    400,
                )
            return

        if path.startswith("/api/admin/services/"):
            try:
                service_id = int(path.rsplit("/", 1)[1])
                conn = db()
                conn.execute(
                    "UPDATE services SET active=0 WHERE id=?",
                    (service_id,),
                )
                conn.commit()
                conn.close()

                self.send_json({"ok": True})
            except Exception:
                self.send_json(
                    {
                        "error":
                        "Leistung konnte nicht deaktiviert werden."
                    },
                    400,
                )
            return

        self.send_error(404)


if __name__ == "__main__":
    init_db()
    print(f"{BUSINESS_NAME} läuft auf http://localhost:{PORT}")
    print(f"Admin: http://localhost:{PORT}/admin")

    if RESEND_API_KEY:
        print(f"Resend aktiv: {RESEND_FROM}")
    elif SMTP_HOST:
        print(f"SMTP aktiv: {SMTP_HOST}:{SMTP_PORT}")
    else:
        print("WARNUNG: E-Mail-Versand ist nicht konfiguriert.")

    if ADMIN_PASSWORD == "BitteAendern123!":
        print(
            "WARNUNG: Standard-Adminpasswort aktiv. "
            "Vor Deployment unbedingt ADMIN_PASSWORD setzen."
        )

    ThreadingHTTPServer((HOST, PORT), App).serve_forever()
