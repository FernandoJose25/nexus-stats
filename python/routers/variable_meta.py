"""
Metadatos de variables — equivalente al Variable View de SPSS.
Persiste etiquetas, etiquetas de valores, missings definidos y escala de medida.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
import pandas as pd
import numpy as np

from services import data_manager

router = APIRouter()

# Almacén de metadatos (en memoria, persiste mientras el dataset esté cargado)
_var_meta: dict[str, dict] = {}


class VariableMeta(BaseModel):
    nombre: str
    etiqueta: str = ""                    # Variable label
    etiquetas_valores: dict[str, str] = {}  # {"1": "Masculino", "2": "Femenino"}
    missings_definidos: list[Any] = []    # [99, 999] → tratar como perdidos
    medida: str = "escala"               # nominal | ordinal | escala
    decimales: int = 2
    ancho: int = 8
    alineacion: str = "derecha"          # izquierda | derecha | centrado
    tipo_dato: str = "numerico"          # numerico | cadena | fecha


class ActualizarMetaRequest(BaseModel):
    variables: list[VariableMeta]


class AplicarMissingsRequest(BaseModel):
    variable: str


def _get_meta(var: str) -> dict:
    return _var_meta.get(var, {"nombre": var, "etiqueta": "", "etiquetas_valores": {},
                               "missings_definidos": [], "medida": "escala",
                               "decimales": 2, "ancho": 8, "alineacion": "derecha", "tipo_dato": "numerico"})


@router.get("/")
def get_all_meta():
    """Retorna los metadatos de todas las variables del dataset activo."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    col_info = data_manager.get_metadata()["column_info"]
    result = []
    for ci in col_info:
        meta = _get_meta(ci["nombre"])
        meta = {**meta, "nombre": ci["nombre"], "tipo_dato": ci["tipo"],
                "n_validos": ci["n_validos"], "n_perdidos": ci["n_perdidos"]}
        result.append(meta)
    return {"variables": result}


@router.post("/actualizar")
def actualizar_meta(req: ActualizarMetaRequest):
    """Actualiza los metadatos de una o más variables."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()

    for vm in req.variables:
        if vm.nombre not in df.columns:
            raise HTTPException(400, f"Variable '{vm.nombre}' no encontrada")
        _var_meta[vm.nombre] = vm.model_dump()

        # Aplicar missings definidos inmediatamente al DataFrame
        if vm.missings_definidos:
            df2 = data_manager.get_dataframe().copy()
            df2[vm.nombre] = df2[vm.nombre].replace(vm.missings_definidos, pd.NA)
            data_manager.apply_mutation(df2, f"Missings definidos en '{vm.nombre}': {vm.missings_definidos}")

    return {"ok": True, "actualizadas": len(req.variables)}


@router.get("/{variable}")
def get_meta_variable(variable: str):
    """Retorna los metadatos de una variable específica."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    if variable not in df.columns:
        raise HTTPException(400, f"Variable '{variable}' no encontrada")

    meta = _get_meta(variable)
    ci = next((c for c in data_manager.get_metadata()["column_info"] if c["nombre"] == variable), {})
    return {**meta, **ci}


class RenombrarRequest(BaseModel):
    nombre_actual: str
    nombre_nuevo: str


@router.post("/renombrar")
def renombrar_variable(req: RenombrarRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe().copy()
    if req.nombre_actual not in df.columns:
        raise HTTPException(400, f"Variable '{req.nombre_actual}' no encontrada")
    if req.nombre_nuevo in df.columns:
        raise HTTPException(400, f"Ya existe una variable llamada '{req.nombre_nuevo}'")

    df = df.rename(columns={req.nombre_actual: req.nombre_nuevo})

    # Migrar metadatos
    if req.nombre_actual in _var_meta:
        _var_meta[req.nombre_nuevo] = {**_var_meta.pop(req.nombre_actual), "nombre": req.nombre_nuevo}

    data_manager.apply_mutation(df, f"RENAME {req.nombre_actual} → {req.nombre_nuevo}")
    return {"ok": True, "metadata": data_manager.get_metadata()}


@router.delete("/{variable}")
def eliminar_variable(variable: str):
    """Elimina una variable del dataset."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe().copy()
    if variable not in df.columns:
        raise HTTPException(400, f"Variable '{variable}' no encontrada")

    df = df.drop(columns=[variable])
    _var_meta.pop(variable, None)
    data_manager.apply_mutation(df, f"DROP {variable}")
    return {"ok": True, "metadata": data_manager.get_metadata()}


class ReordenarRequest(BaseModel):
    orden: list[str]


@router.post("/reordenar")
def reordenar_variables(req: ReordenarRequest):
    """Reordena las columnas del dataset."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")
    df = data_manager.get_dataframe()
    cols_validas = [c for c in req.orden if c in df.columns]
    cols_resto   = [c for c in df.columns if c not in cols_validas]
    df_nuevo = df[cols_validas + cols_resto].copy()
    data_manager.apply_mutation(df_nuevo, f"REORDER variables")
    return {"ok": True, "metadata": data_manager.get_metadata()}


def get_etiqueta(variable: str) -> str:
    """Helper: obtiene la etiqueta de una variable para mostrar en resultados."""
    meta = _var_meta.get(variable)
    if meta and meta.get("etiqueta"):
        return meta["etiqueta"]
    return variable


def get_etiqueta_valor(variable: str, valor: Any) -> str:
    """Helper: obtiene la etiqueta de un valor codificado."""
    meta = _var_meta.get(variable, {})
    ev = meta.get("etiquetas_valores", {})
    return ev.get(str(valor), str(valor))
