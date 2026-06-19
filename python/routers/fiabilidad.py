"""
Análisis de fiabilidad: Alpha de Cronbach, split-half (Spearman-Brown),
correlaciones ítem-total corregidas, estadísticos por ítem.
"""
from typing import List

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class CronbachRequest(BaseModel):
    items: List[str]          # Variables (ítems de la escala)
    eliminar_si_mejora: bool = True   # Calcular alpha si se elimina cada ítem


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")


@router.post("/cronbach")
def cronbach_alpha(req: CronbachRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    for v in req.items:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"'{v}' debe ser numérica")

    if len(req.items) < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 ítems")

    sub = df[req.items].dropna()
    n, k = sub.shape

    if n < 5:
        raise HTTPException(400, detail="Se necesitan al menos 5 observaciones completas")

    alpha, alpha_std = _cronbach(sub.values)

    # Estadísticos por ítem
    items_stats = []
    for i, item in enumerate(req.items):
        col = sub[item]
        # Correlación ítem-total corregida (excluye el propio ítem)
        resto = sub.drop(columns=[item])
        total_sin_item = resto.sum(axis=1)
        r_it, p_it = stats.pearsonr(col, total_sin_item)

        # Alpha si se elimina el ítem
        alpha_si_elimina = None
        if req.eliminar_si_mejora and k > 2:
            sub_sin = sub.drop(columns=[item])
            a_si, _ = _cronbach(sub_sin.values)
            alpha_si_elimina = round(float(a_si), 4)

        items_stats.append({
            "item": item,
            "media": round(float(col.mean()), 4),
            "desv_tipica": round(float(col.std(ddof=1)), 4),
            "correlacion_item_total": round(float(r_it), 4),
            "correlacion_p": round(float(p_it), 4),
            "alpha_si_se_elimina": alpha_si_elimina,
        })

    # Estadísticos de la escala
    total = sub.sum(axis=1)
    escala = {
        "media": round(float(total.mean()), 4),
        "varianza": round(float(total.var(ddof=1)), 4),
        "desv_tipica": round(float(total.std(ddof=1)), 4),
    }

    # Split-half (Spearman-Brown)
    split_half = None
    if k >= 4:
        mitad1 = sub.iloc[:, :k//2].sum(axis=1)
        mitad2 = sub.iloc[:, k//2:].sum(axis=1)
        r_sh, _ = stats.pearsonr(mitad1, mitad2)
        sb = 2 * r_sh / (1 + r_sh)
        split_half = {
            "r_mitades": round(float(r_sh), 4),
            "spearman_brown": round(float(sb), 4),
        }

    return {
        "tipo": "Análisis de fiabilidad (Alpha de Cronbach)",
        "items": req.items,
        "n": int(n),
        "k": int(k),
        "alpha": round(float(alpha), 4),
        "alpha_estandarizado": round(float(alpha_std), 4),
        "interpretacion": _interpretar_alpha(alpha),
        "escala": escala,
        "items_estadisticos": items_stats,
        "split_half": split_half,
    }


def _cronbach(X):
    """Calcula alpha de Cronbach y alpha estandarizado."""
    n, k = X.shape
    varianzas_items = X.var(axis=0, ddof=1)
    varianza_total = X.sum(axis=1).var(ddof=1)

    if varianza_total == 0:
        return 0.0, 0.0

    alpha = (k / (k - 1)) * (1 - varianzas_items.sum() / varianza_total)

    # Alpha estandarizado (usa correlaciones)
    R = np.corrcoef(X.T)
    r_mean = (R.sum() - k) / (k * (k - 1))
    alpha_std = (k * r_mean) / (1 + (k - 1) * r_mean)

    return float(alpha), float(alpha_std)


def _interpretar_alpha(a):
    if a >= 0.9: return "excelente"
    if a >= 0.8: return "bueno"
    if a >= 0.7: return "aceptable"
    if a >= 0.6: return "cuestionable"
    if a >= 0.5: return "deficiente"
    return "inaceptable"
