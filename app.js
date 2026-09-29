/* =========================================================
   MVA GEO - CONTOUR MAP
   APP.JS — VERSÃO LIMPA
   ========================================================= */

"use strict";

/* =========================================================
   AUXILIARES
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

    elevationURL:
        "https://api.open-meteo.com/v1/elevation",

    batchSize: 100,

    maxRows: 80,

    maxColumns: 80,

    defaultSpacing: 60,

    maxContourSegments: 10000
};


/* =========================================================
   VERIFICAR LEAFLET
   ========================================================= */

if (typeof L === "undefined") {

    console.error(
        "Leaflet não foi carregado."
    );

    const message =
        document.createElement("div");

    message.style.cssText =
        "position:fixed;" +
        "top:20px;" +
        "left:20px;" +
        "right:20px;" +
        "z-index:99999;" +
        "padding:16px;" +
        "background:#b91c1c;" +
        "color:white;" +
        "border-radius:10px;" +
        "font-family:Arial,sans-serif;" +
        "font-size:15px;";

    message.textContent =
        "Erro: o mapa não conseguiu carregar. Recarregue a página.";

    document.body.appendChild(message);

    throw new Error(
        "Leaflet não disponível."
    );
}


/* =========================================================
   STATUS
   ========================================================= */

function status(text) {

    const el = $("status");

    if (el) {
        el.textContent = text;
    }

}


/* =========================================================
   TOAST
   ========================================================= */

function toast(text) {

    const el = $("toast");

    if (!el) {

        console.log(text);

        return;
    }

    el.textContent = text;

    el.classList.add("show");

    clearTimeout(
        toast.timer
    );

    toast.timer =
        setTimeout(
            () => {
                el.classList.remove("show");
            },
            3000
        );

}


/* =========================================================
   LOADING
   ========================================================= */

function loading(
    visible,
    title = "Processando...",
    message = "Aguarde."
) {

    const box = $("loading");

    if (!box) {
        return;
    }

    if (visible) {

        box.classList.remove(
            "hidden"
        );

        const titleEl =
            $("loadingTitle");

        const textEl =
            $("loadingText");

        if (titleEl) {
            titleEl.textContent =
                title;
        }

        if (textEl) {
            textEl.textContent =
                message;
        }

    } else {

        box.classList.add(
            "hidden"
        );

    }

}


/* =========================================================
   FORMATAÇÃO
   ========================================================= */

function numberBR(
    value,
    decimals = 2
) {

    return Number(value)
        .toLocaleString(
            "pt-BR",
            {
                minimumFractionDigits:
                    decimals,

                maximumFractionDigits:
                    decimals
            }
        );

}


/* =========================================================
   DATA PARA ARQUIVOS
   ========================================================= */

function fileDate() {

    const d = new Date();

    const y =
        d.getFullYear();

    const m =
        String(
            d.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            d.getDate()
        ).padStart(2, "0");

    const h =
        String(
            d.getHours()
        ).padStart(2, "0");

    const min =
        String(
            d.getMinutes()
        ).padStart(2, "0");

    return (
        y +
        m +
        day +
        "_" +
        h +
        min
    );

}


/* =========================================================
   MAPA
   ========================================================= */

state.map =
    L.map(
        "map",
        {
            zoomControl: true,
            preferCanvas: true
        }
    ).setView(
        CONFIG.center,
        CONFIG.zoom
    );


/* =========================================================
   CAMADAS
   ========================================================= */

state.satellite =
    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            maxZoom: 19,
            attribution:
                "© Esri"
        }
    );

state.streets =
    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "© OpenStreetMap contributors"
        }
    );


/* SATÉLITE PADRÃO */

state.satellite.addTo(
    state.map
);


/* CONTROLE DE CAMADAS */

L.control.layers(
    {
        "Satélite":
            state.satellite,

        "Mapa":
            state.streets
    },
    null,
    {
        collapsed: true
    }
).addTo(
    state.map
);


/* =========================================================
   ÍCONE DOS VÉRTICES
   ========================================================= */

function vertexIcon(
    first = false
) {

    return L.divIcon({

        className: "",

        html:
            `<div class="vertex ${
                first ? "done" : ""
            }"></div>`,

        iconSize: [
            18,
            18
        ],

        iconAnchor: [
            9,
            9
        ]

    });

}


/* =========================================================
   ÁREA DO POLÍGONO
   ========================================================= */

function polygonArea(
    points
) {

    if (
        points.length < 3
    ) {
        return 0;
    }

    const meanLat =
        points.reduce(
            (sum, p) =>
                sum + p.lat,
            0
        ) /
        points.length;

    const R =
        6378137;

    const cosLat =
        Math.cos(
            meanLat *
            Math.PI /
            180
        );

    const xy =
        points.map(
            p => ({

                x:
                    p.lng *
                    Math.PI /
                    180 *
                    R *
                    cosLat,

                y:
                    p.lat *
                    Math.PI /
                    180 *
                    R

            })
        );

    let area = 0;

    for (
        let i = 0;
        i < xy.length;
        i++
    ) {

        const j =
            (
                i + 1
            ) %
            xy.length;

        area +=
            xy[i].x *
            xy[j].y -
            xy[j].x *
            xy[i].y;

    }

    return Math.abs(
        area
    ) / 2;

}


/* =========================================================
   ESTATÍSTICAS
   ========================================================= */

