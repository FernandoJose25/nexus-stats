"""
Análisis de Supervivencia — equivalente a SPSS Analyze > Survival.
Kaplan-Meier, tablas de vida actuariales, regresión de Cox.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats

from services import data_manager

router = APIRouter()


class KaplanMeierRequest(BaseModel):
    variable_tiempo: str
    variable_evento: str          # 1=evento ocurrió, 0=censurado
    variable_grupo: Optional[str] = None  # Para comparar curvas
    valor_evento: Optional[float] = 1.0  # Valor que indica que el evento ocurrió
    alpha: float = 0.05
    metodo_ic: str = "greenwood"   # greenwood | loglog


class TablaVidaRequest(BaseModel):
    variable_tiempo: str
    variable_evento: str
    n_intervalos: int = 10
    valor_evento: Optional[float] = 1.0


class CoxRequest(BaseModel):
    variable_tiempo: str
    variable_evento: str
    covariables: list[str]
    valor_evento: Optional[float] = 1.0
    alpha: float = 0.05


def _kaplan_meier_grupo(tiempo, evento) -> dict:
    """Calcula KM para un grupo: retorna tiempos, supervivencia, IC."""
    df = pd.DataFrame({'t': tiempo, 'e': evento}).sort_values('t').reset_index(drop=True)
    n = len(df)

    tiempos_evento = sorted(df[df['e'] == 1]['t'].unique())

    S = 1.0
    var_greenwood = 0.0
    curva = []
    at_risk = n

    for t in tiempos_evento:
        mask_t = df['t'] == t
        d_i = int(df[mask_t]['e'].sum())
        n_i = int((df['t'] >= t).sum())

        if n_i == 0:
            continue

        S *= (n_i - d_i) / n_i
        if n_i > d_i:
            var_greenwood += d_i / (n_i * (n_i - d_i))

        se = S * np.sqrt(var_greenwood)
        z = stats.norm.ppf(0.975)
        ic_lo = max(0, S - z * se)
        ic_hi = min(1, S + z * se)

        curva.append({
            't': float(t),
            'n_risk': n_i,
            'n_events': d_i,
            'S': round(float(S), 6),
            'SE': round(float(se), 6),
            'IC_low': round(float(ic_lo), 6),
            'IC_high': round(float(ic_hi), 6),
        })

    # Tiempo mediano de supervivencia (S <= 0.5)
    mediana = None
    for punto in curva:
        if punto['S'] <= 0.5:
            mediana = punto['t']
            break

    return {
        'n': n,
        'n_eventos': int(df['e'].sum()),
        'n_censurados': int((df['e'] == 0).sum()),
        'mediana_supervivencia': mediana,
        'curva': curva,
    }


@router.post("/kaplan-meier")
def kaplan_meier(req: KaplanMeierRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in [req.variable_tiempo, req.variable_evento]:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[[req.variable_tiempo, req.variable_evento]
                  + ([req.variable_grupo] if req.variable_grupo else [])].dropna()
    df_clean['_evento'] = (df_clean[req.variable_evento] == req.valor_evento).astype(int)

    resultado = {
        'tipo': 'Kaplan-Meier',
        'variable_tiempo': req.variable_tiempo,
        'variable_evento': req.variable_evento,
    }

    if req.variable_grupo:
        grupos = sorted(df_clean[req.variable_grupo].unique())
        curvas = {}
        for g in grupos:
            dg = df_clean[df_clean[req.variable_grupo] == g]
            curvas[str(g)] = _kaplan_meier_grupo(
                dg[req.variable_tiempo].values,
                dg['_evento'].values
            )

        # Log-rank test (Mantel-Haenszel)
        # Agrupa todos los tiempos de evento
        all_event_times = sorted(df_clean[df_clean['_evento'] == 1][req.variable_tiempo].unique())
        O_list = []  # observados por grupo
        E_list = []  # esperados por grupo
        n_grupos = len(grupos)

        for g in grupos:
            O_list.append(0.0)
            E_list.append(0.0)

        for t in all_event_times:
            n_i_total = int((df_clean[req.variable_tiempo] >= t).sum())
            d_i_total = int(((df_clean[req.variable_tiempo] == t) & (df_clean['_evento'] == 1)).sum())
            if n_i_total == 0:
                continue
            for gi, g in enumerate(grupos):
                dg = df_clean[df_clean[req.variable_grupo] == g]
                n_ig = int((dg[req.variable_tiempo] >= t).sum())
                d_ig = int(((dg[req.variable_tiempo] == t) & (dg['_evento'] == 1)).sum())
                O_list[gi] += d_ig
                E_list[gi] += d_i_total * n_ig / n_i_total

        O = np.array(O_list)
        E = np.array(E_list)
        chi2_logrank = float(np.sum((O - E) ** 2 / np.where(E > 0, E, 1)))
        gl_logrank = n_grupos - 1
        p_logrank = float(stats.chi2.sf(chi2_logrank, gl_logrank))

        resultado.update({
            'variable_grupo': req.variable_grupo,
            'grupos': [str(g) for g in grupos],
            'curvas': curvas,
            'logrank': {
                'chi2': round(chi2_logrank, 4),
                'gl': gl_logrank,
                'p_value': round(p_logrank, 6),
                'significativo': p_logrank < req.alpha,
                'grupos_detalle': [
                    {'grupo': str(g), 'observados': round(float(O[i]), 2), 'esperados': round(float(E[i]), 2)}
                    for i, g in enumerate(grupos)
                ],
            },
        })
    else:
        curva_global = _kaplan_meier_grupo(
            df_clean[req.variable_tiempo].values,
            df_clean['_evento'].values
        )
        resultado.update(curva_global)

    return resultado


@router.post("/tabla-vida")
def tabla_vida(req: TablaVidaRequest):
    """Tabla de vida actuarial (Life Table)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in [req.variable_tiempo, req.variable_evento]:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[[req.variable_tiempo, req.variable_evento]].dropna()
    df_clean['_evento'] = (df_clean[req.variable_evento] == req.valor_evento).astype(int)

    t_min = float(df_clean[req.variable_tiempo].min())
    t_max = float(df_clean[req.variable_tiempo].max())
    intervalos = np.linspace(t_min, t_max, req.n_intervalos + 1)

    filas = []
    n_entrante = len(df_clean)

    for i in range(len(intervalos) - 1):
        t_ini = intervalos[i]
        t_fin = intervalos[i + 1]
        en_intervalo = df_clean[
            (df_clean[req.variable_tiempo] >= t_ini) &
            (df_clean[req.variable_tiempo] < t_fin)
        ]
        n_eventos = int(en_intervalo['_evento'].sum())
        n_censurados = int((en_intervalo['_evento'] == 0).sum())
        n_efectivo = n_entrante - n_censurados / 2.0

        q_i = n_eventos / n_efectivo if n_efectivo > 0 else 0
        p_i = 1 - q_i
        S_ini = filas[-1]['S_fin'] if filas else 1.0
        S_fin = S_ini * p_i

        filas.append({
            't_inicio': round(t_ini, 4),
            't_fin': round(t_fin, 4),
            'n_entrante': n_entrante,
            'n_eventos': n_eventos,
            'n_censurados': n_censurados,
            'n_efectivo': round(n_efectivo, 2),
            'q_i': round(q_i, 6),
            'p_i': round(p_i, 6),
            'S_inicio': round(S_ini, 6),
            'S_fin': round(S_fin, 6),
            'h_i': round(2 * q_i / (1 + p_i), 6),  # Hazard rate
        })
        n_entrante -= n_eventos + n_censurados

    return {
        'tipo': 'Tabla de vida actuarial',
        'n_total': len(df_clean),
        'n_eventos_total': int(df_clean['_evento'].sum()),
        'n_intervalos': req.n_intervalos,
        'tabla': filas,
    }


