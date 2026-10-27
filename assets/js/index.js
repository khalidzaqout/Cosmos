// ================== CONFIG ==================
// Get a free personal key from https://api.nasa.gov/ — DEMO_KEY is limited to ~30 requests/hour per IP.
const NASA_API_KEY = "bU7WaOFtMVnWeJGvbySkFHQt5WestD49c69xOgQa";
const APOD_URL = "https://api.nasa.gov/planetary/apod";
const LAUNCHES_URL = "https://lldev.thespacedevs.com/2.3.0/launches/upcoming/?limit=10";
const PLANETS_URL = "https://solar-system-opendata-proxy.vercel.app/api/planets";

const KM_PER_AU = 149597870.7;
const IMAGES_PATH = "./assets/images/";
const LAUNCH_PLACEHOLDER = `${IMAGES_PATH}launch-placeholder.png`;

const PLANET_COLORS = {
  mercury: "#eab308",
  venus: "#f97316",
  earth: "#3b82f6",
  mars: "#ef4444",
  jupiter: "#fb923c",
  saturn: "#facc15",
  uranus: "#06b6d4",
  neptune: "#2563eb",
};

const PLANET_TYPE_BADGES = {
  Terrestrial: { bg: "#f9731680", text: "#fed7aa" },
  "Gas Giant": { bg: "#a855f780", text: "#e9d5ff" },
  "Ice Giant": { bg: "#06b6d480", text: "#a5f3fc" },
};

const LAUNCH_STATUS_COLORS = {
  Go: "#22c55e",
  Success: "#22c55e",
  TBC: "#eab308",
  TBD: "#3b82f6",
  Hold: "#ef4444",
  Failure: "#ef4444",
  "In Flight": "#a855f7",
};

let planets = [];
let selectedPlanetId = null;

// ================== HELPERS ==================
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Server errors (5xx) from these public APIs are often transient, so retry them with a growing delay.
async function fetchJson(url, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    const data = await response.json().catch(() => null);
    if (response.ok) return data;

    if (response.status >= 500 && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    const error = new Error(data?.msg || data?.error?.message || data?.detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
}

// APOD publishes on US Eastern time; a later local date is rejected by the API as "in the future".
function getApodToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// APOD dates are calendar dates ("YYYY-MM-DD"), so format them in UTC to avoid off-by-one days.
function formatIsoDate(isoDate, options) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
}

function toSuperscript(number) {
  const map = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  return String(number).replace(/[-0-9]/g, (c) => map[c]);
}

function formatScientific(value, exponent, unit) {
  return `${Number(value.toFixed(2))} × 10${toSuperscript(exponent)} ${unit}`;
}

function formatMillionKm(km) {
  return km ? `${(km / 1e6).toFixed(1)}M km` : "N/A";
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function errorBlock(title, message) {
  return `
    <div class="col-span-full text-center py-12">
      <i class="fas fa-exclamation-triangle text-red-400 text-5xl mb-4"></i>
      <p class="text-slate-300 text-lg">${escapeHtml(title)}</p>
      <p class="text-slate-500 text-sm mt-2">${escapeHtml(message)}</p>
    </div>`;
}

function loadingBlock(message) {
  return `
    <div class="col-span-full text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-blue-400 mb-4"></i>
      <p class="text-slate-400">${escapeHtml(message)}</p>
    </div>`;
}

// ================== NAVIGATION & SIDEBAR ==================
function setupSidebar() {
  const sidebar = $("sidebar");
  const toggle = $("sidebar-toggle");
  let overlay = null;

  function open() {
    sidebar.classList.add("sidebar-open");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "sidebar-overlay";
      overlay.addEventListener("click", close);
      document.body.appendChild(overlay);
    }
  }

  function close() {
    sidebar.classList.remove("sidebar-open");
    overlay?.remove();
    overlay = null;
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar.classList.contains("sidebar-open") ? close() : open();
  });

  return { close };
}

