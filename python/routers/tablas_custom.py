"""
Tablas personalizadas (Custom Tables) — equivalente a SPSS Tables > Custom Tables.
Crea tablas pivot con variables en filas, columnas y capas, con funciones de resumen.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd

from services import data_manager

router = APIRouter()


FUNCIONES_DISPONIBLES = {
    "n":        ("N", lambda s: int(s.count())),
    "pct":      ("%", lambda s: None),       # se calcula aparte
    "media":    ("Media", lambda s: round(float(s.mean()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "desv":     ("DE", lambda s: round(float(s.std()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "mediana":  ("Mediana", lambda s: round(float(s.median()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "min":      ("Mín", lambda s: round(float(s.min()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "max":      ("Máx", lambda s: round(float(s.max()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "suma":     ("Suma", lambda s: round(float(s.sum()), 3) if pd.api.types.is_numeric_dtype(s) else None),
    "se":       ("EE", lambda s: round(float(s.sem()), 4) if pd.api.types.is_numeric_dtype(s) else None),
    "pct_validos": ("% válidos", lambda s: round(s.notna().sum() / max(len(s),1) * 100, 1)),
}


class TablaCustomRequest(BaseModel):
    variables_fila: list[str]
    variables_columna: list[str] = []
    variables_capa: list[str] = []
    funciones: list[str] = ["n", "pct"]   # Lista de funciones de resumen
    variable_resumen: str = ""             # Variable numérica para media/desv (si aplica)
    titulo: str = "Tabla personalizada"
    incluir_totales: bool = True


def _calcular_celda(serie: pd.Series, funcion: str, total_n: int) -> str:
    if funcion == "pct":
        return f"{serie.count() / max(total_n, 1) * 100:.1f}%"
    fn = FUNCIONES_DISPONIBLES.get(funcion)
    if fn is None:
        return ""
    val = fn[1](serie)
    return str(val) if val is not None else "—"


def _celda_fmt(serie: pd.Series, funciones: list[str], total_n: int, var_resumen: str = "") -> str:
    """Formatea el contenido de una celda con las funciones solicitadas."""
    partes = []
    for fn in funciones:
        if fn in ("media","desv","mediana","min","max","suma","se") and var_resumen:
            s = serie  # Ya es la sub-serie de la variable de resumen
        else:
            s = serie
        partes.append(_calcular_celda(s, fn, total_n))
    return "\n".join(p for p in partes if p)


@router.post("/generar")
def generar_tabla(req: TablaCustomRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()

    todas_vars = req.variables_fila + req.variables_columna + req.variables_capa
    if req.variable_resumen:
        todas_vars.append(req.variable_resumen)
    for v in todas_vars:
        if v not in df.columns:
            raise HTTPException(400, f"Variable '{v}' no encontrada")

    if not req.variables_fila:
        raise HTTPException(400, "Debes especificar al menos una variable de fila")

    df_c = df[list(set(todas_vars))].copy()
    n_total = len(df_c)

    # ── Caso simple: 1 variable fila, sin columnas ────────────────────
    if len(req.variables_fila) == 1 and not req.variables_columna:
        var = req.variables_fila[0]
        cats = sorted(df_c[var].dropna().unique())

        filas = []
        for cat in cats:
            mask = df_c[var] == cat
            sub = df_c[mask]
            s = sub[req.variable_resumen] if req.variable_resumen and req.variable_resumen in sub else sub[var]
            celdas = {}
            for fn in req.funciones:
                celdas[FUNCIONES_DISPONIBLES.get(fn, (fn,))[0]] = _calcular_celda(s, fn, n_total)
            filas.append({"categoria": str(cat), "n": int(mask.sum()), **celdas})

        if req.incluir_totales:
            s_tot = df_c[req.variable_resumen] if req.variable_resumen and req.variable_resumen in df_c else df_c[var]
            celdas_tot = {}
            for fn in req.funciones:
                celdas_tot[FUNCIONES_DISPONIBLES.get(fn,(fn,))[0]] = _calcular_celda(s_tot, fn, n_total)
            filas.append({"categoria": "Total", "n": n_total, **celdas_tot})

        headers = ["Categoría", "N"] + [FUNCIONES_DISPONIBLES.get(fn,(fn,))[0] for fn in req.funciones if fn != "n"]
        return {
            "tipo": "tabla_simple",
            "titulo": req.titulo,
            "variable_fila": var,
            "headers": headers,
            "filas": filas,
            "n_total": n_total,
        }

    # ── Tabla cruzada personalizada ───────────────────────────────────
    var_f  = req.variables_fila[0]
    var_c  = req.variables_columna[0] if req.variables_columna else None

    if var_c:
        cats_f = sorted(df_c[var_f].dropna().unique())
        cats_c = sorted(df_c[var_c].dropna().unique())

        tabla_pivot = []
        for cf in cats_f:
            fila = {"fila": str(cf)}
            for cc in cats_c:
                mask = (df_c[var_f] == cf) & (df_c[var_c] == cc)
                sub = df_c[mask]
                s = sub[req.variable_resumen] if req.variable_resumen and req.variable_resumen in sub else sub[var_f]
                celdas = []
                for fn in req.funciones:
                    celdas.append(_calcular_celda(s, fn, n_total))
                fila[str(cc)] = " / ".join(c for c in celdas if c)
            if req.incluir_totales:
                mask_f = df_c[var_f] == cf
                s = df_c[mask_f][req.variable_resumen] if req.variable_resumen and req.variable_resumen in df_c else df_c[mask_f][var_f]
                fila["Total"] = " / ".join(_calcular_celda(s, fn, n_total) for fn in req.funciones)
            tabla_pivot.append(fila)

        if req.incluir_totales:
            fila_tot = {"fila": "Total"}
            for cc in cats_c:
                mask = df_c[var_c] == cc
                s = df_c[mask][req.variable_resumen] if req.variable_resumen and req.variable_resumen in df_c else df_c[mask][var_f]
                fila_tot[str(cc)] = " / ".join(_calcular_celda(s, fn, n_total) for fn in req.funciones)
            fila_tot["Total"] = str(n_total)
            tabla_pivot.append(fila_tot)

        cols = [str(c) for c in cats_c] + (["Total"] if req.incluir_totales else [])
        fn_labels = " / ".join(FUNCIONES_DISPONIBLES.get(fn,(fn,))[0] for fn in req.funciones)

        return {
            "tipo": "tabla_cruzada",
            "titulo": req.titulo,
            "variable_fila": var_f,
            "variable_columna": var_c,
            "columnas": cols,
            "tabla": tabla_pivot,
            "funciones_label": fn_labels,
            "n_total": n_total,
        }

    return {"tipo": "tabla_simple", "titulo": req.titulo, "n_total": n_total, "filas": []}


@router.get("/funciones-disponibles")
def get_funciones():
    return {
        "funciones": [
            {"id": k, "label": v[0]}
            for k, v in FUNCIONES_DISPONIBLES.items()
        ]
    }
