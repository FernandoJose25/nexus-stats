"""
Clustering Jerárquico — equivalente a SPSS Analyze > Classify > Hierarchical Cluster.
Métodos de enlace: Ward, Completo, Simple, Promedio, Centroide.
Medidas de distancia: Euclidiana, Manhattan, Coseno.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd
from scipy.cluster import hierarchy
from scipy.spatial.distance import pdist, squareform

from services import data_manager

router = APIRouter()


class JerarquicoRequest(BaseModel):
    variables: list[str]
    metodo: str = "ward"          # ward | complete | single | average | centroid
    metrica: str = "euclidean"    # euclidean | cityblock | cosine
    n_clusters: Optional[int] = None  # None = usar dendrograma
    estandarizar: bool = True
    max_display: int = 50         # Máx etiquetas en dendrograma


@router.post("/ajustar")
def clustering_jerarquico(req: JerarquicoRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[req.variables].dropna()
    n = len(df_clean)
    if n < 2:
        raise HTTPException(status_code=400, detail="Se necesitan al menos 2 observaciones")

    X = df_clean.values.astype(float)

    if req.estandarizar:
        mu  = X.mean(axis=0)
        std = X.std(axis=0)
        std[std == 0] = 1
        X   = (X - mu) / std

    # Matriz de distancias
    metrica_map = {"euclidean": "euclidean", "cityblock": "cityblock", "cosine": "cosine"}
    metrica = metrica_map.get(req.metrica, "euclidean")
    dist_vec = pdist(X, metric=metrica)

    # Linkage
    metodo_map = {"ward": "ward", "complete": "complete", "single": "single",
                  "average": "average", "centroid": "centroid"}
    metodo = metodo_map.get(req.metodo, "ward")

    if metodo == "ward" and metrica != "euclidean":
        metodo = "average"   # Ward solo funciona con euclidiana

    Z = hierarchy.linkage(dist_vec, method=metodo)

    # Cortar en k clusters si se especifica
    k = req.n_clusters or _sugerir_k(Z, n)
    k = min(max(k, 2), n - 1)
    etiquetas = hierarchy.fcluster(Z, t=k, criterion="maxclust")

    # Estadísticos por cluster
    grupos = sorted(set(etiquetas))
    estadisticos_cluster = []
    for g in grupos:
        mask = etiquetas == g
        X_g  = df_clean.values[mask]
        stats_vars = {}
        for j, var in enumerate(req.variables):
            stats_vars[var] = {
                "media": round(float(X_g[:, j].mean()), 4),
                "desv":  round(float(X_g[:, j].std()),  4),
            }
        estadisticos_cluster.append({
            "cluster": int(g),
            "n": int(mask.sum()),
            "pct": round(float(mask.sum() / n * 100), 1),
            "estadisticos": stats_vars,
        })

    # Coeficientes de fusión (schedule)
    fusion_schedule = []
    for i, step in enumerate(Z):
        fusion_schedule.append({
            "paso": i + 1,
            "cluster_1": int(step[0]),
            "cluster_2": int(step[1]),
            "distancia": round(float(step[2]), 4),
            "n_miembros": int(step[3]),
        })

    # Dendrograma (datos para Plotly como árbol aplanado)
    dendro_data = _dendrograma_plotly(Z, n, req.max_display)

    # Coeficiente de correlación cofenética
    try:
        coph_c, _ = hierarchy.cophenet(Z, dist_vec)
        coph_corr = round(float(coph_c), 4) if n <= 500 else None
    except Exception:
        coph_corr = None

    return {
        "tipo": f"Clustering jerárquico ({metodo.capitalize()}, {metrica})",
        "variables": req.variables,
        "n": n,
        "k": k,
        "metodo": metodo,
        "metrica": metrica,
        "estandarizado": req.estandarizar,
        "etiquetas_cluster": etiquetas.tolist(),
        "clusters": estadisticos_cluster,
        "fusion_schedule": fusion_schedule[-20:],   # Últimas 20 fusiones
        "dendrograma": dendro_data,
        "correlacion_cofenetica": round(coph_corr, 4) if coph_corr else None,
        "k_sugerido": _sugerir_k(Z, n),
    }


def _sugerir_k(Z: np.ndarray, n: int) -> int:
    """Sugiere k usando el mayor salto en distancias de fusión."""
    if len(Z) < 2:
        return 2
    distances = Z[:, 2]
    accs = np.diff(distances)
    if len(accs) == 0:
        return 2
    k = int(n - np.argmax(accs) - 1)
    return max(2, min(k, n // 2))


def _dendrograma_plotly(Z: np.ndarray, n: int, max_display: int) -> dict:
    """Convierte el linkage matrix a trazas Plotly para un dendrograma."""
    try:
        den = hierarchy.dendrogram(Z, no_plot=True, truncate_mode="lastp" if n > max_display else None,
                                   p=max_display if n > max_display else n)
        return {
            "icoord": den["icoord"],
            "dcoord": den["dcoord"],
            "ivl": den["ivl"],
            "truncated": n > max_display,
        }
    except Exception:
        return {"icoord": [], "dcoord": [], "ivl": [], "truncated": False}
