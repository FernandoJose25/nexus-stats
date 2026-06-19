import os
import sys
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    data, descriptivos, graficos, exportar, exportar_apa, correlaciones, hipotesis,
    regresion, anova, factorial, clustering, arboles, series, fiabilidad,
    ancova_mr, transformar, crosstabs, supervivencia, arima,
    potencia, discriminante, manova, psicometria,
    clustering_jerarquico, correspondencias, variable_meta, proyecto,
    mediacion, mds, tablas_custom, sintaxis, tri,
)

PORT = int(os.environ.get("NEXUS_PORT", 5174))

app = FastAPI(
    title="Nexus Stats Engine",
    description="Motor estadístico interno de Nexus Stats",
    version="0.1.0",
    docs_url="/docs" if os.environ.get("NODE_ENV") == "development" else None,
    redoc_url=None,
)

# Solo acepta conexiones desde localhost — nunca expuesto a la red
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "file://"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router, prefix="/data", tags=["datos"])
app.include_router(descriptivos.router, prefix="/descriptivos", tags=["descriptivos"])
app.include_router(graficos.router, prefix="/graficos", tags=["gráficos"])
app.include_router(exportar.router,     prefix="/exportar",     tags=["exportar"])
app.include_router(exportar_apa.router, prefix="/exportar",     tags=["exportar"])
app.include_router(correlaciones.router, prefix="/correlaciones", tags=["correlaciones"])
app.include_router(hipotesis.router, prefix="/hipotesis", tags=["hipótesis"])
app.include_router(regresion.router, prefix="/regresion", tags=["regresión"])
app.include_router(anova.router, prefix="/anova", tags=["anova"])
app.include_router(factorial.router, prefix="/factorial", tags=["factorial"])
app.include_router(clustering.router, prefix="/clustering", tags=["clustering"])
app.include_router(arboles.router, prefix="/arboles", tags=["árboles"])
app.include_router(series.router, prefix="/series", tags=["series"])
app.include_router(fiabilidad.router, prefix="/fiabilidad", tags=["fiabilidad"])
app.include_router(ancova_mr.router, prefix="/glm", tags=["glm"])
app.include_router(transformar.router, prefix="/transformar", tags=["transformar"])
app.include_router(crosstabs.router, prefix="/crosstabs", tags=["crosstabs"])
app.include_router(supervivencia.router, prefix="/supervivencia", tags=["supervivencia"])
app.include_router(arima.router,         prefix="/arima",         tags=["arima"])
app.include_router(potencia.router,      prefix="/potencia",      tags=["potencia"])
app.include_router(discriminante.router, prefix="/discriminante",  tags=["discriminante"])
app.include_router(manova.router,        prefix="/manova",         tags=["manova"])
app.include_router(psicometria.router,          prefix="/psicometria",         tags=["psicometria"])
app.include_router(clustering_jerarquico.router, prefix="/clustering-jerarquico", tags=["clustering-jerarquico"])
app.include_router(correspondencias.router,      prefix="/correspondencias",      tags=["correspondencias"])
app.include_router(variable_meta.router,         prefix="/variables",             tags=["variables"])
app.include_router(proyecto.router,              prefix="/proyecto",              tags=["proyecto"])
app.include_router(mediacion.router,             prefix="/mediacion",             tags=["mediacion"])
app.include_router(mds.router,                   prefix="/mds",                   tags=["mds"])
app.include_router(tablas_custom.router,          prefix="/tablas-custom",         tags=["tablas-custom"])
app.include_router(sintaxis.router,              prefix="/sintaxis",              tags=["sintaxis"])
app.include_router(tri.router,                   prefix="/tri",                   tags=["tri"])


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


if __name__ == "__main__":
    # stdout sin buffer para que Electron capture los logs en tiempo real
    sys.stdout.reconfigure(line_buffering=True)
    print(f"[Nexus Engine] Iniciando en puerto {PORT}...")
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="info",
        access_log=False,
    )
