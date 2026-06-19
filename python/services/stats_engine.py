"""
Motor estadístico central: wraps pingouin + pandas + scipy para análisis descriptivo.
"""
import math
from typing import Optional

import numpy as np
import pandas as pd
import scipy.stats as stats


def descriptivo_completo(series: pd.Series, nombre: str) -> dict:
    """Calcula estadísticas descriptivas completas para una serie numérica."""
    s = series.dropna()
    n_total = len(series)
    n_validos = len(s)
    n_perdidos = n_total - n_validos

    if n_validos == 0:
        return {"variable": nombre, "error": "Sin datos válidos"}

    media = float(s.mean())
    mediana = float(s.median())
    desv_std = float(s.std(ddof=1))
    varianza = float(s.var(ddof=1))
    minimo = float(s.min())
    maximo = float(s.max())
    rango = maximo - minimo

    # Error estándar de la media
    error_estandar = desv_std / math.sqrt(n_validos) if n_validos > 1 else None

    # Asimetría y curtosis (Fisher)
    asimetria = float(stats.skew(s, bias=False)) if n_validos >= 3 else None
    curtosis = float(stats.kurtosis(s, bias=False, fisher=True)) if n_validos >= 4 else None

    # Errores estándar de asimetría y curtosis
    see = _error_estandar_asimetria(n_validos)
    sec = _error_estandar_curtosis(n_validos)

    # Percentiles
    percentiles = {
        "p5": float(np.percentile(s, 5)),
        "p10": float(np.percentile(s, 10)),
        "p25": float(np.percentile(s, 25)),
        "p50": float(np.percentile(s, 50)),
        "p75": float(np.percentile(s, 75)),
        "p90": float(np.percentile(s, 90)),
        "p95": float(np.percentile(s, 95)),
    }
    iqr = percentiles["p75"] - percentiles["p25"]

    # Moda — si todos los valores son únicos, no hay moda real
    mode_result = s.mode()
    if len(mode_result) == len(s):
        moda = []  # Sin moda (distribución uniforme)
    else:
        moda = [float(v) for v in mode_result.values[:5]]  # Máx 5 modas

    # Suma
    suma = float(s.sum())

    return {
        "variable": nombre,
        "n_validos": n_validos,
        "n_perdidos": n_perdidos,
        "media": _round(media),
        "error_estandar_media": _round(error_estandar),
        "mediana": _round(mediana),
        "moda": [_round(m) for m in moda],
        "desv_tipica": _round(desv_std),
        "varianza": _round(varianza),
        "asimetria": _round(asimetria),
        "error_estandar_asimetria": _round(see),
        "curtosis": _round(curtosis),
        "error_estandar_curtosis": _round(sec),
        "rango": _round(rango),
        "minimo": _round(minimo),
        "maximo": _round(maximo),
        "suma": _round(suma),
        "percentiles": {k: _round(v) for k, v in percentiles.items()},
        "iqr": _round(iqr),
    }


def tabla_frecuencias(series: pd.Series, nombre: str) -> dict:
    """Genera tabla de frecuencias para variables categóricas o numéricas discretas."""
    n_total = len(series)
    n_validos = series.notna().sum()

    conteos = series.value_counts(dropna=False).reset_index()
    conteos.columns = ["valor", "frecuencia"]
    conteos = conteos.sort_values("valor", na_position="last")

    filas = []
    acumulado = 0
    for _, row in conteos.iterrows():
        valor = row["valor"]
        freq = int(row["frecuencia"])
        es_perdido = pd.isna(valor)
        pct = (freq / n_total * 100) if n_total > 0 else 0
        pct_valido = (freq / n_validos * 100) if (n_validos > 0 and not es_perdido) else None

        if not es_perdido:
            acumulado += pct_valido or 0

        filas.append({
            "valor": None if es_perdido else (str(valor) if not isinstance(valor, (int, float)) else valor),
            "frecuencia": freq,
            "porcentaje": _round(pct),
            "porcentaje_valido": _round(pct_valido),
            "porcentaje_acumulado": _round(acumulado) if not es_perdido else None,
            "es_perdido": bool(es_perdido),
        })

    return {
        "variable": nombre,
        "n_total": n_total,
        "n_validos": int(n_validos),
        "n_perdidos": int(n_total - n_validos),
        "filas": filas,
    }


def _error_estandar_asimetria(n: int) -> Optional[float]:
    if n < 3:
        return None
    return math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)))


def _error_estandar_curtosis(n: int) -> Optional[float]:
    if n < 4:
        return None
    see = _error_estandar_asimetria(n)
    if see is None:
        return None
    return 2 * see * math.sqrt((n * n - 1) / ((n - 3) * (n + 5)))


def _round(value, decimals: int = 4):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return round(float(value), decimals)
