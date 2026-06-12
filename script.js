// === KONFIGURACJA — uzupełnij po wdrożeniu ===
const CONFIG = {
  // prywatne repozytorium GitHub z ewidencją rezerwacji (tam trafiają issue)
  githubRepo: "rozrywka/rezerwacje",
  // endpoint formularza z https://formspree.io (darmowe konto)
  formspreeEndpoint: "https://formspree.io/f/xeewreqw"
};

// === I18N — teksty dynamiczne zależne od języka dokumentu ===
const LANG = document.documentElement.lang === "en" ? "en" : "pl";
const STR = {
  pl: {
    slotFree: (t) => `${t} — wolny`,
    slotBusy: (t) => `${t} — zajęty`,
    slotReserved: (t, n) => `${t} — zarezerwowane: ${n}`,
    pickDay: "Wybierz najpierw dzień z kalendarza.",
    pickSlot: "Wybierz dostępny slot i uzupełnij formularz.",
    chosen: (s) => `Wybrano termin: ${s} — uzupełnij formularz i oczekuj na potwierdzenie.`,
    needSlot: "Wybierz najpierw termin oglądania z listy slotów.",
    captchaErr: "Błędny wynik działania — spróbuj jeszcze raz.",
    sending: "Wysyłanie zgłoszenia…",
    sent: "✓ Zgłoszenie wysłane! Termin jest wstępnie zarezerwowany — potwierdzenie otrzymasz telefonicznie lub SMS-em.",
    sendErr: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie lub skontaktuj się telefonicznie.",
    vacant: "mieszkanie nieużytkowane",
    eco: "wariant oszczędny",
    comfort: "wariant komfortowy",
    perPerson: (v) => `${v} na osobę`,
    media: { elec: "Prąd", gas: "Gaz", hot: "Ciepła woda", cold: "Zimna woda" },
    popupHome: "Mieszkanie na wynajem",
    popupOpen: "Otwórz w Google Maps",
    popupRoute: "Wyznacz trasę",
    noDay: "Brak dostępnych terminów w tym dniu — wybierz inny dzień.",
    upcoming: "Najbliższe dostępne dni:",
    noneAtAll: "Aktualnie nie ma dostępnych terminów. Zadzwoń lub napisz — ustalimy termin indywidualnie."
  },
  en: {
    slotFree: (t) => `${t} — available`,
    slotBusy: (t) => `${t} — taken`,
    slotReserved: (t, n) => `${t} — reserved: ${n}`,
    pickDay: "Please pick a day from the calendar first.",
    pickSlot: "Choose an available slot and fill in the form.",
    chosen: (s) => `Selected slot: ${s} — fill in the form and await confirmation.`,
    needSlot: "Please select a viewing slot from the list first.",
    captchaErr: "Wrong answer — please try again.",
    sending: "Sending your request…",
    sent: "✓ Request sent! Your slot is provisionally reserved — you will receive confirmation by phone or text message.",
    sendErr: "Sending failed. Please try again or contact me by phone.",
    vacant: "vacant apartment",
    eco: "economical scenario",
    comfort: "comfortable scenario",
    perPerson: (v) => `${v} per person`,
    media: { elec: "Electricity", gas: "Gas", hot: "Hot water", cold: "Cold water" },
    popupHome: "Apartment for rent",
    popupOpen: "Open in Google Maps",
    popupRoute: "Get directions",
    noDay: "No available slots on this day — please pick another date.",
    upcoming: "Nearest available days:",
    noneAtAll: "There are currently no available slots. Call or write — we will arrange a time individually."
  }
}[LANG];

let selectedSlot = "";
let bookedSlots = new Map(); // "RRRR-MM-DD GG:MM" -> imię (lub "")
let availability = new Map(); // "RRRR-MM-DD" -> ["GG:MM", ...] z dostepnosc.md
let captcha = { a: 0, b: 0 };

const dateInput = document.getElementById("visit-date");
const slotList = document.getElementById("slot-list");
const statusBox = document.getElementById("booking-status");
const selectedSlotInput = document.getElementById("selected-slot-input");
const form = document.getElementById("kontakt");

const FIXED_COSTS = 2600 + 490 + 11.18; // odstępne + czynsz administracyjny + abonament gazowy
const PRICES = { elec: 1.53, gas: 3.9, hot: 44.0, cold: 14.86 }; // zł za kWh / m³
const USAGE = {
  // miesięczne zużycie: prąd [kWh], gaz [m³], ciepła i zimna woda [m³]
  "1": {
    eco: { elec: 15, gas: 1.0, hot: 0.3, cold: 0.7 },
    comfort: { elec: 30, gas: 2.0, hot: 0.6, cold: 1.4 }
  },
  "2": {
    eco: { elec: 28, gas: 2.0, hot: 0.7, cold: 1.3 },
    comfort: { elec: 55, gas: 4.0, hot: 1.4, cold: 2.6 }
  }
};

