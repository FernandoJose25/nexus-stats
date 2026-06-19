"""
Módulo de Transformación de Datos — equivalente a SPSS Transform menu.
Operaciones: Calcular, Recodificar, Filtrar casos, Ordenar, Ranking,
             Reemplazar perdidos, Agregar por grupos, Reestructurar,
             División de archivo, Ponderación de casos.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
import pandas as pd
import numpy as np

from services import data_manager

router = APIRouter()


# ─── Modelos de entrada ────────────────────────────────────────────────────────

class CalcularRequest(BaseModel):
    nombre_variable: str
    expresion: str          # Ej: "edad * 2", "np.log(ingreso)", "var1 + var2"
    sobrescribir: bool = True

class RecodificarRequest(BaseModel):
    variable_origen: str
    variable_destino: str   # puede ser la misma para sobrescribir
    mapeo: list[dict]       # [{"de": valor_o_rango, "a": nuevo_valor}, ...]
    tipo_salida: str = "numerico"  # "numerico" | "cadena"

class FiltrarRequest(BaseModel):
    condicion: str          # Ej: "edad > 18 and sexo == 'M'"
    modo: str = "seleccionar"  # "seleccionar" | "eliminar"

class OrdenarRequest(BaseModel):
    variables: list[str]
    ascendente: list[bool] = []  # True=ASC, False=DESC por variable

class RankingRequest(BaseModel):
    variable: str
    nombre_ranking: str = ""
    metodo: str = "average"    # average | min | max | first | dense
    ascendente: bool = True

class ReemplazarPerdidosRequest(BaseModel):
    variables: list[str]
    metodo: str = "media"   # media | mediana | moda | valor | interpolacion | ffill | bfill
    valor: Optional[float] = None  # Solo si metodo=="valor"

class AgregarRequest(BaseModel):
    variable_grupo: str
    agregaciones: list[dict]  # [{"variable": "x", "funcion": "media", "nombre": "x_media"}]

class ReestructurarRequest(BaseModel):
    modo: str               # "wide_a_long" | "long_a_wide"
    # Para wide → long
    columnas_id: list[str] = []
    columnas_valor: list[str] = []
    nombre_var: str = "variable"
    nombre_val: str = "valor"
    # Para long → wide
    columna_indice: str = ""
    columna_columnas: str = ""
    columna_valores: str = ""

class DeshacerRequest(BaseModel):
    pasos: int = 1

class PartirArchivoRequest(BaseModel):
    variable_grupo: str     # Divide todos los análisis por grupos de esta variable

class PonderarRequest(BaseModel):
    variable_peso: Optional[str] = None  # None = desactivar ponderación


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _safe_eval_expr(df: pd.DataFrame, expresion: str) -> pd.Series:
    """Evalúa una expresión sobre el DataFrame de forma segura usando pandas.eval / numpy."""
    # Construcción del namespace seguro
    safe_ns = {
        "np": np,
        "abs": np.abs,
        "sqrt": np.sqrt,
        "log": np.log,
        "log10": np.log10,
        "log2": np.log2,
        "exp": np.exp,
        "sin": np.sin,
        "cos": np.cos,
        "tan": np.tan,
        "round": np.round,
        "ceil": np.ceil,
        "floor": np.floor,
        "mean": np.mean,
        "sum": np.sum,
        "min": np.minimum,
        "max": np.maximum,
        "nan": np.nan,
        "inf": np.inf,
    }
    # Agregar columnas del dataframe como variables locales
    for col in df.columns:
        safe_ns[col] = df[col]

    try:
        result = eval(expresion, {"__builtins__": {}}, safe_ns)  # noqa: S307
        if isinstance(result, (int, float)):
            return pd.Series([result] * len(df), index=df.index)
        return pd.Series(result, index=df.index)
    except Exception as e:
        raise ValueError(f"Error en la expresión '{expresion}': {e}")


def _safe_filter_expr(df: pd.DataFrame, condicion: str) -> pd.Series:
    """Evalúa una condición booleana sobre el DataFrame."""
    safe_ns = {
        "np": np,
        "nan": np.nan,
        "isna": pd.isna,
        "notna": pd.notna,
        "isnull": pd.isnull,
        "notnull": pd.notnull,
    }
    for col in df.columns:
        safe_ns[col] = df[col]
    try:
        result = eval(condicion, {"__builtins__": {}}, safe_ns)  # noqa: S307
        return pd.Series(result, index=df.index).fillna(False).astype(bool)
    except Exception as e:
        raise ValueError(f"Error en la condición '{condicion}': {e}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/calcular")
def calcular_variable(req: CalcularRequest):
    """COMPUTE en SPSS. Crea o modifica una variable mediante expresión."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    try:
        nueva_col = _safe_eval_expr(df, req.expresion)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    df[req.nombre_variable] = nueva_col
    descripcion = f"COMPUTE {req.nombre_variable} = {req.expresion}"
    data_manager.apply_mutation(df, descripcion)

    col_info = data_manager.get_metadata()["column_info"]
    nueva_info = next((c for c in col_info if c["nombre"] == req.nombre_variable), None)

    return {
        "ok": True,
        "accion": descripcion,
        "variable": req.nombre_variable,
        "tipo": nueva_info["tipo"] if nueva_info else "numerico",
        "n_validos": int(df[req.nombre_variable].notna().sum()),
        "n_perdidos": int(df[req.nombre_variable].isna().sum()),
        "preview": df[req.nombre_variable].head(10).fillna("").tolist(),
        "metadata": data_manager.get_metadata(),
    }


