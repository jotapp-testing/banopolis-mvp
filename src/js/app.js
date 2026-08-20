import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore, collection, addDoc, getDocs, doc, updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// -- Mobile viewport height fix (--vh)
function setVh() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
setVh();
window.addEventListener('resize', setVh);

// -- PWA install prompt handling
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('hidden');
});

async function handleInstallClick() {
    const btn = document.getElementById('installBtn');
    if (!deferredPrompt) return;
    try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
            // hide the button after accept
            if (btn) btn.classList.add('hidden');
        }
        deferredPrompt = null;
    } catch (err) {
        console.error('Install prompt error', err);
    }
}
const installBtn = document.getElementById('installBtn');
if (installBtn) installBtn.addEventListener('click', handleInstallClick);

// Firebase config & initialization
const firebaseConfig = {
    apiKey: "AIzaSyDs-Zyr8SJwtka8jhaaUGU7o32msthek20",
    authDomain: "banopolis-mvp.firebaseapp.com",
    projectId: "banopolis-mvp",
    storageBucket: "banopolis-mvp.firebasestorage.app",
    messagingSenderId: "724783807966",
    appId: "1:724783807966:web:a931902d099cbbe7c6b14f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const banosCol = collection(db, "banos");

function escaparHTML(texto) {
    if (!texto) return '';
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

const categoriaInfo = {
    publico: { emoji: '🚻', label: 'Baño público' },
    cafe: { emoji: '☕', label: 'Café/Bar' },
    estacion: { emoji: '⛽', label: 'Estación de servicio' },
    shopping: { emoji: '🏬', label: 'Shopping' },
    plaza: { emoji: '🌳', label: 'Plaza/Parque' },
    otro: { emoji: '📍', label: 'Otro' }
};

const POPUP_OPTS = {
    maxWidth: 440,
    minWidth: 320,
    autoPanPaddingTopLeft: L.point(16, 150),
    autoPanPaddingBottomRight: L.point(16, 120)
};
const FORM_POPUP_OPTS = { ...POPUP_OPTS, closeOnClick: false, autoClose: false };

let banosCache = [];
let filtroSoloGratis = false;
let filtroSoloAccesible = false;
let filtroCerca = false;
let ordenarMejorPuntuados = false;
let textoBusqueda = '';
let modoAgregarReview = false;

let userPos = null;
let centradoInicialHecho = false;
const RADIO_CERCA_M = 200;

// ---------- Estrellas SVG (puntas redondeadas) ----------
function starSVG(filled) {
    return `<svg viewBox="0 0 24 24" width="28" height="28" stroke-linejoin="round" stroke-linecap="round"
    stroke="${filled ? '#B97C22' : '#D7E3E2'}" stroke-width="1.3"
    fill="${filled ? '#E8A33D' : '#F1F5F4'}">
    <path d="M12 3.6l2.6 5.5 6.1.8-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.8z"/>
  </svg>`;
}
function starsHTML(id, valorInicial) {
    let html = `<div class="stars" id="${id}">`;
    for (let i = 1; i <= 5; i++) html += `<span class="star" data-val="${i}">${starSVG(i <= valorInicial)}</span>`;
    html += `</div>`;
    return html;
}
function pintarEstrellas(id, valor) {
    document.querySelectorAll(`#${id} .star`).forEach(el => {
        const v = Number(el.dataset.val);
        el.innerHTML = starSVG(v <= valor);
    });
}
function activarEstrellas(id, onChange) {
    document.querySelectorAll(`#${id} .star`).forEach(s => s.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const val = Number(s.dataset.val);
        pintarEstrellas(id, val);
        onChange(val);
    }));
}

