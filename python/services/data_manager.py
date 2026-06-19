"""
Gestión del dataset activo en memoria.
Soporta historial de transformaciones (undo), partición y ponderación de casos.
"""
from pathlib import Path
from typing import Optional

import duckdb
import pandas as pd

# ─── Estado singleton ─────────────────────────────────────────────────────────
_df: Optional[pd.DataFrame] = None           # Dataset activo
_df_original: Optional[pd.DataFrame] = None  # Copia del archivo cargado (para reset)
_history: list[dict] = []                    # [{df, descripcion}, ...]
_conn: Optional[duckdb.DuckDBPyConnection] = None
_metadata: dict = {}
_filepath: Optional[str] = None             # Ruta del archivo cargado actualmente

# Configuración de análisis
_split_variable: Optional[str] = None       # SPLIT FILE
_weight_variable: Optional[str] = None      # WEIGHT BY

MAX_HISTORY = 30


# ─── DuckDB ───────────────────────────────────────────────────────────────────

def _reset_duckdb():
    global _conn
    _conn = duckdb.connect(":memory:")
    if _df is not None:
        _conn.register("dataset", _df)


# ─── Metadata ─────────────────────────────────────────────────────────────────

def _build_metadata(df: pd.DataFrame, filename: str) -> dict:
    return {
        "filename": filename,
        "rows": len(df),
        "columns": len(df.columns),
        "column_info": _get_column_info(df),
    }


def _get_column_info(df: pd.DataFrame) -> list[dict]:
    info = []
    for col in df.columns:
        dtype = df[col].dtype
        if pd.api.types.is_numeric_dtype(dtype):
            tipo = "numerico"
        elif pd.api.types.is_datetime64_any_dtype(dtype):
            tipo = "fecha"
        else:
            tipo = "cadena"
        info.append({
            "nombre": col,
            "tipo": tipo,
            "dtype": str(dtype),
            "n_validos": int(df[col].notna().sum()),
            "n_perdidos": int(df[col].isna().sum()),
        })
    return info


# ─── Carga de archivos ────────────────────────────────────────────────────────

def get_filepath() -> Optional[str]:
    return _filepath


def load_file(filepath: str) -> dict:
    global _df, _df_original, _metadata, _history, _split_variable, _weight_variable, _filepath

    path = Path(filepath)
    ext = path.suffix.lower()

    loaders = {
        ".csv": _load_csv,
        ".xlsx": _load_excel,
        ".xls": _load_excel,
        ".sav": _load_spss,
        ".sas7bdat": _load_sas,
        ".dta": _load_stata,
    }

    if ext not in loaders:
        raise ValueError(f"Formato no soportado: {ext}")

    _df = loaders[ext](filepath)
    _df_original = _df.copy()
    _history = []
    _split_variable = None
    _weight_variable = None
    _filepath = filepath
    _reset_duckdb()

    _metadata = _build_metadata(_df, path.name)
    return _metadata


def _load_csv(filepath: str) -> pd.DataFrame:
    return pd.read_csv(filepath, sep=None, engine="python", encoding_errors="replace")


def _load_excel(filepath: str) -> pd.DataFrame:
    return pd.read_excel(filepath)


def _load_spss(filepath: str) -> pd.DataFrame:
    import pyreadstat
    df, _ = pyreadstat.read_sav(filepath)
    return df


def _load_sas(filepath: str) -> pd.DataFrame:
    import pyreadstat
    df, _ = pyreadstat.read_sas7bdat(filepath)
    return df


def _load_stata(filepath: str) -> pd.DataFrame:
    return pd.read_stata(filepath)


# ─── Mutaciones (transformaciones) ───────────────────────────────────────────

def apply_mutation(new_df: pd.DataFrame, descripcion: str):
    """Aplica una transformación: guarda el estado anterior en historial y actualiza el activo."""
    global _df, _metadata, _history

    if _df is not None:
        _history.append({
            "df": _df.copy(),
            "metadata": dict(_metadata),
            "descripcion": descripcion,
        })
        if len(_history) > MAX_HISTORY:
            _history.pop(0)

    _df = new_df
    filename = _metadata.get("filename", "dataset")
    _metadata = _build_metadata(_df, filename)
    _reset_duckdb()


def undo(pasos: int = 1) -> tuple[bool, str]:
    """Deshace las últimas N transformaciones."""
    global _df, _metadata, _history

    if not _history:
        return False, "No hay transformaciones para deshacer"

    pasos = min(pasos, len(_history))
    estado = _history[-pasos]
    _history = _history[:-pasos]

    _df = estado["df"]
    _metadata = estado["metadata"]
    _reset_duckdb()

    return True, f"Deshecha(s) {pasos} transformación(es)"


def can_undo() -> bool:
    return len(_history) > 0


def get_transformation_history() -> list[dict]:
    return [
        {"paso": i + 1, "descripcion": h["descripcion"]}
        for i, h in enumerate(_history)
    ]


# ─── SPLIT FILE / WEIGHT BY ───────────────────────────────────────────────────

def set_split_variable(variable: Optional[str]):
    global _split_variable
    _split_variable = variable


def get_split_variable() -> Optional[str]:
    return _split_variable


def set_weight_variable(variable: Optional[str]):
    global _weight_variable
    _weight_variable = variable


def get_weight_variable() -> Optional[str]:
    return _weight_variable


# ─── Acceso al dataset ────────────────────────────────────────────────────────

def get_preview(n: int = 100) -> list[dict]:
    if _df is None:
        raise RuntimeError("No hay dataset cargado")
    return _df.head(n).fillna("").to_dict(orient="records")


def get_dataframe() -> pd.DataFrame:
    if _df is None:
        raise RuntimeError("No hay dataset cargado")
    return _df


def get_metadata() -> dict:
    return _metadata


def query(sql: str) -> pd.DataFrame:
    if _conn is None:
        raise RuntimeError("No hay dataset cargado")
    return _conn.execute(sql).df()


def is_loaded() -> bool:
    return _df is not None


def save_file(ruta_destino: Optional[str] = None) -> str:
    """Guarda el dataset activo en disco. Si ruta_destino es None usa la ruta original."""
    if _df is None:
        raise RuntimeError("No hay dataset cargado")

    destino = ruta_destino or _filepath
    if not destino:
        raise RuntimeError("No se conoce la ruta del archivo")

    path = Path(destino)
    ext = path.suffix.lower()

    if ext == ".csv":
        _df.to_csv(destino, index=False)
    elif ext in (".xlsx", ".xls"):
        _df.to_excel(destino, index=False)
    elif ext == ".sav":
        import pyreadstat
        pyreadstat.write_sav(_df, destino)
    else:
        # Formato no soportado para escritura: guardar como CSV junto al original
        destino = str(path.with_suffix(".csv"))
        _df.to_csv(destino, index=False)

    return destino
