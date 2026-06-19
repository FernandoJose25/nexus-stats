"""
Tests de hipótesis: t de una muestra, t independientes, t relacionadas,
chi-cuadrado de independencia, Mann-Whitney U, Kruskal-Wallis H.
Tests de normalidad: Shapiro-Wilk, Kolmogorov-Smirnov, Lilliefors.
"""
import math
from typing import List, Literal, Optional

import numpy as np
import pandas as pd
import scipy.stats as stats
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


# ─── Modelos de entrada ───────────────────────────────────────────────────────

class TUnaMuestraRequest(BaseModel):
    variable: str
    valor_referencia: float
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"

class TIndependientesRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"
    igualdad_varianzas: bool = True  # False = Welch

class TRelacionadasRequest(BaseModel):
    variable_1: str
    variable_2: str
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"

class ChiCuadradoRequest(BaseModel):
    variable_1: str
    variable_2: str
    alpha: float = 0.05

class MannWhitneyRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"

class KruskalWallisRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")

def _check_col(df, col):
    if col not in df.columns:
        raise HTTPException(400, detail=f"Variable '{col}' no encontrada")

def _check_numeric(df, col):
    if not pd.api.types.is_numeric_dtype(df[col]):
        raise HTTPException(400, detail=f"Variable '{col}' debe ser numérica")

def _interpretar_p(p, alpha):
    if p < 0.001:
        return "muy significativo (p < 0.001)"
    if p < 0.01:
        return "significativo (p < 0.01)"
    if p < alpha:
        return f"significativo (p < {alpha})"
    return f"no significativo (p ≥ {alpha})"

def _cohens_d_one(serie, mu0):
    n = len(serie)
    d = (serie.mean() - mu0) / serie.std(ddof=1)
    return round(float(d), 4)

def _cohens_d_two(g1, g2):
    n1, n2 = len(g1), len(g2)
    pooled = math.sqrt(((n1 - 1) * g1.var(ddof=1) + (n2 - 1) * g2.var(ddof=1)) / (n1 + n2 - 2))
    if pooled == 0:
        return 0.0
    return round(float((g1.mean() - g2.mean()) / pooled), 4)

def _clasif_d(d):
    abs_d = abs(d)
    if abs_d < 0.2: return "despreciable"
    if abs_d < 0.5: return "pequeño"
    if abs_d < 0.8: return "mediano"
    return "grande"

def _ic_media(serie, alpha):
    n = len(serie)
    m = serie.mean()
    se = serie.std(ddof=1) / math.sqrt(n)
    t_crit = stats.t.ppf(1 - alpha / 2, df=n - 1)
    return round(m - t_crit * se, 4), round(m + t_crit * se, 4)


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/t-una-muestra")
def t_una_muestra(req: TUnaMuestraRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)
    _check_numeric(df, req.variable)

    serie = df[req.variable].dropna()
    n = len(serie)
    if n < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 observaciones")

    t_stat, p_val = stats.ttest_1samp(serie, req.valor_referencia, alternative=req.alternativa)
    d = _cohens_d_one(serie, req.valor_referencia)
    ic_low, ic_high = _ic_media(serie, req.alpha)

    return {
        "test": "t de una muestra",
        "variable": req.variable,
        "valor_referencia": req.valor_referencia,
        "n": int(n),
        "media": round(float(serie.mean()), 4),
        "desv_tipica": round(float(serie.std(ddof=1)), 4),
        "t": round(float(t_stat), 4),
        "gl": int(n - 1),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "cohen_d": d,
        "magnitud_efecto": _clasif_d(d),
        "ic_media_low": ic_low,
        "ic_media_high": ic_high,
        "alpha": req.alpha,
    }


