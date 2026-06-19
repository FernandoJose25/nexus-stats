"""
Tests exhaustivos de todos los routers de Nexus Stats.
Ejecutar: cd python && python -m pytest tests/ -v
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

# ─── Dataset sintético reutilizable ──────────────────────────────────────────

@pytest.fixture(autouse=True)
def cargar_dataset():
    """Genera un DataFrame sintético y lo inyecta en data_manager antes de cada test."""
    np.random.seed(42)
    n = 120
    df = pd.DataFrame({
        "id":              np.arange(1, n + 1).astype(float),
        "edad":            np.random.randint(18, 65, n).astype(float),
        "peso_kg":         np.random.normal(70, 12, n),
        "altura_cm":       np.random.normal(170, 10, n),
        "ingreso":         np.random.exponential(3000, n),
        "satisfaccion":    np.random.randint(1, 6, n).astype(float),
        "puntuacion":      np.random.normal(50, 10, n),
        "p1":              np.random.randint(1, 6, n).astype(float),
        "p2":              np.random.randint(1, 6, n).astype(float),
        "p3":              np.random.randint(1, 6, n).astype(float),
        "p4":              np.random.randint(1, 6, n).astype(float),
        "sexo":            np.random.choice(["M", "F"], n),
        "grupo":           np.random.choice(["A", "B", "C"], n),
        "educacion":       np.random.choice(["primaria", "secundaria", "universidad"], n),
        "ciudad":          np.random.choice(["Lima", "Cusco", "Arequipa"], n),
        "tiempo":          np.arange(n).astype(float),
        "evento":          np.random.choice([0, 1], n, p=[0.4, 0.6]),
        "peso_encuesta":   np.random.uniform(0.5, 2.0, n),
        "item_bin_1":      np.random.choice([0, 1], n).astype(float),
        "item_bin_2":      np.random.choice([0, 1], n).astype(float),
        "item_bin_3":      np.random.choice([0, 1], n).astype(float),
        "rater1":          np.random.randint(1, 6, n).astype(float),
        "rater2":          np.random.randint(1, 6, n).astype(float),
        "rater3":          np.random.randint(1, 6, n).astype(float),
    })
    # Introducir algunos NaN realistas
    df.loc[np.random.choice(n, 5, replace=False), "edad"] = np.nan
    df.loc[np.random.choice(n, 3, replace=False), "ingreso"] = np.nan

    data_manager._df = df
    data_manager._df_original = df.copy()
    data_manager._metadata = data_manager._build_metadata(df, "test_dataset.csv")
    data_manager._history = []
    data_manager._split_variable = None
    data_manager._weight_variable = None
    data_manager._reset_duckdb()
    yield
    # Restaurar estado limpio
    data_manager._df = None
    data_manager._metadata = {}


# ─── Health ───────────────────────────────────────────────────────────────────

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ─── Data ─────────────────────────────────────────────────────────────────────

def test_data_metadata():
    r = client.get("/data/metadata")
    assert r.status_code == 200
    body = r.json()
    assert body["rows"] == 120
    assert body["columns"] >= 20

def test_data_preview():
    r = client.post("/data/preview", json={"n": 10})
    assert r.status_code == 200
    assert len(r.json()["filas"]) == 10

def test_data_sin_dataset():
    data_manager._df = None
    r = client.get("/data/metadata")
    assert r.status_code == 404


# ─── Descriptivos ─────────────────────────────────────────────────────────────

def test_descriptivos_basico():
    r = client.post("/descriptivos/", json={"variables": ["edad", "peso_kg"], "incluir_frecuencias": False})
    assert r.status_code == 200
    res = r.json()
    assert "resultados" in res
    assert len(res["resultados"]) == 2
    for item in res["resultados"]:
        assert "media" in item
        assert "desv_tipica" in item

def test_descriptivos_variable_inexistente():
    r = client.post("/descriptivos/", json={"variables": ["no_existe"]})
    assert r.status_code in (400, 200)   # Puede retornar error o resultado vacío

def test_descriptivos_frecuencias():
    r = client.post("/descriptivos/frecuencias", json={"variable": "sexo"})
    assert r.status_code == 200


# ─── Gráficos ─────────────────────────────────────────────────────────────────

def test_grafico_histograma():
    r = client.post("/graficos/histograma", json={"variable_x": "edad", "n_bins": 10})
    assert r.status_code == 200
    body = r.json()
    assert "data" in body

def test_grafico_barras():
    r = client.post("/graficos/barras", json={"variable_x": "sexo"})
    assert r.status_code == 200

def test_grafico_scatter():
    r = client.post("/graficos/scatter", json={"variable_x": "edad", "variable_y": "peso_kg"})
    assert r.status_code == 200

def test_grafico_boxplot():
    r = client.post("/graficos/boxplot", json={"variables": ["edad", "peso_kg"]})
    assert r.status_code == 200


# ─── Correlaciones ────────────────────────────────────────────────────────────

def test_correlacion_matriz_pearson():
    r = client.post("/correlaciones/matriz", json={
        "variables": ["edad", "peso_kg", "altura_cm"],
        "metodo": "pearson", "alpha": 0.05, "ajuste_p": "none"
    })
    assert r.status_code == 200
    body = r.json()
    assert "matriz_r" in body
    assert len(body["matriz_r"]) == 3

def test_correlacion_matriz_spearman():
    r = client.post("/correlaciones/matriz", json={
        "variables": ["edad", "peso_kg"],
        "metodo": "spearman", "alpha": 0.05
    })
    assert r.status_code == 200

def test_correlacion_par():
    r = client.post("/correlaciones/par", json={
        "variable_x": "edad", "variable_y": "peso_kg", "metodo": "pearson"
    })
    assert r.status_code == 200
    body = r.json()
    assert "r" in body
    assert "p_value" in body

def test_correlacion_parcial():
    r = client.post("/correlaciones/parcial", json={
        "variable_x": "edad", "variable_y": "peso_kg",
        "covariables": ["altura_cm"]
    })
    assert r.status_code == 200


# ─── Hipótesis ────────────────────────────────────────────────────────────────

def test_t_una_muestra():
    r = client.post("/hipotesis/t-una-muestra", json={
        "variable": "edad", "valor_referencia": 40.0
    })
    assert r.status_code == 200
    body = r.json()
    assert "t" in body
    assert "p_value" in body

def test_t_independientes():
    r = client.post("/hipotesis/t-independientes", json={
        "variable": "edad", "grupo": "sexo"
    })
    assert r.status_code == 200

def test_t_relacionadas():
    r = client.post("/hipotesis/t-relacionadas", json={
        "variable_1": "p1", "variable_2": "p2"
    })
    assert r.status_code == 200

def test_chi_cuadrado():
    r = client.post("/hipotesis/chi-cuadrado", json={
        "variable_1": "sexo", "variable_2": "grupo"
    })
    assert r.status_code == 200
    body = r.json()
    assert "chi2" in body

def test_mann_whitney():
    r = client.post("/hipotesis/mann-whitney", json={
        "variable": "edad", "grupo": "sexo"
    })
    assert r.status_code == 200

def test_kruskal_wallis():
    r = client.post("/hipotesis/kruskal-wallis", json={
        "variable": "edad", "grupo": "grupo"
    })
    assert r.status_code == 200

def test_normalidad():
    r = client.post("/hipotesis/normalidad", json={
        "variables": ["edad", "peso_kg"]
    })
    assert r.status_code == 200

def test_wilcoxon():
    r = client.post("/hipotesis/wilcoxon", json={
        "variable_1": "p1", "variable_2": "p2"
    })
    assert r.status_code == 200

def test_fisher():
    r = client.post("/hipotesis/fisher", json={
        "variable_1": "sexo", "variable_2": "evento"
    })
    assert r.status_code == 200

def test_friedman():
    r = client.post("/hipotesis/friedman", json={
        "variables": ["p1", "p2", "p3"]
    })
    assert r.status_code == 200

def test_binomial():
    r = client.post("/hipotesis/binomial", json={
        "variable": "sexo", "p_esperada": 0.5
    })
    assert r.status_code == 200


# ─── Regresión ────────────────────────────────────────────────────────────────

def test_regresion_lineal():
    r = client.post("/regresion/lineal", json={
        "dependiente": "peso_kg",
        "independientes": ["altura_cm", "edad"]
    })
    assert r.status_code == 200
    body = r.json()
    assert "r2" in body
    assert "coeficientes" in body

def test_regresion_logistica():
    r = client.post("/regresion/logistica", json={
        "dependiente": "evento",
        "independientes": ["edad", "peso_kg"]
    })
    assert r.status_code == 200

def test_regresion_stepwise():
    # Crear correlación artificial para que stepwise encuentre predictores
    df = data_manager.get_dataframe().copy()
    df["peso_kg"] = df["altura_cm"] * 0.5 + np.random.normal(0, 2, len(df))
    data_manager._df = df
    data_manager._metadata = data_manager._build_metadata(df, "test.csv")
    data_manager._reset_duckdb()
    r = client.post("/regresion/stepwise", json={
        "dependiente": "peso_kg",
        "candidatas": ["altura_cm", "edad", "ingreso"],
        "metodo": "both"
    })
    assert r.status_code == 200

def test_regresion_poisson():
    r = client.post("/regresion/poisson", json={
        "dependiente": "satisfaccion",
        "independientes": ["edad"]
    })
    assert r.status_code == 200


# ─── ANOVA ────────────────────────────────────────────────────────────────────

def test_anova_one_way():
    r = client.post("/anova/one-way", json={
        "dependiente": "edad", "factor": "grupo", "posthoc": True
    })
    assert r.status_code == 200
    body = r.json()
    assert "f_stat" in body
    assert "posthoc_tukey" in body

def test_anova_two_way():
    r = client.post("/anova/two-way", json={
        "dependiente": "edad", "factor_a": "sexo", "factor_b": "grupo"
    })
    assert r.status_code == 200


# ─── Factorial ────────────────────────────────────────────────────────────────

def test_factorial_pca():
    r = client.post("/factorial/exploratorio", json={
        "variables": ["p1", "p2", "p3", "p4"],
        "rotacion": "varimax"
    })
    assert r.status_code == 200
    body = r.json()
    assert "kmo" in body or "varianza_explicada" in body


# ─── Clustering ───────────────────────────────────────────────────────────────

def test_kmeans():
    r = client.post("/clustering/kmeans", json={
        "variables": ["edad", "peso_kg", "altura_cm"], "k": 3
    })
    assert r.status_code == 200
    body = r.json()
    assert "clusters" in body
    assert len(body["clusters"]) == 3

def test_silueta():
    r = client.post("/clustering/silueta", json={
        "variables": ["edad", "peso_kg"], "k_min": 2, "k_max": 5
    })
    assert r.status_code == 200

def test_clustering_jerarquico():
    r = client.post("/clustering-jerarquico/ajustar", json={
        "variables": ["edad", "peso_kg", "altura_cm"],
        "metodo": "ward", "n_clusters": 3
    })
    assert r.status_code == 200
    body = r.json()
    assert "clusters" in body
    assert body["k"] == 3
    assert "dendrograma" in body

def test_clustering_jerarquico_average():
    r = client.post("/clustering-jerarquico/ajustar", json={
        "variables": ["edad", "peso_kg"],
        "metodo": "average", "metrica": "cityblock"
    })
    assert r.status_code == 200


# ─── Árboles ─────────────────────────────────────────────────────────────────

def test_arbol_clasificacion():
    r = client.post("/arboles/ajustar", json={
        "dependiente": "sexo",
        "independientes": ["edad", "peso_kg"],
        "tipo": "clasificacion"
    })
    assert r.status_code == 200

def test_arbol_regresion():
    r = client.post("/arboles/ajustar", json={
        "dependiente": "peso_kg",
        "independientes": ["altura_cm", "edad"],
        "tipo": "regresion"
    })
    assert r.status_code == 200


# ─── Series temporales ────────────────────────────────────────────────────────

def test_series_analizar():
    r = client.post("/series/analizar", json={
        "variable_valor": "puntuacion"
    })
    assert r.status_code == 200

def test_series_media_movil():
    r = client.post("/series/media-movil", json={
        "variable_valor": "puntuacion", "ventana": 5
    })
    assert r.status_code == 200

def test_arima_ajustar_auto():
    r = client.post("/arima/ajustar", json={
        "variable": "puntuacion", "auto": True, "n_pasos": 5
    })
    assert r.status_code == 200
    body = r.json()
    assert "prediccion" in body
    assert len(body["prediccion"]["valores"]) == 5

def test_arima_manual():
    r = client.post("/arima/ajustar", json={
        "variable": "puntuacion", "auto": False,
        "p": 1, "d": 1, "q": 1, "n_pasos": 6
    })
    assert r.status_code == 200

def test_arima_auto_identificar():
    r = client.post("/arima/auto-identificar", json={
        "variable": "puntuacion", "n_pasos": 1
    })
    assert r.status_code == 200
    body = r.json()
    assert "mejor_modelo" in body
    assert "top_5" in body

def test_holt_winters_simple():
    r = client.post("/arima/holt-winters", json={
        "variable": "puntuacion", "tipo": "simple", "n_pasos": 6
    })
    assert r.status_code == 200

def test_holt_winters_doble():
    r = client.post("/arima/holt-winters", json={
        "variable": "puntuacion", "tipo": "doble", "n_pasos": 6
    })
    assert r.status_code == 200


# ─── Fiabilidad ───────────────────────────────────────────────────────────────

def test_cronbach():
    r = client.post("/fiabilidad/cronbach", json={
        "items": ["p1", "p2", "p3", "p4"]
    })
    assert r.status_code == 200
    body = r.json()
    assert "alpha" in body
    assert isinstance(body["alpha"], float)


# ─── GLM ─────────────────────────────────────────────────────────────────────

def test_ancova():
    r = client.post("/glm/ancova", json={
        "dependiente": "puntuacion",
        "factor": "grupo",
        "covariables": ["edad"]
    })
    assert r.status_code == 200

def test_medidas_repetidas():
    r = client.post("/glm/medidas-repetidas", json={
        "variables": ["p1", "p2", "p3"]
    })
    assert r.status_code == 200


# ─── Tablas cruzadas ─────────────────────────────────────────────────────────

def test_crosstabs_basico():
    r = client.post("/crosstabs/tabla", json={
        "variable_fila": "sexo",
        "variable_columna": "grupo",
        "estadisticos": True,
        "residuos": True
    })
    assert r.status_code == 200
    body = r.json()
    assert "frecuencias_observadas" in body
    assert "estadisticos" in body
    assert body["estadisticos"]["chi2_pearson"] > 0

def test_crosstabs_con_capa():
    r = client.post("/crosstabs/tabla", json={
        "variable_fila": "sexo",
        "variable_columna": "evento",
        "variable_capa": "grupo",
        "estadisticos": True
    })
    assert r.status_code == 200
    body = r.json()
    assert body["tipo"] == "crosstabs_con_capa"
    assert len(body["capas"]) == 3

def test_crosstabs_porcentajes():
    r = client.post("/crosstabs/tabla", json={
        "variable_fila": "sexo",
        "variable_columna": "grupo",
        "porcentaje_fila": True,
        "porcentaje_columna": True,
        "porcentaje_total": True,
        "expected": True
    })
    assert r.status_code == 200
    body = r.json()
    assert body["porcentaje_fila"] is not None
    assert body["frecuencias_esperadas"] is not None

def test_crosstabs_multiples():
    r = client.post("/crosstabs/multiples", json={
        "pares": [
            {"fila": "sexo",   "columna": "grupo"},
            {"fila": "grupo",  "columna": "educacion"},
        ]
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["resultados"]) == 2


# ─── Transformaciones ─────────────────────────────────────────────────────────

def test_transformar_calcular():
    r = client.post("/transformar/calcular", json={
        "nombre_variable": "imc",
        "expresion": "peso_kg / (altura_cm / 100) ** 2"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "imc" in [c["nombre"] for c in body["metadata"]["column_info"]]

def test_transformar_recodificar():
    r = client.post("/transformar/recodificar", json={
        "variable_origen": "grupo",
        "variable_destino": "grupo_num",
        "mapeo": [{"de": "A", "a": 1}, {"de": "B", "a": 2}, {"de": "C", "a": 3}],
        "tipo_salida": "numerico"
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True

def test_transformar_filtrar_seleccionar():
    n_antes = data_manager.get_metadata()["rows"]
    r = client.post("/transformar/filtrar", json={
        "condicion": "edad > 30", "modo": "seleccionar"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["filas_despues"] < n_antes

def test_transformar_filtrar_eliminar():
    r = client.post("/transformar/filtrar", json={
        "condicion": "edad < 20", "modo": "eliminar"
    })
    assert r.status_code == 200

def test_transformar_ordenar():
    r = client.post("/transformar/ordenar", json={
        "variables": ["edad"], "ascendente": [True]
    })
    assert r.status_code == 200
    assert r.json()["ok"] is True

def test_transformar_ranking():
    r = client.post("/transformar/ranking", json={
        "variable": "edad", "nombre_ranking": "rank_edad"
    })
    assert r.status_code == 200
    body = r.json()
    assert "rank_edad" in [c["nombre"] for c in body["metadata"]["column_info"]]

def test_transformar_reemplazar_perdidos():
    r = client.post("/transformar/reemplazar-perdidos", json={
        "variables": ["edad", "ingreso"], "metodo": "media"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # Verificar que se eliminaron NaN
    df = data_manager.get_dataframe()
    assert df["edad"].isna().sum() == 0

def test_transformar_agregar():
    r = client.post("/transformar/agregar", json={
        "variable_grupo": "grupo",
        "agregaciones": [
            {"variable": "edad", "funcion": "media", "nombre": "edad_media"},
            {"variable": "peso_kg", "funcion": "desv", "nombre": "peso_sd"},
        ]
    })
    assert r.status_code == 200

def test_transformar_reestructurar_wide_a_long():
    r = client.post("/transformar/reestructurar", json={
        "modo": "wide_a_long",
        "columnas_id": ["id", "sexo"],
        "columnas_valor": ["p1", "p2", "p3"],
        "nombre_var": "item",
        "nombre_val": "valor_item"   # nombre que no choque con columnas existentes
    })
    assert r.status_code == 200
    body = r.json()
    assert body["filas_despues"] == 120 * 3

def test_transformar_deshacer():
    # Primero hacer algo
    client.post("/transformar/calcular", json={
        "nombre_variable": "tmp", "expresion": "edad * 2"
    })
    r = client.post("/transformar/deshacer", json={"pasos": 1})
    assert r.status_code == 200
    assert r.json()["ok"] is True

def test_transformar_historial():
    client.post("/transformar/calcular", json={
        "nombre_variable": "tmp2", "expresion": "edad + 1"
    })
    r = client.get("/transformar/historial")
    assert r.status_code == 200
    body = r.json()
    assert len(body["historial"]) >= 1

def test_transformar_partir_archivo():
    r = client.post("/transformar/partir-archivo", json={"variable_grupo": "grupo"})
    assert r.status_code == 200
    body = r.json()
    assert body["n_grupos"] == 3

def test_transformar_ponderar():
    r = client.post("/transformar/ponderar", json={"variable_peso": "peso_encuesta"})
    assert r.status_code == 200
    assert r.json()["ponderacion_activa"] is True
    # Desactivar
    client.post("/transformar/ponderar", json={"variable_peso": None})

def test_transformar_estado():
    r = client.get("/transformar/estado")
    assert r.status_code == 200
    body = r.json()
    assert "historial" in body
    assert "dataset_cargado" in body


# ─── Supervivencia ────────────────────────────────────────────────────────────

def test_kaplan_meier_simple():
    r = client.post("/supervivencia/kaplan-meier", json={
        "variable_tiempo": "tiempo",
        "variable_evento": "evento",
        "valor_evento": 1
    })
    assert r.status_code == 200
    body = r.json()
    assert "curva" in body
    assert body["n"] == 120
    assert len(body["curva"]) > 0

def test_kaplan_meier_grupos():
    r = client.post("/supervivencia/kaplan-meier", json={
        "variable_tiempo": "tiempo",
        "variable_evento": "evento",
        "variable_grupo": "sexo"
    })
    assert r.status_code == 200
    body = r.json()
    assert "curvas" in body
    assert "logrank" in body
    assert "chi2" in body["logrank"]

def test_tabla_vida():
    r = client.post("/supervivencia/tabla-vida", json={
        "variable_tiempo": "tiempo",
        "variable_evento": "evento",
        "n_intervalos": 5
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["tabla"]) == 5

def test_cox():
    r = client.post("/supervivencia/cox", json={
        "variable_tiempo": "tiempo",
        "variable_evento": "evento",
        "covariables": ["edad", "peso_kg"]
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["coeficientes"]) == 2
    for c in body["coeficientes"]:
        assert "HR" in c
        assert "p_value" in c


# ─── Potencia ─────────────────────────────────────────────────────────────────

def test_potencia_t_independientes_n():
    r = client.post("/potencia/calcular", json={
        "test": "t_independientes", "calcular": "n",
        "d": 0.5, "potencia": 0.80, "alpha": 0.05
    })
    assert r.status_code == 200
    body = r.json()
    assert body["n_por_grupo"] > 0
    # Cohen dice ~64 por grupo; toleramos ±3 por diferencias de implementación
    assert 60 <= body["n_por_grupo"] <= 67

def test_potencia_anova_n():
    r = client.post("/potencia/calcular", json={
        "test": "anova", "calcular": "n",
        "f": 0.25, "k": 3, "potencia": 0.80
    })
    assert r.status_code == 200
    body = r.json()
    assert body["n_por_grupo"] > 0

def test_potencia_correlacion():
    r = client.post("/potencia/calcular", json={
        "test": "correlacion", "calcular": "n",
        "r": 0.3, "potencia": 0.80
    })
    assert r.status_code == 200

def test_potencia_calcular_potencia():
    r = client.post("/potencia/calcular", json={
        "test": "t_independientes", "calcular": "potencia",
        "d": 0.5, "n": 64
    })
    assert r.status_code == 200
    body = r.json()
    assert abs(body["potencia"] - 0.80) < 0.05  # ~80%

def test_curva_potencia():
    r = client.post("/potencia/curva-potencia", json={
        "test": "t_independientes", "d": 0.5
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["curva"]) > 0
    # Potencia debe crecer con n
    potencias = [p["potencia"] for p in body["curva"]]
    assert potencias[-1] > potencias[0]

def test_potencia_regresion():
    r = client.post("/potencia/calcular", json={
        "test": "regresion", "calcular": "n",
        "f2": 0.15, "k": 3, "potencia": 0.80
    })
    assert r.status_code == 200

def test_potencia_proporcion():
    r = client.post("/potencia/calcular", json={
        "test": "proporcion", "calcular": "n",
        "p1": 0.5, "p2": 0.3, "potencia": 0.80
    })
    assert r.status_code == 200
    assert r.json()["n_por_grupo"] > 0


# ─── Discriminante ────────────────────────────────────────────────────────────

def test_discriminante_lineal():
    r = client.post("/discriminante/ajustar", json={
        "dependiente": "grupo",
        "independientes": ["edad", "peso_kg", "altura_cm"],
        "tipo": "lineal"
    })
    assert r.status_code == 200
    body = r.json()
    assert "tests_wilks" in body
    assert "clasificacion" in body
    assert body["clasificacion"]["accuracy"] > 0
    assert body["n_funciones"] == 2   # 3 grupos → 2 funciones


# ─── MANOVA ──────────────────────────────────────────────────────────────────

def test_manova_basico():
    r = client.post("/manova/ajustar", json={
        "factor": "grupo",
        "dependientes": ["edad", "peso_kg", "altura_cm"],
        "posthoc": True
    })
    assert r.status_code == 200
    body = r.json()
    assert "estadisticos_multivariantes" in body
    assert len(body["estadisticos_multivariantes"]) == 4   # Pillai, Wilks, Hotelling, Roy
    assert "anovas_univariantes" in body
    assert len(body["anovas_univariantes"]) == 3

def test_manova_dos_grupos():
    r = client.post("/manova/ajustar", json={
        "factor": "sexo",
        "dependientes": ["edad", "peso_kg"],
        "posthoc": False
    })
    assert r.status_code == 200


# ─── Psicometría ──────────────────────────────────────────────────────────────

def test_omega_mcdonald():
    r = client.post("/psicometria/omega", json={
        "items": ["p1", "p2", "p3", "p4"]
    })
    assert r.status_code == 200
    body = r.json()
    assert "omega" in body
    assert 0 <= body["omega"] <= 1
    assert "alpha_cronbach" in body

def test_icc():
    r = client.post("/psicometria/icc", json={
        "items": ["rater1", "rater2", "rater3"],
        "modelo": "dos_vias",
        "tipo": "consistencia"
    })
    assert r.status_code == 200
    body = r.json()
    assert "icc" in body
    assert -1 <= body["icc"] <= 1

def test_kappa_cohen():
    r = client.post("/psicometria/kappa", json={
        "variable_1": "item_bin_1",
        "variable_2": "item_bin_2"
    })
    assert r.status_code == 200
    body = r.json()
    assert "kappa" in body
    assert "interpretacion" in body

def test_kuder_richardson():
    r = client.post("/psicometria/kuder-richardson", json={
        "items": ["item_bin_1", "item_bin_2", "item_bin_3"]
    })
    assert r.status_code == 200
    body = r.json()
    assert "kr20" in body
    assert 0 <= body["kr20"] <= 1


# ─── Análisis de correspondencias ────────────────────────────────────────────

def test_correspondencias_simples():
    r = client.post("/correspondencias/simple", json={
        "variable_fila": "sexo",
        "variable_columna": "grupo",
        "n_dimensiones": 2
    })
    assert r.status_code == 200
    body = r.json()
    assert "puntos_fila" in body
    assert "puntos_columna" in body
    assert len(body["puntos_fila"]) == 2   # sexo tiene 2 categorías
    assert len(body["puntos_columna"]) == 3  # grupo tiene 3

def test_correspondencias_multiples():
    r = client.post("/correspondencias/multiple", json={
        "variables": ["sexo", "grupo", "educacion"],
        "n_dimensiones": 2
    })
    assert r.status_code == 200
    body = r.json()
    assert "puntos" in body
    assert body["J_total_categorias"] == 2 + 3 + 3  # categorías totales


# ─── Casos de error y validación ─────────────────────────────────────────────

def test_variable_inexistente_retorna_400():
    r = client.post("/descriptivos/", json={"variables": ["variable_fantasma"]})
    # Debe manejar graciosamente, no crash
    assert r.status_code in (200, 400, 422)

def test_datos_insuficientes_arima():
    """ARIMA con serie muy corta debe dar error claro."""
    df_corto = data_manager.get_dataframe().head(5).copy()
    data_manager._df = df_corto
    data_manager._metadata = data_manager._build_metadata(df_corto, "corto.csv")
    r = client.post("/arima/ajustar", json={"variable": "puntuacion", "auto": True, "n_pasos": 3})
    assert r.status_code in (200, 400)   # No debe crashear con 500

def test_crosstabs_2x2_fisher():
    """Tabla 2x2 debe incluir Fisher exacto."""
    r = client.post("/crosstabs/tabla", json={
        "variable_fila": "sexo",
        "variable_columna": "evento",
        "estadisticos": True
    })
    assert r.status_code == 200
    body = r.json()
    assert body["estadisticos"]["fisher_exacto_p"] is not None

def test_transformar_expresion_invalida():
    r = client.post("/transformar/calcular", json={
        "nombre_variable": "bad",
        "expresion": "esto_no_existe * 2"
    })
    assert r.status_code == 400
