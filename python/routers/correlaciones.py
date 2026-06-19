"""
Módulo de correlaciones: Pearson, Spearman, Kendall, correlación parcial.
Ajuste de p-valores: Bonferroni, Holm, BH (Benjamini-Hochberg).
"""
import math
from itertools import combinations
from typing import List, Literal, Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class CorrelacionesRequest(BaseModel):
    variables: list[str]
    metodo: Literal["pearson", "spearman", "kendall"] = "pearson"
    alpha: float = 0.05
    ajuste_p: str = "none"      # "none" | "bonferroni" | "holm" | "bh"


class CorrelacionParRequest(BaseModel):
    variable_x: str
    variable_y: str
    metodo: Literal["pearson", "spearman", "kendall"] = "pearson"
    alpha: float = 0.05


class CorrelacionParcialRequest(BaseModel):
    variable_x: str
    variable_y: str
    covariables: List[str]       # variables a controlar
    metodo: Literal["pearson", "spearman"] = "pearson"
    alpha: float = 0.05


class CorrelacionSemiparcialRequest(BaseModel):
    variable_x: str
    variable_y: str
    covariables_x: List[str] = []    # controlar solo en X
    covariables_y: List[str] = []    # controlar solo en Y
    alpha: float = 0.05


def _clasificar_r(r: float) -> str:
    """Clasificación de Cohen para la magnitud de la correlación."""
    abs_r = abs(r)
    if abs_r < 0.1:
        return "despreciable"
    elif abs_r < 0.3:
        return "débil"
    elif abs_r < 0.5:
        return "moderada"
    elif abs_r < 0.7:
        return "fuerte"
    else:
        return "muy fuerte"


def _calcular_par(s1: pd.Series, s2: pd.Series, metodo: str, alpha: float) -> dict:
    """Calcula correlación, p-value e IC95 para un par de variables."""
    combined = pd.DataFrame({"x": s1, "y": s2}).dropna()
    n = len(combined)

    if n < 3:
        return {"r": None, "p_value": None, "n": n, "error": "Insuficientes observaciones"}

    x, y = combined["x"].values, combined["y"].values

    if metodo == "pearson":
        r, p = stats.pearsonr(x, y)
        # IC95 via transformación de Fisher
        if n > 3 and abs(r) < 1:
            z = math.atanh(r)
            se = 1 / math.sqrt(n - 3)
            z_crit = stats.norm.ppf(1 - alpha / 2)
            ic_low = math.tanh(z - z_crit * se)
            ic_high = math.tanh(z + z_crit * se)
        else:
            ic_low, ic_high = None, None
    elif metodo == "spearman":
        r, p = stats.spearmanr(x, y)
        ic_low, ic_high = None, None  # IC exacto para Spearman requiere bootstrap
    else:  # kendall
        r, p = stats.kendalltau(x, y)
        ic_low, ic_high = None, None

    return {
        "r": round(float(r), 4),
        "r2": round(float(r ** 2), 4),
        "p_value": round(float(p), 4),
        "significativa": bool(p < alpha),
        "n": int(n),
        "magnitud": _clasificar_r(r),
        "direccion": "positiva" if r > 0 else "negativa" if r < 0 else "nula",
        "ic_low": round(ic_low, 4) if ic_low is not None else None,
        "ic_high": round(ic_high, 4) if ic_high is not None else None,
    }


