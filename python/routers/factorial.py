"""
Análisis Factorial Exploratorio: PCA + FA con rotación Varimax.
Tests previos: KMO y Bartlett.
"""
from typing import List, Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class FactorialRequest(BaseModel):
    variables: List[str]
    n_factores: Optional[int] = None      # None = criterio Kaiser (eigenvalue > 1)
    metodo: str = "pca"                   # "pca" | "fa"
    rotacion: str = "varimax"             # "varimax" | "none"
    estandarizar: bool = True


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")


@router.post("/exploratorio")
def analisis_factorial(req: FactorialRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"Variable '{v}' debe ser numérica")

    if len(req.variables) < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 variables")

    sub = df[req.variables].dropna()
    n, p = sub.shape

    if n < p + 1:
        raise HTTPException(400, detail=f"Se necesitan al menos {p + 1} observaciones completas")

    X = sub.values.astype(float)

    # Estandarizar (z-scores)
    if req.estandarizar:
        means = X.mean(axis=0)
        stds = X.std(axis=0, ddof=1)
        stds[stds == 0] = 1
        X_std = (X - means) / stds
    else:
        X_std = X

    # Matriz de correlaciones
    R = np.corrcoef(X_std.T)

    # Test de Bartlett (H0: la matriz de correlaciones es identidad)
    chi2_bartlett, p_bartlett = _test_bartlett(R, n)

    # KMO
    kmo = _kmo(R)

    # PCA via descomposición espectral
    eigenvalues, eigenvectors = np.linalg.eigh(R)
    # eigh devuelve en orden ascendente, invertimos
    idx = np.argsort(eigenvalues)[::-1]
    eigenvalues = eigenvalues[idx]
    eigenvectors = eigenvectors[:, idx]
    # Clip valores negativos pequeños por errores numéricos
    eigenvalues = np.maximum(eigenvalues, 0)

    # Determinar número de factores (Kaiser o explícito)
    if req.n_factores is None:
        n_factores = max(1, int(np.sum(eigenvalues > 1)))
    else:
        n_factores = max(1, min(req.n_factores, p - 1))

    # Cargas (loadings) sin rotar
    loadings_raw = eigenvectors[:, :n_factores] * np.sqrt(eigenvalues[:n_factores])

    # Rotación Varimax
    if req.rotacion == "varimax" and n_factores > 1:
        loadings = _varimax(loadings_raw)
    else:
        loadings = loadings_raw

    # Comunalidades (h²)
    comunalidades = np.sum(loadings ** 2, axis=1)

    # Varianza explicada
    var_explicada = eigenvalues / p * 100
    var_acum = np.cumsum(var_explicada)

    # Puntuaciones factoriales (regression method, solo con PCA sin rotar para simplicidad)
    scores_raw = X_std @ eigenvectors[:, :n_factores]

    # Construcción de la respuesta
    variables = req.variables
    factores_labels = [f"F{i+1}" for i in range(n_factores)]

    loadings_table = []
    for i, var in enumerate(variables):
        row = {"variable": var, "comunalidad": round(float(comunalidades[i]), 4)}
        for j, fl in enumerate(factores_labels):
            row[fl] = round(float(loadings[i, j]), 4)
        loadings_table.append(row)

    eigenvalues_table = []
    for j in range(p):
        eigenvalues_table.append({
            "factor": j + 1,
            "eigenvalue": round(float(eigenvalues[j]), 4),
            "varianza_pct": round(float(var_explicada[j]), 4),
            "varianza_acum": round(float(var_acum[j]), 4),
            "retenido": j < n_factores,
        })

    # Muestra de puntuaciones (máx 200)
    step = max(1, n // 200)
    puntuaciones = {fl: [round(float(v), 4) for v in scores_raw[::step, j]] for j, fl in enumerate(factores_labels)}

    return {
        "tipo": "Análisis Factorial Exploratorio (PCA" + (" + Varimax)" if req.rotacion == "varimax" and n_factores > 1 else ")"),
        "variables": variables,
        "n": int(n),
        "p": int(p),
        "n_factores": int(n_factores),
        "metodo": req.metodo,
        "rotacion": req.rotacion if n_factores > 1 else "none",
        "kmo": round(float(kmo), 4),
        "kmo_interpretacion": _interpretar_kmo(kmo),
        "bartlett_chi2": round(float(chi2_bartlett), 4),
        "bartlett_gl": int(p * (p - 1) / 2),
        "bartlett_p": round(float(p_bartlett), 4),
        "bartlett_significativo": bool(p_bartlett < 0.05),
        "eigenvalues": eigenvalues_table,
        "loadings": loadings_table,
        "factores_labels": factores_labels,
        "puntuaciones_sample": puntuaciones,
    }


def _test_bartlett(R, n):
    p = R.shape[0]
    det = max(np.linalg.det(R), 1e-300)
    chi2 = -(n - 1 - (2 * p + 5) / 6) * np.log(det)
    gl = p * (p - 1) / 2
    p_val = float(stats.chi2.sf(chi2, gl))
    return float(chi2), p_val


def _kmo(R):
    """Kaiser-Meyer-Olkin measure of sampling adequacy."""
    p = R.shape[0]
    try:
        R_inv = np.linalg.inv(R)
    except np.linalg.LinAlgError:
        return 0.0
    # Anti-image correlations
    D = np.diag(1 / np.sqrt(np.diag(R_inv)))
    A = -D @ R_inv @ D
    np.fill_diagonal(A, 1.0)

    r2_sum = np.sum(R ** 2) - p
    a2_sum = np.sum(A ** 2) - p
    kmo = r2_sum / (r2_sum + a2_sum) if (r2_sum + a2_sum) > 0 else 0.0
    return max(0.0, min(1.0, float(kmo)))


def _interpretar_kmo(kmo):
    if kmo >= 0.9: return "excelente"
    if kmo >= 0.8: return "bueno"
    if kmo >= 0.7: return "aceptable"
    if kmo >= 0.6: return "mediocre"
    if kmo >= 0.5: return "deficiente"
    return "inaceptable"


def _varimax(loadings, max_iter=1000, tol=1e-6):
    """Rotación Varimax (Kaiser)."""
    p, k = loadings.shape
    rotation = np.eye(k)

    for _ in range(max_iter):
        L = loadings @ rotation
        # Gradiente
        u = L ** 3 - (L @ np.diag(np.sum(L ** 2, axis=0))) / p
        svd_matrix = loadings.T @ u
        U, _, Vt = np.linalg.svd(svd_matrix)
        new_rotation = U @ Vt
        change = np.max(np.abs(new_rotation - rotation))
        rotation = new_rotation
        if change < tol:
            break

    return loadings @ rotation
