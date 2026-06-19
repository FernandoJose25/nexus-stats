/**
 * Servicio de interpretación IA via Groq API.
 * La API key la guarda el usuario en Configuración (electron-store).
 * Si no hay key, las demás funciones siguen funcionando normalmente.
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

function buildSystemPrompt() {
  return `Eres un estadístico experto y pedagogo. Tu función es interpretar resultados
estadísticos en español claro y accesible para investigadores, estudiantes y analistas
sin formación estadística avanzada. Sé directo, práctico y evita la jerga innecesaria.
Cuando corresponda, indica si un resultado es estadísticamente significativo y qué
acción concreta puede tomar el usuario.`
}

function buildUserPrompt(bloqueResultado, tipoAnalisis) {
  const contexto = tipoAnalisis
    ? `Tipo de análisis: ${tipoAnalisis}\n\n`
    : ''

  return `${contexto}Interpreta el siguiente resultado estadístico en español claro y sencillo.
Explica qué significa cada estadístico importante, si hay algo relevante o inusual,
y qué conclusiones prácticas puede sacar el investigador.
Responde en máximo 180 palabras, sin fórmulas matemáticas, en tono accesible.

Resultado:
${JSON.stringify(bloqueResultado, null, 2)}`
}

/**
 * Interpreta un bloque de resultados estadísticos usando Groq LLaMA.
 * @param {object} bloqueResultado - Objeto con los resultados estadísticos
 * @param {string} apiKey - Groq API key
 * @param {string} [tipoAnalisis] - Descripción del tipo de análisis (opcional)
 * @param {AbortSignal} [signal] - Para cancelar la petición si el usuario navega
 * @returns {Promise<string>} - Texto de interpretación
 */
export async function interpretarResultado(bloqueResultado, apiKey, tipoAnalisis = '', signal = null) {
  if (!apiKey?.trim()) {
    throw new Error('NO_API_KEY')
  }

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(bloqueResultado, tipoAnalisis) },
    ],
    temperature: 0.3,
    max_tokens: 400,
    stream: false,
  }

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    if (res.status === 401) throw new Error('API_KEY_INVALIDA')
    if (res.status === 429) throw new Error('LIMITE_ALCANZADO')
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Error Groq: ${res.status}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? 'No se recibió respuesta del modelo.'
}

/**
 * Valida que una API key tenga el formato correcto de Groq (gsk_...).
 */
export function validarFormatoApiKey(key) {
  return typeof key === 'string' && key.startsWith('gsk_') && key.length > 20
}
