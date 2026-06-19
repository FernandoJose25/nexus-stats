"""
Genera los datos estructurados para Plotly.js en el frontend.
No devuelve imágenes: devuelve data + layout para que Plotly renderice en React.
"""
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import data_manager

router = APIRouter()


class GraficoBase(BaseModel):
    variable_x: str
    titulo: str = ""
    color: str = "#3B82F6"


class ScatterRequest(BaseModel):
    variable_x: str
    variable_y: str
    titulo: str = ""


class HistogramaRequest(GraficoBase):
    n_bins: int = 0  # 0 = automático


class BoxplotRequest(BaseModel):
    variables: list[str]
    titulo: str = ""
    normalizar: bool = False
    horizontal: bool = False
    color: str = "#3B82F6"  # usado solo cuando hay 1 variable


def _get_col(df, var):
    if var not in df.columns:
        raise HTTPException(400, detail=f"Variable '{var}' no encontrada")
    return df[var].dropna()


@router.post("/barras")
def grafico_barras(req: GraficoBase):
    """Gráfico de barras para variables categóricas o numéricas discretas."""
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x)

    n_unicos = col.nunique()
    # Si hay más de 30 valores únicos, agrupa los menos frecuentes en "Otros"
    conteos = col.value_counts().sort_index()
    advertencia = None
    if n_unicos > 30:
        top = conteos.nlargest(30)
        otros = conteos.iloc[30:].sum()
        if otros > 0:
            top["Otros"] = otros
        conteos = top
        advertencia = f"Se muestran los 30 valores más frecuentes de {n_unicos} únicos"

    trace = {
        "type": "bar",
        "x": [str(v) for v in conteos.index.tolist()],
        "y": conteos.values.tolist(),
        "name": req.variable_x,
        "marker": {"color": req.color},
        "hovertemplate": "<b>%{x}</b><br>Frecuencia: %{y}<extra></extra>",
    }
    titulo = req.titulo or f"Frecuencias de {req.variable_x}"
    if advertencia:
        titulo += f" ({advertencia})"

    layout = _base_layout(titulo)
    layout["xaxis"]["title"] = req.variable_x
    layout["yaxis"]["title"] = "Frecuencia"
    layout["showlegend"] = False
    if n_unicos > 15:
        layout["xaxis"]["tickangle"] = -45

    return {"data": [trace], "layout": layout}


@router.post("/histograma")
def grafico_histograma(req: HistogramaRequest):
    """Histograma con curva de densidad normal superpuesta."""
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x)

    trace_hist = {
        "type": "histogram",
        "x": col.tolist(),
        "nbinsx": req.n_bins if req.n_bins > 0 else None,
        "marker": {"color": req.color, "opacity": 0.75},
        "name": "Frecuencia",
        "hovertemplate": "Intervalo: %{x}<br>Frecuencia: %{y}<extra></extra>",
        "histnorm": "",
    }

    # Curva normal teórica
    mu, sigma = float(col.mean()), float(col.std())
    x_norm = np.linspace(float(col.min()), float(col.max()), 200)
    from scipy.stats import norm
    y_norm = norm.pdf(x_norm, mu, sigma)

    # Escalar la curva al conteo real (no normalizada)
    bin_width = (float(col.max()) - float(col.min())) / (req.n_bins if req.n_bins > 0 else 20)
    y_norm_scaled = y_norm * len(col) * bin_width

    trace_normal = {
        "type": "scatter",
        "x": x_norm.tolist(),
        "y": y_norm_scaled.tolist(),
        "mode": "lines",
        "line": {"color": "#EF4444", "width": 2, "dash": "dash"},
        "name": "Dist. normal",
        "hoverinfo": "skip",
    }

    layout = _base_layout(req.titulo or f"Histograma de {req.variable_x}")
    layout["xaxis"]["title"] = req.variable_x
    layout["yaxis"]["title"] = "Frecuencia"
    layout["bargap"] = 0.05
    layout["showlegend"] = True  # Mantener para mostrar "Dist. normal"

    return {"data": [trace_hist, trace_normal], "layout": layout}


