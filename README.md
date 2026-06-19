# Nexus Stats

Herramienta de análisis estadístico de escritorio gratuita para investigadores hispanohablantes.
Alternativa moderna a IBM SPSS Statistics.

## Stack

| Capa | Tecnología |
|------|-----------|
| Shell | Electron 31 |
| UI | React 18 + Tailwind CSS v3 |
| Gráficos | Plotly.js |
| Motor estadístico | Python 3.11 + FastAPI (localhost:5174) |
| Estado | Zustand |
| IA | Groq API — llama-3.3-70b-versatile |
| Empaquetado | Electron Builder → NSIS .exe |

## Setup de desarrollo

### Requisitos previos

- Node.js 20+
- Python 3.11+

### 1. Instalar dependencias de Node

```bash
npm install
```

### 2. Instalar dependencias de Python

```bash
cd python
pip install -r requirements.txt
```

> En Windows se recomienda usar un virtualenv:
> ```
> python -m venv .venv
> .venv\Scripts\activate
> pip install -r requirements.txt
> ```

### 3. Arrancar en modo desarrollo

Abre dos terminales:

**Terminal 1 — Motor Python:**
```bash
cd python
python main.py
```

**Terminal 2 — Electron + Vite:**
```bash
npm run dev
```

O en una sola terminal con concurrently:
```bash
npm run dev
```
> `npm run dev` lanza Vite en :5173 y espera a que esté listo antes de arrancar Electron.
> El motor Python debe estar corriendo separadamente en desarrollo.

### 4. Verificar que el motor está funcionando

```
GET http://localhost:5174/health
→ {"status": "ok", "version": "0.1.0"}
```

Documentación interactiva de la API (solo en dev):
```
http://localhost:5174/docs
```

## Empaquetar para producción (.exe)

### 1. Compilar motor Python con PyInstaller

```bash
cd python
pyinstaller --onedir --name nexus_engine main.py
# Genera: python/dist/nexus_engine/
```

### 2. Compilar React

```bash
npm run build
```

### 3. Generar instalador .exe

```bash
npm run build:electron
# Genera: dist-electron/Nexus Stats Setup x.y.z.exe
```

## Estructura de carpetas

```
nexus-stats/
├── electron/           # Proceso principal Electron
│   ├── main.js         # Ventana + ciclo de vida + IPC
│   └── preload.js      # Bridge seguro renderer↔main
├── src/                # React frontend
│   ├── App.jsx         # Router + layout principal
│   ├── i18n/           # Traducciones (es/en) + hook useT
│   ├── pages/          # Una página por módulo
│   ├── store/          # Zustand: dataStore + analysisStore
│   └── services/       # pythonApi.js + groqService.js
├── python/
│   ├── main.py         # Entry point FastAPI
│   ├── routers/        # Un router por módulo estadístico
│   └── services/       # stats_engine.py + data_manager.py
└── build/              # Assets para el instalador
```

## Decisiones de arquitectura

**¿Por qué FastAPI en lugar de llamadas directas a Python?**
Desacopla el frontend de la implementación estadística. El renderer de Electron no puede
importar módulos de Python directamente; un servidor HTTP local en localhost es el patrón
más simple, testeable y fácil de depurar. Además permite usar las mismas rutas desde
cualquier cliente durante el desarrollo.

**¿Por qué Zustand en lugar de Context API?**
El estado del dataset (miles de filas) y el historial de análisis se leen y escriben desde
múltiples componentes no relacionados. Zustand evita re-renders innecesarios por sus
selectores atómicos y tiene una API mínima sin boilerplate.

**¿Por qué DuckDB dentro de data_manager?**
Permite ejecutar SQL analítico sobre DataFrames pandas sin mover los datos a disco.
Útil para filtros, agregaciones y transformaciones que vendrán en fases posteriores.
En la Fase 1 apenas se usa, pero el setup ya está listo.

**¿Por qué electron-store no se usa en la Fase 1?**
La API key de Groq se guarda en `localStorage` del renderer por simplicidad en el MVP.
En la Fase 2 se migrará a `electron-store` con cifrado para mejorar la seguridad.

**¿Por qué puerto 5174 para FastAPI?**
El 5173 ya lo usa Vite. El 5174 es el siguiente disponible y tiene baja probabilidad
de conflicto con otros servicios del sistema.

## Roadmap

- **Fase 1 (actual)**: Editor de datos, descriptivos, gráficos, IA, exportar
- **Fase 2**: Regresión, ANOVA, t-tests, chi-cuadrado, correlaciones
- **Fase 3**: Factorial, clustering, regresión múltiple, imputación
- **Fase 4**: Árboles de decisión, series temporales, scripting del usuario
