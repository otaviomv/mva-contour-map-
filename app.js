"use strict";

/* =========================================================
   MVA GEO — CONTOUR MAP
   APP.JS — versão completa
   ========================================================= */

/* ---------------------------------------------------------
   ATALHO PARA ELEMENTOS
--------------------------------------------------------- */

const $ = (id) => document.getElementById(id);


/* ---------------------------------------------------------
   ESTADO DO APLICATIVO
--------------------------------------------------------- */

const state = {
  map: null,

  baseLayers: {
    satellite: null,
    streets: null
  },

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


/* ---------------------------------------------------------
   CONFIGURAÇÃO DO DEM
--------------------------------------------------------- */

const DEM_CONFIG = {
  url: "https://api.open-meteo.com/v1/elevation",

  batchSize: 100,

  maxGridColumns: 80,

  maxGridRows: 80,

  targetSpacingMeters: 60
};


/* =========================================================
   MAPA
========================================================= */

function initMap() {

  state.map = L.map("map", {
    center: [-29.6500, -50.7800],
    zoom: 13,
    zoomControl: true,
    preferCanvas: true,
    doubleClickZoom: false
  });


  /* SATÉLITE */

  state.baseLayers.satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/" +
    "World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: "Tiles © Esri"
    }
  );


  /* MAPA */

  state.baseLayers.streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  );


  state.baseLayers.satellite.addTo(state.map);


  L.control.layers(
    {
      "🛰️ Satélite": state.baseLayers.satellite,
      "🗺️ Mapa": state.baseLayers.streets
    },
    null,
    {
      collapsed: true
    }
  ).addTo(state.map);


  /* CLIQUE PARA DESENHAR */

  state.map.on("click", (event) => {

    if (!state.drawing) return;
    if (state.closed) return;

    addPoint(event.latlng);

  });


  /* DUPLO CLIQUE APÓS FECHAR */

  state.map.on("dblclick", (event) => {

    if (!state.closed) return;

    insertVertexAtClosestEdge(
      event.latlng
    );

  });


  setTimeout(() => {
    state.map.invalidateSize();
  }, 300);

}


/* =========================================================
   UTILIDADES
========================================================= */

function status(message) {

  const element = $("status");

  if (element) {
    element.textContent = message;
  }

}


function toast(message) {

  const old = document.querySelector(
    ".mva-toast"
  );

  if (old) old.remove();


  const element =
    document.createElement("div");

  element.className = "mva-toast";

  element.textContent = message;

  document.body.appendChild(element);


  setTimeout(() => {

    element.remove();

  }, 3000);

}


function loading(show, message) {

  const element = $("loading");

  const text = $("loadingText");

  if (!element) return;


  if (text) {
    text.textContent =
      message || "Processando...";
  }


  element.classList.toggle(
    "hidden",
    !show
  );

}


function numberBR(value, decimals = 2) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }


  return Number(value).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }
  );

}


function distanceMeters(a, b) {

  const R = 6371000;

  const lat1 =
    a.lat * Math.PI / 180;

  const lat2 =
    b.lat * Math.PI / 180;

  const dLat =
    (b.lat - a.lat) *
    Math.PI / 180;

  const dLng =
    (b.lng - a.lng) *
    Math.PI / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  return (
    2 *
    R *
    Math.atan2(
      Math.sqrt(h),
      Math.sqrt(1 - h)
    )
  );

}


/* =========================================================
   ÁREA
========================================================= */

function polygonAreaM2(points) {

  if (!points || points.length < 3) {
    return 0;
  }


  const lat0 =
    points.reduce(
      (sum, p) => sum + p.lat,
      0
    ) / points.length;


  const R = 6378137;

  const latFactor =
    Math.PI / 180 * R;

  const lngFactor =
    Math.PI / 180 *
    R *
    Math.cos(
      lat0 * Math.PI / 180
    );


  let area = 0;


  for (
    let i = 0;
    i < points.length;
    i++
  ) {

    const j =
      (i + 1) %
      points.length;


    const x1 =
      points[i].lng *
      lngFactor;

    const y1 =
      points[i].lat *
      latFactor;

    const x2 =
      points[j].lng *
      lngFactor;

    const y2 =
      points[j].lat *
      latFactor;


    area +=
      x1 * y2 -
      x2 * y1;

  }


  return Math.abs(area / 2);

}


function getBBox(points) {

  const lats =
    points.map(
      p => p.lat
    );

  const lngs =
    points.map(
      p => p.lng
    );


  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs)
  };

}


/* =========================================================
   PONTO DENTRO DO POLÍGONO
========================================================= */

function pointInPolygon(point, polygon) {

  let inside = false;

  const x = point.lng;
  const y = point.lat;


  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {

    const xi = polygon[i].lng;
    const yi = polygon[i].lat;

    const xj = polygon[j].lng;
    const yj = polygon[j].lat;


    const intersects =
      (
        yi > y
      ) !==
      (
        yj > y
      ) &&
      x <
      (
        (xj - xi) *
        (y - yi) /
        (yj - yi) +
        xi
      );


    if (intersects) {
      inside = !inside;
    }

  }


  return inside;

}


/* =========================================================
   ESTATÍSTICAS
========================================================= */