function updateStats() {

    const vertexCount =
        $("vertexCount");

    if (vertexCount) {

        vertexCount.textContent =
            state.points.length;

    }

    const area =
        polygonArea(
            state.points
        );

    const areaValue =
        $("areaValue");

    if (areaValue) {

        areaValue.textContent =
            `${numberBR(
                area / 10000,
                2
            )} ha`;

    }

}


/* =========================================================
   UNDO
   ========================================================= */

function saveUndo() {

    state.undoStack.push(
        state.points.map(
            p => ({
                lat: p.lat,
                lng: p.lng
            })
        )
    );

    if (
        state.undoStack.length >
        100
    ) {

        state.undoStack.shift();

    }

}


function undo() {

    if (
        state.undoStack.length ===
        0
    ) {

        toast(
            "Nada para desfazer."
        );

        return;
    }

    state.points =
        state.undoStack
            .pop()
            .map(
                p =>
                    L.latLng(
                        p.lat,
                        p.lng
                    )
            );

    renderMarkers();

    status(
        "Última alteração desfeita."
    );

}


/* =========================================================
   REMOVER MARCADORES
   ========================================================= */

function removeMarkers() {

    state.markers.forEach(
        marker => {

            if (
                state.map.hasLayer(
                    marker
                )
            ) {

                state.map.removeLayer(
                    marker
                );

            }

        }
    );

    state.markers = [];

}


/* =========================================================
   DESENHAR MARCADORES
   ========================================================= */

function renderMarkers() {

    removeMarkers();

    state.points.forEach(
        (
            point,
            index
        ) => {

            const marker =
                L.marker(
                    point,
                    {
                        draggable: true,

                        icon:
                            vertexIcon(
                                index === 0
                            )
                    }
                ).addTo(
                    state.map
                );

            marker.on(
                "drag",
                () => {

                    state.points[index] =
                        marker.getLatLng();

                    drawPolygon();

                    updateStats();

                }
            );

            marker.on(
                "dragend",
                () => {

                    status(
                        `Vértice ${
                            index + 1
                        } reposicionado.`
                    );

                    clearContours();

                }
            );

            state.markers.push(
                marker
            );

        }
    );

    drawPolygon();

    updateStats();

}


/* =========================================================
   DESENHAR POLÍGONO
   ========================================================= */

function drawPolygon() {

    if (
        state.polygon
    ) {

        state.map.removeLayer(
            state.polygon
        );

        state.polygon = null;

    }

    if (
        state.points.length <
        2
    ) {
        return;
    }

    state.polygon =
        L.polygon(
            state.points,
            {

                color:
                    "#176b45",

                weight:
                    2,

                dashArray:
                    state.closed
                        ? null
                        : "7 5",

                fillColor:
                    "#176b45",

                fillOpacity:
                    0.08

            }
        ).addTo(
            state.map
        );

}


/* =========================================================
   NOVA ÁREA
   ========================================================= */

function newArea() {

    clearContours();

    removeMarkers();

    if (
        state.polygon
    ) {

        state.map.removeLayer(
            state.polygon
        );

        state.polygon = null;

    }

    state.points = [];

    state.undoStack = [];

    state.drawing = true;

    state.closed = false;

    state.map
        .getContainer()
        .classList.add(
            "drawing-mode"
        );

    updateStats();

    status(
        "Área aberta. Toque no mapa para adicionar os vértices."
    );

    toast(
        "Marque os pontos do terreno."
    );

}


/* =========================================================
   ADICIONAR PONTO
   ========================================================= */

function addPoint(
    event
) {

    if (
        !state.drawing
    ) {
        return;
    }

    saveUndo();

    state.points.push(
        L.latLng(
            event.latlng.lat,
            event.latlng.lng
        )
    );

    renderMarkers();

    status(
        `${state.points.length} vértice${
            state.points.length === 1
                ? ""
                : "s"
        } marcado${
            state.points.length === 1
                ? ""
                : "s"
        }.`
    );

}


/* =========================================================
   FECHAR ÁREA
   ========================================================= */

function closeArea() {

    if (
        state.points.length < 3
    ) {

        toast(
            "É necessário marcar pelo menos 3 vértices."
        );

        return;
    }

    state.drawing = false;

    state.closed = true;

    state.map
        .getContainer()
        .classList.remove(
            "drawing-mode"
        );

    drawPolygon();

    status(
        "Área fechada. Confira o limite e gere as curvas."
    );

}


/* =========================================================
   LIMPAR CURVAS
   ========================================================= */

function clearContours() {

    state.contourLayers.forEach(
        layer => {

            if (
                state.map.hasLayer(
                    layer
                )
            ) {

                state.map.removeLayer(
                    layer
                );

            }

        }
    );

    state.contourLayers = [];

    state.contourData = [];

    state.dem = null;

    if ($("minZ")) {
        $("minZ").textContent =
            "—";
    }

    if ($("maxZ")) {
        $("maxZ").textContent =
            "—";
    }

    if ($("sourceInfo")) {

        $("sourceInfo").textContent =
            "DEM: —";

    }

}


/* =========================================================
   LIMPAR TUDO
   ========================================================= */

function clearAll() {

    clearContours();

    removeMarkers();

    if (
        state.polygon
    ) {

        state.map.removeLayer(
            state.polygon
        );

    }

    state.polygon = null;

    state.points = [];

    state.undoStack = [];

    state.drawing = false;

    state.closed = false;

    state.map
        .getContainer()
        .classList.remove(
            "drawing-mode"
        );

    updateStats();

    status(
        'Pronto. Toque em "Nova área" para começar.'
    );

}


