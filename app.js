"use strict";
/* =========================================================
   MVA GEO — CONTOUR MAP
   APP.JS — VERSÃO OTIMIZADA E CORRIGIDA
   ========================================================= */
const $ = (id) => document.getElementById(id);
const state = {
    map: null,
    satellite: null,
    streets: null,
    drawing: false,
    closed: false,
    points: [],
    markers: [],
    polygon: null,
    contourLayers: [],
    contourData: [],
    undoStack: [],
    dem: null,
    processing: false,
    locationMarker: null
};
/* =========================================================
   CONFIGURAÇÃO
   ========================================================= */
const CONFIG = {
    center: [-29.6500, -50.7800],
    zoom: 13,
    elevationURL: "https://api.open-meteo.com/v1/elevation",
    batchSize: 250, // Lotes maiores para reduzir requisições
    maxRows: 70,
    maxColumns: 70,
    defaultSpacing: 60,
    maxContourSegments: 10000
};
/* =========================================================
   VERIFICAÇÃO DO LEAFLET
   ========================================================= */
if (typeof L === "undefined") {
    console.error("Leaflet não foi carregado.");
    const message = document.createElement("div");
    message.style.cssText =
        "position:fixed;top:20px;left:20px;right:20px;z-index:99999;padding:16px;background:#b91c1c;color:white;border-radius:10px;font-family:Arial,sans-serif;";
    message.textContent = "Erro: o mapa não conseguiu carregar. Recarregue a página.";
    document.body.appendChild(message);
    throw new Error("Leaflet não disponível.");
}
/* =========================================================
   STATUS
   ========================================================= */
function status(text) {
    const element = $("status");
    if (element) {
        element.textContent = text;
    }
}
/* =========================================================
   TOAST
   ========================================================= */
function toast(text) {
    const element = $("toast");
    if (!element) {
        console.log(text);
        return;
    }
    element.textContent = text;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
        element.classList.remove("show");
    }, 3000);
}
/* =========================================================
   LOADING
   ========================================================= */
function loading(visible, title = "Processando...", message = "Aguarde.") {
    const element = $("loading");
    if (!element) {
        return;
    }
    if (visible) {
        element.classList.remove("hidden");
        const titleElement = $("loadingTitle") || $("loadingText");
        const textElement = $("loadingText");
        if (titleElement) {
            titleElement.textContent = title;
        }
        if (textElement && titleElement !== textElement) {
            textElement.textContent = message;
        }
    } else {
        element.classList.add("hidden");
    }
}
/* =========================================================
   FORMATAÇÃO
   ========================================================= */
function numberBR(value, decimals = 2) {
    return Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/* =========================================================
   DATA PARA ARQUIVOS
   ========================================================= */
function fileDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return y + m + day + "_" + h + min;
}
/* =========================================================
   MAPA
   ========================================================= */
state.map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
}).setView(CONFIG.center, CONFIG.zoom);
/* =========================================================
   CAMADAS
   ========================================================= */
state.satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "© Esri" }
);
state.streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
);
state.satellite.addTo(state.map);
L.control.layers(
    { "Satélite": state.satellite, "Mapa": state.streets },
    null,
    { collapsed: true }
).addTo(state.map);
/* =========================================================
   ÍCONE DOS VÉRTICES
   ========================================================= */