@router.post("/recodificar")
def recodificar(req: RecodificarRequest):
    """RECODE en SPSS. Mapea valores de una variable a nuevos valores."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    if req.variable_origen not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable_origen}' no encontrada")

    serie = df[req.variable_origen].copy()
    nueva_serie = pd.Series([np.nan] * len(serie), index=serie.index)

    for regla in req.mapeo:
        origen = regla.get("de")
        destino = regla.get("a")

        if origen == "MISSING" or origen is None:
            mask = serie.isna()
        elif isinstance(origen, dict) and "min" in origen:
            # Rango: {"min": 0, "max": 18}
            lo = origen.get("min", -np.inf)
            hi = origen.get("max", np.inf)
            lo = -np.inf if lo is None else lo
            hi = np.inf if hi is None else hi
            mask = (serie >= lo) & (serie <= hi)
        elif isinstance(origen, list):
            mask = serie.isin(origen)
        else:
            mask = serie == origen

        nueva_serie[mask] = destino

    # ELSE → mantener originales no mapeados
    else_mask = nueva_serie.isna() & serie.notna()
    nueva_serie[else_mask] = serie[else_mask]

    if req.tipo_salida == "numerico":
        nueva_serie = pd.to_numeric(nueva_serie, errors="coerce")

    df[req.variable_destino] = nueva_serie
    descripcion = f"RECODE {req.variable_origen} → {req.variable_destino} ({len(req.mapeo)} reglas)"
    data_manager.apply_mutation(df, descripcion)

    return {
        "ok": True,
        "accion": descripcion,
        "variable_destino": req.variable_destino,
        "n_recodificados": int((~nueva_serie.isna()).sum()),
        "n_perdidos": int(nueva_serie.isna().sum()),
        "preview": nueva_serie.head(10).fillna("").tolist(),
        "metadata": data_manager.get_metadata(),
    }


@router.post("/filtrar")
def filtrar_casos(req: FiltrarRequest):
    """SELECT IF en SPSS. Filtra filas según condición."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    try:
        mask = _safe_filter_expr(df, req.condicion)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    n_antes = len(df)
    if req.modo == "seleccionar":
        df_nuevo = df[mask].reset_index(drop=True)
        accion = f"SELECT IF {req.condicion}"
    else:
        df_nuevo = df[~mask].reset_index(drop=True)
        accion = f"DELETE IF {req.condicion}"

    n_despues = len(df_nuevo)
    data_manager.apply_mutation(df_nuevo, accion)

    return {
        "ok": True,
        "accion": accion,
        "filas_antes": n_antes,
        "filas_despues": n_despues,
        "filas_afectadas": n_antes - n_despues,
        "metadata": data_manager.get_metadata(),
    }


@router.post("/ordenar")
def ordenar_datos(req: OrdenarRequest):
    """SORT CASES en SPSS."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{v}' no encontrada")

    ascendente = req.ascendente if len(req.ascendente) == len(req.variables) else [True] * len(req.variables)

    df_nuevo = df.sort_values(by=req.variables, ascending=ascendente).reset_index(drop=True)
    orden_str = ", ".join(f"{v} {'ASC' if a else 'DESC'}" for v, a in zip(req.variables, ascendente))
    accion = f"SORT CASES BY {orden_str}"
    data_manager.apply_mutation(df_nuevo, accion)

    return {
        "ok": True,
        "accion": accion,
        "variables_ordenadas": req.variables,
        "metadata": data_manager.get_metadata(),
    }


@router.post("/ranking")
def ranking_variable(req: RankingRequest):
    """RANK en SPSS. Crea una nueva variable con el rango de otra."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    if req.variable not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable}' no encontrada")

    nombre_destino = req.nombre_ranking or f"RNG_{req.variable}"
    df[nombre_destino] = df[req.variable].rank(
        method=req.metodo,
        ascending=req.ascendente,
        na_option="keep"
    )

    accion = f"RANK {req.variable} INTO {nombre_destino}"
    data_manager.apply_mutation(df, accion)

    return {
        "ok": True,
        "accion": accion,
        "variable_ranking": nombre_destino,
        "n_validos": int(df[nombre_destino].notna().sum()),
        "preview": df[nombre_destino].head(10).fillna("").tolist(),
        "metadata": data_manager.get_metadata(),
    }


