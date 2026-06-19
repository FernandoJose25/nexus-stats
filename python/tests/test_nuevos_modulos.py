"""
Tests para los 10 módulos nuevos implementados en la fase de paridad completa.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from main import app
from services import data_manager

client = TestClient(app)


@pytest.fixture(autouse=True)
def dataset():
    np.random.seed(42)
    n = 150
    df = pd.DataFrame({
        "id":    np.arange(1, n+1).astype(float),
        "x":     np.random.normal(0, 1, n),
        "m":     np.random.normal(0, 1, n),
        "y":     np.random.normal(0, 1, n),
        "w":     np.random.normal(0, 1, n),
        "edad":  np.random.randint(18, 65, n).astype(float),
        "peso":  np.random.normal(70, 12, n),
        "alto":  np.random.normal(170, 10, n),
        "sexo":  np.random.choice(["M","F"], n),
        "grupo": np.random.choice(["A","B","C"], n),
        "item1": np.random.choice([0,1], n).astype(float),
        "item2": np.random.choice([0,1], n).astype(float),
        "item3": np.random.choice([0,1], n).astype(float),
        "item4": np.random.choice([0,1], n).astype(float),
        "item5": np.random.choice([0,1], n).astype(float),
        "p1":    np.random.randint(1,6,n).astype(float),
        "p2":    np.random.randint(1,6,n).astype(float),
        "tiempo": np.arange(n).astype(float),
        "evento": np.random.choice([0,1], n, p=[0.4,0.6]),
        "var_cat": np.random.choice(["A","B"], n),
    })
    # Añadir correlaciones reales para mediación
    df["m"] = df["x"] * 0.5 + np.random.normal(0, 0.5, n)
    df["y"] = df["m"] * 0.4 + df["x"] * 0.2 + np.random.normal(0, 0.5, n)

    data_manager._df = df
    data_manager._df_original = df.copy()
    data_manager._metadata = data_manager._build_metadata(df, "test.csv")
    data_manager._history = []
    data_manager._split_variable = None
    data_manager._weight_variable = None
    data_manager._reset_duckdb()
    yield
    data_manager._df = None
    data_manager._metadata = {}


# ─── 1. Gráficos avanzados ────────────────────────────────────────────────────

def test_grafico_pie():
    r = client.post("/graficos/pie", json={"variable_x": "sexo"})
    assert r.status_code == 200
    body = r.json()
    assert body["data"][0]["type"] == "pie"
    assert len(body["data"][0]["labels"]) == 2

def test_grafico_donut():
    r = client.post("/graficos/pie", json={"variable_x": "grupo", "donut": True})
    assert r.status_code == 200
    assert body["data"][0]["hole"] == 0.45 if (body := r.json()) else True

def test_grafico_error_bars():
    r = client.post("/graficos/error-bars", json={
        "variable_valor": "edad", "variable_grupo": "grupo", "tipo_error": "ic95"
    })
    assert r.status_code == 200
    assert r.json()["data"][0]["type"] == "bar"

def test_grafico_qq():
    r = client.post("/graficos/qq", json={"variable_x": "edad"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["data"]) == 2  # puntos + línea referencia

def test_grafico_pp():
    r = client.post("/graficos/pp", json={"variable_x": "edad"})
    assert r.status_code == 200

def test_grafico_stem_leaf():
    r = client.post("/graficos/stem-leaf", json={"variable_x": "edad"})
    assert r.status_code == 200
    body = r.json()
    assert "texto" in body
    assert "Tallo" in body["texto"]

def test_grafico_scatter_matrix():
    r = client.post("/graficos/scatter-matrix", json={
        "variables": ["edad", "peso", "alto"]
    })
    assert r.status_code == 200
    assert r.json()["data"][0]["type"] == "splom"

def test_grafico_violin():
    r = client.post("/graficos/violin", json={"variable_valor": "edad", "variable_grupo": "grupo"})
    assert r.status_code == 200
    assert len(r.json()["data"]) == 3  # 3 grupos


# ─── 2. Exportación APA ──────────────────────────────────────────────────────

def test_exportar_apa(tmp_path):
    ruta = str(tmp_path / "test_apa.docx")
    r = client.post("/exportar/apa", json={
        "bloques": [
            {"tipo": "descriptivos", "datos": {"resultados": [
                {"variable": "edad", "n_validos": 150, "media": 40.0, "desv_tipica": 12.0,
                 "minimo": 18.0, "maximo": 65.0, "asimetria": 0.1, "curtosis": -0.2}
            ]}}
        ],
        "titulo_documento": "Resultados Test",
        "ruta_destino": ruta
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert os.path.exists(ruta)


# ─── 3. Variable View ─────────────────────────────────────────────────────────

def test_variable_view_get_all():
    r = client.get("/variables/")
    assert r.status_code == 200
    body = r.json()
    assert "variables" in body
    assert len(body["variables"]) >= 10

def test_variable_view_actualizar():
    r = client.post("/variables/actualizar", json={"variables": [{
        "nombre": "edad",
        "etiqueta": "Edad del participante",
        "etiquetas_valores": {},
        "missings_definidos": [99],
        "medida": "escala",
        "decimales": 0,
        "ancho": 5,
    }]})
    assert r.status_code == 200
    assert r.json()["ok"] is True

def test_variable_view_get_una():
    r = client.get("/variables/edad")
    assert r.status_code == 200
    assert r.json()["nombre"] == "edad"

def test_variable_renombrar():
    r = client.post("/variables/renombrar", json={"nombre_actual": "p1", "nombre_nuevo": "puntuacion_1"})
    assert r.status_code == 200
    meta = r.json()["metadata"]
    nombres = [c["nombre"] for c in meta["column_info"]]
    assert "puntuacion_1" in nombres
    assert "p1" not in nombres

def test_variable_eliminar():
    r = client.delete("/variables/p2")
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ─── 4. Proyecto .nexus ──────────────────────────────────────────────────────

def test_proyecto_guardar_cargar(tmp_path):
    ruta = str(tmp_path / "test.nexus")

    # Guardar
    r = client.post("/proyecto/guardar", json={
        "ruta_destino": ruta,
        "nombre_proyecto": "Test Proyecto"
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert os.path.exists(ruta)
    assert r.json()["filas"] == 150

    # Cargar en estado limpio
    data_manager._df = None
    r2 = client.post("/proyecto/cargar", json={"ruta": ruta})
    assert r2.status_code == 200
    assert r2.json()["ok"] is True
    assert r2.json()["metadata"]["rows"] == 150

def test_proyecto_info():
    r = client.get("/proyecto/info")
    assert r.status_code == 200
    body = r.json()
    assert body["cargado"] is True
    assert body["rows"] == 150


# ─── 5. Mediación ────────────────────────────────────────────────────────────

def test_mediacion_modelo_4():
    r = client.post("/mediacion/ajustar", json={
        "x": "x", "y": "y", "mediadores": ["m"],
        "modelo": 4, "n_bootstrap": 200
    })
    assert r.status_code == 200
    body = r.json()
    assert body["modelo"] == 4
    assert "efectos_indirectos" in body
    assert len(body["efectos_indirectos"]) == 1
    ef = body["efectos_indirectos"][0]
    assert "boot_ci_lo" in ef
    assert "boot_ci_hi" in ef
    # Con correlación artificial, el efecto indirecto debe ser positivo
    assert body["efecto_total_c"] > 0

def test_mediacion_modelo_1():
    r = client.post("/mediacion/ajustar", json={
        "x": "x", "y": "y", "moderador": "w",
        "modelo": 1, "n_bootstrap": 100
    })
    assert r.status_code == 200
    body = r.json()
    assert body["modelo"] == 1
    assert "coeficientes" in body
    assert len(body["coeficientes"]) == 4  # const, x, w, x*w

def test_mediacion_paralela():
    r = client.post("/mediacion/ajustar", json={
        "x": "x", "y": "y", "mediadores": ["m", "peso"],
        "modelo": 58, "n_bootstrap": 100
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["efectos"]) == 2

def test_sobel():
    r = client.post("/mediacion/sobel", json={"x":"x", "mediador":"m", "y":"y"})
    assert r.status_code == 200
    body = r.json()
    assert "z_sobel" in body
    assert "p_value" in body


# ─── 6. MDS ──────────────────────────────────────────────────────────────────

def test_mds_clasico():
    r = client.post("/mds/ajustar", json={
        "variables": ["edad", "peso", "alto"],
        "n_dimensiones": 2,
        "tipo": "clasico"
    })
    assert r.status_code == 200
    body = r.json()
    assert "puntos" in body
    assert len(body["puntos"]) == 150
    assert "stress" in body
    assert body["stress"] >= 0

def test_mds_no_metrico():
    r = client.post("/mds/ajustar", json={
        "variables": ["edad", "peso"],
        "n_dimensiones": 2,
        "tipo": "no_metrico"
    })
    assert r.status_code == 200


# ─── 7. Tablas personalizadas ─────────────────────────────────────────────────

def test_tablas_custom_simple():
    r = client.post("/tablas-custom/generar", json={
        "variables_fila": ["sexo"],
        "funciones": ["n","pct"]
    })
    assert r.status_code == 200
    body = r.json()
    assert body["tipo"] == "tabla_simple"
    assert len(body["filas"]) == 3  # M, F, Total

def test_tablas_custom_cruzada():
    r = client.post("/tablas-custom/generar", json={
        "variables_fila": ["sexo"],
        "variables_columna": ["grupo"],
        "funciones": ["n","pct"],
        "incluir_totales": True
    })
    assert r.status_code == 200
    body = r.json()
    assert body["tipo"] == "tabla_cruzada"
    assert "A" in body["columnas"]

def test_funciones_disponibles():
    r = client.get("/tablas-custom/funciones-disponibles")
    assert r.status_code == 200
    assert len(r.json()["funciones"]) >= 8


# ─── 8. Tests no paramétricos adicionales ────────────────────────────────────

def test_ks_dos_muestras():
    r = client.post("/hipotesis/ks-dos-muestras", json={
        "variable": "edad", "grupo": "sexo"
    })
    assert r.status_code == 200
    body = r.json()
    assert "D" in body
    assert "p_value" in body

def test_mcnemar():
    r = client.post("/hipotesis/mcnemar", json={
        "variable_1": "item1", "variable_2": "item2"
    })
    assert r.status_code == 200
    body = r.json()
    assert "kappa" in str(body) or "chi2" in body
    assert "p_value" in body

def test_cochran_q():
    r = client.post("/hipotesis/cochran-q", json={
        "variables": ["item1","item2","item3"]
    })
    assert r.status_code == 200
    body = r.json()
    assert "Q" in body
    assert "p_value" in body

def test_test_mediana():
    r = client.post("/hipotesis/mediana", json={
        "variable": "edad", "grupo": "grupo"
    })
    assert r.status_code == 200
    body = r.json()
    assert "mediana_global" in body
    assert "chi2" in body


# ─── 9. Sintaxis ─────────────────────────────────────────────────────────────

def test_sintaxis_ejecutar_compute():
    r = client.post("/sintaxis/ejecutar", json={
        "codigo": "COMPUTE edad2 = edad * 2.",
        "detener_en_error": True
    })
    assert r.status_code == 200
    body = r.json()
    assert body["n_exitosos"] == 1
    assert body["n_errores"] == 0

def test_sintaxis_ejecutar_multiple():
    codigo = """* Comentario
