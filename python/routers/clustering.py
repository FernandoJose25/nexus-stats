"""
Clustering: K-means + análisis de silueta para selección de k óptimo.
"""
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class KMeansRequest(BaseModel):
    variables: List[str]
    k: int = 3
    estandarizar: bool = True
    max_iter: int = 300
    n_init: int = 10
    random_state: int = 42

class SiluetaRequest(BaseModel):
    variables: List[str]
    k_min: int = 2
    k_max: int = 8
    estandarizar: bool = True
    random_state: int = 42


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")


@router.post("/kmeans")
def kmeans(req: KMeansRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"Variable '{v}' debe ser numérica")

    if len(req.variables) < 1:
        raise HTTPException(400, detail="Selecciona al menos 1 variable")
    if req.k < 2:
        raise HTTPException(400, detail="k debe ser al menos 2")

    sub = df[req.variables].dropna()
    n = len(sub)

    if n < req.k:
        raise HTTPException(400, detail=f"Se necesitan al menos {req.k} observaciones")

    X = sub.values.astype(float)

    if req.estandarizar:
        means = X.mean(axis=0)
        stds = X.std(axis=0, ddof=1)
        stds[stds == 0] = 1
        X_std = (X - means) / stds
    else:
        X_std = X

    labels, centroids, inercia = _kmeans_fit(X_std, req.k, req.max_iter, req.n_init, req.random_state)

    # Silueta
    sil = _silhouette_score(X_std, labels) if req.k > 1 else 0.0

    # Centroides en escala original (si estandarizado)
    if req.estandarizar:
        means_arr = X.mean(axis=0)
        stds_arr = X.std(axis=0, ddof=1)
        stds_arr[stds_arr == 0] = 1
        centroids_orig = centroids * stds_arr + means_arr
    else:
        centroids_orig = centroids

    # Resumen por cluster
    cluster_resumen = []
    for c in range(req.k):
        mask = labels == c
        cluster_data = sub[mask]
        estadisticos = {}
        for v in req.variables:
            estadisticos[v] = {
                "media": round(float(cluster_data[v].mean()), 4),
                "desv": round(float(cluster_data[v].std(ddof=1)), 4) if len(cluster_data) > 1 else 0.0,
            }
        cluster_resumen.append({
            "cluster": int(c + 1),
            "n": int(mask.sum()),
            "pct": round(float(mask.sum() / n * 100), 1),
            "estadisticos": estadisticos,
            "centroide": {v: round(float(centroids_orig[c, i]), 4) for i, v in enumerate(req.variables)},
        })

    # Puntos para scatter (máx 500, primeras 2 variables si hay más)
    step = max(1, n // 500)
    scatter = {
        "x": [round(float(v), 4) for v in X[::step, 0]],
        "y": [round(float(v), 4) for v in X[::step, 1]] if len(req.variables) > 1 else None,
        "cluster": [int(v + 1) for v in labels[::step]],
        "var_x": req.variables[0],
        "var_y": req.variables[1] if len(req.variables) > 1 else None,
    }

    return {
        "tipo": f"K-means (k={req.k})",
        "variables": req.variables,
        "n": int(n),
        "k": int(req.k),
        "inercia": round(float(inercia), 4),
        "silhouette": round(float(sil), 4),
        "silhouette_interpretacion": _interpretar_sil(sil),
        "estandarizado": req.estandarizar,
        "clusters": cluster_resumen,
        "scatter": scatter,
    }


@router.post("/silueta")
def analisis_silueta(req: SiluetaRequest):
    """Calcula el coeficiente de silueta para distintos valores de k."""
    _check_loaded()
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"Variable '{v}' debe ser numérica")

    sub = df[req.variables].dropna()
    n = len(sub)
    X = sub.values.astype(float)

    if req.estandarizar:
        stds = X.std(axis=0, ddof=1)
        stds[stds == 0] = 1
        X_std = (X - X.mean(axis=0)) / stds
    else:
        X_std = X

    k_max = min(req.k_max, n - 1)
    resultados = []
    for k in range(req.k_min, k_max + 1):
        labels, _, inercia = _kmeans_fit(X_std, k, 300, 5, req.random_state)
        sil = _silhouette_score(X_std, labels)
        resultados.append({
            "k": int(k),
            "silhouette": round(float(sil), 4),
            "inercia": round(float(inercia), 4),
        })

    k_optimo = max(resultados, key=lambda r: r["silhouette"])["k"]

    return {
        "variables": req.variables,
        "resultados": resultados,
        "k_optimo": int(k_optimo),
    }


# ─── K-means implementado desde cero (sin sklearn) ───────────────────────────

def _kmeans_fit(X, k, max_iter, n_init, random_state):
    best_labels, best_centroids, best_inercia = None, None, float('inf')
    rng = np.random.RandomState(random_state)

    for _ in range(n_init):
        idx = rng.choice(len(X), k, replace=False)
        centroids = X[idx].copy()

        for _ in range(max_iter):
            dists = np.linalg.norm(X[:, np.newaxis] - centroids[np.newaxis], axis=2)
            labels = np.argmin(dists, axis=1)
            new_centroids = np.array([
                X[labels == c].mean(axis=0) if (labels == c).any() else centroids[c]
                for c in range(k)
            ])
            if np.allclose(centroids, new_centroids, atol=1e-6):
                break
            centroids = new_centroids

        inercia = sum(np.sum((X[labels == c] - centroids[c]) ** 2) for c in range(k) if (labels == c).any())
        if inercia < best_inercia:
            best_inercia = inercia
            best_labels = labels.copy()
            best_centroids = centroids.copy()

    return best_labels, best_centroids, best_inercia


def _silhouette_score(X, labels):
    k = len(np.unique(labels))
    if k <= 1 or k >= len(X):
        return 0.0
    n = len(X)
    s_vals = []
    for i in range(n):
        own = labels[i]
        own_mask = labels == own
        own_mask[i] = False
        if own_mask.sum() == 0:
            a = 0.0
        else:
            a = float(np.mean(np.linalg.norm(X[i] - X[own_mask], axis=1)))
        b_candidates = []
        for c in range(k):
            if c == own:
                continue
            other_mask = labels == c
            if other_mask.sum() == 0:
                continue
            b_candidates.append(float(np.mean(np.linalg.norm(X[i] - X[other_mask], axis=1))))
        b = min(b_candidates) if b_candidates else 0.0
        denom = max(a, b)
        s_vals.append((b - a) / denom if denom > 0 else 0.0)
    return float(np.mean(s_vals))


def _interpretar_sil(s):
    if s >= 0.7:  return "estructura fuerte"
    if s >= 0.5:  return "estructura razonable"
    if s >= 0.25: return "estructura débil"
    return "sin estructura"
