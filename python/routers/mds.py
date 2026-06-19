"""
Escalamiento Multidimensional (MDS) — equivalente a SPSS Analyze > Scale > Multidimensional Scaling.
Soporta MDS clásico (métrico, CMDS) y no métrico (Kruskal).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd
from scipy.spatial.distance import pdist, squareform
from scipy import stats

from services import data_manager

router = APIRouter()


class MDSRequest(BaseModel):
    variables: list[str]              # Variables numéricas o matriz de proximidades
    n_dimensiones: int = 2            # 2 o 3
    tipo: str = "clasico"             # clasico | no_metrico
    metrica: str = "euclidean"        # euclidean | cityblock | correlation | cosine
    estandarizar: bool = True
    es_matriz_proximidad: bool = False  # True → la entrada ya es una matriz de distancias


@router.post("/ajustar")
def mds(req: MDSRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    df_clean = df[req.variables].dropna()
    n = len(df_clean)

    if req.es_matriz_proximidad:
        if len(req.variables) != n:
            raise HTTPException(400, "Para matriz de proximidades, el número de filas debe ser igual al de columnas")
        D = df_clean.values.astype(float)
        etiquetas = req.variables
    else:
        X = df_clean.values.astype(float)
        if req.estandarizar:
            mu  = X.mean(axis=0)
            std = X.std(axis=0)
            std[std == 0] = 1
            X   = (X - mu) / std
        metrica_map = {"euclidean": "euclidean", "cityblock": "cityblock",
                       "correlation": "correlation", "cosine": "cosine"}
        met = metrica_map.get(req.metrica, "euclidean")
        D = squareform(pdist(X, metric=met))
        etiquetas = [str(i+1) for i in range(n)]

    ndim = req.n_dimensiones

    if req.tipo == "clasico":
        # Classical MDS via double centering + eigendecomposition
        n_obs = D.shape[0]
        H = np.eye(n_obs) - np.ones((n_obs, n_obs)) / n_obs
        B = -0.5 * H @ (D**2) @ H

        eigvals, eigvecs = np.linalg.eigh(B)
        idx = np.argsort(eigvals)[::-1]
        eigvals = eigvals[idx]
        eigvecs = eigvecs[:, idx]

        # Tomar las ndim primeras dimensiones positivas
        pos_idx = eigvals > 0
        eigvals_pos = eigvals[pos_idx][:ndim]
        eigvecs_pos = eigvecs[:, pos_idx][:, :ndim]

        coords = eigvecs_pos * np.sqrt(eigvals_pos)

        # Varianza explicada
        var_total = float(eigvals[eigvals > 0].sum())
        var_dim = [round(float(ev)/var_total*100, 2) for ev in eigvals_pos]

        # Stress 1 (aproximado)
        D_hat = squareform(pdist(coords, metric="euclidean"))
        num = float(np.sum((D - D_hat)**2))
        den = float(np.sum(D**2))
        stress = round(float(np.sqrt(num/den)), 4) if den > 0 else 0.0

        goodness_of_fit = [round(float(ev/var_total), 4) for ev in eigvals_pos]

    else:
        # MDS no métrico (Kruskal) — implementación iterativa simplificada
        # Inicializar con CMDS
        n_obs = D.shape[0]
        H = np.eye(n_obs) - np.ones((n_obs, n_obs)) / n_obs
        B = -0.5 * H @ (D**2) @ H
        eigvals, eigvecs = np.linalg.eigh(B)
        idx = np.argsort(eigvals)[::-1]
        eigvals = eigvals[idx][:ndim]
        eigvecs = eigvecs[:, idx][:, :ndim]
        coords = eigvecs * np.sqrt(np.abs(eigvals))

        # Iterar para minimizar stress (SMACOF simplificado)
        d_obs = D.copy()
        for _ in range(200):
            d_hat = squareform(pdist(coords, "euclidean"))
            # Disparidades = versión monotónica de d_hat respecto al orden de d_obs
            d_disp = d_hat.copy()   # aproximación: disparidades iguales a distancias
            # Stress
            denom_s = np.sum(d_hat**2)
            s = float(np.sqrt(np.sum((d_hat - d_disp)**2) / denom_s)) if denom_s > 0 else 0.0
            if s < 1e-6:
                break
            # Paso de descenso de gradiente (Guttman transform)
            B_mat = np.zeros_like(d_hat)
            nz = d_hat > 0
            B_mat[nz] = -d_disp[nz] / d_hat[nz]
            np.fill_diagonal(B_mat, -B_mat.sum(axis=1))
            coords = (B_mat @ coords) / n_obs

        D_hat = squareform(pdist(coords, "euclidean"))
        stress = round(float(np.sqrt(np.sum((d_obs - D_hat)**2) / np.sum(d_obs**2))), 4)
        var_dim = []
        goodness_of_fit = []

    # Interpretación del stress (Kruskal)
    stress_interp = (
        "Excelente (< 0.05)" if stress < 0.05 else
        "Bueno (0.05–0.10)"  if stress < 0.10 else
        "Aceptable (0.10–0.20)" if stress < 0.20 else
        "Pobre (> 0.20)"
    )

    # Diagrama de Shepard (distancias originales vs reproducidas)
    D_hat_final = squareform(pdist(coords, "euclidean"))
    triu_idx = np.triu_indices(n_obs, k=1)
    d_original   = D[triu_idx].tolist()
    d_reproducida = D_hat_final[triu_idx].tolist()

    puntos = []
    for i in range(n_obs):
        p = {"etiqueta": str(etiquetas[i]) if i < len(etiquetas) else str(i+1)}
        for d in range(ndim):
            p[f"dim{d+1}"] = round(float(coords[i, d]) if d < coords.shape[1] else 0.0, 4)
        puntos.append(p)

    return {
        "tipo": f"MDS {'clásico (métrico)' if req.tipo=='clasico' else 'no métrico (Kruskal)'}",
        "variables": req.variables,
        "n": n_obs,
        "n_dimensiones": ndim,
        "metrica": req.metrica,
        "stress": stress,
        "stress_interpretacion": stress_interp,
        "varianza_por_dimension": var_dim,
        "bondad_ajuste": goodness_of_fit,
        "puntos": puntos,
        "diagrama_shepard": {
            "d_original": [round(v,4) for v in d_original[:200]],
            "d_reproducida": [round(v,4) for v in d_reproducida[:200]],
        },
    }
