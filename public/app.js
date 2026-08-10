
const money = cents => (cents / 100).toLocaleString("de-CH", {
  minimumFractionDigits: cents % 100 ? 2 : 0,
  maximumFractionDigits: 2
}) + " CHF";

const dateLabel = iso => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("de-CH", {
    weekday:"short", day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit"
  }).format(d);
};

let services = [];
let slots = [];

async function loadData(){
  const [sRes, tRes] = await Promise.all([fetch("/api/services"), fetch("/api/slots")]);
  services = (await sRes.json()).services || [];
  slots = (await tRes.json()).slots || [];

  const cards = document.getElementById("serviceCards");
  cards.innerHTML = services.map((s,i)=>`
    <article class="service-card">
      <div class="visual photo-placeholder">${i===0?"CUT":i===1?"BLOWOUT":"STYLING"}</div>
      <div class="service-copy">
        <h3>${escapeHtml(s.name)}</h3>
        <p>${escapeHtml(s.description)}</p>
        <div class="price">${money(s.price_cents)}</div>
        <a href="#booking" class="btn btn-dark" onclick="selectService(${s.id})">JETZT BUCHEN</a>
      </div>
    </article>
  `).join("");

  const serviceSelect = document.getElementById("serviceSelect");
  serviceSelect.innerHTML = '<option value="">Bitte wählen</option>' + services.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} – ${money(s.price_cents)}</option>`
  ).join("");

  const slotSelect = document.getElementById("slotSelect");
  slotSelect.innerHTML = slots.length
    ? '<option value="">Bitte wählen</option>' + slots.map(s =>
        `<option value="${s.id}">${dateLabel(s.starts_at)}</option>`
      ).join("")
    : '<option value="">Aktuell keine freien Termine</option>';

  updateSummary();
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

window.selectService = id => {
  const select = document.getElementById("serviceSelect");
  select.value = String(id);
  updateSummary();
};

function updateSummary(){
  const serviceId = Number(document.getElementById("serviceSelect").value);
  const slotId = Number(document.getElementById("slotSelect").value);
  const s = services.find(x=>x.id===serviceId);
  const t = slots.find(x=>x.id===slotId);
  document.getElementById("summary").innerHTML = s || t
    ? `<strong>Deine Auswahl</strong><br>${s ? escapeHtml(s.name)+" · "+money(s.price_cents) : "Service wählen"}<br>${t ? dateLabel(t.starts_at) : "Termin wählen"}`
    : "Wähle Service und freien Termin.";
}

document.getElementById("serviceSelect").addEventListener("change", updateSummary);
document.getElementById("slotSelect").addEventListener("change", updateSummary);

document.getElementById("bookingForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = document.getElementById("bookingMessage");
  msg.className = "message";
  msg.textContent = "Buchung wird gespeichert …";

  const payload = {
    service_id: Number(document.getElementById("serviceSelect").value),
    slot_id: Number(document.getElementById("slotSelect").value),
    customer_name: document.getElementById("nameInput").value,
    customer_email: document.getElementById("emailInput").value,
    customer_phone: document.getElementById("phoneInput").value,
    note: document.getElementById("noteInput").value
  };

  const res = await fetch("/api/book", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const data = await res.json();

  if(res.ok){
    msg.className = "message ok";
    msg.textContent = "Termin bestätigt. Die Buchung wurde gespeichert und die Bestätigungs-E-Mail wird versendet.";
    e.target.reset();
    await loadData();
  }else{
    msg.className = "message error";
    msg.textContent = data.error || "Buchung fehlgeschlagen.";
    await loadData();
  }
});

loadData().catch(err=>{
  console.error(err);
  document.getElementById("bookingMessage").textContent = "Daten konnten nicht geladen werden.";
});