/* =========================================================
   BOUNDING BOX
   ========================================================= */

function getBBox() {

    const lats =
        state.points.map(
            p => p.lat
        );

    const lngs =
        state.points.map(
            p => p.lng
        );

    return {

        south:
            Math.min(
                ...lats
            ),

        north:
            Math.max(
                ...lats
            ),

        west:
            Math.min(
                ...lngs
            ),

        east:
            Math.max(
                ...lngs
            )

    };

}


/* =========================================================
   DISTÂNCIA
   ========================================================= */

function distanceMeters(
    a,
    b
) {

    const R =
        6378137;

    const lat1 =
        a.lat *
        Math.PI /
        180;

    const lat2 =
        b.lat *
        Math.PI /
        180;

    const dLat =
        (
            b.lat -
            a.lat
        ) *
        Math.PI /
        180;

    const dLng =
        (
            b.lng -
            a.lng
        ) *
        Math.PI /
        180;

    const x =
        dLng *
        Math.cos(
            (
                lat1 +
                lat2
            ) / 2
        );

    const y =
        dLat;

    return (
        Math.sqrt(
            x * x +
            y * y
        ) *
        R
    );

}


/* =========================================================
   TAMANHO DA ÁREA
   ========================================================= */

function bboxSize(
    bbox
) {

    const height =
        distanceMeters(
            {
                lat:
                    bbox.south,
                lng:
                    bbox.west
            },
            {
                lat:
                    bbox.north,
                lng:
                    bbox.west
            }
        );

    const midLat =
        (
            bbox.south +
            bbox.north
        ) / 2;

    const width =
        distanceMeters(
            {
                lat:
                    midLat,
                lng:
                    bbox.west
            },
            {
                lat:
                    midLat,
                lng:
                    bbox.east
            }
        );

    return {
        width,
        height
    };

}


/* =========================================================
   AMOSTRAGEM
   ========================================================= */

function getSamplingSpacing() {

    const possibleIds = [
        "sampling",
        "sampleSpacing",
        "amostragem",
        "spacing"
    ];

    for (
        const id of possibleIds
    ) {

        const el = $(id);

        if (el) {

            const value =
                Number(
                    el.value
                );

            if (
                Number.isFinite(
                    value
                ) &&
                value > 0
            ) {

                return value;

            }

        }

    }

    return CONFIG.defaultSpacing;

}


/* =========================================================
   CRIAR GRADE
   ========================================================= */

function createSamplingGrid(
    bbox
) {

    const size =
        bboxSize(
            bbox
        );

    const spacing =
        getSamplingSpacing();

    let columns =
        Math.ceil(
            size.width /
            spacing
        ) + 1;

    let rows =
        Math.ceil(
            size.height /
            spacing
        ) + 1;

    columns =
        Math.max(
            8,
            Math.min(
                columns,
                CONFIG.maxColumns
            )
        );

    rows =
        Math.max(
            8,
            Math.min(
                rows,
                CONFIG.maxRows
            )
        );

    const coordinates = [];

    for (
        let row = 0;
        row < rows;
        row++
    ) {

        const fy =
            row /
            (
                rows - 1
            );

        const lat =
            bbox.north -
            (
                bbox.north -
                bbox.south
            ) *
            fy;

        for (
            let col = 0;
            col < columns;
            col++
        ) {

            const fx =
                col /
                (
                    columns - 1
                );

            const lng =
                bbox.west +
                (
                    bbox.east -
                    bbox.west
                ) *
                fx;

            coordinates.push(
                {
                    lat,
                    lng
                }
            );

        }

    }

    return {

        width:
            columns,

        height:
            rows,

        coordinates,

        west:
            bbox.west,

        east:
            bbox.east,

        south:
            bbox.south,

        north:
            bbox.north

    };

}


/* =========================================================
   CONSULTAR ELEVAÇÕES
   ========================================================= */

async function requestElevations(
    coordinates
) {

    const result = [];

    for (
        let start = 0;
        start <
        coordinates.length;
        start +=
            CONFIG.batchSize
    ) {

        const batch =
            coordinates.slice(
                start,
                start +
                CONFIG.batchSize
            );

        const latitude =
            batch
                .map(
                    p =>
                        p.lat.toFixed(
                            6
                        )
                )
                .join(",");

        const longitude =
            batch
                .map(
                    p =>
                        p.lng.toFixed(
                            6
                        )
                )
                .join(",");

        const apiInput =
            $("apiBase");

        let baseURL =
            CONFIG.elevationURL;

        if (
            apiInput &&
            apiInput.value.trim()
        ) {

            baseURL =
                apiInput.value
                    .trim()
                    .replace(
                        /\/+$/,
                        ""
                    );

        }

        const separator =
            baseURL.includes("?")
                ? "&"
                : "?";

        const url =
            `${baseURL}${separator}` +
            `latitude=${encodeURIComponent(latitude)}` +
            `&longitude=${encodeURIComponent(longitude)}`;

        const response =
            await fetch(
                url,
                {
                    method:
                        "GET",

                    cache:
                        "no-store"
                }
            );

        if (
            !response.ok
        ) {

            throw new Error(
                `Erro no serviço de elevação: HTTP ${response.status}`
            );

        }

        const data =
            await response.json();

        let elevations = null;

        if (
            Array.isArray(
                data.elevation
            )
        ) {

            elevations =
                data.elevation;

        } else if (
            Array.isArray(
                data.elevations
            )
        ) {

            elevations =
                data.elevations;

        }

        if (
            !elevations
        ) {

            throw new Error(
                "O serviço de elevação não retornou os dados esperados."
            );

        }

        result.push(
            ...elevations
        );

        status(
            `Obtendo elevações: ${
                Math.min(
                    start +
                    batch.length,
                    coordinates.length
                )
            } / ${
                coordinates.length
            }`
        );

        if (
            start +
            CONFIG.batchSize <
            coordinates.length
        ) {

            await sleep(
                80
            );

        }

    }

    if (
        result.length !==
        coordinates.length
    ) {

        throw new Error(
            "A quantidade de elevações retornada não corresponde à grade."
        );

    }

    return result;

}


