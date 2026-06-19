"""
Análisis de Potencia y Tamaño Muestral — equivalente a SPSS SamplePower.
Calcula n, potencia o tamaño de efecto según el test elegido.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
from scipy import stats

router = APIRouter()


class PotenciaRequest(BaseModel):
    test: str               # t_una_muestra | t_independientes | t_relacionadas |
                            # anova | correlacion | chi2 | regresion | proporcion
    calcular: str = "n"    # n | potencia | efecto
    # Parámetros comunes
    alpha: float = 0.05
    potencia: float = 0.80
    n: Optional[int] = None
    # Tamaño de efecto (depende del test)
    d: Optional[float] = None        # Cohen's d (t-tests)
    f: Optional[float] = None        # Cohen's f (ANOVA)
    r: Optional[float] = None        # Correlación de Pearson
    w: Optional[float] = None        # Cohen's w (chi²)
    f2: Optional[float] = None       # Cohen's f² (regresión)
    # Parámetros específicos
    k: int = 2                       # Grupos (ANOVA) / predictores (regresión)
    bilateral: bool = True
    p1: Optional[float] = None       # Proporción grupo 1
    p2: Optional[float] = None       # Proporción grupo 2


def _z_alpha(alpha, bilateral):
    return stats.norm.ppf(1 - alpha / (2 if bilateral else 1))

def _z_beta(potencia):
    return stats.norm.ppf(potencia)

# ─── T-test una muestra ───────────────────────────────────────────────────────

def _t_una_muestra_n(d, alpha, potencia, bilateral):
    za = _z_alpha(alpha, bilateral)
    zb = _z_beta(potencia)
    return int(np.ceil(((za + zb) / d) ** 2))

def _t_una_muestra_pot(n, d, alpha, bilateral):
    za = _z_alpha(alpha, bilateral)
    nc = d * np.sqrt(n)
    return float(stats.norm.cdf(nc - za) + stats.norm.cdf(-nc - za))

def _t_una_muestra_d(n, alpha, potencia, bilateral):
    za = _z_alpha(alpha, bilateral)
    zb = _z_beta(potencia)
    return float((za + zb) / np.sqrt(n))

# ─── T-test independientes ────────────────────────────────────────────────────

def _t_indep_n(d, alpha, potencia, bilateral):
    za = _z_alpha(alpha, bilateral)
    zb = _z_beta(potencia)
    return int(np.ceil(2 * ((za + zb) / d) ** 2))

def _t_indep_pot(n_por_grupo, d, alpha, bilateral):
    za = _z_alpha(alpha, bilateral)
    nc = d * np.sqrt(n_por_grupo / 2)
    return float(stats.norm.cdf(nc - za))

# ─── ANOVA one-way ────────────────────────────────────────────────────────────

def _anova_n(f, alpha, potencia, k):
    """n por grupo para ANOVA one-way."""
    for n in range(2, 10000):
        nc  = f * np.sqrt(n * k)
        gl1 = k - 1
        gl2 = k * (n - 1)
        fc  = stats.f.ppf(1 - alpha, gl1, gl2)
        pot = 1 - stats.ncf.cdf(fc, gl1, gl2, nc**2)
        if pot >= potencia:
            return n
    return 10000

def _anova_pot(n, f, alpha, k):
    nc  = f * np.sqrt(n * k)
    gl1 = k - 1
    gl2 = k * (n - 1)
    fc  = stats.f.ppf(1 - alpha, gl1, gl2)
    return float(1 - stats.ncf.cdf(fc, gl1, gl2, nc**2))

# ─── Correlación ─────────────────────────────────────────────────────────────

def _corr_n(r, alpha, potencia, bilateral):
    za = _z_alpha(alpha, bilateral)
    zb = _z_beta(potencia)
    zr = np.arctanh(r)
    return int(np.ceil(((za + zb) / zr) ** 2 + 3))

def _corr_pot(n, r, alpha, bilateral):
    za = _z_alpha(alpha, bilateral)
    zr = np.arctanh(r)
    z  = zr * np.sqrt(n - 3) - za
    return float(stats.norm.cdf(z))

# ─── Chi-cuadrado ─────────────────────────────────────────────────────────────

def _chi2_n(w, alpha, potencia, gl):
    for n in range(2, 100000):
        fc  = stats.chi2.ppf(1 - alpha, gl)
        pot = 1 - stats.ncx2.cdf(fc, gl, (w**2) * n)
        if pot >= potencia:
            return n
    return 100000

def _chi2_pot(n, w, alpha, gl):
    fc  = stats.chi2.ppf(1 - alpha, gl)
    return float(1 - stats.ncx2.cdf(fc, gl, (w**2) * n))

# ─── Regresión lineal múltiple ────────────────────────────────────────────────

def _reg_n(f2, alpha, potencia, k):
    """n total para regresión múltiple."""
    u = k
    for n in range(k + 2, 100000):
        v   = n - k - 1
        fc  = stats.f.ppf(1 - alpha, u, v)
        nc  = f2 * n
        pot = 1 - stats.ncf.cdf(fc, u, v, nc)
        if pot >= potencia:
            return n
    return 100000

def _reg_pot(n, f2, alpha, k):
    u  = k
    v  = n - k - 1
    fc = stats.f.ppf(1 - alpha, u, v)
    nc = f2 * n
    return float(1 - stats.ncf.cdf(fc, u, v, nc))

# ─── Diferencia de proporciones ───────────────────────────────────────────────

def _prop_n(p1, p2, alpha, potencia, bilateral):
    za = _z_alpha(alpha, bilateral)
    zb = _z_beta(potencia)
    p_bar = (p1 + p2) / 2
    num = (za * np.sqrt(2 * p_bar * (1 - p_bar)) + zb * np.sqrt(p1*(1-p1) + p2*(1-p2)))**2
    den = (p1 - p2)**2
    return int(np.ceil(num / den))

def _prop_pot(n, p1, p2, alpha, bilateral):
    za = _z_alpha(alpha, bilateral)
    p_bar = (p1 + p2) / 2
    se_null = np.sqrt(2 * p_bar * (1-p_bar) / n)
    se_alt  = np.sqrt((p1*(1-p1) + p2*(1-p2)) / n)
    z = (abs(p1 - p2) - za * se_null) / se_alt
    return float(stats.norm.cdf(z))


@router.post("/calcular")
def calcular_potencia(req: PotenciaRequest):
    test = req.test
    calc = req.calcular

    result = {"test": test, "calcular": calc, "alpha": req.alpha, "bilateral": req.bilateral}

    try:
        if test == "t_una_muestra":
            d = req.d or 0.5
            if calc == "n":
                n = _t_una_muestra_n(d, req.alpha, req.potencia, req.bilateral)
                result.update({"n": n, "d": d, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _t_una_muestra_pot(req.n, d, req.alpha, req.bilateral)
                result.update({"n": req.n, "d": d, "potencia": round(pot, 4)})
            else:
                d_calc = _t_una_muestra_d(req.n, req.alpha, req.potencia, req.bilateral)
                result.update({"n": req.n, "d": round(d_calc, 4), "potencia": req.potencia})

        elif test == "t_independientes":
            d = req.d or 0.5
            if calc == "n":
                n = _t_indep_n(d, req.alpha, req.potencia, req.bilateral)
                result.update({"n_por_grupo": n, "n_total": n * 2, "d": d, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _t_indep_pot(req.n, d, req.alpha, req.bilateral)
                result.update({"n_por_grupo": req.n, "d": d, "potencia": round(pot, 4)})

        elif test == "t_relacionadas":
            d = req.d or 0.5
            if calc == "n":
                n = _t_una_muestra_n(d, req.alpha, req.potencia, req.bilateral)
                result.update({"n": n, "d": d, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _t_una_muestra_pot(req.n, d, req.alpha, req.bilateral)
                result.update({"n": req.n, "d": d, "potencia": round(pot, 4)})

        elif test == "anova":
            f = req.f or 0.25
            if calc == "n":
                n = _anova_n(f, req.alpha, req.potencia, req.k)
                result.update({"n_por_grupo": n, "n_total": n * req.k, "f": f, "k": req.k, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _anova_pot(req.n, f, req.alpha, req.k)
                result.update({"n_por_grupo": req.n, "f": f, "k": req.k, "potencia": round(pot, 4)})

        elif test == "correlacion":
            r = req.r or 0.3
            if calc == "n":
                n = _corr_n(r, req.alpha, req.potencia, req.bilateral)
                result.update({"n": n, "r": r, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _corr_pot(req.n, r, req.alpha, req.bilateral)
                result.update({"n": req.n, "r": r, "potencia": round(pot, 4)})

        elif test == "chi2":
            w = req.w or 0.3
            gl = (req.k - 1)
            if calc == "n":
                n = _chi2_n(w, req.alpha, req.potencia, gl)
                result.update({"n": n, "w": w, "gl": gl, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _chi2_pot(req.n, w, req.alpha, gl)
                result.update({"n": req.n, "w": w, "gl": gl, "potencia": round(pot, 4)})

        elif test == "regresion":
            f2 = req.f2 or 0.15
            if calc == "n":
                n = _reg_n(f2, req.alpha, req.potencia, req.k)
                result.update({"n": n, "f2": f2, "k": req.k, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _reg_pot(req.n, f2, req.alpha, req.k)
                result.update({"n": req.n, "f2": f2, "k": req.k, "potencia": round(pot, 4)})

        elif test == "proporcion":
            p1 = req.p1 or 0.5
            p2 = req.p2 or 0.3
            if calc == "n":
                n = _prop_n(p1, p2, req.alpha, req.potencia, req.bilateral)
                result.update({"n_por_grupo": n, "n_total": n * 2, "p1": p1, "p2": p2, "potencia": req.potencia})
            elif calc == "potencia":
                pot = _prop_pot(req.n, p1, p2, req.alpha, req.bilateral)
                result.update({"n_por_grupo": req.n, "p1": p1, "p2": p2, "potencia": round(pot, 4)})

        else:
            raise HTTPException(status_code=400, detail=f"Test '{test}' no reconocido")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Interpretación del tamaño de efecto
    result["interpretacion_efecto"] = _interpretar_efecto(test, result)
    return result


@router.post("/curva-potencia")
def curva_potencia(req: PotenciaRequest):
    """Genera curva de potencia variando n (para graficar)."""
    ns = list(range(5, 501, 5))
    puntos = []

    for n in ns:
        try:
            if req.test == "t_una_muestra":
                pot = _t_una_muestra_pot(n, req.d or 0.5, req.alpha, req.bilateral)
            elif req.test == "t_independientes":
                pot = _t_indep_pot(n, req.d or 0.5, req.alpha, req.bilateral)
            elif req.test == "anova":
                pot = _anova_pot(n, req.f or 0.25, req.alpha, req.k)
            elif req.test == "correlacion":
                pot = _corr_pot(n, req.r or 0.3, req.alpha, req.bilateral)
            elif req.test == "chi2":
                pot = _chi2_pot(n, req.w or 0.3, req.alpha, req.k - 1)
            elif req.test == "regresion":
                pot = _reg_pot(n, req.f2 or 0.15, req.alpha, req.k)
            else:
                continue
            puntos.append({"n": n, "potencia": round(min(float(pot), 1.0), 4)})
        except Exception:
            continue

    return {"curva": puntos, "alpha": req.alpha}


def _interpretar_efecto(test, result):
    if test in ("t_una_muestra", "t_independientes", "t_relacionadas"):
        d = result.get("d", 0)
        if d < 0.2: return "trivial (d < 0.2)"
        if d < 0.5: return "pequeño (0.2 ≤ d < 0.5)"
        if d < 0.8: return "mediano (0.5 ≤ d < 0.8)"
        return "grande (d ≥ 0.8)"
    if test == "anova":
        f = result.get("f", 0)
        if f < 0.1: return "trivial"
        if f < 0.25: return "pequeño"
        if f < 0.40: return "mediano"
        return "grande"
    if test == "correlacion":
        r = result.get("r", 0)
        if abs(r) < 0.1: return "trivial"
        if abs(r) < 0.3: return "pequeño"
        if abs(r) < 0.5: return "mediano"
        return "grande"
    return ""