function setupNavigation(sidebar) {
  const links = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll(".app-section");

  function showSection(name) {
    sections.forEach((s) => s.classList.toggle("hidden", s.dataset.section !== name));
    links.forEach((link) => {
      const active = link.dataset.section === name;
      link.classList.toggle("bg-blue-500/10", active);
      link.classList.toggle("text-blue-400", active);
      link.classList.toggle("text-slate-300", !active);
      link.classList.toggle("hover:bg-slate-800", !active);
    });
    window.scrollTo(0, 0);
  }

  links.forEach((link) =>
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const name = link.dataset.section;
      history.replaceState(null, "", `#${name}`);
      showSection(name);
      sidebar.close();
    }),
  );

  const initial = location.hash.slice(1);
  const valid = [...sections].some((s) => s.dataset.section === initial);
  showSection(valid ? initial : "today-in-space");
}

// ================== TODAY IN SPACE (NASA APOD) ==================
function setupApod() {
  const input = $("apod-date-input");
  const dateLabel = $("apod-date-label");
  const today = getApodToday();

  input.max = today;
  input.value = today;

  const updateLabel = () => {
    dateLabel.textContent = input.value
      ? formatIsoDate(input.value, { year: "numeric", month: "short", day: "numeric" })
      : "Select a date";
  };
  updateLabel();

  input.addEventListener("change", updateLabel);
  $("load-date-btn").addEventListener("click", () => input.value && loadApod(input.value));
  $("today-apod-btn").addEventListener("click", () => {
    input.value = today;
    updateLabel();
    loadApod(today, true);
  });

  loadApod(today, true);
}

function setApodLoading(message) {
  const loading = $("apod-loading");
  loading.innerHTML = `
    <i class="fas fa-spinner fa-spin text-4xl text-blue-400 mb-4"></i>
    <p class="text-slate-400">${escapeHtml(message)}</p>`;
  loading.classList.remove("hidden");
  $("apod-image").classList.add("hidden");
  $("apod-video")?.remove();
  $("apod-overlay").classList.add("hidden");
  $("apod-date").textContent = "Astronomy Picture of the Day";
  setApodText({ title: "Loading...", explanation: "", copyright: "", date: "—", mediaType: "—" });
}

function setApodError(message) {
  $("apod-loading").innerHTML = `
    <i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-4"></i>
    <p class="text-slate-300">Failed to load the picture</p>
    <p class="text-slate-500 text-sm mt-2">${escapeHtml(message)}</p>`;
  if ($("apod-title").textContent === "Loading...") {
    setApodText({ title: "Picture unavailable", explanation: "Please try another date or try again later." });
  }
}

function describeApodError(err) {
  if (err.status === 429) {
    return NASA_API_KEY === "DEMO_KEY"
      ? "The shared DEMO_KEY hit its rate limit. Add your own free key from api.nasa.gov in assets/js/index.js."
      : "NASA API rate limit reached. Please try again in a while.";
  }
  if (err.status === 403) return "The NASA API key is invalid. Check NASA_API_KEY in assets/js/index.js.";
  if (err.status >= 500) return "NASA's server is having trouble right now. Please try again in a moment.";
  return err.message;
}

function setApodText({ title, explanation, copyright, date, mediaType }) {
  $("apod-title").textContent = title;
  $("apod-explanation").textContent = explanation;
  if (copyright !== undefined) $("apod-copyright").textContent = copyright;
  if (date !== undefined) {
    $("apod-date-detail").innerHTML = `<i class="far fa-calendar mr-2"></i>${escapeHtml(date)}`;
    $("apod-date-info").textContent = date;
  }
  if (mediaType !== undefined) $("apod-media-type").textContent = mediaType;
}

let apodRequestId = 0;

// The date is always sent explicitly: NASA's no-date "today" request fails with 500 far more often.
async function loadApod(date, isToday = false) {
  const requestId = ++apodRequestId;
  setApodLoading(isToday ? "Loading today's image..." : `Loading picture for ${formatIsoDate(date, { dateStyle: "medium" })}...`);

  let data;
  try {
    data = await fetchJson(`${APOD_URL}?api_key=${NASA_API_KEY}&date=${date}`);
  } catch (err) {
    console.error("APOD error:", err);
    if (requestId === apodRequestId) setApodError(describeApodError(err));
    return;
  }
  if (requestId !== apodRequestId) return;

  renderApod(data);
}