COMPUTE imc = peso / (alto / 100) ** 2.
SELECT IF (edad >= 20).
SORT CASES BY edad (A).
"""
    r = client.post("/sintaxis/ejecutar", json={"codigo": codigo, "detener_en_error": False})
    assert r.status_code == 200
    body = r.json()
    assert body["n_exitosos"] >= 2

def test_sintaxis_ayuda():
    r = client.get("/sintaxis/ayuda")
    assert r.status_code == 200
    assert len(r.json()["comandos"]) >= 10

def test_sintaxis_guardar_cargar(tmp_path):
    ruta = str(tmp_path / "script.nxs")
    codigo = "COMPUTE x2 = x * 2."
    r = client.post("/sintaxis/guardar", json={"codigo": codigo, "ruta": ruta})
    assert r.status_code == 200
    r2 = client.post("/sintaxis/cargar", json={"ruta": ruta})
    assert r2.status_code == 200
    assert r2.json()["codigo"] == codigo


# ─── 10. TRI / Rasch ─────────────────────────────────────────────────────────

def test_tri_rasch():
    r = client.post("/tri/ajustar", json={
        "items": ["item1","item2","item3","item4","item5"],
        "modelo": "rasch",
        "n_cuadratura": 11,
        "max_iter": 20
    })
    assert r.status_code == 200
    body = r.json()
    assert "estadisticos_items" in body
    assert len(body["estadisticos_items"]) == 5
    assert "thetas_personas" in body
    assert len(body["thetas_personas"]) <= 150   # Retorna primeras 100 por defecto
    for item in body["estadisticos_items"]:
        assert "dificultad_b" in item
        assert "infit_mnsq" in item
        assert "discriminacion_a" in item
        assert item["discriminacion_a"] == 1.0  # Rasch fija a=1

def test_tri_2pl():
    r = client.post("/tri/ajustar", json={
        "items": ["item1","item2","item3"],
        "modelo": "2pl",
        "n_cuadratura": 9,
        "max_iter": 10
    })
    assert r.status_code == 200
    body = r.json()
    assert body["modelo"] == "2pl"
    for item in body["estadisticos_items"]:
        assert item["discriminacion_a"] > 0  # 2PL estima discriminación

def test_tri_items_no_dicotomicos():
    """Debe rechazar ítems no binarios."""
    r = client.post("/tri/ajustar", json={
        "items": ["p1","p2","p3"]  # Escala 1-5
    })
    assert r.status_code == 400
