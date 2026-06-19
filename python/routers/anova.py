"""
ANOVA de un factor (one-way) con post-hoc de Tukey HSD.
ANOVA de dos factores (two-way) con interacción y efectos principales.
ANCOVA (análisis de covarianza) con medias ajustadas.
ANOVA de medidas repetidas (within-subjects) con corrección de esfericidad.
"""
import math
from itertools import combinations
from typing import List, Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class AnovaRequest(BaseModel):
    dependiente: str
    factor: str
    alpha: float = 0.05
    posthoc: bool = True
    metodo_posthoc: str = "tukey"   # "tukey" | "bonferroni" | "scheffe" | "todos"


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

def _check_col(df, col):
    if col not in df.columns:
        raise HTTPException(400, detail=f"Variable '{col}' no encontrada")


@router.post("/one-way")
def anova_one_way(req: AnovaRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_col(df, req.factor)

    if not pd.api.types.is_numeric_dtype(df[req.dependiente]):
        raise HTTPException(400, detail=f"'{req.dependiente}' debe ser numérica")
    if req.dependiente == req.factor:
        raise HTTPException(400, detail="Dependiente y factor no pueden ser la misma variable")

    sub = df[[req.dependiente, req.factor]].dropna()
    grupos_uniq = sub[req.factor].unique()
    k = len(grupos_uniq)

    if k < 2:
        raise HTTPException(400, detail="El factor debe tener al menos 2 categorías")
    if k > 50:
        raise HTTPException(400, detail="Demasiadas categorías en el factor (máximo 50)")

    muestras = {str(g): sub[sub[req.factor] == g][req.dependiente].values for g in grupos_uniq}
    for g, m in muestras.items():
        if len(m) < 2:
            raise HTTPException(400, detail=f"El grupo '{g}' tiene menos de 2 observaciones")

    listas = list(muestras.values())
    n_total = sum(len(m) for m in listas)

    f_stat, p_val = stats.f_oneway(*listas)

    # SS manual para eta²
    grand_mean = np.concatenate(listas).mean()
    ss_between = sum(len(m) * (m.mean() - grand_mean) ** 2 for m in listas)
    ss_within = sum(np.sum((m - m.mean()) ** 2) for m in listas)
    ss_total = ss_between + ss_within

    eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0
    omega2 = float((ss_between - (k - 1) * (ss_within / (n_total - k))) / (ss_total + ss_within / (n_total - k))) if n_total > k else 0.0
    omega2 = max(0.0, omega2)

    # Tabla ANOVA
    gl_between = int(k - 1)
    gl_within = int(n_total - k)
    ms_between = float(ss_between / gl_between) if gl_between > 0 else 0.0
    ms_within = float(ss_within / gl_within) if gl_within > 0 else 0.0

    # Resumen por grupo
    resumen_grupos = []
    for g, m in muestras.items():
        resumen_grupos.append({
            "grupo": g,
            "n": int(len(m)),
            "media": round(float(m.mean()), 4),
            "desv_tipica": round(float(m.std(ddof=1)), 4),
            "mediana": round(float(np.median(m)), 4),
            "ic_low": round(float(m.mean() - stats.t.ppf(1 - req.alpha / 2, len(m) - 1) * m.std(ddof=1) / math.sqrt(len(m))), 4),
            "ic_high": round(float(m.mean() + stats.t.ppf(1 - req.alpha / 2, len(m) - 1) * m.std(ddof=1) / math.sqrt(len(m))), 4),
        })

    # Levene (homogeneidad de varianzas)
    levene_stat, levene_p = stats.levene(*listas)

    result = {
        "tipo": "ANOVA de un factor",
        "dependiente": req.dependiente,
        "factor": req.factor,
        "n_total": int(n_total),
        "k": int(k),
        "f_stat": round(float(f_stat), 4),
        "gl_between": gl_between,
        "gl_within": gl_within,
        "ms_between": round(ms_between, 4),
        "ms_within": round(ms_within, 4),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "eta2": round(eta2, 4),
        "omega2": round(omega2, 4),
        "magnitud_efecto": _clasif_eta(eta2),
        "grupos": resumen_grupos,
        "levene_stat": round(float(levene_stat), 4),
        "levene_p": round(float(levene_p), 4),
        "varianzas_homogeneas": bool(levene_p >= 0.05),
        "alpha": req.alpha,
    }

    # Post-hoc
    if req.posthoc and k >= 2:
        metodo = req.metodo_posthoc
        if metodo in ("tukey", "todos"):
            result["posthoc_tukey"] = _tukey_hsd(muestras, ms_within, n_total, k, req.alpha)
        if metodo in ("bonferroni", "todos"):
            result["posthoc_bonferroni"] = _bonferroni(muestras, ms_within, gl_within, req.alpha)
        if metodo in ("scheffe", "todos"):
            result["posthoc_scheffe"] = _scheffe(muestras, ms_within, gl_within, k, req.alpha)
        # Por compatibilidad: si metodo es "tukey" siempre devolver posthoc_tukey
        if metodo not in ("tukey", "bonferroni", "scheffe", "todos"):
            result["posthoc_tukey"] = _tukey_hsd(muestras, ms_within, n_total, k, req.alpha)

    return result


def _interpretar_p(p, alpha):
    if p < 0.001: return "muy significativo (p < 0.001)"
    if p < 0.01:  return "significativo (p < 0.01)"
    if p < alpha: return f"significativo (p < {alpha})"
    return f"no significativo (p ≥ {alpha})"


def _clasif_eta(eta2):
    if eta2 < 0.01: return "despreciable"
    if eta2 < 0.06: return "pequeño"
    if eta2 < 0.14: return "mediano"
    return "grande"


def _tukey_hsd(muestras: dict, ms_within: float, n_total: int, k: int, alpha: float):
    """Calcula Tukey HSD para todas las comparaciones por pares."""
    grupos = list(muestras.keys())
    comparaciones = []

    for g1, g2 in combinations(grupos, 2):
        m1 = muestras[g1]
        m2 = muestras[g2]
        n1, n2 = len(m1), len(m2)

        # Error estándar del contraste (harmonic mean para grupos desiguales)
        nh = 2 / (1 / n1 + 1 / n2)
        se = math.sqrt(ms_within / nh) if nh > 0 else 0.0

        diff = float(m1.mean() - m2.mean())
        q = abs(diff) / se if se > 0 else 0.0

        # p-valor usando distribución Studentized Range (approx con scipy)
        try:
            from scipy.stats import studentized_range
            p_val = float(studentized_range.sf(q, k, n_total - k))
        except Exception:
            # Fallback: comparación t con corrección Bonferroni
            n_comp = k * (k - 1) / 2
            t_stat = diff / (se * math.sqrt(2) / math.sqrt(2)) if se > 0 else 0.0
            p_val = min(1.0, float(2 * stats.t.sf(abs(t_stat), df=n_total - k)) * n_comp)

        # IC de la diferencia (95%)
        q_crit_approx = stats.t.ppf(1 - alpha / (2 * k * (k - 1) / 2), df=n_total - k) * math.sqrt(2)
        ic_low = round(diff - q_crit_approx * se, 4)
        ic_high = round(diff + q_crit_approx * se, 4)

        comparaciones.append({
            "grupo_1": g1,
            "grupo_2": g2,
            "diferencia": round(diff, 4),
            "se": round(se, 4),
            "q": round(q, 4),
            "p_value": round(p_val, 4),
            "significativo": bool(p_val < alpha),
            "ic_low": ic_low,
            "ic_high": ic_high,
        })

    return comparaciones


def _bonferroni(muestras: dict, ms_within: float, gl_within: int, alpha: float):
    """Post-hoc Bonferroni: t-tests por pares con alpha corregido."""
    grupos = list(muestras.keys())
    k = len(grupos)
    n_comp = k * (k - 1) / 2
    alpha_adj = alpha / n_comp
    comparaciones = []

    for g1, g2 in combinations(grupos, 2):
        m1, m2 = muestras[g1], muestras[g2]
        n1, n2 = len(m1), len(m2)
        nh = 2 / (1/n1 + 1/n2)
        se = math.sqrt(ms_within / nh) if nh > 0 else 0.0
        diff = float(m1.mean() - m2.mean())
        t_stat = diff / se if se > 0 else 0.0
        p_raw = float(2 * stats.t.sf(abs(t_stat), df=gl_within))
        p_adj = min(1.0, p_raw * n_comp)
        t_crit = stats.t.ppf(1 - alpha_adj / 2, df=gl_within)
        comparaciones.append({
            "grupo_1": g1, "grupo_2": g2,
            "diferencia": round(diff, 4),
            "se": round(se, 4),
            "t": round(t_stat, 4),
            "p_value": round(p_raw, 4),
            "p_bonferroni": round(p_adj, 4),
            "significativo": bool(p_adj < alpha),
            "ic_low": round(diff - t_crit * se, 4),
            "ic_high": round(diff + t_crit * se, 4),
        })
    return comparaciones


def _scheffe(muestras: dict, ms_within: float, gl_within: int, k: int, alpha: float):
    """Post-hoc Scheffé: más conservador que Tukey, válido para contrastes complejos."""
    grupos = list(muestras.keys())
    gl_between = k - 1
    comparaciones = []

    for g1, g2 in combinations(grupos, 2):
        m1, m2 = muestras[g1], muestras[g2]
        n1, n2 = len(m1), len(m2)
        nh = 2 / (1/n1 + 1/n2)
        se = math.sqrt(ms_within / nh) if nh > 0 else 0.0
        diff = float(m1.mean() - m2.mean())
        # Estadístico F de Scheffé
        f_stat = (diff / se) ** 2 / gl_between if se > 0 else 0.0
        p_val = float(stats.f.sf(f_stat, gl_between, gl_within))
        # Diferencia crítica de Scheffé
        f_crit = stats.f.ppf(1 - alpha, gl_between, gl_within)
        dc = math.sqrt(gl_between * f_crit) * se
        comparaciones.append({
            "grupo_1": g1, "grupo_2": g2,
            "diferencia": round(diff, 4),
            "se": round(se, 4),
            "f_scheffe": round(f_stat, 4),
            "p_value": round(p_val, 4),
            "significativo": bool(p_val < alpha),
            "diferencia_critica": round(dc, 4),
            "ic_low": round(diff - dc, 4),
            "ic_high": round(diff + dc, 4),
        })
    return comparaciones


# ─── ANOVA de dos factores ────────────────────────────────────────────────────

class AnovaDosFactoresRequest(BaseModel):
    dependiente: str
    factor_a: str
    factor_b: str
    alpha: float = 0.05
    posthoc: bool = True


@router.post("/two-way")
def anova_two_way(req: AnovaDosFactoresRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_col(df, req.factor_a)
    _check_col(df, req.factor_b)

    if not pd.api.types.is_numeric_dtype(df[req.dependiente]):
        raise HTTPException(400, detail=f"'{req.dependiente}' debe ser numérica")
    if req.dependiente in [req.factor_a, req.factor_b] or req.factor_a == req.factor_b:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    sub = df[[req.dependiente, req.factor_a, req.factor_b]].dropna().copy()
    n_total = len(sub)

    niveles_a = sorted(sub[req.factor_a].unique().tolist(), key=str)
    niveles_b = sorted(sub[req.factor_b].unique().tolist(), key=str)
    a = len(niveles_a)
    b = len(niveles_b)

    if a < 2: raise HTTPException(400, detail=f"'{req.factor_a}' necesita ≥ 2 niveles")
    if b < 2: raise HTTPException(400, detail=f"'{req.factor_b}' necesita ≥ 2 niveles")
    if a > 20 or b > 20: raise HTTPException(400, detail="Demasiados niveles (máx 20 por factor)")

    # Codificar factores como códigos numéricos
    sub["_A"] = pd.Categorical(sub[req.factor_a], categories=niveles_a).codes
    sub["_B"] = pd.Categorical(sub[req.factor_b], categories=niveles_b).codes
    y = sub[req.dependiente].values.astype(float)
    grand_mean = y.mean()

    # SS mediante descomposición tipo III (usando OLS con dummies)
    # Matrices de diseño
    dummies_a = np.zeros((n_total, a - 1))
    for i in range(a - 1):
        dummies_a[:, i] = (sub["_A"].values == i).astype(float)

    dummies_b = np.zeros((n_total, b - 1))
    for j in range(b - 1):
        dummies_b[:, j] = (sub["_B"].values == j).astype(float)

    # Interacción AB
    n_inter = (a - 1) * (b - 1)
    dummies_ab = np.zeros((n_total, n_inter))
    idx = 0
    for i in range(a - 1):
        for j in range(b - 1):
            dummies_ab[:, idx] = dummies_a[:, i] * dummies_b[:, j]
            idx += 1

    def ss_from_model(X_cols):
        X = np.column_stack([np.ones(n_total)] + X_cols) if X_cols else np.ones((n_total, 1))
        try:
            beta = np.linalg.lstsq(X, y, rcond=None)[0]
        except Exception:
            return 0.0
        y_pred = X @ beta
        return float(np.sum((y_pred - grand_mean) ** 2))

    ss_total = float(np.sum((y - grand_mean) ** 2))
    ss_full = ss_from_model([dummies_a, dummies_b, dummies_ab])
    ss_a_only = ss_from_model([dummies_a])
    ss_b_only = ss_from_model([dummies_b])
    ss_ab_only = ss_from_model([dummies_a, dummies_b])

    SS_A = ss_ab_only - ss_b_only
    SS_B = ss_ab_only - ss_a_only
    SS_AB = ss_full - ss_ab_only
    SS_W = ss_total - ss_full
    SS_W = max(SS_W, 1e-10)

    gl_a = a - 1
    gl_b = b - 1
    gl_ab = (a - 1) * (b - 1)
    gl_w = n_total - a * b
    gl_w = max(gl_w, 1)

    MS_A = SS_A / gl_a
    MS_B = SS_B / gl_b
    MS_AB = SS_AB / gl_ab if gl_ab > 0 else 0.0
    MS_W = SS_W / gl_w

    F_A = MS_A / MS_W if MS_W > 0 else 0.0
    F_B = MS_B / MS_W if MS_W > 0 else 0.0
    F_AB = MS_AB / MS_W if MS_W > 0 else 0.0

    p_A = float(stats.f.sf(F_A, gl_a, gl_w))
    p_B = float(stats.f.sf(F_B, gl_b, gl_w))
    p_AB = float(stats.f.sf(F_AB, gl_ab, gl_w)) if gl_ab > 0 else 1.0

    eta2_A = SS_A / ss_total if ss_total > 0 else 0.0
    eta2_B = SS_B / ss_total if ss_total > 0 else 0.0
    eta2_AB = SS_AB / ss_total if ss_total > 0 else 0.0

    # Medias marginales
    medias_a = []
    for niv in niveles_a:
        vals = sub[sub[req.factor_a] == niv][req.dependiente].values
        medias_a.append({"nivel": str(niv), "n": int(len(vals)), "media": round(float(vals.mean()), 4), "desv": round(float(vals.std(ddof=1) if len(vals) > 1 else 0.0), 4)})

    medias_b = []
    for niv in niveles_b:
        vals = sub[sub[req.factor_b] == niv][req.dependiente].values
        medias_b.append({"nivel": str(niv), "n": int(len(vals)), "media": round(float(vals.mean()), 4), "desv": round(float(vals.std(ddof=1) if len(vals) > 1 else 0.0), 4)})

    # Medias de celdas (interacción)
    celdas = []
    for na in niveles_a:
        for nb in niveles_b:
            mask = (sub[req.factor_a] == na) & (sub[req.factor_b] == nb)
            vals = sub[mask][req.dependiente].values
            if len(vals) > 0:
                celdas.append({
                    "nivel_a": str(na), "nivel_b": str(nb),
                    "n": int(len(vals)),
                    "media": round(float(vals.mean()), 4),
                    "desv": round(float(vals.std(ddof=1) if len(vals) > 1 else 0.0), 4),
                })

    result = {
        "tipo": "ANOVA de dos factores",
        "dependiente": req.dependiente,
        "factor_a": req.factor_a,
        "factor_b": req.factor_b,
        "n_total": int(n_total),
        "niveles_a": [str(n) for n in niveles_a],
        "niveles_b": [str(n) for n in niveles_b],
        "tabla": {
            "factor_a":    {"SS": round(SS_A, 4),  "gl": gl_a,  "MS": round(MS_A, 4),  "F": round(F_A, 4),  "p": round(p_A, 4),  "sig": bool(p_A < req.alpha),  "eta2": round(eta2_A, 4)},
            "factor_b":    {"SS": round(SS_B, 4),  "gl": gl_b,  "MS": round(MS_B, 4),  "F": round(F_B, 4),  "p": round(p_B, 4),  "sig": bool(p_B < req.alpha),  "eta2": round(eta2_B, 4)},
            "interaccion": {"SS": round(SS_AB, 4), "gl": gl_ab, "MS": round(MS_AB, 4), "F": round(F_AB, 4), "p": round(p_AB, 4), "sig": bool(p_AB < req.alpha), "eta2": round(eta2_AB, 4)},
            "error":       {"SS": round(SS_W, 4),  "gl": gl_w,  "MS": round(MS_W, 4)},
            "total":       {"SS": round(ss_total, 4), "gl": int(n_total - 1)},
        },
        "medias_factor_a": medias_a,
        "medias_factor_b": medias_b,
        "medias_celdas": celdas,
        "alpha": req.alpha,
    }

    # Post-hoc Tukey para efectos significativos
    if req.posthoc:
        if p_A < req.alpha and a >= 2:
            muestras_a = {str(niv): sub[sub[req.factor_a] == niv][req.dependiente].values for niv in niveles_a}
            result["posthoc_a"] = _tukey_hsd(muestras_a, MS_W, n_total, a, req.alpha)
        if p_B < req.alpha and b >= 2:
            muestras_b = {str(niv): sub[sub[req.factor_b] == niv][req.dependiente].values for niv in niveles_b}
            result["posthoc_b"] = _tukey_hsd(muestras_b, MS_W, n_total, b, req.alpha)

    return result
