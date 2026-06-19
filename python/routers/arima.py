"""
ARIMA / SARIMA / Suavizado exponencial — equivalente a SPSS Forecasting module.
Identificación automática, estimación, diagnóstico y predicción.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats
from scipy.optimize import minimize

from services import data_manager

router = APIRouter()


class ArimaRequest(BaseModel):
    variable: str
    variable_tiempo: Optional[str] = None
    p: int = 1          # AR order
    d: int = 1          # Integration order
    q: int = 1          # MA order
    P: int = 0          # Seasonal AR
    D: int = 0          # Seasonal integration
    Q: int = 0          # Seasonal MA
    s: int = 0          # Seasonal period (0 = no seasonal)
    auto: bool = True   # Auto-select p,d,q via AIC
    n_pasos: int = 12   # Horizonte de predicción
    alpha: float = 0.05


class HoltWintersRequest(BaseModel):
    variable: str
    variable_tiempo: Optional[str] = None
    tipo: str = "aditivo"    # aditivo | multiplicativo | simple | doble
    s: int = 12               # Periodo estacional
    n_pasos: int = 12
    alpha: Optional[float] = None   # Nivel (None = estimar)
    beta: Optional[float] = None    # Tendencia
    gamma: Optional[float] = None   # Estacionalidad


def _diferencias(serie: np.ndarray, d: int) -> np.ndarray:
    y = serie.copy().astype(float)
    for _ in range(d):
        y = np.diff(y)
    return y


def _adf_test(serie: np.ndarray) -> dict:
    """Augmented Dickey-Fuller simplificado."""
    n = len(serie)
    if n < 10:
        return {'statistic': np.nan, 'p_value': 1.0, 'estacionaria': False}

    dy = np.diff(serie)
    y_lag = serie[:-1]
    n2 = len(dy)

    # Regresión dy = a*y_lag + const
    X = np.column_stack([y_lag, np.ones(n2)])
    try:
        b = np.linalg.lstsq(X, dy, rcond=None)[0]
        res = dy - X @ b
        s2 = float(np.sum(res**2) / (n2 - 2))
        var_b = s2 * np.linalg.inv(X.T @ X)
        t_stat = float(b[0] / np.sqrt(var_b[0, 0]))
    except Exception:
        return {'statistic': np.nan, 'p_value': 1.0, 'estacionaria': False}

    # p-value aproximado con distribución normal (aproximación)
    p_val = float(2 * stats.norm.sf(abs(t_stat)))
    return {
        'statistic': round(t_stat, 4),
        'p_value': round(p_val, 4),
        'estacionaria': p_val < 0.05,
    }


def _ljung_box(residuos: np.ndarray, lags: int = 10) -> dict:
    n = len(residuos)
    acf_vals = []
    for k in range(1, lags + 1):
        if n - k > 0:
            c = np.corrcoef(residuos[:-k], residuos[k:])[0, 1]
            acf_vals.append(c)
        else:
            acf_vals.append(0.0)
    Q = n * (n + 2) * sum(r**2 / (n - k) for k, r in enumerate(acf_vals, 1))
    p_val = float(stats.chi2.sf(Q, lags))
    return {'Q_stat': round(Q, 4), 'p_value': round(p_val, 4), 'lags': lags,
            'residuos_independientes': p_val > 0.05}


def _arma_loglik(params, y, p, q):
    """Log-likelihood para ARMA(p,q) por mínimos cuadrados condicionales."""
    n = len(y)
    if p + q == 0:
        sigma2 = np.var(y)
        return -0.5 * n * (np.log(2 * np.pi * sigma2) + 1)

    ar_params = params[:p]
    ma_params = params[p:p+q]
    sigma2    = max(params[p+q]**2, 1e-8)

    residuos = np.zeros(n)
    for t in range(max(p, q), n):
        pred = 0.0
        for i, a in enumerate(ar_params):
            pred += a * y[t - i - 1]
        for j, m in enumerate(ma_params):
            if t - j - 1 >= 0:
                pred += m * residuos[t - j - 1]
        residuos[t] = y[t] - pred

    r = residuos[max(p, q):]
    ll = -0.5 * len(r) * np.log(2 * np.pi * sigma2) - 0.5 * np.sum(r**2) / sigma2
    return -ll   # negativo para minimizar


def _fit_arma(y: np.ndarray, p: int, q: int):
    """Estima ARMA(p,q) con optimización numérica."""
    n_params = p + q + 1
    x0 = np.concatenate([
        np.zeros(p), np.zeros(q), [np.std(y)]
    ])
    bounds = [(-0.99, 0.99)] * (p + q) + [(1e-6, None)]
    try:
        res = minimize(_arma_loglik, x0, args=(y, p, q), method='L-BFGS-B', bounds=bounds,
                       options={'maxiter': 500, 'ftol': 1e-9})
        return res.x, -res.fun
    except Exception:
        return x0, np.nan


def _aic(ll, n_params):
    return -2 * ll + 2 * n_params


def _bic(ll, n_params, n):
    return -2 * ll + n_params * np.log(n)


def _auto_arima(y: np.ndarray, max_p=3, max_q=3):
    """Selecciona (p,d,q) por AIC mínimo."""
    # Determinar d por ADF
    d = 0
    y_diff = y.copy()
    for _ in range(2):
        adf = _adf_test(y_diff)
        if adf['estacionaria']:
            break
        y_diff = np.diff(y_diff)
        d += 1

    best_aic = np.inf
    best_pdq = (1, d, 1)
    best_params = None
    best_ll = None

    for p in range(0, max_p + 1):
        for q in range(0, max_q + 1):
            if p == 0 and q == 0:
                continue
            try:
                params, ll = _fit_arma(y_diff, p, q)
                aic = _aic(ll, p + q + 1)
                if aic < best_aic:
                    best_aic = aic
                    best_pdq = (p, d, q)
                    best_params = params
                    best_ll = ll
            except Exception:
                continue

    return best_pdq, best_params, best_ll, best_aic


@router.post("/ajustar")
def ajustar_arima(req: ArimaRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.variable not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable}' no encontrada")

    serie_raw = df[req.variable].dropna().values.astype(float)
    n = len(serie_raw)

    if n < 10:
        raise HTTPException(status_code=400, detail="Se necesitan al menos 10 observaciones")

    # ADF antes de diferenciar
    adf_orig = _adf_test(serie_raw)

    if req.auto:
        (p, d, q), params, ll, aic_val = _auto_arima(serie_raw)
    else:
        p, d, q = req.p, req.d, req.q
        y_diff = _diferencias(serie_raw, d)
        params, ll = _fit_arma(y_diff, p, q)
        aic_val = _aic(ll, p + q + 1) if not np.isnan(ll) else np.nan

    y_diff = _diferencias(serie_raw, d)
    bic_val = _bic(ll, p + q + 1, len(y_diff)) if not np.isnan(ll) else np.nan

    # Calcular residuos del modelo ajustado
    ar_params = params[:p] if params is not None else []
    ma_params = params[p:p+q] if params is not None else []
    y_fit = y_diff.copy()
    residuos = np.zeros(len(y_diff))
    for t in range(max(p, q), len(y_diff)):
        pred = 0.0
        for i, a in enumerate(ar_params):
            pred += a * y_fit[t - i - 1]
        for j, m in enumerate(ma_params):
            if t - j - 1 >= 0:
                pred += m * residuos[t - j - 1]
        residuos[t] = y_diff[t] - pred

    # Ljung-Box
    ljung = _ljung_box(residuos[max(p,q):])

    # Predicción: extender la serie diferenciada y des-diferenciar
    pred_diff = []
    y_ext = list(y_diff)
    res_ext = list(residuos)
    for _ in range(req.n_pasos):
        pred = 0.0
        for i, a in enumerate(ar_params):
            pred += a * y_ext[-(i+1)]
        for j, m in enumerate(ma_params):
            pred += m * res_ext[-(j+1)]
        y_ext.append(pred)
        res_ext.append(0.0)
        pred_diff.append(pred)

    # Des-diferenciar predicciones
    predicciones = []
    last_vals = list(serie_raw[-d:]) if d > 0 else list(serie_raw[-1:])
    y_rec = serie_raw[-1]
    for pd_val in pred_diff:
        y_rec = y_rec + pd_val if d >= 1 else pd_val
        predicciones.append(round(float(y_rec), 4))

    # IC de predicción (±1.96 * std residuos)
    se_pred = float(np.std(residuos[max(p,q):]))
    z95 = 1.96
    pred_lo = [round(v - z95 * se_pred, 4) for v in predicciones]
    pred_hi = [round(v + z95 * se_pred, 4) for v in predicciones]

    # Índices para el gráfico
    idx_hist = list(range(n))
    idx_pred = list(range(n, n + req.n_pasos))

    return {
        'tipo': f'ARIMA({p},{d},{q})',
        'variable': req.variable,
        'n': n,
        'p': p, 'd': d, 'q': q,
        'auto': req.auto,
        'aic': round(float(aic_val), 4) if not np.isnan(aic_val) else None,
        'bic': round(float(bic_val), 4) if not np.isnan(bic_val) else None,
        'coeficientes': {
            'AR': [round(float(a), 4) for a in ar_params],
            'MA': [round(float(m), 4) for m in ma_params],
        },
        'diagnosticos': {
            'adf_original': adf_orig,
            'ljung_box': ljung,
            'rmse': round(float(np.sqrt(np.mean(residuos[max(p,q):]**2))), 4),
            'mae': round(float(np.mean(np.abs(residuos[max(p,q):]))), 4),
        },
        'serie_historica': {
            'indices': idx_hist,
            'valores': [round(float(v), 4) for v in serie_raw],
        },
        'prediccion': {
            'indices': idx_pred,
            'valores': predicciones,
            'ic_low': pred_lo,
            'ic_high': pred_hi,
            'n_pasos': req.n_pasos,
        },
        'residuos': {
            'valores': [round(float(r), 4) for r in residuos[max(p,q):]],
        },
    }


@router.post("/holt-winters")
def holt_winters(req: HoltWintersRequest):
    """Suavizado exponencial: simple, doble (Holt) y triple (Holt-Winters)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.variable not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable}' no encontrada")

    y = df[req.variable].dropna().values.astype(float)
    n = len(y)

    alpha = req.alpha or 0.3
    beta  = req.beta  or 0.1
    gamma = req.gamma or 0.1
    s     = req.s

    if req.tipo == 'simple':
        # Suavizado exponencial simple (SES)
        L = [y[0]]
        fitted = [y[0]]
        for t in range(1, n):
            l_new = alpha * y[t] + (1 - alpha) * L[-1]
            L.append(l_new)
            fitted.append(l_new)
        last_L = L[-1]
        preds = [round(float(last_L), 4)] * req.n_pasos

    elif req.tipo == 'doble':
        # Suavizado doble de Holt (tendencia)
        L = [y[0]]
        T = [y[1] - y[0] if n > 1 else 0.0]
        fitted = [L[0] + T[0]]
        for t in range(1, n):
            l_new = alpha * y[t] + (1 - alpha) * (L[-1] + T[-1])
            t_new = beta * (l_new - L[-1]) + (1 - beta) * T[-1]
            L.append(l_new)
            T.append(t_new)
            fitted.append(l_new + t_new)
        preds = [round(float(L[-1] + h * T[-1]), 4) for h in range(1, req.n_pasos + 1)]

    else:
        # Holt-Winters triple
        if n < 2 * s:
            raise HTTPException(status_code=400, detail=f"Se necesitan al menos {2*s} observaciones para el periodo s={s}")

        # Inicialización
        L = [np.mean(y[:s])]
        T_init = (np.mean(y[s:2*s]) - np.mean(y[:s])) / s
        T = [T_init]
        if req.tipo == 'aditivo':
            S = [y[i] - L[0] for i in range(s)]
        else:
            S = [y[i] / L[0] if L[0] != 0 else 1.0 for i in range(s)]

        fitted = []
        for t in range(n):
            si = S[t % s] if t < s else S[-s + (t % s)]
            fi = (L[-1] + T[-1] + si) if req.tipo == 'aditivo' else (L[-1] + T[-1]) * si
            fitted.append(float(fi))
            if req.tipo == 'aditivo':
                l_new = alpha * (y[t] - si) + (1 - alpha) * (L[-1] + T[-1])
                s_new = gamma * (y[t] - l_new) + (1 - gamma) * si
            else:
                l_new = alpha * (y[t] / max(si, 1e-8)) + (1 - alpha) * (L[-1] + T[-1])
                s_new = gamma * (y[t] / max(l_new, 1e-8)) + (1 - gamma) * si
            t_new = beta * (l_new - L[-1]) + (1 - beta) * T[-1]
            L.append(l_new); T.append(t_new); S.append(s_new)

        preds = []
        for h in range(1, req.n_pasos + 1):
            si = S[-s + ((h - 1) % s)]
            if req.tipo == 'aditivo':
                p = L[-1] + h * T[-1] + si
            else:
                p = (L[-1] + h * T[-1]) * si
            preds.append(round(float(p), 4))

    # Métricas
    residuos = y - np.array(fitted[:n])
    rmse = float(np.sqrt(np.mean(residuos**2)))
    mae  = float(np.mean(np.abs(residuos)))

    return {
        'tipo': f'Holt-Winters ({req.tipo})',
        'variable': req.variable,
        'n': n,
        'parametros': {'alpha': alpha, 'beta': beta if req.tipo != 'simple' else None, 'gamma': gamma if req.tipo not in ('simple','doble') else None, 's': s},
        'metricas': {'rmse': round(rmse, 4), 'mae': round(mae, 4)},
        'serie_historica': {'indices': list(range(n)), 'valores': [round(float(v), 4) for v in y]},
        'ajustados': {'indices': list(range(n)), 'valores': [round(float(v), 4) for v in fitted[:n]]},
        'prediccion': {
            'indices': list(range(n, n + req.n_pasos)),
            'valores': preds,
            'n_pasos': req.n_pasos,
        },
    }