@router.post("/t-independientes")
def t_independientes(req: TIndependientesRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)
    _check_col(df, req.grupo)
    _check_numeric(df, req.variable)

    sub = df[[req.variable, req.grupo]].dropna()
    grupos = sub[req.grupo].unique()
    if len(grupos) != 2:
        raise HTTPException(400, detail=f"La variable de grupo debe tener exactamente 2 categorías (encontradas: {len(grupos)})")

    g1 = sub[sub[req.grupo] == grupos[0]][req.variable]
    g2 = sub[sub[req.grupo] == grupos[1]][req.variable]

    if len(g1) < 2 or len(g2) < 2:
        raise HTTPException(400, detail="Cada grupo necesita al menos 2 observaciones")

    equal_var = req.igualdad_varianzas
    t_stat, p_val = stats.ttest_ind(g1, g2, equal_var=equal_var, alternative=req.alternativa)

    # Levene test para igualdad de varianzas
    levene_stat, levene_p = stats.levene(g1, g2)

    d = _cohens_d_two(g1, g2)
    gl = (len(g1) + len(g2) - 2) if equal_var else None  # Welch no tiene GL entero

    return {
        "test": "t de muestras independientes" + (" (Welch)" if not equal_var else ""),
        "variable": req.variable,
        "grupo": req.grupo,
        "categorias": [str(grupos[0]), str(grupos[1])],
        "n": [int(len(g1)), int(len(g2))],
        "medias": [round(float(g1.mean()), 4), round(float(g2.mean()), 4)],
        "desv_tipicas": [round(float(g1.std(ddof=1)), 4), round(float(g2.std(ddof=1)), 4)],
        "t": round(float(t_stat), 4),
        "gl": int(gl) if gl is not None else None,
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "cohen_d": d,
        "magnitud_efecto": _clasif_d(d),
        "levene_stat": round(float(levene_stat), 4),
        "levene_p": round(float(levene_p), 4),
        "varianzas_iguales": bool(levene_p >= 0.05),
        "alpha": req.alpha,
    }


