const money = cents => (cents / 100).toLocaleString("de-CH", {
  minimumFractionDigits: cents % 100 ? 2 : 0,
  maximumFractionDigits: 2
}) + " CHF";

const fullDate = iso => new Intl.DateTimeFormat("de-CH", {
  weekday:"long", day:"2-digit", month:"2-digit", year:"numeric",
  hour:"2-digit", minute:"2-digit"
}).format(new Date(iso));

const dayParts = iso => {
  const d = new Date(iso);
  return {
    key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
    weekday: new Intl.DateTimeFormat("de-CH", {weekday:"short"}).format(d).replace(".",""),
    day: new Intl.DateTimeFormat("de-CH", {day:"2-digit"}).format(d),
    month: new Intl.DateTimeFormat("de-CH", {month:"short"}).format(d).replace(".",""),
    time: new Intl.DateTimeFormat("de-CH", {hour:"2-digit",minute:"2-digit"}).format(d)
  };
};

let services = [];
let slots = [];
let selectedDate = "";
let selectedSlotId = null;

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function serviceImage(index){
  return ["/images/service-cut.webp?v=6","/images/service-blowout.webp?v=6","/images/service-curls.webp?v=6"][index % 3];
}

async function loadData(){
  const [sRes, tRes] = await Promise.all([fetch("/api/services"), fetch("/api/slots")]);
  services = (await sRes.json()).services || [];
  slots = (await tRes.json()).slots || [];

  const cards = document.getElementById("serviceCards");
  cards.innerHTML = services.map((s,i)=>`
    <article class="service-card">
      <img class="visual" src="${serviceImage(i)}" alt="${escapeHtml(s.name)}">
      <div class="service-copy">
        <h3>${escapeHtml(s.name)}</h3>
        <p>${escapeHtml(s.description)}</p>
        <div class="service-meta">ca. ${Number(s.duration_minutes || 60)} Min.</div>
        <div class="price">${money(s.price_cents)}</div>
        <a href="#booking" class="btn btn-dark" onclick="selectService(${s.id})">JETZT BUCHEN</a>
      </div>
    </article>
  `).join("");

  const serviceSelect = document.getElementById("serviceSelect");
  const oldService = serviceSelect.value;
  serviceSelect.innerHTML = '<option value="">Service wählen</option>' + services.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} – ${money(s.price_cents)}</option>`
  ).join("");
  if(oldService && services.some(s=>String(s.id)===String(oldService))) serviceSelect.value = oldService;

  selectedSlotId = null;
  document.getElementById("slotSelect").value = "";
  renderSlots();
  updateSummary();
}

function renderSlots(){
  const dateStrip = document.getElementById("dateStrip");
  const timeGrid = document.getElementById("timeGrid");
  const slotCount = document.getElementById("slotCount");
  slotCount.textContent = slots.length ? `${slots.length} freie Termine` : "Keine freien Termine";

  const grouped = new Map();
  for(const slot of slots){
    const p = dayParts(slot.starts_at);
    if(!grouped.has(p.key)) grouped.set(p.key, {parts:p, slots:[]});
    grouped.get(p.key).slots.push(slot);
  }
  const dates = [...grouped.keys()].sort();
  if(!selectedDate || !grouped.has(selectedDate)) selectedDate = dates[0] || "";

  dateStrip.innerHTML = dates.map(key=>{
    const g = grouped.get(key);
    const active = key === selectedDate ? " active" : "";
    return `<button type="button" class="date-btn${active}" data-date="${key}">${escapeHtml(g.parts.weekday)}<strong>${g.parts.day}</strong>${escapeHtml(g.parts.month)}</button>`;
  }).join("");

  dateStrip.querySelectorAll(".date-btn").forEach(btn=>btn.addEventListener("click",()=>{
    selectedDate = btn.dataset.date;
    selectedSlotId = null;
    document.getElementById("slotSelect").value = "";
    renderSlots();
    updateSummary();
  }));

  if(!selectedDate){
    timeGrid.innerHTML = '<div class="empty-slots">Aktuell sind keine freien Termine eingetragen.</div>';
    return;
  }

  const daySlots = grouped.get(selectedDate).slots.sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  timeGrid.innerHTML = daySlots.map(slot=>{
    const p = dayParts(slot.starts_at);
    return `<button type="button" class="time-btn${slot.id===selectedSlotId?" active":""}" data-slot="${slot.id}">${p.time}</button>`;
  }).join("");

  timeGrid.querySelectorAll(".time-btn").forEach(btn=>btn.addEventListener("click",()=>{
    selectedSlotId = Number(btn.dataset.slot);
    document.getElementById("slotSelect").value = String(selectedSlotId);
    timeGrid.querySelectorAll(".time-btn").forEach(x=>x.classList.toggle("active",x===btn));
    updateSummary();
  }));
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
    ? `<strong>Deine Auswahl</strong><br>${s ? escapeHtml(s.name)+" · "+money(s.price_cents) : "Service wählen"}<br>${t ? fullDate(t.starts_at) : "Datum & Uhrzeit wählen"}`
    : "Wähle zuerst deinen Service und danach einen freien Termin.";
}

document.getElementById("serviceSelect").addEventListener("change", updateSummary);

document.getElementById("bookingForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = document.getElementById("bookingMessage");
  const serviceId = Number(document.getElementById("serviceSelect").value);
  const slotId = Number(document.getElementById("slotSelect").value);

  if(!serviceId){
    msg.className = "message error";
    msg.textContent = "Bitte zuerst einen Service wählen.";
    return;
  }
  if(!slotId){
    msg.className = "message error";
    msg.textContent = "Bitte einen freien Termin auswählen.";
    return;
  }

  msg.className = "message";
  msg.textContent = "Buchung wird gespeichert …";

  const payload = {
    service_id: serviceId,
    slot_id: slotId,
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
    msg.textContent = "Termin bestätigt. Du erhältst eine Bestätigung per E-Mail.";
    e.target.reset();
    selectedSlotId = null;
    await loadData();
  }else{
    msg.className = "message error";
    msg.textContent = data.error || "Buchung fehlgeschlagen.";
    await loadData();
  }
});

loadData().catch(err=>{
  console.error(err);
  document.getElementById("bookingMessage").className = "message error";
  document.getElementById("bookingMessage").textContent = "Termine konnten nicht geladen werden.";
});