@router.post("/matriz")
def calcular_matriz(req: CorrelacionesRequest):
    """
    Calcula la matriz de correlaciones completa para un conjunto de variables.
    Devuelve: matriz r, matriz p-values, pares detallados y datos para heatmap.
    """
    if len(req.variables) < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 variables")
    if len(req.variables) > 15:
        raise HTTPException(400, detail="Máximo 15 variables por matriz")

    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

    df = data_manager.get_dataframe()

    # Validar que todas sean numéricas
    for var in req.variables:
        if var not in df.columns:
            raise HTTPException(400, detail=f"Variable '{var}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[var]):
            raise HTTPException(400, detail=f"Variable '{var}' no es numérica")

    subset = df[req.variables].copy()
    n_vars = len(req.variables)

    # Matrices de r y p-values
    matriz_r = []
    matriz_p = []

    for v1 in req.variables:
        fila_r, fila_p = [], []
        for v2 in req.variables:
            if v1 == v2:
                fila_r.append(1.0)
                fila_p.append(0.0)
            else:
                res = _calcular_par(subset[v1], subset[v2], req.metodo, req.alpha)
                fila_r.append(res["r"] if res["r"] is not None else None)
                fila_p.append(res["p_value"] if res["p_value"] is not None else None)
        matriz_r.append(fila_r)
        matriz_p.append(fila_p)

    # Pares únicos con detalle completo (triángulo superior)
    pares = []
    for v1, v2 in combinations(req.variables, 2):
        par = _calcular_par(subset[v1], subset[v2], req.metodo, req.alpha)
        pares.append({"var_x": v1, "var_y": v2, **par})

    # Ordenar pares por |r| descendente
    pares_validos = [p for p in pares if p["r"] is not None]
    pares_validos.sort(key=lambda p: abs(p["r"]), reverse=True)

    # Ajuste de p-valores
    ajuste = req.ajuste_p if req.ajuste_p in ("bonferroni", "holm", "bh") else "none"
    if ajuste != "none" and pares_validos:
        p_raw = [p["p_value"] for p in pares_validos]
        p_adj = _ajustar_p(p_raw, ajuste)
        for i, par in enumerate(pares_validos):
            par["p_ajustado"] = round(p_adj[i], 4)
            par["significativa_ajustada"] = bool(p_adj[i] < req.alpha)

    # Datos para heatmap Plotly
    heatmap_data = _build_heatmap(req.variables, matriz_r, matriz_p, req.alpha)

    return {
        "variables": req.variables,
        "metodo": req.metodo,
        "ajuste_p": ajuste,
        "alpha": req.alpha,
        "matriz_r": matriz_r,
        "matriz_p": matriz_p,
        "pares": pares_validos,
        "heatmap": heatmap_data,
        "n_pares_significativos": sum(1 for p in pares_validos if p.get("significativa_ajustada", p["significativa"])),
        "n_pares_total": len(pares_validos),
    }


@router.post("/par")
def calcular_par_endpoint(req: CorrelacionParRequest):
    """Correlación detallada entre dos variables específicas."""
    if req.variable_x == req.variable_y:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

    df = data_manager.get_dataframe()
    for var in [req.variable_x, req.variable_y]:
        if var not in df.columns:
            raise HTTPException(400, detail=f"Variable '{var}' no encontrada")

    resultado = _calcular_par(df[req.variable_x], df[req.variable_y], req.metodo, req.alpha)
    return {"var_x": req.variable_x, "var_y": req.variable_y, **resultado}


@router.post("/parcial")
def correlacion_parcial(req: CorrelacionParcialRequest):
    """
    Correlación parcial entre X e Y controlando el efecto de las covariables.
    Método: residuos de la regresión de X y Y sobre las covariables.
    """
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    todas = [req.variable_x, req.variable_y] + req.covariables
    for v in todas:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"'{v}' debe ser numérica")

    if not req.covariables:
        raise HTTPException(400, detail="Especifica al menos una covariable. Para correlación simple usa /par")
    if req.variable_x == req.variable_y:
        raise HTTPException(400, detail="Las variables deben ser distintas")
    if req.variable_x in req.covariables or req.variable_y in req.covariables:
        raise HTTPException(400, detail="Las variables principales no pueden ser también covariables")

    sub = df[todas].dropna()
    n = len(sub)
    if n < len(req.covariables) + 4:
        raise HTTPException(400, detail="Insuficientes observaciones")

    import numpy as _np
    C = sub[req.covariables].values.astype(float)
    C_aug = _np.column_stack([_np.ones(n), C])

    def _residuos(serie):
        b = _np.linalg.lstsq(C_aug, serie, rcond=None)[0]
        return serie - C_aug @ b

    rx = _residuos(sub[req.variable_x].values.astype(float))
    ry = _residuos(sub[req.variable_y].values.astype(float))

    if req.metodo == "pearson":
        r_parcial, p_val = stats.pearsonr(rx, ry)
    else:
        r_parcial, p_val = stats.spearmanr(rx, ry)

    gl = n - len(req.covariables) - 2
    # IC via transformación de Fisher
    if abs(r_parcial) < 1 and gl > 3:
        z = math.atanh(float(r_parcial))
        se = 1 / math.sqrt(gl - 1)
        z_crit = stats.norm.ppf(1 - req.alpha / 2)
        ic_low = round(math.tanh(z - z_crit * se), 4)
        ic_high = round(math.tanh(z + z_crit * se), 4)
    else:
        ic_low, ic_high = None, None

    # Correlación cero-orden (sin controlar) para comparar
    r_cero, p_cero = stats.pearsonr(sub[req.variable_x].values, sub[req.variable_y].values)

    return {
        "tipo": "Correlación parcial",
        "variable_x": req.variable_x,
        "variable_y": req.variable_y,
        "covariables": req.covariables,
        "metodo": req.metodo,
        "n": int(n),
        "gl": int(gl),
        "r_parcial": round(float(r_parcial), 4),
        "r2_parcial": round(float(r_parcial**2), 4),
        "p_value": round(float(p_val), 4),
        "significativa": bool(p_val < req.alpha),
        "magnitud": _clasificar_r(r_parcial),
        "ic_low": ic_low,
        "ic_high": ic_high,
        "r_cero_orden": round(float(r_cero), 4),
        "p_cero_orden": round(float(p_cero), 4),
        "diferencia_r": round(abs(float(r_cero)) - abs(float(r_parcial)), 4),
        "alpha": req.alpha,
    }