function mostrarToast(mensaje, tipo = 'info') {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = mensaje;
    toast.className = `toast show ${tipo}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.className = 'toast';
    }, 2400);
}

function prepararPopupInteractivo(container) {
    if (!container) return;
    ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach(eventName => {
        container.addEventListener(eventName, (ev) => ev.stopPropagation());
    });
    container.querySelectorAll('input, textarea, select, button, .pill, .star').forEach(el => {
        ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach(eventName => {
            el.addEventListener(eventName, (ev) => ev.stopPropagation());
        });
    });
}

function abrirPopupFormulario(latlng, formHtml) {
    const popup = L.popup(FORM_POPUP_OPTS).setLatLng(latlng).setContent(formHtml).openOn(map);
    requestAnimationFrame(() => {
        prepararPopupInteractivo(popup.getElement());
    });
    return popup;
}

function aplicarResumenResenas(b, resenasSnap) {
    let sum = 0; let count = 0;
    let gratisTrue = 0; let accesibleTrue = 0; let papelTrue = 0; let jabonTrue = 0; let cambiadorTrue = 0;
    resenasSnap.forEach(rd => {
        const r = rd.data();
        sum += r.limpieza || 0; count++;
        if (r.gratis) gratisTrue++;
        if (r.accesible) accesibleTrue++;
        if (r.papelHigienico) papelTrue++;
        if (r.jabon) jabonTrue++;
        if (r.cambiador) cambiadorTrue++;
    });
    b.avgLimpieza = count > 0 ? sum / count : 0;
    b.numResenas = count;
    b.gratis = count > 0 ? (gratisTrue / count) >= 0.5 : b.gratis;
    b.accesible = count > 0 ? (accesibleTrue / count) >= 0.5 : b.accesible;
    b.papelHigienico = count > 0 ? (papelTrue / count) >= 0.5 : b.papelHigienico;
    b.jabon = count > 0 ? (jabonTrue / count) >= 0.5 : b.jabon;
    b.cambiador = count > 0 ? (cambiadorTrue / count) >= 0.5 : b.cambiador;
}

function switchHTML(id, emoji, label, checkedInicial) {
    return `
    <div class="switch-row">
      <span class="switch-label">${emoji} ${label}</span>
      <label class="switch">
        <input type="checkbox" id="${id}" ${checkedInicial ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>`;
}

function insumoBadge(icon, label, valor) {
    return `<span class="insumo-badge"><span class="insumo-dot ${valor ? 'si' : 'no'}"></span>${icon} ${label}</span>`;
}

let userMarker = null;
function iconoUsuario() {
    return L.divIcon({ html: '<div class="user-dot"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] });
}
function actualizarMarcadorUsuario() {
    if (!userPos) return;
    if (userMarker) {
        userMarker.setLatLng([userPos.lat, userPos.lng]);
    } else {
        userMarker = L.marker([userPos.lat, userPos.lng], { icon: iconoUsuario(), zIndexOffset: 1000 }).addTo(map);
    }
}

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function formatDistancia(m) {
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(1)} km`;
}
function distanciaA(b) {
    if (!userPos) return null;
    return haversineMeters(userPos.lat, userPos.lng, b.lat, b.lng);
}

function mostrarBannerPermisoDenegado() {
    const banner = document.getElementById('locBanner');
    banner.innerHTML = `
    📍 No tenemos tu ubicación, así que no podemos mostrarte los baños más cercanos.<br>
    En Android: tocá el candado/ícono junto a la dirección → Permisos → Ubicación → "Permitir".
    <button id="cerrarBanner">Entendido</button>
  `;
    banner.classList.remove('hidden');
    document.getElementById('cerrarBanner').addEventListener('click', () => banner.classList.add('hidden'));
}

function pedirUbicacion(centrarSiEsPrimeraVez) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            document.getElementById('locBanner').classList.add('hidden');
            actualizarMarcadorUsuario();
            if (centrarSiEsPrimeraVez && !centradoInicialHecho) {
                map.setView([userPos.lat, userPos.lng], 15);
                centradoInicialHecho = true;
            }
            actualizarMapa();
        },
        (err) => { if (err.code === 1) mostrarBannerPermisoDenegado(); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function centrarEnUsuario(zoom = 16) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            actualizarMarcadorUsuario();
            map.setView([userPos.lat, userPos.lng], zoom);
            centradoInicialHecho = true;
            actualizarMapa();
        },
        (err) => { if (err.code === 1) mostrarBannerPermisoDenegado(); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

const modalOverlay = document.getElementById('modalOverlay');
const yaVisto = localStorage.getItem('banopolis_visto');
if (yaVisto) {
    modalOverlay.classList.add('hidden');
    pedirUbicacion(true);
}
document.getElementById('cerrarModalBtn').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    localStorage.setItem('banopolis_visto', 'true');
    pedirUbicacion(true);
});
document.getElementById('infoBtn').addEventListener('click', () => {
    modalOverlay.classList.remove('hidden');
});
document.getElementById('searchToggleBtn').addEventListener('click', () => {
    const row = document.getElementById('searchRow');
    row.classList.toggle('abierto');
    if (row.classList.contains('abierto')) document.getElementById('buscador').focus();
});

