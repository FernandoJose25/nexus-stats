"""
Teoría de Respuesta al Ítem (TRI/IRT) — equivalente a módulo Rasch de SPSS/R.
Modelos: Rasch (1PL), 2PL. Estimación por MML (EM simplificado).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import pandas as pd
from scipy import stats, optimize

from services import data_manager

router = APIRouter()


class TRIRequest(BaseModel):
    items: list[str]           # Variables dicotómicas (0/1)
    modelo: str = "rasch"      # rasch (1PL) | 2pl
    n_cuadratura: int = 21     # Puntos de cuadratura para integración
    max_iter: int = 100
    tol: float = 1e-6


def _logistic(z):
    return 1.0 / (1.0 + np.exp(-z))


def _verosimilitud_item_1pl(b, X, theta, weights):
    """Verosimilitud marginal para un ítem Rasch: P(X=1|θ) = logistic(θ - b)."""
    p = _logistic(theta - b)
    ll = (X[:, None] * np.log(p + 1e-10) + (1 - X[:, None]) * np.log(1 - p + 1e-10))
    # Integrar sobre distribución de θ
    return -float(np.sum(weights * ll.sum(axis=0)))


def _estimar_rasch(X: np.ndarray, n_quad: int = 21, max_iter: int = 100, tol: float = 1e-6):
    """
    Estimación MML para modelo Rasch (1PL).
    X: matriz (n_personas × k_ítems), valores 0/1.
    """
    n, k = X.shape

    # Puntos de cuadratura y pesos (distribución Normal estándar)
    theta_q, weights_q = np.polynomial.hermite.hermgauss(n_quad)
    theta_q = theta_q * np.sqrt(2)            # escalar a N(0,1)
    weights_q = weights_q / np.sqrt(np.pi)    # normalizar

    # Inicializar dificultades con logit de la proporción de errores
    prop = X.mean(axis=0)
    prop = np.clip(prop, 0.01, 0.99)
    b = -np.log(prop / (1 - prop))            # logit inverso

    for it in range(max_iter):
        b_old = b.copy()

        # E-step: calcular P(θ_q | X_n) para cada persona y cada punto
        L_nq = np.ones((n, n_quad))
        for j in range(k):
            p_jq = _logistic(theta_q - b[j])
            L_nq *= (p_jq[None, :] ** X[:, j:j+1]) * ((1-p_jq)[None, :] ** (1-X[:, j:j+1]))

        # Densidad posterior ~ L_nq * weights_q
        num = L_nq * weights_q[None, :]
        denom = num.sum(axis=1, keepdims=True) + 1e-300
        r_nq = num / denom                    # (n × n_quad)

        # M-step: actualizar b_j por Newton
        for j in range(k):
            p_jq = _logistic(theta_q - b[j])
            # Esperanza de correctos e incorrectos
            r_q = r_nq.sum(axis=0)            # (n_quad,)
            E_correct = float((r_q * p_jq).sum())
            E_total   = float(r_q.sum())
            # Score function y segunda derivada
            score = float(np.sum(r_q * (X[:, j].sum() * p_jq - r_q * p_jq * (1-p_jq))) )
            # Usar Newton simplificado: actualizar por ratio grad/hess
            grad = float(np.sum(r_q * (p_jq - X[:, j].mean())))
            hess = float(-np.sum(r_q * p_jq * (1 - p_jq)))
            if abs(hess) > 1e-10:
                b[j] -= grad / hess

        # Convergencia
        if np.max(np.abs(b - b_old)) < tol:
            break

    # Estimación de θ por EAP (Expected a Posteriori)
    thetas = []
    for n_i in range(n):
        p_theta = L_nq[n_i] * weights_q
        p_theta /= p_theta.sum() + 1e-300
        theta_eap = float((theta_q * p_theta).sum())
        thetas.append(theta_eap)

    thetas = np.array(thetas)
    return b, thetas


def _estimar_2pl(X: np.ndarray, n_quad: int = 21, max_iter: int = 50):
    """Estimación 2PL: P(X=1|θ) = logistic(a*(θ - b))."""
    n, k = X.shape
    theta_q, weights_q = np.polynomial.hermite.hermgauss(n_quad)
    theta_q = theta_q * np.sqrt(2)
    weights_q = weights_q / np.sqrt(np.pi)

    prop = X.mean(axis=0)
    prop = np.clip(prop, 0.01, 0.99)
    b = -np.log(prop / (1 - prop))
    a = np.ones(k)

    for it in range(max_iter):
        b_old, a_old = b.copy(), a.copy()

        L_nq = np.ones((n, n_quad))
        for j in range(k):
            p_jq = _logistic(a[j] * (theta_q - b[j]))
            L_nq *= (p_jq[None,:] ** X[:, j:j+1]) * ((1-p_jq)[None,:] ** (1-X[:, j:j+1]))

        num = L_nq * weights_q[None, :]
        denom = num.sum(axis=1, keepdims=True) + 1e-300
        r_nq = num / denom

        for j in range(k):
            def neg_ll(params):
                a_j, b_j = params
                p_jq = _logistic(a_j * (theta_q - b_j))
                r_q  = r_nq.sum(axis=0)
                ll = r_q * (X[:, j].mean() * np.log(p_jq + 1e-10) + (1 - X[:, j].mean()) * np.log(1 - p_jq + 1e-10))
                return -float(ll.sum())

            res = optimize.minimize(neg_ll, [a[j], b[j]], method='Nelder-Mead',
                                    options={'maxiter': 200, 'xatol': 1e-4, 'fatol': 1e-4})
            if res.success:
                a_j_new, b_j_new = res.x
                if 0.1 <= a_j_new <= 4.0:   # Restricción de discriminación razonable
                    a[j] = a_j_new
                    b[j] = b_j_new

        if np.max(np.abs(b - b_old)) < 1e-4 and np.max(np.abs(a - a_old)) < 1e-4:
            break

    thetas = []
    for n_i in range(n):
        L_nq_i = np.ones(n_quad)
        for j in range(k):
            p_jq = _logistic(a[j] * (theta_q - b[j]))
            L_nq_i *= (p_jq ** X[n_i, j]) * ((1-p_jq) ** (1-X[n_i, j]))
        p_theta = L_nq_i * weights_q
        p_theta /= p_theta.sum() + 1e-300
        thetas.append(float((theta_q * p_theta).sum()))

    return a, b, np.array(thetas)


@router.post("/ajustar")
def ajustar_tri(req: TRIRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.items:
        if v not in df.columns:
            raise HTTPException(400, f"Ítem '{v}' no encontrado")

    sub = df[req.items].dropna()
    X = sub.values.astype(float)
    n, k = X.shape

    # Verificar dicotómicos
    vals = set(np.unique(X))
    if not vals.issubset({0.0, 1.0}):
        raise HTTPException(400, f"Los ítems deben ser dicotómicos (0/1). Valores encontrados: {vals}")

    if req.modelo == "rasch":
        b, thetas = _estimar_rasch(X, req.n_cuadratura, req.max_iter, req.tol)
        a = np.ones(k)
    else:
        a, b, thetas = _estimar_2pl(X, req.n_cuadratura, req.max_iter)

    # ── Estadísticos de ajuste de ítems (Infit/Outfit) ────────────────
    items_stats = []
    for j in range(k):
        p_obs = float(X[:, j].mean())
        # Probabilidades esperadas para cada persona
        p_exp = _logistic(a[j] * (thetas - b[j]))
        residuos = X[:, j] - p_exp
        w = p_exp * (1 - p_exp)                 # Varianza binomial

        # Infit (ponderado por información) y Outfit (no ponderado)
        infit_numerador  = float(np.sum(residuos**2))
        infit_denominador = float(np.sum(w))
        outfit_numerador  = float(np.mean((residuos / (np.sqrt(w) + 1e-10))**2))

        infit  = round(infit_numerador / max(infit_denominador, 1e-10), 3)
        outfit = round(outfit_numerador, 3)

        # Correlación punto-biserial
        r_pb = float(np.corrcoef(X[:, j], thetas)[0, 1]) if n > 2 else 0.0

        # Interpretación del ajuste (MNSQ: 0.7-1.3 = aceptable)
        ajuste = "bueno" if 0.7 <= infit <= 1.3 else ("subrresponde" if infit < 0.7 else "sobreresponde")

        items_stats.append({
            "item": req.items[j],
            "dificultad_b": round(float(b[j]), 3),
            "discriminacion_a": round(float(a[j]), 3) if req.modelo == "2pl" else 1.0,
            "proporcion_correctos": round(p_obs, 3),
            "infit_mnsq": infit,
            "outfit_mnsq": outfit,
            "correlacion_biserial": round(r_pb, 3),
            "ajuste_item": ajuste,
        })

    # ── Estadísticos de personas ──────────────────────────────────────
    theta_mean = round(float(thetas.mean()), 3)
    theta_sd   = round(float(thetas.std()), 3)
    puntajes_brutos = X.sum(axis=1).tolist()

    # Separación y fiabilidad (Rasch)
    obs_var = float(thetas.var())
    error_var = float(np.mean([
        1.0 / max(float(np.sum(_logistic(a[j]*(thetas - b[j])) * (1 - _logistic(a[j]*(thetas - b[j]))))), 1e-6)
        for j in range(k)
    ]))
    separacion = round(float(np.sqrt(max(obs_var - error_var, 0) / max(error_var, 1e-10))), 3)
    fiabilidad_personas = round(float(separacion**2 / (1 + separacion**2)), 3)

    # Mapa persona-ítem (para visualización)
    b_sorted = sorted(enumerate(b), key=lambda x: x[1])
    mapa_items = [{"item": req.items[j], "b": round(float(bj),3)} for j,bj in b_sorted]

    return {
        "tipo": f"TRI — Modelo {'Rasch (1PL)' if req.modelo=='rasch' else '2PL'}",
        "items": req.items,
        "n_personas": n,
        "k_items": k,
        "modelo": req.modelo,
        "estadisticos_items": items_stats,
        "estadisticos_personas": {
            "theta_media": theta_mean,
            "theta_sd": theta_sd,
            "separacion_personas": separacion,
            "fiabilidad_personas": fiabilidad_personas,
        },
        "mapa_persona_item": {
            "items_ordenados_dificultad": mapa_items,
            "theta_percentiles": {
                "p10": round(float(np.percentile(thetas, 10)), 3),
                "p25": round(float(np.percentile(thetas, 25)), 3),
                "p50": round(float(np.percentile(thetas, 50)), 3),
                "p75": round(float(np.percentile(thetas, 75)), 3),
                "p90": round(float(np.percentile(thetas, 90)), 3),
            },
        },
        "thetas_personas": [round(float(t), 3) for t in thetas[:100]],  # Primeras 100
        "interpretacion": {
            "b": "Dificultad del ítem (mayor = más difícil). 0 = dificultad promedio.",
            "a": "Discriminación (1PL=fijo en 1.0; 2PL=estimado, mayor=discrimina mejor).",
            "infit": "Infit MNSQ: 0.7–1.3 = ajuste aceptable; <0.7 = subrresponde; >1.3 = sobreresponde.",
            "fiabilidad": "Fiabilidad de personas (equivalente al alfa de Cronbach en TRI).",
        },
    }