function updateStats() {

  if ($("vertexCount")) {

    $("vertexCount").textContent =
      state.points.length;

  }


  const areaHa =
    polygonAreaM2(
      state.points
    ) / 10000;


  if ($("areaValue")) {

    $("areaValue").textContent =
      `${numberBR(areaHa, 2)} ha`;

  }


  if (
    state.dem &&
    state.dem.elevations
  ) {

    const valid =
      state.dem.elevations.filter(
        Number.isFinite
      );


    if (valid.length) {

      const min =
        Math.min(...valid);

      const max =
        Math.max(...valid);


      if ($("minElevation")) {

        $("minElevation").textContent =
          `${numberBR(min, 1)} m`;

      }


      if ($("maxElevation")) {

        $("maxElevation").textContent =
          `${numberBR(max, 1)} m`;

      }

    }

  } else {

    if ($("minElevation")) {
      $("minElevation").textContent = "—";
    }

    if ($("maxElevation")) {
      $("maxElevation").textContent = "—";
    }

  }

}


/* =========================================================
   ÍCONE DOS VÉRTICES
========================================================= */

function vertexIcon(index) {

  return L.divIcon({
    className: "",
    html:
      `<div class="vertex-marker"
            title="Vértice ${index + 1}">
       </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

}


/* =========================================================
   RENDERIZA MARCADORES
========================================================= */

function renderMarkers() {

  state.markers.forEach(
    marker => marker.remove()
  );

  state.markers = [];


  state.points.forEach(
    (point, index) => {

      const marker =
        L.marker(
          [point.lat, point.lng],
          {
            draggable: true,
            icon: vertexIcon(index),
            zIndexOffset: 1000
          }
        );


      marker.on(
        "dragstart",
        () => {

          state.undoStack.push(
            clonePoints()
          );

        }
      );


      marker.on(
        "drag",
        (event) => {

          const p =
            event.target.getLatLng();


          state.points[index] = {
            lat: p.lat,
            lng: p.lng
          };


          redrawPolygon();

          updateStats();

        }
      );


      marker.on(
        "dragend",
        () => {

          clearContours();

          state.dem = null;

          status(
            "Vértice alterado. Gere as curvas novamente."
          );

        }
      );


      marker.addTo(
        state.map
      );


      state.markers.push(
        marker
      );

    }
  );

}


/* =========================================================
   CLONAR PONTOS
========================================================= */

function clonePoints() {

  return state.points.map(
    p => ({
      lat: p.lat,
      lng: p.lng
    })
  );

}


/* =========================================================
   POLÍGONO
========================================================= */

function redrawPolygon() {

  if (state.polygon) {

    state.polygon.remove();

    state.polygon = null;

  }


  if (state.points.length < 2) {
    return;
  }


  const latlngs =
    state.points.map(
      p => [
        p.lat,
        p.lng
      ]
    );


  if (
    state.closed &&
    latlngs.length >= 3
  ) {

    latlngs.push(
      latlngs[0]
    );

  }


  state.polygon =
    L.polygon(
      latlngs,
      {
        color: "#147a4b",
        weight: 3,
        fillColor: "#147a4b",
        fillOpacity:
          state.closed
            ? 0.12
            : 0.04,
        className: "area-polygon"
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

  state.drawing = true;
  state.closed = false;

  state.points = [];
  state.undoStack = [];

  state.dem = null;


  if (state.polygon) {

    state.polygon.remove();

    state.polygon = null;

  }


  renderMarkers();
  updateStats();


  status(
    "Toque no mapa para adicionar os vértices."
  );


  toast(
    "Modo de desenho ativado."
  );

}


/* =========================================================
   ADICIONAR PONTO
========================================================= */

function addPoint(latlng) {

  if (
    !state.drawing ||
    state.closed
  ) {
    return;
  }


  if (state.points.length) {

    const last =
      state.points[
        state.points.length - 1
      ];


    if (
      distanceMeters(
        last,
        latlng
      ) < 0.5
    ) {

      return;

    }

  }


  state.undoStack.push(
    clonePoints()
  );


  state.points.push({
    lat: latlng.lat,
    lng: latlng.lng
  });


  renderMarkers();

  redrawPolygon();

  updateStats();

  clearContours();


  status(
    `${state.points.length} vértices adicionados.`
  );

}


/* =========================================================
   DESFAZER
========================================================= */

function undo() {

  if (!state.undoStack.length) {

    toast(
      "Nada para desfazer."
    );

    return;

  }


  state.points =
    state.undoStack.pop();


  state.closed =
    state.points.length >= 3 &&
    state.closed;


  renderMarkers();

  redrawPolygon();

  clearContours();

  state.dem = null;

  updateStats();


  status(
    "Última alteração desfeita."
  );

}


/* =========================================================
   FECHAR
========================================================= */

function closeArea() {

  if (
    state.points.length < 3
  ) {

    toast(
      "Adicione pelo menos 3 vértices."
    );

    return;

  }


  state.closed = true;
  state.drawing = false;


  redrawPolygon();


  status(
    `Área fechada com ${state.points.length} vértices.`
  );

}


/* =========================================================
   LIMPAR CURVAS
========================================================= */

function clearContours() {

  state.contourLayers.forEach(
    layer => {

      if (layer) {
        layer.remove();
      }

    }
  );


  state.contourLayers = [];
  state.contourData = [];


  if ($("elevationList")) {
    $("elevationList").textContent = "—";
  }


  if ($("elevationPanel")) {
    $("elevationPanel")
      .classList.remove("active");
  }


  if ($("demSource")) {
    $("demSource").textContent = "—";
  }

}


/* =========================================================
   LIMPAR TUDO
========================================================= */

function clearAll() {

  clearContours();


  state.markers.forEach(
    marker => marker.remove()
  );

  state.markers = [];


  if (state.polygon) {

    state.polygon.remove();

    state.polygon = null;

  }


  state.points = [];

  state.undoStack = [];

  state.closed = false;

  state.drawing = false;

  state.dem = null;


  updateStats();


  status(
    'Pronto. Toque em "Nova área" para começar.'
  );

}


/* =========================================================
   TAMANHO DA BBOX
========================================================= */

function bboxSize(bbox) {

  const centerLat =
    (
      bbox.minLat +
      bbox.maxLat
    ) / 2;


  const width =
    distanceMeters(
      {
        lat: centerLat,
        lng: bbox.minLng
      },
      {
        lat: centerLat,
        lng: bbox.maxLng
      }
    );


  const height =
    distanceMeters(
      {
        lat: bbox.minLat,
        lng: bbox.minLng
      },
      {
        lat: bbox.maxLat,
        lng: bbox.minLng
      }
    );


  return {
    width,
    height
  };

}


/* =========================================================
   GRID DE AMOSTRAGEM
========================================================= */

function createSamplingGrid(points) {

  const bbox =
    getBBox(points);

  const size =
    bboxSize(bbox);


  let columns =
    Math.ceil(
      size.width /
      DEM_CONFIG.targetSpacingMeters
    ) + 1;


  let rows =
    Math.ceil(
      size.height /
      DEM_CONFIG.targetSpacingMeters
    ) + 1;


  columns =
    Math.max(
      8,
      Math.min(
        DEM_CONFIG.maxGridColumns,
        columns
      )
    );


  rows =
    Math.max(
      8,
      Math.min(
        DEM_CONFIG.maxGridRows,
        rows
      )
    );


  const coordinates = [];


  for (
    let row = 0;
    row < rows;
    row++
  ) {

    const lat =
      bbox.minLat +
      (
        (bbox.maxLat - bbox.minLat) *
        row /
        (rows - 1)
      );


    for (
      let col = 0;
      col < columns;
      col++
    ) {

      const lng =
        bbox.minLng +
        (
          (bbox.maxLng - bbox.minLng) *
          col /
          (columns - 1)
        );


      coordinates.push({
        lat,
        lng
      });

    }

  }


  return {
    rows,
    columns,
    bbox,
    coordinates
  };

}


/* =========================================================
   CONSULTA ELEVAÇÃO
========================================================= */

async function requestElevations(
  coordinates
) {

  const elevations =
    new Array(
      coordinates.length
    ).fill(NaN);


  for (
    let start = 0;
    start < coordinates.length;
    start += DEM_CONFIG.batchSize
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
          p => p.lat.toFixed(6)
        )
        .join(",");


    const longitude =
      batch
        .map(
          p => p.lng.toFixed(6)
        )
        .join(",");


    const url =
      `${DEM_CONFIG.url}` +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}`;


    const response =
      await fetch(
        url,
        {
          method: "GET",
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        `Erro na API de elevação: HTTP ${response.status}`
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
        "A API não retornou elevações."
      );

    }


    data.elevation.forEach(
      (value, index) => {

        elevations[
          start + index
        ] = Number(value);

      }
    );


    loading(
      true,
      `Obtendo terreno ${Math.min(
        start + batch.length,
        coordinates.length
      )}/${coordinates.length}`
    );

  }


  return elevations;

}


/* =========================================================
   CONSTRUIR DEM
========================================================= */

async function buildDEM(points) {

  const grid =
    createSamplingGrid(points);


  loading(
    true,
    "Preparando terreno..."
  );


  const elevations =
    await requestElevations(
      grid.coordinates
    );


  const valid =
    elevations.filter(
      Number.isFinite
    );


  if (!valid.length) {

    throw new Error(
      "Não foi possível obter elevações."
    );

  }


  return {
    rows: grid.rows,
    columns: grid.columns,
    bbox: grid.bbox,
    coordinates: grid.coordinates,
    elevations
  };

}


/* =========================================================
   CONVERTER GEO → GRID
========================================================= */

function geoToGrid(
  lat,
  lng,
  bbox,
  rows,
  columns
) {

  const x =
    (
      (lng - bbox.minLng) /
      (
        bbox.maxLng -
        bbox.minLng
      )
    ) *
    (columns - 1);


  const y =
    (
      (lat - bbox.minLat) /
      (
        bbox.maxLat -
        bbox.minLat
      )
    ) *
    (rows - 1);


  return {
    x,
    y
  };

}


/* =========================================================
   CONVERTER GRID → GEO
========================================================= */

function gridToGeo(
  x,
  y,
  bbox,
  rows,
  columns
) {

  const lng =
    bbox.minLng +
    (
      x /
      (columns - 1)
    ) *
    (
      bbox.maxLng -
      bbox.minLng
    );


  const lat =
    bbox.minLat +
    (
      y /
      (rows - 1)
    ) *
    (
      bbox.maxLat -
      bbox.minLat
    );


  return {
    lat,
    lng
  };

}


/* =========================================================
   INTERPOLAÇÃO DE PONTO
========================================================= */

function interpolate(
  a,
  b,
  value
) {

  if (
    !Number.isFinite(a.value) ||
    !Number.isFinite(b.value)
  ) {

    return null;

  }


  const denominator =
    b.value - a.value;


  if (
    Math.abs(denominator) <
    0.0000001
  ) {

    return null;

  }


  const t =
    (
      value - a.value
    ) /
    denominator;


  if (
    t < 0 ||
    t > 1
  ) {

    return null;

  }


  return {
    x:
      a.x +
      t *
      (b.x - a.x),

    y:
      a.y +
      t *
      (b.y - a.y)
  };

}


/* =========================================================
   MARCHING SQUARES
========================================================= */

function marchingSquares(
  dem,
  level
) {

  const segments = [];


  const rows =
    dem.rows;

  const cols =
    dem.columns;


  function getValue(row, col) {

    return dem.elevations[
      row * cols + col
    ];

  }


  for (
    let row = 0;
    row < rows - 1;
    row++
  ) {

    for (
      let col = 0;
      col < cols - 1;
      col++
    ) {

      const v0 =
        getValue(row, col);

      const v1 =
        getValue(row, col + 1);

      const v2 =
        getValue(row + 1, col + 1);

      const v3 =
        getValue(row + 1, col);


      if (
        !Number.isFinite(v0) ||
        !Number.isFinite(v1) ||
        !Number.isFinite(v2) ||
        !Number.isFinite(v3)
      ) {

        continue;

      }


      const x = col;
      const y = row;


      const p0 = {
        x,
        y,
        value: v0
      };

      const p1 = {
        x: x + 1,
        y,
        value: v1
      };

      const p2 = {
        x: x + 1,
        y: y + 1,
        value: v2
      };

      const p3 = {
        x,
        y: y + 1,
        value: v3
      };


      let code = 0;


      if (v0 >= level) code |= 1;
      if (v1 >= level) code |= 2;
      if (v2 >= level) code |= 4;
      if (v3 >= level) code |= 8;


      if (
        code === 0 ||
        code === 15
      ) {

        continue;

      }


      const e0 =
        interpolate(
          p0,
          p1,
          level
        );

      const e1 =
        interpolate(
          p1,
          p2,
          level
        );

      const e2 =
        interpolate(
          p2,
          p3,
          level
        );

      const e3 =
        interpolate(
          p3,
          p0,
          level
        );


      const add =
        (a, b) => {

          if (a && b) {

            segments.push([
              [a.x, a.y],
              [b.x, b.y]
            ]);

          }

        };


      switch (code) {

        case 1:
        case 14:
          add(e3, e0);
          break;

        case 2:
        case 13:
          add(e0, e1);
          break;

        case 3:
        case 12:
          add(e3, e1);
          break;

        case 4:
        case 11:
          add(e1, e2);
          break;

        case 5:
          add(e3, e2);
          break;

        case 6:
        case 9:
          add(e0, e2);
          break;

        case 7:
        case 8:
          add(e3, e2);
          break;

        case 10:
          add(e3, e0);
          add(e1, e2);
          break;

      }

    }

  }


  return segments;

}


/* =========================================================
   SEGMENTO DENTRO DO POLÍGONO
========================================================= */

function clipSegmentToPolygon(
  segment,
  polygon
) {

  const a = {
    x: segment[0][0],
    y: segment[0][1]
  };

  const b = {
    x: segment[1][0],
    y: segment[1][1]
  };


  /*
   * Para manter o código robusto em áreas
   * côncavas, dividimos o segmento em pequenos
   * trechos e mantemos apenas os que estão dentro.
   */

  const pieces = [];

  const steps = 20;

  let current = null;


  for (
    let i = 0;
    i <= steps;
    i++
  ) {

    const t =
      i / steps;


    const p = {
      x:
        a.x +
        t * (b.x - a.x),

      y:
        a.y +
        t * (b.y - a.y)
    };


    const inside =
      pointInGridPolygon(
        p,
        polygon
      );


    if (inside && !current) {

      current = p;

    }


    if (
      (!inside || i === steps) &&
      current
    ) {

      const end =
        inside
          ? p
          : {
              x:
                a.x +
                (
                  (i - 1) /
                  steps
                ) *
                (b.x - a.x),

              y:
                a.y +
                (
                  (i - 1) /
                  steps
                ) *
                (b.y - a.y)
            };


      if (
        Math.hypot(
          end.x - current.x,
          end.y - current.y
        ) > 0.0001
      ) {

        pieces.push([
          [current.x, current.y],
          [end.x, end.y]
        ]);

      }


      current = null;

    }

  }


  return pieces;

}


/* =========================================================
   PONTO DENTRO DO POLÍGONO EM GRID
========================================================= */

function pointInGridPolygon(
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


    const intersects =
      (
        yi > point.y
      ) !==
      (
        yj > point.y
      ) &&
      point.x <
      (
        (xj - xi) *
        (point.y - yi) /
        (yj - yi) +
        xi
      );


    if (intersects) {
      inside = !inside;
    }

  }


  return inside;

}