@router.post("/scatter")
def grafico_scatter(req: ScatterRequest):
    """Gráfico de dispersión con línea de regresión."""
    if req.variable_x == req.variable_y:
        raise HTTPException(400, detail="Las variables X e Y deben ser distintas")
    df = data_manager.get_dataframe()
    col_x = _get_col(df, req.variable_x)
    col_y = _get_col(df, req.variable_y)

    # Alinear por índice
    combined = pd.DataFrame({"x": df[req.variable_x], "y": df[req.variable_y]}).dropna()

    trace = {
        "type": "scatter",
        "x": combined["x"].tolist(),
        "y": combined["y"].tolist(),
        "mode": "markers",
        "marker": {"color": "#3B82F6", "size": 6, "opacity": 0.7},
        "name": "Observaciones",
        "hovertemplate": f"{req.variable_x}: %{{x}}<br>{req.variable_y}: %{{y}}<extra></extra>",
    }

    # Línea de regresión
    from scipy.stats import linregress
    if len(combined) >= 2:
        slope, intercept, r, p, _ = linregress(combined["x"], combined["y"])
        x_line = [float(combined["x"].min()), float(combined["x"].max())]
        y_line = [slope * x + intercept for x in x_line]
        trace_reg = {
            "type": "scatter",
            "x": x_line,
            "y": y_line,
            "mode": "lines",
            "line": {"color": "#EF4444", "width": 2},
            "name": f"Regresión (r={r:.3f})",
            "hoverinfo": "skip",
        }
        data = [trace, trace_reg]
    else:
        data = [trace]

    layout = _base_layout(req.titulo or f"{req.variable_x} vs {req.variable_y}")
    layout["xaxis"]["title"] = req.variable_x
    layout["yaxis"]["title"] = req.variable_y

    return {"data": data, "layout": layout}


@router.post("/boxplot")
def grafico_boxplot(req: BoxplotRequest):
    """Boxplot comparativo. Normaliza automáticamente si las escalas difieren mucho."""
    if len(req.variables) == 0:
        raise HTTPException(400, detail="Selecciona al menos una variable")
    if len(req.variables) > 8:
        raise HTTPException(400, detail="Máximo 8 variables por boxplot")

    df = data_manager.get_dataframe()
    for var in req.variables:
        if var not in df.columns:
            raise HTTPException(400, detail=f"Variable '{var}' no encontrada")

    # Detectar escalas muy distintas (ratio > 10 entre el rango mayor y el menor)
    rangos = []
    for var in req.variables:
        col = df[var].dropna()
        r = float(col.max() - col.min())
        rangos.append(r if r > 0 else 1)
    escala_mixta = len(rangos) > 1 and (max(rangos) / min(rangos)) > 10
    normalizar = req.normalizar or escala_mixta

    colors = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#F97316"]
    una_sola = len(req.variables) == 1
    data = []
    for i, var in enumerate(req.variables):
        col = df[var].dropna()
        if normalizar:
            mu, sigma = float(col.mean()), float(col.std())
            valores = ((col - mu) / sigma).tolist() if sigma > 0 else col.tolist()
        else:
            valores = col.tolist()
        color_box = req.color if una_sola else colors[i % len(colors)]
        trace = {
            "type": "box",
            "name": var,
            "marker": {"color": color_box},
            "boxmean": "sd",
        }
        if req.horizontal:
            trace["x"] = valores
            trace["hovertemplate"] = f"{var}: %{{x:.2f}}<extra></extra>"
        else:
            trace["y"] = valores
            trace["hovertemplate"] = f"{var}: %{{y:.2f}}<extra></extra>"
        data.append(trace)

    nota = " — escalas normalizadas (Z)" if escala_mixta else ""
    layout = _base_layout(req.titulo or f"Diagrama de caja{nota}")
    eje_label = "Puntuación Z" if normalizar else "Valor"
    if req.horizontal:
        layout["xaxis"]["title"] = eje_label
        layout["yaxis"]["title"] = ""
    else:
        layout["yaxis"]["title"] = eje_label
    layout["showlegend"] = not una_sola

    # Boxplot angosto cuando es una sola serie (ancho 25% del área disponible)
    if una_sola:
        layout["xaxis"]["range"] = [-1, 1] if not req.horizontal else None
        layout["yaxis"]["range"] = [-1, 1] if req.horizontal else None

    return {"data": data, "layout": layout, "normalizado": normalizar}


class LineasRequest(BaseModel):
    variable_x: str
    variable_y: str = ""  # Si se especifica, se usa como eje X
    titulo: str = ""
    color: str = "#3B82F6"


