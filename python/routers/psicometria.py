"""
Psicometría avanzada: Omega de McDonald, ICC, Kappa de Cohen, Kuder-Richardson.
Equivalente a SPSS Scale > Reliability Analysis (avanzado).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats

from services import data_manager

router = APIRouter()


class OmegaRequest(BaseModel):
    items: list[str]


class IccRequest(BaseModel):
    items: list[str]           # Columnas = raters o mediciones repetidas
    modelo: str = "dos_vias"   # dos_vias | una_via
    tipo: str = "consistencia" # consistencia | acuerdo
    unidad: str = "unico"      # unico | promedio
    alpha: float = 0.05


class KappaRequest(BaseModel):
    variable_1: str
    variable_2: str
    ponderado: bool = False    # Kappa ponderado (para ordinales)
    alpha: float = 0.05


class KuderRequest(BaseModel):
    items: list[str]           # Ítems dicotómicos (0/1)


# ─── Omega de McDonald ────────────────────────────────────────────────────────

@router.post("/omega")
def omega_mcdonald(req: OmegaRequest):
    """Calcula Omega de McDonald (ω) — más robusto que alpha para ítems con cargas desiguales."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.items:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Ítem '{v}' no encontrado")

    data = df[req.items].dropna()
    n, k = data.shape
    X = data.values.astype(float)

    # Análisis factorial de un factor (PCA simple para cargas)
    cov_mat = np.cov(X.T)
    eigvals, eigvecs = np.linalg.eigh(cov_mat)
    idx = np.argsort(eigvals)[::-1]
    eigvals = eigvals[idx]
    eigvecs = eigvecs[:, idx]

    # Cargas del primer factor (λ₁^0.5 * v₁)
    cargas = eigvecs[:, 0] * np.sqrt(max(eigvals[0], 0))
    unicidades = np.diag(cov_mat) - cargas**2
    unicidades = np.clip(unicidades, 0, None)

    # Omega total
    suma_cargas = float(cargas.sum())
    suma_unicidades = float(unicidades.sum())
    var_total = float(np.sum(cov_mat))

    omega = suma_cargas**2 / (suma_cargas**2 + suma_unicidades)
    omega = round(float(omega), 4)

    # Alpha de Cronbach para comparar
    var_items = np.var(X, axis=0, ddof=1)
    var_total2 = float(np.var(X.sum(axis=1), ddof=1))
    alpha_c = k / (k - 1) * (1 - var_items.sum() / var_total2)

    # Por ítem
    items_stats = []
    for i, item in enumerate(req.items):
        items_stats.append({
            'item': item,
            'carga': round(float(cargas[i]), 4),
            'unicidad': round(float(unicidades[i]), 4),
            'comunalidad': round(float(cargas[i]**2 / np.diag(cov_mat)[i]), 4) if np.diag(cov_mat)[i] > 0 else 0,
        })

    interpretacion = (
        "excelente (ω ≥ 0.90)" if omega >= 0.90 else
        "buena (0.80 ≤ ω < 0.90)" if omega >= 0.80 else
        "aceptable (0.70 ≤ ω < 0.80)" if omega >= 0.70 else
        "cuestionable (0.60 ≤ ω < 0.70)" if omega >= 0.60 else
        "pobre (ω < 0.60)"
    )

    return {
        'tipo': 'Omega de McDonald',
        'n': n,
        'k': k,
        'omega': omega,
        'alpha_cronbach': round(float(alpha_c), 4),
        'diferencia_omega_alpha': round(omega - float(alpha_c), 4),
        'interpretacion': interpretacion,
        'items': items_stats,
        'nota': 'Omega es preferible a Alpha cuando las cargas factoriales son heterogéneas.',
    }


# ─── Coeficiente de Correlación Intraclase (ICC) ─────────────────────────────

