"""
Árboles de decisión: clasificación y regresión (CART).
Implementado sobre scikit-learn con fallback manual si no está disponible.
"""
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class ArbolRequest(BaseModel):
    dependiente: str
    independientes: List[str]
    tipo: str = "clasificacion"          # "clasificacion" | "regresion"
    max_profundidad: Optional[int] = 5
    min_muestras_hoja: int = 5
    alpha: float = 0.05


def _check_loaded():
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")


@router.post("/ajustar")
def ajustar_arbol(req: ArbolRequest):
    _check_loaded()
    df = data_manager.get_dataframe()

    if req.dependiente not in df.columns:
        raise HTTPException(400, detail=f"Variable '{req.dependiente}' no encontrada")
    for v in req.independientes:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")
        if not pd.api.types.is_numeric_dtype(df[v]):
            raise HTTPException(400, detail=f"Variable independiente '{v}' debe ser numérica")

    if not req.independientes:
        raise HTTPException(400, detail="Selecciona al menos una variable independiente")
    if req.dependiente in req.independientes:
        raise HTTPException(400, detail="La variable dependiente no puede ser también independiente")

    cols = [req.dependiente] + req.independientes
    sub = df[cols].dropna().copy()
    n = len(sub)

    if n < 10:
        raise HTTPException(400, detail="Se necesitan al menos 10 observaciones")

    X = sub[req.independientes].values.astype(float)

    if req.tipo == "clasificacion":
        return _clasificacion(req, sub, X)
    else:
        if not pd.api.types.is_numeric_dtype(sub[req.dependiente]):
            raise HTTPException(400, detail="Para regresión la variable dependiente debe ser numérica")
        return _regresion(req, sub, X)