const map = L.map('map', { zoomControl: false }).setView([-34.6037, -58.3816], 13);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);

const markersLayer = L.markerClusterGroup();
map.addLayer(markersLayer);

function estrellasTexto(n) { return "★".repeat(n) + "☆".repeat(5 - n); }
function resumenPuntaje(b) { if (b.numResenas === 0) return 'Sin reseñas todavía'; return `${estrellasTexto(Math.round(b.avgLimpieza))} ${b.avgLimpieza.toFixed(1)} (${b.numResenas})`; }

function iconoBano(b) {
    const cat = categoriaInfo[b.categoria] || categoriaInfo.otro;
    const color = b.reportes >= 3 ? '#9AA5A5' : (b.gratis ? 'var(--color-primary)' : 'var(--color-accent)');
    return L.divIcon({
        html: `
      <div style="position:relative; width:34px; height:40px;">
        <div style="position:absolute; top:0; left:1px; width:32px; height:32px; background:${color}; border-radius:9px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(15,40,40,0.35); border:2px solid white;">
          <span style="font-size:16px;">${cat.emoji}</span>
        </div>
        <div style="position:absolute; bottom:0; left:12px; width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent; border-top:8px solid ${color};"></div>
      </div>
    `,
        className: '', iconSize: [34, 40], iconAnchor: [17, 40]
    });
}

function compartir(url, texto) {
    if (navigator.share) {
        navigator.share({ title: 'Bañópolis', text: texto, url }).catch(() => { });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => alert('Link copiado al portapapeles')).catch(() => prompt('Copiá este link:', url));
    } else {
        prompt('Copiá este link:', url);
    }
}

function generarPopupHTML(b) {
    const cat = categoriaInfo[b.categoria] || categoriaInfo.otro;
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
    const shareUrl = `${location.origin}${location.pathname}?bano=${b.id}`;
    const dist = distanciaA(b);
    return `
    <div class="popup-info">
      ${b.fotoUrl ? `<img src="${b.fotoUrl}" onerror="this.style.display='none'" alt="Foto del lugar">` : ''}
      <b>${cat.emoji} ${escaparHTML(b.nombre)}</b><br>
      ${b.gratis ? '🟢 Gratis' : '🟠 Pago'} · ${cat.label}<br>
      <span class="estrellas-view">${resumenPuntaje(b)}</span><br>
      ${b.accesible ? '♿ Accesible' : '🚫 No accesible'}
      ${dist !== null ? `<br><span class="dist-badge">📍 a ${formatDistancia(dist)}</span>` : ''}
      <div class="insumos-row">
        ${insumoBadge('🧻', 'Papel', b.papelHigienico)}
        ${insumoBadge('🧼', 'Jabón', b.jabon)}
        ${insumoBadge('👶', 'Cambiador', b.cambiador)}
      </div>
      ${b.reportes >= 3 ? `<div class="warn-badge">⚠️ Varios usuarios reportaron que ya no existe o está cerrado</div>` : ''}
      <div class="popup-actions">
        <a href="${gmapsUrl}" target="_blank">📍 Cómo llegar</a>
        <a href="#" class="btn-resena" data-id="${b.id}">✍️ Dejar reseña</a>
        <a href="#" class="btn-share" data-url="${shareUrl}">📤 Compartir este baño</a>
        <a href="#" class="btn-report" data-id="${b.id}">🚩 Reportar cerrado/inexistente</a>
      </div>
    </div>
  `;
}