/* =========================================================
   SLEEP
   ========================================================= */

function sleep(
    ms
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}


/* =========================================================
   CRIAR DEM
   ========================================================= */

function buildDEM(
    grid,
    elevations
) {

    const values =
        new Float64Array(
            elevations.length
        );

    let min =
        Infinity;

    let max =
        -Infinity;

    for (
        let i = 0;
        i <
        elevations.length;
        i++
    ) {

        const value =
            Number(
                elevations[i]
            );

        values[i] =
            value;

        if (
            Number.isFinite(
                value
            )
        ) {

            min =
                Math.min(
                    min,
                    value
                );

            max =
                Math.max(
                    max,
                    value
                );

        }

    }

    if (
        !Number.isFinite(
            min
        ) ||
        !Number.isFinite(
            max
        )
    ) {

        throw new Error(
            "Não foi possível determinar as altitudes."
        );

    }

    return {

        width:
            grid.width,

        height:
            grid.height,

        values,

        west:
            grid.west,

        east:
            grid.east,

        south:
            grid.south,

        north:
            grid.north,

        min,

        max

    };

}


/* =========================================================
   GEO -> GRADE
   ========================================================= */

function geoToGrid(
    lat,
    lng,
    dem
) {

    const dx =
        dem.east -
        dem.west;

    const dy =
        dem.north -
        dem.south;

    const x =
        dx === 0
            ? 0
            : (
                (
                    lng -
                    dem.west
                ) /
                dx
            ) *
            (
                dem.width -
                1
            );

    const y =
        dy === 0
            ? 0
            : (
                (
                    dem.north -
                    lat
                ) /
                dy
            ) *
            (
                dem.height -
                1
            );

    return {
        x,
        y
    };

}


/* =========================================================
   GRADE -> GEO
   ========================================================= */

function gridToGeo(
    x,
    y,
    dem
) {

    const lng =
        dem.west +
        (
            x /
            (
                dem.width -
                1
            )
        ) *
        (
            dem.east -
            dem.west
        );

    const lat =
        dem.north -
        (
            y /
            (
                dem.height -
                1
            )
        ) *
        (
            dem.north -
            dem.south
        );

    return {
        lat,
        lng
    };

}


/* =========================================================
   PONTO DENTRO DO POLÍGONO
   ========================================================= */

function pointInPolygon(
    point,
    polygon
) {

    let inside =
        false;

    for (
        let i = 0,
        j = polygon.length - 1;

        i < polygon.length;

        j = i++
    ) {

        const xi =
            polygon[i].x;

        const yi =
            polygon[i].y;

        const xj =
            polygon[j].x;

        const yj =
            polygon[j].y;

        const intersects =
            (
                (yi > point.y) !==
                (yj > point.y)
            ) &&
            (
                point.x <
                (
                    (
                        xj -
                        xi
                    ) *
                    (
                        point.y -
                        yi
                    )
                ) /
                (
                    yj -
                    yi
                ) +
                xi
            );

        if (
            intersects
        ) {

            inside =
                !inside;

        }

    }

    return inside;

}


/* =========================================================
   POLÍGONO EM GRADE
   ========================================================= */

function polygonToGrid(
    dem
) {

    return state.points.map(
        point =>
            geoToGrid(
                point.lat,
                point.lng,
                dem
            )
    );

}


/* =========================================================
   INTERVALO DAS CURVAS
   ========================================================= */

function getContourInterval() {

    const ids = [
        "interval",
        "contourInterval",
        "equidistance"
    ];

    for (
        const id of ids
    ) {

        const el = $(id);

        if (el) {

            const value =
                Number(
                    el.value
                );

            if (
                Number.isFinite(
                    value
                ) &&
                value > 0
            ) {

                return value;

            }

        }

    }

    return 1;

}


/* =========================================================
   CURVAS PRINCIPAIS
   ========================================================= */

function getMajorEvery() {

    const el =
        $("majorEvery");

    if (!el) {
        return 5;
    }

    const value =
        Number(
            el.value
        );

    return Number.isFinite(
        value
    )
        ? value
        : 5;

}


/* =========================================================
   RECORTE DE SEGMENTOS
   ========================================================= */