/* =========================================================
   CONVERTER SEGMENTOS PARA LAT/LNG
========================================================= */

function segmentToLatLng(
  segment,
  dem
) {

  const a =
    gridToGeo(
      segment[0][0],
      segment[0][1],
      dem.bbox,
      dem.rows,
      dem.columns
    );


  const b =
    gridToGeo(
      segment[1][0],
      segment[1][1],
      dem.bbox,
      dem.rows,
      dem.columns
    );


  return [
    [a.lat, a.lng],
    [b.lat, b.lng]
  ];

}


/* =========================================================
   CURVAS
========================================================= */

function isMajorContour(
  elevation,
  interval
) {

  /*
   * A cada 5 intervalos é curva principal.
   */

  const index =
    Math.round(
      elevation / interval
    );


  return (
    Math.abs(index % 5) === 0
  );

}


/* =========================================================
   DESENHAR SEGMENTO
========================================================= */

function drawContourSegment(
  segment,
  elevation,
  interval
) {

  const major =
    isMajorContour(
      elevation,
      interval
    );


  const line =
    L.polyline(
      segment,
      {
        color:
          major
            ? "#101827"
            : "#26384d",

        weight:
          major
            ? 3.2
            : 1.7,

        opacity: 0.95,

        interactive: true
      }
    );


  line.bindTooltip(
    `${numberBR(elevation, 2)} m`,
    {
      sticky: true,
      className:
        "contour-tooltip"
    }
  );


  line.addTo(
    state.map
  );


  state.contourLayers.push(
    line
  );


  state.contourData.push({
    elevation,
    points: segment,
    major
  });

}


