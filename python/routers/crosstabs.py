"""
Tablas Cruzadas — equivalente a SPSS Analyze > Descriptive Statistics > Crosstabs.
Soporta: tabla NxM, estadísticos chi-cuadrado, medidas de asociación,
         residuos, porcentajes por fila/columna/total, tablas por capas.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats
from scipy.stats import chi2_contingency, fisher_exact

from services import data_manager

router = APIRouter()


class CrosstabsRequest(BaseModel):
    variable_fila: str
    variable_columna: str
    variable_capa: Optional[str] = None       # SPLIT por tercera variable
    porcentaje_fila: bool = True
    porcentaje_columna: bool = True
    porcentaje_total: bool = True
    residuos: bool = True                      # Residuos tipificados y corregidos
    estadisticos: bool = True                  # Chi², Phi, V de Cramér, etc.
    expected: bool = False                     # Frecuencias esperadas
    alpha: float = 0.05


def _tabla_una_capa(df: pd.DataFrame, var_fila: str, var_col: str, req: CrosstabsRequest) -> dict:
    serie_f = df[var_fila].fillna("(Perdido)")
    serie_c = df[var_col].fillna("(Perdido)")

    # Tabla de frecuencias observadas
    tabla = pd.crosstab(serie_f, serie_c, margins=True, margins_name="Total")
    obs = pd.crosstab(serie_f, serie_c)

    filas = [str(v) for v in obs.index.tolist()]
    columnas = [str(v) for v in obs.columns.tolist()]
    n_total = int(obs.values.sum())

    # Frecuencias observadas
    frec_obs = obs.values.tolist()

    # Porcentajes
    pct_fila = None
    pct_col = None
    pct_total = None

    row_sums = obs.sum(axis=1).values
    col_sums = obs.sum(axis=0).values

    if req.porcentaje_fila:
        with np.errstate(divide='ignore', invalid='ignore'):
            pct_fila = (obs.div(obs.sum(axis=1).replace(0, np.nan), axis=0) * 100).fillna(0).round(1).values.tolist()

    if req.porcentaje_columna:
        with np.errstate(divide='ignore', invalid='ignore'):
            pct_col = (obs.div(obs.sum(axis=0).replace(0, np.nan), axis=1) * 100).fillna(0).round(1).values.tolist()

    if req.porcentaje_total:
        pct_total = (obs / n_total * 100).round(1).values.tolist() if n_total > 0 else None

    # Frecuencias esperadas
    if obs.shape[0] < 2 or obs.shape[1] < 2:
        raise ValueError(
            f"La tabla tiene forma {obs.shape[0]}×{obs.shape[1]}. "
            "Se necesitan al menos 2 categorías en cada variable para calcular chi-cuadrado."
        )
    chi2_val, p_val, dof, expected_arr = chi2_contingency(obs.values, correction=False)
    frecuencias_esperadas = expected_arr.round(2).tolist() if req.expected else None

    # Residuos
    residuos_brutos = None
    residuos_tipificados = None
    residuos_corregidos = None

    if req.residuos:
        obs_arr = obs.values.astype(float)
        residuos_brutos = (obs_arr - expected_arr).round(3).tolist()
        residuos_tipificados = ((obs_arr - expected_arr) / np.sqrt(expected_arr)).round(3).tolist()
        # Residuos corregidos (ajustados) de Haberman
        row_s = obs_arr.sum(axis=1, keepdims=True)
        col_s = obs_arr.sum(axis=0, keepdims=True)
        n = obs_arr.sum()
        denom = np.sqrt(expected_arr * (1 - row_s / n) * (1 - col_s / n))
        with np.errstate(divide='ignore', invalid='ignore'):
            res_corr = np.where(denom > 0, (obs_arr - expected_arr) / denom, 0)
        residuos_corregidos = res_corr.round(3).tolist()

    # Estadísticos
    estadisticos_out = None
    if req.estadisticos:
        n = n_total
        k = min(obs.shape)

        # Chi-cuadrado de Pearson
        # Chi-cuadrado con corrección de Yates (solo para 2x2)
        chi2_yates, p_yates = None, None
        if obs.shape == (2, 2):
            chi2_yates, p_yates, _, _ = chi2_contingency(obs.values, correction=True)
            chi2_yates = round(float(chi2_yates), 4)
            p_yates = round(float(p_yates), 6)

        # Razón de verosimilitudes (G²)
        obs_arr = obs.values.astype(float)
        with np.errstate(divide='ignore', invalid='ignore'):
            g2_terms = np.where(obs_arr > 0, obs_arr * np.log(obs_arr / expected_arr), 0)
        g2 = float(2 * g2_terms.sum())

        # Fisher exacto (solo 2x2)
        fisher_p = None
        if obs.shape == (2, 2):
            _, fisher_p = fisher_exact(obs.values)
            fisher_p = round(float(fisher_p), 6)

        # Phi (solo 2x2)
        phi = None
        if obs.shape == (2, 2):
            phi = round(float(np.sqrt(chi2_val / n)), 4)

        # V de Cramér
        v_cramer = round(float(np.sqrt(chi2_val / (n * (k - 1)))), 4)

        # Coeficiente de contingencia
        c_contingencia = round(float(np.sqrt(chi2_val / (chi2_val + n))), 4)

        # Lambda de Goodman-Kruskal
        # Fila como variable dependiente
        col_mode_sum = obs_arr.max(axis=0).sum()
        row_mode = obs_arr.sum(axis=1).max()
        lambda_fila = round(float((col_mode_sum - row_mode) / (n - row_mode)) if (n - row_mode) > 0 else 0, 4)

        # Tau de Goodman-Kruskal (tau_b simplificado)
        # Gamma de Goodman-Kruskal (para ordinales)
        gamma, tau_b, somers_d = None, None, None
        try:
            if obs.shape[0] > 1 and obs.shape[1] > 1:
                # Concordantes y discordantes
                obs_flat = obs_arr
                C, D = 0, 0
                for i in range(obs_flat.shape[0]):
                    for j in range(obs_flat.shape[1]):
                        c_sum = obs_flat[i+1:, j+1:].sum() + obs_flat[:i, :j].sum()
                        d_sum = obs_flat[i+1:, :j].sum() + obs_flat[:i, j+1:].sum()
                        C += obs_flat[i, j] * c_sum
                        D += obs_flat[i, j] * d_sum
                if C + D > 0:
                    gamma = round(float((C - D) / (C + D)), 4)
                # Tau-b de Kendall
                nr = n * (n - 1) / 2
                row_ties = sum(r * (r - 1) / 2 for r in obs_flat.sum(axis=1))
                col_ties = sum(c * (c - 1) / 2 for c in obs_flat.sum(axis=0))
                denom_tau = np.sqrt((nr - row_ties) * (nr - col_ties))
                if denom_tau > 0:
                    tau_b = round(float((C - D) / denom_tau), 4)
        except Exception:
            pass

        estadisticos_out = {
            "n": n,
            "chi2_pearson": round(float(chi2_val), 4),
            "chi2_gl": int(dof),
            "chi2_p": round(float(p_val), 6),
            "chi2_significativo": bool(p_val < req.alpha),
            "chi2_yates": chi2_yates,
            "chi2_yates_p": p_yates,
            "razon_verosimilitud_g2": round(g2, 4),
            "razon_verosimilitud_gl": int(dof),
            "razon_verosimilitud_p": round(float(stats.chi2.sf(g2, dof)), 6),
            "fisher_exacto_p": fisher_p,
            "phi": phi,
            "v_cramer": v_cramer,
            "c_contingencia": c_contingencia,
            "lambda_fila": lambda_fila,
            "gamma": gamma,
            "tau_b_kendall": tau_b,
            "minima_frecuencia_esperada": round(float(expected_arr.min()), 2),
            "celdas_esperadas_menor_5_pct": round(
                float((expected_arr < 5).sum() / expected_arr.size * 100), 1
            ),
            "interpretacion_v": _interpretar_v(v_cramer),
        }

    # Totales marginales
    totales_fila = row_sums.tolist()
    totales_col = col_sums.tolist()

    return {
        "variable_fila": var_fila,
        "variable_columna": var_col,
        "filas": filas,
        "columnas": columnas,
        "n_total": n_total,
        "frecuencias_observadas": frec_obs,
        "totales_fila": totales_fila,
        "totales_columna": totales_col,
        "porcentaje_fila": pct_fila,
        "porcentaje_columna": pct_col,
        "porcentaje_total": pct_total,
        "frecuencias_esperadas": frecuencias_esperadas,
        "residuos_brutos": residuos_brutos,
        "residuos_tipificados": residuos_tipificados,
        "residuos_corregidos": residuos_corregidos,
        "estadisticos": estadisticos_out,
    }


def _interpretar_v(v: float) -> str:
    if v < 0.1:   return "muy débil"
    if v < 0.2:   return "débil"
    if v < 0.3:   return "moderada"
    if v < 0.5:   return "fuerte"
    return "muy fuerte"


def _validar_variable_categorica(df: pd.DataFrame, nombre: str, rol: str):
    """Lanza HTTPException si la variable tiene demasiados valores únicos para crosstabs."""
    n_uniq = df[nombre].nunique(dropna=True)
    if n_uniq > 50:
        raise HTTPException(
            status_code=400,
            detail=(
                f"La variable '{nombre}' usada como {rol} tiene {n_uniq} valores únicos. "
                "Crosstabs requiere variables categóricas (nominales u ordinales). "
                "Usa Transformar > Recodificar para crear rangos antes de cruzarla."
            )
        )


@router.post("/tabla")
def crosstabs(req: CrosstabsRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")

    df = data_manager.get_dataframe()

    for v in [req.variable_fila, req.variable_columna]:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    _validar_variable_categorica(df, req.variable_fila, "variable de fila")
    _validar_variable_categorica(df, req.variable_columna, "variable de columna")

    if req.variable_capa:
        if req.variable_capa not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable capa '{req.variable_capa}' no encontrada")
        _validar_variable_categorica(df, req.variable_capa, "variable de capa")

        grupos = df[req.variable_capa].dropna().unique()
        capas = []
        for g in sorted(grupos):
            df_g = df[df[req.variable_capa] == g]
            try:
                resultado_capa = _tabla_una_capa(df_g, req.variable_fila, req.variable_columna, req)
                resultado_capa["capa"] = str(g)
                capas.append(resultado_capa)
            except Exception as e:
                capas.append({"capa": str(g), "error": str(e)})
        return {"tipo": "crosstabs_con_capa", "variable_capa": req.variable_capa, "capas": capas}

    resultado = _tabla_una_capa(df, req.variable_fila, req.variable_columna, req)
    resultado["tipo"] = "crosstabs"
    return resultado


class MultiplesRequest(BaseModel):
    pares: list[dict]   # [{"fila": "var1", "columna": "var2"}, ...]
    estadisticos: bool = True
    alpha: float = 0.05


@router.post("/multiples")
def crosstabs_multiples(req: MultiplesRequest):
    """Ejecuta múltiples crosstabs de una vez."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    resultados = []
    for par in req.pares:
        var_f = par.get("fila")
        var_c = par.get("columna")
        try:
            r = CrosstabsRequest(
                variable_fila=var_f,
                variable_columna=var_c,
                estadisticos=req.estadisticos,
                alpha=req.alpha,
            )
            res = _tabla_una_capa(df, var_f, var_c, r)
            res["tipo"] = "crosstabs"
            resultados.append(res)
        except Exception as e:
            resultados.append({"variable_fila": var_f, "variable_columna": var_c, "error": str(e)})
    return {"resultados": resultados}