function clipSegmentToPolygon(
    a,
    b,
    polygon
) {

    const result = [];

    const STEPS = 30;

    let previous =
        a;

    let previousInside =
        pointInPolygon(
            previous,
            polygon
        );

    for (
        let i = 1;
        i <= STEPS;
        i++
    ) {

        const t =
            i / STEPS;

        const current = {

            x:
                a.x +
                (
                    b.x -
                    a.x
                ) *
                t,

            y:
                a.y +
                (
                    b.y -
                    a.y
                ) *
                t

        };

        const currentInside =
            pointInPolygon(
                current,
                polygon
            );

        if (
            previousInside &&
            currentInside
        ) {

            result.push(
                {
                    a:
                        previous,
                    b:
                        current
                }
            );

        } else if (
            previousInside !==
            currentInside
        ) {

            const boundary =
                binaryBoundary(
                    previous,
                    current,
                    polygon
                );

            if (
                previousInside
            ) {

                result.push(
                    {
                        a:
                            previous,
                        b:
                            boundary
                    }
                );

            } else {

                result.push(
                    {
                        a:
                            boundary,
                        b:
                            current
                    }
                );

            }

        }

        previous =
            current;

        previousInside =
            currentInside;

    }

    return result;

}


/* =========================================================
   INTERSECÇÃO POR BUSCA BINÁRIA
   ========================================================= */

function binaryBoundary(
    a,
    b,
    polygon
) {

    let left =
        0;

    let right =
        1;

    const insideA =
        pointInPolygon(
            a,
            polygon
        );

    for (
        let i = 0;
        i < 18;
        i++
    ) {

        const middle =
            (
                left +
                right
            ) / 2;

        const p = {

            x:
                a.x +
                (
                    b.x -
                    a.x
                ) *
                middle,

            y:
                a.y +
                (
                    b.y -
                    a.y
                ) *
                middle

        };

        const inside =
            pointInPolygon(
                p,
                polygon
            );

        if (
            inside ===
            insideA
        ) {

            left =
                middle;

        } else {

            right =
                middle;

        }

    }

    const t =
        (
            left +
            right
        ) / 2;

    return {

        x:
            a.x +
            (
                b.x -
                a.x
            ) *
            t,

        y:
            a.y +
            (
                b.y -
                a.y
            ) *
            t

    };

}


/* =========================================================
   DESENHAR SEGMENTO
   ========================================================= */

function drawContourSegment(
    segment,
    elevation,
    index
) {

    const line =
        L.polyline(
            [
                [
                    segment.a.lat,
                    segment.a.lng
                ],
                [
                    segment.b.lat,
                    segment.b.lng
                ]
            ],
            {

                color:
                    "#333333",

                weight:
                    index % 5 === 0
                        ? 2.5
                        : 1.2,

                opacity:
                    0.9,

                interactive:
                    false

            }
        ).addTo(
            state.map
        );

    state.contourLayers.push(
        line
    );

}


/* =========================================================
   GERAR CURVAS COM D3
   ========================================================= */

function generateD3Contours(
    dem
) {

    if (
        typeof d3 ===
        "undefined"
    ) {

        throw new Error(
            "A biblioteca D3 não foi carregada."
        );

    }

    const interval =
        getContourInterval();

    const min =
        dem.min;

    const max =
        dem.max;

    if (
        max <= min
    ) {

        return 0;

    }

    const start =
        Math.ceil(
            min /
            interval
        ) *
        interval;

    const thresholds = [];

    for (
        let z = start;
        z <= max;
        z += interval
    ) {

        thresholds.push(
            Number(
                z.toFixed(6)
            )
        );

        if (
            thresholds.length >
            500
        ) {

            break;

        }

    }

    const generator =
        d3.contours()
            .size(
                [
                    dem.width,
                    dem.height
                ]
            )
            .thresholds(
                thresholds
            );

    const contours =
        generator(
            Array.from(
                dem.values
            )
        );

    const polygon =
        polygonToGrid(
            dem
        );

    let count =
        0;

    const majorEvery =
        getMajorEvery();

    contours.forEach(
        (
            contour,
            contourIndex
        ) => {

            const elevation =
                Number(
                    contour.value
                );

            const major =
                majorEvery > 0 &&
                contourIndex %
                majorEvery ===
                0;

            contour.coordinates.forEach(
                polygonGroup => {

                    polygonGroup.forEach(
                        ring => {

                            if (
                                !ring ||
                                ring.length <
                                2
                            ) {

                                return;

                            }

                            for (
                                let i = 0;
                                i <
                                ring.length - 1;
                                i++
                            ) {

                                if (
                                    count >=
                                    CONFIG.maxContourSegments
                                ) {

                                    return;

                                }

                                const a = {

                                    x:
                                        ring[i][0],

                                    y:
                                        ring[i][1]

                                };

                                const b = {

                                    x:
                                        ring[i + 1][0],

                                    y:
                                        ring[i + 1][1]

                                };

                                const clipped =
                                    clipSegmentToPolygon(
                                        a,
                                        b,
                                        polygon
                                    );

                                clipped.forEach(
                                    part => {

                                        if (
                                            count >=
                                            CONFIG.maxContourSegments
                                        ) {
                                            return;
                                        }

                                        const p1 =
                                            gridToGeo(
                                                part.a.x,
                                                part.a.y,
                                                dem
                                            );

                                        const p2 =
                                            gridToGeo(
                                                part.b.x,
                                                part.b.y,
                                                dem
                                            );

                                        const line =
                                            L.polyline(
                                                [
                                                    [
                                                        p1.lat,
                                                        p1.lng
                                                    ],
                                                    [
                                                        p2.lat,
                                                        p2.lng
                                                    ]
                                                ],
                                                {

                                                    color:
                                                        "#333333",

                                                    weight:
                                                        major
                                                            ? 2.6
                                                            : 1.1,

                                                    opacity:
                                                        0.9,

                                                    interactive:
                                                        false

                                                }
                                            ).addTo(
                                                state.map
                                            );

                                        state.contourLayers.push(
                                            line
                                        );

                                        state.contourData.push(
                                            {

                                                elevation,

                                                major,

                                                coordinates:
                                                    [
                                                        p1,
                                                        p2
                                                    ]

                                            }
                                        );

                                        count++;

                                    }
                                );

                            }

                        }
                    );

                }
            );

        }
    );

    return count;

}