/* =========================================================
   GERAR CURVAS
========================================================= */

function generateContoursFromDEM(
  dem
) {

  const interval =
    getContourInterval();


  const values =
    dem.elevations.filter(
      Number.isFinite
    );


  if (!values.length) {

    throw new Error(
      "Não há dados de elevação válidos."
    );

  }


  const min =
    Math.min(...values);

  const max =
    Math.max(...values);


  const start =
    Math.ceil(
      min / interval
    ) * interval;


  const polygonGrid =
    state.points.map(
      point =>
        geoToGrid(
          point.lat,
          point.lng,
          dem.bbox,
          dem.rows,
          dem.columns
        )
    );


  let total = 0;


  for (
    let level = start;
    level <= max;
    level += interval
  ) {

    const segments =
      marchingSquares(
        dem,
        level
      );


    for (
      const segment of segments
    ) {

      const clipped =
        clipSegmentToPolygon(
          segment,
          polygonGrid
        );


      if (!clipped) {
        continue;
      }


      for (
        const piece of clipped
      ) {

        const latlng =
          segmentToLatLng(
            piece,
            dem
          );


        drawContourSegment(
          latlng,
          level,
          interval
        );


        total++;

      }

    }

  }


  /*
   * Modo somente curvas principais.
   */

  const mode =
    $("curveMode")?.value ||
    "all";


  if (mode === "major") {

    state.contourLayers
      .forEach(
        (layer, index) => {

          const data =
            state.contourData[index];

          if (
            data &&
            !data.major
          ) {

            layer.remove();

          }

        }
      );

  }


  return {
    count: total,
    min,
    max
  };

}


