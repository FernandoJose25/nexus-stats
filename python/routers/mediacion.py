"""
Análisis de Mediación y Moderación — equivalente a PROCESS macro de Hayes (SPSS).
Modelos:
  1 — Moderación simple (X → Y con W como moderador)
  4 — Mediación simple (X → M → Y)
  7 — Mediación moderada (W modera X→M)
 14 — Mediación moderada (W modera M→Y)
 58 — Mediación con múltiples mediadores en paralelo
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd
from scipy import stats

from services import data_manager

router = APIRouter()


class MediacionRequest(BaseModel):
    x: str                      # Variable independiente
    y: str                      # Variable dependiente
    mediadores: list[str] = []  # Variables mediadoras (M1, M2, ...)
    moderador: str = ""         # Variable moderadora (W)
    modelo: int = 4             # 1, 4, 7, 14, 58
    n_bootstrap: int = 1000     # Iteraciones para IC bootstrap
    alpha: float = 0.05
    centrar: bool = True        # Centrar variables continuas (recomendado)


def _ols(X: np.ndarray, y: np.ndarray):
    """OLS: retorna (coefs, se, t, p, r2, residuos)."""
    n, k = X.shape
    b = np.linalg.lstsq(X, y, rcond=None)[0]
    y_hat = X @ b
    resid = y - y_hat
    sse = float(resid @ resid)
    sst = float(((y - y.mean())**2).sum())
    r2 = 1 - sse/sst if sst > 0 else 0.0
    s2 = sse / (n - k)
    cov_b = s2 * np.linalg.inv(X.T @ X + np.eye(k)*1e-10)
    se = np.sqrt(np.diag(cov_b))
    t_stat = b / se
    p_val = 2 * stats.t.sf(np.abs(t_stat), df=n-k)
    return b, se, t_stat, p_val, r2, resid


def _prepare(df: pd.DataFrame, variables: list[str], centrar: bool):
    cols = [c for c in variables if c]
    sub = df[cols].dropna()
    X = sub.values.astype(float)
    if centrar:
        means = X.mean(axis=0)
        X = X - means
    return sub, X


def _bootstrap_indirect(x_arr, m_arr, y_arr, n_boot=1000, seed=42):
    """Bootstrap del efecto indirecto a→b en un modelo X→M→Y."""
    rng = np.random.default_rng(seed)
    n = len(x_arr)
    indirectos = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        xi, mi, yi = x_arr[idx], m_arr[idx], y_arr[idx]
        Xm = np.column_stack([np.ones(n), xi])
        bm = np.linalg.lstsq(Xm, mi, rcond=None)[0]
        a = bm[1]
        Xy = np.column_stack([np.ones(n), xi, mi])
        by = np.linalg.lstsq(Xy, yi, rcond=None)[0]
        b = by[2]
        indirectos.append(float(a * b))
    return np.array(indirectos)


@router.post("/ajustar")
def mediacion_moderacion(req: MediacionRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()

    todos = [req.x, req.y] + req.mediadores + ([req.moderador] if req.moderador else [])
    for v in todos:
        if v and v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    df_c = df[list(set(v for v in todos if v))].dropna()
    n = len(df_c)

    def col(name):
        arr = df_c[name].values.astype(float)
        if req.centrar:
            arr = arr - arr.mean()
        return arr

    x_arr = col(req.x)
    y_arr = col(req.y)
    ones  = np.ones(n)

    resultado = {
        "modelo": req.modelo,
        "x": req.x,
        "y": req.y,
        "n": n,
        "alpha": req.alpha,
        "n_bootstrap": req.n_bootstrap,
    }

    # ── Modelo 4: Mediación simple X → M → Y ─────────────────────────
    if req.modelo == 4 and req.mediadores:
        efectos_indirectos = []
        modelos_m = []
        for med in req.mediadores:
            m_arr = col(med)

            # Path a: X → M
            Xm = np.column_stack([ones, x_arr])
            bm, sem, tm, pm, r2m, _ = _ols(Xm, m_arr)
            a_coef = float(bm[1])
            a_se   = float(sem[1])
            a_t    = float(tm[1])
            a_p    = float(pm[1])

            # Path b y c': X, M → Y
            Xy = np.column_stack([ones, x_arr, m_arr])
            by, sey, ty, py, r2y, _ = _ols(Xy, y_arr)
            b_coef = float(by[2])
            c_prime= float(by[1])

            # Efecto indirecto a*b
            indirecto = a_coef * b_coef

            # Bootstrap CI
            boot = _bootstrap_indirect(x_arr, m_arr, y_arr, req.n_bootstrap)
            ci_lo = float(np.percentile(boot, req.alpha/2*100))
            ci_hi = float(np.percentile(boot, (1-req.alpha/2)*100))
            significativo = not (ci_lo <= 0 <= ci_hi)

            modelos_m.append({
                "mediador": med,
                "path_a": {"coef": round(a_coef,4), "se": round(a_se,4), "t": round(a_t,4), "p": round(a_p,6)},
                "path_b": {"coef": round(b_coef,4), "se": round(float(sey[2]),4), "t": round(float(ty[2]),4), "p": round(float(py[2]),6)},
                "r2_m": round(r2m,4),
                "r2_y": round(r2y,4),
            })
            efectos_indirectos.append({
                "mediador": med,
                "efecto_indirecto": round(indirecto, 4),
                "boot_se": round(float(boot.std()), 4),
                "boot_ci_lo": round(ci_lo, 4),
                "boot_ci_hi": round(ci_hi, 4),
                "significativo": significativo,
            })

        # Efecto total y directo
        Xtot = np.column_stack([ones, x_arr])
        btot, _, _, _, r2tot, _ = _ols(Xtot, y_arr)
        c_total = float(btot[1])

        resultado.update({
            "tipo": "Mediación simple (Modelo 4)",
            "modelos_mediadores": modelos_m,
            "efectos_indirectos": efectos_indirectos,
            "efecto_total_c": round(c_total, 4),
            "efecto_directo_c_prima": round(float(c_prime), 4) if req.mediadores else None,
            "proporcion_mediada": round(float(1 - c_prime/c_total), 4) if abs(c_total) > 1e-10 else None,
        })

    # ── Modelo 1: Moderación simple X → Y con W ───────────────────────
    elif req.modelo == 1 and req.moderador:
        w_arr = col(req.moderador)
        xw    = x_arr * w_arr   # Término de interacción

        Xy = np.column_stack([ones, x_arr, w_arr, xw])
        by, sey, ty, py, r2y, _ = _ols(Xy, y_arr)

        # Pendientes simples en ±1 SD de W
        w_sd = float(w_arr.std())
        pendientes = []
        for label, w_val in [("W = +1 SD", w_sd), ("W = Media", 0.0), ("W = -1 SD", -w_sd)]:
            slope_x = float(by[1] + by[3] * w_val)
            pendientes.append({"condicion": label, "w": round(w_val,3), "slope_x": round(slope_x,4)})

        resultado.update({
            "tipo": "Moderación simple (Modelo 1)",
            "moderador": req.moderador,
            "coeficientes": [
                {"nombre": "Constante", "b": round(float(by[0]),4), "se": round(float(sey[0]),4), "t": round(float(ty[0]),4), "p": round(float(py[0]),6)},
                {"nombre": req.x,       "b": round(float(by[1]),4), "se": round(float(sey[1]),4), "t": round(float(ty[1]),4), "p": round(float(py[1]),6)},
                {"nombre": req.moderador,"b": round(float(by[2]),4),"se": round(float(sey[2]),4), "t": round(float(ty[2]),4), "p": round(float(py[2]),6)},
                {"nombre": f"{req.x}×{req.moderador}", "b": round(float(by[3]),4), "se": round(float(sey[3]),4),
                 "t": round(float(ty[3]),4), "p": round(float(py[3]),6),
                 "significativo": bool(py[3] < req.alpha)},
            ],
            "r2": round(r2y,4),
            "pendientes_simples": pendientes,
            "interaccion_significativa": bool(py[3] < req.alpha),
        })

    # ── Modelo 58: Mediación paralela múltiple ────────────────────────
    elif req.modelo == 58 and len(req.mediadores) >= 2:
        efectos = []
        for med in req.mediadores:
            m_arr = col(med)
            boot = _bootstrap_indirect(x_arr, m_arr, y_arr, req.n_bootstrap)
            # Path a
            Xm = np.column_stack([ones, x_arr])
            bm, sem, _, _, _, _ = _ols(Xm, m_arr)
            # Path b
            Xy_all = np.column_stack([ones, x_arr] + [col(m) for m in req.mediadores])
            by_all, sey_all, _, _, r2y, _ = _ols(Xy_all, y_arr)
            med_idx = req.mediadores.index(med)
            b_coef = float(by_all[2 + med_idx])
            ci_lo = float(np.percentile(boot, req.alpha/2*100))
            ci_hi = float(np.percentile(boot, (1-req.alpha/2)*100))
            efectos.append({
                "mediador": med,
                "a": round(float(bm[1]),4),
                "b": round(b_coef,4),
                "indirecto": round(float(bm[1])*b_coef,4),
                "boot_ci": [round(ci_lo,4), round(ci_hi,4)],
                "significativo": not (ci_lo <= 0 <= ci_hi),
            })
        resultado.update({
            "tipo": "Mediación paralela múltiple (Modelo 58)",
            "efectos": efectos,
        })

    # ── Modelo 7: Mediación moderada W modera X→M ────────────────────
    elif req.modelo == 7 and req.mediadores and req.moderador:
        w_arr = col(req.moderador)
        m_arr = col(req.mediadores[0])
        xw = x_arr * w_arr

        # X, W, X*W → M
        Xm = np.column_stack([ones, x_arr, w_arr, xw])
        bm, sem, tm, pm, r2m, _ = _ols(Xm, m_arr)

        # X, M → Y
        Xy = np.column_stack([ones, x_arr, m_arr])
        by, sey, ty, py, r2y, _ = _ols(Xy, y_arr)
        b_coef = float(by[2])

        w_sd = float(w_arr.std())
        efectos_cond = []
        for label, w_val in [("W = +1 SD", w_sd), ("W = Media", 0.0), ("W = -1 SD", -w_sd)]:
            a_cond = float(bm[1] + bm[3]*w_val)
            efectos_cond.append({
                "condicion": label,
                "a_condicional": round(a_cond,4),
                "indirecto_condicional": round(a_cond*b_coef,4),
            })

        resultado.update({
            "tipo": "Mediación moderada (Modelo 7)",
            "moderador": req.moderador,
            "mediador":  req.mediadores[0],
            "interaccion_XW_en_M": {
                "coef": round(float(bm[3]),4), "se": round(float(sem[3]),4),
                "t": round(float(tm[3]),4), "p": round(float(pm[3]),6),
                "significativa": bool(pm[3] < req.alpha)
            },
            "path_b": {"coef": round(b_coef,4), "se": round(float(sey[2]),4)},
            "efectos_indirectos_condicionales": efectos_cond,
            "r2_m": round(r2m,4),
            "r2_y": round(r2y,4),
        })

    else:
        raise HTTPException(400, f"Modelo {req.modelo} no disponible con las variables especificadas. "
                               "Modelos disponibles: 1 (moderación), 4 (mediación simple), "
                               "7 (mediación moderada), 58 (mediación paralela).")

    return resultado


class SobelRequest(BaseModel):
    x: str
    mediador: str
    y: str


@router.post("/sobel")
def sobel_test(req: SobelRequest):
    """Test de Sobel para significancia del efecto indirecto."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in [req.x, req.mediador, req.y]:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    sub = df[[req.x, req.mediador, req.y]].dropna()
    n = len(sub)
    ones = np.ones(n)

    x_arr = sub[req.x].values.astype(float)
    m_arr = sub[req.mediador].values.astype(float)
    y_arr = sub[req.y].values.astype(float)

    Xm = np.column_stack([ones, x_arr])
    bm, sem, _, _, _, _ = _ols(Xm, m_arr)
    a, sea = float(bm[1]), float(sem[1])

    Xy = np.column_stack([ones, x_arr, m_arr])
    by, sey, _, _, _, _ = _ols(Xy, y_arr)
    b, seb = float(by[2]), float(sey[2])

    se_sobel = float(np.sqrt(b**2 * sea**2 + a**2 * seb**2))
    z_sobel  = float(a*b / se_sobel) if se_sobel > 0 else 0.0
    p_sobel  = float(2 * stats.norm.sf(abs(z_sobel)))

    return {
        "x": req.x, "mediador": req.mediador, "y": req.y,
        "n": n,
        "a": round(a,4), "sea": round(sea,4),
        "b": round(b,4), "seb": round(seb,4),
        "efecto_indirecto": round(a*b,4),
        "se_sobel": round(se_sobel,4),
        "z_sobel": round(z_sobel,4),
        "p_value": round(p_sobel,6),
        "significativo": p_sobel < 0.05,
        "nota": "El test de Sobel asume normalidad del efecto indirecto. Se recomienda bootstrap para muestras pequeñas.",
    }