function vertexIcon(first = false) {
    return L.divIcon({
        className: "",
        html: `<div class="vertex ${first ? "done" : ""}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
}
/* =========================================================
   ÁREA DO POLÍGONO
   ========================================================= */
function polygonArea(points) {
    if (points.length < 3) {
        return 0;
    }
    const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const R = 6378137;
    const cosLat = Math.cos(meanLat * Math.PI / 180);
    const xy = points.map(p => ({
        x: p.lng * Math.PI / 180 * R * cosLat,
        y: p.lat * Math.PI / 180 * R
    }));
    let area = 0;
    for (let i = 0; i < xy.length; i++) {
        const j = (i + 1) % xy.length;
        area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
    }
    return Math.abs(area) / 2;
}
/* =========================================================
   ESTATÍSTICAS
   ========================================================= */
function updateStats() {
    const vertexCount = $("vertexCount");
    if (vertexCount) {
        vertexCount.textContent = state.points.length;
    }
    const area = polygonArea(state.points);
    const areaValue = $("areaValue");
    if (areaValue) {
        areaValue.textContent = `${numberBR(area / 10000, 2)} ha`;
    }
}
/* =========================================================
   UNDO
   ========================================================= */
function saveUndo() {
    state.undoStack.push(
        state.points.map(p => ({ lat: p.lat, lng: p.lng }))
    );
    if (state.undoStack.length > 100) {
        state.undoStack.shift();
    }
}
function undo() {
    if (state.undoStack.length === 0) {
        toast("Nada para desfazer.");
        return;
    }
    state.points = state.undoStack.pop().map(p => L.latLng(p.lat, p.lng));
    renderMarkers();
    clearContours();
    status("Última alteração desfeita.");
}
/* =========================================================
   MARCADORES
   ========================================================= */
function removeMarkers() {
    state.markers.forEach(marker => {
        if (state.map.hasLayer(marker)) {
            state.map.removeLayer(marker);
        }
    });
    state.markers = [];
}
function renderMarkers() {
    removeMarkers();
    state.points.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: vertexIcon(index === 0)
        }).addTo(state.map);
        marker.on("drag", () => {
            state.points[index] = marker.getLatLng();
            drawPolygon();
            updateStats();
        });
        marker.on("dragend", () => {
            clearContours();
            status(`Vértice ${index + 1} reposicionado.`);
        });
        state.markers.push(marker);
    });
    drawPolygon();
    updateStats();
}
/* =========================================================
   DESENHAR POLÍGONO
   ========================================================= */
function drawPolygon() {
    if (state.polygon) {
        state.map.removeLayer(state.polygon);
        state.polygon = null;
    }
    if (state.points.length < 2) {
        return;
    }
    state.polygon = L.polygon(state.points, {
        color: "#176b45",
        weight: 2,
        dashArray: state.closed ? null : "7 5",
        fillColor: "#176b45",
        fillOpacity: 0.08
    }).addTo(state.map);
}
/* =========================================================
   NOVA ÁREA
   ========================================================= */
function newArea() {
    clearContours();
    removeMarkers();
    if (state.polygon) {
        state.map.removeLayer(state.polygon);
        state.polygon = null;
    }
    state.points = [];
    state.undoStack = [];
    state.drawing = true;
    state.closed = false;
    state.map.getContainer().classList.add("drawing-mode");
    updateStats();
    status("Área aberta. Toque no mapa para adicionar os vértices.");
    toast("Marque os pontos do terreno.");
}
/* =========================================================
   ADICIONAR PONTO
   ========================================================= */
function addPoint(event) {
    if (!state.drawing) {
        return;
    }
    saveUndo();
    state.points.push(L.latLng(event.latlng.lat, event.latlng.lng));
    renderMarkers();
    status(`${state.points.length} vértice${state.points.length === 1 ? "" : "s"} marcado${state.points.length === 1 ? "" : "s"}.`);
}
/* =========================================================
   FECHAR ÁREA
   ========================================================= */
function closeArea() {
    if (state.points.length < 3) {
        toast("É necessário marcar pelo menos 3 vértices.");
        return;
    }
    state.drawing = false;
    state.closed = true;
    state.map.getContainer().classList.remove("drawing-mode");
    drawPolygon();
    status("Área fechada. Confira o limite e gere as curvas.");
}
/* =========================================================
   LIMPAR CURVAS
   ========================================================= */
function clearContours() {
    state.contourLayers.forEach(layer => {
        if (state.map.hasLayer(layer)) {
            state.map.removeLayer(layer);
        }
    });
    state.contourLayers = [];
    state.contourData = [];
    state.dem = null;
    const minElevation = $("minElevation");
    if (minElevation) minElevation.textContent = "—";
    const maxElevation = $("maxElevation");
    if (maxElevation) maxElevation.textContent = "—";
    const demSource = $("demSource");
    if (demSource) demSource.textContent = "DEM: —";
    const elevationList = $("elevationList");
    if (elevationList) elevationList.innerHTML = "";
}
/* =========================================================
   LIMPAR TUDO
   ========================================================= */
function clearAll() {
    clearContours();
    removeMarkers();
    if (state.polygon) {
        state.map.removeLayer(state.polygon);
    }
    state.polygon = null;
    state.points = [];
    state.undoStack = [];
    state.drawing = false;
    state.closed = false;
    state.map.getContainer().classList.remove("drawing-mode");
    updateStats();
    status('Pronto. Toque em "Nova área" para começar.');
}
/* =========================================================
   BOUNDING BOX
   ========================================================= */
function getBBox() {
    const lats = state.points.map(p => p.lat);
    const lngs = state.points.map(p => p.lng);
    return {
        south: Math.min(...lats),
        north: Math.max(...lats),
        west: Math.min(...lngs),
        east: Math.max(...lngs)
    };
}
/* =========================================================
   DISTÂNCIA
   ========================================================= */
function distanceMeters(a, b) {
    const R = 6378137;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = dLng * Math.cos((lat1 + lat2) / 2);
    const y = dLat;
    return Math.sqrt(x * x + y * y) * R;
}
/* =========================================================
   TAMANHO DA ÁREA
   ========================================================= */
function bboxSize(bbox) {
    const height = distanceMeters(
        { lat: bbox.south, lng: bbox.west },
        { lat: bbox.north, lng: bbox.west }
    );
    const midLat = (bbox.south + bbox.north) / 2;
    const width = distanceMeters(
        { lat: midLat, lng: bbox.west },
        { lat: midLat, lng: bbox.east }
    );
    return { width, height };
}
/* =========================================================
   AMOSTRAGEM
   ========================================================= */
function getSamplingSpacing() {
    const element = $("resolution");
    if (!element) return CONFIG.defaultSpacing;
    const value = Number(element.value);
    return (Number.isFinite(value) && value > 0) ? value : CONFIG.defaultSpacing;
}
/* =========================================================
   INTERVALO DAS CURVAS
   ========================================================= */
function getContourInterval() {
    const element = $("interval");
    if (!element) return 2;
    const value = Number(element.value);
    return (Number.isFinite(value) && value > 0) ? value : 2;
}
/* =========================================================
   INTERVALO DAS CURVAS PRINCIPAIS
   ========================================================= */
function getMajorEvery() {
    const element = $("majorEvery");
    if (!element) return 5;
    const value = Number(element.value);
    return (Number.isFinite(value) && value > 0) ? value : 5;
}
/* =========================================================
   MODO DAS CURVAS
   ========================================================= */
function getCurveMode() {
    const element = $("curveMode");
    if (!element) return "all";
    return element.value === "major" ? "major" : "all";
}
/* =========================================================
   CRIAR GRADE DE AMOSTRAGEM
   ========================================================= */
function createSamplingGrid(bbox) {
    const size = bboxSize(bbox);
    const spacing = getSamplingSpacing();
    let columns = Math.ceil(size.width / spacing) + 1;
    let rows = Math.ceil(size.height / spacing) + 1;
    columns = Math.max(8, Math.min(columns, CONFIG.maxColumns));
    rows = Math.max(8, Math.min(rows, CONFIG.maxRows));
    const coordinates = [];
    for (let row = 0; row < rows; row++) {
        const fy = row / (rows - 1 || 1);
        const lat = bbox.north - (bbox.north - bbox.south) * fy;
        for (let col = 0; col < columns; col++) {
            const fx = col / (columns - 1 || 1);
            const lng = bbox.west + (bbox.east - bbox.west) * fx;
            coordinates.push({ lat, lng });
        }
    }
    return { rows, columns, coordinates };
}
/* =========================================================
   CONSULTAR ELEVAÇÕES (Com intervalo entre lotes)
   ========================================================= */
async function requestElevations(coordinates) {
    const elevations = [];
    for (let start = 0; start < coordinates.length; start += CONFIG.batchSize) {
        const batch = coordinates.slice(start, start + CONFIG.batchSize);
        const latStr = batch.map(p => p.lat.toFixed(6)).join(",");
        const lngStr = batch.map(p => p.lng.toFixed(6)).join(",");
        const url = `${CONFIG.elevationURL}?latitude=${latStr}&longitude=${lngStr}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Erro na API de elevação: HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!Array.isArray(data.elevation)) {
            throw new Error("A API não retornou dados de elevação válidos.");
        }
        elevations.push(...data.elevation);

        status(`Obtendo terreno: ${Math.min(start + batch.length, coordinates.length)} / ${coordinates.length} pontos`);
        
        // Intervalo curto para evitar bloqueio por taxa excessiva (HTTP 429)
        if (start + CONFIG.batchSize < coordinates.length) {
            await sleep(150);
        }
    }
    return elevations;
}
/* =========================================================
   CONSTRUIR DEM
   ========================================================= */