function renderApod(data) {
  const longDate = formatIsoDate(data.date, { year: "numeric", month: "long", day: "numeric" });

  $("apod-date").textContent = `Astronomy Picture of the Day - ${longDate}`;
  setApodText({
    title: data.title,
    explanation: data.explanation?.trim() || "",
    copyright: data.copyright ? `© ${data.copyright.trim().replace(/\s+/g, " ")}` : "© NASA (Public Domain)",
    date: data.date,
    mediaType: data.media_type === "video" ? "Video" : data.media_type === "image" ? "Image" : "Other",
  });

  const loading = $("apod-loading");
  const image = $("apod-image");

  if (data.media_type === "image") {
    image.onload = () => {
      loading.classList.add("hidden");
      image.classList.remove("hidden");
      $("apod-overlay").classList.remove("hidden");
    };
    image.onerror = () => setApodError("The image could not be displayed.");
    image.alt = data.title;
    image.src = data.url;
    $("apod-fullres-link").href = data.hdurl || data.url;
  } else if (data.media_type === "video" && data.url) {
    const iframe = document.createElement("iframe");
    iframe.id = "apod-video";
    iframe.className = "w-full h-full";
    iframe.src = data.url;
    iframe.title = data.title;
    iframe.allowFullscreen = true;
    $("apod-image-container").appendChild(iframe);
    loading.classList.add("hidden");
  } else {
    setApodError("This day's media type can't be shown here.");
  }
}

// ================== LAUNCHES (SpaceDevs) ==================
async function loadLaunches() {
  const featured = $("featured-launch");
  const grid = $("launches-grid");
  featured.innerHTML = loadingBlock("Loading upcoming launches...");
  grid.innerHTML = "";

  try {
    const data = await fetchJson(LAUNCHES_URL);
    const launches = data.results || [];
    $("launches-count").textContent = `${launches.length} Launches`;
    $("launches-count-mobile").textContent = launches.length;

    if (launches.length === 0) {
      featured.innerHTML = errorBlock("No upcoming launches", "Check back later for new missions.");
      return;
    }
    featured.innerHTML = renderFeaturedLaunch(launches[0]);
    grid.innerHTML = launches.slice(1).map(renderLaunchCard).join("");
  } catch (err) {
    console.error("Launches error:", err);
    featured.innerHTML = errorBlock("Failed to load launches data", err.message);
  }
}

function getLaunchInfo(launch) {
  const net = new Date(launch.net);
  const status = launch.status?.abbrev || "TBD";
  return {
    name: escapeHtml(launch.name),
    status: escapeHtml(status),
    statusColor: LAUNCH_STATUS_COLORS[status] || "#64748b",
    statusDescription: escapeHtml(launch.status?.description || launch.status?.name || ""),
    provider: escapeHtml(launch.launch_service_provider?.name || "Unknown"),
    rocket: escapeHtml(launch.rocket?.configuration?.name || "N/A"),
    location: escapeHtml(launch.pad?.location?.name || "Unknown"),
    country: escapeHtml(launch.pad?.country?.name || launch.pad?.location?.country?.name || "Unknown"),
    mission: escapeHtml(launch.mission?.description || "Mission details will be available closer to launch date."),
    net,
    time: `${net.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`,
  };
}

