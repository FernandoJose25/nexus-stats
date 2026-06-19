"""
Análisis de Correspondencias — equivalente a SPSS Analyze > Data Reduction > Correspondence.
Simple (dos variables) y Múltiple (MCA, varias variables categóricas).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd
from scipy import stats

from services import data_manager

router = APIRouter()


class CorrespondenciasRequest(BaseModel):
    variable_fila: str
    variable_columna: str
    n_dimensiones: int = 2
    normalizar: str = "simetrico"   # simetrico | fila | columna | principal


class McaRequest(BaseModel):
    variables: list[str]            # ≥ 2 variables categóricas
    n_dimensiones: int = 2


def _svd_correspondencias(tabla: np.ndarray):
    """Descomposición SVD del perfil de la tabla de contingencia."""
    n   = tabla.sum()
    P   = tabla / n                       # Tabla de proporciones
    r   = P.sum(axis=1)                   # Masas fila
    c   = P.sum(axis=0)                   # Masas columna

    # Residuos estandarizados
    Dr_sqrt_inv = np.diag(1.0 / np.sqrt(r))
    Dc_sqrt_inv = np.diag(1.0 / np.sqrt(c))

    S = Dr_sqrt_inv @ (P - np.outer(r, c)) @ Dc_sqrt_inv

    U, sv, Vt = np.linalg.svd(S, full_matrices=False)

    # Valores singulares (inercias)
    inercias = sv**2
    inercia_total = float(inercias.sum())
    pct_inercia   = (inercias / inercia_total * 100) if inercia_total > 0 else inercias * 0

    return U, sv, Vt, r, c, inercias, inercia_total, pct_inercia


@router.post("/simple")
def correspondencias_simples(req: CorrespondenciasRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in [req.variable_fila, req.variable_columna]:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[[req.variable_fila, req.variable_columna]].dropna()
    filas_cats  = sorted(df_clean[req.variable_fila].unique())
    cols_cats   = sorted(df_clean[req.variable_columna].unique())

    tabla = pd.crosstab(df_clean[req.variable_fila], df_clean[req.variable_columna]).values.astype(float)
    n_total = int(tabla.sum())
    r_dim, c_dim = tabla.shape

    if r_dim < 2 or c_dim < 2:
        raise HTTPException(status_code=400, detail="Cada variable necesita al menos 2 categorías")

    U, sv, Vt, r_mass, c_mass, inercias, inercia_total, pct_inercia = _svd_correspondencias(tabla)

    ndim = min(req.n_dimensiones, min(r_dim, c_dim) - 1)

    # Coordenadas estándar
    F_std = np.diag(1.0 / np.sqrt(r_mass)) @ U[:, :ndim]    # Filas
    G_std = np.diag(1.0 / np.sqrt(c_mass)) @ Vt.T[:, :ndim] # Columnas

    # Coordenadas principales
    F_prin = F_std * sv[:ndim]
    G_prin = G_std * sv[:ndim]

    if req.normalizar == "simetrico":
        F_plot = F_std * (sv[:ndim]**0.5)
        G_plot = G_std * (sv[:ndim]**0.5)
    elif req.normalizar == "fila":
        F_plot, G_plot = F_prin, G_std
    elif req.normalizar == "columna":
        F_plot, G_plot = F_std, G_prin
    else:
        F_plot, G_plot = F_prin, G_prin

    # Contribuciones absolutas de filas (%)
    contrib_fila = (r_mass[:, None] * F_prin**2 / inercias[:ndim]) * 100
    contrib_col  = (c_mass[:, None] * G_prin**2 / inercias[:ndim]) * 100

    # Chi-cuadrado de independencia
    chi2_val, p_chi2, dof, _ = stats.chi2_contingency(tabla)
    cramer_v = float(np.sqrt(chi2_val / (n_total * (min(r_dim, c_dim) - 1))))

    puntos_fila = [
        {
            "categoria": str(filas_cats[i]),
            "masa": round(float(r_mass[i]), 4),
            "dim1": round(float(F_plot[i, 0]), 4),
            "dim2": round(float(F_plot[i, 1]), 4) if ndim > 1 else 0.0,
            "contrib_dim1": round(float(contrib_fila[i, 0]), 2),
            "contrib_dim2": round(float(contrib_fila[i, 1]), 2) if ndim > 1 else 0.0,
        }
        for i in range(r_dim)
    ]

    puntos_col = [
        {
            "categoria": str(cols_cats[j]),
            "masa": round(float(c_mass[j]), 4),
            "dim1": round(float(G_plot[j, 0]), 4),
            "dim2": round(float(G_plot[j, 1]), 4) if ndim > 1 else 0.0,
            "contrib_dim1": round(float(contrib_col[j, 0]), 2),
            "contrib_dim2": round(float(contrib_col[j, 1]), 2) if ndim > 1 else 0.0,
        }
        for j in range(c_dim)
    ]

    dimensiones = [
        {
            "dimension": i + 1,
            "valor_singular": round(float(sv[i]), 4),
            "inercia": round(float(inercias[i]), 6),
            "pct": round(float(pct_inercia[i]), 2),
            "pct_acum": round(float(pct_inercia[:i+1].sum()), 2),
        }
        for i in range(min(len(sv), 5))
    ]

    return {
        "tipo": "Análisis de correspondencias simples",
        "variable_fila": req.variable_fila,
        "variable_columna": req.variable_columna,
        "n": n_total,
        "n_filas": r_dim,
        "n_columnas": c_dim,
        "inercia_total": round(inercia_total, 6),
        "chi2": round(float(chi2_val), 4),
        "chi2_p": round(float(p_chi2), 6),
        "cramer_v": round(cramer_v, 4),
        "dimensiones": dimensiones,
        "puntos_fila": puntos_fila,
        "puntos_columna": puntos_col,
        "normalizar": req.normalizar,
    }


@router.post("/multiple")
def correspondencias_multiples(req: McaRequest):
    """Análisis de Correspondencias Múltiples (MCA) via Burt matrix."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[req.variables].dropna()
    n = len(df_clean)

    # Codificación disyuntiva completa (one-hot)
    matrices = []
    cat_labels = []
    for v in req.variables:
        cats = sorted(df_clean[v].unique())
        for c in cats:
            matrices.append((df_clean[v] == c).astype(float).values)
            cat_labels.append(f"{v}:{c}")

    Z = np.column_stack(matrices)  # n × J (J = total categorías)
    J = Z.shape[1]

    # Matriz de Burt
    B = Z.T @ Z

    # SVD de la tabla de indicadores centrada
    r_mass = Z.mean(axis=0)
    r_mass[r_mass == 0] = 1e-10
    Dr_inv  = np.diag(1.0 / r_mass)
    P       = Z / Z.sum()
    rC      = P.sum(axis=0)
    rR      = np.full(n, 1.0 / n)

    S = (Z / n - np.outer(np.ones(n) / n, rC)) / np.sqrt(np.outer(np.ones(n), rC))

    try:
        U, sv, Vt = np.linalg.svd(S, full_matrices=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error SVD: {e}")

    ndim  = min(req.n_dimensiones, J - len(req.variables))
    ndim  = max(1, ndim)

    inercias     = sv**2
    iner_total   = float(inercias.sum())
    pct_inercia  = inercias / iner_total * 100 if iner_total > 0 else inercias * 0

    # Coordenadas de categorías (columnas)
    G = np.diag(1.0 / np.sqrt(rC)) @ Vt.T[:, :ndim] * sv[:ndim]

    puntos = [
        {
            "categoria": cat_labels[j],
            "variable": req.variables[next(i for i, v in enumerate(req.variables) if cat_labels[j].startswith(v + ":"))],
            "dim1": round(float(G[j, 0]), 4),
            "dim2": round(float(G[j, 1]), 4) if ndim > 1 else 0.0,
            "masa": round(float(rC[j]), 6),
        }
        for j in range(J)
    ]

    dimensiones = [
        {
            "dimension": i + 1,
            "valor_singular": round(float(sv[i]), 4),
            "inercia": round(float(inercias[i]), 6),
            "pct": round(float(pct_inercia[i]), 2),
            "pct_acum": round(float(pct_inercia[:i+1].sum()), 2),
        }
        for i in range(min(len(sv), 5))
    ]

    return {
        "tipo": "Análisis de correspondencias múltiples (MCA)",
        "variables": req.variables,
        "n": n,
        "J_total_categorias": J,
        "inercia_total": round(iner_total, 6),
        "dimensiones": dimensiones,
        "puntos": puntos,
    }