async function refrescarBano(id) {
    const b = banosCache.find(x => x.id === id);
    if (!b) return;
    const snap = await getDocs(collection(db, "banos", id, "resenas"));
    aplicarResumenResenas(b, snap);
    b.marker.setIcon(iconoBano(b));
}

async function reportarBano(id) {
    if (!confirm('¿Confirmás que este baño ya no existe o está cerrado permanentemente?')) return;
    try {
        await updateDoc(doc(db, "banos", id), { reportes: increment(1) });
        const b = banosCache.find(x => x.id === id);
        b.reportes = (b.reportes || 0) + 1;
        b.marker.setIcon(iconoBano(b));
        mostrarToast('Gracias, tu reporte fue registrado.', 'success');
        map.closePopup();
    } catch (err) {
        console.error(err);
        mostrarToast('No pudimos registrar el reporte. Probá de nuevo.', 'error');
    }
}

// ---------- Formulario de reseña ----------
function abrirFormularioResena(b, latlng) {
    const cat = categoriaInfo[b.categoria] || categoriaInfo.otro;
    const formHtml = `
    <div class="form-popup">
      <h3>✍️ Sumá tu reseña</h3>
      <div class="resena-contexto">${cat.emoji} ${escaparHTML(b.nombre)}<br>Actualmente: ${resumenPuntaje(b)}</div>
      <label>¿Es gratis?</label>
      <div class="pill-group" id="revGratis">
        <div class="pill active-green" data-val="true">Gratis</div>
        <div class="pill" data-val="false">Pago</div>
      </div>
      <label>Limpieza</label>
      ${starsHTML('revEstrellas', 3)}
      ${switchHTML('revAccesible', '♿', 'Accesible', false)}
      ${switchHTML('revPapel', '🧻', 'Papel higiénico', false)}
      ${switchHTML('revJabon', '🧼', 'Jabón/dispensador', false)}
      ${switchHTML('revCambiador', '👶', 'Cambiador de bebés', false)}
      <label>comentarios</label>
      <textarea id="revcomentarios" rows="2" placeholder="Opcional" maxlength="300"></textarea>
      <button class="guardarBtn" id="revGuardarBtn">Enviar reseña</button>
    </div>
  `;
    const popup = abrirPopupFormulario(latlng, formHtml);

    setTimeout(() => {
        let gratisVal = true, estrellasVal = 3;
        document.querySelectorAll('#revGratis .pill').forEach(p => p.addEventListener('click', (ev) => {
            ev.stopPropagation();
            document.querySelectorAll('#revGratis .pill').forEach(x => x.classList.remove('active-green', 'active-orange'));
            gratisVal = p.dataset.val === 'true';
            p.classList.add(gratisVal ? 'active-green' : 'active-orange');
        }));
        activarEstrellas('revEstrellas', v => estrellasVal = v);
        const comentarioInput = document.getElementById('revcomentarios');
        if (comentarioInput) comentarioInput.focus();

        const revBtn = document.getElementById('revGuardarBtn');
        revBtn.addEventListener('click', async () => {
            if (revBtn.disabled) return;
            const comentarios = document.getElementById('revcomentarios').value.trim();
            const accesibleVal = document.getElementById('revAccesible').checked;
            const papelVal = document.getElementById('revPapel').checked;
            const jabonVal = document.getElementById('revJabon').checked;
            const cambiadorVal = document.getElementById('revCambiador').checked;
            revBtn.disabled = true; revBtn.textContent = 'Enviando...';
            try {
                await addDoc(collection(db, "banos", b.id, "resenas"), {
                    gratis: gratisVal, limpieza: estrellasVal, accesible: accesibleVal,
                    papelHigienico: papelVal, jabon: jabonVal, cambiador: cambiadorVal,
                    comentarios, fecha: serverTimestamp()
                });
                await refrescarBano(b.id);
                map.closePopup(popup);
                L.popup(POPUP_OPTS).setLatLng(latlng).setContent(generarPopupHTML(b)).openOn(map);
                actualizarListaResultados(banosCache);
                mostrarToast('¡Gracias! Tu reseña ya está visible para otros usuarios.', 'success');
            } catch (err) {
                console.error(err);
                mostrarToast('Error al guardar la reseña. Probá de nuevo.', 'error');
                revBtn.disabled = false; revBtn.textContent = 'Enviar reseña';
            }
        });
    }, 100);
}

