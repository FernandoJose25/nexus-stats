"""
Regresión lineal (simple y múltiple) y regresión logística binaria.
"""
from typing import List, Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


# ─── Modelos ──────────────────────────────────────────────────────────────────

class RegresionLinealRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    alpha: float = 0.05

class RegresionStepwiseRequest(BaseModel):
    dependiente: str
    candidatas: List[str]
    metodo: str = "both"          # "forward" | "backward" | "both"
    criterio: str = "aic"         # "aic" | "bic" | "p_value"
    p_entrada: float = 0.05       # p-valor para entrar (forward)
    p_salida: float = 0.10        # p-valor para salir (backward)
    alpha: float = 0.05

class RegresionLogisticaRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    alpha: float = 0.05


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

def _check_col(df, col):
    if col not in df.columns:
        raise HTTPException(400, detail=f"Variable '{col}' no encontrada")

def _check_numeric(df, col):
    if not pd.api.types.is_numeric_dtype(df[col]):
        raise HTTPException(400, detail=f"Variable '{col}' debe ser numérica")


# ─── Regresión lineal ─────────────────────────────────────────────────────────

@router.post("/lineal")
def regresion_lineal(req: RegresionLinealRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_numeric(df, req.dependiente)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    if not req.independientes:
        raise HTTPException(400, detail="Selecciona al menos una variable independiente")
    if req.dependiente in req.independientes:
        raise HTTPException(400, detail="La variable dependiente no puede ser también independiente")
    if len(set(req.independientes)) != len(req.independientes):
        raise HTTPException(400, detail="Variables independientes duplicadas")

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna()
    n = len(sub)
    k = len(req.independientes)

    if n < k + 2:
        raise HTTPException(400, detail=f"Se necesitan al menos {k + 2} observaciones completas")

    y = sub[req.dependiente].values
    X_raw = sub[req.independientes].values
    # Añadir constante
    X = np.column_stack([np.ones(n), X_raw])

    # OLS: β = (XᵀX)⁻¹Xᵀy
    try:
        XtX_inv = np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        raise HTTPException(400, detail="Multicolinealidad perfecta: no se puede invertir la matriz")

    beta = XtX_inv @ X.T @ y
    y_pred = X @ beta
    residuos = y - y_pred

    # Estadísticos globales
    ss_res = float(np.sum(residuos ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    ss_reg = ss_tot - ss_res

    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    r2_adj = 1 - (1 - r2) * (n - 1) / (n - k - 1)

    mse = ss_res / (n - k - 1)
    rmse = float(np.sqrt(mse))

    # F global
    if k > 0 and ss_res > 0:
        f_stat = (ss_reg / k) / (ss_res / (n - k - 1))
        f_p = float(stats.f.sf(f_stat, k, n - k - 1))
    else:
        f_stat = 0.0
        f_p = 1.0

    # Errores estándar y t por coeficiente
    se = np.sqrt(np.diag(XtX_inv) * mse)
    t_stats = beta / se
    p_vals = [float(2 * stats.t.sf(abs(ti), df=n - k - 1)) for ti in t_stats]
    t_crit = stats.t.ppf(1 - req.alpha / 2, df=n - k - 1)

    coeficientes = []
    nombres = ["(Constante)"] + req.independientes
    for i, nombre in enumerate(nombres):
        ic_low = float(beta[i] - t_crit * se[i])
        ic_high = float(beta[i] + t_crit * se[i])
        coeficientes.append({
            "nombre": nombre,
            "b": round(float(beta[i]), 4),
            "se": round(float(se[i]), 4),
            "t": round(float(t_stats[i]), 4),
            "p_value": round(p_vals[i], 4),
            "significativo": bool(p_vals[i] < req.alpha),
            "ic_low": round(ic_low, 4),
            "ic_high": round(ic_high, 4),
        })

    # Durbin-Watson
    dw = float(np.sum(np.diff(residuos) ** 2) / ss_res) if ss_res > 0 else 0.0

    # Coeficientes estandarizados (beta)
    coef_std = []
    for i, v in enumerate(req.independientes):
        sd_x = float(sub[v].std(ddof=1))
        sd_y = float(sub[req.dependiente].std(ddof=1))
        b_std = float(beta[i + 1]) * (sd_x / sd_y) if sd_y > 0 else 0.0
        coef_std.append(round(b_std, 4))

    # ── VIF y Tolerancia ──────────────────────────────────────────────────────
    vif_data = []
    if k >= 2:
        for j, v in enumerate(req.independientes):
            # R² de la regresión de X_j sobre el resto de X
            otros = [req.independientes[i] for i in range(k) if i != j]
            X_otros = np.column_stack([np.ones(n)] + [sub[o].values for o in otros])
            x_j = sub[v].values
            try:
                b_vif = np.linalg.lstsq(X_otros, x_j, rcond=None)[0]
                y_vif = X_otros @ b_vif
                ss_r = float(np.sum((x_j - y_vif) ** 2))
                ss_t = float(np.sum((x_j - x_j.mean()) ** 2))
                r2_vif = 1 - ss_r / ss_t if ss_t > 0 else 0.0
                vif = 1 / (1 - r2_vif) if r2_vif < 1 else float('inf')
            except Exception:
                vif = float('inf')
            tolerancia = 1 / vif if vif > 0 else 0.0
            vif_data.append({
                "variable": v,
                "vif": round(float(vif), 4) if not np.isinf(vif) else 999.0,
                "tolerancia": round(float(tolerancia), 4),
                "alerta": "alta multicolinealidad" if vif > 10 else "moderada" if vif > 5 else "aceptable",
            })
    else:
        vif_data = [{"variable": req.independientes[0], "vif": 1.0, "tolerancia": 1.0, "alerta": "aceptable"}]

    # ── Hat matrix (leverage) y Cook's D ─────────────────────────────────────
    H = X @ XtX_inv @ X.T                        # matriz hat n×n
    hat = np.diag(H)                              # leverage h_ii
    residuos_std = residuos / (np.sqrt(mse * (1 - hat + 1e-10)))   # residuos estudentizados internos
    p_hat = k + 1                                 # número de parámetros
    cooks_d = (residuos_std ** 2 / p_hat) * (hat / (1 - hat + 1e-10))

    # Umbral de Cook: 4/n
    umbral_cook = 4 / n
    umbral_leverage = 2 * p_hat / n

    # Casos influyentes (máx 20 para no saturar la respuesta)
    idx_influyentes = np.where(cooks_d > umbral_cook)[0]
    casos_influyentes = [
        {
            "obs": int(i + 1),
            "cook_d": round(float(cooks_d[i]), 4),
            "leverage": round(float(hat[i]), 4),
            "residuo_std": round(float(residuos_std[i]), 4),
            "leverage_alto": bool(hat[i] > umbral_leverage),
        }
        for i in sorted(idx_influyentes, key=lambda x: cooks_d[x], reverse=True)[:20]
    ]

    # ── Gráficos de diagnóstico (datos para Plotly) ───────────────────────────
    step = max(1, n // 300)
    idx_s = list(range(0, n, step))

    diag = {
        # 1. Residuos vs. ajustados
        "residuos_vs_ajustados": {
            "x": [round(float(y_pred[i]), 4) for i in idx_s],
            "y": [round(float(residuos[i]), 4) for i in idx_s],
            "obs": [int(i + 1) for i in idx_s],
        },
        # 2. Q-Q plot (residuos estudentizados)
        "qq": _qq_data(residuos_std),
        # 3. Escala-localización (sqrt |residuos std| vs ajustados)
        "scale_location": {
            "x": [round(float(y_pred[i]), 4) for i in idx_s],
            "y": [round(float(abs(residuos_std[i]) ** 0.5), 4) for i in idx_s],
        },
        # 4. Residuos vs. leverage
        "residuos_vs_leverage": {
            "x": [round(float(hat[i]), 4) for i in idx_s],
            "y": [round(float(residuos_std[i]), 4) for i in idx_s],
            "cook": [round(float(cooks_d[i]), 4) for i in idx_s],
            "umbral_leverage": round(float(umbral_leverage), 4),
            "umbral_cook": round(float(umbral_cook), 4),
        },
    }

    return {
        "tipo": "Regresión lineal " + ("simple" if k == 1 else "múltiple"),
        "dependiente": req.dependiente,
        "independientes": req.independientes,
        "n": int(n),
        "k": int(k),
        "r2": round(r2, 4),
        "r2_ajustado": round(float(r2_adj), 4),
        "r": round(float(np.sqrt(abs(r2))), 4),
        "rmse": round(rmse, 4),
        "f_stat": round(float(f_stat), 4),
        "f_gl1": int(k),
        "f_gl2": int(n - k - 1),
        "f_p_value": round(f_p, 4),
        "f_significativo": bool(f_p < req.alpha),
        "coeficientes": coeficientes,
        "coef_estandarizados": coef_std,
        "durbin_watson": round(dw, 4),
        "vif": vif_data,
        "multicolinealidad_ok": bool(all(v["vif"] <= 10 for v in vif_data)),
        "casos_influyentes": casos_influyentes,
        "n_influyentes": len(casos_influyentes),
        "umbral_cook": round(float(umbral_cook), 4),
        "umbral_leverage": round(float(umbral_leverage), 4),
        "diagnosticos": diag,
        "alpha": req.alpha,
    }


def _qq_data(residuos_std: np.ndarray) -> dict:
    """Genera puntos teóricos vs. observados para Q-Q plot normal."""
    n = len(residuos_std)
    ordenados = np.sort(residuos_std)
    # Cuantiles teóricos (aproximación de Blom)
    probs = (np.arange(1, n + 1) - 0.375) / (n + 0.25)
    teoricos = stats.norm.ppf(probs)
    step = max(1, n // 200)
    return {
        "teoricos": [round(float(v), 4) for v in teoricos[::step]],
        "observados": [round(float(v), 4) for v in ordenados[::step]],
    }


# ─── Regresión stepwise ───────────────────────────────────────────────────────

@router.post("/stepwise")
def regresion_stepwise(req: RegresionStepwiseRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_numeric(df, req.dependiente)
    for v in req.candidatas:
        _check_col(df, v)
        _check_numeric(df, v)

    if not req.candidatas:
        raise HTTPException(400, detail="Selecciona variables candidatas")
    if req.dependiente in req.candidatas:
        raise HTTPException(400, detail="La dependiente no puede ser candidata")

    cols = [req.dependiente] + req.candidatas
    sub = df[cols].dropna()
    n = len(sub)
    if n < len(req.candidatas) + 2:
        raise HTTPException(400, detail="Observaciones insuficientes")

    y = sub[req.dependiente].values.astype(float)

    def _ols_metrics(vars_in):
        if not vars_in:
            ss_tot = float(np.sum((y - y.mean()) ** 2))
            ll = -n / 2 * np.log(2 * np.pi * ss_tot / n + 1e-10) - n / 2
            return {"r2": 0.0, "r2_adj": 0.0, "aic": 2 * 0 - 2 * ll, "bic": 0, "f_p": 1.0, "rmse": float(np.std(y, ddof=1))}
        X = np.column_stack([np.ones(n)] + [sub[v].values for v in vars_in])
        k = len(vars_in)
        try:
            beta = np.linalg.lstsq(X, y, rcond=None)[0]
        except Exception:
            return None
        y_pred = X @ beta
        res = y - y_pred
        ss_res = float(np.sum(res ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        r2_adj = 1 - (1 - r2) * (n - 1) / (n - k - 1)
        mse = ss_res / (n - k - 1) if n > k + 1 else 1e10
        ll = -n / 2 * np.log(2 * np.pi * mse + 1e-10) - n / 2
        aic = 2 * (k + 1) - 2 * ll
        bic = (k + 1) * np.log(n) - 2 * ll
        # F global
        if k > 0 and ss_res > 0:
            f_stat = ((ss_tot - ss_res) / k) / (ss_res / (n - k - 1))
            f_p = float(stats.f.sf(f_stat, k, n - k - 1))
        else:
            f_p = 1.0
        return {"r2": round(r2, 4), "r2_adj": round(r2_adj, 4), "aic": round(aic, 4), "bic": round(bic, 4), "f_p": round(f_p, 4), "rmse": round(float(np.sqrt(mse)), 4)}

    def _p_value_var(var, vars_in):
        """p-valor de la variable en el modelo actual."""
        all_vars = vars_in + [var]
        X = np.column_stack([np.ones(n)] + [sub[v].values for v in all_vars])
        k = len(all_vars)
        try:
            XtX_inv = np.linalg.inv(X.T @ X)
        except Exception:
            return 1.0
        beta = XtX_inv @ X.T @ y
        res = y - X @ beta
        mse = float(np.sum(res ** 2)) / (n - k - 1) if n > k + 1 else 1e10
        se = np.sqrt(np.diag(XtX_inv) * mse)
        t_stat = beta[-1] / se[-1] if se[-1] > 0 else 0.0
        return float(2 * stats.t.sf(abs(t_stat), df=n - k - 1))

    # ── Selección de variables ────────────────────────────────────────────────
    in_model = []
    pasos = []
    candidatas = list(req.candidatas)

    if req.metodo == "backward":
        in_model = list(candidatas)

    max_iter = len(candidatas) * 3
    for iteration in range(max_iter):
        accion = None

        # Forward: intentar agregar
        if req.metodo in ("forward", "both"):
            fuera = [v for v in candidatas if v not in in_model]
            mejor_p, mejor_var = 1.0, None
            for v in fuera:
                p = _p_value_var(v, in_model)
                if p < mejor_p:
                    mejor_p, mejor_var = p, v
            if mejor_var and mejor_p < req.p_entrada:
                in_model.append(mejor_var)
                m = _ols_metrics(in_model)
                pasos.append({"paso": iteration + 1, "accion": "entra", "variable": mejor_var, "p_value": round(mejor_p, 4), **m})
                accion = "entra"

        # Backward: intentar eliminar
        if req.metodo in ("backward", "both") and len(in_model) > 0:
            peor_p, peor_var = 0.0, None
            for v in list(in_model):
                resto = [x for x in in_model if x != v]
                if not resto:
                    continue
                p = _p_value_var(v, resto)
                if p > peor_p:
                    peor_p, peor_var = p, v
            if peor_var and peor_p > req.p_salida:
                in_model.remove(peor_var)
                m = _ols_metrics(in_model)
                pasos.append({"paso": iteration + 1, "accion": "sale", "variable": peor_var, "p_value": round(peor_p, 4), **m})
                accion = "sale"

        if accion is None:
            break

    # Modelo final
    if not in_model:
        raise HTTPException(400, detail="Ninguna variable supera el criterio de entrada")

    final = _ols_metrics(in_model)

    # Coeficientes finales
    X_fin = np.column_stack([np.ones(n)] + [sub[v].values for v in in_model])
    k_fin = len(in_model)
    XtX_inv = np.linalg.inv(X_fin.T @ X_fin)
    beta_fin = XtX_inv @ X_fin.T @ y
    res_fin = y - X_fin @ beta_fin
    mse_fin = float(np.sum(res_fin ** 2)) / (n - k_fin - 1)
    se_fin = np.sqrt(np.diag(XtX_inv) * mse_fin)
    t_crit = stats.t.ppf(1 - req.alpha / 2, df=n - k_fin - 1)
    coeficientes = []
    nombres = ["(Constante)"] + in_model
    for i, nombre in enumerate(nombres):
        p = float(2 * stats.t.sf(abs(beta_fin[i] / se_fin[i]), df=n - k_fin - 1))
        coeficientes.append({
            "nombre": nombre, "b": round(float(beta_fin[i]), 4),
            "se": round(float(se_fin[i]), 4), "t": round(float(beta_fin[i] / se_fin[i]), 4),
            "p_value": round(p, 4), "significativo": bool(p < req.alpha),
            "ic_low": round(float(beta_fin[i] - t_crit * se_fin[i]), 4),
            "ic_high": round(float(beta_fin[i] + t_crit * se_fin[i]), 4),
        })

    # Variables excluidas
    excluidas = [v for v in candidatas if v not in in_model]
    excluidas_info = []
    for v in excluidas:
        p = _p_value_var(v, in_model)
        excluidas_info.append({"variable": v, "p_si_entra": round(p, 4)})

    return {
        "tipo": f"Regresión stepwise ({req.metodo.capitalize()})",
        "dependiente": req.dependiente,
        "candidatas": req.candidatas,
        "metodo": req.metodo,
        "variables_seleccionadas": in_model,
        "variables_excluidas": excluidas_info,
        "n": int(n),
        "k": k_fin,
        **final,
        "coeficientes": coeficientes,
        "pasos": pasos,
        "alpha": req.alpha,
    }


# ─── Regresión logística binaria ──────────────────────────────────────────────

@router.post("/logistica")
def regresion_logistica(req: RegresionLogisticaRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    if not req.independientes:
        raise HTTPException(400, detail="Selecciona al menos una variable independiente")

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)

    # Codificar variable dependiente como 0/1
    y_raw = sub[req.dependiente]
    categorias = y_raw.unique()
    if len(categorias) != 2:
        raise HTTPException(400, detail=f"La variable dependiente debe tener exactamente 2 categorías (encontradas: {len(categorias)})")

    cat_sorted = sorted([str(c) for c in categorias])
    sub["_y"] = (y_raw.astype(str) == cat_sorted[1]).astype(int)
    y = sub["_y"].values
    X_raw = sub[req.independientes].values

    if n < len(req.independientes) + 10:
        raise HTTPException(400, detail=f"Se necesitan más observaciones (mínimo {len(req.independientes) + 10})")

    # Descenso de gradiente con regularización L2 mínima (Newton-Raphson)
    from scipy.optimize import minimize

    def sigmoid(z):
        return 1 / (1 + np.exp(-np.clip(z, -500, 500)))

    def neg_log_likelihood(w):
        z = X_ext @ w
        prob = sigmoid(z)
        eps = 1e-10
        return -np.sum(y * np.log(prob + eps) + (1 - y) * np.log(1 - prob + eps))

    X_ext = np.column_stack([np.ones(n), X_raw])
    w0 = np.zeros(X_ext.shape[1])
    res = minimize(neg_log_likelihood, w0, method='BFGS', options={'maxiter': 500})
    beta = res.x

    z = X_ext @ beta
    prob = sigmoid(z)
    y_pred_class = (prob >= 0.5).astype(int)

    # Log-likelihood y pseudo R²
    ll = -neg_log_likelihood(beta)
    ll_null = float(n * (np.mean(y) * np.log(np.mean(y) + 1e-10) + (1 - np.mean(y)) * np.log(1 - np.mean(y) + 1e-10)))
    nagelkerke_r2 = (1 - np.exp((ll_null - ll) * 2 / n)) / (1 - np.exp(ll_null * 2 / n))

    # Errores estándar por Hessiano numérico
    from scipy.optimize import approx_fprime

    def hessian_diag(f, x, eps=1e-5):
        diag = np.zeros(len(x))
        for i in range(len(x)):
            e = np.zeros(len(x))
            e[i] = eps
            diag[i] = (f(x + e) - 2 * f(x) + f(x - e)) / eps ** 2
        return diag

    try:
        hd = hessian_diag(neg_log_likelihood, beta)
        se = np.sqrt(np.abs(1.0 / np.maximum(hd, 1e-10)))
    except Exception:
        se = np.full(len(beta), np.nan)

    z_crit = stats.norm.ppf(1 - req.alpha / 2)
    wald = beta / np.where(se > 0, se, np.nan)
    p_vals = [float(2 * stats.norm.sf(abs(w))) for w in wald]

    coeficientes = []
    nombres = ["(Constante)"] + req.independientes
    for i, nombre in enumerate(nombres):
        coeficientes.append({
            "nombre": nombre,
            "b": round(float(beta[i]), 4),
            "se": round(float(se[i]), 4),
            "wald": round(float(wald[i]), 4) if not np.isnan(wald[i]) else None,
            "p_value": round(p_vals[i], 4),
            "significativo": bool(p_vals[i] < req.alpha),
            "odds_ratio": round(float(np.exp(beta[i])), 4),
            "ic_or_low": round(float(np.exp(beta[i] - z_crit * se[i])), 4),
            "ic_or_high": round(float(np.exp(beta[i] + z_crit * se[i])), 4),
        })

    # Matriz de confusión
    tp = int(np.sum((y == 1) & (y_pred_class == 1)))
    tn = int(np.sum((y == 0) & (y_pred_class == 0)))
    fp = int(np.sum((y == 0) & (y_pred_class == 1)))
    fn = int(np.sum((y == 1) & (y_pred_class == 0)))
    accuracy = (tp + tn) / n

    return {
        "tipo": "Regresión logística binaria",
        "dependiente": req.dependiente,
        "categorias": cat_sorted,
        "independientes": req.independientes,
        "n": int(n),
        "k": len(req.independientes),
        "nagelkerke_r2": round(float(nagelkerke_r2), 4),
        "log_likelihood": round(float(ll), 4),
        "coeficientes": coeficientes,
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "accuracy": round(float(accuracy), 4),
        "alpha": req.alpha,
    }


# ─── Regresión logística multinomial ─────────────────────────────────────────

class RegresionMultinomialRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    alpha: float = 0.05


@router.post("/multinomial")
def regresion_multinomial(req: RegresionMultinomialRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    if not req.independientes:
        raise HTTPException(400, detail="Selecciona al menos una variable independiente")

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)
    k = len(req.independientes)

    categorias_raw = sorted(sub[req.dependiente].astype(str).unique().tolist())
    n_clases = len(categorias_raw)

    if n_clases < 3:
        raise HTTPException(400, detail=f"Usa regresión logística binaria para 2 categorías. Esta variable tiene {n_clases}.")
    if n_clases > 20:
        raise HTTPException(400, detail="Demasiadas categorías (máximo 20)")
    if n < (n_clases * k) + 10:
        raise HTTPException(400, detail="Insuficientes observaciones para el número de clases y predictores")

    # Codificar Y como enteros 0..C-1
    cat_map = {c: i for i, c in enumerate(categorias_raw)}
    y = sub[req.dependiente].astype(str).map(cat_map).values.astype(int)
    X_raw = sub[req.independientes].values.astype(float)

    # Estandarizar X para mejor convergencia
    X_mean = X_raw.mean(axis=0)
    X_std = X_raw.std(axis=0, ddof=1)
    X_std[X_std == 0] = 1
    X_std_scaled = (X_raw - X_mean) / X_std

    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import label_binarize

        clf = LogisticRegression(
            multi_class='multinomial',
            solver='lbfgs',
            max_iter=1000,
            C=1e6,   # sin regularizacion efectiva
            random_state=42,
        )
        clf.fit(X_std_scaled, y)

        y_pred = clf.predict(X_std_scaled)
        proba = clf.predict_proba(X_std_scaled)

        accuracy = float(np.mean(y_pred == y))

        # Log-likelihood
        eps = 1e-10
        ll = float(np.sum(np.log(proba[np.arange(n), y] + eps)))
        # Log-likelihood nulo
        pi_null = np.bincount(y, minlength=n_clases) / n
        ll_null = float(np.sum(np.log(pi_null[y] + eps)))

        # McFadden R²
        mcfadden_r2 = 1 - ll / ll_null if ll_null != 0 else 0.0
        # Nagelkerke R²
        cox_r2 = 1 - np.exp((ll_null - ll) * 2 / n)
        cox_max = 1 - np.exp(2 * ll_null / n)
        nagelkerke_r2 = cox_r2 / cox_max if cox_max != 0 else 0.0

        # Coeficientes: sklearn usa categorías 0..C-1 como referencia la última
        # coef_ shape: (C-1, k) para multinomial con referencia a la última clase
        # Para mostrarlos devolveremos todos los pares (clase vs. ref)
        categoria_ref = categorias_raw[-1]
        coeficientes_por_clase = []
        for c_idx in range(n_clases - 1):
            clase_label = categorias_raw[c_idx]
            coefs_clase = []
            # Intercept
            intercept_std = float(clf.intercept_[c_idx])
            coefs_clase.append({
                "nombre": "(Constante)",
                "b": round(intercept_std, 4),
                "odds_ratio": round(float(np.exp(intercept_std)), 4),
            })
            for j, v in enumerate(req.independientes):
                # Desescalar coeficiente a escala original
                b_std = float(clf.coef_[c_idx, j])
                b_orig = b_std / X_std[j]
                coefs_clase.append({
                    "nombre": v,
                    "b": round(b_orig, 4),
                    "b_estandarizado": round(b_std, 4),
                    "odds_ratio": round(float(np.exp(b_orig)), 4),
                })
            coeficientes_por_clase.append({
                "clase": clase_label,
                "referencia": categoria_ref,
                "coeficientes": coefs_clase,
            })

        # Distribución de clases
        dist_clases = []
        for c_idx, c in enumerate(categorias_raw):
            n_c = int(np.sum(y == c_idx))
            dist_clases.append({
                "clase": c, "n": n_c,
                "pct": round(n_c / n * 100, 1),
                "pred_pct": round(float(np.mean(proba[:, c_idx])) * 100, 1),
            })

        # Matriz de confusión completa
        confusion = np.zeros((n_clases, n_clases), dtype=int)
        for t, p in zip(y, y_pred):
            confusion[t, p] += 1

        return {
            "tipo": "Regresión logística multinomial",
            "dependiente": req.dependiente,
            "categorias": categorias_raw,
            "categoria_referencia": categoria_ref,
            "independientes": req.independientes,
            "n": int(n),
            "n_clases": int(n_clases),
            "k": k,
            "mcfadden_r2": round(float(mcfadden_r2), 4),
            "nagelkerke_r2": round(float(nagelkerke_r2), 4),
            "log_likelihood": round(ll, 4),
            "accuracy": round(accuracy, 4),
            "coeficientes_por_clase": coeficientes_por_clase,
            "distribucion_clases": dist_clases,
            "confusion": {
                "clases": categorias_raw,
                "matrix": confusion.tolist(),
            },
            "alpha": req.alpha,
        }

    except ImportError:
        raise HTTPException(500, detail="scikit-learn no está instalado. Ejecuta: pip install scikit-learn")


# ─── Regresión logística ordinal (modelo de odds proporcionales) ──────────────

class RegresionOrdinalRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    alpha: float = 0.05


@router.post("/ordinal")
def regresion_ordinal(req: RegresionOrdinalRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    if not req.independientes:
        raise HTTPException(400, detail="Selecciona al menos una variable independiente")

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)
    k = len(req.independientes)

    # Ordenar categorías
    cats_raw = sorted(sub[req.dependiente].astype(str).unique().tolist())
    n_cats = len(cats_raw)
    if n_cats < 3:
        raise HTTPException(400, detail=f"Regresión ordinal requiere ≥3 categorías ordenadas. Esta variable tiene {n_cats}. Usa logística binaria.")
    if n_cats > 15:
        raise HTTPException(400, detail="Demasiadas categorías (máximo 15)")

    try:
        from sklearn.linear_model import LogisticRegression
        from scipy.optimize import minimize as sp_min

        cat_map = {c: i for i, c in enumerate(cats_raw)}
        y = sub[req.dependiente].astype(str).map(cat_map).values.astype(int)
        X = sub[req.independientes].values.astype(float)

        # Estandarizar
        X_m = X.mean(axis=0); X_s = X.std(axis=0, ddof=1); X_s[X_s==0] = 1
        Xs = (X - X_m) / X_s

        # Modelo de odds proporcionales (ordenado) mediante optimización directa
        # Parámetros: k betas + (J-1) thresholds (umbrales)
        J = n_cats

        def sigmoid(z): return 1 / (1 + np.exp(-np.clip(z, -500, 500)))

        def neg_ll(params):
            betas = params[:k]
            thresholds_raw = params[k:]
            # Asegurar que thresholds sean crecientes via softplus acumulado
            thresholds = np.cumsum(np.exp(thresholds_raw))
            xb = Xs @ betas
            ll = 0.0
            for i in range(n):
                j = y[i]
                if j == 0:
                    p = sigmoid(thresholds[0] - xb[i])
                elif j == J - 1:
                    p = 1 - sigmoid(thresholds[J - 2] - xb[i])
                else:
                    p = sigmoid(thresholds[j] - xb[i]) - sigmoid(thresholds[j-1] - xb[i])
                ll += np.log(max(p, 1e-10))
            return -ll

        # Init: thresholds espaciados uniformemente, betas=0
        init_thresh = np.log(np.ones(J - 1))  # exp(0)=1, cumsum da [1,2,...]
        w0 = np.zeros(k + J - 1)
        w0[k:] = init_thresh

        res = sp_min(neg_ll, w0, method='L-BFGS-B', options={'maxiter': 500})
        params = res.x
        betas = params[:k]
        thresholds_raw = params[k:]
        thresholds = np.cumsum(np.exp(thresholds_raw))

        # Desescalar betas
        betas_orig = betas / X_s

        # Errores estándar (Hessiano numérico)
        eps = 1e-5
        hess_diag = np.zeros(len(params))
        f0 = neg_ll(params)
        for i in range(len(params)):
            e = np.zeros(len(params)); e[i] = eps
            hess_diag[i] = (neg_ll(params+e) - 2*f0 + neg_ll(params-e)) / eps**2
        se_params = np.sqrt(np.abs(1 / np.maximum(hess_diag, 1e-10)))
        se_betas = se_params[:k] / X_s

        z_crit = stats.norm.ppf(1 - req.alpha / 2)
        coeficientes = []
        for j, v in enumerate(req.independientes):
            z = betas_orig[j] / se_betas[j] if se_betas[j] > 0 else 0.0
            p = float(2 * stats.norm.sf(abs(z)))
            coeficientes.append({
                "nombre": v,
                "b": round(float(betas_orig[j]), 4),
                "se": round(float(se_betas[j]), 4),
                "z": round(float(z), 4),
                "p_value": round(p, 4),
                "significativo": bool(p < req.alpha),
                "odds_ratio": round(float(np.exp(betas_orig[j])), 4),
                "ic_or_low": round(float(np.exp(betas_orig[j] - z_crit * se_betas[j])), 4),
                "ic_or_high": round(float(np.exp(betas_orig[j] + z_crit * se_betas[j])), 4),
            })

        # Umbrales en escala original
        umbrales_out = [{"entre": f"{cats_raw[j]} | {cats_raw[j+1]}", "umbral": round(float(thresholds[j]), 4)} for j in range(J-1)]

        # Log-likelihood y pseudo R²
        ll = -res.fun
        pi_null = np.bincount(y) / n
        ll_null = float(np.sum(np.log(pi_null[y] + 1e-10)))
        mcfadden_r2 = 1 - ll / ll_null if ll_null != 0 else 0.0

        # Predicciones y accuracy
        def predict(xb_val, thresh):
            probs = np.zeros(J)
            probs[0] = sigmoid(thresh[0] - xb_val)
            for jj in range(1, J-1):
                probs[jj] = sigmoid(thresh[jj] - xb_val) - sigmoid(thresh[jj-1] - xb_val)
            probs[J-1] = 1 - sigmoid(thresh[J-2] - xb_val)
            return int(np.argmax(np.maximum(probs, 0)))

        xb_all = Xs @ betas
        y_pred = np.array([predict(xb_all[i], thresholds) for i in range(n)])
        accuracy = float(np.mean(y_pred == y))

        return {
            "tipo": "Regresión logística ordinal (odds proporcionales)",
            "dependiente": req.dependiente,
            "categorias": cats_raw,
            "independientes": req.independientes,
            "n": int(n),
            "n_categorias": int(n_cats),
            "k": k,
            "mcfadden_r2": round(float(mcfadden_r2), 4),
            "log_likelihood": round(float(ll), 4),
            "accuracy": round(accuracy, 4),
            "coeficientes": coeficientes,
            "umbrales": umbrales_out,
            "alpha": req.alpha,
        }

    except ImportError:
        raise HTTPException(500, detail="scikit-learn no está instalado")


# ─── Regresión de Poisson ─────────────────────────────────────────────────────

class RegresionPoissonRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    alpha: float = 0.05


@router.post("/poisson")
def regresion_poisson(req: RegresionPoissonRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_numeric(df, req.dependiente)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)
    k = len(req.independientes)

    y = sub[req.dependiente].values.astype(float)
    if np.any(y < 0):
        raise HTTPException(400, detail="La variable dependiente debe ser no negativa (conteos)")
    if np.any(y != np.round(y)):
        pass  # Advertencia, pero continuar (quasi-Poisson)

    if n < k + 5:
        raise HTTPException(400, detail=f"Se necesitan al menos {k+5} observaciones")

    X_raw = sub[req.independientes].values.astype(float)
    X = np.column_stack([np.ones(n), X_raw])

    # IRLS (Iteratively Reweighted Least Squares) para GLM Poisson (link=log)
    def irls_poisson(X, y, max_iter=100, tol=1e-6):
        beta = np.zeros(X.shape[1])
        for _ in range(max_iter):
            eta = X @ beta
            mu = np.exp(np.clip(eta, -500, 500))
            W = np.diag(mu)
            z = eta + (y - mu) / (mu + 1e-10)
            try:
                beta_new = np.linalg.solve(X.T @ W @ X, X.T @ W @ z)
            except np.linalg.LinAlgError:
                break
            if np.max(np.abs(beta_new - beta)) < tol:
                beta = beta_new
                break
            beta = beta_new
        return beta, mu

    beta, mu = irls_poisson(X, y)

    # Residuos de Pearson y devianza
    residuos_pearson = (y - mu) / np.sqrt(mu + 1e-10)
    deviance = 2 * np.sum(np.where(y > 0, y * np.log(y / (mu + 1e-10)) - (y - mu), -(y - mu)))

    # Null deviance
    mu_null = np.mean(y)
    deviance_null = 2 * np.sum(np.where(y > 0, y * np.log(y / mu_null) - (y - mu_null), -(y - mu_null)))

    # Pseudo R² (McFadden)
    ll = float(-np.sum(mu - y * np.log(mu + 1e-10)))
    ll_null = float(-np.sum(mu_null - y * np.log(mu_null + 1e-10)) * n)
    mcfadden = 1 - ll / (ll_null + 1e-10) if ll_null != 0 else 0.0

    # Errores estándar (información de Fisher)
    eta = X @ beta
    mu_cur = np.exp(np.clip(eta, -500, 500))
    W_cur = mu_cur
    try:
        fisher = X.T @ np.diag(W_cur) @ X
        cov = np.linalg.inv(fisher)
        se = np.sqrt(np.diag(cov))
    except Exception:
        se = np.full(k + 1, np.nan)

    z_crit = stats.norm.ppf(1 - req.alpha / 2)
    coeficientes = []
    nombres = ["(Constante)"] + req.independientes
    for i, nombre in enumerate(nombres):
        z = float(beta[i] / se[i]) if se[i] > 0 else 0.0
        p = float(2 * stats.norm.sf(abs(z)))
        coeficientes.append({
            "nombre": nombre,
            "b": round(float(beta[i]), 4),
            "se": round(float(se[i]), 4),
            "z": round(z, 4),
            "p_value": round(p, 4),
            "significativo": bool(p < req.alpha),
            "irr": round(float(np.exp(beta[i])), 4),    # Incidence Rate Ratio
            "ic_irr_low": round(float(np.exp(beta[i] - z_crit * se[i])), 4),
            "ic_irr_high": round(float(np.exp(beta[i] + z_crit * se[i])), 4),
        })

    # Estadístico de dispersión (Pearson chi² / df)
    dispersion = float(np.sum(residuos_pearson**2) / (n - k - 1))

    # Muestra de residuos
    step = max(1, n // 200)
    return {
        "tipo": "Regresión de Poisson (GLM, link=log)",
        "dependiente": req.dependiente,
        "independientes": req.independientes,
        "n": int(n),
        "k": k,
        "deviance": round(float(deviance), 4),
        "deviance_nula": round(float(deviance_null), 4),
        "gl_residual": int(n - k - 1),
        "mcfadden_r2": round(float(mcfadden), 4),
        "dispersion_pearson": round(dispersion, 4),
        "sobredispersion": bool(dispersion > 1.5),
        "coeficientes": coeficientes,
        "media_y": round(float(np.mean(y)), 4),
        "varianza_y": round(float(np.var(y, ddof=1)), 4),
        "alpha": req.alpha,
        "nota": "IRR = Incidence Rate Ratio (exp(B)). Si dispersión > 1.5 considera Quasi-Poisson o Binomial Negativa.",
    }


# ─── Regresión no lineal (ajuste de curvas) ───────────────────────────────────

class RegresionNoLinealRequest(BaseModel):
    dependiente: str
    independiente: str       # solo 1 variable predictora
    modelo: str = "auto"     # "auto" | "exponencial" | "potencia" | "logaritmica" | "cuadratica" | "sigmoide"
    alpha: float = 0.05


@router.post("/no-lineal")
def regresion_no_lineal(req: RegresionNoLinealRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_col(df, req.independiente)
    _check_numeric(df, req.dependiente)
    _check_numeric(df, req.independiente)

    sub = df[[req.dependiente, req.independiente]].dropna()
    n = len(sub)
    if n < 5:
        raise HTTPException(400, detail="Se necesitan al menos 5 observaciones")

    x = sub[req.independiente].values.astype(float)
    y = sub[req.dependiente].values.astype(float)

    from scipy.optimize import curve_fit

    modelos = {
        "exponencial": (lambda x, a, b: a * np.exp(b * x), [1.0, 0.01]),
        "potencia":    (lambda x, a, b: a * np.power(np.abs(x) + 1e-10, b), [1.0, 1.0]),
        "logaritmica": (lambda x, a, b: a * np.log(np.abs(x) + 1e-10) + b, [1.0, 0.0]),
        "cuadratica":  (lambda x, a, b, c: a * x**2 + b * x + c, [0.0, 1.0, 0.0]),
        "sigmoide":    (lambda x, a, b, c: a / (1 + np.exp(-b * (x - c))), [np.max(y), 0.1, np.median(x)]),
    }

    if req.modelo != "auto" and req.modelo not in modelos:
        raise HTTPException(400, detail=f"Modelo '{req.modelo}' no reconocido. Opciones: {list(modelos.keys())} o 'auto'")

    candidatos = list(modelos.keys()) if req.modelo == "auto" else [req.modelo]

    resultados_modelos = []
    for nombre, (func, p0) in modelos.items():
        if nombre not in candidatos:
            continue
        try:
            popt, pcov = curve_fit(func, x, y, p0=p0, maxfev=5000)
            y_pred = func(x, *popt)
            ss_res = float(np.sum((y - y_pred)**2))
            ss_tot = float(np.sum((y - y.mean())**2))
            r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
            rmse = float(np.sqrt(ss_res / n))
            aic = n * np.log(ss_res / n + 1e-10) + 2 * len(popt)
            resultados_modelos.append({
                "modelo": nombre,
                "r2": round(r2, 4),
                "rmse": round(rmse, 4),
                "aic": round(float(aic), 4),
                "parametros": [round(float(p), 6) for p in popt],
                "ok": True,
            })
        except Exception as e:
            resultados_modelos.append({"modelo": nombre, "ok": False, "error": str(e)})

    exitosos = [m for m in resultados_modelos if m.get("ok")]
    if not exitosos:
        raise HTTPException(400, detail="Ningún modelo pudo ajustarse a los datos")

    # Mejor modelo por AIC
    mejor = min(exitosos, key=lambda m: m["aic"])
    nombre_mejor = mejor["modelo"]
    func_mejor, p0_mejor = modelos[nombre_mejor]
    popt_mejor, _ = curve_fit(func_mejor, x, y, p0=p0_mejor, maxfev=5000)
    y_pred_mejor = func_mejor(x, *popt_mejor)

    # Curva de ajuste (200 puntos)
    x_curva = np.linspace(x.min(), x.max(), 200)
    y_curva = func_mejor(x_curva, *popt_mejor)

    step = max(1, n // 300)
    return {
        "tipo": f"Regresión no lineal — modelo {nombre_mejor}",
        "dependiente": req.dependiente,
        "independiente": req.independiente,
        "n": int(n),
        "modelo_seleccionado": nombre_mejor,
        "seleccion": "AIC mínimo" if req.modelo == "auto" else "manual",
        "r2": mejor["r2"],
        "rmse": mejor["rmse"],
        "aic": mejor["aic"],
        "parametros": mejor["parametros"],
        "comparativa_modelos": resultados_modelos,
        "scatter": {
            "x": [round(float(v), 4) for v in x[::step]],
            "y": [round(float(v), 4) for v in y[::step]],
        },
        "curva_ajuste": {
            "x": [round(float(v), 4) for v in x_curva],
            "y": [round(float(v), 4) for v in y_curva],
        },
        "alpha": req.alpha,
    }


# ─── Regresión ponderada (WLS) ────────────────────────────────────────────────

class RegresionPonderadaRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    pesos: str              # variable con los pesos (1/varianza, frecuencias, etc.)
    alpha: float = 0.05


@router.post("/ponderada")
def regresion_ponderada(req: RegresionPonderadaRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    _check_col(df, req.dependiente)
    _check_numeric(df, req.dependiente)
    _check_col(df, req.pesos)
    _check_numeric(df, req.pesos)
    for v in req.independientes:
        _check_col(df, v)
        _check_numeric(df, v)

    cols = [req.dependiente, req.pesos] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)
    k = len(req.independientes)

    if n < k + 2:
        raise HTTPException(400, detail=f"Se necesitan al menos {k+2} observaciones")

    w = sub[req.pesos].values.astype(float)
    if np.any(w <= 0):
        raise HTTPException(400, detail="Los pesos deben ser positivos")

    y = sub[req.dependiente].values.astype(float)
    X_raw = sub[req.independientes].values.astype(float)
    X = np.column_stack([np.ones(n), X_raw])

    # WLS: beta = (XᵀWX)⁻¹XᵀWy
    W = np.diag(w)
    try:
        XtWX_inv = np.linalg.inv(X.T @ W @ X)
    except np.linalg.LinAlgError:
        raise HTTPException(400, detail="Multicolinealidad perfecta en WLS")

    beta = XtWX_inv @ X.T @ W @ y
    y_pred = X @ beta
    residuos = y - y_pred

    # Estadísticos
    ss_res_w = float(np.sum(w * residuos**2))
    y_w_mean = float(np.average(y, weights=w))
    ss_tot_w = float(np.sum(w * (y - y_w_mean)**2))
    r2_w = 1 - ss_res_w / ss_tot_w if ss_tot_w > 0 else 0.0
    mse_w = ss_res_w / (n - k - 1)
    rmse_w = float(np.sqrt(mse_w))

    # F global ponderado
    ss_reg_w = ss_tot_w - ss_res_w
    f_stat = (ss_reg_w / k) / (ss_res_w / (n - k - 1)) if (k > 0 and ss_res_w > 0) else 0.0
    f_p = float(stats.f.sf(f_stat, k, n - k - 1))

    # SE, t, p
    se = np.sqrt(np.diag(XtWX_inv) * mse_w)
    t_crit = stats.t.ppf(1 - req.alpha / 2, df=n - k - 1)
    coeficientes = []
    for i, nombre in enumerate(["(Constante)"] + req.independientes):
        t = float(beta[i] / se[i]) if se[i] > 0 else 0.0
        p = float(2 * stats.t.sf(abs(t), df=n - k - 1))
        coeficientes.append({
            "nombre": nombre,
            "b": round(float(beta[i]), 4),
            "se": round(float(se[i]), 4),
            "t": round(t, 4),
            "p_value": round(p, 4),
            "significativo": bool(p < req.alpha),
            "ic_low": round(float(beta[i] - t_crit * se[i]), 4),
            "ic_high": round(float(beta[i] + t_crit * se[i]), 4),
        })

    step = max(1, n // 200)
    return {
        "tipo": "Regresión ponderada (WLS)",
        "dependiente": req.dependiente,
        "independientes": req.independientes,
        "pesos": req.pesos,
        "n": int(n),
        "k": k,
        "r2_ponderado": round(r2_w, 4),
        "rmse_ponderado": round(rmse_w, 4),
        "f_stat": round(float(f_stat), 4),
        "f_p_value": round(f_p, 4),
        "f_significativo": bool(f_p < req.alpha),
        "coeficientes": coeficientes,
        "residuos_sample": {
            "y_pred": [round(float(v), 4) for v in y_pred[::step]],
            "residuos": [round(float(v), 4) for v in residuos[::step]],
            "pesos": [round(float(v), 4) for v in w[::step]],
        },
        "alpha": req.alpha,
    }
