import requests, json, tempfile, os, csv, random

BASE = 'http://127.0.0.1:5174'
random.seed(42)
PASS = []
FAIL = []

def ok(mod, detail): PASS.append(f'  OK   {mod}: {detail}')
def fail(mod, detail): FAIL.append(f'  FAIL {mod}: {detail}')

def post(path, body):
    try:
        r = requests.post(f'{BASE}{path}', json=body, timeout=20)
        return r.status_code, r.json()
    except Exception as e:
        return 0, {'detail': str(e)}

def get(path):
    try:
        r = requests.get(f'{BASE}{path}', timeout=10)
        return r.status_code, r.json()
    except Exception as e:
        return 0, {'detail': str(e)}

# ─── Dataset de prueba ────────────────────────────────────────────────────────
print('=== CREANDO DATASET DE PRUEBA ===')
tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, newline='', encoding='utf-8')
w = csv.writer(tmp)
w.writerow(['edad','peso_kg','altura_cm','imc','grupo','sexo','satisfaccion','fecha_num','ventas'])
grupos = ['Control','TratA','TratB']
for i in range(120):
    g = grupos[i % 3]
    sexo = 'M' if i % 2 == 0 else 'F'
    edad = round(25 + random.gauss(15, 8))
    altura = round(165 + random.gauss(8, 6), 1)
    peso = round(60 + random.gauss(15, 10) + (edad - 30) * 0.2, 1)
    imc = round(peso / (altura/100)**2, 2)
    sat = random.randint(1, 5)
    fecha_num = i + 1
    ventas = round(1000 + i*50 + random.gauss(0, 200), 2)
    w.writerow([edad, peso, altura, imc, g, sexo, sat, fecha_num, ventas])
tmp.close()
ruta = tmp.name

# ─── DATA ─────────────────────────────────────────────────────────────────────
print('\n=== DATA ===')
sc, d = post('/data/cargar', {'ruta': ruta})
if sc == 200 and 'metadata' in d:
    ok('DATA/cargar', f"{d['metadata']['rows']} filas, {d['metadata']['columns']} cols")
else:
    fail('DATA/cargar', f'HTTP {sc}: {d.get("detail")}')