/* =========================================================
   GERAR DEM + CURVAS
========================================================= */

async function generateContours() {

  if (state.processing) {
    return;
  }


  try {

    validateArea();


    state.processing = true;


    clearContours();


    loading(
      true,
      "Preparando análise..."
    );


    status(
      "Obtendo dados de elevação..."
    );


    state.dem =
      await buildDEM(
        state.points
      );


    updateStats();


    loading(
      true,
      "Calculando curvas de nível..."
    );


    const result =
      generateContoursFromDEM(
        state.dem
      );


    updateStats();


    if ($("demSource")) {

      $("demSource").textContent =
        "Copernicus GLO-90";

    }


    if (result.count === 0) {

      status(
        "Nenhuma curva foi encontrada para a equidistância escolhida."
      );

      toast(
        "Nenhuma curva encontrada."
      );

    } else {

      status(
        `${result.count} segmentos de curva gerados.`
      );


      toast(
        `${result.count} segmentos gerados.`
      );

    }


  } catch (error) {

    console.error(error);


    status(
      "Erro durante a geração."
    );


    toast(
      error.message ||
      "Não foi possível gerar as curvas."
    );


  } finally {

    state.processing = false;

    loading(false);

  }

}


/* =========================================================
   VALIDAÇÃO
========================================================= */

function validateArea() {

  if (
    state.points.length < 3
  ) {

    throw new Error(
      "A área precisa ter pelo menos 3 vértices."
    );

  }


  if (!state.closed) {

    throw new Error(
      'Feche a área antes de gerar as curvas.'
    );

  }


  const area =
    polygonAreaM2(
      state.points
    );


  if (
    !Number.isFinite(area) ||
    area <= 0
  ) {

    throw new Error(
      "A área desenhada é inválida."
    );

  }

}


/* =========================================================
   INSERIR VÉRTICE NA BORDA
========================================================= */

function closestPointOnSegment(
  p,
  a,
  b
) {

  const dx =
    b.x - a.x;

  const dy =
    b.y - a.y;


  if (
    dx === 0 &&
    dy === 0
  ) {

    return {
      x: a.x,
      y: a.y,
      t: 0
    };

  }


  const t =
    (
      (p.x - a.x) * dx +
      (p.y - a.y) * dy
    ) /
    (
      dx * dx +
      dy * dy
    );


  const clamped =
    Math.max(
      0,
      Math.min(
        1,
        t
      )
    );


  return {
    x:
      a.x +
      clamped * dx,

    y:
      a.y +
      clamped * dy,

    t:
      clamped
  };

}