@router.post("/lineas")
def grafico_lineas(req: LineasRequest):
    """Gráfico de líneas. Si se especifica variable_y, variable_x va al eje X."""
    df = data_manager.get_dataframe()

    if req.variable_y and req.variable_y in df.columns:
        # Modo XY: variable_x en eje X, variable_y en eje Y, ordenado por X
        combined = pd.DataFrame({
            "x": df[req.variable_x],
            "y": df[req.variable_y],
        }).dropna().sort_values("x")
        x_vals = combined["x"].tolist()
        y_vals = combined["y"].tolist()
        x_title = req.variable_x
        y_title = req.variable_y
        titulo = req.titulo or f"{req.variable_y} por {req.variable_x}"
        hover = f"{req.variable_x}: %{{x}}<br>{req.variable_y}: %{{y}}<extra></extra>"
    else:
        # Modo serie: índice en eje X, variable en eje Y
        col = _get_col(df, req.variable_x)
        x_vals = list(range(1, len(col) + 1))
        y_vals = col.tolist()
        x_title = "Observación"
        y_title = req.variable_x
        titulo = req.titulo or f"Serie de {req.variable_x}"
        hover = f"Obs %{{x}}: %{{y}}<extra></extra>"

    trace = {
        "type": "scatter",
        "x": x_vals,
        "y": y_vals,
        "mode": "lines+markers",
        "line": {"color": req.color, "width": 2},
        "marker": {"size": 4},
        "name": req.variable_x,
        "hovertemplate": hover,
    }

    layout = _base_layout(titulo)
    layout["xaxis"]["title"] = x_title
    layout["yaxis"]["title"] = y_title
    layout["showlegend"] = False

    return {"data": [trace], "layout": layout}


# ─── Nuevos tipos de gráficos ─────────────────────────────────────────────────

class PieRequest(BaseModel):
    variable_x: str
    titulo: str = ""
    donut: bool = False   # True → donut (hole=0.45)

class ErrorBarRequest(BaseModel):
    variable_valor: str
    variable_grupo: str = ""   # Si se especifica, barras por grupo
    titulo: str = ""
    tipo_error: str = "ic95"   # ic95 | se | sd

class QQRequest(BaseModel):
    variable_x: str
    distribucion: str = "normal"  # normal | uniform | exponential
    titulo: str = ""

class StemLeafRequest(BaseModel):
    variable_x: str
    escala: int = 1   # 1, 2, 5

class ScatterMatrixRequest(BaseModel):
    variables: list[str]
    color_variable: str = ""
    titulo: str = ""

class ViolinRequest(BaseModel):
    variable_valor: str
    variable_grupo: str = ""
    titulo: str = ""
    color: str = "#3B82F6"


@router.post("/pie")
def grafico_pie(req: PieRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x)
    conteos = col.value_counts()

    trace = {
        "type": "pie",
        "labels": [str(v) for v in conteos.index.tolist()],
        "values": conteos.values.tolist(),
        "hole": 0.45 if req.donut else 0,
        "textinfo": "label+percent",
        "hovertemplate": "<b>%{label}</b><br>n=%{value}<br>%{percent}<extra></extra>",
        "marker": {
            "colors": ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#EC4899","#14B8A6","#F97316","#6366F1","#84CC16"],
            "line": {"color": "#0F1117", "width": 2},
        },
    }
    titulo = req.titulo or f"{'Donut' if req.donut else 'Pie'} de {req.variable_x}"
    layout = _base_layout(titulo)
    layout["showlegend"] = True
    return {"data": [trace], "layout": layout}


@router.post("/error-bars")
def grafico_error_bars(req: ErrorBarRequest):
    from scipy import stats as sp_stats
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    if req.variable_grupo and req.variable_grupo in df.columns:
        grupos = sorted(df[req.variable_grupo].dropna().unique())
        labels, medias, errores = [], [], []
        for g in grupos:
            col = df[df[req.variable_grupo] == g][req.variable_valor].dropna()
            if len(col) < 2:
                continue
            labels.append(str(g))
            medias.append(float(col.mean()))
            if req.tipo_error == "ic95":
                errores.append(float(sp_stats.sem(col) * sp_stats.t.ppf(0.975, len(col)-1)))
            elif req.tipo_error == "se":
                errores.append(float(sp_stats.sem(col)))
            else:
                errores.append(float(col.std()))
    else:
        col = _get_col(df, req.variable_valor)
        labels = [req.variable_valor]
        medias = [float(col.mean())]
        if req.tipo_error == "ic95":
            errores = [float(sp_stats.sem(col) * sp_stats.t.ppf(0.975, len(col)-1))]
        elif req.tipo_error == "se":
            errores = [float(sp_stats.sem(col))]
        else:
            errores = [float(col.std())]

    trace = {
        "type": "bar",
        "x": labels,
        "y": medias,
        "error_y": {"type": "data", "array": errores, "visible": True, "color": "#94a3b8"},
        "marker": {"color": "#3B82F6"},
        "hovertemplate": "Media: %{y:.3f}<extra></extra>",
    }
    etiqueta_error = {"ic95": "IC 95%", "se": "Error estándar", "sd": "Desv. típica"}[req.tipo_error]
    layout = _base_layout(req.titulo or f"Medias con barras de error ({etiqueta_error})")
    layout["yaxis"]["title"] = f"Media ± {etiqueta_error}"
    layout["showlegend"] = False
    return {"data": [trace], "layout": layout}


