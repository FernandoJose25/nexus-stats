from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional
import numpy as np

from services import data_manager

router = APIRouter()


class CargarArchivoRequest(BaseModel):
    ruta: str


class PreviewRequest(BaseModel):
    n: int = 100


class EditarCeldaRequest(BaseModel):
    fila: int          # índice 0-based
    columna: str
    valor: Any         # El nuevo valor (str, float, int, None)


class AgregarFilaRequest(BaseModel):
    valores: dict[str, Any] = {}   # Valores iniciales (vacío = todo NaN)


class EliminarFilasRequest(BaseModel):
    filas: list[int]   # Índices 0-based de las filas a eliminar


class GuardarRequest(BaseModel):
    ruta_destino: Optional[str] = None  # None = sobreescribir el archivo original


@router.post("/cargar")
def cargar_archivo(req: CargarArchivoRequest):
    """Carga un archivo de datos (CSV, Excel, SPSS, SAS, Stata) en memoria."""
    try:
        metadata = data_manager.load_file(req.ruta)
        return {"ok": True, "metadata": metadata}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al cargar archivo: {e}")


@router.get("/metadata")
def get_metadata():
    """Retorna metadata del dataset activo."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    return data_manager.get_metadata()


@router.post("/preview")
def preview(req: PreviewRequest):
    """Retorna las primeras N filas del dataset activo."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    try:
        filas = data_manager.get_preview(req.n)
        meta = data_manager.get_metadata()
        return {"filas": filas, "metadata": meta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/editar-celda")
def editar_celda(req: EditarCeldaRequest):
    """Edita el valor de una celda específica. Equivale a editar en SPSS Data View."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.columna not in df.columns:
        raise HTTPException(status_code=400, detail=f"Columna '{req.columna}' no encontrada")
    if req.fila < 0 or req.fila >= len(df):
        raise HTTPException(status_code=400, detail=f"Fila {req.fila} fuera de rango (0–{len(df)-1})")

    df2 = df.copy()
    col_tipo = df2[req.columna].dtype

    # Convertir valor al tipo adecuado
    nuevo_val = req.valor
    if nuevo_val is None or nuevo_val == '' or nuevo_val == '.':
        import pandas as pd
        nuevo_val = pd.NA
    else:
        try:
            import pandas as pd
            if pd.api.types.is_numeric_dtype(col_tipo):
                nuevo_val = float(nuevo_val) if '.' in str(nuevo_val) else int(nuevo_val)
        except (ValueError, TypeError):
            pass   # Dejar como string si no se puede convertir

    df2.at[req.fila, req.columna] = nuevo_val
    data_manager.apply_mutation(df2, f"EDIT [{req.fila+1}, {req.columna}] = {repr(req.valor)}")

    return {
        "ok": True,
        "fila": req.fila,
        "columna": req.columna,
        "valor_nuevo": req.valor,
        "metadata": data_manager.get_metadata(),
    }


@router.post("/agregar-fila")
def agregar_fila(req: AgregarFilaRequest):
    """Añade una nueva fila vacía (o con valores) al final del dataset."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    import pandas as pd
    df = data_manager.get_dataframe()
    nueva_fila = {col: req.valores.get(col, pd.NA) for col in df.columns}
    df2 = pd.concat([df, pd.DataFrame([nueva_fila])], ignore_index=True)
    data_manager.apply_mutation(df2, f"INSERT ROW {len(df)+1}")
    return {"ok": True, "nueva_fila": len(df), "metadata": data_manager.get_metadata()}


@router.post("/guardar")
def guardar(req: GuardarRequest):
    """Guarda el dataset activo en disco (original o nueva ruta)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    try:
        ruta_guardada = data_manager.save_file(req.ruta_destino)
        return {"ok": True, "ruta": ruta_guardada}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/eliminar-filas")
def eliminar_filas(req: EliminarFilasRequest):
    """Elimina las filas especificadas (índices 0-based)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    invalidos = [i for i in req.filas if i < 0 or i >= len(df)]
    if invalidos:
        raise HTTPException(status_code=400, detail=f"Índices fuera de rango: {invalidos}")
    df2 = df.drop(index=req.filas).reset_index(drop=True)
    data_manager.apply_mutation(df2, f"DELETE ROWS {req.filas}")
    return {"ok": True, "eliminadas": len(req.filas), "metadata": data_manager.get_metadata()}