function insertVertexAtClosestEdge(
  latlng
) {

  if (
    !state.closed ||
    state.points.length < 3
  ) {
    return;
  }


  const refLat =
    latlng.lat;


  const R =
    6378137;


  const scaleX =
    Math.PI / 180 *
    R *
    Math.cos(
      refLat *
      Math.PI / 180
    );


  const scaleY =
    Math.PI / 180 *
    R;


  const p = {
    x:
      latlng.lng *
      scaleX,

    y:
      latlng.lat *
      scaleY
  };


  let best = null;


  for (
    let i = 0;
    i < state.points.length;
    i++
  ) {

    const j =
      (
        i + 1
      ) %
      state.points.length;


    const a = {
      x:
        state.points[i].lng *
        scaleX,

      y:
        state.points[i].lat *
        scaleY
    };


    const b = {
      x:
        state.points[j].lng *
        scaleX,

      y:
        state.points[j].lat *
        scaleY
    };


    const closest =
      closestPointOnSegment(
        p,
        a,
        b
      );


    const distance =
      Math.hypot(
        p.x - closest.x,
        p.y - closest.y
      );


    if (
      !best ||
      distance < best.distance
    ) {

      best = {
        index: i,
        distance,
        point: closest
      };

    }

  }


  if (!best) {
    return;
  }


  const newPoint = {
    lat:
      best.point.y /
      scaleY,

    lng:
      best.point.x /
      scaleX
  };


  state.undoStack.push(
    clonePoints()
  );


  state.points.splice(
    best.index + 1,
    0,
    newPoint
  );


  renderMarkers();

  redrawPolygon();

  clearContours();

  state.dem = null;

  updateStats();


  status(
    "Novo vértice inserido na borda."
  );

}


/* =========================================================
   KML
========================================================= */

function escapeXML(value) {

  return String(value)
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


function downloadBlob(
  content,
  filename,
  type
) {

  const blob =
    new Blob(
      [content],
      { type }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      "a"
    );


  link.href = url;

  link.download = filename;

  document.body.appendChild(
    link
  );


  link.click();

  link.remove();


  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );

}


function fileDate() {

  const now =
    new Date();


  const pad =
    value =>
      String(value)
        .padStart(2, "0");


  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "_" +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );

}


/* =========================================================
   EXPORTAR KML
========================================================= */

