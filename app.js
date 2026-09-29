/* =========================================================
   CONSULTAR ELEVAÇÕES (Com tratamento anti-bloqueio 429)
   ========================================================= */
async function requestElevations(coordinates) {
    const elevations = [];
    for (let start = 0; start < coordinates.length; start += CONFIG.batchSize) {
        const batch = coordinates.slice(start, start + CONFIG.batchSize);
        const latStr = batch.map(p => p.lat.toFixed(6)).join(",");
        const lngStr = batch.map(p => p.lng.toFixed(6)).join(",");
        const url = `${CONFIG.elevationURL}?latitude=${latStr}&longitude=${lngStr}`;

        let response;
        let retries = 3;
        let delay = 1500; // Tempo inicial de espera caso tome bloqueio

        // Loop de tentativa com suporte a reenvio se der erro 429
        while (retries > 0) {
            response = await fetch(url);
            
            if (response.status === 429) {
                retries--;
                if (retries === 0) {
                    throw new Error("Limite de requisições excedido na API (HTTP 429). Aguarde alguns segundos e tente novamente.");
                }
                status(`Limite excedido (429). Pausando por ${delay / 1000}s...`);
                await sleep(delay);
                delay *= 2; // Dobra o tempo de espera a cada nova tentativa (Backoff exponencial)
            } else {
                break;
            }
        }

        if (!response.ok) {
            throw new Error(`Erro na API de elevação: HTTP ${response.status}`);
        }
        
        const data = await response.json();
        if (!Array.isArray(data.elevation)) {
            throw new Error("A API não retornou dados de elevação válidos.");
        }
        elevations.push(...data.elevation);

        status(`Obtendo terreno: ${Math.min(start + batch.length, coordinates.length)} / ${coordinates.length} pontos`);
        
        // Intervalo de segurança maior entre os lotes normais (400ms) para evitar o 429
        if (start + CONFIG.batchSize < coordinates.length) {
            await sleep(400);
        }
    }
    return elevations;
}