const pad = (n) => String(n).padStart(2, "0");
const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Parsuje terminy.md: każda linia listy "- RRRR-MM-DD GG:MM — Imię"
// (od początku wiersza) blokuje jeden slot; imię jest opcjonalne.
function parseRezerwacje(md) {
  const map = new Map();
  const re = /^-\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?:\s*[—–-]\s*(.+))?$/;
  md.split(/\r?\n/).forEach((line) => {
    const m = line.trim().match(re);
    if (m) map.set(`${m[1]} ${m[2].padStart(5, "0")}`, (m[3] || "").trim());
  });
  return map;
}

async function loadBookedSlots() {
  try {
    const res = await fetch("terminy.md", { cache: "no-store" });
    if (!res.ok) throw new Error(`Brak pliku terminy.md (HTTP ${res.status})`);
    bookedSlots = parseRezerwacje(await res.text());
  } catch (err) {
    console.warn("Nie udało się wczytać terminy.md — przyjmuję brak zajętych slotów.", err);
    bookedSlots = new Map();
  }
}

// Parsuje dostepnosc.md (oferowane terminy) do mapy dzień -> posortowane godziny.
// Terminy z przeszłości są pomijane.
async function loadAvailability() {
  availability = new Map();
  try {
    const res = await fetch("dostepnosc.md", { cache: "no-store" });
    if (!res.ok) throw new Error(`Brak pliku dostepnosc.md (HTTP ${res.status})`);
    const today = toIsoDate(new Date());
    const re = /^-\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/;
    (await res.text()).split(/\r?\n/).forEach((line) => {
      const m = line.trim().match(re);
      if (!m || m[1] < today) return;
      const time = m[2].padStart(5, "0");
      if (!availability.has(m[1])) availability.set(m[1], []);
      if (!availability.get(m[1]).includes(time)) availability.get(m[1]).push(time);
    });
    availability.forEach((times) => times.sort());
  } catch (err) {
    console.warn("Nie udało się wczytać dostepnosc.md — brak oferowanych terminów.", err);
  }
}

function availableDays() {
  return [...availability.keys()].sort();
}

function isBusy(date, time) {
  return bookedSlots.has(`${date} ${time}`);
}

function busyName(date, time) {
  return bookedSlots.get(`${date} ${time}`) || "";
}

// Chipy z najbliższymi dniami, w których są jeszcze wolne sloty.
function renderUpcomingDays() {
  const wrap = document.getElementById("upcoming-days");
  if (!wrap) return;
  wrap.innerHTML = "";

  const days = availableDays().filter((day) =>
    (availability.get(day) || []).some((time) => !isBusy(day, time))
  );
  if (days.length === 0) return;

  const label = document.createElement("span");
  label.className = "upcoming-label";
  label.textContent = STR.upcoming;
  wrap.appendChild(label);

  days.slice(0, 6).forEach((day) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip" + (day === dateInput.value ? " active" : "");
    chip.textContent = new Date(`${day}T12:00:00`).toLocaleDateString(
      LANG === "pl" ? "pl-PL" : "en-GB",
      { weekday: "short", day: "numeric", month: "short" }
    );
    chip.title = day;
    chip.addEventListener("click", () => {
      dateInput.value = day;
      renderSlots();
    });
    wrap.appendChild(chip);
  });
}

function renderSlots() {
  const date = dateInput.value;
  slotList.innerHTML = "";
  selectedSlot = "";
  selectedSlotInput.value = "";

  if (availability.size === 0) {
    statusBox.textContent = STR.noneAtAll;
    renderUpcomingDays();
    return;
  }

  if (!date) {
    statusBox.textContent = STR.pickDay;
    renderUpcomingDays();
    return;
  }

  const times = availability.get(date) || [];

  times.forEach((time) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";

    if (isBusy(date, time)) {
      btn.classList.add("busy");
      btn.disabled = true;
      const name = busyName(date, time);
      btn.textContent = name ? STR.slotReserved(time, name) : STR.slotBusy(time);
    } else {
      btn.textContent = STR.slotFree(time);
      btn.addEventListener("click", () => {
        document.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedSlot = `${date} ${time}`;
        selectedSlotInput.value = selectedSlot;
        statusBox.textContent = STR.chosen(selectedSlot);
      });
    }

    slotList.appendChild(btn);
  });

  statusBox.textContent = times.length === 0 ? STR.noDay : STR.pickSlot;
  renderUpcomingDays();
}

