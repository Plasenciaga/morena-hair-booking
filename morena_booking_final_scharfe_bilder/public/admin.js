const fmt = iso => new Intl.DateTimeFormat("de-CH",{
  weekday:"short",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
}).format(new Date(iso));
const money = cents => (cents/100).toLocaleString("de-CH",{minimumFractionDigits:0,maximumFractionDigits:2})+" CHF";
const esc = v => String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));

function localInputToIso(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function dateTimeLocal(date, time){
  const d = new Date(`${date}T${time}:00`);
  return d;
}

async function authCheck(){
  const data = await (await fetch("/api/admin/me")).json();
  document.getElementById("loginBox").hidden = !!data.authenticated;
  document.getElementById("dashboard").hidden = !data.authenticated;
  document.getElementById("logoutBtn").hidden = !data.authenticated;
  if(data.authenticated) loadAll();
}

document.getElementById("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const res = await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:loginEmail.value,password:loginPassword.value})});
  const data = await res.json();
  if(res.ok){ loginMsg.textContent=""; await authCheck(); }
  else { loginMsg.className="message error"; loginMsg.textContent=data.error||"Login fehlgeschlagen."; }
});

document.getElementById("logoutBtn").addEventListener("click",async()=>{
  await fetch("/api/admin/logout",{method:"POST"});
  authCheck();
});

document.getElementById("bulkSlotForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const msg = document.getElementById("bulkSlotMsg");
  msg.className = "message";
  msg.textContent = "Zeiten werden erstellt …";

  const date = bulkDate.value;
  const from = dateTimeLocal(date, bulkFrom.value);
  const to = dateTimeLocal(date, bulkTo.value);
  const interval = Number(bulkInterval.value);

  if(!date || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from){
    msg.className = "message error";
    msg.textContent = "Bitte Datum sowie eine gültige Von-/Bis-Zeit wählen.";
    return;
  }

  const starts = [];
  for(let d = new Date(from); d < to && starts.length < 100; d = new Date(d.getTime() + interval*60000)){
    starts.push(d.toISOString());
  }

  let created = 0;
  let skipped = 0;
  for(const starts_at of starts){
    const res = await fetch("/api/admin/slots",{
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({starts_at})
    });
    if(res.ok) created++;
    else if(res.status === 409) skipped++;
    else {
      const data = await res.json().catch(()=>({}));
      msg.className="message error";
      msg.textContent=data.error||"Zeiten konnten nicht vollständig erstellt werden.";
      await loadAll();
      return;
    }
  }

  msg.className="message ok";
  msg.textContent=`${created} freie Termine erstellt${skipped ? `, ${skipped} bereits vorhanden` : ""}.`;
  await loadAll();
});

document.getElementById("slotForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const msg = document.getElementById("slotMsg");
  const starts_at = localInputToIso(slotStart.value);
  const res = await fetch("/api/admin/slots",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({starts_at})});
  const data=await res.json();
  if(!res.ok){ msg.className="message error"; msg.textContent=data.error||"Fehler"; }
  else { msg.className="message ok"; msg.textContent="Freier Termin gespeichert."; e.target.reset(); await loadAll(); }
});

document.getElementById("serviceForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const payload={name:svName.value,price:svPrice.value,duration_minutes:svDuration.value,description:svDescription.value};
  const res=await fetch("/api/admin/services",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json();
  if(!res.ok) alert(data.error||"Fehler");
  else { e.target.reset(); svDuration.value=60; loadAll(); }
});

async function removeSlot(id){
  if(!confirm("Diesen freien Slot löschen?")) return;
  const res=await fetch("/api/admin/slots/"+id,{method:"DELETE"});
  const data=await res.json();
  if(!res.ok) alert(data.error||"Fehler");
  loadAll();
}
window.removeSlot=removeSlot;

async function disableService(id){
  if(!confirm("Service deaktivieren?")) return;
  const res=await fetch("/api/admin/services/"+id,{method:"DELETE"});
  const data=await res.json();
  if(!res.ok) alert(data.error||"Fehler");
  loadAll();
}
window.disableService=disableService;

async function loadAll(){
  const [sr,br,vr]=await Promise.all([
    fetch("/api/admin/slots"),fetch("/api/admin/bookings"),fetch("/api/admin/services")
  ]);
  if(sr.status===401){authCheck();return}
  const slots=(await sr.json()).slots||[];
  const bookings=(await br.json()).bookings||[];
  const services=(await vr.json()).services||[];

  slotTable.innerHTML = slots.length ? `<table class="table"><thead><tr><th>Termin</th><th>Status</th><th>Kundin</th><th></th></tr></thead><tbody>${
    slots.map(s=>`<tr><td>${fmt(s.starts_at)}</td><td>${s.booked?"Gebucht":"Frei"}</td><td>${s.booked?esc(s.customer_name)+"<br>"+esc(s.service_name):"–"}</td><td>${s.booked?"":`<button class="danger" onclick="removeSlot(${s.id})">Löschen</button>`}</td></tr>`).join("")
  }</tbody></table>` : '<p class="muted">Noch keine Slots angelegt. Oben kannst du freie Zeiten erstellen.</p>';

  bookingTable.innerHTML = bookings.length ? `<table class="table"><thead><tr><th>Termin</th><th>Kundin</th><th>Service</th><th>Kontakt</th><th>Notiz</th></tr></thead><tbody>${
    bookings.map(b=>`<tr><td>${fmt(b.starts_at)}</td><td>${esc(b.customer_name)}</td><td>${esc(b.service_name)}<br>${money(b.price_cents)}</td><td>${esc(b.customer_email)}<br>${esc(b.customer_phone||"")}</td><td>${esc(b.note||"–")}</td></tr>`).join("")
  }</tbody></table>` : '<p class="muted">Noch keine Buchungen.</p>';

  serviceTable.innerHTML=`<table class="table"><thead><tr><th>Service</th><th>Preis</th><th>Dauer</th><th>Status</th><th></th></tr></thead><tbody>${
    services.map(s=>`<tr><td>${esc(s.name)}</td><td>${money(s.price_cents)}</td><td>${s.duration_minutes} Min.</td><td>${s.active?"Aktiv":"Inaktiv"}</td><td>${s.active?`<button class="danger" onclick="disableService(${s.id})">Deaktivieren</button>`:""}</td></tr>`).join("")
  }</tbody></table>`;
}

// Hilfreiche Standardwerte
const tomorrow = new Date(Date.now()+86400000);
const yyyy = tomorrow.getFullYear();
const mm = String(tomorrow.getMonth()+1).padStart(2,"0");
const dd = String(tomorrow.getDate()).padStart(2,"0");
document.getElementById("bulkDate").value = `${yyyy}-${mm}-${dd}`;

authCheck();