@router.post("/qq")
def grafico_qq(req: QQRequest):
    from scipy import stats as sp_stats
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x).sort_values()
    n = len(col)

    # Cuantiles teóricos
    probs = (np.arange(1, n+1) - 0.5) / n
    if req.distribucion == "normal":
        teoricos = sp_stats.norm.ppf(probs)
        dist_label = "Normal teórica"
    elif req.distribucion == "uniform":
        teoricos = sp_stats.uniform.ppf(probs)
        dist_label = "Uniforme teórica"
    else:
        teoricos = sp_stats.expon.ppf(probs)
        dist_label = "Exponencial teórica"

    obs = col.values.tolist()

    # Línea de referencia (45°)
    q25, q75 = np.percentile(obs, 25), np.percentile(obs, 75)
    t25, t75 = np.percentile(teoricos, 25), np.percentile(teoricos, 75)
    slope = (q75 - q25) / (t75 - t25) if (t75 - t25) != 0 else 1
    intercept = q25 - slope * t25
    x_ref = [float(teoricos[0]), float(teoricos[-1])]
    y_ref = [slope * x + intercept for x in x_ref]

    trace_pts = {
        "type": "scatter", "x": teoricos.tolist(), "y": obs,
        "mode": "markers", "name": "Observaciones",
        "marker": {"color": "#3B82F6", "size": 5, "opacity": 0.8},
        "hovertemplate": f"Teórico: %{{x:.3f}}<br>Observado: %{{y:.3f}}<extra></extra>",
    }
    trace_ref = {
        "type": "scatter", "x": x_ref, "y": y_ref,
        "mode": "lines", "name": "Línea de referencia",
        "line": {"color": "#EF4444", "width": 2, "dash": "dash"},
        "hoverinfo": "skip",
    }

    layout = _base_layout(req.titulo or f"Q-Q Plot de {req.variable_x}")
    layout["xaxis"]["title"] = f"Cuantiles teóricos ({dist_label})"
    layout["yaxis"]["title"] = f"Cuantiles observados ({req.variable_x})"
    return {"data": [trace_pts, trace_ref], "layout": layout}


@router.post("/pp")
def grafico_pp(req: QQRequest):
    """P-P plot: probabilidades acumuladas observadas vs teóricas."""
    from scipy import stats as sp_stats
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x).sort_values()
    n = len(col)

    mu, sigma = float(col.mean()), float(col.std())
    probs_obs = (np.arange(1, n+1) - 0.5) / n
    if sigma > 0:
        probs_teo = sp_stats.norm.cdf(col.values, mu, sigma)
    else:
        probs_teo = probs_obs

    trace = {
        "type": "scatter", "x": probs_teo.tolist(), "y": probs_obs.tolist(),
        "mode": "markers", "name": "Observaciones",
        "marker": {"color": "#8B5CF6", "size": 5, "opacity": 0.8},
        "hovertemplate": "P teórica: %{x:.3f}<br>P observada: %{y:.3f}<extra></extra>",
    }
    ref = {"type": "scatter", "x": [0,1], "y": [0,1], "mode": "lines",
           "line": {"color": "#EF4444", "width": 2, "dash": "dash"},
           "name": "Referencia", "hoverinfo": "skip"}

    layout = _base_layout(req.titulo or f"P-P Plot de {req.variable_x}")
    layout["xaxis"]["title"] = "Probabilidad acumulada teórica (Normal)"
    layout["yaxis"]["title"] = "Probabilidad acumulada observada"
    layout["xaxis"]["range"] = [0, 1]
    layout["yaxis"]["range"] = [0, 1]
    return {"data": [trace, ref], "layout": layout}