@router.post("/reemplazar-perdidos")
def reemplazar_perdidos(req: ReemplazarPerdidosRequest):
    """REPLACE MISSING VALUES en SPSS."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    resumen = []
    for var in req.variables:
        if var not in df.columns:
            continue
        n_perdidos_antes = int(df[var].isna().sum())
        if n_perdidos_antes == 0:
            resumen.append({"variable": var, "n_reemplazados": 0})
            continue

        if req.metodo == "media":
            val = df[var].mean()
            df[var] = df[var].fillna(val)
        elif req.metodo == "mediana":
            val = df[var].median()
            df[var] = df[var].fillna(val)
        elif req.metodo == "moda":
            val = df[var].mode()[0] if not df[var].mode().empty else np.nan
            df[var] = df[var].fillna(val)
        elif req.metodo == "valor":
            if req.valor is None:
                raise HTTPException(status_code=400, detail="Debes especificar 'valor' para este método")
            df[var] = df[var].fillna(req.valor)
        elif req.metodo == "interpolacion":
            df[var] = df[var].interpolate(method="linear", limit_direction="both")
        elif req.metodo == "ffill":
            df[var] = df[var].ffill()
        elif req.metodo == "bfill":
            df[var] = df[var].bfill()

        n_reemplazados = n_perdidos_antes - int(df[var].isna().sum())
        resumen.append({"variable": var, "n_reemplazados": n_reemplazados})

    accion = f"REPLACE MISSING ({req.metodo}) en {len(req.variables)} variable(s)"
    data_manager.apply_mutation(df, accion)

    return {
        "ok": True,
        "accion": accion,
        "resumen": resumen,
        "metadata": data_manager.get_metadata(),
    }


@router.post("/agregar")
def agregar_datos(req: AgregarRequest):
    """AGGREGATE en SPSS. Crea variables resumidas por grupos."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    if req.variable_grupo not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable_grupo}' no encontrada")

    FUNC_MAP = {
        "media": "mean",
        "mediana": "median",
        "suma": "sum",
        "minimo": "min",
        "maximo": "max",
        "n": "count",
        "desv": "std",
        "varianza": "var",
    }

    agg_dict = {}
    nombre_map = {}
    for ag in req.agregaciones:
        var = ag.get("variable")
        func = ag.get("funcion", "media")
        nombre = ag.get("nombre") or f"{var}_{func}"
        if var not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{var}' no encontrada")
        func_pd = FUNC_MAP.get(func, func)
        if var not in agg_dict:
            agg_dict[var] = []
        agg_dict[var].append(func_pd)
        nombre_map[(var, func_pd)] = nombre

    resultado = df.groupby(req.variable_grupo).agg(agg_dict)
    resultado.columns = [nombre_map.get((col, func), f"{col}_{func}") for col, func in resultado.columns]
    resultado = resultado.reset_index()

    # Unir al DataFrame principal
    df = df.merge(resultado, on=req.variable_grupo, how="left", suffixes=("", "_AGG"))

    accion = f"AGGREGATE BY {req.variable_grupo} ({len(req.agregaciones)} funciones)"
    data_manager.apply_mutation(df, accion)

    return {
        "ok": True,
        "accion": accion,
        "variables_creadas": list(nombre_map.values()),
        "n_grupos": int(df[req.variable_grupo].nunique()),
        "metadata": data_manager.get_metadata(),
    }


