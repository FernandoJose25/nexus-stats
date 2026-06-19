"""
MANOVA — Análisis Multivariante de Varianza.
Equivalente a SPSS Analyze > General Linear Model > Multivariate.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats

from services import data_manager

router = APIRouter()


class ManovaRequest(BaseModel):
    dependientes: list[str]    # ≥2 variables dependientes
    factor: str                # Variable de grupo
    covariables: list[str] = []  # Para MANCOVA
    alpha: float = 0.05
    posthoc: bool = True


@router.post("/ajustar")
def manova(req: ManovaRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if len(req.dependientes) < 2:
        raise HTTPException(status_code=400, detail="MANOVA requiere al menos 2 variables dependientes")

    todas = req.dependientes + [req.factor] + req.covariables
    for v in todas:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[todas].dropna()
    grupos = sorted(df_clean[req.factor].unique())
    k = len(grupos)
    p = len(req.dependientes)
    n = len(df_clean)

    if k < 2:
        raise HTTPException(status_code=400, detail="El factor debe tener al menos 2 grupos")

    Y = df_clean[req.dependientes].values.astype(float)
    grupo_map = {g: i for i, g in enumerate(grupos)}
    y = np.array([grupo_map[g] for g in df_clean[req.factor].values])
    ns = np.array([int((y == i).sum()) for i in range(k)])

    # Medias por grupo y global
    medias_grupo = np.array([Y[y == i].mean(axis=0) for i in range(k)])
    media_global = Y.mean(axis=0)

    # Matrices SSCP (Sum of Squares Cross Products)
    # Entre-grupos (H)
    H = np.zeros((p, p))
    for i in range(k):
        d = (medias_grupo[i] - media_global).reshape(-1, 1)
        H += ns[i] * (d @ d.T)

    # Intra-grupos (E)
    E = np.zeros((p, p))
    for i in range(k):
        diff = Y[y == i] - medias_grupo[i]
        E += diff.T @ diff

    gl_between = k - 1
    gl_within  = n - k

    # ── Estadísticos multivariantes ────────────────────────────────
    try:
        E_inv = np.linalg.inv(E + np.eye(p) * 1e-10)
    except np.linalg.LinAlgError:
        raise HTTPException(status_code=500, detail="Matrices singulares — verifica colinealidad entre dependientes")

    EinvH = E_inv @ H
    eigvals = np.linalg.eigvals(EinvH).real
    eigvals = np.sort(eigvals[eigvals > 0])[::-1]

    s  = min(gl_between, p)
    m  = (abs(gl_between - p) - 1) / 2
    v2 = (gl_within - p - 1) / 2

    # 1. Lambda de Wilks
    lambda_wilks = float(np.linalg.det(E) / np.linalg.det(E + H))
    # Aproximación de Rao
    t = np.sqrt((p**2 * gl_between**2 - 4) / (p**2 + gl_between**2 - 5)) if (p**2 + gl_between**2 - 5) > 0 else 1
    df1_wilks = p * gl_between
    df2_wilks = t * (gl_within - (p - gl_between + 1) / 2) - (p * gl_between - 2) / 2
    if df2_wilks > 0 and lambda_wilks > 0:
        F_wilks = ((1 - lambda_wilks**(1/t)) / (lambda_wilks**(1/t))) * (df2_wilks / df1_wilks)
        p_wilks = float(stats.f.sf(F_wilks, df1_wilks, max(1, df2_wilks)))
    else:
        F_wilks, p_wilks = np.nan, np.nan

    # 2. Traza de Pillai
    pillai = float(sum(e / (1 + e) for e in eigvals[:s]))
    df1_p  = s * p
    df2_p  = s * (gl_within - p + s)
    F_pillai = (pillai / s) / ((s - pillai) / s) * (df2_p / df1_p) if (s - pillai) > 0 and df1_p > 0 else np.nan
    p_pillai  = float(stats.f.sf(F_pillai, df1_p, df2_p)) if not np.isnan(F_pillai) else np.nan

    # 3. Traza de Hotelling-Lawley
    hotelling = float(sum(eigvals[:s]))
    df1_h = s * (2 * m + s + 1)
    df2_h = 2 * (s * v2 + 1)
    F_hot = (hotelling / df1_h) * df2_h if df1_h > 0 else np.nan
    p_hot = float(stats.f.sf(F_hot, df1_h, df2_h)) if not np.isnan(F_hot) else np.nan

    # 4. Mayor raíz de Roy
    roy = float(eigvals[0]) if len(eigvals) > 0 else 0.0

    estadisticos_mv = [
        {'nombre': 'Lambda de Wilks',     'valor': round(float(lambda_wilks), 4), 'F': round(float(F_wilks), 4) if not np.isnan(F_wilks) else None, 'gl1': int(df1_wilks), 'gl2': round(float(df2_wilks), 2) if not np.isnan(df2_wilks) else None, 'p_value': round(p_wilks, 6) if not np.isnan(p_wilks) else None, 'sig': bool(p_wilks < req.alpha) if not np.isnan(p_wilks) else False},
        {'nombre': 'Traza de Pillai',     'valor': round(pillai, 4), 'F': round(float(F_pillai), 4) if not np.isnan(F_pillai) else None, 'gl1': int(df1_p), 'gl2': int(df2_p), 'p_value': round(p_pillai, 6) if not np.isnan(p_pillai) else None, 'sig': bool(p_pillai < req.alpha) if not np.isnan(p_pillai) else False},
        {'nombre': 'Traza de Hotelling',  'valor': round(hotelling, 4), 'F': round(float(F_hot), 4) if not np.isnan(F_hot) else None, 'gl1': int(df1_h), 'gl2': round(float(df2_h), 2), 'p_value': round(p_hot, 6) if not np.isnan(p_hot) else None, 'sig': bool(p_hot < req.alpha) if not np.isnan(p_hot) else False},
        {'nombre': 'Mayor raíz de Roy',   'valor': round(roy, 4), 'F': None, 'gl1': None, 'gl2': None, 'p_value': None, 'sig': None},
    ]

    # ── ANOVA univariante para cada dependiente ────────────────────
    anovas_univariantes = []
    for j, dep in enumerate(req.dependientes):
        ss_between = float(H[j, j])
        ss_within  = float(E[j, j])
        ms_between = ss_between / gl_between
        ms_within  = ss_within  / gl_within
        F_uni = ms_between / ms_within if ms_within > 0 else np.nan
        p_uni = float(stats.f.sf(F_uni, gl_between, gl_within)) if not np.isnan(F_uni) else np.nan
        eta2  = ss_between / (ss_between + ss_within)
        anovas_univariantes.append({
            'variable': dep,
            'ss_between': round(ss_between, 4),
            'ss_within': round(ss_within, 4),
            'ms_between': round(ms_between, 4),
            'ms_within': round(ms_within, 4),
            'F': round(float(F_uni), 4) if not np.isnan(F_uni) else None,
            'gl_between': gl_between,
            'gl_within': gl_within,
            'p_value': round(p_uni, 6) if not np.isnan(p_uni) else None,
            'significativo': bool(p_uni < req.alpha) if not np.isnan(p_uni) else False,
            'eta2': round(float(eta2), 4),
        })

    # ── Estadísticos descriptivos por grupo ───────────────────────
    descriptivos = []
    for i, g in enumerate(grupos):
        Y_g = Y[y == i]
        for j, dep in enumerate(req.dependientes):
            descriptivos.append({
                'grupo': str(g),
                'variable': dep,
                'n': int(ns[i]),
                'media': round(float(Y_g[:, j].mean()), 4),
                'desv': round(float(Y_g[:, j].std()), 4),
                'ic_low': round(float(Y_g[:, j].mean() - 1.96 * Y_g[:, j].std() / np.sqrt(ns[i])), 4),
                'ic_high': round(float(Y_g[:, j].mean() + 1.96 * Y_g[:, j].std() / np.sqrt(ns[i])), 4),
            })

    # Post-hoc univariante (Tukey) si significativo
    posthoc_out = []
    if req.posthoc:
        from itertools import combinations
        for j, dep in enumerate(req.dependientes):
            uni = anovas_univariantes[j]
            if uni['significativo']:
                pares = list(combinations(range(k), 2))
                for i1, i2 in pares:
                    diff = float(medias_grupo[i1, j] - medias_grupo[i2, j])
                    ms_w = float(E[j, j] / gl_within)
                    se   = np.sqrt(ms_w * (1/ns[i1] + 1/ns[i2]))
                    t_val = diff / se if se > 0 else np.nan
                    p_val = float(2 * stats.t.sf(abs(t_val), gl_within)) if not np.isnan(t_val) else np.nan
                    posthoc_out.append({
                        'variable': dep,
                        'grupo_1': str(grupos[i1]),
                        'grupo_2': str(grupos[i2]),
                        'diferencia': round(diff, 4),
                        'se': round(float(se), 4),
                        't': round(float(t_val), 4),
                        'p_value': round(p_val, 6),
                        'significativo': bool(p_val < req.alpha),
                    })

    return {
        'tipo': 'MANOVA',
        'factor': req.factor,
        'dependientes': req.dependientes,
        'n': n,
        'k': k,
        'grupos': [str(g) for g in grupos],
        'gl_between': gl_between,
        'gl_within': gl_within,
        'estadisticos_multivariantes': estadisticos_mv,
        'anovas_univariantes': anovas_univariantes,
        'descriptivos': descriptivos,
        'posthoc': posthoc_out,
    }
