/**
 * Capa de comunicación con el motor FastAPI local.
 * El puerto se obtiene desde Electron al arrancar; en dev usa el valor por defecto.
 */

const DEFAULT_PORT = 5174
let _port = DEFAULT_PORT

// El renderer llama a esto una vez al montar App
export async function initPythonPort() {
  if (window.electronAPI) {
    _port = await window.electronAPI.getPythonPort()
  }
}

function baseUrl() {
  return `http://127.0.0.1:${_port}`
}

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) options.body = JSON.stringify(body)

  const res = await fetch(`${baseUrl()}${path}`, options)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Error ${res.status}`)
  }
  return res.json()
}

// ─── Salud ────────────────────────────────────────────────────────────────────
export const health = () => request('GET', '/health')

// ─── Datos ────────────────────────────────────────────────────────────────────
export const cargarArchivo = (ruta) =>
  request('POST', '/data/cargar', { ruta })

export const getMetadata = () => request('GET', '/data/metadata')

export const getPreview = (n = 100) =>
  request('POST', '/data/preview', { n })

export const guardarDatos = (ruta_destino = null) =>
  request('POST', '/data/guardar', { ruta_destino })

// ─── Descriptivos ────────────────────────────────────────────────────────────
export const calcularDescriptivos = (variables, incluirFrecuencias = false) =>
  request('POST', '/descriptivos/', {
    variables,
    incluir_frecuencias: incluirFrecuencias,
  })

export const calcularFrecuencias = (variable) =>
  request('POST', '/descriptivos/frecuencias', { variable })

// ─── Gráficos ────────────────────────────────────────────────────────────────
export const graficoBarras = (variable_x, titulo = '', color = '#3B82F6') =>
  request('POST', '/graficos/barras', { variable_x, titulo, color })

export const graficoHistograma = (variable_x, n_bins = 0, titulo = '', color = '#3B82F6') =>
  request('POST', '/graficos/histograma', { variable_x, n_bins, titulo, color })

export const graficoScatter = (variable_x, variable_y, titulo = '') =>
  request('POST', '/graficos/scatter', { variable_x, variable_y, titulo })

export const graficoBoxplot = (variables, normalizar = false, titulo = '', color = '#3B82F6', horizontal = false) =>
  request('POST', '/graficos/boxplot', { variables, normalizar, titulo, color, horizontal })

export const graficoLineas = (variable_x, variable_y = '', titulo = '', color = '#3B82F6') =>
  request('POST', '/graficos/lineas', { variable_x, variable_y, titulo, color })

export const graficoPie = (variable_x, donut = false, titulo = '') =>
  request('POST', '/graficos/pie', { variable_x, donut, titulo })

export const graficoErrorBars = (variable_valor, variable_grupo = '', tipo_error = 'ic95', titulo = '') =>
  request('POST', '/graficos/error-bars', { variable_valor, variable_grupo, tipo_error, titulo })

export const graficoQQ = (variable_x, distribucion = 'normal', titulo = '') =>
  request('POST', '/graficos/qq', { variable_x, distribucion, titulo })

export const graficoPP = (variable_x, distribucion = 'normal', titulo = '') =>
  request('POST', '/graficos/pp', { variable_x, distribucion, titulo })

export const graficoStemLeaf = (variable_x, escala = 1) =>
  request('POST', '/graficos/stem-leaf', { variable_x, escala })

export const graficoScatterMatrix = (variables, color_variable = '', titulo = '') =>
  request('POST', '/graficos/scatter-matrix', { variables, color_variable, titulo })

export const graficoViolin = (variable_valor, variable_grupo = '', titulo = '', color = '#3B82F6') =>
  request('POST', '/graficos/violin', { variable_valor, variable_grupo, titulo, color })

// ─── Correlaciones ───────────────────────────────────────────────────────────
export const calcularMatrizCorrelaciones = (variables, metodo = 'pearson', alpha = 0.05, ajuste_p = 'none') =>
  request('POST', '/correlaciones/matriz', { variables, metodo, alpha, ajuste_p })

export const calcularCorrelacionPar = (variable_x, variable_y, metodo = 'pearson', alpha = 0.05) =>
  request('POST', '/correlaciones/par', { variable_x, variable_y, metodo, alpha })

export const calcularCorrelacionParcial = (variable_x, variable_y, covariables, metodo = 'pearson', alpha = 0.05) =>
  request('POST', '/correlaciones/parcial', { variable_x, variable_y, covariables, metodo, alpha })

export const calcularCorrelacionSemiparcial = (variable_x, variable_y, covariables_x = [], covariables_y = [], alpha = 0.05) =>
  request('POST', '/correlaciones/semiparcial', { variable_x, variable_y, covariables_x, covariables_y, alpha })

// ─── Hipótesis ───────────────────────────────────────────────────────────────
export const tUnaMuestra = (variable, valor_referencia, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/t-una-muestra', { variable, valor_referencia, alpha, alternativa })

export const tIndependientes = (variable, grupo, alpha = 0.05, alternativa = 'two-sided', igualdad_varianzas = true) =>
  request('POST', '/hipotesis/t-independientes', { variable, grupo, alpha, alternativa, igualdad_varianzas })

export const tRelacionadas = (variable_1, variable_2, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/t-relacionadas', { variable_1, variable_2, alpha, alternativa })

export const chiCuadrado = (variable_1, variable_2, alpha = 0.05) =>
  request('POST', '/hipotesis/chi-cuadrado', { variable_1, variable_2, alpha })

export const mannWhitney = (variable, grupo, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/mann-whitney', { variable, grupo, alpha, alternativa })

export const kruskalWallis = (variable, grupo, alpha = 0.05) =>
  request('POST', '/hipotesis/kruskal-wallis', { variable, grupo, alpha })

export const testsNormalidad = (variables, alpha = 0.05) =>
  request('POST', '/hipotesis/normalidad', { variables, alpha })

export const testBinomial = (variable, categoria_exito = null, p_esperada = 0.5, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/binomial', { variable, categoria_exito, p_esperada, alpha, alternativa })

export const testRachas = (variable, punto_corte = null, alpha = 0.05) =>
  request('POST', '/hipotesis/rachas', { variable, punto_corte, alpha })

export const wilcoxon = (variable_1, variable_2 = null, mediana_ref = 0, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/wilcoxon', { variable_1, variable_2, mediana_ref, alpha, alternativa })

export const fisherExact = (variable_1, variable_2, alpha = 0.05, alternativa = 'two-sided') =>
  request('POST', '/hipotesis/fisher', { variable_1, variable_2, alpha, alternativa })

export const friedman = (variables, alpha = 0.05) =>
  request('POST', '/hipotesis/friedman', { variables, alpha })

// ─── Factorial ───────────────────────────────────────────────────────────────
export const factorialExploratorio = (variables, n_factores = null, rotacion = 'varimax', estandarizar = true) =>
  request('POST', '/factorial/exploratorio', { variables, n_factores, rotacion, estandarizar })

// ─── Clustering ───────────────────────────────────────────────────────────────
export const kmeansCluster = (variables, k = 3, estandarizar = true) =>
  request('POST', '/clustering/kmeans', { variables, k, estandarizar })

export const siluetaAnalysis = (variables, k_min = 2, k_max = 8, estandarizar = true) =>
  request('POST', '/clustering/silueta', { variables, k_min, k_max, estandarizar })

// ─── Árboles ─────────────────────────────────────────────────────────────────
export const ajustarArbol = (dependiente, independientes, tipo = 'clasificacion', max_profundidad = 5, min_muestras_hoja = 5) =>
  request('POST', '/arboles/ajustar', { dependiente, independientes, tipo, max_profundidad, min_muestras_hoja })

// ─── Series temporales ───────────────────────────────────────────────────────
export const analizarSerie = (variable_valor, variable_tiempo = null, periodo = 1, lags_acf = 20) =>
  request('POST', '/series/analizar', { variable_valor, variable_tiempo, periodo, lags_acf })

export const mediaMovil = (variable_valor, variable_tiempo = null, ventana = 5, tipo = 'simple', alpha_ema = 0.3) =>
  request('POST', '/series/media-movil', { variable_valor, variable_tiempo, ventana, tipo, alpha_ema })

// ─── Regresión ───────────────────────────────────────────────────────────────
export const regresionLineal = (dependiente, independientes, alpha = 0.05) =>
  request('POST', '/regresion/lineal', { dependiente, independientes, alpha })

export const regresionLogistica = (dependiente, independientes, alpha = 0.05) =>
  request('POST', '/regresion/logistica', { dependiente, independientes, alpha })

export const regresionStepwise = (dependiente, candidatas, metodo = 'both', p_entrada = 0.05, p_salida = 0.10, alpha = 0.05) =>
  request('POST', '/regresion/stepwise', { dependiente, candidatas, metodo, p_entrada, p_salida, alpha })

export const regresionMultinomial = (dependiente, independientes, alpha = 0.05) =>
  request('POST', '/regresion/multinomial', { dependiente, independientes, alpha })

export const regresionOrdinal = (dependiente, independientes, alpha = 0.05) =>
  request('POST', '/regresion/ordinal', { dependiente, independientes, alpha })

export const regresionPoisson = (dependiente, independientes, alpha = 0.05) =>
  request('POST', '/regresion/poisson', { dependiente, independientes, alpha })

export const regresionNoLineal = (dependiente, independiente, modelo = 'auto', alpha = 0.05) =>
  request('POST', '/regresion/no-lineal', { dependiente, independiente, modelo, alpha })

export const regresionPonderada = (dependiente, independientes, pesos, alpha = 0.05) =>
  request('POST', '/regresion/ponderada', { dependiente, independientes, pesos, alpha })

// ─── ANOVA ────────────────────────────────────────────────────────────────────
export const anovaOneWay = (dependiente, factor, alpha = 0.05, posthoc = true, metodo_posthoc = 'tukey') =>
  request('POST', '/anova/one-way', { dependiente, factor, alpha, posthoc, metodo_posthoc })

export const anovaTwoWay = (dependiente, factor_a, factor_b, alpha = 0.05, posthoc = true) =>
  request('POST', '/anova/two-way', { dependiente, factor_a, factor_b, alpha, posthoc })

// ─── GLM (ANCOVA + Medidas repetidas) ────────────────────────────────────────
export const ancova = (dependiente, factor, covariables, alpha = 0.05, posthoc = true, test_homogeneidad_pendientes = true) =>
  request('POST', '/glm/ancova', { dependiente, factor, covariables, alpha, posthoc, test_homogeneidad_pendientes })

export const anovaMedidasRepetidas = (variables, alpha = 0.05, posthoc = true) =>
  request('POST', '/glm/medidas-repetidas', { variables, alpha, posthoc })

// ─── Fiabilidad ───────────────────────────────────────────────────────────────
export const cronbachAlpha = (items, eliminar_si_mejora = true) =>
  request('POST', '/fiabilidad/cronbach', { items, eliminar_si_mejora })

// ─── Variables (Variable View) ───────────────────────────────────────────────
export const variablesGetAll    = ()       => request('GET',    '/variables/')
export const variablesActualizar = (vars)  => request('POST',   '/variables/actualizar', { variables: vars })
export const variablesRenombrar  = (viejo, nuevo) => request('POST', '/variables/renombrar', { nombre_actual: viejo, nombre_nuevo: nuevo })
export const variablesEliminar   = (nombre) => request('DELETE', `/variables/${nombre}`)

// ─── Proyecto (.nexus) ───────────────────────────────────────────────────────
export const proyectoGuardar = (params) => request('POST', '/proyecto/guardar', params)
export const proyectoCargar  = (ruta)   => request('POST', '/proyecto/cargar', { ruta })
export const proyectoInfo    = ()       => request('GET',  '/proyecto/info')

// ─── Exportar APA (Word) ─────────────────────────────────────────────────────
export const exportarAPA = (params) => request('POST', '/exportar/apa', params)

// ─── Mediación / Moderación ──────────────────────────────────────────────────
export const mediacionAjustar = (params) => request('POST', '/mediacion/ajustar', params)
export const mediacionSobel   = (params) => request('POST', '/mediacion/sobel', params)

// ─── MDS ─────────────────────────────────────────────────────────────────────
export const mdsAjustar = (params) => request('POST', '/mds/ajustar', params)

// ─── Tablas personalizadas ───────────────────────────────────────────────────
export const tablasCustomGenerar = (params) => request('POST', '/tablas-custom/generar', params)

// ─── Sintaxis ────────────────────────────────────────────────────────────────
export const sintaxisEjecutar = (params) => request('POST', '/sintaxis/ejecutar', params)
export const sintaxisGuardar  = (params) => request('POST', '/sintaxis/guardar',  params)
export const sintaxisCargar   = (params) => request('POST', '/sintaxis/cargar',   params)
export const sintaxisHistorial = ()      => request('GET',  '/sintaxis/historial')
export const sintaxisAyuda    = ()       => request('GET',  '/sintaxis/ayuda')

// ─── Clustering jerárquico ───────────────────────────────────────────────────
export const clusteringJerarquico = (params) => request('POST', '/clustering-jerarquico/ajustar', params)

// ─── Correspondencias ────────────────────────────────────────────────────────
export const correspondenciasSimples  = (params) => request('POST', '/correspondencias/simple',   params)
export const correspondenciasMultiples = (params) => request('POST', '/correspondencias/multiple', params)

// ─── TRI / Rasch ─────────────────────────────────────────────────────────────
export const triAjustar = (params) => request('POST', '/tri/ajustar', params)

// ─── Tests no paramétricos adicionales ───────────────────────────────────────
export const ks2Muestras = (params) => request('POST', '/hipotesis/ks-dos-muestras', params)
export const mcNemar     = (params) => request('POST', '/hipotesis/mcnemar',         params)
export const cochranQ    = (params) => request('POST', '/hipotesis/cochran-q',       params)
export const mosesTest   = (params) => request('POST', '/hipotesis/moses',           params)
export const testMediana = (params) => request('POST', '/hipotesis/mediana',         params)

// ─── Potencia ────────────────────────────────────────────────────────────────
export const potenciaCalcular = (params) =>
  request('POST', '/potencia/calcular', params)

export const potenciaCurva = (params) =>
  request('POST', '/potencia/curva-potencia', params)

// ─── Discriminante ───────────────────────────────────────────────────────────
export const discriminanteAjustar = (params) =>
  request('POST', '/discriminante/ajustar', params)

// ─── MANOVA ──────────────────────────────────────────────────────────────────
export const manovaAjustar = (params) =>
  request('POST', '/manova/ajustar', params)

// ─── Psicometría avanzada ─────────────────────────────────────────────────────
export const psicometriaOmega  = (params) => request('POST', '/psicometria/omega', params)
export const psicometriaICC    = (params) => request('POST', '/psicometria/icc', params)
export const psicometriaKappa  = (params) => request('POST', '/psicometria/kappa', params)
export const psicometriaKuder  = (params) => request('POST', '/psicometria/kuder-richardson', params)

// ─── ARIMA ───────────────────────────────────────────────────────────────────
export const arimaAjustar = (params) =>
  request('POST', '/arima/ajustar', params)

export const arimaHoltWinters = (params) =>
  request('POST', '/arima/holt-winters', params)

export const arimaAutoIdentificar = (params) =>
  request('POST', '/arima/auto-identificar', params)

// ─── Supervivencia ───────────────────────────────────────────────────────────
export const supervivenciaKM = (params) =>
  request('POST', '/supervivencia/kaplan-meier', params)

export const supervivenciaTablaVida = (params) =>
  request('POST', '/supervivencia/tabla-vida', params)

export const supervivenciaCox = (params) =>
  request('POST', '/supervivencia/cox', params)

// ─── Tablas cruzadas ─────────────────────────────────────────────────────────
export const crosstabsTabla = (params) =>
  request('POST', '/crosstabs/tabla', params)

export const crosstabsMultiples = (params) =>
  request('POST', '/crosstabs/multiples', params)

// ─── Transformaciones ────────────────────────────────────────────────────────
export const transformarCalcular = (params) =>
  request('POST', '/transformar/calcular', params)

export const transformarRecodificar = (params) =>
  request('POST', '/transformar/recodificar', params)

export const transformarFiltrar = (params) =>
  request('POST', '/transformar/filtrar', params)

export const transformarOrdenar = (params) =>
  request('POST', '/transformar/ordenar', params)

export const transformarRanking = (params) =>
  request('POST', '/transformar/ranking', params)

export const transformarReemplazarPerdidos = (params) =>
  request('POST', '/transformar/reemplazar-perdidos', params)

export const transformarAgregar = (params) =>
  request('POST', '/transformar/agregar', params)

export const transformarReestructurar = (params) =>
  request('POST', '/transformar/reestructurar', params)

export const transformarDeshacer = (params) =>
  request('POST', '/transformar/deshacer', params)

export const transformarHistorial = () =>
  request('GET', '/transformar/historial')

export const transformarPartirArchivo = (params) =>
  request('POST', '/transformar/partir-archivo', params)

export const transformarDesactivarParticion = (_params) =>
  request('POST', '/transformar/desactivar-particion')

export const transformarPonderar = (params) =>
  request('POST', '/transformar/ponderar', params)

export const transformarEstado = () =>
  request('GET', '/transformar/estado')

// ─── Exportar ────────────────────────────────────────────────────────────────
export const exportarPDF = (resultados, ruta_destino, titulo = 'Resultados Nexus Stats') =>
  request('POST', '/exportar/pdf', { resultados, ruta_destino, titulo })

export const exportarExcel = (resultados, ruta_destino) =>
  request('POST', '/exportar/excel', { resultados, ruta_destino })