function buildDEM(grid, elevations) {
    if (elevations.length !== grid.coordinates.length) {
        throw new Error("Quantidade de elevações incompatível com a grade.");
    }
    const values = new Float64Array(elevations.length);
    for (let i = 0; i < elevations.length; i++) {
        const value = Number(elevations[i]);
        values[i] = Number.isFinite(value) ? value : 0;
    }
    return {
        rows: grid.rows,
        columns: grid.columns,
        coordinates: grid.coordinates,
        values
    };
}
/* =========================================================
   ESTATÍSTICAS DO DEM
   ========================================================= */
function updateDEMStats(dem) {
    if (!dem || !dem.values || dem.values.length === 0) return;
    let min = Infinity;
    let max = -Infinity;
    for (const value of dem.values) {
        if (value < min) min = value;
        if (value > max) max = value;
    }
    const minElement = $("minElevation");
    if (minElement) minElement.textContent = `${numberBR(min, 1)} m`;
    const maxElement = $("maxElevation");
    if (maxElement) maxElement.textContent = `${numberBR(max, 1)} m`;
    const sourceElement = $("demSource");
    if (sourceElement) sourceElement.textContent = "DEM: Open-Meteo / Copernicus";
}
/* =========================================================
   GERAR CURVAS D3
   ========================================================= */