function initDateInput() {
  const today = new Date();
  const days = availableDays();
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 2);

  dateInput.min = toIsoDate(today);
  dateInput.max = days.length > 0 ? days[days.length - 1] : toIsoDate(maxDate);
  // domyślnie pierwszy dzień z dostępnymi terminami, a gdy brak — dziś
  dateInput.value = days.length > 0 ? days[0] : toIsoDate(today);
}

function initFadeIn() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(".fade-in").forEach((el) => observer.observe(el));
}

function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightbox-image");
  const close = document.getElementById("lightbox-close");

  document.querySelectorAll(".gallery-item").forEach((item) => {
    item.addEventListener("click", () => {
      lightboxImage.src = item.dataset.full;
      lightbox.classList.add("active");
      lightbox.setAttribute("aria-hidden", "false");
    });
  });

  const closeLightbox = () => {
    lightbox.classList.remove("active");
    lightbox.setAttribute("aria-hidden", "true");
    lightboxImage.src = "";
  };

  close.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.classList.contains("active")) closeLightbox();
  });
}

// Link otwierający na GitHubie wstępnie wypełnione issue. Kliknięcie go
// w mailu (jako zalogowany właściciel repo) i zatwierdzenie issue uruchamia
// workflow, który dopisuje slot do rezerwacja.md.
function buildConfirmLink(date, time, name) {
  const title = `Rezerwacja: ${date} ${time} - ${name}`;
  return `https://github.com/${CONFIG.githubRepo}/issues/new?title=${encodeURIComponent(title)}`;
}

function newCaptcha() {
  captcha.a = 1 + Math.floor(Math.random() * 9);
  captcha.b = 1 + Math.floor(Math.random() * 9);
  const q = document.getElementById("captcha-question");
  const input = document.getElementById("captcha-input");
  if (q) q.textContent = `${captcha.a} + ${captcha.b} = ?`;
  if (input) input.value = "";
}