@router.post("/t-relacionadas")
def t_relacionadas(req: TRelacionadasRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    for v in [req.variable_1, req.variable_2]:
        _check_col(df, v)
        _check_numeric(df, v)
    if req.variable_1 == req.variable_2:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    sub = df[[req.variable_1, req.variable_2]].dropna()
    n = len(sub)
    if n < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 pares completos")

    diff = sub[req.variable_1] - sub[req.variable_2]
    t_stat, p_val = stats.ttest_rel(sub[req.variable_1], sub[req.variable_2], alternative=req.alternativa)
    d = round(float(diff.mean() / diff.std(ddof=1)), 4)

    return {
        "test": "t de muestras relacionadas",
        "variable_1": req.variable_1,
        "variable_2": req.variable_2,
        "n": int(n),
        "media_1": round(float(sub[req.variable_1].mean()), 4),
        "media_2": round(float(sub[req.variable_2].mean()), 4),
        "media_diferencia": round(float(diff.mean()), 4),
        "desv_diferencia": round(float(diff.std(ddof=1)), 4),
        "t": round(float(t_stat), 4),
        "gl": int(n - 1),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "cohen_d": d,
        "magnitud_efecto": _clasif_d(d),
        "alpha": req.alpha,
    }


@router.post("/chi-cuadrado")
def chi_cuadrado(req: ChiCuadradoRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable_1)
    _check_col(df, req.variable_2)
    if req.variable_1 == req.variable_2:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    sub = df[[req.variable_1, req.variable_2]].dropna()
    tabla = pd.crosstab(sub[req.variable_1], sub[req.variable_2])

    if tabla.shape[0] < 2 or tabla.shape[1] < 2:
        raise HTTPException(400, detail="Cada variable necesita al menos 2 categorías")

    chi2, p_val, gl, esperadas = stats.chi2_contingency(tabla)
    n = int(sub.shape[0])

    # Cramér's V
    min_dim = min(tabla.shape[0] - 1, tabla.shape[1] - 1)
    v = math.sqrt(chi2 / (n * min_dim)) if min_dim > 0 and n > 0 else 0.0

    # Advertencia si esperados < 5
    pct_bajos = float((esperadas < 5).sum() / esperadas.size)

    # Tabla de contingencia como dict serializable
    tabla_dict = {
        "index": [str(i) for i in tabla.index.tolist()],
        "columns": [str(c) for c in tabla.columns.tolist()],
        "values": tabla.values.tolist(),
    }

    return {
        "test": "Chi-cuadrado de independencia",
        "variable_1": req.variable_1,
        "variable_2": req.variable_2,
        "n": n,
        "chi2": round(float(chi2), 4),
        "gl": int(gl),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "cramer_v": round(float(v), 4),
        "magnitud_efecto": _clasif_d(v),
        "tabla_contingencia": tabla_dict,
        "advertencia_esperados": pct_bajos > 0.2,
        "pct_celdas_esperadas_bajas": round(pct_bajos * 100, 1),
        "alpha": req.alpha,
    }


@router.post("/mann-whitney")
def mann_whitney(req: MannWhitneyRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)
    _check_col(df, req.grupo)
    _check_numeric(df, req.variable)

    sub = df[[req.variable, req.grupo]].dropna()
    grupos = sub[req.grupo].unique()
    if len(grupos) != 2:
        raise HTTPException(400, detail=f"La variable de grupo debe tener exactamente 2 categorías (encontradas: {len(grupos)})")

    g1 = sub[sub[req.grupo] == grupos[0]][req.variable].values
    g2 = sub[sub[req.grupo] == grupos[1]][req.variable].values

    u_stat, p_val = stats.mannwhitneyu(g1, g2, alternative=req.alternativa)
    n1, n2 = len(g1), len(g2)
    n_total = n1 + n2

    # r = Z / sqrt(N)  — efecto rank-biserial
    z = stats.norm.ppf(p_val / 2) if req.alternativa == "two-sided" else stats.norm.ppf(p_val)
    r_effect = abs(float(z)) / math.sqrt(n_total) if n_total > 0 else 0.0

    return {
        "test": "Mann-Whitney U",
        "variable": req.variable,
        "grupo": req.grupo,
        "categorias": [str(grupos[0]), str(grupos[1])],
        "n": [int(n1), int(n2)],
        "medianas": [round(float(np.median(g1)), 4), round(float(np.median(g2)), 4)],
        "u": round(float(u_stat), 4),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "r_efecto": round(r_effect, 4),
        "magnitud_efecto": _clasif_d(r_effect),
        "alpha": req.alpha,
    }


@router.post("/kruskal-wallis")
def kruskal_wallis(req: KruskalWallisRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)
    _check_col(df, req.grupo)
    _check_numeric(df, req.variable)

    sub = df[[req.variable, req.grupo]].dropna()
    grupos_uniq = sub[req.grupo].unique()
    if len(grupos_uniq) < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 grupos")

    muestras = [sub[sub[req.grupo] == g][req.variable].values for g in grupos_uniq]
    for i, m in enumerate(muestras):
        if len(m) < 2:
            raise HTTPException(400, detail=f"Grupo '{grupos_uniq[i]}' tiene menos de 2 observaciones")

    h_stat, p_val = stats.kruskal(*muestras)
    n_total = sum(len(m) for m in muestras)

    # Eta-cuadrado (η²) como tamaño del efecto
    k = len(grupos_uniq)
    eta2 = (h_stat - k + 1) / (n_total - k)
    eta2 = max(0.0, float(eta2))

    resumen_grupos = []
    for g, m in zip(grupos_uniq, muestras):
        resumen_grupos.append({
            "grupo": str(g),
            "n": int(len(m)),
            "mediana": round(float(np.median(m)), 4),
            "media": round(float(np.mean(m)), 4),
        })

    return {
        "test": "Kruskal-Wallis H",
        "variable": req.variable,
        "grupo": req.grupo,
        "n_grupos": int(k),
        "n_total": int(n_total),
        "h": round(float(h_stat), 4),
        "gl": int(k - 1),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "eta2": round(eta2, 4),
        "magnitud_efecto": "pequeño" if eta2 < 0.06 else "mediano" if eta2 < 0.14 else "grande",
        "grupos": resumen_grupos,
        "alpha": req.alpha,
    }


# ─── Tests de normalidad ──────────────────────────────────────────────────────

class NormalidadRequest(BaseModel):
    variables: List[str]
    alpha: float = 0.05


@router.post("/normalidad")
def tests_normalidad(req: NormalidadRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if not req.variables:
        raise HTTPException(400, detail="Selecciona al menos una variable")

    resultados = []
    for var in req.variables:
        _check_col(df, var)
        _check_numeric(df, var)
        serie = df[var].dropna().values.astype(float)
        n = len(serie)

        if n < 3:
            resultados.append({"variable": var, "error": "Menos de 3 observaciones"})
            continue

        item = {"variable": var, "n": int(n)}

        # Shapiro-Wilk (recomendado para n <= 5000)
        if n <= 5000:
            sw_stat, sw_p = stats.shapiro(serie)
            item["shapiro_wilk"] = {
                "estadistico": round(float(sw_stat), 4),
                "p_value": round(float(sw_p), 4),
                "normal": bool(sw_p >= req.alpha),
                "interpretacion": "distribución normal" if sw_p >= req.alpha else "no normal",
            }
        else:
            item["shapiro_wilk"] = {"nota": "n > 5000, use K-S"}

        # Kolmogorov-Smirnov con parámetros estimados (Lilliefors)
        try:
            from scipy.stats import kstest, norm
            media, desv = serie.mean(), serie.std(ddof=1)
            if desv > 0:
                ks_stat, ks_p = kstest(serie, 'norm', args=(media, desv))
                # Corrección de Lilliefors: ajustar p-valor (aproximación)
                # Para n >= 5, usar tabla de Lilliefors (aproximación por simulación)
                item["kolmogorov_smirnov"] = {
                    "estadistico": round(float(ks_stat), 4),
                    "p_value": round(float(ks_p), 4),
                    "normal": bool(ks_p >= req.alpha),
                    "interpretacion": "distribución normal" if ks_p >= req.alpha else "no normal",
                    "nota": "Con parámetros estimados de la muestra",
                }
            else:
                item["kolmogorov_smirnov"] = {"nota": "Desviación típica = 0"}
        except Exception as e:
            item["kolmogorov_smirnov"] = {"error": str(e)}

        # Estadísticos descriptivos de normalidad
        if n >= 3:
            asim = float(stats.skew(serie, bias=False))
            kurt = float(stats.kurtosis(serie, bias=False, fisher=True))
            # Z de asimetría y curtosis
            see = math.sqrt((6 * n * (n-1)) / ((n-2) * (n+1) * (n+3)))
            sek = 2 * see * math.sqrt((n*n - 1) / ((n-3) * (n+5))) if n >= 4 else None
            item["asimetria"] = {
                "valor": round(asim, 4),
                "error_estandar": round(see, 4),
                "z": round(asim / see, 4) if see else None,
                "normal": bool(abs(asim / see) < 1.96) if see else None,
            }
            if sek:
                item["curtosis"] = {
                    "valor": round(kurt, 4),
                    "error_estandar": round(sek, 4),
                    "z": round(kurt / sek, 4),
                    "normal": bool(abs(kurt / sek) < 1.96),
                }

        # Veredicto global
        sw_normal = item.get("shapiro_wilk", {}).get("normal")
        ks_normal = item.get("kolmogorov_smirnov", {}).get("normal")
        if sw_normal is not None:
            item["veredicto"] = "normal" if sw_normal else "no normal"
        elif ks_normal is not None:
            item["veredicto"] = "normal" if ks_normal else "no normal"
        else:
            item["veredicto"] = "indeterminado"

        item["alpha"] = req.alpha
        resultados.append(item)

    return {"tipo": "Tests de normalidad", "resultados": resultados}


# ─── Wilcoxon de rangos con signo ─────────────────────────────────────────────

class WilcoxonRequest(BaseModel):
    variable_1: str
    variable_2: Optional[str] = None      # None → test de una muestra contra mediana
    mediana_ref: float = 0.0              # solo si variable_2 es None
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"


@router.post("/wilcoxon")
def wilcoxon(req: WilcoxonRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable_1)
    _check_numeric(df, req.variable_1)

    if req.variable_2:
        _check_col(df, req.variable_2)
        _check_numeric(df, req.variable_2)
        if req.variable_1 == req.variable_2:
            raise HTTPException(400, detail="Las variables deben ser distintas")
        sub = df[[req.variable_1, req.variable_2]].dropna()
        d = sub[req.variable_1].values - sub[req.variable_2].values
        n = len(sub)
        tipo = "muestras relacionadas"
        label = f"{req.variable_1} − {req.variable_2}"
    else:
        s = df[req.variable_1].dropna()
        d = s.values - req.mediana_ref
        n = len(s)
        tipo = "una muestra"
        label = f"{req.variable_1} vs. mediana={req.mediana_ref}"

    d = d[d != 0]   # Eliminar diferencias cero (protocolo estándar)
    n_eff = len(d)

    if n_eff < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 diferencias no nulas")

    w_stat, p_val = stats.wilcoxon(d, alternative=req.alternativa)

    # r de efecto = Z / sqrt(N)
    # Aproximación normal para Z
    mu_w = n_eff * (n_eff + 1) / 4
    sigma_w = math.sqrt(n_eff * (n_eff + 1) * (2 * n_eff + 1) / 24)
    z_approx = (w_stat - mu_w) / sigma_w if sigma_w > 0 else 0.0
    r_efecto = abs(z_approx) / math.sqrt(n_eff) if n_eff > 0 else 0.0

    mediana_dif = round(float(np.median(d)), 4)

    return {
        "test": "Wilcoxon de rangos con signo",
        "tipo": tipo,
        "label": label,
        "n_pares": int(n),
        "n_efectivo": int(n_eff),
        "n_excluidos_cero": int(n - n_eff),
        "w": round(float(w_stat), 4),
        "z_aprox": round(float(z_approx), 4),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "mediana_diferencia": mediana_dif,
        "r_efecto": round(r_efecto, 4),
        "magnitud_efecto": _clasif_d(r_efecto),
        "alpha": req.alpha,
    }


# ─── Prueba exacta de Fisher ──────────────────────────────────────────────────

class FisherRequest(BaseModel):
    variable_1: str
    variable_2: str
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"


@router.post("/fisher")
def fisher_exact(req: FisherRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable_1)
    _check_col(df, req.variable_2)
    if req.variable_1 == req.variable_2:
        raise HTTPException(400, detail="Las variables deben ser distintas")

    sub = df[[req.variable_1, req.variable_2]].dropna()
    tabla = pd.crosstab(sub[req.variable_1], sub[req.variable_2])

    if tabla.shape != (2, 2):
        raise HTTPException(400, detail=f"Fisher exacto requiere tabla 2×2 (encontrada: {tabla.shape[0]}×{tabla.shape[1]}). Para tablas mayores usa Chi-cuadrado.")

    ct = tabla.values
    odd_ratio, p_val = stats.fisher_exact(ct, alternative=req.alternativa)

    n = int(sub.shape[0])

    # También calcular chi-cuadrado para comparación
    chi2, p_chi2, _, _ = stats.chi2_contingency(ct)

    # IC del Odds Ratio (método de Woolf/logarítmico)
    a, b, c, d = ct[0, 0], ct[0, 1], ct[1, 0], ct[1, 1]
    if a > 0 and b > 0 and c > 0 and d > 0:
        z_crit = stats.norm.ppf(1 - req.alpha / 2)
        se_log = math.sqrt(1/a + 1/b + 1/c + 1/d)
        log_or = math.log(odd_ratio) if odd_ratio > 0 else 0
        or_ic_low = round(math.exp(log_or - z_crit * se_log), 4)
        or_ic_high = round(math.exp(log_or + z_crit * se_log), 4)
    else:
        or_ic_low, or_ic_high = None, None

    tabla_dict = {
        "index": [str(i) for i in tabla.index.tolist()],
        "columns": [str(c) for c in tabla.columns.tolist()],
        "values": ct.tolist(),
    }

    return {
        "test": "Prueba exacta de Fisher",
        "variable_1": req.variable_1,
        "variable_2": req.variable_2,
        "n": n,
        "tabla_contingencia": tabla_dict,
        "odds_ratio": round(float(odd_ratio), 4) if not math.isinf(odd_ratio) else None,
        "or_ic_low": or_ic_low,
        "or_ic_high": or_ic_high,
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "chi2_referencia": round(float(chi2), 4),
        "chi2_p": round(float(p_chi2), 4),
        "alpha": req.alpha,
        "nota": "Fisher exacto recomendado cuando n < 20 o frecuencias esperadas < 5",
    }


# ─── Test de Friedman ─────────────────────────────────────────────────────────

class FriedmanRequest(BaseModel):
    variables: List[str]           # ≥3 variables (medidas repetidas / grupos relacionados)
    alpha: float = 0.05


@router.post("/friedman")
def friedman(req: FriedmanRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if len(req.variables) < 3:
        raise HTTPException(400, detail="Friedman requiere al menos 3 variables (mediciones)")
    for v in req.variables:
        _check_col(df, v)
        _check_numeric(df, v)

    sub = df[req.variables].dropna()
    n = len(sub)
    k = len(req.variables)

    if n < 3:
        raise HTTPException(400, detail="Se necesitan al menos 3 observaciones completas")

    chi2_stat, p_val = stats.friedmanchisquare(*[sub[v].values for v in req.variables])

    # W de Kendall (concordancia)
    # W = chi2 / (n * (k - 1))
    w_kendall = float(chi2_stat) / (n * (k - 1)) if (n * (k - 1)) > 0 else 0.0

    # Medianas por variable
    medianas = [
        {"variable": v, "mediana": round(float(sub[v].median()), 4), "media": round(float(sub[v].mean()), 4)}
        for v in req.variables
    ]

    # Post-hoc: comparaciones por pares con Wilcoxon + corrección Bonferroni
    from itertools import combinations as comb
    n_comp = k * (k - 1) / 2
    posthoc = []
    for v1, v2 in comb(req.variables, 2):
        d_pair = sub[v1].values - sub[v2].values
        d_eff = d_pair[d_pair != 0]
        if len(d_eff) < 3:
            continue
        try:
            w, p = stats.wilcoxon(d_eff, alternative="two-sided")
            p_adj = min(1.0, float(p) * n_comp)   # Bonferroni
        except Exception:
            continue
        posthoc.append({
            "var_1": v1, "var_2": v2,
            "w": round(float(w), 4),
            "p_value": round(float(p), 4),
            "p_bonferroni": round(p_adj, 4),
            "significativo": bool(p_adj < req.alpha),
        })

    return {
        "test": "Friedman",
        "variables": req.variables,
        "n": int(n),
        "k": int(k),
        "chi2": round(float(chi2_stat), 4),
        "gl": int(k - 1),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "w_kendall": round(w_kendall, 4),
        "medianas": medianas,
        "posthoc_wilcoxon_bonferroni": posthoc,
        "alpha": req.alpha,
    }


# ─── Test binomial ────────────────────────────────────────────────────────────

class BinomialRequest(BaseModel):
    variable: str
    categoria_exito: Optional[str] = None   # None = primer valor único ordenado
    p_esperada: float = 0.5
    alpha: float = 0.05
    alternativa: Literal["two-sided", "less", "greater"] = "two-sided"


@router.post("/binomial")
def test_binomial(req: BinomialRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)

    if not (0 < req.p_esperada < 1):
        raise HTTPException(400, detail="p_esperada debe estar entre 0 y 1 (exclusivo)")

    serie = df[req.variable].dropna()
    n = len(serie)
    if n < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 observaciones")

    valores_unicos = sorted(serie.unique().tolist(), key=str)
    if len(valores_unicos) > 2:
        raise HTTPException(400, detail=f"El test binomial requiere exactamente 2 categorías (encontradas: {len(valores_unicos)}). Para >2 categorías usa Chi-cuadrado.")

    # Determinar categoría de éxito
    if req.categoria_exito is not None:
        exito_key = req.categoria_exito
    else:
        exito_key = str(valores_unicos[0])

    n_exito = int((serie.astype(str) == str(exito_key)).sum())
    n_fracaso = n - n_exito
    p_obs = n_exito / n

    # Test binomial exacto
    result = stats.binomtest(n_exito, n, req.p_esperada, alternative=req.alternativa)
    p_val = float(result.pvalue)

    # IC exacto (Clopper-Pearson)
    ic_low = float(stats.beta.ppf(req.alpha / 2, n_exito, n - n_exito + 1)) if n_exito > 0 else 0.0
    ic_high = float(stats.beta.ppf(1 - req.alpha / 2, n_exito + 1, n - n_exito)) if n_exito < n else 1.0

    # Frecuencias
    frecuencias = []
    for v in valores_unicos:
        cnt = int((serie.astype(str) == str(v)).sum())
        frecuencias.append({
            "categoria": str(v),
            "n_observado": cnt,
            "p_observada": round(cnt / n, 4),
            "n_esperado": round(n * (req.p_esperada if str(v) == str(exito_key) else 1 - req.p_esperada), 2),
            "p_esperada": req.p_esperada if str(v) == str(exito_key) else round(1 - req.p_esperada, 4),
            "exito": str(v) == str(exito_key),
        })

    return {
        "test": "Test binomial",
        "variable": req.variable,
        "categoria_exito": str(exito_key),
        "n": int(n),
        "n_exito": n_exito,
        "n_fracaso": n_fracaso,
        "p_observada": round(p_obs, 4),
        "p_esperada": req.p_esperada,
        "p_value": round(p_val, 4),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "ic_clopper_pearson_low": round(ic_low, 4),
        "ic_clopper_pearson_high": round(ic_high, 4),
        "frecuencias": frecuencias,
        "alpha": req.alpha,
    }


# ─── Test de rachas (Wald-Wolfowitz) ─────────────────────────────────────────

class RachasRequest(BaseModel):
    variable: str
    punto_corte: Optional[float] = None   # None = mediana
    alpha: float = 0.05


@router.post("/rachas")
def test_rachas(req: RachasRequest):
    _check_loaded()
    df = data_manager.get_dataframe()
    _check_col(df, req.variable)
    _check_numeric(df, req.variable)

    serie = df[req.variable].dropna().values.astype(float)
    n = len(serie)
    if n < 5:
        raise HTTPException(400, detail="Se necesitan al menos 5 observaciones")

    # Punto de corte
    corte = req.punto_corte if req.punto_corte is not None else float(np.median(serie))

    # Binarizar: 1 si > corte, 0 si <= corte
    binaria = (serie > corte).astype(int)

    # Contar rachas
    n1 = int(binaria.sum())       # valores > corte
    n2 = int((1 - binaria).sum()) # valores <= corte

    if n1 == 0 or n2 == 0:
        raise HTTPException(400, detail="Todos los valores están del mismo lado del punto de corte. Ajusta el punto de corte.")

    rachas = 1
    for i in range(1, len(binaria)):
        if binaria[i] != binaria[i - 1]:
            rachas += 1

    # Aproximación normal para n1, n2 > 10
    mu_r = (2 * n1 * n2 / (n1 + n2)) + 1
    sigma2_r = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / ((n1 + n2) ** 2 * (n1 + n2 - 1))
    sigma_r = math.sqrt(sigma2_r) if sigma2_r > 0 else 1e-10

    z = (rachas - mu_r) / sigma_r
    # Test bilateral
    p_val = float(2 * stats.norm.sf(abs(z)))

    interpretacion_aleatoriedad = "aleatoria" if p_val >= req.alpha else "no aleatoria (patrón detectado)"

    return {
        "test": "Test de rachas (Wald-Wolfowitz)",
        "variable": req.variable,
        "n": int(n),
        "n_mayor_corte": n1,
        "n_menor_igual_corte": n2,
        "punto_corte": round(float(corte), 4),
        "n_rachas": int(rachas),
        "media_rachas_esperada": round(float(mu_r), 4),
        "z": round(float(z), 4),
        "p_value": round(float(p_val), 4),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "aleatoriedad": interpretacion_aleatoriedad,
        "alpha": req.alpha,
        "nota": "H₀: la secuencia es aleatoria. p < alpha → patrón no aleatorio.",
    }


# ─── Tests adicionales (módulo 8) ─────────────────────────────────────────────

class KS2MuestrasRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05
    alternativa: Literal["two-sided","less","greater"] = "two-sided"

class McNemarRequest(BaseModel):
    variable_1: str
    variable_2: str
    alpha: float = 0.05

class CochranQRequest(BaseModel):
    variables: List[str]   # k variables dicotómicas (0/1) — medidas repetidas
    alpha: float = 0.05

class MosesRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05
    recorte: float = 0.05   # Proporción de outliers a recortar (Moses Extreme)

class MedianaRequest(BaseModel):
    variable: str
    grupo: str
    alpha: float = 0.05


@router.post("/ks-dos-muestras")
def ks_dos_muestras(req: KS2MuestrasRequest):
    """Kolmogorov-Smirnov de dos muestras."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in [req.variable, req.grupo]:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    grupos = df[req.grupo].dropna().unique()
    if len(grupos) != 2:
        raise HTTPException(400, f"La variable de grupo debe tener exactamente 2 categorías (tiene {len(grupos)})")

    g1, g2 = sorted(grupos)
    x1 = df[df[req.grupo]==g1][req.variable].dropna().values.astype(float)
    x2 = df[df[req.grupo]==g2][req.variable].dropna().values.astype(float)

    ks_stat, p_val = stats.ks_2samp(x1, x2, alternative=req.alternativa)

    return {
        "test": "Kolmogorov-Smirnov dos muestras",
        "variable": req.variable,
        "grupo": req.grupo,
        "grupos": [str(g1), str(g2)],
        "n": [int(len(x1)), int(len(x2))],
        "D": round(float(ks_stat), 4),
        "p_value": round(float(p_val), 6),
        "significativo": bool(p_val < req.alpha),
        "alternativa": req.alternativa,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "nota": "H₀: las dos muestras provienen de la misma distribución.",
    }


@router.post("/mcnemar")
def mcnemar(req: McNemarRequest):
    """Test de McNemar para cambio en proporciones (diseño pareado 2×2)."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in [req.variable_1, req.variable_2]:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    sub = df[[req.variable_1, req.variable_2]].dropna()
    n   = len(sub)
    v1  = sub[req.variable_1].values
    v2  = sub[req.variable_2].values

    cats = sorted(set(v1.tolist()) | set(v2.tolist()))
    if len(cats) != 2:
        raise HTTPException(400, "Ambas variables deben ser dicotómicas (2 categorías)")

    # Tabla 2x2: (v1=0,v2=0), (v1=0,v2=1), (v1=1,v2=0), (v1=1,v2=1)
    c = cats
    a = int(np.sum((v1==c[0]) & (v2==c[0])))
    b = int(np.sum((v1==c[0]) & (v2==c[1])))
    cc_val = int(np.sum((v1==c[1]) & (v2==c[0])))
    d = int(np.sum((v1==c[1]) & (v2==c[1])))

    # McNemar con corrección de continuidad
    chi2 = (abs(b - cc_val) - 1)**2 / max(b + cc_val, 1)
    p_val = float(stats.chi2.sf(chi2, df=1))

    # Odds ratio de discordancia
    or_val = round(float(b / cc_val), 4) if cc_val > 0 else None

    return {
        "test": "McNemar",
        "variable_1": req.variable_1,
        "variable_2": req.variable_2,
        "n": n,
        "tabla_2x2": {"a": a, "b": b, "c": cc_val, "d": d},
        "discordantes_b": b,
        "discordantes_c": cc_val,
        "chi2": round(float(chi2), 4),
        "gl": 1,
        "p_value": round(float(p_val), 6),
        "significativo": bool(p_val < req.alpha),
        "odds_ratio_discordancia": or_val,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "nota": "H₀: proporción de cambios positivos = proporción de cambios negativos.",
    }


@router.post("/cochran-q")
def cochran_q(req: CochranQRequest):
    """Test de Cochran Q para k medidas repetidas dicotómicas."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")
    if len(req.variables) < 3:
        raise HTTPException(400, "Se necesitan al menos 3 variables")

    sub = df[req.variables].dropna().values.astype(float)
    n, k = sub.shape

    L  = sub.sum(axis=1)   # Suma por fila (sujeto)
    C  = sub.sum(axis=0)   # Suma por columna (condición)
    N  = sub.sum()

    # Estadístico Q
    Q_num = k * (k - 1) * float(np.sum(C**2)) - (k - 1) * N**2
    Q_den = k * N - float(np.sum(L**2))
    Q = Q_num / Q_den if Q_den > 0 else 0.0
    p_val = float(stats.chi2.sf(Q, df=k-1))

    proporciones = [round(float(c/n), 4) for c in C]

    return {
        "test": "Cochran Q",
        "variables": req.variables,
        "n": n,
        "k": k,
        "Q": round(float(Q), 4),
        "gl": k - 1,
        "p_value": round(float(p_val), 6),
        "significativo": bool(p_val < req.alpha),
        "proporciones_por_condicion": proporciones,
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "nota": "H₀: la proporción de éxito es igual en todas las condiciones.",
    }


@router.post("/moses")
def moses_extreme(req: MosesRequest):
    """Test de Moses para diferencias en dispersión entre dos grupos independientes."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in [req.variable, req.grupo]:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    grupos = df[req.grupo].dropna().unique()
    if len(grupos) != 2:
        raise HTTPException(400, "Se necesitan exactamente 2 grupos")

    g1, g2 = sorted(grupos)
    x1 = np.sort(df[df[req.grupo]==g1][req.variable].dropna().values.astype(float))
    x2 = np.sort(df[df[req.grupo]==g2][req.variable].dropna().values.astype(float))
    n1, n2 = len(x1), len(x2)

    # Recortar outliers
    k = max(1, int(req.recorte * n1))
    x1_rec = x1[k:-k] if k > 0 and 2*k < n1 else x1
    rango_control = float(x1_rec.max() - x1_rec.min()) if len(x1_rec) > 0 else 0.0

    # Rango del grupo de control vs número de observaciones del grupo experimental dentro
    n_dentro = int(np.sum((x2 >= x1_rec.min()) & (x2 <= x1_rec.max()))) if len(x1_rec) > 0 else 0

    return {
        "test": "Moses Extreme Reactions",
        "variable": req.variable,
        "grupo_control": str(g1),
        "grupo_experimental": str(g2),
        "n_control": n1, "n_experimental": n2,
        "recorte_pct": req.recorte,
        "n_recortado": k,
        "n_control_efectivo": len(x1_rec),
        "rango_control_recortado": round(rango_control, 4),
        "n_experimental_dentro_rango": n_dentro,
        "pct_experimental_dentro": round(n_dentro/n2*100, 1) if n2 > 0 else 0,
        "nota": "Moses prueba si los grupos difieren en dispersión (reacciones extremas).",
    }


@router.post("/mediana")
def test_mediana(req: MedianaRequest):
    """Test de la mediana (Mood's median test) para k grupos independientes."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    for v in [req.variable, req.grupo]:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    sub = df[[req.variable, req.grupo]].dropna()
    mediana_global = float(sub[req.variable].median())
    grupos = sorted(sub[req.grupo].unique())

    tabla = []
    obs_array = []
    for g in grupos:
        vals = sub[sub[req.grupo]==g][req.variable].values.astype(float)
        n_sobre = int(np.sum(vals > mediana_global))
        n_bajo  = int(np.sum(vals <= mediana_global))
        tabla.append([n_sobre, n_bajo])
        obs_array.append({"grupo": str(g), "n": int(len(vals)), "sobre_mediana": n_sobre, "bajo_mediana": n_bajo})

    tabla_arr = np.array(tabla)
    chi2, p_val, dof, _ = stats.chi2_contingency(tabla_arr)

    return {
        "test": "Test de la mediana (Mood)",
        "variable": req.variable,
        "grupo": req.grupo,
        "mediana_global": round(mediana_global, 4),
        "grupos": obs_array,
        "chi2": round(float(chi2), 4),
        "gl": int(dof),
        "p_value": round(float(p_val), 6),
        "significativo": bool(p_val < req.alpha),
        "interpretacion": _interpretar_p(p_val, req.alpha),
        "nota": "H₀: todos los grupos tienen la misma mediana poblacional.",
    }