sc, d = get('/data/metadata')
if sc == 200: ok('DATA/metadata', 'OK')
else: fail('DATA/metadata', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/data/preview', {'n': 5})
if sc == 200: ok('DATA/preview', f"{len(d.get('filas',[]))} filas")
else: fail('DATA/preview', f'HTTP {sc}: {d.get("detail")}')

# ─── DESCRIPTIVOS ─────────────────────────────────────────────────────────────
print('\n=== DESCRIPTIVOS ===')
sc, d = post('/descriptivos/', {'variables': ['edad','peso_kg','altura_cm','imc'], 'incluir_frecuencias': False})
if sc == 200 and 'resultados' in d:
    r = d['resultados'][0]
    ok('DESCRIPTIVOS/calcular', f"media={r.get('media')}, desv={r.get('desv_tipica')}")
else:
    fail('DESCRIPTIVOS/calcular', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/descriptivos/', {'variables': ['edad','peso_kg'], 'incluir_frecuencias': True})
if sc == 200: ok('DESCRIPTIVOS/con frecuencias', 'OK')
else: fail('DESCRIPTIVOS/con frecuencias', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/descriptivos/frecuencias', {'variable': 'grupo'})
if sc == 200: ok('DESCRIPTIVOS/frecuencias categorica', f"{len(d.get('filas',[]))} categorias")
else: fail('DESCRIPTIVOS/frecuencias categorica', f'HTTP {sc}: {d.get("detail")}')

# ─── GRÁFICOS ─────────────────────────────────────────────────────────────────
print('\n=== GRAFICOS ===')
for gtype, body in [
    ('barras',     {'variable_x': 'grupo', 'titulo': 'test', 'color': '#3B82F6'}),
    ('histograma', {'variable_x': 'peso_kg', 'n_bins': 10, 'titulo': 'test'}),
    ('scatter',    {'variable_x': 'edad', 'variable_y': 'peso_kg', 'titulo': 'test'}),
    ('boxplot',    {'variables': ['peso_kg','altura_cm'], 'normalizar': False, 'titulo': 'test'}),
    ('lineas',     {'variable_x': 'fecha_num', 'variable_y': 'ventas', 'titulo': 'test'}),
]:
    sc, d = post(f'/graficos/{gtype}', body)
    if sc == 200 and 'data' in d: ok(f'GRAFICOS/{gtype}', 'data OK')
    else: fail(f'GRAFICOS/{gtype}', f'HTTP {sc}: {d.get("detail")}')

# ─── CORRELACIONES ────────────────────────────────────────────────────────────
print('\n=== CORRELACIONES ===')
for metodo in ['pearson', 'spearman', 'kendall']:
    sc, d = post('/correlaciones/matriz', {'variables': ['edad','peso_kg','altura_cm','imc'], 'metodo': metodo, 'alpha': 0.05})
    if sc == 200: ok(f'CORRELACIONES/matriz {metodo}', f"shape {len(d.get('variables',[]))}x{len(d.get('variables',[]))}")
    else: fail(f'CORRELACIONES/matriz {metodo}', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/correlaciones/par', {'variable_x': 'edad', 'variable_y': 'peso_kg', 'metodo': 'pearson', 'alpha': 0.05})
if sc == 200: ok('CORRELACIONES/par', f"r={d.get('r')}, p={d.get('p_value')}")
else: fail('CORRELACIONES/par', f'HTTP {sc}: {d.get("detail")}')

# ─── HIPÓTESIS ────────────────────────────────────────────────────────────────
print('\n=== HIPOTESIS ===')
sc, d = post('/hipotesis/t-una-muestra', {'variable': 'peso_kg', 'valor_referencia': 70, 'alpha': 0.05, 'alternativa': 'two-sided'})
if sc == 200: ok('HIPOTESIS/t-una-muestra', f"t={d.get('t')}, p={d.get('p_value')}, d={d.get('cohen_d')}")
else: fail('HIPOTESIS/t-una-muestra', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/t-independientes', {'variable': 'peso_kg', 'grupo': 'sexo', 'alpha': 0.05, 'alternativa': 'two-sided', 'igualdad_varianzas': True})
if sc == 200: ok('HIPOTESIS/t-independientes (Student)', f"t={d.get('t')}, p={d.get('p_value')}")
else: fail('HIPOTESIS/t-independientes (Student)', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/t-independientes', {'variable': 'peso_kg', 'grupo': 'sexo', 'alpha': 0.05, 'alternativa': 'two-sided', 'igualdad_varianzas': False})
if sc == 200: ok('HIPOTESIS/t-independientes (Welch)', f"t={d.get('t')}, p={d.get('p_value')}")
else: fail('HIPOTESIS/t-independientes (Welch)', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/t-relacionadas', {'variable_1': 'peso_kg', 'variable_2': 'altura_cm', 'alpha': 0.05, 'alternativa': 'two-sided'})
if sc == 200: ok('HIPOTESIS/t-relacionadas', f"t={d.get('t')}, p={d.get('p_value')}")
else: fail('HIPOTESIS/t-relacionadas', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/chi-cuadrado', {'variable_1': 'grupo', 'variable_2': 'sexo', 'alpha': 0.05})
if sc == 200: ok('HIPOTESIS/chi-cuadrado', f"chi2={d.get('chi2')}, p={d.get('p_value')}, V={d.get('cramer_v')}")
else: fail('HIPOTESIS/chi-cuadrado', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/mann-whitney', {'variable': 'peso_kg', 'grupo': 'sexo', 'alpha': 0.05, 'alternativa': 'two-sided'})
if sc == 200: ok('HIPOTESIS/mann-whitney', f"U={d.get('u')}, p={d.get('p_value')}")
else: fail('HIPOTESIS/mann-whitney', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/hipotesis/kruskal-wallis', {'variable': 'peso_kg', 'grupo': 'grupo', 'alpha': 0.05})
if sc == 200: ok('HIPOTESIS/kruskal-wallis', f"H={d.get('h')}, p={d.get('p_value')}, eta2={d.get('eta2')}")
else: fail('HIPOTESIS/kruskal-wallis', f'HTTP {sc}: {d.get("detail")}')

# ─── REGRESIÓN ────────────────────────────────────────────────────────────────
print('\n=== REGRESION ===')
sc, d = post('/regresion/lineal', {'dependiente': 'imc', 'independientes': ['edad','peso_kg'], 'alpha': 0.05})
if sc == 200: ok('REGRESION/lineal multiple', f"R2={d.get('r2')}, R2adj={d.get('r2_ajustado')}, DW={d.get('durbin_watson')}")
else: fail('REGRESION/lineal multiple', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/regresion/lineal', {'dependiente': 'imc', 'independientes': ['peso_kg'], 'alpha': 0.05})
if sc == 200: ok('REGRESION/lineal simple', f"R2={d.get('r2')}, F_p={d.get('f_p_value')}")
else: fail('REGRESION/lineal simple', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/regresion/logistica', {'dependiente': 'sexo', 'independientes': ['edad','peso_kg','altura_cm'], 'alpha': 0.05})
if sc == 200: ok('REGRESION/logistica binaria', f"NR2={d.get('nagelkerke_r2')}, acc={d.get('accuracy')}")
else: fail('REGRESION/logistica binaria', f'HTTP {sc}: {d.get("detail")}')

# Error esperado: dependiente con 5 categorias
sc, d = post('/regresion/logistica', {'dependiente': 'satisfaccion', 'independientes': ['edad','peso_kg'], 'alpha': 0.05})
if sc == 400: ok('REGRESION/logistica (validacion 5 cats)', 'Error 400 esperado OK')
else: fail('REGRESION/logistica (validacion 5 cats)', f'Deberia ser 400, recibio {sc}')

# ─── ANOVA ────────────────────────────────────────────────────────────────────
print('\n=== ANOVA ===')
sc, d = post('/anova/one-way', {'dependiente': 'peso_kg', 'factor': 'grupo', 'alpha': 0.05, 'posthoc': True})
if sc == 200:
    tukey_n = len(d.get('posthoc_tukey', []))
    ok('ANOVA/one-way + Tukey', f"F={d.get('f_stat')}, p={d.get('p_value')}, eta2={d.get('eta2')}, tukey={tukey_n} pares")
else: fail('ANOVA/one-way + Tukey', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/anova/one-way', {'dependiente': 'imc', 'factor': 'sexo', 'alpha': 0.05, 'posthoc': False})
if sc == 200: ok('ANOVA/one-way sin posthoc', f"F={d.get('f_stat')}, p={d.get('p_value')}")
else: fail('ANOVA/one-way sin posthoc', f'HTTP {sc}: {d.get("detail")}')

# ─── FACTORIAL ────────────────────────────────────────────────────────────────
print('\n=== FACTORIAL ===')
sc, d = post('/factorial/exploratorio', {'variables': ['edad','peso_kg','altura_cm','imc'], 'estandarizar': True, 'rotacion': 'varimax'})
if sc == 200: ok('FACTORIAL/pca+varimax', f"KMO={d.get('kmo')}, factores={d.get('n_factores')}, bartlett_p={d.get('bartlett_p')}")
else: fail('FACTORIAL/pca+varimax', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/factorial/exploratorio', {'variables': ['edad','peso_kg','altura_cm','imc'], 'n_factores': 2, 'rotacion': 'none', 'estandarizar': True})
if sc == 200: ok('FACTORIAL/sin rotacion forzado n=2', f"n_factores={d.get('n_factores')}")
else: fail('FACTORIAL/sin rotacion forzado n=2', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/factorial/exploratorio', {'variables': ['peso_kg'], 'estandarizar': True})
if sc == 400: ok('FACTORIAL/validacion <3 vars', 'Error 400 esperado OK')
else: fail('FACTORIAL/validacion <3 vars', f'Deberia ser 400, recibio {sc}')

# ─── CLUSTERING ───────────────────────────────────────────────────────────────
print('\n=== CLUSTERING ===')
sc, d = post('/clustering/kmeans', {'variables': ['edad','peso_kg','altura_cm'], 'k': 3, 'estandarizar': True})
if sc == 200: ok('CLUSTERING/kmeans k=3', f"silueta={d.get('silhouette')}, inercia={d.get('inercia')}, interp={d.get('silhouette_interpretacion')}")
else: fail('CLUSTERING/kmeans k=3', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/clustering/kmeans', {'variables': ['imc'], 'k': 2, 'estandarizar': False})
if sc == 200: ok('CLUSTERING/kmeans 1 variable', f"silueta={d.get('silhouette')}")
else: fail('CLUSTERING/kmeans 1 variable', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/clustering/silueta', {'variables': ['edad','peso_kg','altura_cm'], 'k_min': 2, 'k_max': 6, 'estandarizar': True})
if sc == 200: ok('CLUSTERING/silueta k=2-6', f"k_optimo={d.get('k_optimo')}, resultados={len(d.get('resultados',[]))}")
else: fail('CLUSTERING/silueta k=2-6', f'HTTP {sc}: {d.get("detail")}')

# ─── ÁRBOLES ─────────────────────────────────────────────────────────────────
print('\n=== ARBOLES ===')
sc, d = post('/arboles/ajustar', {'dependiente': 'grupo', 'independientes': ['edad','peso_kg','altura_cm','imc'], 'tipo': 'clasificacion', 'max_profundidad': 4, 'min_muestras_hoja': 3})
if sc == 200: ok('ARBOLES/clasificacion', f"acc={d.get('accuracy')}, cv_acc={d.get('cv_accuracy')}, depth={d.get('profundidad_real')}, hojas={d.get('n_hojas')}")
else: fail('ARBOLES/clasificacion', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/arboles/ajustar', {'dependiente': 'imc', 'independientes': ['edad','peso_kg','altura_cm'], 'tipo': 'regresion', 'max_profundidad': 5, 'min_muestras_hoja': 3})
if sc == 200: ok('ARBOLES/regresion', f"R2={d.get('r2')}, cv_R2={d.get('cv_r2')}, RMSE={d.get('rmse')}, MAE={d.get('mae')}")
else: fail('ARBOLES/regresion', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/arboles/ajustar', {'dependiente': 'grupo', 'independientes': ['edad'], 'tipo': 'clasificacion', 'max_profundidad': 2, 'min_muestras_hoja': 5})
if sc == 200: ok('ARBOLES/clasificacion profundidad 2', f"reglas={len(d.get('reglas',[]))}")
else: fail('ARBOLES/clasificacion profundidad 2', f'HTTP {sc}: {d.get("detail")}')

# ─── SERIES TEMPORALES ────────────────────────────────────────────────────────
print('\n=== SERIES TEMPORALES ===')
sc, d = post('/series/analizar', {'variable_valor': 'ventas', 'variable_tiempo': 'fecha_num', 'periodo': 1, 'lags_acf': 15})
if sc == 200:
    t = d.get('tendencia', {})
    ok('SERIES/analizar completo', f"n={d.get('n')}, tendencia={t.get('direccion')}, R2={t.get('r2')}, LB_p={d.get('ljung_box_10',{}).get('p_value')}")
else: fail('SERIES/analizar completo', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/series/analizar', {'variable_valor': 'ventas', 'periodo': 12, 'lags_acf': 10})
if sc == 200:
    descomp = d.get('descomposicion')
    ok('SERIES/analizar+descomposicion', f"descomposicion={'OK' if descomp else 'None (n insuficiente)'}")
else: fail('SERIES/analizar+descomposicion', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/series/media-movil', {'variable_valor': 'ventas', 'variable_tiempo': 'fecha_num', 'ventana': 7, 'tipo': 'simple'})
if sc == 200: ok('SERIES/SMA ventana=7', f"label={d.get('label')}")
else: fail('SERIES/SMA', f'HTTP {sc}: {d.get("detail")}')

sc, d = post('/series/media-movil', {'variable_valor': 'ventas', 'tipo': 'exponencial', 'alpha_ema': 0.3})
if sc == 200: ok('SERIES/EMA alpha=0.3', f"label={d.get('label')}")
else: fail('SERIES/EMA', f'HTTP {sc}: {d.get("detail")}')

# ─── EXPORTAR ─────────────────────────────────────────────────────────────────
print('\n=== EXPORTAR ===')
pdf_tmp = tempfile.mktemp(suffix='.pdf')
sc, d = post('/exportar/pdf', {'resultados': [{'variable': 'test', 'media': 1.5}], 'ruta_destino': pdf_tmp, 'titulo': 'Test'})
if sc == 200: ok('EXPORTAR/pdf', 'OK')
else: fail('EXPORTAR/pdf', f'HTTP {sc}: {d.get("detail")}')

xlsx_tmp = tempfile.mktemp(suffix='.xlsx')
sc, d = post('/exportar/excel', {'resultados': [{'variable': 'test', 'media': 1.5}], 'ruta_destino': xlsx_tmp})
if sc == 200: ok('EXPORTAR/excel', 'OK')
else: fail('EXPORTAR/excel', f'HTTP {sc}: {d.get("detail")}')

# ─── RESUMEN ──────────────────────────────────────────────────────────────────
os.unlink(ruta)
print()
print('=' * 65)
print(f'RESULTADOS: {len(PASS)} OK  |  {len(FAIL)} FAIL  |  TOTAL {len(PASS)+len(FAIL)}')
print('=' * 65)
if PASS:
    print('\nPASADOS:')
    for p in PASS: print(p)
if FAIL:
    print('\nFALLIDOS:')
    for f in FAIL: print(f)