@router.post("/icc")
def icc(req: IccRequest):
    """Calcula ICC para acuerdo entre evaluadores o consistencia de medidas repetidas."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.items:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    data = df[req.items].dropna()
    n, k = data.shape    # n = sujetos, k = evaluadores/mediciones
    Y = data.values.astype(float)

    # ANOVA de dos vías (sujetos × evaluadores)
    grand_mean = float(Y.mean())
    sujeto_means = Y.mean(axis=1)
    eval_means   = Y.mean(axis=0)

    SSr = float(k * np.sum((sujeto_means - grand_mean)**2))   # between subjects
    SSc = float(n * np.sum((eval_means   - grand_mean)**2))   # between raters
    SSe = float(np.sum((Y - sujeto_means[:, None] - eval_means[None, :] + grand_mean)**2))  # error
    SSt = float(np.sum((Y - grand_mean)**2))

    gl_r = n - 1
    gl_c = k - 1
    gl_e = (n - 1) * (k - 1)

    MSr = SSr / gl_r
    MSc = SSc / gl_c
    MSe = SSe / gl_e

    # ICCs según modelo y tipo
    results = {}

    # ICC(1,1) — One-way, único
    icc_1_1 = (MSr - MSe) / (MSr + (k - 1) * MSe)
    # ICC(2,1) — Two-way, consistencia, único
    icc_2_1_c = (MSr - MSe) / (MSr + (k - 1) * MSe + k * (MSc - MSe) / n)
    # ICC(2,1) — Two-way, acuerdo, único
    icc_2_1_a = (MSr - MSe) / (MSr + (k - 1) * MSe + k * (MSc - MSe) / n)
    # ICC(3,1) — Two-way, consistencia
    icc_3_1 = (MSr - MSe) / (MSr + (k - 1) * MSe)

    # Selección según parámetros
    if req.modelo == "una_via":
        icc_val = icc_1_1
        desc = "ICC(1,1) — Un factor, único"
    elif req.tipo == "consistencia":
        icc_val = icc_3_1
        desc = "ICC(3,1) — Dos factores, consistencia, único"
    else:
        icc_val = icc_2_1_a
        desc = "ICC(2,1) — Dos factores, acuerdo absoluto, único"

    if req.unidad == "promedio":
        icc_val = k * icc_val / (1 + (k - 1) * icc_val)
        desc = desc.replace("único", "promedio de evaluadores")

    icc_val = float(np.clip(icc_val, -1, 1))

    # IC95 del ICC
    F_lower = (MSr / MSe) / stats.f.ppf(1 - req.alpha / 2, gl_r, gl_e)
    F_upper = (MSr / MSe) * stats.f.ppf(1 - req.alpha / 2, gl_e, gl_r)
    ic_low  = (F_lower - 1) / (F_lower + k - 1)
    ic_high = (F_upper - 1) / (F_upper + k - 1)

    # F-test
    F_val = MSr / MSe
    p_val = float(stats.f.sf(F_val, gl_r, gl_e))

    interpretacion = (
        "excelente (ICC > 0.90)" if icc_val > 0.90 else
        "buena (0.75 < ICC ≤ 0.90)" if icc_val > 0.75 else
        "moderada (0.50 < ICC ≤ 0.75)" if icc_val > 0.50 else
        "pobre (ICC ≤ 0.50)"
    )

    tabla_anova = [
        {'fuente': 'Entre sujetos',    'SS': round(SSr, 4), 'gl': gl_r, 'MS': round(MSr, 4)},
        {'fuente': 'Entre evaluadores','SS': round(SSc, 4), 'gl': gl_c, 'MS': round(MSc, 4)},
        {'fuente': 'Error (residual)', 'SS': round(SSe, 4), 'gl': gl_e, 'MS': round(MSe, 4)},
        {'fuente': 'Total',            'SS': round(SSt, 4), 'gl': gl_r + gl_c + gl_e, 'MS': None},
    ]

    return {
        'tipo': 'Coeficiente de Correlación Intraclase (ICC)',
        'descripcion': desc,
        'n_sujetos': n,
        'k_evaluadores': k,
        'icc': round(icc_val, 4),
        'ic_low': round(float(ic_low), 4),
        'ic_high': round(float(ic_high), 4),
        'F': round(float(F_val), 4),
        'p_value': round(p_val, 6),
        'significativo': p_val < req.alpha,
        'interpretacion': interpretacion,
        'tabla_anova': tabla_anova,
        'todos_icc': {
            'ICC_1_1': round(float(icc_1_1), 4),
            'ICC_2_1_consistencia': round(float(icc_3_1), 4),
            'ICC_2_1_acuerdo': round(float(icc_2_1_a), 4),
        },
    }


# ─── Kappa de Cohen ───────────────────────────────────────────────────────────

@router.post("/kappa")
def kappa_cohen(req: KappaRequest):
    """Kappa de Cohen simple y ponderado para concordancia entre dos evaluadores."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in [req.variable_1, req.variable_2]:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    data = df[[req.variable_1, req.variable_2]].dropna()
    n = len(data)
    cats = sorted(set(data[req.variable_1].unique()) | set(data[req.variable_2].unique()))
    k = len(cats)
    cat_map = {c: i for i, c in enumerate(cats)}

    # Tabla de contingencia
    conf = np.zeros((k, k), dtype=float)
    for _, row in data.iterrows():
        i = cat_map[row[req.variable_1]]
        j = cat_map[row[req.variable_2]]
        conf[i, j] += 1

    p_obs = float(np.trace(conf) / n)
    p_exp = float(np.sum(conf.sum(axis=1) * conf.sum(axis=0)) / n**2)

    kappa = (p_obs - p_exp) / (1 - p_exp) if (1 - p_exp) > 0 else 0.0

    # SE del kappa
    p_ij = conf / n
    p_i  = p_ij.sum(axis=1)
    p_j  = p_ij.sum(axis=0)

    term1 = sum(p_ij[i, i] * (1 - (p_i[i] + p_j[i]) * (1 - kappa))**2 for i in range(k))
    term2 = sum(
        p_ij[i, j] * ((p_i[j] + p_j[i]) * (1 - kappa))**2
        for i in range(k) for j in range(k) if i != j
    )
    term3 = (kappa - p_exp * (1 - kappa))**2

    var_kappa = (term1 + term2 - term3) / (n * (1 - p_exp)**2)
    se_kappa  = float(np.sqrt(max(var_kappa, 0)))

    z = kappa / se_kappa if se_kappa > 0 else 0.0
    p_val = float(2 * stats.norm.sf(abs(z)))
    z95 = 1.96
    ic_low  = kappa - z95 * se_kappa
    ic_high = kappa + z95 * se_kappa

    # Kappa ponderado (lineal)
    kappa_p = None
    if req.ponderado and k > 2:
        W = 1 - np.abs(np.arange(k)[:, None] - np.arange(k)[None, :]) / (k - 1)
        p_obs_w = float(np.sum(W * p_ij))
        p_exp_w = float(np.sum(W * np.outer(p_i, p_j)))
        kappa_p = round((p_obs_w - p_exp_w) / (1 - p_exp_w), 4) if (1 - p_exp_w) > 0 else 0.0

    interpretacion = (
        "casi perfecto (0.81–1.00)" if kappa >= 0.81 else
        "sustancial (0.61–0.80)"   if kappa >= 0.61 else
        "moderado (0.41–0.60)"     if kappa >= 0.41 else
        "justo (0.21–0.40)"        if kappa >= 0.21 else
        "leve (0.01–0.20)"         if kappa >= 0.01 else
        "sin acuerdo (≤ 0.00)"
    )

    # Tabla de concordancia
    tabla = conf.tolist()

    return {
        'tipo': 'Kappa de Cohen',
        'variable_1': req.variable_1,
        'variable_2': req.variable_2,
        'n': n,
        'categorias': [str(c) for c in cats],
        'tabla_contingencia': tabla,
        'p_observada': round(p_obs, 4),
        'p_esperada': round(p_exp, 4),
        'kappa': round(float(kappa), 4),
        'kappa_ponderado': kappa_p,
        'se': round(se_kappa, 4),
        'z': round(float(z), 4),
        'p_value': round(p_val, 6),
        'significativo': p_val < req.alpha,
        'ic_low': round(ic_low, 4),
        'ic_high': round(ic_high, 4),
        'interpretacion': interpretacion,
    }