def _clasificacion(req, sub, X):
    try:
        from sklearn.tree import DecisionTreeClassifier
        from sklearn.model_selection import cross_val_score
        from sklearn.preprocessing import LabelEncoder

        le = LabelEncoder()
        y = le.fit_transform(sub[req.dependiente].astype(str))
        clases = le.classes_.tolist()

        clf = DecisionTreeClassifier(
            max_depth=req.max_profundidad,
            min_samples_leaf=req.min_muestras_hoja,
            random_state=42,
        )
        clf.fit(X, y)

        y_pred = clf.predict(X)
        accuracy = float(np.mean(y_pred == y))

        # CV accuracy (5-fold)
        cv_scores = cross_val_score(clf, X, y, cv=min(5, len(X) // 5 or 1), scoring='accuracy')
        cv_accuracy = float(cv_scores.mean())
        cv_std = float(cv_scores.std())

        # Importancia de variables
        importancias = [
            {"variable": v, "importancia": round(float(imp), 4)}
            for v, imp in zip(req.independientes, clf.feature_importances_)
        ]
        importancias.sort(key=lambda x: x["importancia"], reverse=True)

        # Matriz de confusión
        confusion = _confusion_matrix(y, y_pred, len(clases))

        # Reglas del árbol (simplificado: profundidad máxima 3)
        reglas = _extraer_reglas_sklearn(clf, req.independientes, clases, max_depth=3)

        # Distribución de clases
        clases_dist = []
        for i, c in enumerate(clases):
            n_c = int(np.sum(y == i))
            clases_dist.append({"clase": c, "n": n_c, "pct": round(n_c / len(y) * 100, 1)})

        return {
            "tipo": "Árbol de clasificación",
            "dependiente": req.dependiente,
            "independientes": req.independientes,
            "n": len(sub),
            "n_clases": len(clases),
            "clases": clases,
            "clases_distribucion": clases_dist,
            "max_profundidad": req.max_profundidad,
            "profundidad_real": int(clf.get_depth()),
            "n_hojas": int(clf.get_n_leaves()),
            "accuracy": round(accuracy, 4),
            "cv_accuracy": round(cv_accuracy, 4),
            "cv_std": round(cv_std, 4),
            "importancias": importancias,
            "confusion": {"clases": clases, "matrix": confusion},
            "reglas": reglas,
        }
    except ImportError:
        raise HTTPException(500, detail="scikit-learn no está instalado. Ejecuta: pip install scikit-learn")


def _regresion(req, sub, X):
    try:
        from sklearn.tree import DecisionTreeRegressor
        from sklearn.model_selection import cross_val_score

        y = sub[req.dependiente].values.astype(float)

        reg = DecisionTreeRegressor(
            max_depth=req.max_profundidad,
            min_samples_leaf=req.min_muestras_hoja,
            random_state=42,
        )
        reg.fit(X, y)

        y_pred = reg.predict(X)
        residuos = y - y_pred
        ss_res = float(np.sum(residuos ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        rmse = float(np.sqrt(np.mean(residuos ** 2)))
        mae = float(np.mean(np.abs(residuos)))

        # CV R² (5-fold)
        cv_scores = cross_val_score(reg, X, y, cv=min(5, len(X) // 5 or 1), scoring='r2')
        cv_r2 = float(cv_scores.mean())
        cv_std = float(cv_scores.std())

        importancias = [
            {"variable": v, "importancia": round(float(imp), 4)}
            for v, imp in zip(req.independientes, reg.feature_importances_)
        ]
        importancias.sort(key=lambda x: x["importancia"], reverse=True)

        reglas = _extraer_reglas_sklearn(reg, req.independientes, None, max_depth=3)

        # Muestra residuos
        step = max(1, len(y) // 200)
        residuos_sample = {
            "y_pred": [round(float(v), 4) for v in y_pred[::step]],
            "residuos": [round(float(v), 4) for v in residuos[::step]],
        }

        return {
            "tipo": "Árbol de regresión",
            "dependiente": req.dependiente,
            "independientes": req.independientes,
            "n": len(sub),
            "max_profundidad": req.max_profundidad,
            "profundidad_real": int(reg.get_depth()),
            "n_hojas": int(reg.get_n_leaves()),
            "r2": round(r2, 4),
            "rmse": round(rmse, 4),
            "mae": round(mae, 4),
            "cv_r2": round(cv_r2, 4),
            "cv_std": round(cv_std, 4),
            "importancias": importancias,
            "residuos_sample": residuos_sample,
            "reglas": reglas,
        }
    except ImportError:
        raise HTTPException(500, detail="scikit-learn no está instalado. Ejecuta: pip install scikit-learn")


def _confusion_matrix(y_true, y_pred, n_clases):
    matrix = np.zeros((n_clases, n_clases), dtype=int)
    for t, p in zip(y_true, y_pred):
        matrix[t, p] += 1
    return matrix.tolist()


def _extraer_reglas_sklearn(tree, feature_names, class_names, max_depth=3):
    """Extrae las reglas más importantes del árbol como lista de strings."""
    from sklearn.tree import _tree

    tree_ = tree.tree_
    reglas = []

    def recurse(node, depth, condiciones):
        if depth > max_depth:
            reglas.append(" & ".join(condiciones) + " → [nodo profundo]")
            return
        if tree_.feature[node] == _tree.TREE_UNDEFINED:
            # Hoja
            if class_names is not None:
                clase_idx = int(np.argmax(tree_.value[node]))
                clase = class_names[clase_idx]
                n_muestras = int(tree_.n_node_samples[node])
                reglas.append(" & ".join(condiciones) + f" → {clase} (n={n_muestras})")
            else:
                valor = float(tree_.value[node][0][0])
                n_muestras = int(tree_.n_node_samples[node])
                reglas.append(" & ".join(condiciones) + f" → {round(valor, 4)} (n={n_muestras})")
        else:
            feat = feature_names[tree_.feature[node]]
            threshold = round(float(tree_.threshold[node]), 4)
            recurse(tree_.children_left[node], depth + 1, condiciones + [f"{feat} ≤ {threshold}"])
            recurse(tree_.children_right[node], depth + 1, condiciones + [f"{feat} > {threshold}"])

    recurse(0, 0, [])
    return reglas[:20]  # máximo 20 reglas
