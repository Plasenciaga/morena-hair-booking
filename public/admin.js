
const fmt = iso => new Intl.DateTimeFormat("de-CH",{
  weekday:"short",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
}).format(new Date(iso));
const money = cents => (cents/100).toLocaleString("de-CH",{minimumFractionDigits:0,maximumFractionDigits:2})+" CHF";
const esc = v => String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));

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

document.getElementById("slotForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const starts_at = slotStart.value;
  const res = await fetch("/api/admin/slots",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({starts_at})});
  const data=await res.json();
  if(!res.ok) alert(data.error||"Fehler");
  else { e.target.reset(); loadAll(); }
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

  slotTable.innerHTML=`<table class="table"><thead><tr><th>Termin</th><th>Status</th><th>Kundin</th><th></th></tr></thead><tbody>${
    slots.map(s=>`<tr><td>${fmt(s.starts_at)}</td><td>${s.booked?"Gebucht":"Frei"}</td><td>${s.booked?esc(s.customer_name)+"<br>"+esc(s.service_name):"–"}</td><td>${s.booked?"":`<button class="danger" onclick="removeSlot(${s.id})">Löschen</button>`}</td></tr>`).join("")
  }</tbody></table>`;

  bookingTable.innerHTML=`<table class="table"><thead><tr><th>Termin</th><th>Kundin</th><th>Service</th><th>Kontakt</th><th>Notiz</th></tr></thead><tbody>${
    bookings.map(b=>`<tr><td>${fmt(b.starts_at)}</td><td>${esc(b.customer_name)}</td><td>${esc(b.service_name)}<br>${money(b.price_cents)}</td><td>${esc(b.customer_email)}<br>${esc(b.customer_phone||"")}</td><td>${esc(b.note||"–")}</td></tr>`).join("")
  }</tbody></table>`;

  serviceTable.innerHTML=`<table class="table"><thead><tr><th>Service</th><th>Preis</th><th>Dauer</th><th>Status</th><th></th></tr></thead><tbody>${
    services.map(s=>`<tr><td>${esc(s.name)}</td><td>${money(s.price_cents)}</td><td>${s.duration_minutes} Min.</td><td>${s.active?"Aktiv":"Inaktiv"}</td><td>${s.active?`<button class="danger" onclick="disableService(${s.id})">Deaktivieren</button>`:""}</td></tr>`).join("")
  }</tbody></table>`;
}

authCheck();