map.on('popupopen', (e) => {
    const container = e.popup.getElement();
    if (!container) return;
    const btnResena = container.querySelector('.btn-resena');
    if (btnResena) btnResena.addEventListener('click', (ev) => {
        ev.preventDefault();
        const b = banosCache.find(x => x.id === btnResena.dataset.id);
        const latlng = e.popup.getLatLng();
        map.closePopup(e.popup);
        if (b) abrirFormularioResena(b, latlng);
    });
    const btnShare = container.querySelector('.btn-share');
    if (btnShare) btnShare.addEventListener('click', (ev) => { ev.preventDefault(); compartir(btnShare.dataset.url, "Mirá este baño en Bañópolis"); });
    const btnReport = container.querySelector('.btn-report');
    if (btnReport) btnReport.addEventListener('click', (ev) => { ev.preventDefault(); reportarBano(btnReport.dataset.id); });
});

async function cargarBanos() {
    if (!navigator.onLine) {
        document.getElementById('loadingBox').innerHTML = '📡 Sin conexión a internet.<br>Conectate y volvé a abrir la app.';
        return;
    }
    try {
        const snapshot = await getDocs(banosCol);
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const b = {
                id: docSnap.id, nombre: data.nombre, categoria: data.categoria || 'otro',
                lat: data.lat, lng: data.lng, fotoUrl: data.fotoUrl || '',
                reportes: data.reportes || 0,
                gratis: true, accesible: false, papelHigienico: false, jabon: false, cambiador: false,
                avgLimpieza: 0, numResenas: 0
            };
            const resenasSnap = await getDocs(collection(db, "banos", b.id, "resenas"));
            aplicarResumenResenas(b, resenasSnap);

            const marker = L.marker([b.lat, b.lng], { icon: iconoBano(b) });
            marker.bindPopup(() => generarPopupHTML(b), POPUP_OPTS);
            marker.on('click', (ev) => {
                if (!modoAgregarReview) return;
                modoAgregarReview = false;
                document.getElementById('modoAgregarBanner').classList.add('hidden');
                if (ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
                marker.closePopup();
                map.closePopup();
                requestAnimationFrame(() => abrirFormularioResena(b, ev.latlng || L.latLng(b.lat, b.lng)));
            });
            b.marker = marker;
            banosCache.push(b);
        }
        actualizarMapa();
        revisarParametroURL();
        document.getElementById('loadingOverlay').classList.add('hidden');
    } catch (err) {
        console.error("Error cargando baños:", err);
        document.getElementById('loadingBox').innerHTML = '⚠️ No pudimos cargar los baños.<br>Probá de nuevo en un momento.';
    }
}

function revisarParametroURL() {
    const params = new URLSearchParams(location.search);
    const id = params.get('bano');
    if (!id) return;
    const b = banosCache.find(x => x.id === id);
    if (b) { map.setView([b.lat, b.lng], 17); setTimeout(() => b.marker.openPopup(), 300); }
}

function actualizarMapa() {
    markersLayer.clearLayers();
    let filtrados = banosCache.filter(b => {
        if (filtroSoloGratis && !b.gratis) return false;
        if (filtroSoloAccesible && !b.accesible) return false;
        if (textoBusqueda && !b.nombre.toLowerCase().includes(textoBusqueda.toLowerCase())) return false;
        if (filtroCerca) {
            const d = distanciaA(b);
            if (d === null || d > RADIO_CERCA_M) return false;
        }
        return true;
    });
    filtrados.forEach(b => markersLayer.addLayer(b.marker));
    actualizarListaResultados(filtrados);
}