function exportKML() {

  if (
    state.points.length < 3
  ) {

    toast(
      "Não há uma área para exportar."
    );

    return;

  }


  let xml =
`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>MVA Geo - Contour Map</name>
`;


  /* ÁREA */

  const areaCoordinates =
    state.points
      .map(
        p =>
          `${p.lng},${p.lat},0`
      )
      .join(" ");


  const closedCoordinates =
    areaCoordinates +
    ` ${state.points[0].lng},${state.points[0].lat},0`;


  xml +=
`
<Placemark>
<name>Área</name>
<Style>
<LineStyle>
<color>ff147a4b</color>
<width>4</width>
</LineStyle>
<PolyStyle>
<color>33147a4b</color>
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


  /* CURVAS */

  state.contourData.forEach(
    contour => {

      const coordinates =
        contour.points
          .map(
            p =>
              `${p[1]},${p[0]},${contour.elevation}`
          )
          .join(" ");


      xml +=
`
<Placemark>
<name>${escapeXML(
  numberBR(
    contour.elevation,
    2
  ) +
  " m"
)}</name>

<ExtendedData>
<Data name="elevation">
<value>${contour.elevation}</value>
</Data>
<Data name="source">
<value>Copernicus GLO-90</value>
</Data>
</ExtendedData>

<Style>
<LineStyle>
<color>${
  contour.major
    ? "ff101827"
    : "ff26384d"
}</color>
<width>${
  contour.major
    ? "3"
    : "1.5"
}</width>
</LineStyle>
</Style>

<LineString>
<altitudeMode>absolute</altitudeMode>
<coordinates>
${coordinates}
</coordinates>
</LineString>
</Placemark>
`;

    }
  );


  xml +=
`
</Document>
</kml>`;


  downloadBlob(
    xml,
    `MVA_Contour_${fileDate()}.kml`,
    "application/vnd.google-earth.kml+xml"
  );


  toast(
    "KML exportado."
  );

}


/* =========================================================
   PROJEÇÃO LOCAL PARA DXF
========================================================= */

function localProjection() {

  const origin =
    state.points[0];


  const R =
    6378137;


  const cosLat =
    Math.cos(
      origin.lat *
      Math.PI / 180
    );


  const k =
    Math.PI / 180 *
    R;


  return function(point) {

    return {
      x:
        (
          point.lng -
          origin.lng
        ) *
        k *
        cosLat,

      y:
        (
          point.lat -
          origin.lat
        ) *
        k,

      z:
        point.z || 0
    };

  };

}


/* =========================================================
   DXF
========================================================= */

function buildDXF() {

  const project =
    localProjection();


  let dxf =
`0
SECTION
2
HEADER
9
$ACADVER
1
AC1015
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
4
0
LAYER
2
LIMITE
70
0
62
3
6
CONTINUOUS
0
LAYER
2
CURVAS
70
0
62
7
6
CONTINUOUS
0
LAYER
2
CURVAS_MESTRAS
70
0
62
1
6
CONTINUOUS
0
LAYER
2
PONTOS
70
0
62
2
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
`;


  /* -------------------------------------------------------
     LIMITE
  ------------------------------------------------------- */

  for (
    let i = 0;
    i < state.points.length;
    i++
  ) {

    const j =
      (
        i + 1
      ) %
      state.points.length;


    const a =
      project(
        state.points[i]
      );


    const b =
      project(
        state.points[j]
      );


    dxf +=
`
0
LINE
8
LIMITE
10
${a.x}
20
${a.y}
30
0
11
${b.x}
21
${b.y}
31
0
`;

  }


  /* -------------------------------------------------------
     CURVAS
  ------------------------------------------------------- */

  state.contourData.forEach(
    contour => {

      const layer =
        contour.major
          ? "CURVAS_MESTRAS"
          : "CURVAS";


      const a =
        project({
          lat:
            contour.points[0][0],

          lng:
            contour.points[0][1],

          z:
            contour.elevation
        });


      const b =
        project({
          lat:
            contour.points[1][0],

          lng:
            contour.points[1][1],

          z:
            contour.elevation
        });


      dxf +=
`
0
3DPOLY
8
${layer}
66
1
70
8
`;

      dxf +=
`
0
VERTEX
8
${layer}
10
${a.x}
20
${a.y}
30
${contour.elevation}
70
32
`;

      dxf +=
`
0
VERTEX
8
${layer}
10
${b.x}
20
${b.y}
30
${contour.elevation}
70
32
`;

      dxf +=
`
0
SEQEND
8
${layer}
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


function exportDXF() {

  if (
    state.points.length < 3
  ) {

    toast(
      "Não há área para exportar."
    );

    return;

  }


  if (
    !state.contourData.length
  ) {

    toast(
      "Gere as curvas antes de exportar o DXF."
    );

    return;

  }


  const dxf =
    buildDXF();


  downloadBlob(
    dxf,
    `MVA_Contour_${fileDate()}.dxf`,
    "application/dxf"
  );


  toast(
    "DXF exportado."
  );

}


/* =========================================================
   CSV
========================================================= */

function exportCSV() {

  if (
    state.points.length < 3
  ) {

    toast(
      "Não há área para exportar."
    );

    return;

  }


  let csv =
    "Ponto;Latitude;Longitude\n";


  state.points.forEach(
    (point, index) => {

      csv +=
        `${index + 1};` +
        `${point.lat.toFixed(8)};` +
        `${point.lng.toFixed(8)}\n`;

    }
  );


  downloadBlob(
    "\uFEFF" + csv,
    `MVA_Contour_Pontos_${fileDate()}.csv`,
    "text/csv;charset=utf-8"
  );


  toast(
    "CSV exportado."
  );

}


/* =========================================================
   IMPORTAR KML
========================================================= */

function parseKMLCoordinates(text) {

  const matches =
    [
      ...text.matchAll(
        /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi
      )
    ];


  if (!matches.length) {

    throw new Error(
      "Nenhum bloco de coordenadas encontrado no KML."
    );

  }


  let largest = "";


  matches.forEach(
    match => {

      if (
        match[1].length >
        largest.length
      ) {

        largest = match[1];

      }

    }
  );


  const points =
    largest
      .trim()
      .split(/\s+/)
      .map(
        item => {

          const values =
            item.split(",");


          return {
            lng:
              Number(values[0]),

            lat:
              Number(values[1])
          };

        }
      )
      .filter(
        p =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng)
      );


  if (
    points.length >= 2 &&
    distanceMeters(
      points[0],
      points[points.length - 1]
    ) < 2
  ) {

    points.pop();

  }


  return points;

}


async function importKMLFile(file) {

  const text =
    await file.text();


  const points =
    parseKMLCoordinates(
      text
    );


  if (
    points.length < 3
  ) {

    throw new Error(
      "O KML não possui uma área com pelo menos 3 pontos."
    );

  }


  clearAll();


  state.points =
    points;


  state.closed = true;

  state.drawing = false;


  renderMarkers();

  redrawPolygon();

  updateStats();


  state.map.fitBounds(
    state.polygon.getBounds(),
    {
      padding: [30, 30]
    }
  );


  status(
    `KML importado com ${points.length} vértices.`
  );


  toast(
    "KML importado."
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
      "Seu navegador não oferece geolocalização."
    );

    return;

  }


  loading(
    true,
    "Obtendo sua posição..."
  );


  navigator.geolocation.getCurrentPosition(

    position => {

      const lat =
        position.coords.latitude;

      const lng =
        position.coords.longitude;


      state.map.setView(
        [lat, lng],
        17
      );


      L.circleMarker(
        [lat, lng],
        {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#147a4b",
          fillOpacity: 1
        }
      )
      .addTo(
        state.map
      )
      .bindPopup(
        "Sua posição"
      )
      .openPopup();


      loading(false);


      toast(
        "Posição encontrada."
      );

    },

    error => {

      loading(false);


      let message =
        "Não foi possível obter sua posição.";


      if (
        error.code ===
        error.PERMISSION_DENIED
      ) {

        message =
          "Permissão de localização negada.";

      }


      toast(message);

    },

    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000
    }

  );

}