/* =========================================================
   ESTATÍSTICAS DO DEM
   ========================================================= */

function updateDEMStats(
    dem
) {

    if ($("minZ")) {

        $("minZ").textContent =
            `${numberBR(
                dem.min,
                2
            )} m`;

    }

    if ($("maxZ")) {

        $("maxZ").textContent =
            `${numberBR(
                dem.max,
                2
            )} m`;

    }

    if ($("sourceInfo")) {

        $("sourceInfo").textContent =
            "DEM: Copernicus GLO-90 / Open-Meteo";

    }

}


/* =========================================================
   VALIDAR ÁREA
   ========================================================= */

function validateArea() {

    if (
        state.points.length <
        3
    ) {

        toast(
            "Marque pelo menos 3 vértices."
        );

        return false;

    }

    if (
        state.drawing
    ) {

        closeArea();

    }

    if (
        !state.closed
    ) {

        toast(
            "Feche a área antes de gerar as curvas."
        );

        return false;

    }

    return true;

}


/* =========================================================
   GERAR DEM
   ========================================================= */

async function createDEMForArea() {

    const bbox =
        getBBox();

    const grid =
        createSamplingGrid(
            bbox
        );

    const total =
        grid.coordinates.length;

    status(
        `Preparando ${total.toLocaleString(
            "pt-BR"
        )} pontos de elevação...`
    );

    loading(
        true,
        "Obtendo terreno...",
        `Consultando ${total.toLocaleString(
            "pt-BR"
        )} pontos de elevação.`
    );

    const elevations =
        await requestElevations(
            grid.coordinates
        );

    const dem =
        buildDEM(
            grid,
            elevations
        );

    state.dem =
        dem;

    updateDEMStats(
        dem
    );

    return dem;

}


/* =========================================================
   GERAR CURVAS
   ========================================================= */

async function generateContours() {

    if (
        state.processing
    ) {
        return;
    }

    if (
        !validateArea()
    ) {
        return;
    }

    state.processing =
        true;

    clearContours();

    try {

        loading(
            true,
            "Obtendo modelo do terreno...",
            "Isso pode levar alguns segundos."
        );

        const dem =
            await createDEMForArea();

        loading(
            true,
            "Calculando curvas...",
            "Extraindo as curvas de nível."
        );

        await sleep(
            100
        );

        const count =
            generateD3Contours(
                dem
            );

        if (
            count === 0
        ) {

            throw new Error(
                "Nenhuma curva foi encontrada na área."
            );

        }

        status(
            `${count.toLocaleString(
                "pt-BR"
            )} segmentos de curvas gerados.`
        );

        toast(
            "Curvas de nível geradas."
        );

    } catch (
        error
    ) {

        console.error(
            error
        );

        status(
            "Erro ao gerar curvas."
        );

        toast(
            error.message ||
            "Erro ao processar o terreno."
        );

    } finally {

        loading(
            false
        );

        state.processing =
            false;

    }

}


/* =========================================================
   DOWNLOAD
   ========================================================= */

function downloadBlob(
    content,
    filename,
    type
) {

    const blob =
        new Blob(
            [
                content
            ],
            {
                type
            }
        );

    const url =
        URL.createObjectURL(
            blob
        );

    const link =
        document.createElement(
            "a"
        );

    link.href =
        url;

    link.download =
        filename;

    document.body.appendChild(
        link
    );

    link.click();

    link.remove();

    setTimeout(
        () => {
            URL.revokeObjectURL(
                url
            );
        },
        1000
    );

}


/* =========================================================
   ESCAPAR XML
   ========================================================= */

function escapeXML(
    value
) {

    return String(
        value
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&apos;"
        );

}


/* =========================================================
   EXPORTAR KML
   ========================================================= */

function exportKML() {

    if (
        state.points.length <
        3
    ) {

        toast(
            "Delimite uma área primeiro."
        );

        return;

    }

    let kml =
`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>MVA Geo - Contour Map</name>

<Style id="limite">
<LineStyle>
<color>ff176b45</color>
<width>3</width>
</LineStyle>
<PolyStyle>
<color>33176b45</color>
</PolyStyle>
</Style>

<Style id="curva">
<LineStyle>
<color>ff333333</color>
<width>1</width>
</LineStyle>
</Style>

<Style id="principal">
<LineStyle>
<color>ff111111</color>
<width>3</width>
</LineStyle>
</Style>
`;

    /* LIMITE */

    const boundary =
        state.points
            .map(
                p =>
                    `${p.lng},${p.lat},0`
            )
            .join(" ");

    const first =
        state.points[0];

    kml +=
`
<Placemark>
<name>Limite da área</name>
<styleUrl>#limite</styleUrl>
<Polygon>
<outerBoundaryIs>
<LinearRing>
<coordinates>
${boundary} ${first.lng},${first.lat},0
</coordinates>
</LinearRing>
</outerBoundaryIs>
</Polygon>
</Placemark>
`;

    /* CURVAS */

    state.contourData.forEach(
        contour => {

            const coords =
                contour.coordinates
                    .map(
                        p =>
                            `${p.lng},${p.lat},${contour.elevation}`
                    )
                    .join(" ");

            kml +=
`
<Placemark>
<name>Curva ${contour.elevation.toFixed(2)} m</name>
<styleUrl>${
    contour.major
        ? "#principal"
        : "#curva"
}</styleUrl>
<LineString>
<tessellate>1</tessellate>
<coordinates>
${coords}
</coordinates>
</LineString>
</Placemark>
`;

        }
    );

    kml +=
`
</Document>
</kml>`;

    downloadBlob(
        kml,
        `MVA_Geo_Contour_${fileDate()}.kml`,
        "application/vnd.google-earth.kml+xml"
    );

    toast(
        "KML exportado com sucesso."
    );

}