function actualizarListaResultados(filtrados) {
    let ordenados = [...filtrados];
    if (ordenarMejorPuntuados) {
        ordenados.sort((a, b) => b.avgLimpieza - a.avgLimpieza);
    } else if (userPos) {
        ordenados.sort((a, b) => distanciaA(a) - distanciaA(b));
    }
    document.getElementById('resultsCount').textContent = ordenados.length;
    const panel = document.getElementById('resultsList');
    panel.innerHTML = ordenados.map(b => {
        const cat = categoriaInfo[b.categoria] || categoriaInfo.otro;
        const d = distanciaA(b);
        return `<div class="result-item" data-id="${b.id}">
      <b>${cat.emoji} ${escaparHTML(b.nombre)}</b> ${d !== null ? `<span class="result-dist">· ${formatDistancia(d)}</span>` : ''}<br>
      <span class="estrellas-view">${resumenPuntaje(b)}</span> · ${b.gratis ? 'Gratis' : 'Pago'}
    </div>`;
    }).join('') || '<div class="result-item">Sin resultados</div>';

    panel.querySelectorAll('.result-item[data-id]').forEach(item => {
        item.addEventListener('click', () => {
            const b = banosCache.find(x => x.id === item.dataset.id);
            if (b) {
                map.setView([b.lat, b.lng], 17);
                b.marker.openPopup();
                document.getElementById('resultsPanel').classList.add('hidden');
            }
        });
    });
}

function toggleChip(el, activo) { el.classList.toggle('chip-active', activo); }
document.getElementById('chipGratis').addEventListener('click', function () { filtroSoloGratis = !filtroSoloGratis; toggleChip(this, filtroSoloGratis); actualizarMapa(); });
document.getElementById('chipAccesible').addEventListener('click', function () { filtroSoloAccesible = !filtroSoloAccesible; toggleChip(this, filtroSoloAccesible); actualizarMapa(); });
document.getElementById('chipCerca').addEventListener('click', function () { if (!userPos) { pedirUbicacion(false); } filtroCerca = !filtroCerca; toggleChip(this, filtroCerca); actualizarMapa(); });
document.getElementById('chipOrden').addEventListener('click', function () { ordenarMejorPuntuados = !ordenarMejorPuntuados; toggleChip(this, ordenarMejorPuntuados); actualizarMapa(); });
document.getElementById('buscador').addEventListener('input', (e) => { textoBusqueda = e.target.value; actualizarMapa(); });
document.getElementById('resultsToggle').addEventListener('click', () => { document.getElementById('resultsPanel').classList.toggle('hidden'); });
document.getElementById('resultsCloseBtn').addEventListener('click', () => { document.getElementById('resultsPanel').classList.add('hidden'); });
document.getElementById('shareAppBtn').addEventListener('click', () => { compartir(location.origin + location.pathname, 'Encontrá baños cerca tuyo con Bañópolis 🚽'); });

document.getElementById('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Tu navegador no soporta geolocalización.'); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            document.getElementById('locBanner').classList.add('hidden');
            actualizarMarcadorUsuario();
            map.setView([userPos.lat, userPos.lng], 16);
            actualizarMapa();
        },
        (err) => { if (err.code === 1) mostrarBannerPermisoDenegado(); else alert('No pudimos acceder a tu ubicación.'); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

// Add button now opens add modal (place search + select on map)
document.getElementById('addBtn').addEventListener('click', () => {
    centrarEnUsuario(16);
    modoAgregarReview = true;
    document.getElementById('modoAgregarBanner').classList.remove('hidden');
});

document.getElementById('cancelarAgregarBtn').addEventListener('click', () => {
    modoAgregarReview = false;
    document.getElementById('modoAgregarBanner').classList.add('hidden');
});

cargarBanos();

// Register service worker (ensure sw.js stays at site root for proper scope)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW error:', err));
    });
}