@router.post("/semiparcial")
def correlacion_semiparcial(req: CorrelacionSemiparcialRequest):
    """
    Correlación semiparcial (part correlation): controla covariables solo en una variable.
    Útil para calcular el incremento único de R² de cada predictor.
    """
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    todas = list({req.variable_x, req.variable_y} | set(req.covariables_x) | set(req.covariables_y))
    for v in todas:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"'{v}' debe ser numérica")

    sub = df[todas].dropna()
    n = len(sub)
    import numpy as _np

    def _res(serie, covs):
        if not covs:
            return serie - serie.mean()
        C = sub[covs].values.astype(float)
        C_aug = _np.column_stack([_np.ones(n), C])
        b = _np.linalg.lstsq(C_aug, serie, rcond=None)[0]
        return serie - C_aug @ b

    x_vals = sub[req.variable_x].values.astype(float)
    y_vals = sub[req.variable_y].values.astype(float)
    rx = _res(x_vals, req.covariables_x)
    ry = _res(y_vals, req.covariables_y)

    r_sp, p_val = stats.pearsonr(rx, ry)
    gl = n - max(len(req.covariables_x), len(req.covariables_y)) - 2

    return {
        "tipo": "Correlación semiparcial (part correlation)",
        "variable_x": req.variable_x,
        "variable_y": req.variable_y,
        "covariables_x": req.covariables_x,
        "covariables_y": req.covariables_y,
        "n": int(n),
        "gl": int(max(gl, 1)),
        "r_semiparcial": round(float(r_sp), 4),
        "r2_semiparcial": round(float(r_sp**2), 4),
        "p_value": round(float(p_val), 4),
        "significativa": bool(p_val < 0.05),
        "magnitud": _clasificar_r(r_sp),
        "alpha": 0.05,
    }