@router.post("/stem-leaf")
def grafico_stem_leaf(req: StemLeafRequest):
    """Diagrama de tallos y hojas (texto). Retorna texto para mostrar en <pre>."""
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()
    col = _get_col(df, req.variable_x)
    datos = sorted(col.dropna().values)

    escala = req.escala
    lineas = []
    stems = {}
    for v in datos:
        stem = int(v // (10 * escala))
        leaf = int(abs(v) % (10 * escala) // escala)
        stems.setdefault(stem, []).append(leaf)

    for s in sorted(stems.keys()):
        hojas = " ".join(str(h) for h in sorted(stems[s]))
        lineas.append(f"  {s:>4} | {hojas}")

    n = len(datos)
    media = float(np.mean(datos))
    mediana = float(np.median(datos))
    header = [
        f"Tallos y hojas — {req.variable_x}",
        f"N = {n}  Media = {media:.2f}  Mediana = {mediana:.2f}",
        f"Escala: 1 tallo = {10*escala} unidades",
        "-" * 40,
        "  Tallo | Hojas",
        "-" * 40,
    ]
    texto = "\n".join(header + lineas)
    return {"tipo": "stem_leaf", "variable": req.variable_x, "texto": texto,
            "n": n, "media": round(media, 4), "mediana": round(mediana, 4)}


@router.post("/scatter-matrix")
def grafico_scatter_matrix(req: ScatterMatrixRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    if len(req.variables) < 2:
        raise HTTPException(400, detail="Se necesitan al menos 2 variables")
    if len(req.variables) > 6:
        raise HTTPException(400, detail="Máximo 6 variables para scatter matrix")

    df = data_manager.get_dataframe()
    for v in req.variables:
        if v not in df.columns:
            raise HTTPException(400, detail=f"Variable '{v}' no encontrada")

    df_clean = df[req.variables].dropna()
    dims = [{"label": v, "values": df_clean[v].tolist()} for v in req.variables]

    color_vals = None
    if req.color_variable and req.color_variable in df.columns:
        color_raw = df.loc[df_clean.index, req.color_variable]
        cats = sorted(color_raw.dropna().unique())
        color_map = {c: i for i, c in enumerate(cats)}
        color_vals = [color_map.get(v, 0) for v in color_raw.fillna(cats[0])]

    trace = {
        "type": "splom",
        "dimensions": dims,
        "showupperhalf": False,
        "diagonal_visible": True,
        "marker": {
            "size": 4,
            "opacity": 0.6,
            "color": color_vals if color_vals else "#3B82F6",
            "colorscale": "Viridis" if color_vals else None,
            "showscale": False,
        },
    }
    layout = _base_layout(req.titulo or "Scatter Matrix")
    layout["height"] = 600
    layout["dragmode"] = "select"
    return {"data": [trace], "layout": layout}


@router.post("/violin")
def grafico_violin(req: ViolinRequest):
    if not data_manager.is_loaded():
        raise HTTPException(404, detail="No hay dataset cargado")
    df = data_manager.get_dataframe()

    COLORS = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#EC4899"]
    data = []
    if req.variable_grupo and req.variable_grupo in df.columns:
        grupos = sorted(df[req.variable_grupo].dropna().unique())
        for i, g in enumerate(grupos):
            col = df[df[req.variable_grupo] == g][req.variable_valor].dropna()
            data.append({
                "type": "violin", "y": col.tolist(), "name": str(g),
                "box": {"visible": True}, "meanline": {"visible": True},
                "line": {"color": COLORS[i % len(COLORS)]},
                "fillcolor": COLORS[i % len(COLORS)] + "40",
            })
    else:
        col = _get_col(df, req.variable_valor)
        fill = req.color + "40" if len(req.color) == 7 else req.color
        data.append({
            "type": "violin", "y": col.tolist(), "name": req.variable_valor,
            "box": {"visible": True}, "meanline": {"visible": True},
            "line": {"color": req.color}, "fillcolor": fill,
        })

    layout = _base_layout(req.titulo or f"Violin — {req.variable_valor}")
    layout["yaxis"]["title"] = req.variable_valor
    layout["violingap"] = 0.05
    layout["violinmode"] = "overlay" if not req.variable_grupo else "group"
    return {"data": data, "layout": layout}


def _base_layout(titulo: str) -> dict:
    return {
        "title": {"text": titulo, "font": {"family": "Inter, sans-serif", "size": 16}},
        "plot_bgcolor": "rgba(0,0,0,0)",
        "paper_bgcolor": "rgba(0,0,0,0)",
        "font": {"family": "Inter, sans-serif", "color": "#94A3B8"},
        "margin": {"l": 60, "r": 20, "t": 70, "b": 60},
        "modebar": {"orientation": "v", "bgcolor": "rgba(0,0,0,0)", "color": "#475569", "activecolor": "#3B82F6"},
        "xaxis": {
            "title": "",
            "gridcolor": "#1E293B",
            "linecolor": "#334155",
            "zerolinecolor": "#334155",
        },
        "yaxis": {
            "title": "",
            "gridcolor": "#1E293B",
            "linecolor": "#334155",
            "zerolinecolor": "#334155",
        },
        "showlegend": True,
        "legend": {"bgcolor": "rgba(0,0,0,0)"},
        "hovermode": "closest",
    }