/* =========================================================
   CONVERSÃO LOCAL PARA DXF
   ========================================================= */

function localXY(
    point,
    origin
) {

    const R =
        6378137;

    const lat0 =
        origin.lat *
        Math.PI /
        180;

    const x =
        (
            point.lng -
            origin.lng
        ) *
        Math.PI /
        180 *
        R *
        Math.cos(
            lat0
        );

    const y =
        (
            point.lat -
            origin.lat
        ) *
        Math.PI /
        180 *
        R;

    return {
        x,
        y
    };

}


/* =========================================================
   NÚMERO DXF
   ========================================================= */

function dxfNumber(
    value
) {

    return Number(
        value
    ).toFixed(
        4
    );

}


/* =========================================================
   GERAR DXF
   ========================================================= */

function buildDXF() {

    const origin =
        state.points[0];

    let dxf =
`0
SECTION
2
HEADER
0
ENDSEC
0
SECTION
2
TABLES
0
ENDSEC
0
SECTION
2
ENTITIES
`;

    /* LIMITE */

    dxf +=
`
0
LWPOLYLINE
8
LIMITE
90
${state.points.length}
70
1
`;

    state.points.forEach(
        point => {

            const p =
                localXY(
                    point,
                    origin
                );

            dxf +=
`
10
${dxfNumber(p.x)}
20
${dxfNumber(p.y)}
`;

        }
    );

    /* CURVAS */

    state.contourData.forEach(
        contour => {

            const p1 =
                localXY(
                    contour.coordinates[0],
                    origin
                );

            const p2 =
                localXY(
                    contour.coordinates[1],
                    origin
                );

            dxf +=
`
0
LINE
8
${contour.major
    ? "CURVA_PRINCIPAL"
    : "CURVA"}
10
${dxfNumber(p1.x)}
20
${dxfNumber(p1.y)}
30
${dxfNumber(contour.elevation)}
11
${dxfNumber(p2.x)}
21
${dxfNumber(p2.y)}
31
${dxfNumber(contour.elevation)}
`;

        }
    );

    dxf +=
`
0
ENDSEC
0
EOF
`;

    return dxf;

}


/* =========================================================
   EXPORTAR DXF
   ========================================================= */

function exportDXF() {

    if (
        state.points.length <
        3
    ) {

        toast(
            "Delimite uma área primeiro."
        );

        return;

    }

    if (
        state.contourData.length ===
        0
    ) {

        toast(
            "Gere as curvas antes de exportar."
        );

        return;

    }

    try {

        const dxf =
            buildDXF();

        downloadBlob(
            dxf,
            `MVA_Geo_Contour_${fileDate()}.dxf`,
            "application/dxf"
        );

        toast(
            "DXF exportado com sucesso."
        );

    } catch (
        error
    ) {

        console.error(
            error
        );

        toast(
            "Erro ao gerar DXF."
        );

    }

}


/* =========================================================
   EXPORTAR CSV
   ========================================================= */

function exportCSV() {

    if (
        state.points.length ===
        0
    ) {

        toast(
            "Nenhum ponto foi marcado."
        );

        return;

    }

    let csv =
        "PONTO;LATITUDE;LONGITUDE\n";

    state.points.forEach(
        (
            point,
            index
        ) => {

            csv +=
                `${index + 1};` +
                `${point.lat.toFixed(8)};` +
                `${point.lng.toFixed(8)}\n`;

        }
    );

    downloadBlob(
        "\uFEFF" +
        csv,
        `MVA_Geo_Vertices_${fileDate()}.csv`,
        "text/csv;charset=utf-8"
    );

    toast(
        "CSV exportado."
    );

}


/* =========================================================
   IMPORTAR KML
   ========================================================= */

function parseKML(
    text
) {

    const parser =
        new DOMParser();

    const xml =
        parser.parseFromString(
            text,
            "application/xml"
        );

    const parserError =
        xml.querySelector(
            "parsererror"
        );

    if (
        parserError
    ) {

        throw new Error(
            "KML inválido."
        );

    }

    const elements =
        Array.from(
            xml.getElementsByTagName(
                "coordinates"
            )
        );

    if (
        elements.length ===
        0
    ) {

        throw new Error(
            "Nenhuma coordenada encontrada no KML."
        );

    }

    let best = [];

    elements.forEach(
        element => {

            const raw =
                element.textContent
                    .trim();

            const coords =
                raw
                    .split(
                        /\s+/
                    )
                    .map(
                        item => {

                            const parts =
                                item.split(
                                    ","
                                );

                            const lng =
                                Number(
                                    parts[0]
                                );

                            const lat =
                                Number(
                                    parts[1]
                                );

                            if (
                                Number.isFinite(
                                    lat
                                ) &&
                                Number.isFinite(
                                    lng
                                )
                            ) {

                                return {
                                    lat,
                                    lng
                                };

                            }

                            return null;

                        }
                    )
                    .filter(
                        Boolean
                    );

            if (
                coords.length >
                best.length
            ) {

                best =
                    coords;

            }

        }
    );

    return best;

}