def _ajustar_p(p_values: list, metodo: str) -> list:
    """Ajusta p-valores para comparaciones múltiples."""
    m = len(p_values)
    if m == 0:
        return []
    p = [float(x) for x in p_values]

    if metodo == "bonferroni":
        return [min(1.0, pi * m) for pi in p]

    elif metodo == "holm":
        # Holm-Bonferroni (step-down)
        idx_sorted = sorted(range(m), key=lambda i: p[i])
        p_adj = [0.0] * m
        max_p = 0.0
        for rank, i in enumerate(idx_sorted):
            adj = (m - rank) * p[i]
            max_p = max(max_p, adj)
            p_adj[i] = min(1.0, max_p)
        return p_adj

    elif metodo == "bh":
        # Benjamini-Hochberg (FDR)
        idx_sorted = sorted(range(m), key=lambda i: p[i])
        p_adj = [1.0] * m
        min_adj = 1.0
        for rank in range(m - 1, -1, -1):
            i = idx_sorted[rank]
            adj = p[i] * m / (rank + 1)
            min_adj = min(min_adj, adj)
            p_adj[i] = min(1.0, min_adj)
        return p_adj

    return p


def _build_heatmap(variables: list, matriz_r: list, matriz_p: list, alpha: float) -> dict:
    """Construye los datos de Plotly para el heatmap de correlaciones."""
    n = len(variables)

    # Texto para cada celda: r y asteriscos de significancia
    text = []
    for i in range(n):
        fila = []
        for j in range(n):
            r = matriz_r[i][j]
            p = matriz_p[i][j]
            if i == j:
                fila.append("—")
            elif r is None:
                fila.append("N/A")
            else:
                sig = "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < alpha else ""
                fila.append(f"{r:.3f}{sig}")
        text.append(fila)

    # Máscara del triángulo inferior para no duplicar info (opcional: mostrar completo)
    z_display = []
    for i in range(n):
        fila = []
        for j in range(n):
            fila.append(matriz_r[i][j])
        z_display.append(fila)

    trace = {
        "type": "heatmap",
        "z": z_display,
        "x": variables,
        "y": variables,
        "text": text,
        "texttemplate": "%{text}",
        "textfont": {"size": 11, "family": "JetBrains Mono, monospace"},
        "colorscale": [
            [0.0,   "#EF4444"],   # -1 rojo
            [0.25,  "#F97316"],
            [0.5,   "#1E293B"],   # 0 neutro oscuro
            [0.75,  "#3B82F6"],
            [1.0,   "#6366F1"],   # +1 azul/violeta
        ],
        "zmid": 0,
        "zmin": -1,
        "zmax": 1,
        "showscale": True,
        "colorbar": {
            "title": "r",
            "thickness": 12,
            "len": 0.8,
            "tickfont": {"size": 10, "color": "#94A3B8"},
            "titlefont": {"color": "#94A3B8"},
        },
        "hovertemplate": "<b>%{y} × %{x}</b><br>r = %{z:.4f}<extra></extra>",
    }

    layout = {
        "title": {"text": f"Matriz de correlaciones ({variables[0]}...)", "font": {"family": "Inter, sans-serif", "size": 15, "color": "#E2E8F0"}},
        "plot_bgcolor": "rgba(0,0,0,0)",
        "paper_bgcolor": "rgba(0,0,0,0)",
        "font": {"family": "Inter, sans-serif", "color": "#94A3B8"},
        "margin": {"l": 120, "r": 20, "t": 60, "b": 120},
        "xaxis": {"tickangle": -35, "tickfont": {"size": 11}, "side": "bottom"},
        "yaxis": {"tickfont": {"size": 11}, "autorange": "reversed"},
        "modebar": {"bgcolor": "rgba(0,0,0,0)", "color": "#475569", "activecolor": "#3B82F6"},
    }

    return {"data": [trace], "layout": layout}
