"""
Análisis de series temporales: estadísticas descriptivas, descomposición,
ACF/PACF, media móvil y predicción ingenua.
"""
from typing import Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class SeriesRequest(BaseModel):
    variable_valor: str
    variable_tiempo: Optional[str] = None   # None = índice del DataFrame
    periodo: int = 1                         # Estacionalidad (1=anual/sin, 4=trimestral, 12=mensual)
    lags_acf: int = 20


class MediaMovilRequest(BaseModel):
    variable_valor: str
    variable_tiempo: Optional[str] = None
    ventana: int = 5
    tipo: str = "simple"                     # "simple" | "exponencial"
    alpha_ema: float = 0.3


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")


@router.post("/analizar")
def analizar_serie(req: SeriesRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if req.variable_valor not in df.columns:
        raise HTTPException(400, detail=f"Variable '{req.variable_valor}' no encontrada")
    if not pd.api.types.is_numeric_dtype(df[req.variable_valor]):
        raise HTTPException(400, detail=f"'{req.variable_valor}' debe ser numérica")
    if req.variable_tiempo and req.variable_tiempo not in df.columns:
        raise HTTPException(400, detail=f"Variable de tiempo '{req.variable_tiempo}' no encontrada")

    # Ordenar y extraer serie
    if req.variable_tiempo:
        sub = df[[req.variable_tiempo, req.variable_valor]].dropna(subset=[req.variable_valor])
        try:
            sub = sub.sort_values(req.variable_tiempo)
        except Exception:
            pass
        tiempo = sub[req.variable_tiempo].astype(str).tolist()
    else:
        sub = df[[req.variable_valor]].dropna()
        tiempo = list(range(len(sub)))

    y = sub[req.variable_valor].values.astype(float)
    n = len(y)

    if n < 4:
        raise HTTPException(400, detail="Se necesitan al menos 4 observaciones")

    # Estadísticos descriptivos
    desc = {
        "n": int(n),
        "media": round(float(np.mean(y)), 4),
        "desv_tipica": round(float(np.std(y, ddof=1)), 4),
        "minimo": round(float(np.min(y)), 4),
        "maximo": round(float(np.max(y)), 4),
        "mediana": round(float(np.median(y)), 4),
    }

    # Tendencia lineal (OLS)
    t_idx = np.arange(n)
    slope, intercept, r, p_val, _ = stats.linregress(t_idx, y)
    tendencia = {
        "pendiente": round(float(slope), 6),
        "intercepto": round(float(intercept), 4),
        "r": round(float(r), 4),
        "r2": round(float(r ** 2), 4),
        "p_value": round(float(p_val), 4),
        "significativa": bool(p_val < 0.05),
        "direccion": "creciente" if slope > 0 else "decreciente" if slope < 0 else "sin tendencia",
    }

    # ACF y PACF
    lags = min(req.lags_acf, n // 2 - 1)
    acf_vals = _acf(y, lags)
    pacf_vals = _pacf(y, lags)
    ic_95 = 1.96 / np.sqrt(n)

    acf = [{"lag": i + 1, "valor": round(float(v), 4), "significativo": bool(abs(v) > ic_95)} for i, v in enumerate(acf_vals)]
    pacf = [{"lag": i + 1, "valor": round(float(v), 4), "significativo": bool(abs(v) > ic_95)} for i, v in enumerate(pacf_vals)]

    # Test de Ljung-Box (primeros 10 lags)
    lb_stat, lb_p = _ljung_box(y, min(10, lags))

    # Descomposición aditiva simple (si periodo > 1)
    descomposicion = None
    if req.periodo > 1 and n >= 2 * req.periodo:
        descomposicion = _descomponer(y, req.periodo)

    # Diferenciación (primera diferencia)
    diff1 = np.diff(y)
    desc_diff = {
        "media": round(float(np.mean(diff1)), 4),
        "desv_tipica": round(float(np.std(diff1, ddof=1)), 4),
    }

    # Muestra (máx 500 puntos)
    step = max(1, n // 500)
    serie_sample = {
        "tiempo": [str(t) for t in tiempo[::step]],
        "valor": [round(float(v), 4) for v in y[::step]],
        "tendencia_lineal": [round(float(intercept + slope * i), 4) for i in t_idx[::step]],
    }

    return {
        "tipo": "Análisis de serie temporal",
        "variable": req.variable_valor,
        "variable_tiempo": req.variable_tiempo,
        "n": int(n),
        "periodo": int(req.periodo),
        "descriptivos": desc,
        "tendencia": tendencia,
        "ljung_box_10": {"estadistico": round(float(lb_stat), 4), "p_value": round(float(lb_p), 4)},
        "acf": acf,
        "pacf": pacf,
        "ic_95": round(float(ic_95), 4),
        "primera_diferencia": desc_diff,
        "descomposicion": descomposicion,
        "serie": serie_sample,
    }


@router.post("/media-movil")
def media_movil(req: MediaMovilRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if req.variable_valor not in df.columns:
        raise HTTPException(400, detail=f"Variable '{req.variable_valor}' no encontrada")
    if not pd.api.types.is_numeric_dtype(df[req.variable_valor]):
        raise HTTPException(400, detail=f"'{req.variable_valor}' debe ser numérica")

    if req.variable_tiempo:
        sub = df[[req.variable_tiempo, req.variable_valor]].dropna(subset=[req.variable_valor]).sort_values(req.variable_tiempo)
        tiempo = sub[req.variable_tiempo].astype(str).tolist()
    else:
        sub = df[[req.variable_valor]].dropna()
        tiempo = list(range(len(sub)))

    y = sub[req.variable_valor].values.astype(float)
    n = len(y)

    if req.tipo == "simple":
        w = req.ventana
        mm = np.array([
            float(np.mean(y[max(0, i - w + 1):i + 1])) if i >= w - 1 else None
            for i in range(n)
        ])
        label = f"MM {w}"
    else:
        mm = _ema(y, req.alpha_ema)
        label = f"EMA α={req.alpha_ema}"

    step = max(1, n // 500)
    return {
        "variable": req.variable_valor,
        "tipo": req.tipo,
        "ventana": req.ventana if req.tipo == "simple" else None,
        "alpha_ema": req.alpha_ema if req.tipo == "exponencial" else None,
        "label": label,
        "serie": {
            "tiempo": [str(t) for t in tiempo[::step]],
            "valor": [round(float(v), 4) if v is not None else None for v in y[::step]],
            "mm": [round(float(v), 4) if v is not None else None for v in mm[::step]],
        },
    }


# ─── Helpers estadísticos ─────────────────────────────────────────────────────

def _acf(y, lags):
    n = len(y)
    y_c = y - y.mean()
    c0 = np.dot(y_c, y_c) / n
    return [np.dot(y_c[k:], y_c[:n - k]) / (n * c0) for k in range(1, lags + 1)]


def _pacf(y, lags):
    pacf_vals = []
    for k in range(1, lags + 1):
        X = np.column_stack([y[k - j:len(y) - j] for j in range(1, k + 1)])
        y_k = y[k:]
        if X.shape[0] < X.shape[1] + 1:
            pacf_vals.append(0.0)
            continue
        try:
            beta = np.linalg.lstsq(X, y_k, rcond=None)[0]
            pacf_vals.append(float(beta[-1]))
        except Exception:
            pacf_vals.append(0.0)
    return pacf_vals


def _ljung_box(y, lags):
    n = len(y)
    acf_vals = _acf(y, lags)
    q = n * (n + 2) * sum(r ** 2 / (n - k) for k, r in enumerate(acf_vals, 1))
    p = float(stats.chi2.sf(q, lags))
    return float(q), p


def _descomponer(y, periodo):
    """Descomposición aditiva simple (tendencia por MA + componente estacional)."""
    n = len(y)
    w = periodo
    # Tendencia via media móvil centrada
    tendencia = np.full(n, np.nan)
    half = w // 2
    for i in range(half, n - half):
        tendencia[i] = np.mean(y[i - half:i + half + 1])

    # Componente estacional
    estacional = np.zeros(n)
    for s in range(w):
        indices = list(range(s, n, w))
        vals = [y[i] - tendencia[i] for i in indices if not np.isnan(tendencia[i])]
        mean_s = float(np.mean(vals)) if vals else 0.0
        for i in indices:
            estacional[i] = mean_s

    # Residuo
    residuo = y - np.where(np.isnan(tendencia), y, tendencia) - estacional

    step = max(1, n // 500)
    return {
        "tendencia": [round(float(v), 4) if not np.isnan(v) else None for v in tendencia[::step]],
        "estacional": [round(float(v), 4) for v in estacional[::step]],
        "residuo": [round(float(v), 4) for v in residuo[::step]],
    }


def _ema(y, alpha):
    ema = np.zeros(len(y))
    ema[0] = y[0]
    for i in range(1, len(y)):
        ema[i] = alpha * y[i] + (1 - alpha) * ema[i - 1]
    return ema
