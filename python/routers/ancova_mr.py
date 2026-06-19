"""
ANCOVA (análisis de covarianza) y ANOVA de medidas repetidas.
Se importa desde anova.py como extensión.
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


class AncovaRequest(BaseModel):
    dependiente: str
    factor: str
    covariables: List[str]
    alpha: float = 0.05
    posthoc: bool = True
    test_homogeneidad_pendientes: bool = True


class MedidasRepetidasRequest(BaseModel):
    variables: List[str]
    alpha: float = 0.05
    posthoc: bool = True


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

def _check_col(df, col):
    if col not in df.columns:
        raise HTTPException(400, detail=f"Variable '{col}' no encontrada")

def _interpretar_p(p, alpha):
    if p < 0.001: return "muy significativo (p < 0.001)"
    if p < 0.01:  return "significativo (p < 0.01)"
    if p < alpha: return f"significativo (p < {alpha})"
    return f"no significativo (p >= {alpha})"

def _clasif_eta(eta2):
    if eta2 < 0.01: return "despreciable"
    if eta2 < 0.06: return "pequeño"
    if eta2 < 0.14: return "mediano"
    return "grande"


# ─── ANCOVA ───────────────────────────────────────────────────────────────────

@router.post("/ancova")
def ancova(req: AncovaRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_col(df, req.factor)
    if not pd.api.types.is_numeric_dtype(df[req.dependiente]):
        raise HTTPException(400, detail=f"'{req.dependiente}' debe ser numerica")
    for c in req.covariables:
        _check_col(df, c)
        if not pd.api.types.is_numeric_dtype(df[c]):
            raise HTTPException(400, detail=f"Covariable '{c}' debe ser numerica")
    if not req.covariables:
        raise HTTPException(400, detail="ANCOVA requiere al menos 1 covariable")
    if req.dependiente == req.factor or req.factor in req.covariables:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    cols = [req.dependiente, req.factor] + req.covariables
    sub = df[cols].dropna().copy()
    n = len(sub)

    niveles = sorted(sub[req.factor].unique().tolist(), key=str)
    k = len(niveles)
    if k < 2:
        raise HTTPException(400, detail="El factor debe tener al menos 2 niveles")

    sub_enc = pd.get_dummies(sub[req.factor].astype(str), drop_first=True, prefix="_f").astype(float)
    dummy_names = sub_enc.columns.tolist()

    y = sub[req.dependiente].values.astype(float)
    covs = sub[req.covariables].values.astype(float)

    X_full = np.column_stack([np.ones(n), covs, sub_enc.values])
    n_params = X_full.shape[1]

    if n <= n_params:
        raise HTTPException(400, detail=f"Insuficientes observaciones (n={n}, params={n_params})")

    b_full = np.linalg.lstsq(X_full, y, rcond=None)[0]
    y_pred_full = X_full @ b_full
    ss_res_full = float(np.sum((y - y_pred_full) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))

    # SS factor (Type III): reduccion al eliminar el factor
    X_sin_factor = np.column_stack([np.ones(n), covs])
    b_sf = np.linalg.lstsq(X_sin_factor, y, rcond=None)[0]
    SS_factor = max(0.0, float(np.sum((y - X_sin_factor @ b_sf) ** 2)) - ss_res_full)

    # SS covariables
    X_sin_covs = np.column_stack([np.ones(n), sub_enc.values])
    b_sc = np.linalg.lstsq(X_sin_covs, y, rcond=None)[0]
    SS_covs = max(0.0, float(np.sum((y - X_sin_covs @ b_sc) ** 2)) - ss_res_full)

    gl_factor = k - 1
    gl_covs = len(req.covariables)
    gl_error = max(n - n_params, 1)

    MS_factor = SS_factor / gl_factor if gl_factor > 0 else 0.0
    MS_covs = SS_covs / gl_covs if gl_covs > 0 else 0.0
    MS_error = ss_res_full / gl_error

    F_factor = MS_factor / MS_error if MS_error > 0 else 0.0
    F_covs = MS_covs / MS_error if MS_error > 0 else 0.0
    p_factor = float(stats.f.sf(F_factor, gl_factor, gl_error))
    p_covs = float(stats.f.sf(F_covs, gl_covs, gl_error))

    eta2_parcial = SS_factor / (SS_factor + ss_res_full) if (SS_factor + ss_res_full) > 0 else 0.0

    # Medias ajustadas (LS-means): prediccion con covariables en su media
    covs_means = covs.mean(axis=0)
    medias_ajustadas = []
    for niv in niveles:
        dummy_row = np.zeros(len(dummy_names))
        for di, dn in enumerate(dummy_names):
            if dn == f"_f_{str(niv)}":
                dummy_row[di] = 1.0
        row = np.concatenate([[1.0], covs_means, dummy_row])
        media_aj = float(row @ b_full)
        media_obs = float(sub[sub[req.factor] == niv][req.dependiente].mean())
        n_niv = int((sub[req.factor] == niv).sum())
        medias_ajustadas.append({
            "nivel": str(niv), "n": n_niv,
            "media_observada": round(media_obs, 4),
            "media_ajustada": round(media_aj, 4),
        })

    # Test de homogeneidad de pendientes (solo con 1 covariable)
    test_hom = None
    if req.test_homogeneidad_pendientes and len(req.covariables) == 1:
        cov_vals = sub[req.covariables[0]].values.astype(float)
        interac = [sub_enc[dn].values * cov_vals for dn in dummy_names]
        X_int = np.column_stack([X_full] + interac)
        b_int = np.linalg.lstsq(X_int, y, rcond=None)[0]
        ss_res_int = float(np.sum((y - X_int @ b_int) ** 2))
        SS_int = max(0.0, ss_res_full - ss_res_int)
        gl_int = k - 1
        gl_e_int = max(n - X_int.shape[1], 1)
        F_hom = (SS_int / gl_int) / (ss_res_int / gl_e_int) if gl_int > 0 and ss_res_int > 0 else 0.0
        p_hom = float(stats.f.sf(F_hom, gl_int, gl_e_int))
        test_hom = {
            "F": round(F_hom, 4), "gl_num": gl_int, "gl_den": gl_e_int,
            "p_value": round(p_hom, 4),
            "pendientes_homogeneas": bool(p_hom >= req.alpha),
            "interpretacion": "pendientes homogeneas (supuesto ANCOVA OK)" if p_hom >= req.alpha else "pendientes NO homogeneas — supuesto ANCOVA violado",
        }

    # Post-hoc Bonferroni sobre medias ajustadas
    posthoc = None
    if req.posthoc and k >= 2:
        n_comp = k * (k - 1) / 2
        alpha_adj = req.alpha / n_comp
        posthoc = []
        for niv1, niv2 in combinations(niveles, 2):
            ma1 = next(m["media_ajustada"] for m in medias_ajustadas if m["nivel"] == str(niv1))
            ma2 = next(m["media_ajustada"] for m in medias_ajustadas if m["nivel"] == str(niv2))
            n1 = next(m["n"] for m in medias_ajustadas if m["nivel"] == str(niv1))
            n2 = next(m["n"] for m in medias_ajustadas if m["nivel"] == str(niv2))
            se_c = math.sqrt(MS_error * (1 / n1 + 1 / n2)) if n1 > 0 and n2 > 0 else 0.0
            diff = ma1 - ma2
            t_s = diff / se_c if se_c > 0 else 0.0
            p_raw = float(2 * stats.t.sf(abs(t_s), df=gl_error))
            p_bon = min(1.0, p_raw * n_comp)
            t_crit = stats.t.ppf(1 - alpha_adj / 2, df=gl_error)
            posthoc.append({
                "nivel_1": str(niv1), "nivel_2": str(niv2),
                "dif_medias_ajustadas": round(diff, 4),
                "se": round(se_c, 4), "t": round(t_s, 4),
                "p_bonferroni": round(p_bon, 4),
                "significativo": bool(p_bon < req.alpha),
                "ic_low": round(diff - t_crit * se_c, 4),
                "ic_high": round(diff + t_crit * se_c, 4),
            })

    return {
        "tipo": "ANCOVA",
        "dependiente": req.dependiente,
        "factor": req.factor,
        "covariables": req.covariables,
        "n": int(n), "k": int(k),
        "tabla": {
            "factor":      {"SS": round(SS_factor,4), "gl": gl_factor, "MS": round(MS_factor,4), "F": round(F_factor,4), "p": round(p_factor,4), "sig": bool(p_factor<req.alpha), "eta2_parcial": round(eta2_parcial,4)},
            "covariables": {"SS": round(SS_covs,4),   "gl": gl_covs,   "MS": round(MS_covs,4),   "F": round(F_covs,4),   "p": round(p_covs,4),   "sig": bool(p_covs<req.alpha)},
            "error":       {"SS": round(ss_res_full,4), "gl": gl_error, "MS": round(MS_error,4)},
            "total":       {"SS": round(ss_tot,4), "gl": int(n-1)},
        },
        "eta2_parcial_factor": round(eta2_parcial, 4),
        "magnitud_efecto": _clasif_eta(eta2_parcial),
        "medias_ajustadas": medias_ajustadas,
        "test_homogeneidad_pendientes": test_hom,
        "posthoc_bonferroni": posthoc,
        "alpha": req.alpha,
    }


# ─── ANOVA de medidas repetidas ───────────────────────────────────────────────

@router.post("/medidas-repetidas")
def anova_medidas_repetidas(req: MedidasRepetidasRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if len(req.variables) < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 mediciones (variables)")
    for v in req.variables:
        _check_col(df, v)
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"'{v}' debe ser numerica")

    sub = df[req.variables].dropna().copy()
    n = len(sub)
    k = len(req.variables)

    if n < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 sujetos con datos completos")

    Y = sub.values.astype(float)
    grand_mean = Y.mean()
    means_time = Y.mean(axis=0)
    means_subj = Y.mean(axis=1)

    SS_total = float(np.sum((Y - grand_mean) ** 2))
    SS_between_subj = float(k * np.sum((means_subj - grand_mean) ** 2))
    SS_within_subj = SS_total - SS_between_subj
    SS_time = float(n * np.sum((means_time - grand_mean) ** 2))
    SS_error = SS_within_subj - SS_time

    gl_subj = n - 1
    gl_time = k - 1
    gl_error_rm = (n - 1) * (k - 1)

    MS_time = SS_time / gl_time if gl_time > 0 else 0.0
    MS_error = SS_error / gl_error_rm if gl_error_rm > 0 else 0.0

    F = MS_time / MS_error if MS_error > 0 else 0.0
    p_val = float(stats.f.sf(F, gl_time, gl_error_rm))

    eta2 = SS_time / SS_within_subj if SS_within_subj > 0 else 0.0
    omega2 = max(0.0, (SS_time - gl_time * MS_error) / (SS_total + MS_error) if SS_total + MS_error > 0 else 0.0)

    # ── Esfericidad (solo k > 2) ─────────────────────────────────────────────
    mauchly = None
    eps_gg = 1.0; eps_hf = 1.0
    F_gg = F; p_gg = p_val; F_hf = F; p_hf = p_val

    if k > 2:
        Y_c = Y - Y.mean(axis=1, keepdims=True)
        # Matriz de contrastes de Helmert
        C = np.zeros((k, k - 1))
        for j in range(k - 1):
            C[j, j] = j + 1
            C[j + 1:, j] = -1
        C = C / np.sqrt(np.sum(C ** 2, axis=0))
        Z = Y_c @ C
        S = Z.T @ Z / n

        det_S = max(np.linalg.det(S), 1e-300)
        tr_S = float(np.trace(S))
        W = det_S / ((tr_S / (k - 1)) ** (k - 1)) if tr_S > 0 else 0.0

        f_coef = n - 1 - (2 * k ** 2 - 3 * k + 3) / (6 * (k - 1))
        chi2_w = -f_coef * math.log(max(W, 1e-300))
        gl_m = (k - 1) * (k + 2) // 2 - 1
        p_m = float(stats.chi2.sf(chi2_w, gl_m))

        tr2 = float(np.trace(S) ** 2)
        tr_S2 = float(np.trace(S @ S))
        eps_gg = min(1.0, max(1 / (k - 1), tr2 / ((k - 1) * tr_S2) if tr_S2 > 0 else 1.0))

        eps_hf_n = n * (k - 1) * eps_gg - 2
        eps_hf_d = (k - 1) * (n - 1 - (k - 1) * eps_gg)
        eps_hf = min(1.0, max(eps_gg, eps_hf_n / eps_hf_d if eps_hf_d > 0 else 1.0))

        # p corregidos (misma F, distintos gl)
        p_gg = float(stats.f.sf(F, gl_time * eps_gg, gl_error_rm * eps_gg))
        p_hf = float(stats.f.sf(F, gl_time * eps_hf, gl_error_rm * eps_hf))

        mauchly = {
            "W": round(float(W), 4),
            "chi2": round(float(chi2_w), 4),
            "gl": int(gl_m),
            "p_value": round(float(p_m), 4),
            "esfericidad_ok": bool(p_m >= req.alpha),
            "interpretacion": "esfericidad asumida" if p_m >= req.alpha else "esfericidad violada — usar correcciones GG o HF",
        }

    # Descriptivos por nivel
    descriptivos = [
        {
            "variable": v,
            "media": round(float(Y[:, j].mean()), 4),
            "desv_tipica": round(float(Y[:, j].std(ddof=1)), 4),
            "mediana": round(float(np.median(Y[:, j])), 4),
            "n": int(n),
        }
        for j, v in enumerate(req.variables)
    ]

    # Post-hoc: t relacionadas por pares + Bonferroni
    posthoc = []
    if req.posthoc:
        n_comp = k * (k - 1) / 2
        for v1, v2 in combinations(req.variables, 2):
            try:
                t_s, p_t = stats.ttest_rel(sub[v1].values, sub[v2].values)
                p_bon = min(1.0, float(p_t) * n_comp)
                d = sub[v1].values - sub[v2].values
                d_c = float(np.mean(d) / np.std(d, ddof=1)) if np.std(d, ddof=1) > 0 else 0.0
                posthoc.append({
                    "var_1": v1, "var_2": v2,
                    "dif_medias": round(float(sub[v1].mean() - sub[v2].mean()), 4),
                    "t": round(float(t_s), 4),
                    "p_bonferroni": round(p_bon, 4),
                    "significativo": bool(p_bon < req.alpha),
                    "d_cohen": round(d_c, 4),
                })
            except Exception:
                continue

    return {
        "tipo": "ANOVA de medidas repetidas",
        "variables": req.variables,
        "n": int(n), "k": int(k),
        "F": round(F, 4),
        "p_value": round(p_val, 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "eta2": round(eta2, 4),
        "omega2": round(omega2, 4),
        "magnitud_efecto": _clasif_eta(eta2),
        "tabla": {
            "factor_tiempo": {"SS": round(SS_time,4), "gl": gl_time, "MS": round(MS_time,4), "F": round(F,4), "p": round(p_val,4), "sig": bool(p_val<req.alpha)},
            "error":         {"SS": round(SS_error,4), "gl": gl_error_rm, "MS": round(MS_error,4)},
            "entre_sujetos": {"SS": round(SS_between_subj,4), "gl": gl_subj},
            "total":         {"SS": round(SS_total,4), "gl": int(n*k-1)},
        },
        "mauchly": mauchly,
        "epsilon_gg": round(float(eps_gg), 4),
        "epsilon_hf": round(float(eps_hf), 4),
        "F_gg": round(float(F_gg), 4), "p_gg": round(float(p_gg), 4),
        "F_hf": round(float(F_hf), 4), "p_hf": round(float(p_hf), 4),
        "descriptivos": descriptivos,
        "posthoc": posthoc,
        "alpha": req.alpha,
    }