@router.post("/reestructurar")
def reestructurar(req: ReestructurarRequest):
    """RESTRUCTURE en SPSS. Convierte entre formato ancho (wide) y largo (long)."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe().copy()

    if req.modo == "wide_a_long":
        if not req.columnas_valor:
            raise HTTPException(status_code=400, detail="Debes especificar columnas_valor para wide → long")
        id_vars = req.columnas_id or [c for c in df.columns if c not in req.columnas_valor]
        # Evitar colisión: si el nombre de valor coincide con una columna existente, añadir sufijo
        nombre_val = req.nombre_val
        while nombre_val in df.columns and nombre_val not in req.columnas_valor:
            nombre_val = nombre_val + "_valor"
        nombre_var = req.nombre_var
        while nombre_var in df.columns and nombre_var not in req.columnas_valor:
            nombre_var = nombre_var + "_var"
        df_nuevo = pd.melt(
            df,
            id_vars=id_vars,
            value_vars=req.columnas_valor,
            var_name=nombre_var,
            value_name=nombre_val,
        )
        accion = f"RESTRUCTURE wide→long ({len(req.columnas_valor)} columnas → '{req.nombre_var}', '{req.nombre_val}')"

    elif req.modo == "long_a_wide":
        if not req.columna_indice or not req.columna_columnas or not req.columna_valores:
            raise HTTPException(status_code=400, detail="Para long→wide debes especificar columna_indice, columna_columnas, columna_valores")
        df_nuevo = df.pivot(
            index=req.columna_indice,
            columns=req.columna_columnas,
            values=req.columna_valores,
        ).reset_index()
        df_nuevo.columns.name = None
        accion = f"RESTRUCTURE long→wide (índice='{req.columna_indice}', columnas='{req.columna_columnas}')"

    else:
        raise HTTPException(status_code=400, detail="modo debe ser 'wide_a_long' o 'long_a_wide'")

    data_manager.apply_mutation(df_nuevo, accion)

    return {
        "ok": True,
        "accion": accion,
        "filas_antes": len(df),
        "filas_despues": len(df_nuevo),
        "columnas_antes": len(df.columns),
        "columnas_despues": len(df_nuevo.columns),
        "metadata": data_manager.get_metadata(),
    }


@router.post("/deshacer")
def deshacer(req: DeshacerRequest):
    """Deshace las últimas N transformaciones."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")

    exito, mensaje = data_manager.undo(req.pasos)
    if not exito:
        raise HTTPException(status_code=400, detail=mensaje)

    return {
        "ok": True,
        "mensaje": mensaje,
        "metadata": data_manager.get_metadata(),
    }


@router.get("/historial")
def historial():
    """Retorna el historial de transformaciones aplicadas."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    return {
        "historial": data_manager.get_transformation_history(),
        "puede_deshacer": data_manager.can_undo(),
    }


@router.post("/partir-archivo")
def partir_archivo(req: PartirArchivoRequest):
    """SPLIT FILE en SPSS. Configura una variable de agrupación para todos los análisis."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.variable_grupo not in df.columns:
        raise HTTPException(status_code=400, detail=f"Variable '{req.variable_grupo}' no encontrada")

    grupos = sorted(df[req.variable_grupo].dropna().unique().tolist())
    data_manager.set_split_variable(req.variable_grupo)

    return {
        "ok": True,
        "variable_grupo": req.variable_grupo,
        "n_grupos": len(grupos),
        "grupos": [str(g) for g in grupos],
    }


@router.post("/desactivar-particion")
def desactivar_particion():
    """Desactiva la división de archivo activa."""
    data_manager.set_split_variable(None)
    return {"ok": True, "mensaje": "División de archivo desactivada"}


@router.post("/ponderar")
def ponderar(req: PonderarRequest):
    """WEIGHT BY en SPSS. Activa o desactiva ponderación de casos."""
    if not data_manager.is_loaded():
        raise HTTPException(status_code=404, detail="No hay dataset cargado")

    if req.variable_peso is not None:
        df = data_manager.get_dataframe()
        if req.variable_peso not in df.columns:
            raise HTTPException(status_code=400, detail=f"Variable '{req.variable_peso}' no encontrada")
        negativos = int((df[req.variable_peso] < 0).sum())
        if negativos > 0:
            raise HTTPException(status_code=400, detail=f"La variable de peso tiene {negativos} valores negativos")

    data_manager.set_weight_variable(req.variable_peso)

    return {
        "ok": True,
        "ponderacion_activa": req.variable_peso is not None,
        "variable_peso": req.variable_peso,
    }


@router.get("/estado")
def estado_transformaciones():
    """Retorna el estado actual: historial, partición activa, ponderación activa."""
    if not data_manager.is_loaded():
        return {
            "dataset_cargado": False,
            "historial": [],
            "puede_deshacer": False,
            "particion_activa": None,
            "ponderacion_activa": None,
        }
    return {
        "dataset_cargado": True,
        "historial": data_manager.get_transformation_history(),
        "puede_deshacer": data_manager.can_undo(),
        "particion_activa": data_manager.get_split_variable(),
        "ponderacion_activa": data_manager.get_weight_variable(),
    }