function renderFeaturedLaunch(launch) {
  const info = getLaunchInfo(launch);
  const image = launch.image?.image_url || launch.rocket?.configuration?.image_url || LAUNCH_PLACEHOLDER;
  const msUntil = info.net - Date.now();
  const days = Math.floor(msUntil / 86400000);
  const hours = Math.floor(msUntil / 3600000);
  const countdown =
    msUntil <= 0
      ? { value: "T-0", label: "Launch Time Reached" }
      : days >= 1
        ? { value: days, label: days === 1 ? "Day Until Launch" : "Days Until Launch" }
        : { value: Math.max(hours, 1), label: "Hours Until Launch" };
  const date = info.net.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return `
    <div class="relative bg-slate-800/30 border border-slate-700 rounded-3xl overflow-hidden group hover:border-blue-500/50 transition-all">
      <div class="absolute inset-0 bg-linear-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <div class="relative grid grid-cols-1 lg:grid-cols-2 gap-6 p-8">
        <div class="flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-3 mb-4">
              <span class="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-full text-sm font-semibold flex items-center gap-2">
                <i class="fas fa-star"></i>
                Featured Launch
              </span>
              <span class="px-4 py-1.5 rounded-full text-sm font-semibold" title="${info.statusDescription}"
                style="background-color: ${hexToRgba(info.statusColor, 0.2)}; color: ${info.statusColor}">
                ${info.status}
              </span>
            </div>
            <h3 class="text-3xl font-bold mb-3 leading-tight">${info.name}</h3>
            <div class="flex flex-col xl:flex-row xl:items-center gap-4 mb-6 text-slate-400">
              <div class="flex items-center gap-2">
                <i class="fas fa-building"></i>
                <span>${info.provider}</span>
              </div>
              <div class="flex items-center gap-2">
                <i class="fas fa-rocket"></i>
                <span>${info.rocket}</span>
              </div>
            </div>
            <div class="inline-flex items-center gap-3 px-6 py-3 bg-linear-to-r from-blue-500/20 to-purple-500/20 rounded-xl mb-6">
              <i class="fas fa-clock text-2xl text-blue-400"></i>
              <div>
                <p class="text-2xl font-bold text-blue-400">${countdown.value}</p>
                <p class="text-xs text-slate-400">${countdown.label}</p>
              </div>
            </div>
            <div class="grid xl:grid-cols-2 gap-4 mb-6">
              <div class="bg-slate-900/50 rounded-xl p-4">
                <p class="text-xs text-slate-400 mb-1 flex items-center gap-2"><i class="fas fa-calendar"></i>Launch Date</p>
                <p class="font-semibold">${date}</p>
              </div>
              <div class="bg-slate-900/50 rounded-xl p-4">
                <p class="text-xs text-slate-400 mb-1 flex items-center gap-2"><i class="fas fa-clock"></i>Launch Time</p>
                <p class="font-semibold">${info.time}</p>
              </div>
              <div class="bg-slate-900/50 rounded-xl p-4">
                <p class="text-xs text-slate-400 mb-1 flex items-center gap-2"><i class="fas fa-map-marker-alt"></i>Location</p>
                <p class="font-semibold text-sm">${info.location}</p>
              </div>
              <div class="bg-slate-900/50 rounded-xl p-4">
                <p class="text-xs text-slate-400 mb-1 flex items-center gap-2"><i class="fas fa-globe"></i>Country</p>
                <p class="font-semibold">${info.country}</p>
              </div>
            </div>
            <p class="text-slate-300 leading-relaxed mb-6">${info.mission}</p>
          </div>
          <div class="flex flex-col md:flex-row gap-3">
            <button class="flex-1 self-start md:self-center px-6 py-3 bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors font-semibold flex items-center justify-center gap-2">
              <i class="fas fa-info-circle"></i>
              View Full Details
            </button>
            <div class="icons self-end md:self-center">
              <button class="px-4 py-3 bg-slate-700 rounded-xl hover:bg-slate-600 transition-colors"><i class="far fa-heart"></i></button>
              <button class="px-4 py-3 bg-slate-700 rounded-xl hover:bg-slate-600 transition-colors"><i class="fas fa-bell"></i></button>
            </div>
          </div>
        </div>
        <div class="relative">
          <div class="relative h-full min-h-[400px] rounded-2xl overflow-hidden bg-slate-900/50">
            <img src="${escapeHtml(image)}" alt="${info.name}" class="absolute inset-0 w-full h-full object-cover"
              onerror="this.onerror=null; this.src='${LAUNCH_PLACEHOLDER}';" />
            <div class="absolute inset-0 bg-linear-to-t from-slate-900 via-transparent to-transparent"></div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderLaunchCard(launch) {
  const info = getLaunchInfo(launch);
  const image = launch.image?.thumbnail_url || launch.image?.image_url || LAUNCH_PLACEHOLDER;
  const date = info.net.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return `
    <div class="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden hover:border-blue-500/30 transition-all group cursor-pointer">
      <div class="relative h-48 overflow-hidden bg-slate-900/50">
        <img src="${escapeHtml(image)}" alt="${info.name}" loading="lazy"
          class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          onerror="this.onerror=null; this.src='${LAUNCH_PLACEHOLDER}';" />
        <div class="absolute top-3 right-3">
          <span class="px-3 py-1 text-white backdrop-blur-sm rounded-full text-xs font-semibold" title="${info.statusDescription}"
            style="background-color: ${hexToRgba(info.statusColor, 0.9)}">
            ${info.status}
          </span>
        </div>
      </div>
      <div class="p-5">
        <div class="mb-3">
          <h4 class="font-bold text-lg mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">${info.name}</h4>
          <p class="text-sm text-slate-400 flex items-center gap-2">
            <i class="fas fa-building text-xs"></i>
            ${info.provider}
          </p>
        </div>
        <div class="space-y-2 mb-4">
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-calendar text-slate-500 w-4"></i>
            <span class="text-slate-300">${date}</span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-clock text-slate-500 w-4"></i>
            <span class="text-slate-300">${info.time}</span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-rocket text-slate-500 w-4"></i>
            <span class="text-slate-300">${info.rocket}</span>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <i class="fas fa-map-marker-alt text-slate-500 w-4"></i>
            <span class="text-slate-300 line-clamp-1">${info.location}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 pt-4 border-t border-slate-700">
          <button class="flex-1 px-4 py-2 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-sm font-semibold">Details</button>
          <button class="px-3 py-2 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors"><i class="far fa-heart"></i></button>
        </div>
      </div>
    </div>`;
}

// ================== PLANETS (Solar System OpenData) ==================
const planetKey = (planet) => planet.englishName.toLowerCase();
const planetColor = (planet) => PLANET_COLORS[planetKey(planet)] || "#64748b";
const planetImage = (planet) => (PLANET_COLORS[planetKey(planet)] ? `${IMAGES_PATH}${planetKey(planet)}.png` : planet.image);
const planetType = (planet) =>
  planet.type || (["jupiter", "saturn"].includes(planetKey(planet)) ? "Gas Giant" : ["uranus", "neptune"].includes(planetKey(planet)) ? "Ice Giant" : "Terrestrial");

async function loadPlanets() {
  try {
    const data = await fetchJson(PLANETS_URL);
    planets = (data.bodies || []).filter((b) => b.isPlanet).sort((a, b) => a.semimajorAxis - b.semimajorAxis);

    const countLabel = $("planets-count");
    if (countLabel) countLabel.textContent = `${planets.length} Planets`;
    const countMobile = $("planets-count-mobile");
    if (countMobile) countMobile.textContent = planets.length;

    renderPlanetCards();
    renderComparisonTable();
    selectPlanet((planets.find((p) => planetKey(p) === "earth") || planets[0])?.id);
  } catch (err) {
    console.error("Planets error:", err);
    $("planets-grid").innerHTML = errorBlock("Failed to load planets data", err.message);
  }
}

function renderPlanetCards() {
  const grid = $("planets-grid");
  grid.innerHTML = planets
    .map(
      (p) => `
      <div class="planet-card bg-slate-800/50 border border-slate-700 rounded-2xl p-4 transition-all cursor-pointer group"
        data-planet-id="${escapeHtml(p.id)}" style="--planet-color: ${planetColor(p)}">
        <div class="relative mb-3 h-24 flex items-center justify-center">
          <img class="w-20 h-20 object-contain group-hover:scale-110 transition-transform" src="${escapeHtml(planetImage(p))}" alt="${escapeHtml(p.englishName)}" />
        </div>
        <h4 class="font-semibold text-center text-sm">${escapeHtml(p.englishName)}</h4>
        <p class="text-xs text-slate-400 text-center">${(p.semimajorAxis / KM_PER_AU).toFixed(2)} AU</p>
      </div>`,
    )
    .join("");

  grid.querySelectorAll(".planet-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectPlanet(card.dataset.planetId);
      if (window.innerWidth < 1280) $("planet-detail-name").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    card.addEventListener("mouseenter", () => {
      if (card.dataset.planetId !== selectedPlanetId) card.style.borderColor = `${card.style.getPropertyValue("--planet-color")}80`;
    });
    card.addEventListener("mouseleave", () => {
      if (card.dataset.planetId !== selectedPlanetId) card.style.borderColor = "";
    });
  });
}

function selectPlanet(id) {
  const planet = planets.find((p) => p.id === id);
  if (!planet) return;
  selectedPlanetId = id;

  document.querySelectorAll(".planet-card").forEach((card) => {
    const selected = card.dataset.planetId === id;
    const color = card.style.getPropertyValue("--planet-color");
    card.style.borderColor = selected ? color : "";
    card.style.backgroundColor = selected ? hexToRgba(color, 0.12) : "";
  });

  renderPlanetDetails(planet);
}

function renderPlanetDetails(p) {
  const image = $("planet-detail-image");
  image.src = planetImage(p);
  image.alt = p.englishName;

  $("planet-detail-name").textContent = p.englishName;
  $("planet-detail-description").textContent =
    p.description || `${p.englishName} is a fascinating planet in our Solar System with unique characteristics.`;

  $("planet-distance").textContent = formatMillionKm(p.semimajorAxis);
  $("planet-radius").textContent = p.meanRadius ? `${Math.round(p.meanRadius).toLocaleString()} km` : "N/A";
  $("planet-mass").textContent = p.mass ? formatScientific(p.mass.massValue, p.mass.massExponent, "kg") : "N/A";
  $("planet-density").textContent = p.density ? `${p.density.toFixed(2)} g/cm³` : "N/A";
  $("planet-orbital-period").textContent = p.sideralOrbit ? `${p.sideralOrbit.toLocaleString(undefined, { maximumFractionDigits: 2 })} days` : "N/A";
  $("planet-rotation").textContent = p.sideralRotation ? `${Math.abs(p.sideralRotation).toFixed(2)} hours${p.sideralRotation < 0 ? " (retrograde)" : ""}` : "N/A";
  $("planet-moons").textContent = p.moons?.length ?? 0;
  $("planet-gravity").textContent = p.gravity ? `${p.gravity.toFixed(2)} m/s²` : "N/A";

  $("planet-discoverer").textContent = p.discoveredBy || "Known since antiquity";
  $("planet-discovery-date").textContent = p.discoveryDate || "Ancient";
  $("planet-body-type").textContent = p.bodyType || "Planet";
  $("planet-volume").textContent = p.vol ? formatScientific(p.vol.volValue, p.vol.volExponent, "km³") : "N/A";

  $("planet-perihelion").textContent = formatMillionKm(p.perihelion);
  $("planet-aphelion").textContent = formatMillionKm(p.aphelion);
  $("planet-eccentricity").textContent = p.eccentricity != null ? p.eccentricity.toFixed(4) : "N/A";
  $("planet-inclination").textContent = p.inclination != null ? `${p.inclination.toFixed(2)}°` : "N/A";
  $("planet-axial-tilt").textContent = p.axialTilt != null ? `${p.axialTilt.toFixed(2)}°` : "N/A";
  // avgTemp is in Kelvin; 0 means the API has no value.
  $("planet-temp").textContent = p.avgTemp ? `${Math.round(p.avgTemp - 273.15)}°C` : "N/A";
  $("planet-escape").textContent = p.escape ? `${(p.escape / 1000).toFixed(1)} km/s` : "N/A";

  $("planet-facts").innerHTML = buildPlanetFacts(p)
    .map(
      (fact) => `
      <li class="flex items-start">
        <i class="fas fa-check text-green-400 mt-1 mr-2"></i>
        <span class="text-slate-300">${escapeHtml(fact)}</span>
      </li>`,
    )
    .join("");

  const learnMore = $("planet-learn-more");
  if (learnMore) {
    const page = planetKey(p) === "earth" ? "Earth" : `${p.englishName}_(planet)`;
    learnMore.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(page)}`;
  }
}

