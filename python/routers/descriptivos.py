from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager
from services.stats_engine import descriptivo_completo, tabla_frecuencias

router = APIRouter()


class DescriptivosRequest(BaseModel):
    variables: list[str]
    incluir_frecuencias: bool = False


class FrecuenciasRequest(BaseModel):
    variable: str


@router.post("/")
def calcular_descriptivos(req: DescriptivosRequest):
    """
    Calcula estadísticas descriptivas completas para una o más variables numéricas.
    Devuelve: media, mediana, moda, desv. típica, varianza, asimetría, curtosis,
    mínimo, máximo, rango, percentiles, n válidos/perdidos.
    """
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")

    df = data_manager.get_dataframe()
    resultados = []
    errores = []

    for var in req.variables:
        if var not in df.columns:
            errores.append(f"Variable '{var}' no encontrada en el dataset")
            continue

        col = df[var]
        meta = data_manager.get_metadata()
        col_info = next((c for c in meta["column_info"] if c["nombre"] == var), None)

        if col_info and col_info["tipo"] != "numerico":
            # Para variables no numéricas, solo tabla de frecuencias
            if req.incluir_frecuencias:
                resultados.append({
                    "variable": var,
                    "tipo": "categorico",
                    "frecuencias": tabla_frecuencias(col, var),
                })
            else:
                errores.append(f"Variable '{var}' no es numérica. Use incluir_frecuencias=true para categóricas.")
            continue

        stats = descriptivo_completo(col, var)

        if req.incluir_frecuencias:
            stats["frecuencias"] = tabla_frecuencias(col, var)

        resultados.append({**stats, "tipo": "numerico"})

    return {
        "resultados": resultados,
        "errores": errores,
        "n_variables": len(resultados),
    }


@router.post("/frecuencias")
def calcular_frecuencias(req: FrecuenciasRequest):
    """Calcula tabla de frecuencias para cualquier variable (numérica o categórica)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")

    df = data_manager.get_dataframe()
    if req.variable not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable}' no encontrada")

    try:
        resultado = tabla_frecuencias(df[req.variable], req.variable)
        return resultado
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