@router.post("/cox")
def cox_regression(req: CoxRequest):
    """
    Regresión de Cox (Proporcional Hazards) implementada con Newton-Raphson.
    Retorna: coeficientes, HR (hazard ratios), IC95, p-valores, concordancia.
    """
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    todos = [req.variable_tiempo, req.variable_evento] + req.covariables
    for v in todos:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[todos].dropna()
    df_clean['_evento'] = (df_clean[req.variable_evento] == req.valor_evento).astype(int)
    df_clean = df_clean.sort_values(req.variable_tiempo).reset_index(drop=True)

    T = df_clean[req.variable_tiempo].values
    E = df_clean['_evento'].values
    X = df_clean[req.covariables].values.astype(float)
    n, p = X.shape

    # Estandarizar para convergencia numérica
    X_mean = X.mean(axis=0)
    X_std  = X.std(axis=0)
    X_std[X_std == 0] = 1
    X_std_mat = (X - X_mean) / X_std

    # Newton-Raphson para estimar beta
    beta = np.zeros(p)
    MAX_ITER = 100
    TOL = 1e-7

    for _ in range(MAX_ITER):
        exp_Xb = np.exp(X_std_mat @ beta)
        grad = np.zeros(p)
        hess = np.zeros((p, p))
        ll = 0.0

        event_times = T[E == 1]
        for t in np.unique(event_times):
            risk_mask = T >= t
            d_mask    = (T == t) & (E == 1)
            R = exp_Xb[risk_mask]
            X_R = X_std_mat[risk_mask]

            sum_R    = R.sum()
            sum_XR   = (X_R * R[:, None]).sum(axis=0)
            sum_XXR  = (X_R * R[:, None]).T @ X_R

            d = int(d_mask.sum())
            X_d = X_std_mat[d_mask]

            ll   += (X_d @ beta).sum() - d * np.log(sum_R)
            grad += X_d.sum(axis=0) - d * sum_XR / sum_R
            hess -= d * (sum_XXR / sum_R - np.outer(sum_XR, sum_XR) / sum_R**2)

        try:
            delta = np.linalg.solve(hess, -grad)
        except np.linalg.LinAlgError:
            break

        beta += delta
        if np.max(np.abs(delta)) < TOL:
            break

    # Varianza de beta (inversa de -Hessiana)
    try:
        var_beta = np.linalg.inv(-hess)
        se_beta  = np.sqrt(np.diag(var_beta))
    except np.linalg.LinAlgError:
        se_beta = np.full(p, np.nan)

    # Desescalar betas al espacio original
    beta_orig = beta / X_std
    se_orig   = se_beta / X_std

    # Estadísticos Wald
    z    = beta_orig / se_orig
    p_val = 2 * stats.norm.sf(np.abs(z))
    HR    = np.exp(beta_orig)
    z95   = stats.norm.ppf(0.975)
    hr_lo = np.exp(beta_orig - z95 * se_orig)
    hr_hi = np.exp(beta_orig + z95 * se_orig)

    coeficientes = []
    for i, cov in enumerate(req.covariables):
        coeficientes.append({
            'covariable': cov,
            'b': round(float(beta_orig[i]), 4),
            'se': round(float(se_orig[i]), 4),
            'wald': round(float(z[i]**2), 4),
            'p_value': round(float(p_val[i]), 6),
            'significativo': bool(p_val[i] < req.alpha),
            'HR': round(float(HR[i]), 4),
            'HR_IC_low': round(float(hr_lo[i]), 4),
            'HR_IC_high': round(float(hr_hi[i]), 4),
        })

    # Índice de concordancia C (Harrell's C)
    concordantes = discordantes = 0
    event_idx = np.where(E == 1)[0]
    lp = X @ beta_orig
    for i in event_idx:
        later = np.where(T > T[i])[0]
        concordantes += int((lp[i] > lp[later]).sum())
        discordantes += int((lp[i] < lp[later]).sum())
    total_pares = concordantes + discordantes
    c_index = concordantes / total_pares if total_pares > 0 else 0.5

    # Log-likelihood ratio test
    exp_Xb0 = np.ones(n)
    ll_null  = 0.0
    for t in np.unique(T[E == 1]):
        risk_mask = T >= t
        d = int(((T == t) & (E == 1)).sum())
        ll_null -= d * np.log(risk_mask.sum())

    exp_Xb_final = np.exp(X @ beta_orig)
    ll_model = 0.0
    for t in np.unique(T[E == 1]):
        risk_mask = T >= t
        d_mask    = (T == t) & (E == 1)
        d = int(d_mask.sum())
        ll_model += np.log(exp_Xb_final[d_mask]).sum() - d * np.log(exp_Xb_final[risk_mask].sum())

    lr_stat = 2 * (ll_model - ll_null)
    lr_p    = float(stats.chi2.sf(lr_stat, p))

    return {
        'tipo': 'Regresión de Cox (Proporcional Hazards)',
        'n': int(n),
        'n_eventos': int(E.sum()),
        'n_censurados': int((E == 0).sum()),
        'covariables': req.covariables,
        'coeficientes': coeficientes,
        'c_index': round(float(c_index), 4),
        'lr_chi2': round(float(lr_stat), 4),
        'lr_gl': p,
        'lr_p_value': round(float(lr_p), 6),
        'lr_significativo': bool(lr_p < req.alpha),
        'interpretacion_c': 'excelente' if c_index >= 0.8 else ('buena' if c_index >= 0.7 else ('aceptable' if c_index >= 0.6 else 'pobre')),
    }