function generateD3Contours(dem) {
    if (typeof d3 === "undefined" || typeof d3.contours !== "function") {
        throw new Error("Biblioteca d3-contour não foi carregada.");
    }
    const interval = getContourInterval();
    const majorEvery = getMajorEvery();
    const curveMode = getCurveMode();
    const values = Array.from(dem.values);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        return 0;
    }
    const first = Math.ceil(min / interval) * interval;
    const thresholds = [];
    for (let value = first; value <= max; value += interval) {
        thresholds.push(Number(value.toFixed(6)));
        if (thresholds.length > 2000) break;
    }
    if (thresholds.length === 0) return 0;

    const contours = d3.contours()
        .size([dem.columns, dem.rows])
        .thresholds(thresholds)(values);

    let segmentCount = 0;
    contours.forEach(contour => {
        const elevation = Number(contour.value);
        const major = majorEvery > 0 && Math.abs(elevation / majorEvery - Math.round(elevation / majorEvery)) < 1e-6;

        if (curveMode === "major" && !major) return;
        if (!contour.coordinates) return;

        contour.coordinates.forEach(polygon => {
            if (!Array.isArray(polygon) || polygon.length < 2) return;

            const coordinates = polygon.map(point => {
                const x = point[0];
                const y = point[1];
                const colFactor = x / (dem.columns - 1 || 1);
                const rowFactor = y / (dem.rows - 1 || 1);
                const bbox = getBBox();
                const lat = bbox.north - (bbox.north - bbox.south) * rowFactor;
                const lng = bbox.west + (bbox.east - bbox.west) * colFactor;
                return { lat, lng };
            });

            if (coordinates.length < 2) return;
            if (segmentCount >= CONFIG.maxContourSegments) return;

            const latLngs = coordinates.map(p => [p.lat, p.lng]);
            const layer = L.polyline(latLngs, {
                color: major ? "#111111" : "#555555",
                weight: major ? 2.5 : 1,
                opacity: 0.9
            }).addTo(state.map);

            layer.bindTooltip(`${numberBR(elevation, 1)} m`, { sticky: true });
            state.contourLayers.push(layer);
            state.contourData.push({ elevation, major, coordinates });
            segmentCount++;
        });
    });
    updateElevationList();
    return segmentCount;
}
/* =========================================================
   LISTA DE ELEVAÇÕES
   ========================================================= */
function updateElevationList() {
    const list = $("elevationList");
    if (!list) return;
    if (state.contourData.length === 0) {
        list.innerHTML = "";
        return;
    }
    const elevations = [...new Set(state.contourData.map(item => Number(item.elevation.toFixed(2))))].sort((a, b) => a - b);
    list.innerHTML = elevations.map(elevation => `<div class="elevation-item">${numberBR(elevation, 2)} m</div>`).join("");
}
/* =========================================================
   VALIDAR ÁREA
   ========================================================= */
function validateArea() {
    if (state.points.length < 3) {
        toast("Marque pelo menos 3 vértices.");
        return false;
    }
    if (state.drawing) {
        closeArea();
    }
    if (!state.closed) {
        toast("Feche a área antes de gerar as curvas.");
        return false;
    }
    return true;
}
/* =========================================================
   GERAR DEM
   ========================================================= */
