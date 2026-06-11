// === KONFIGURACJA — uzupełnij po wdrożeniu ===
const CONFIG = {
  // prywatne repozytorium GitHub z ewidencją rezerwacji (tam trafiają issue)
  githubRepo: "rozrywka/rezerwacje",
  // endpoint formularza z https://formspree.io (darmowe konto)
  formspreeEndpoint: "https://formspree.io/f/xeewreqw"
};

const allSlots = ["18:00", "18:30", "19:00", "19:30"];
let selectedSlot = "";
let bookedSlots = new Map(); // "RRRR-MM-DD GG:MM" -> imię (lub "")
let captcha = { a: 0, b: 0 };

const dateInput = document.getElementById("visit-date");
const slotList = document.getElementById("slot-list");
const statusBox = document.getElementById("booking-status");
const selectedSlotInput = document.getElementById("selected-slot-input");
const form = document.getElementById("kontakt");

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

function isBusy(date, time) {
  return bookedSlots.has(`${date} ${time}`);
}

function busyName(date, time) {
  return bookedSlots.get(`${date} ${time}`) || "";
}

function renderSlots() {
  const date = dateInput.value;
  slotList.innerHTML = "";
  selectedSlot = "";
  selectedSlotInput.value = "";

  if (!date) {
    statusBox.textContent = "Wybierz najpierw dzień z kalendarza.";
    return;
  }

  allSlots.forEach((time) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";

    if (isBusy(date, time)) {
      btn.classList.add("busy");
      btn.disabled = true;
      const name = busyName(date, time);
      btn.textContent = name ? `${time} — zarezerwowane: ${name}` : `${time} — zajęty`;
    } else {
      btn.textContent = `${time} - wolny`;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedSlot = `${date} ${time}`;
        selectedSlotInput.value = selectedSlot;
        statusBox.textContent = `Wybrano termin: ${selectedSlot} (oczekuje na potwierdzenie).`;
      });
    }

    slotList.appendChild(btn);
  });

  statusBox.textContent = "Wybierz dostępny slot i uzupełnij formularz.";
}

function initDateInput() {
  const today = new Date();
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 2);

  dateInput.min = toIsoDate(today);
  dateInput.max = toIsoDate(maxDate);
  dateInput.value = toIsoDate(today);
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
  const confirmMsg = "✓ Zgłoszenie wysłane! Termin jest wstępnie zarezerwowany — potwierdzenie otrzymasz telefonicznie lub SMS-em.";
  const submitBtn = form.querySelector('button[type="submit"]');
  newCaptcha();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!selectedSlot) {
      setFormStatus("error", "Wybierz najpierw termin oglądania z listy slotów.");
      return;
    }

    const captchaInput = document.getElementById("captcha-input");
    if (parseInt(captchaInput.value, 10) !== captcha.a + captcha.b) {
      newCaptcha();
      setFormStatus("error", "Błędny wynik działania — spróbuj jeszcze raz. / Wrong answer, try again.");
      captchaInput.focus();
      return;
    }

    const [date, time] = selectedSlot.split(" ");
    const name = document.getElementById("name").value.trim() || "Gość";
    document.getElementById("confirm-link-input").value = buildConfirmLink(date, time, name);
    document.getElementById("subject-input").value = `Rezerwacja oglądania: ${selectedSlot} — ${name}`;

    submitBtn.disabled = true;
    setFormStatus("pending", "Wysyłanie zgłoszenia…");

    try {
      const formData = new FormData(form);
      const res = await fetch(CONFIG.formspreeEndpoint, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFormStatus("success", confirmMsg);
      form.reset();
      newCaptcha();
      document.querySelectorAll(".slot-btn.selected").forEach((b) => b.classList.remove("selected"));
      selectedSlot = "";
      selectedSlotInput.value = "";
      statusBox.textContent = "";
    } catch (err) {
      console.error("Błąd wysyłki formularza:", err);
      setFormStatus("error", "Nie udało się wysłać zgłoszenia. Spróbuj ponownie lub skontaktuj się telefonicznie.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initMap() {
  if (!window.L) return;
  const mapNode = document.getElementById("map");
  if (!mapNode) return;

  const home = [50.0932, 19.9882];
  const map = L.map("map", {
    scrollWheelZoom: false,
    zoomControl: true,
    minZoom: 16
  }).setView(home, 17);

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
    .bindPopup("<strong>Rozrywki 24</strong><br>Mieszkanie na wynajem");

  const poi = [
    { name: "CH Serenada", coords: [50.0924, 19.9897], icon: "fa-solid fa-cart-shopping" },
    { name: "CH Krokus", coords: [50.0916, 19.9872], icon: "fa-solid fa-store" },
    { name: "Multikino", coords: [50.0908, 19.989], icon: "fa-solid fa-film" },
    { name: "Park Wodny", coords: [50.0939, 19.9937], icon: "fa-solid fa-water-ladder" },
    { name: "Auchan", coords: [50.0913, 19.9853], icon: "fa-solid fa-basket-shopping" },
    { name: "Biedronka", coords: [50.0951, 19.9861], icon: "fa-solid fa-bag-shopping" },
    { name: "Żabka", coords: [50.0945, 19.989], icon: "fa-solid fa-seedling" },
    { name: "Park Zaczarowanej Dorożki", coords: [50.096, 19.9924], icon: "fa-solid fa-tree-city" },
    { name: "Przystanek Strzelców", coords: [50.0923, 19.9946], icon: "fa-solid fa-bus" },
    { name: "Przystanek Rondo Barei", coords: [50.091, 19.9817], icon: "fa-solid fa-bus-simple" },
    { name: "Przystanek Prądnik Czerwony", coords: [50.095, 19.9819], icon: "fa-solid fa-train-tram" }
  ];

  poi.forEach((item) => {
    L.marker(item.coords, { icon: icon(item.icon) })
      .addTo(map)
      .bindPopup(`<strong>${item.name}</strong><br>Przykładowe oznaczenie w okolicy`);
  });
}

async function init() {
  initDateInput();
  await loadBookedSlots();
  renderSlots();
  dateInput.addEventListener("change", renderSlots);
  initFadeIn();
  initMap();
  initLightbox();
  initForm();
}

init();
