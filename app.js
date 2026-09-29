/* =========================================================
   MVA GEO - CONTOUR MAP
   APP.JS
   Motor principal
   ========================================================= */

"use strict";

/* =========================================================
   FUNÇÃO AUXILIAR
   ========================================================= */

const $ = (id) => document.getElementById(id);

const state = {
    map: null,

    baseLayers: {},

    drawing: false,
    closed: false,

    points: [],
    markers: [],

    polygon: null,

    contourLayers: [],

    contourData: [],

    undoStack: [],

    dem: null,

    processing: false
};


/* =========================================================
   INICIALIZAÇÃO DO MAPA
   ========================================================= */

state.map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
}).setView(
    [-29.6500, -50.7800],
    13
);


/* =========================================================
   CAMADA SATÉLITE
   ========================================================= */

const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        maxZoom: 19,
        attribution: "© Esri"
    }
);


/* =========================================================
   CAMADA MAPA
   ========================================================= */

const streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
    }
);


/* =========================================================
   SATÉLITE COMO PADRÃO
   ========================================================= */

satellite.addTo(state.map);


/* =========================================================
   CONTROLE DE CAMADAS
   ========================================================= */

state.baseLayers = {
    "Satélite": satellite,
    "Mapa": streets
};

L.control.layers(
    state.baseLayers,
    null,
    {
        collapsed: true
    }
).addTo(state.map);


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
        alert(text);
        return;
    }

    element.textContent = text;

    element.classList.add("show");

    clearTimeout(
        toast.timer
    );

    toast.timer = setTimeout(
        () => {
            element.classList.remove("show");
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

    const element =
        $("loading");

    if (!element) {
        return;
    }

    if (visible) {

        element.classList.remove(
            "hidden"
        );

        $("loadingTitle").textContent =
            title;

        $("loadingText").textContent =
            message;

    } else {

        element.classList.add(
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
   ÍCONE DO VÉRTICE
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
   SALVAR ESTADO PARA DESFAZER
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


/* =========================================================
   CALCULAR ÁREA
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
   ATUALIZAR ESTATÍSTICAS
   ========================================================= */

function updateStats() {

    if ($("vertexCount")) {

        $("vertexCount")
            .textContent =
            state.points.length;

    }


    const area =
        polygonArea(
            state.points
        );


    if ($("areaValue")) {

        $("areaValue")
            .textContent =
            `${numberBR(
                area / 10000,
                2
            )} ha`;

    }

}


/* =========================================================
   REMOVER MARCADORES
   ========================================================= */

function removeMarkers() {

    state.markers.forEach(
        marker => {

            state.map.removeLayer(
                marker
            );

        }
    );


    state.markers = [];

}


/* =========================================================
   DESENHAR VÉRTICES
   ========================================================= */

function renderMarkers() {

    removeMarkers();


    state.points.forEach(
        (point, index) => {

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
                )
                .addTo(
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

                    saveUndo();

                    status(
                        `Vértice ${
                            index + 1
                        } reposicionado.`
                    );

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
        state.points.length < 2
    ) {

        return;

    }


    state.polygon =
        L.polygon(
            state.points,
            {
                color: "#176b45",

                weight: 2,

                dashArray:
                    state.closed
                        ? null
                        : "7 5",

                fillColor:
                    "#176b45",

                fillOpacity:
                    0.08
            }
        )
        .addTo(
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
        "Marque quantos pontos quiser."
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
        event.latlng
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
   DESFAZER
   ========================================================= */

function undo() {

    if (
        state.undoStack.length === 0
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

    state.contourLayers
        .forEach(
            layer => {

                state.map.removeLayer(
                    layer
                );

            }
        );


    state.contourLayers = [];

    state.contourData = [];


    state.dem = null;


    if ($("minZ")) {

        $("minZ")
            .textContent = "—";

    }


    if ($("maxZ")) {

        $("maxZ")
            .textContent = "—";

    }


    if ($("sourceInfo")) {

        $("sourceInfo")
            .textContent =
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

    const latitudes =
        state.points.map(
            p => p.lat
        );


    const longitudes =
        state.points.map(
            p => p.lng
        );


    return {

        south:
            Math.min(
                ...latitudes
            ),

        north:
            Math.max(
                ...latitudes
            ),

        west:
            Math.min(
                ...longitudes
            ),

        east:
            Math.max(
                ...longitudes
            )

    };

}


/* =========================================================
   PONTO DENTRO DO POLÍGONO
   ========================================================= */

function pointInPolygon(
    point,
    polygon
) {

    let inside = false;


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


        const intersect =
            (
                (yi > point.y) !==
                (yj > point.y)
            ) &&
            (
                point.x <
                (
                    (xj - xi) *
                    (point.y - yi)
                ) /
                (yj - yi) +
                xi
            );


        if (intersect) {

            inside = !inside;

        }

    }


    return inside;

}


/* =========================================================
   DISTÂNCIA APROXIMADA ENTRE DOIS PONTOS
   ========================================================= */

function distanceMeters(
    a,
    b
) {

    const R = 6378137;


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
   LIMITE DA ÁREA
   ========================================================= */

function bboxSize(
    bbox
) {

    const northSouth =
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


    const eastWest =
        distanceMeters(
            {
                lat:
                    (
                        bbox.south +
                        bbox.north
                    ) / 2,
                lng:
                    bbox.west
            },
            {
                lat:
                    (
                        bbox.south +
                        bbox.north
                    ) / 2,
                lng:
                    bbox.east
            }
        );


    return {

        width:
            eastWest,

        height:
            northSouth

    };

}


/* =========================================================
   API BASE
   ========================================================= */

function apiBase() {

    const input =
        $("apiBase");


    if (!input) {

        throw new Error(
            "Campo da API não encontrado."
        );

    }


    const value =
        input.value.trim();


    if (!value) {

        throw new Error(
            "Informe a URL da API DEM nas configurações."
        );

    }


    return value.replace(
        /\/+$/,
        ""
    );

}


/* =========================================================
   EVENTOS DOS BOTÕES
   ========================================================= */

$("newArea")
    .addEventListener(
        "click",
        newArea
    );


$("undoBtn")
    .addEventListener(
        "click",
        undo
    );


$("closeBtn")
    .addEventListener(
        "click",
        closeArea
    );


$("clearBtn")
    .addEventListener(
        "click",
        clearAll
    );


/* =========================================================
   CLIQUE NO MAPA
   ========================================================= */

state.map.on(
    "click",
    addPoint
);


/* =========================================================
   CONFIGURAÇÕES
   ========================================================= */

$("settingsBtn")
    .addEventListener(
        "click",
        () => {

            $("settings")
                .classList.toggle(
                    "open"
                );

        }
    );


/* =========================================================
   TECLA ESC
   ========================================================= */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            state.drawing = false;

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
   ESTADO INICIAL
   ========================================================= */

updateStats();

status(
    'Pronto. Toque em "Nova área" para começar.'
);

console.log(
    "MVA Geo Contour Map iniciado."
);

/* =========================================================
   PARTE 2 — DEM + GRADE + CURVAS DE NÍVEL
   ========================================================= */


/* =========================================================
   CONFIGURAÇÃO DO DEM
   ========================================================= */

const DEM_CONFIG = {

    /*
     * Fallback público para testes.
     *
     * Importante:
     * este serviço fornece elevação baseada no
     * Copernicus GLO-90.
     *
     * A arquitetura abaixo já fica preparada para
     * posteriormente utilizar um DEM regional de
     * maior resolução através de um Worker/API.
     */

    openMeteo:
        "https://api.open-meteo.com/v1/elevation",

    /*
     * Máximo de coordenadas por requisição.
     */

    batchSize:
        100,

    /*
     * Limites da grade no navegador.
     *
     * Isso NÃO limita o número de vértices do
     * polígono.
     *
     * É apenas uma proteção para o celular não
     * travar durante o cálculo.
     */

    maxGridColumns:
        80,

    maxGridRows:
        80

};


/* =========================================================
   OBTER EQUIPARAMENTO DA CURVA
   ========================================================= */

function getContourInterval() {

    const element =
        $("interval");

    if (!element) {

        return 1;

    }

    const value =
        Number(
            element.value
        );

    if (
        !Number.isFinite(
            value
        ) ||
        value <= 0
    ) {

        return 1;

    }

    return value;

}


/* =========================================================
   CRIAR GRADE DE AMOSTRAGEM
   ========================================================= */

function createSamplingGrid(
    bbox
) {

    const size =
        bboxSize(
            bbox
        );


    /*
     * Usamos aproximadamente 100 m entre
     * pontos como ponto de partida.
     *
     * O número é adaptado à área.
     */

    const targetSpacing =
        100;


    let columns =
        Math.ceil(
            size.width /
            targetSpacing
        ) + 1;


    let rows =
        Math.ceil(
            size.height /
            targetSpacing
        ) + 1;


    columns =
        Math.max(
            8,
            Math.min(
                columns,
                DEM_CONFIG.maxGridColumns
            )
        );


    rows =
        Math.max(
            8,
            Math.min(
                rows,
                DEM_CONFIG.maxGridRows
            )
        );


    const coordinates = [];


    for (
        let row = 0;
        row < rows;
        row++
    ) {

        const y =
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
            y;


        for (
            let column = 0;
            column < columns;
            column++
        ) {

            const x =
                column /
                (
                    columns - 1
                );


            const lng =
                bbox.west +
                (
                    bbox.east -
                    bbox.west
                ) *
                x;


            coordinates.push({

                lat:
                    lat,

                lng:
                    lng

            });

        }

    }


    return {

        width:
            columns,

        height:
            rows,

        coordinates:
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

    const elevations = [];


    for (
        let start = 0;

        start <
        coordinates.length;

        start +=
        DEM_CONFIG.batchSize
    ) {

        const batch =
            coordinates.slice(
                start,
                start +
                DEM_CONFIG.batchSize
            );


        const latitude =
            batch
                .map(
                    point =>
                        point.lat.toFixed(
                            6
                        )
                )
                .join(",");


        const longitude =
            batch
                .map(
                    point =>
                        point.lng.toFixed(
                            6
                        )
                )
                .join(",");


        const url =
            `${DEM_CONFIG.openMeteo}?latitude=${latitude}&longitude=${longitude}`;


        const response =
            await fetch(
                url
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


        if (
            !data ||
            !Array.isArray(
                data.elevation
            )
        ) {

            throw new Error(
                "O serviço de elevação não retornou uma matriz válida."
            );

        }


        elevations.push(
            ...data.elevation
        );


        /*
         * Pequena pausa entre lotes.
         *
         * Ajuda em conexões móveis e evita
         * disparar todas as requisições ao mesmo
         * tempo.
         */

        if (
            start +
            DEM_CONFIG.batchSize <
            coordinates.length
        ) {

            await sleep(
                80
            );

        }

    }


    if (
        elevations.length !==
        coordinates.length
    ) {

        throw new Error(
            "A quantidade de elevações retornada não corresponde à grade."
        );

    }


    return elevations;

}


/* =========================================================
   SLEEP
   ========================================================= */

function sleep(
    milliseconds
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );

}


/* =========================================================
   CONSTRUIR DEM
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

            if (
                value <
                min
            ) {

                min =
                    value;

            }


            if (
                value >
                max
            ) {

                max =
                    value;

            }

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
            "Não foi possível determinar as altitudes da área."
        );

    }


    return {

        width:
            grid.width,

        height:
            grid.height,

        values:
            values,

        west:
            grid.west,

        east:
            grid.east,

        south:
            grid.south,

        north:
            grid.north,

        min:
            min,

        max:
            max

    };

}


/* =========================================================
   CONVERTER GEO PARA GRADE
   ========================================================= */

function geoToGrid(
    lat,
    lng,
    dem
) {

    const x =
        (
            lng -
            dem.west
        ) /
        (
            dem.east -
            dem.west
        ) *
        (
            dem.width -
            1
        );


    const y =
        (
            dem.north -
            lat
        ) /
        (
            dem.north -
            dem.south
        ) *
        (
            dem.height -
            1
        );


    return {

        x:
            x,

        y:
            y

    };

}


/* =========================================================
   CONVERTER GRADE PARA GEO
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

        lat:
            lat,

        lng:
            lng

    };

}


/* =========================================================
   POLÍGONO EM COORDENADAS DA GRADE
   ========================================================= */

function polygonToGrid(
    dem
) {

    return state.points.map(
        point => {

            return geoToGrid(
                point.lat,
                point.lng,
                dem
            );

        }
    );

}


/* =========================================================
   INTERSEÇÃO ENTRE SEGMENTOS
   ========================================================= */

function segmentIntersection(
    a,
    b,
    c,
    d
) {

    const denominator =
        (
            b.x -
            a.x
        ) *
        (
            d.y -
            c.y
        ) -
        (
            b.y -
            a.y
        ) *
        (
            d.x -
            c.x
        );


    /*
     * Segmentos paralelos.
     */

    if (
        Math.abs(
            denominator
        ) <
        0.000000001
    ) {

        return null;

    }


    const numeratorT =
        (
            c.x -
            a.x
        ) *
        (
            d.y -
            c.y
        ) -
        (
            c.y -
            a.y
        ) *
        (
            d.x -
            c.x
        );


    const numeratorU =
        (
            c.x -
            a.x
        ) *
        (
            b.y -
            a.y
        ) -
        (
            c.y -
            a.y
        ) *
        (
            b.x -
            a.x
        );


    const t =
        numeratorT /
        denominator;


    const u =
        numeratorU /
        denominator;


    if (
        t >= -0.000000001 &&
        t <= 1.000000001 &&
        u >= -0.000000001 &&
        u <= 1.000000001
    ) {

        return {

            t:
                Math.max(
                    0,
                    Math.min(
                        1,
                        t
                    )
                ),

            u:
                Math.max(
                    0,
                    Math.min(
                        1,
                        u
                    )
                )

        };

    }


    return null;

}


/* =========================================================
   RECORTAR SEGMENTO PELO POLÍGONO
   ========================================================= */

function clipSegmentToPolygon(
    a,
    b,
    polygon
) {

    const parameters = [
        0,
        1
    ];


    /*
     * Descobre todos os pontos onde o segmento
     * cruza o limite do polígono.
     */

    for (
        let i = 0;
        i < polygon.length;
        i++
    ) {

        const c =
            polygon[i];


        const d =
            polygon[
                (
                    i + 1
                ) %
                polygon.length
            ];


        const result =
            segmentIntersection(
                a,
                b,
                c,
                d
            );


        if (
            result
        ) {

            parameters.push(
                result.t
            );

        }

    }


    /*
     * Ordena os pontos de corte.
     */

    parameters.sort(
        (
            a,
            b
        ) =>
            a - b
    );


    /*
     * Remove duplicações.
     */

    const unique = [];


    parameters.forEach(
        value => {

            if (
                unique.length ===
                0
            ) {

                unique.push(
                    value
                );

                return;

            }


            const previous =
                unique[
                    unique.length -
                    1
                ];


            if (
                Math.abs(
                    value -
                    previous
                ) >
                0.0000001
            ) {

                unique.push(
                    value
                );

            }

        }
    );


    const result = [];


    /*
     * Analisa cada trecho do segmento.
     */

    for (
        let i = 0;
        i <
        unique.length -
        1;
        i++
    ) {

        const t1 =
            unique[i];

        const t2 =
            unique[
                i + 1
            ];


        if (
            t2 -
            t1 <
            0.0000001
        ) {

            continue;

        }


        const middleT =
            (
                t1 +
                t2
            ) /
            2;


        const middle = {

            x:
                a.x +
                (
                    b.x -
                    a.x
                ) *
                middleT,

            y:
                a.y +
                (
                    b.y -
                    a.y
                ) *
                middleT

        };


        if (
            pointInPolygon(
                middle,
                polygon
            )
        ) {

            result.push({

                a: {

                    x:
                        a.x +
                        (
                            b.x -
                            a.x
                        ) *
                        t1,

                    y:
                        a.y +
                        (
                            b.y -
                            a.y
                        ) *
                        t1

                },

                b: {

                    x:
                        a.x +
                        (
                            b.x -
                            a.x
                        ) *
                        t2,

                    y:
                        a.y +
                        (
                            b.y -
                            a.y
                        ) *
                        t2

                }

            });

        }

    }


    return result;

}


/* =========================================================
   EXTRair SEGMENTOS DE UMA CURVA D3
   ========================================================= */

function extractContourSegments(
    contour,
    dem
) {

    const polygon =
        polygonToGrid(
            dem
        );


    const segments = [];


    if (
        !contour ||
        !contour.coordinates
    ) {

        return segments;

    }


    /*
     * D3 retorna MultiPolygon.
     *
     * Estrutura:
     *
     * coordinates
     *   polygon
     *     ring
     *       [x,y]
     */

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
                        ring.length -
                        1;
                        i++
                    ) {

                        const a = {

                            x:
                                ring[i][0],

                            y:
                                ring[i][1]

                        };


                        const b = {

                            x:
                                ring[
                                    i + 1
                                ][0],

                            y:
                                ring[
                                    i + 1
                                ][1]

                        };


                        const clipped =
                            clipSegmentToPolygon(
                                a,
                                b,
                                polygon
                            );


                        clipped.forEach(
                            segment => {

                                const p1 =
                                    gridToGeo(
                                        segment.a.x,
                                        segment.a.y,
                                        dem
                                    );


                                const p2 =
                                    gridToGeo(
                                        segment.b.x,
                                        segment.b.y,
                                        dem
                                    );


                                segments.push({

                                    elevation:
                                        Number(
                                            contour.value
                                        ),

                                    a:
                                        p1,

                                    b:
                                        p2

                                });

                            }
                        );

                    }

                }
            );

        }
    );


    return segments;

}


/* =========================================================
   DETERMINAR CURVAS PRINCIPAIS
   ========================================================= */

function isMajorContour(
    elevation,
    interval
) {

    /*
     * A cada 5 intervalos:
     *
     * 1 m -> 5 m
     * 2 m -> 10 m
     * 5 m -> 25 m
     * etc.
     */

    const multiple =
        Math.round(
            elevation /
            interval
        );


    return (
        multiple %
        5 ===
        0
    );

}


/* =========================================================
   DESENHAR SEGMENTO DE CURVA
   ========================================================= */

function drawContourSegment(
    segment,
    interval
) {

    const major =
        isMajorContour(
            segment.elevation,
            interval
        );


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
                    major
                        ? "#111827"
                        : "#475467",

                weight:
                    major
                        ? 3
                        : 1.25,

                opacity:
                    0.95,

                interactive:
                    true,

                className:
                    major
                        ? "contour-line major"
                        : "contour-line"

            }
        )
        .addTo(
            state.map
        );


    line._elevation =
        segment.elevation;


    line._major =
        major;


    line.bindTooltip(
        `${numberBR(
            segment.elevation,
            2
        )} m`,
        {
            sticky:
                true,

            direction:
                "top"
        }
    );


    state.contourLayers.push(
        line
    );


    state.contourData.push(
        segment
    );


    return line;

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
            "A biblioteca D3 Contours não foi carregada."
        );

    }


    const interval =
        getContourInterval();


    /*
     * Arredondamento da menor cota para cima.
     */

    const first =
        Math.ceil(
            dem.min /
            interval
        ) *
        interval;


    /*
     * Arredondamento da maior cota para baixo.
     */

    const last =
        Math.floor(
            dem.max /
            interval
        ) *
        interval;


    if (
        first >
        last
    ) {

        return 0;

    }


    const thresholds = [];


    /*
     * Evita uma quantidade absurda de
     * níveis caso alguém coloque uma
     * equidistância extremamente pequena.
     */

    const numberOfLevels =
        Math.floor(
            (
                last -
                first
            ) /
            interval
        ) + 1;


    if (
        numberOfLevels >
        5000
    ) {

        throw new Error(
            "A equidistância escolhida gera curvas demais. Aumente a equidistância."
        );

    }


    for (
        let i = 0;
        i <
        numberOfLevels;
        i++
    ) {

        const elevation =
            first +
            i *
            interval;


        thresholds.push(
            Number(
                elevation.toFixed(
                    6
                )
            )
        );

    }


    /*
     * Gerador de isolinhas.
     */

    const generator =
        d3
            .contours()
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


    let count =
        0;


    contours.forEach(
        contour => {

            const segments =
                extractContourSegments(
                    contour,
                    dem
                );


            segments.forEach(
                segment => {

                    drawContourSegment(
                        segment,
                        interval
                    );


                    count++;

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

        $("minZ")
            .textContent =
            `${numberBR(
                dem.min,
                2
            )} m`;

    }


    if ($("maxZ")) {

        $("maxZ")
            .textContent =
            `${numberBR(
                dem.max,
                2
            )} m`;

    }


    if ($("sourceInfo")) {

        $("sourceInfo")
            .textContent =
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


    /*
     * Mostra informação no status.
     */

    status(
        `Preparando ${grid.coordinates.length.toLocaleString(
            "pt-BR"
        )} pontos de elevação...`
    );


    loading(
        true,
        "Obtendo terreno...",
        `Consultando ${grid.coordinates.length.toLocaleString(
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
            "Extraindo as isolinhas da superfície."
        );


        await sleep(
            50
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
            "Erro desconhecido ao processar o terreno."
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
   BOTÃO GERAR
   ========================================================= */

if (
    $("generateBtn")
) {

    $("generateBtn")
        .addEventListener(
            "click",
            generateContours
        );

}


/* =========================================================
   RESIZE DO MAPA
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        setTimeout(
            () => {

                state.map.invalidateSize();

            },
            150
        );

    }
);

/* =========================================================
   PARTE 3 — EXPORTAÇÃO, KML, DXF, IMPORTAÇÃO E FINALIZAÇÃO
   ========================================================= */


/* =========================================================
   UTILITÁRIOS DE EXPORTAÇÃO
   ========================================================= */

function downloadBlob(
    content,
    filename,
    type
) {

    const blob =
        new Blob(
            [content],
            {
                type:
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
   DATA PARA NOME DO ARQUIVO
   ========================================================= */

function fileDate() {

    const now =
        new Date();


    const year =
        now.getFullYear();


    const month =
        String(
            now.getMonth() + 1
        )
        .padStart(
            2,
            "0"
        );


    const day =
        String(
            now.getDate()
        )
        .padStart(
            2,
            "0"
        );


    const hour =
        String(
            now.getHours()
        )
        .padStart(
            2,
            "0"
        );


    const minute =
        String(
            now.getMinutes()
        )
        .padStart(
            2,
            "0"
        );


    return `${year}${month}${day}_${hour}${minute}`;

}


/* =========================================================
   KML — CABEÇALHO
   ========================================================= */

function kmlHeader() {

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>MVA Geo - Contour Map</name>

<Style id="contour">
<LineStyle>
<color>ff333333</color>
<width>1.5</width>
</LineStyle>
</Style>

<Style id="majorContour">
<LineStyle>
<color>ff111111</color>
<width>3</width>
</LineStyle>
</Style>

`;

}


/* =========================================================
   KML — ÁREA
   ========================================================= */

function polygonToKML() {

    if (
        state.points.length <
        3
    ) {

        return "";

    }


    const coordinates =
        state.points
            .map(
                point =>
                    `${point.lng.toFixed(
                        8
                    )},${point.lat.toFixed(
                        8
                    )},0`
            )
            .join(" ");


    const first =
        state.points[0];


    const closedCoordinates =
        `${coordinates} ${first.lng.toFixed(
            8
        )},${first.lat.toFixed(
            8
        )},0`;


    return `
<Placemark>
<name>Área delimitada</name>
<Style>
<LineStyle>
<color>ff176b45</color>
<width>3</width>
</LineStyle>
<PolyStyle>
<color>33176b45</color>
</PolyStyle>
</Style>
<Polygon>
<outerBoundaryIs>
<LinearRing>
<coordinates>
${closedCoordinates}
</coordinates>
</LinearRing>
</outerBoundaryIs>
</Polygon>
</Placemark>
`;

}


/* =========================================================
   KML — CURVAS
   ========================================================= */

function contoursToKML() {

    if (
        state.contourData.length ===
        0
    ) {

        return "";

    }


    let output =
        "";


    state.contourData.forEach(
        segment => {

            const major =
                isMajorContour(
                    segment.elevation,
                    getContourInterval()
                );


            output += `
<Placemark>
<name>Curva ${segment.elevation.toFixed(
                2
            )} m</name>

<description>
Cota: ${segment.elevation.toFixed(
                2
            )} m
</description>

<ExtendedData>
<Data name="elevacao">
<value>${segment.elevation.toFixed(
                3
            )}</value>
</Data>

<Data name="fonte">
<value>Copernicus GLO-90 / Open-Meteo</value>
</Data>
</ExtendedData>

<styleUrl>#${major
                ? "majorContour"
                : "contour"
            }</styleUrl>

<LineString>
<altitudeMode>absolute</altitudeMode>
<coordinates>
${segment.a.lng.toFixed(
                8
            )},${segment.a.lat.toFixed(
                8
            )},${segment.elevation.toFixed(
                3
            )}
${segment.b.lng.toFixed(
                8
            )},${segment.b.lat.toFixed(
                8
            )},${segment.elevation.toFixed(
                3
            )}
</coordinates>
</LineString>

</Placemark>
`;

        }
    );


    return output;

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


    if (
        state.contourData.length ===
        0
    ) {

        toast(
            "Gere as curvas antes de exportar."
        );

        return;

    }


    const kml =
        kmlHeader() +
        polygonToKML() +
        contoursToKML() +
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
   COORDENADAS PARA DXF
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
   CONVERTER LAT/LNG PARA COORDENADAS LOCAIS
   ========================================================= */

function localProjection(
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

        x:
            x,

        y:
            y

    };

}


/* =========================================================
   CRIAR DXF
   ========================================================= */

function buildDXF() {

    if (
        state.contourData.length ===
        0
    ) {

        throw new Error(
            "Nenhuma curva disponível para exportar."
        );

    }


    /*
     * Origem local:
     * primeiro ponto da área.
     *
     * Isso mantém os valores menores no
     * arquivo e evita problemas de precisão
     * no CAD.
     */

    const origin =
        state.points[0];


    let dxf =
        "";


    dxf +=
        "0\nSECTION\n2\nHEADER\n";


    dxf +=
        "9\n$ACADVER\n1\nAC1015\n";


    dxf +=
        "0\nENDSEC\n";


    dxf +=
        "0\nSECTION\n2\nTABLES\n";


    dxf +=
        "0\nTABLE\n2\nLAYER\n70\n3\n";


    /*
     * Layer CURVAS
     */

    dxf +=
        "0\nLAYER\n2\nCURVAS\n70\n0\n62\n7\n6\nCONTINUOUS\n";


    /*
     * Layer CURVAS_MESTRAS
     */

    dxf +=
        "0\nLAYER\n2\nCURVAS_MESTRAS\n70\n0\n62\n1\n6\nCONTINUOUS\n";


    /*
     * Layer LIMITE
     */

    dxf +=
        "0\nLAYER\n2\nLIMITE\n70\n0\n62\n3\n6\nCONTINUOUS\n";


    dxf +=
        "0\nENDTAB\n";


    dxf +=
        "0\nENDSEC\n";


    dxf +=
        "0\nSECTION\n2\nENTITIES\n";


    /*
     * CURVAS
     */

    state.contourData.forEach(
        segment => {

            const a =
                localProjection(
                    segment.a,
                    origin
                );


            const b =
                localProjection(
                    segment.b,
                    origin
                );


            const major =
                isMajorContour(
                    segment.elevation,
                    getContourInterval()
                );


            const layer =
                major
                    ? "CURVAS_MESTRAS"
                    : "CURVAS";


            /*
             * 3D POLYLINE
             *
             * Cada segmento mantém a
             * altitude real da curva.
             */

            dxf +=
                "0\nPOLYLINE\n" +
                "8\n" +
                layer +
                "\n" +
                "66\n1\n" +
                "70\n8\n" +
                "10\n0\n" +
                "20\n0\n" +
                "30\n0\n";


            dxf +=
                "0\nVERTEX\n" +
                "8\n" +
                layer +
                "\n" +
                "10\n" +
                dxfNumber(
                    a.x
                ) +
                "\n20\n" +
                dxfNumber(
                    a.y
                ) +
                "\n30\n" +
                dxfNumber(
                    segment.elevation
                ) +
                "\n";


            dxf +=
                "0\nVERTEX\n" +
                "8\n" +
                layer +
                "\n" +
                "10\n" +
                dxfNumber(
                    b.x
                ) +
                "\n20\n" +
                dxfNumber(
                    b.y
                ) +
                "\n30\n" +
                dxfNumber(
                    segment.elevation
                ) +
                "\n";


            dxf +=
                "0\nSEQEND\n";

        }
    );


    /*
     * LIMITE DA ÁREA
     */

    if (
        state.points.length >=
        3
    ) {

        dxf +=
            "0\nPOLYLINE\n" +
            "8\nLIMITE\n" +
            "66\n1\n" +
            "70\n9\n" +
            "10\n0\n" +
            "20\n0\n" +
            "30\n0\n";


        state.points.forEach(
            point => {

                const local =
                    localProjection(
                        point,
                        origin
                    );


                dxf +=
                    "0\nVERTEX\n" +
                    "8\nLIMITE\n" +
                    "10\n" +
                    dxfNumber(
                        local.x
                    ) +
                    "\n20\n" +
                    dxfNumber(
                        local.y
                    ) +
                    "\n30\n0\n";

            }
        );


        dxf +=
            "0\nSEQEND\n";

    }


    dxf +=
        "0\nENDSEC\n";


    dxf +=
        "0\nEOF\n";


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
            error.message
        );

    }

}


/* =========================================================
   EXPORTAR CSV DE PONTOS
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
                `${point.lat.toFixed(
                    8
                )};` +
                `${point.lng.toFixed(
                    8
                )}\n`;

        }
    );


    downloadBlob(
        "\uFEFF" +
        csv,
        `MVA_Geo_Vertices_${fileDate()}.csv`,
        "text/csv;charset=utf-8"
    );


    toast(
        "CSV dos vértices exportado."
    );

}


/* =========================================================
   IMPORTAÇÃO DE KML
   ========================================================= */

function extractKMLCoordinates(
    text
) {

    const parser =
        new DOMParser();


    const xml =
        parser.parseFromString(
            text,
            "application/xml"
        );


    const coordinateElements =
        Array.from(
            xml.getElementsByTagName(
                "coordinates"
            )
        );


    if (
        coordinateElements.length ===
        0
    ) {

        throw new Error(
            "Nenhuma coordenada encontrada no KML."
        );

    }


    let best = [];


    coordinateElements.forEach(
        element => {

            const raw =
                element.textContent
                    .trim();


            const list =
                raw
                    .split(
                        /\s+/
                    )
                    .map(
                        value => {

                            const parts =
                                value.split(
                                    ","
                                );


                            if (
                                parts.length <
                                2
                            ) {

                                return null;

                            }


                            const lng =
                                Number(
                                    parts[0]
                                );


                            const lat =
                                Number(
                                    parts[1]
                                );


                            if (
                                !Number.isFinite(
                                    lat
                                ) ||
                                !Number.isFinite(
                                    lng
                                )
                            ) {

                                return null;

                            }


                            return {
                                lat:
                                    lat,
                                lng:
                                    lng
                            };

                        }
                    )
                    .filter(
                        Boolean
                    );


            if (
                list.length >
                best.length
            ) {

                best =
                    list;

            }

        }
    );


    if (
        best.length <
        3
    ) {

        throw new Error(
            "O KML não contém um polígono válido."
        );

    }


    /*
     * Remove o último ponto caso ele seja
     * igual ao primeiro.
     */

    const first =
        best[0];


    const last =
        best[
            best.length - 1
        ];


    if (
        Math.abs(
            first.lat -
            last.lat
        ) <
        0.00000001 &&
        Math.abs(
            first.lng -
            last.lng
        ) <
        0.00000001
    ) {

        best.pop();

    }


    return best;

}


/* =========================================================
   IMPORTAR KML
   ========================================================= */

function importKMLFile(
    file
) {

    const reader =
        new FileReader();


    reader.onload =
        event => {

            try {

                const points =
                    extractKMLCoordinates(
                        event.target.result
                    );


                clearContours();


                removeMarkers();


                if (
                    state.polygon
                ) {

                    state.map.removeLayer(
                        state.polygon
                    );

                }


                state.points =
                    points.map(
                        point =>
                            L.latLng(
                                point.lat,
                                point.lng
                            )
                    );


                state.drawing =
                    false;


                state.closed =
                    true;


                renderMarkers();


                const bounds =
                    L.latLngBounds(
                        state.points
                    );


                state.map.fitBounds(
                    bounds,
                    {
                        padding:
                            [
                                40,
                                40
                            ]
                    }
                );


                status(
                    `KML importado com ${state.points.length} vértices.`
                );


                toast(
                    "Área importada com sucesso."
                );


            } catch (
                error
            ) {

                console.error(
                    error
                );


                toast(
                    error.message ||
                    "Não foi possível importar o KML."
                );

            }

        };


    reader.readAsText(
        file
    );

}


/* =========================================================
   INPUT DE KML
   ========================================================= */

if (
    $("kmlInput")
) {

    $("kmlInput")
        .addEventListener(
            "change",
            event => {

                const file =
                    event.target.files[0];


                if (
                    file
                ) {

                    importKMLFile(
                        file
                    );

                }


                event.target.value =
                    "";

            }
        );

}


/* =========================================================
   BOTÃO IMPORTAR KML
   ========================================================= */

if (
    $("importKmlBtn")
) {

    $("importKmlBtn")
        .addEventListener(
            "click",
            () => {

                if (
                    $("kmlInput")
                ) {

                    $("kmlInput")
                        .click();

                }

            }
        );

}


/* =========================================================
   BOTÃO EXPORTAR KML
   ========================================================= */

if (
    $("exportKmlBtn")
) {

    $("exportKmlBtn")
        .addEventListener(
            "click",
            exportKML
        );

}


/* =========================================================
   BOTÃO EXPORTAR DXF
   ========================================================= */

if (
    $("exportDxfBtn")
) {

    $("exportDxfBtn")
        .addEventListener(
            "click",
            exportDXF
        );

}


/* =========================================================
   BOTÃO EXPORTAR CSV
   ========================================================= */

if (
    $("exportCsvBtn")
) {

    $("exportCsvBtn")
        .addEventListener(
            "click",
            exportCSV
        );

}


/* =========================================================
   ATUALIZAR INFORMAÇÕES DO CURSOR
   ========================================================= */

state.map.on(
    "mousemove",
    event => {

        if (
            $("cursorLat")
        ) {

            $("cursorLat")
                .textContent =
                event.latlng.lat.toFixed(
                    6
                );

        }


        if (
            $("cursorLng")
        ) {

            $("cursorLng")
                .textContent =
                event.latlng.lng.toFixed(
                    6
                );

        }

    }
);


/* =========================================================
   BOTÃO SATÉLITE
   ========================================================= */

if (
    $("satelliteBtn")
) {

    $("satelliteBtn")
        .addEventListener(
            "click",
            () => {

                if (
                    !state.map.hasLayer(
                        satellite
                    )
                ) {

                    state.map.addLayer(
                        satellite
                    );

                }

            }
        );

}


/* =========================================================
   BOTÃO MAPA
   ========================================================= */

if (
    $("streetBtn")
) {

    $("streetBtn")
        .addEventListener(
            "click",
            () => {

                if (
                    !state.map.hasLayer(
                        streets
                    )
                ) {

                    state.map.addLayer(
                        streets
                    );

                }

            }
        );

}


/* =========================================================
   INSERIR VÉRTICE NO POLÍGONO
   ========================================================= */

function insertVertexAtClosestEdge(
    latlng
) {

    if (
        state.points.length <
        2
    ) {

        addPoint({
            latlng:
                latlng
        });

        return;

    }


    let bestIndex =
        0;

    let bestDistance =
        Infinity;


    for (
        let i = 0;
        i <
        state.points.length;
        i++
    ) {

        const a =
            state.points[i];


        const b =
            state.points[
                (
                    i + 1
                ) %
                state.points.length
            ];


        const distance =
            distancePointToSegment(
                latlng,
                a,
                b
            );


        if (
            distance <
            bestDistance
        ) {

            bestDistance =
                distance;

            bestIndex =
                i + 1;

        }

    }


    saveUndo();


    state.points.splice(
        bestIndex,
        0,
        latlng
    );


    renderMarkers();


    toast(
        "Vértice inserido."
    );

}


/* =========================================================
   DISTÂNCIA PONTO / SEGMENTO
   ========================================================= */

function distancePointToSegment(
    p,
    a,
    b
) {

    const meanLat =
        (
            p.lat +
            a.lat +
            b.lat
        ) /
        3;


    const scaleX =
        Math.cos(
            meanLat *
            Math.PI /
            180
        );


    const px =
        p.lng *
        scaleX;


    const py =
        p.lat;


    const ax =
        a.lng *
        scaleX;


    const ay =
        a.lat;


    const bx =
        b.lng *
        scaleX;


    const by =
        b.lat;


    const dx =
        bx - ax;


    const dy =
        by - ay;


    if (
        dx === 0 &&
        dy === 0
    ) {

        return Math.hypot(
            px - ax,
            py - ay
        );

    }


    const t =
        Math.max(
            0,
            Math.min(
                1,
                (
                    (
                        px -
                        ax
                    ) *
                    dx +
                    (
                        py -
                        ay
                    ) *
                    dy
                ) /
                (
                    dx * dx +
                    dy * dy
                )
            )
        );


    const x =
        ax +
        t *
        dx;


    const y =
        ay +
        t *
        dy;


    return Math.hypot(
        px - x,
        py - y
    );

}


/* =========================================================
   DUPLO CLIQUE PARA INSERIR VÉRTICE
   ========================================================= */

state.map.on(
    "dblclick",
    event => {

        if (
            state.closed &&
            state.points.length >=
            3
        ) {

            insertVertexAtClosestEdge(
                event.latlng
            );

        }

    }
);


/* =========================================================
   BOTÃO DE EXPORTAÇÃO GENÉRICO
   ========================================================= */

if (
    $("exportBtn")
) {

    $("exportBtn")
        .addEventListener(
            "click",
            () => {

                if (
                    state.contourData.length >
                    0
                ) {

                    exportKML();

                } else {

                    toast(
                        "Gere as curvas antes de exportar."
                    );

                }

            }
        );

}


/* =========================================================
   TABELA DE COTAS
   ========================================================= */

function buildElevationTable() {

    if (
        !state.contourData.length
    ) {

        return [];

    }


    const values =
        state.contourData.map(
            segment =>
                segment.elevation
        );


    return [
        ...new Set(
            values.map(
                value =>
                    Number(
                        value.toFixed(
                            2
                        )
                    )
            )
        )
    ]
        .sort(
            (
                a,
                b
            ) =>
                a - b
        );

}


/* =========================================================
   MOSTRAR TABELA DE COTAS
   ========================================================= */

function updateElevationList() {

    const element =
        $("elevationList");


    if (!element) {

        return;

    }


    const values =
        buildElevationTable();


    if (
        values.length ===
        0
    ) {

        element.innerHTML =
            "<span>Nenhuma curva gerada.</span>";

        return;

    }


    element.innerHTML =
        values
            .map(
                value =>
                    `<span class="elevation-chip">${value.toFixed(
                        2
                    )} m</span>`
            )
            .join("");

}


/* =========================================================
   ATUALIZAÇÃO AUTOMÁTICA DA TABELA
   ========================================================= */

const originalGenerateContours =
    generateContours;


/*
 * Não substituímos a função.
 * Apenas observamos o resultado através
 * de um intervalo curto.
 */

setInterval(
    () => {

        if (
            state.contourData.length >
            0
        ) {

            updateElevationList();

        }

    },
    1000
);


/* =========================================================
   GEOLOCALIZAÇÃO
   ========================================================= */

function locateUser() {

    if (
        !navigator.geolocation
    ) {

        toast(
            "Seu navegador não oferece geolocalização."
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


            state.map.setView(
                [
                    lat,
                    lng
                ],
                17
            );


            L.circleMarker(
                [
                    lat,
                    lng
                ],
                {

                    radius:
                        7,

                    color:
                        "#ffffff",

                    weight:
                        2,

                    fillColor:
                        "#176b45",

                    fillOpacity:
                        1

                }
            )
            .addTo(
                state.map
            )
            .bindPopup(
                "Sua localização"
            )
            .openPopup();


            status(
                "Localização encontrada."
            );

        },

        error => {

            console.warn(
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
                10000,

            maximumAge:
                30000

        }

    );

}


/* =========================================================
   BOTÃO LOCALIZAR
   ========================================================= */

if (
    $("locateBtn")
) {

    $("locateBtn")
        .addEventListener(
            "click",
            locateUser
        );

}


/* =========================================================
   VERIFICAR BIBLIOTECAS
   ========================================================= */

function checkLibraries() {

    const missing = [];


    if (
        typeof L ===
        "undefined"
    ) {

        missing.push(
            "Leaflet"
        );

    }


    if (
        typeof d3 ===
        "undefined"
    ) {

        missing.push(
            "D3 Contours"
        );

    }


    if (
        missing.length
    ) {

        console.error(
            "Bibliotecas ausentes:",
            missing
        );


        toast(
            `Bibliotecas não carregadas: ${missing.join(
                ", "
            )}`
        );


        return false;

    }


    return true;

}


/* =========================================================
   INICIALIZAÇÃO FINAL
   ========================================================= */

function initializeApplication() {

    if (
        !checkLibraries()
    ) {

        return;

    }


    state.map.invalidateSize();


    updateStats();


    status(
        'Pronto. Toque em "Nova área" para começar.'
    );


    console.log(
        "========================================"
    );


    console.log(
        "MVA GEO - CONTOUR MAP"
    );


    console.log(
        "Aplicação inicializada."
    );


    console.log(
        "========================================"
    );

}


/* =========================================================
   START
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeApplication
    );

} else {

    initializeApplication();

}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

if (
    "serviceWorker" in
    navigator
) {

    window.addEventListener(
        "load",
        () => {

            navigator.serviceWorker
                .register(
                    "./sw.js"
                )
                .then(
                    registration => {

                        console.log(
                            "Service Worker ativo:",
                            registration.scope
                        );

                    }
                )
                .catch(
                    error => {

                        console.warn(
                            "Service Worker não registrado:",
                            error
                        );

                    }
                );

        }
    );

}