/* =========================================================
   CONFIGURAÇÕES
========================================================= */

function toggleSettings() {

  const panel =
    $("settingsPanel");


  if (!panel) return;


  panel.classList.toggle(
    "hidden"
  );


  setTimeout(
    () =>
      state.map.invalidateSize(),
    100
  );

}


/* =========================================================
   CURSOR
========================================================= */

function updateCursor(latlng) {

  /*
   * Não cria painel adicional no celular.
   * Apenas mantém os dados disponíveis no console.
   */

  state.cursor =
    latlng;

}


/* =========================================================
   BOTÕES DE SATÉLITE / MAPA
========================================================= */

function showSatellite() {

  if (
    !state.map ||
    !state.baseLayers.satellite
  ) {
    return;
  }


  if (
    state.map.hasLayer(
      state.baseLayers.streets
    )
  ) {

    state.map.removeLayer(
      state.baseLayers.streets
    );

  }


  state.baseLayers.satellite.addTo(
    state.map
  );

}


function showStreets() {

  if (
    !state.map ||
    !state.baseLayers.streets
  ) {
    return;
  }


  if (
    state.map.hasLayer(
      state.baseLayers.satellite
    )
  ) {

    state.map.removeLayer(
      state.baseLayers.satellite
    );

  }


  state.baseLayers.streets.addTo(
    state.map
  );

}


/* =========================================================
   EVENTOS
========================================================= */

function setupEvents() {

  $("newArea")?.addEventListener(
    "click",
    newArea
  );


  $("undoBtn")?.addEventListener(
    "click",
    undo
  );


  $("closeBtn")?.addEventListener(
    "click",
    closeArea
  );


  $("generateBtn")?.addEventListener(
    "click",
    generateContours
  );


  $("clearBtn")?.addEventListener(
    "click",
    clearAll
  );


  $("settingsBtn")?.addEventListener(
    "click",
    toggleSettings
  );


  $("locateBtn")?.addEventListener(
    "click",
    locateUser
  );


  $("exportKmlBtn")?.addEventListener(
    "click",
    exportKML
  );


  $("exportDxfBtn")?.addEventListener(
    "click",
    exportDXF
  );


  $("exportCsvBtn")?.addEventListener(
    "click",
    exportCSV
  );


  $("importKmlBtn")?.addEventListener(
    "click",
    () => {

      $("kmlInput")?.click();

    }
  );


  $("kmlInput")?.addEventListener(
    "change",
    async event => {

      const file =
        event.target.files?.[0];


      if (!file) {
        return;
      }


      try {

        loading(
          true,
          "Importando KML..."
        );


        await importKMLFile(
          file
        );

      } catch (error) {

        console.error(error);


        toast(
          error.message ||
          "Erro ao importar KML."
        );

      } finally {

        loading(false);

        event.target.value = "";

      }

    }
  );


  /*
   * ESC fecha configurações.
   */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {

        $("settingsPanel")
          ?.classList.add(
            "hidden"
          );

      }


      /*
       * CTRL/CMD + Z
       */

      if (
        (
          event.ctrlKey ||
          event.metaKey
        ) &&
        event.key.toLowerCase() === "z"
      ) {

        event.preventDefault();

        undo();

      }

    }
  );


  /*
   * Recalcula mapa após redimensionamento.
   */

  window.addEventListener(
    "resize",
    () => {

      setTimeout(
        () =>
          state.map?.invalidateSize(),
        100
      );

    }
  );


  /*
   * Atualização da curva quando muda
   * equidistância depois de já ter gerado.
   */

  $("interval")?.addEventListener(
    "change",
    () => {

      if (
        state.dem &&
        state.closed &&
        !state.processing
      ) {

        generateContours();

      }

    }
  );


  $("curveMode")?.addEventListener(
    "change",
    () => {

      if (
        state.dem &&
        state.closed &&
        !state.processing
      ) {

        generateContours();

      }

    }
  );

}


/* =========================================================
   VERIFICAÇÕES
========================================================= */

function checkLibraries() {

  if (
    typeof L === "undefined"
  ) {

    throw new Error(
      "Leaflet não foi carregado."
    );

  }


  if (
    typeof d3 === "undefined"
  ) {

    /*
     * O código atual usa marching squares
     * próprio, então D3 não é obrigatório.
     */

    console.warn(
      "D3 não foi carregado. O aplicativo continuará usando o cálculo próprio."
    );

  }

}


/* =========================================================
   SERVICE WORKER
========================================================= */

function registerServiceWorker() {

  if (
    "serviceWorker" in navigator
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
                "MVA Geo Service Worker ativo:",
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

}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

function initApp() {

  try {

    checkLibraries();

    initMap();

    setupEvents();

    updateStats();

    registerServiceWorker();


    status(
      'Pronto. Toque em "Nova área" para começar.'
    );


    console.log(
      "MVA Geo — Contour Map iniciado."
    );


  } catch (error) {

    console.error(
      error
    );


    status(
      "Erro ao iniciar o aplicativo."
    );


    toast(
      error.message ||
      "Erro ao iniciar."
    );

  }

}


/* =========================================================
   START
========================================================= */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initApp
  );

} else {

  initApp();

}