function setFormStatus(type, message) {
  const box = document.getElementById("form-status");
  box.className = `form-status ${type}`;
  box.textContent = message;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function initForm() {
  const submitBtn = form.querySelector('button[type="submit"]');
  newCaptcha();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!selectedSlot) {
      setFormStatus("error", STR.needSlot);
      return;
    }

    const captchaInput = document.getElementById("captcha-input");
    if (parseInt(captchaInput.value, 10) !== captcha.a + captcha.b) {
      newCaptcha();
      setFormStatus("error", STR.captchaErr);
      captchaInput.focus();
      return;
    }

    const [date, time] = selectedSlot.split(" ");
    const name = document.getElementById("name").value.trim() || "Gość";
    document.getElementById("confirm-link-input").value = buildConfirmLink(date, time, name);
    document.getElementById("subject-input").value = `Rezerwacja oglądania: ${selectedSlot} — ${name}`;

    submitBtn.disabled = true;
    setFormStatus("pending", STR.sending);

    try {
      const formData = new FormData(form);
      const res = await fetch(CONFIG.formspreeEndpoint, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFormStatus("success", STR.sent);
      form.reset();
      newCaptcha();
      document.querySelectorAll(".slot-btn.selected").forEach((b) => b.classList.remove("selected"));
      selectedSlot = "";
      selectedSlotInput.value = "";
      statusBox.textContent = "";
    } catch (err) {
      console.error("Błąd wysyłki formularza:", err);
      setFormStatus("error", STR.sendErr);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initAnalytics() {
  const scenarioSel = document.getElementById("scenario-select");
  const peopleSel = document.getElementById("people-select");
  if (!scenarioSel || !peopleSel) return;

  const fmt = (v) => LANG === "pl" ? `${v.toFixed(2).replace(".", ",")} zł` : `${v.toFixed(2)} zł`;
  const barsNode = document.getElementById("cost-bars");
  const mediaNode = document.getElementById("media-cost");
  const mediaNote = document.getElementById("media-note");
  const totalNode = document.getElementById("total-cost");
  const perPersonNode = document.getElementById("per-person");

  function render() {
    const people = peopleSel.value;
    const variant = scenarioSel.value;
    const u = variant === "none"
      ? { elec: 0, gas: 0, hot: 0, cold: 0 }
      : USAGE[people][variant];

    const dec = (v) => LANG === "pl" ? v.toFixed(1).replace(".", ",") : v.toFixed(1);
    const items = [
      { name: STR.media.elec, usage: `${u.elec} kWh`, cost: u.elec * PRICES.elec, color: "#f6c84c" },
      { name: STR.media.gas, usage: `${dec(u.gas)} m³`, cost: u.gas * PRICES.gas, color: "#ad69ff" },
      { name: STR.media.hot, usage: `${dec(u.hot)} m³`, cost: u.hot * PRICES.hot, color: "#ff8a26" },
      { name: STR.media.cold, usage: `${dec(u.cold)} m³`, cost: u.cold * PRICES.cold, color: "#38a8ff" }
    ].sort((a, b) => b.cost - a.cost);

    const media = items.reduce((s, i) => s + i.cost, 0);
    const total = FIXED_COSTS + media;

    mediaNode.textContent = fmt(media);
    mediaNote.textContent = variant === "none" ? STR.vacant : variant === "eco" ? STR.eco : STR.comfort;
    totalNode.textContent = fmt(total);
    perPersonNode.textContent = people === "2" && variant !== "none" ? STR.perPerson(fmt(total / 2)) : "—";

    barsNode.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "bar";
      row.style.setProperty("--w", media > 0 ? `${(item.cost / media) * 100}%` : "0%");
      row.style.setProperty("--c", item.color);
      row.innerHTML = `<div class="bar__top"><span>${item.name} — ${item.usage}</span><strong>${fmt(item.cost)}</strong></div><div class="bar__track"><div class="bar__fill"></div></div>`;
      barsNode.appendChild(row);
    });
  }

  scenarioSel.addEventListener("change", render);
  peopleSel.addEventListener("change", render);
  render();
}

function initMap() {
  if (!window.L) return;
  const mapNode = document.getElementById("map");
  if (!mapNode) return;

  const home = [50.09270884862374, 19.97626877081445];
  const gmapsView = `https://www.google.com/maps/search/?api=1&query=${home[0]}%2C${home[1]}`;
  const gmapsRoute = `https://www.google.com/maps/dir/?api=1&destination=${home[0]}%2C${home[1]}`;
  const map = L.map("map", {
    scrollWheelZoom: false,
    zoomControl: true,
    minZoom: 13
  }).setView(home, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const icon = (emojiClass) =>
    L.divIcon({
      html: `<div class="custom-poi-icon"><i class="${emojiClass}"></i></div>`,
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

  L.marker(home, { icon: icon("fa-solid fa-house") })
    .addTo(map)
    .bindPopup(
      `<strong>Rozrywki 24</strong><br>${STR.popupHome}<br>` +
      `<a href="${gmapsView}" target="_blank" rel="noopener">${STR.popupOpen}</a> · ` +
      `<a href="${gmapsRoute}" target="_blank" rel="noopener">${STR.popupRoute}</a>`
    );

  const poi = [
    { name: "CH Serenada", coords: [50.08831297909697, 19.985763019059025], icon: "fa-solid fa-cart-shopping" },
    { name: "Park Wodny", coords: [50.089367852130756, 19.982809603417827], icon: "fa-solid fa-water-ladder" },
    { name: "Auchan", coords: [50.087685202551434, 19.981477051915327], icon: "fa-solid fa-basket-shopping" },
    { name: "OBI", coords: [50.08739971685717, 19.9775621093713], icon: "fa-solid fa-screwdriver-wrench" },
    { name: "Quattro Business Park", coords: [50.086412062818724, 19.975029913381526], icon: "fa-solid fa-briefcase" },
    { name: "Żabka", coords: [50.09247176979996, 19.97446324505183], icon: "fa-solid fa-store" },
    { name: "Capri Pizza", coords: [50.09098382167745, 19.97530354118723], icon: "fa-solid fa-pizza-slice" },
    { name: "Lewiatan", coords: [50.09010971714914, 19.97460401388035], icon: "fa-solid fa-basket-shopping" },
    { name: "Darmowa siłownia na świeżym powietrzu", coords: [50.090777477150866, 19.97108949007801], icon: "fa-solid fa-dumbbell" },
    { name: "Multikino", coords: [50.08900303324433, 19.98548081389601], icon: "fa-solid fa-film" },
    { name: "Biedronka", coords: [50.08992826337707, 19.962143576768426], icon: "fa-solid fa-bag-shopping" },
    { name: "Przystanek autobusowy Strzelców", coords: [50.09274556384751, 19.974902247624552], icon: "fa-solid fa-bus" },
    { name: "Przystanek Rondo Barei", coords: [50.08975632811351, 19.97387356041435], icon: "fa-solid fa-bus-simple" }
  ];

  poi.forEach((item) => {
    L.marker(item.coords, { icon: icon(item.icon) })
      .addTo(map)
      .bindPopup(`<strong>${item.name}</strong>`);
  });
}

async function init() {
  await Promise.all([loadBookedSlots(), loadAvailability()]);
  initDateInput();
  renderSlots();
  dateInput.addEventListener("change", renderSlots);
  initFadeIn();
  initAnalytics();
  initMap();
  initLightbox();
  initForm();
}

init();