@router.post("/auto-identificar")
def auto_identificar(req: ArimaRequest):
    """Identifica automáticamente el mejor orden ARIMA y devuelve resumen."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.variable not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable}' no encontrada")

    y = df[req.variable].dropna().values.astype(float)
    adf = _adf_test(y)

    candidatos = []
    for p in range(0, 4):
        for d in range(0, 3):
            for q in range(0, 4):
                if p == 0 and q == 0:
                    continue
                try:
                    y_d = _diferencias(y, d)
                    if len(y_d) < 5:
                        continue
                    params, ll = _fit_arma(y_d, p, q)
                    aic = _aic(ll, p + q + 1)
                    bic = _bic(ll, p + q + 1, len(y_d))
                    if not np.isnan(aic):
                        candidatos.append({'p': p, 'd': d, 'q': q, 'aic': round(float(aic), 2), 'bic': round(float(bic), 2)})
                except Exception:
                    continue

    candidatos.sort(key=lambda x: x['aic'])
    mejor = candidatos[0] if candidatos else {'p': 1, 'd': 1, 'q': 1}

    return {
        'adf_test': adf,
        'mejor_modelo': mejor,
        'top_5': candidatos[:5],
        'recomendacion': f"ARIMA({mejor['p']},{mejor['d']},{mejor['q']}) con AIC={mejor['aic']}",
    }
