"""
Editor de Sintaxis — equivalente al Syntax Editor de SPSS.
Soporta un subconjunto del lenguaje de comandos de SPSS para reproducibilidad.
Los comandos se traducen a llamadas internas de los routers existentes.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import re
import json

from services import data_manager

router = APIRouter()

# Historial de comandos ejecutados en la sesión
_historial_sintaxis: list[dict] = []


class EjecutarSintaxisRequest(BaseModel):
    codigo: str
    detener_en_error: bool = True


class GuardarSintaxisRequest(BaseModel):
    codigo: str
    ruta: str


class CargarSintaxisRequest(BaseModel):
    ruta: str


# ─── Parser de comandos ───────────────────────────────────────────────────────

def _parsear_comando(linea: str) -> Optional[dict]:
    """Parsea una línea de sintaxis y retorna un dict {comando, params} o None."""
    linea = linea.strip().rstrip('.')
    if not linea or linea.startswith('*'):  # Comentario
        return None

    # COMPUTE varname = expresion
    m = re.match(r'COMPUTE\s+(\w+)\s*=\s*(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "COMPUTE", "variable": m.group(1).strip(), "expresion": m.group(2).strip()}

    # RECODE var (old=new) ... INTO newvar
    m = re.match(r'RECODE\s+(\w+)\s+(.+?)\s+INTO\s+(\w+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "RECODE", "variable": m.group(1), "reglas_raw": m.group(2), "destino": m.group(3)}

    # SELECT IF (condicion)
    m = re.match(r'SELECT\s+IF\s*\((.+)\)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "SELECT_IF", "condicion": m.group(1).strip()}

    # SORT CASES BY var (A/D) ...
    m = re.match(r'SORT\s+CASES\s+BY\s+(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "SORT_CASES", "spec": m.group(1).strip()}

    # DESCRIPTIVES VARIABLES=var1 var2 ...
    m = re.match(r'DESCRIPTIVES\s+VARIABLES\s*=\s*(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "DESCRIPTIVES", "variables": m.group(1).split()}

    # FREQUENCIES VARIABLES=var1 var2 ...
    m = re.match(r'FREQUENCIES\s+VARIABLES\s*=\s*(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "FREQUENCIES", "variables": m.group(1).split()}

    # CROSSTABS TABLES=var1 BY var2
    m = re.match(r'CROSSTABS\s+TABLES\s*=\s*(\w+)\s+BY\s+(\w+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "CROSSTABS", "fila": m.group(1), "columna": m.group(2)}

    # CORRELATIONS VARIABLES=var1 var2 ...
    m = re.match(r'CORRELATIONS\s+VARIABLES\s*=\s*(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "CORRELATIONS", "variables": m.group(1).split()}

    # T-TEST GROUPS=grupo(1 2) /VARIABLES=var
    m = re.match(r'T-TEST\s+GROUPS\s*=\s*(\w+)\s*\(\d+\s+\d+\)\s*/VARIABLES\s*=\s*(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "T_TEST_INDEP", "grupo": m.group(1), "variable": m.group(2).strip()}

    # ONEWAY var BY grupo
    m = re.match(r'ONEWAY\s+(\w+)\s+BY\s+(\w+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "ONEWAY", "variable": m.group(1), "factor": m.group(2)}

    # WEIGHT BY var
    m = re.match(r'WEIGHT\s+BY\s+(\w+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "WEIGHT_BY", "variable": m.group(1)}

    # WEIGHT OFF
    m = re.match(r'WEIGHT\s+OFF', linea, re.IGNORECASE)
    if m:
        return {"cmd": "WEIGHT_OFF"}

    # SPLIT FILE BY var
    m = re.match(r'SPLIT\s+FILE\s+(?:LAYERED\s+)?BY\s+(\w+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "SPLIT_FILE", "variable": m.group(1)}

    # SPLIT FILE OFF
    m = re.match(r'SPLIT\s+FILE\s+OFF', linea, re.IGNORECASE)
    if m:
        return {"cmd": "SPLIT_FILE_OFF"}

    # RENAME VARIABLES (old=new)
    m = re.match(r'RENAME\s+VARIABLES\s*\((\w+)\s*=\s*(\w+)\)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "RENAME", "viejo": m.group(1), "nuevo": m.group(2)}

    # DELETE VARIABLES var1 var2 ...
    m = re.match(r'DELETE\s+VARIABLES\s+(.+)', linea, re.IGNORECASE)
    if m:
        return {"cmd": "DELETE_VARIABLES", "variables": m.group(1).split()}

    return {"cmd": "DESCONOCIDO", "linea": linea}


async def _ejecutar_comando(cmd_dict: dict) -> dict:
    """Ejecuta un comando parseado y retorna el resultado."""
    import httpx
    from services import data_manager as dm

    cmd = cmd_dict["cmd"]

    if cmd == "COMPUTE":
        from routers.transformar import calcular_variable, CalcularRequest
        req = CalcularRequest(nombre_variable=cmd_dict["variable"], expresion=cmd_dict["expresion"])
        return calcular_variable(req)

    elif cmd == "SELECT_IF":
        from routers.transformar import filtrar_casos, FiltrarRequest
        req = FiltrarRequest(condicion=cmd_dict["condicion"], modo="seleccionar")
        return filtrar_casos(req)

    elif cmd == "SORT_CASES":
        from routers.transformar import ordenar_datos, OrdenarRequest
        spec = cmd_dict["spec"]
        variables = []
        ascendente = []
        parts = spec.split()
        i = 0
        while i < len(parts):
            var = parts[i]
            variables.append(var)
            orden = True
            if i+1 < len(parts) and parts[i+1].upper() in ('(A)', '(D)'):
                orden = parts[i+1].upper() == '(A)'
                i += 1
            ascendente.append(orden)
            i += 1
        req = OrdenarRequest(variables=variables, ascendente=ascendente)
        return ordenar_datos(req)

    elif cmd == "WEIGHT_BY":
        dm.set_weight_variable(cmd_dict["variable"])
        return {"ok": True, "mensaje": f"Ponderación activada: {cmd_dict['variable']}"}

    elif cmd == "WEIGHT_OFF":
        dm.set_weight_variable(None)
        return {"ok": True, "mensaje": "Ponderación desactivada"}

    elif cmd == "SPLIT_FILE":
        dm.set_split_variable(cmd_dict["variable"])
        return {"ok": True, "mensaje": f"División activada: {cmd_dict['variable']}"}

    elif cmd == "SPLIT_FILE_OFF":
        dm.set_split_variable(None)
        return {"ok": True, "mensaje": "División desactivada"}

    elif cmd == "RENAME":
        from routers.variable_meta import renombrar_variable, RenombrarRequest
        req = RenombrarRequest(nombre_actual=cmd_dict["viejo"], nombre_nuevo=cmd_dict["nuevo"])
        return renombrar_variable(req)

    elif cmd == "DELETE_VARIABLES":
        from routers.variable_meta import eliminar_variable
        resultados = []
        for v in cmd_dict["variables"]:
            try:
                resultados.append(eliminar_variable(v))
            except Exception as e:
                resultados.append({"error": str(e)})
        return {"ok": True, "eliminadas": cmd_dict["variables"], "resultados": resultados}

    elif cmd == "DESCRIPTIVES":
        from routers.descriptivos import calcular_descriptivos
        class Req:
            variables = cmd_dict["variables"]
            incluir_frecuencias = False
        return calcular_descriptivos(Req())

    elif cmd == "CROSSTABS":
        from routers.crosstabs import CrosstabsRequest, crosstabs
        req = CrosstabsRequest(variable_fila=cmd_dict["fila"], variable_columna=cmd_dict["columna"])
        return crosstabs(req)

    elif cmd == "ONEWAY":
        from routers.anova import anova_one_way, AnovaOneWayRequest
        req = AnovaOneWayRequest(dependiente=cmd_dict["variable"], factor=cmd_dict["factor"])
        return anova_one_way(req)

    elif cmd == "T_TEST_INDEP":
        from routers.hipotesis import t_independientes, TIndependientesRequest
        req = TIndependientesRequest(variable=cmd_dict["variable"], grupo=cmd_dict["grupo"])
        return t_independientes(req)

    elif cmd == "DESCONOCIDO":
        return {"advertencia": f"Comando no reconocido: {cmd_dict.get('linea','')}"}

    return {"ok": True, "cmd": cmd, "nota": "Ejecutado sin resultado específico"}


@router.post("/ejecutar")
async def ejecutar_sintaxis(req: EjecutarSintaxisRequest):
    """Ejecuta un bloque de sintaxis línea por línea."""
    if not data_manager.is_loaded():
        raise HTTPException(404, "No hay dataset cargado")

    lineas = [l for l in req.codigo.split('\n') if l.strip()]
    resultados = []
    errores = 0

    for linea in lineas:
        cmd = _parsear_comando(linea)
        if cmd is None:
            continue   # Comentario o línea vacía

        try:
            resultado = await _ejecutar_comando(cmd)
            entry = {"linea": linea, "cmd": cmd["cmd"], "resultado": resultado, "ok": True}
        except Exception as e:
            entry = {"linea": linea, "cmd": cmd.get("cmd","?"), "error": str(e), "ok": False}
            errores += 1
            if req.detener_en_error:
                resultados.append(entry)
                break

        resultados.append(entry)
        _historial_sintaxis.append({"linea": linea, **entry})

    return {
        "n_comandos": len(resultados),
        "n_exitosos": len([r for r in resultados if r["ok"]]),
        "n_errores": errores,
        "resultados": resultados,
        "metadata_actual": data_manager.get_metadata() if data_manager.is_loaded() else None,
    }


@router.post("/guardar")
def guardar_sintaxis(req: GuardarSintaxisRequest):
    try:
        with open(req.ruta, 'w', encoding='utf-8') as f:
            f.write(req.codigo)
        return {"ok": True, "ruta": req.ruta}
    except Exception as e:
        raise HTTPException(500, f"Error al guardar: {e}")


@router.post("/cargar")
def cargar_sintaxis(req: CargarSintaxisRequest):
    try:
        with open(req.ruta, 'r', encoding='utf-8') as f:
            codigo = f.read()
        return {"ok": True, "codigo": codigo, "n_lineas": len(codigo.split('\n'))}
    except FileNotFoundError:
        raise HTTPException(404, f"Archivo no encontrado: {req.ruta}")


@router.get("/historial")
def get_historial():
    return {"historial": _historial_sintaxis[-50:]}  # Últimos 50


@router.get("/ayuda")
def ayuda_sintaxis():
    return {
        "comandos": [
            {"cmd": "COMPUTE varname = expresion.", "desc": "Calcula nueva variable. Ej: COMPUTE imc = peso / (altura/100)**2."},
            {"cmd": "SELECT IF (condicion).", "desc": "Filtra casos. Ej: SELECT IF (edad > 18)."},
            {"cmd": "SORT CASES BY var (A/D).", "desc": "Ordena datos. (A)=ascendente, (D)=descendente."},
            {"cmd": "RECODE var (old=new) INTO newvar.", "desc": "Recodifica valores."},
            {"cmd": "WEIGHT BY var.", "desc": "Activa ponderación por variable."},
            {"cmd": "WEIGHT OFF.", "desc": "Desactiva ponderación."},
            {"cmd": "SPLIT FILE BY var.", "desc": "Divide análisis por grupos."},
            {"cmd": "SPLIT FILE OFF.", "desc": "Desactiva división."},
            {"cmd": "RENAME VARIABLES (viejo=nuevo).", "desc": "Renombra una variable."},
            {"cmd": "DELETE VARIABLES var1 var2.", "desc": "Elimina variables."},
            {"cmd": "DESCRIPTIVES VARIABLES=var1 var2.", "desc": "Estadísticos descriptivos."},
            {"cmd": "CROSSTABS TABLES=var1 BY var2.", "desc": "Tabla de contingencia."},
            {"cmd": "T-TEST GROUPS=grupo(1 2) /VARIABLES=var.", "desc": "T de muestras independientes."},
            {"cmd": "ONEWAY var BY grupo.", "desc": "ANOVA de un factor."},
            {"cmd": "* Comentario.", "desc": "Línea de comentario (se ignora)."},
        ]
    }