function buildPlanetFacts(p) {
  const earth = planets.find((x) => planetKey(x) === "earth");
  const facts = [`Classified as a ${planetType(p).toLowerCase()} planet`];

  if (earth && p !== earth && p.meanRadius) {
    const ratio = p.meanRadius / earth.meanRadius;
    facts.push(ratio >= 1 ? `About ${ratio.toFixed(1)}× wider than Earth` : `About ${Math.round(ratio * 100)}% of Earth's size`);
  }

  const moons = p.moons?.length ?? 0;
  facts.push(moons === 0 ? "Has no known moons" : `Has ${moons} known moon${moons === 1 ? "" : "s"}`);

  if (p.sideralOrbit) {
    facts.push(
      p.sideralOrbit > 365.25 * 2
        ? `One year lasts ${(p.sideralOrbit / 365.25).toFixed(1)} Earth years`
        : `One year lasts ${Math.round(p.sideralOrbit)} Earth days`,
    );
  }
  if (p.sideralRotation < 0) facts.push("Rotates in the opposite direction to most planets");
  if (p.discoveredBy) facts.push(`Discovered by ${p.discoveredBy}${p.discoveryDate ? ` (${p.discoveryDate})` : ""}`);

  return facts.slice(0, 4);
}

function renderComparisonTable() {
  const earth = planets.find((p) => planetKey(p) === "earth");
  const earthMass = earth?.mass ? earth.mass.massValue * 10 ** earth.mass.massExponent : null;
  const cell = "px-4 md:px-6 py-3 md:py-4 text-slate-300 text-sm md:text-base whitespace-nowrap";

  $("planet-comparison-tbody").innerHTML = planets
    .map((p) => {
      const isEarth = p === earth;
      const mass = p.mass && earthMass ? (p.mass.massValue * 10 ** p.mass.massExponent) / earthMass : null;
      const period = p.sideralOrbit > 365.25 * 2 ? `${(p.sideralOrbit / 365.25).toFixed(1)} years` : `${p.sideralOrbit.toFixed(isEarth ? 1 : 0)} days`;
      const type = planetType(p);
      const badge = PLANET_TYPE_BADGES[type] || { bg: "#64748b80", text: "#e2e8f0" };

      return `
        <tr class="hover:bg-slate-800/30 transition-colors${isEarth ? " bg-blue-500/5" : ""}">
          <td class="px-4 md:px-6 py-3 md:py-4 sticky left-0 bg-slate-800 z-10">
            <div class="flex items-center space-x-2 md:space-x-3">
              <div class="w-6 h-6 md:w-8 md:h-8 rounded-full flex-shrink-0" style="background-color: ${planetColor(p)}"></div>
              <span class="font-semibold text-sm md:text-base whitespace-nowrap">${escapeHtml(p.englishName)}</span>
            </div>
          </td>
          <td class="${cell}">${(p.semimajorAxis / KM_PER_AU).toFixed(2)}</td>
          <td class="${cell}">${Math.round(p.meanRadius * 2).toLocaleString()}</td>
          <td class="${cell}">${mass == null ? "N/A" : mass < 10 ? mass.toFixed(3) : mass.toFixed(1)}</td>
          <td class="${cell}">${period}</td>
          <td class="${cell}">${p.moons?.length ?? 0}</td>
          <td class="px-4 md:px-6 py-3 md:py-4 whitespace-nowrap">
            <span class="px-2 py-1 rounded text-xs" style="background-color: ${badge.bg}; color: ${badge.text}">${escapeHtml(type)}</span>
          </td>
        </tr>`;
    })
    .join("");
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  const sidebar = setupSidebar();
  setupNavigation(sidebar);
  setupApod();
  loadLaunches();
  loadPlanets();
});
