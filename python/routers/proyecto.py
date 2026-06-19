"""
Guardar y cargar proyectos .nexus.
Formato: JSON comprimido con base64 del DataFrame + metadatos + historial de transformaciones.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json, base64, gzip, io
import pandas as pd
import numpy as np

from services import data_manager

router = APIRouter()


class GuardarProyectoRequest(BaseModel):
    ruta_destino: str
    nombre_proyecto: str = "Mi Proyecto"
    descripcion: str = ""


class CargarProyectoRequest(BaseModel):
    ruta: str


@router.post("/guardar")
def guardar_proyecto(req: GuardarProyectoRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")

    df = data_manager.get_dataframe()
    meta = data_manager.get_metadata()
    historial = data_manager.get_transformation_history()

    # Serializar DataFrame a CSV comprimido en base64
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    csv_bytes = buf.getvalue()
    compressed = gzip.compress(csv_bytes)
    df_b64 = base64.b64encode(compressed).decode('ascii')

    proyecto = {
        "version": "1.0",
        "nombre": req.nombre_proyecto,
        "descripcion": req.descripcion,
        "metadata": {
            "filename":  meta.get("filename", "dataset.csv"),
            "rows":      meta.get("rows", 0),
            "columns":   meta.get("columns", 0),
        },
        "datos_b64_gz": df_b64,
        "historial_transformaciones": historial,
        "split_variable":  data_manager.get_split_variable(),
        "weight_variable": data_manager.get_weight_variable(),
    }

    try:
        with open(req.ruta_destino, 'w', encoding='utf-8') as f:
            json.dump(proyecto, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(500, f"Error al guardar: {e}")

    size_kb = round(len(json.dumps(proyecto).encode()) / 1024, 1)
    return {
        "ok": True,
        "ruta": req.ruta_destino,
        "tamanio_kb": size_kb,
        "filas": meta.get("rows"),
        "columnas": meta.get("columns"),
    }


@router.post("/cargar")
def cargar_proyecto(req: CargarProyectoRequest):
    try:
        with open(req.ruta, 'r', encoding='utf-8') as f:
            proyecto = json.load(f)
    except FileNotFoundError:
        raise HTTPException(404, f"Archivo no encontrado: {req.ruta}")
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Archivo .nexus inválido: {e}")

    version = proyecto.get("version", "1.0")
    df_b64 = proyecto.get("datos_b64_gz")
    if not df_b64:
        raise HTTPException(400, "El archivo no contiene datos")

    try:
        compressed = base64.b64decode(df_b64)
        csv_bytes   = gzip.decompress(compressed)
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception as e:
        raise HTTPException(500, f"Error al descomprimir datos: {e}")

    # Restaurar en data_manager
    original_filename = proyecto.get("metadata", {}).get("filename", "proyecto.nexus")
    data_manager._df            = df
    data_manager._df_original   = df.copy()
    data_manager._metadata      = data_manager._build_metadata(df, original_filename)
    data_manager._history       = []   # Historial previo ya se aplicó, no se rehace
    data_manager._split_variable  = proyecto.get("split_variable")
    data_manager._weight_variable = proyecto.get("weight_variable")
    data_manager._reset_duckdb()

    return {
        "ok": True,
        "nombre": proyecto.get("nombre", ""),
        "descripcion": proyecto.get("descripcion", ""),
        "metadata": data_manager.get_metadata(),
        "historial_cargado": len(proyecto.get("historial_transformaciones", [])),
    }


@router.get("/info")
def info_proyecto():
    """Retorna información básica del estado actual (para mostrar en el header)."""
    if not data_manager.is_loaded():
        return {"cargado": False}
    meta = data_manager.get_metadata()
    return {
        "cargado": True,
        "filename": meta.get("filename"),
        "rows": meta.get("rows"),
        "columns": meta.get("columns"),
        "transformaciones": len(data_manager.get_transformation_history()),
        "split_activo": data_manager.get_split_variable() is not None,
        "peso_activo":  data_manager.get_weight_variable() is not None,
    }
