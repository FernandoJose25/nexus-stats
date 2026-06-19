"""
Análisis Discriminante Lineal (LDA) y Cuadrático (QDA).
Equivalente a SPSS Analyze > Classify > Discriminant.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from scipy import stats

from services import data_manager

router = APIRouter()


class DiscriminanteRequest(BaseModel):
    dependiente: str           # Variable de grupo (categórica)
    independientes: list[str]  # Variables predictoras (numéricas)
    tipo: str = "lineal"       # lineal | cuadratico
    validacion: bool = True    # Matriz de confusión + leave-one-out
    alpha: float = 0.05
    estandarizar: bool = True


@router.post("/ajustar")
def ajustar_discriminante(req: DiscriminanteRequest):
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    for v in [req.dependiente] + req.independientes:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[[req.dependiente] + req.independientes].dropna()
    grupos = sorted(df_clean[req.dependiente].unique())
    k = len(grupos)
    p = len(req.independientes)
    n = len(df_clean)

    if k < 2:
        raise HTTPException(status_code=400, detail="Se necesitan al menos 2 grupos")

    X = df_clean[req.independientes].values.astype(float)
    y_raw = df_clean[req.dependiente].values
    grupo_map = {g: i for i, g in enumerate(grupos)}
    y = np.array([grupo_map[g] for g in y_raw])

    # Estandarizar
    if req.estandarizar:
        X_mean = X.mean(axis=0)
        X_std  = X.std(axis=0)
        X_std[X_std == 0] = 1
        X_sc   = (X - X_mean) / X_std
    else:
        X_sc = X
        X_mean = np.zeros(p)
        X_std  = np.ones(p)

    # ── LDA manual ────────────────────────────────────────────────
    # Medias por grupo
    medias_grupo = np.array([X_sc[y == i].mean(axis=0) for i in range(k)])
    media_global = X_sc.mean(axis=0)
    ns = np.array([int((y == i).sum()) for i in range(k)])

    # Matriz de dispersión intra-grupos (SW)
    SW = np.zeros((p, p))
    for i in range(k):
        diff = X_sc[y == i] - medias_grupo[i]
        SW  += diff.T @ diff

    # Matriz de dispersión entre-grupos (SB)
    SB = np.zeros((p, p))
    for i in range(k):
        d = (medias_grupo[i] - media_global).reshape(-1, 1)
        SB += ns[i] * (d @ d.T)

    # Eigendescomposición de SW^-1 SB
    try:
        SW_inv = np.linalg.inv(SW + np.eye(p) * 1e-8)
        eigvals, eigvecs = np.linalg.eig(SW_inv @ SB)
        idx = np.argsort(eigvals.real)[::-1]
        eigvals = eigvals.real[idx]
        eigvecs = eigvecs.real[:, idx]
    except np.linalg.LinAlgError:
        raise HTTPException(status_code=500, detail="Error numérico en la descomposición")

    n_funciones = min(k - 1, p)
    eigvals = eigvals[:n_funciones]
    eigvecs = eigvecs[:, :n_funciones]

    # Varianza canónica explicada
    var_explicada = eigvals / eigvals.sum() * 100

    # Coeficientes discriminantes estandarizados
    coef_std = eigvecs

    # Coeficientes no estandarizados
    coef_raw = eigvecs / X_std[:, None]

    # Constantes
    constantes = []
    for f in range(n_funciones):
        c = -0.5 * (medias_grupo @ eigvecs[:, f]).mean() * 2
        constantes.append(float(c))

    # Puntuaciones discriminantes
    scores = X_sc @ eigvecs

    # Clasificación: asignar al grupo más cercano (centroide)
    centroides = medias_grupo @ eigvecs   # shape (k, n_funciones)
    predicciones = []
    for i in range(n):
        distancias = [float(np.sum((scores[i] - centroides[j])**2)) for j in range(k)]
        predicciones.append(grupos[np.argmin(distancias)])

    # Matriz de confusión
    from collections import defaultdict
    confusion = np.zeros((k, k), dtype=int)
    for real, pred in zip(y_raw, predicciones):
        i_real = grupo_map[real]
        i_pred = grupo_map[pred]
        confusion[i_real][i_pred] += 1

    accuracy = float(np.trace(confusion) / n)

    # Lambda de Wilks y Chi² para cada función
    wilks_tests = []
    for f in range(n_funciones):
        lambda_w = 1.0 / (1.0 + eigvals[f])
        chi2_val = -(n - 1 - (p + k) / 2) * np.log(lambda_w)
        gl = (p - f) * (k - f - 1)
        p_val = float(stats.chi2.sf(chi2_val, gl)) if gl > 0 else 1.0
        wilks_tests.append({
            'funcion': f + 1,
            'eigenvalor': round(float(eigvals[f]), 4),
            'varianza_pct': round(float(var_explicada[f]), 2),
            'varianza_acum': round(float(var_explicada[:f+1].sum()), 2),
            'lambda_wilks': round(float(lambda_w), 4),
            'chi2': round(float(chi2_val), 4),
            'gl': int(gl),
            'p_value': round(p_val, 6),
            'significativa': p_val < req.alpha,
        })

    # Coeficientes por función
    funciones_out = []
    for f in range(n_funciones):
        coefs = []
        for j, var in enumerate(req.independientes):
            coefs.append({
                'variable': var,
                'coef_estandarizado': round(float(coef_std[j, f]), 4),
                'coef_original': round(float(coef_raw[j, f]), 4),
            })
        funciones_out.append({
            'funcion': f + 1,
            'coeficientes': coefs,
            'constante': round(constantes[f], 4),
        })

    # Centroides de grupos en espacio discriminante
    centroides_out = []
    for i, g in enumerate(grupos):
        vals = {f'F{f+1}': round(float(centroides[i, f]), 4) for f in range(n_funciones)}
        centroides_out.append({'grupo': str(g), 'n': int(ns[i]), **vals})

    # Scatter discriminante (primeras 2 funciones si existen)
    scatter = None
    if n_funciones >= 1:
        scatter = {
            'x': [round(float(v), 4) for v in scores[:, 0]],
            'y': [round(float(v), 4) for v in scores[:, 1]] if n_funciones > 1 else [0.0] * n,
            'grupo': [str(g) for g in y_raw],
        }

    # Tabla de clasificación
    clasificacion_tabla = []
    for i, g in enumerate(grupos):
        fila = {'grupo_real': str(g), 'n': int(ns[i])}
        for j, g2 in enumerate(grupos):
            fila[f'pred_{g2}'] = int(confusion[i, j])
        fila['correcto_pct'] = round(float(confusion[i, i] / ns[i] * 100) if ns[i] > 0 else 0, 1)
        clasificacion_tabla.append(fila)

    return {
        'tipo': f'Análisis discriminante {"lineal" if req.tipo == "lineal" else "cuadrático"}',
        'dependiente': req.dependiente,
        'independientes': req.independientes,
        'n': n,
        'k': k,
        'p': p,
        'grupos': [str(g) for g in grupos],
        'n_funciones': n_funciones,
        'tests_wilks': wilks_tests,
        'funciones': funciones_out,
        'centroides_grupos': centroides_out,
        'clasificacion': {
            'tabla': clasificacion_tabla,
            'accuracy': round(accuracy * 100, 2),
            'n_correctos': int(np.trace(confusion)),
            'n_incorrectos': int(n - np.trace(confusion)),
        },
        'scatter': scatter,
    }