/* =========================================================
   IMPORTAR KML
   ========================================================= */

async function importKML(
    file
) {

    const text =
        await file.text();

    const coords =
        parseKML(
            text
        );

    if (
        coords.length <
        3
    ) {

        throw new Error(
            "O KML precisa possuir pelo menos 3 pontos."
        );

    }

    clearAll();

    state.points =
        coords.map(
            p =>
                L.latLng(
                    p.lat,
                    p.lng
                )
        );

    state.closed =
        true;

    state.drawing =
        false;

    renderMarkers();

    state.map.fitBounds(
        L.latLngBounds(
            state.points
        ),
        {
            padding:
                [30, 30]
        }
    );

    status(
        `KML importado com ${state.points.length} vértices.`
    );

    toast(
        "KML importado com sucesso."
    );

}


/* =========================================================
   GEOLOCALIZAÇÃO
   ========================================================= */

function locateUser() {

    if (
        !navigator.geolocation
    ) {

        toast(
            "Seu navegador não suporta localização."
        );

        return;

    }

    status(
        "Obtendo sua localização..."
    );

    navigator.geolocation.getCurrentPosition(

        position => {

            const lat =
                position.coords.latitude;

            const lng =
                position.coords.longitude;

            const point =
                L.latLng(
                    lat,
                    lng
                );

            if (
                state.locationMarker
            ) {

                state.locationMarker.setLatLng(
                    point
                );

            } else {

                state.locationMarker =
                    L.marker(
                        point
                    )
                    .addTo(
                        state.map
                    )
                    .bindPopup(
                        "Minha posição"
                    );

            }

            state.map.setView(
                point,
                18
            );

            state.locationMarker
                .openPopup();

            status(
                `Localização: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
            );

        },

        error => {

            console.error(
                error
            );

            toast(
                "Não foi possível obter sua localização."
            );

        },

        {
            enableHighAccuracy:
                true,

            timeout:
                15000,

            maximumAge:
                0
        }

    );

}


/* =========================================================
   BOTÕES
   ========================================================= */

function bind(
    id,
    event,
    handler
) {

    const el =
        $(id);

    if (!el) {
        return;
    }

    el.addEventListener(
        event,
        handler
    );

}


/* =========================================================
   NOVA ÁREA
   ========================================================= */

bind(
    "newArea",
    "click",
    newArea
);


/* DESFAZER */

bind(
    "undoBtn",
    "click",
    undo
);


/* FECHAR */

bind(
    "closeBtn",
    "click",
    closeArea
);


/* LIMPAR */

bind(
    "clearBtn",
    "click",
    clearAll
);


/* GERAR CURVAS */

bind(
    "generateBtn",
    "click",
    generateContours
);


/* EXPORTAR KML */

bind(
    "exportKmlBtn",
    "click",
    exportKML
);


/* EXPORTAR DXF */

bind(
    "exportDxfBtn",
    "click",
    exportDXF
);


/* EXPORTAR CSV */

bind(
    "exportCsvBtn",
    "click",
    exportCSV
);


/* LOCALIZAÇÃO */

bind(
    "locationBtn",
    "click",
    locateUser
);

bind(
    "myLocationBtn",
    "click",
    locateUser
);

bind(
    "positionBtn",
    "click",
    locateUser
);


/* =========================================================
   IMPORTAÇÃO KML
   ========================================================= */

bind(
    "kmlInput",
    "change",
    async event => {

        const file =
            event.target.files &&
            event.target.files[0];

        if (!file) {
            return;
        }

        try {

            await importKML(
                file
            );

        } catch (
            error
        ) {

            console.error(
                error
            );

            toast(
                error.message ||
                "Erro ao importar KML."
            );

        } finally {

            event.target.value =
                "";

        }

    }
);


/* =========================================================
   CONFIGURAÇÕES
   ========================================================= */

bind(
    "settingsBtn",
    "click",
    () => {

        const settings =
            $("settings");

        if (!settings) {
            return;
        }

        settings.classList.toggle(
            "open"
        );

    }
);


/* =========================================================
   CLIQUE NO MAPA
   ========================================================= */

state.map.on(
    "click",
    addPoint
);


/* =========================================================
   TECLADO
   ========================================================= */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            state.drawing =
                false;

            state.map
                .getContainer()
                .classList.remove(
                    "drawing-mode"
                );

        }

        if (
            (
                event.ctrlKey ||
                event.metaKey
            ) &&
            event.key.toLowerCase() ===
            "z"
        ) {

            event.preventDefault();

            undo();

        }

    }
);


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        setTimeout(
            () => {

                if (
                    state.map
                ) {

                    state.map.invalidateSize();

                }

            },
            200
        );

    }
);


/* =========================================================
   ORIENTAÇÃO / IOS
   ========================================================= */

window.addEventListener(
    "orientationchange",
    () => {

        setTimeout(
            () => {

                if (
                    state.map
                ) {

                    state.map.invalidateSize();

                }

            },
            400
        );

    }
);


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

updateStats();

status(
    'Pronto. Toque em "Nova área" para começar.'
);

setTimeout(
    () => {

        state.map.invalidateSize();

    },
    300
);

console.log(
    "MVA Geo Contour Map — app.js novo carregado."
);