# ─── Kuder-Richardson KR-20 ──────────────────────────────────────────────────

@router.post("/kuder-richardson")
def kuder_richardson(req: KuderRequest):
    """KR-20 y KR-21 para ítems dicotómicos (0/1)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in req.items:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Ítem '{v}' no encontrado")

    data = df[req.items].dropna()
    n, k = data.shape
    X = data.values.astype(float)

    # Verificar dicotómicos
    vals_unicos = set(np.unique(X))
    if not vals_unicos.issubset({0, 1, 0.0, 1.0}):
        raise HTTPException(status_code=400, detail="KR-20 requiere ítems dicotómicos (solo valores 0 y 1)")

    p_vals = X.mean(axis=0)   # Proporción de correctos por ítem
    q_vals = 1 - p_vals
    pq = p_vals * q_vals

    var_total = float(np.var(X.sum(axis=1), ddof=1))

    # KR-20 (equivale a alpha para ítems dicotómicos)
    kr20 = (k / (k - 1)) * (1 - pq.sum() / var_total)

    # KR-21 (aproximación con dificultad promedio)
    p_bar = float(p_vals.mean())
    kr21  = (k / (k - 1)) * (1 - k * p_bar * (1 - p_bar) / var_total)

    items_stats = []
    for i, item in enumerate(req.items):
        items_stats.append({
            'item': item,
            'n_correctos': int(X[:, i].sum()),
            'p': round(float(p_vals[i]), 4),
            'q': round(float(q_vals[i]), 4),
            'pq': round(float(pq[i]), 4),
            'dificultad': 'fácil' if p_vals[i] > 0.7 else ('difícil' if p_vals[i] < 0.3 else 'moderado'),
        })

    return {
        'tipo': 'Kuder-Richardson',
        'n': n,
        'k': k,
        'kr20': round(float(kr20), 4),
        'kr21': round(float(kr21), 4),
        'var_total': round(var_total, 4),
        'suma_pq': round(float(pq.sum()), 4),
        'items': items_stats,
        'interpretacion': (
            "excelente (≥ 0.90)" if kr20 >= 0.9 else
            "buena (0.80–0.89)"  if kr20 >= 0.8 else
            "aceptable (0.70–0.79)" if kr20 >= 0.7 else
            "cuestionable (< 0.70)"
        ),
    }