async function createDEMForArea() {
    const bbox = getBBox();
    const grid = createSamplingGrid(bbox);
    const total = grid.coordinates.length;
    status(`Preparando ${total.toLocaleString("pt-BR")} pontos de elevação...`);
    loading(true, "Obtendo modelo do terreno...", `Consultando ${total.toLocaleString("pt-BR")} pontos de elevação.`);

    const elevations = await requestElevations(grid.coordinates);
    const dem = buildDEM(grid, elevations);
    state.dem = dem;
    updateDEMStats(dem);
    return dem;
}
/* =========================================================
   GERAR CURVAS
   ========================================================= */
async function generateContours() {
    if (state.processing) return;
    if (!validateArea()) return;

    state.processing = true;
    clearContours();
    try {
        loading(true, "Obtendo modelo do terreno...", "Isso pode levar alguns segundos.");
        const dem = await createDEMForArea();

        loading(true, "Calculando curvas...", "Extraindo as curvas de nível.");
        await sleep(100);

        const count = generateD3Contours(dem);
        if (count === 0) {
            throw new Error("Nenhuma curva foi encontrada na área.");
        }

        status(`${count.toLocaleString("pt-BR")} segmentos de curvas gerados.`);
        toast("Curvas de nível geradas.");
    } catch (error) {
        console.error(error);
        // Exibe o erro exato na barra de status e no toast
        status("Erro: " + (error.message || error));
        toast(error.message || "Erro ao processar o terreno.");
    } finally {
        loading(false);
        state.processing = false;
    }
}
/* =========================================================
   DOWNLOAD E EXPORTAÇÕES (KML, DXF, CSV)
   ========================================================= */
function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeXML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function exportKML() {
    if (state.points.length < 3 || state.contourData.length === 0) {
        toast("Gere as curvas antes de exportar.");
        return;
    }
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>MVA Geo - Contour Map</name>\n`;
    state.contourData.forEach(contour => {
        const coords = contour.coordinates.map(p => `${p.lng},${p.lat},${contour.elevation}`).join(" ");
        kml += `<Placemark><name>Curva ${escapeXML(contour.elevation.toFixed(2))} m</name><LineString><coordinates>${escapeXML(coords)}</coordinates></LineString></Placemark>\n`;
    });
    kml += `</Document>\n</kml>`;
    downloadBlob(kml, `MVA_Geo_Contour_${fileDate()}.kml`, "application/vnd.google-earth.kml+xml");
    toast("KML exportado.");
}

function exportCSV() {
    if (state.points.length === 0) {
        toast("Nenhum ponto marcado.");
        return;
    }
    let csv = "PONTO;LATITUDE;LONGITUDE\n";
    state.points.forEach((point, index) => {
        csv += `${index + 1};${point.lat.toFixed(8)};${point.lng.toFixed(8)}\n`;
    });
    downloadBlob("\uFEFF" + csv, `MVA_Geo_Vertices_${fileDate()}.csv`, "text/csv;charset=utf-8");
    toast("CSV exportado.");
}
/* =========================================================
   GEOLOCALIZAÇÃO
   ========================================================= */
function locateUser() {
    if (!navigator.geolocation) {
        toast("Geolocalização não suportada.");
        return;
    }
    status("Obtendo sua localização...");
    navigator.geolocation.getCurrentPosition(
        position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const point = L.latLng(lat, lng);
            if (state.locationMarker) {
                state.locationMarker.setLatLng(point);
            } else {
                state.locationMarker = L.marker(point).addTo(state.map).bindPopup("Minha posição");
            }
            state.map.setView(point, 18);
            state.locationMarker.openPopup();
            status(`Localização: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        },
        error => {
            console.error(error);
            toast("Não foi possível obter localização.");
            status("Erro de geolocalização.");
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}
/* =========================================================
   EVENT LISTENERS (BIND)
   ========================================================= */
function bind(id, event, handler) {
    const element = $(id);
    if (element) element.addEventListener(event, handler);
}

bind("newArea", "click", newArea);
bind("undoBtn", "click", undo);
bind("closeBtn", "click", closeArea);
bind("clearBtn", "click", clearAll);
bind("generateBtn", "click", generateContours);
bind("locateBtn", "click", locateUser);
bind("exportKmlBtn", "click", exportKML);
bind("exportCsvBtn", "click", exportCSV);

bind("settingsBtn", "click", () => {
    const settings = $("settingsPanel");
    if (settings) settings.classList.toggle("hidden");
});

state.map.on("click", addPoint);

updateStats();
status('Pronto. Toque em "Nova área" para começar.');
console.log("MVA Geo — app.js atualizado.");
