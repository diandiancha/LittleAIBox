<div align="center">

# Contribuir a LittleAIBox

**¡Gracias por ayudar a mejorar LittleAIBox!** 🎉

Cada informe de error, idea o línea de código hace que este proyecto sea mejor. 🌱

[English](../CONTRIBUTING.md) | [中文](CONTRIBUTING.zh-CN.md) | [日本語](CONTRIBUTING.ja.md) | [한국어](CONTRIBUTING.ko.md) | [Español](CONTRIBUTING.es.md)

</div>

> **Alcance y actualización:** este documento describe las funciones y la arquitectura del proyecto completo. El repositorio publica una selección del frontend, sin servidores, pagos, reglas comerciales ni credenciales. La versión 3.1.0 actualiza diagramas, fórmulas, Workers de documentos y teclado. El análisis local y el envío al modelo son operaciones distintas. Consulte el [README inglés](../README.md) para los contratos y requisitos actualizados.

---

## 🚀 Inicio Rápido (Para Nuevos Contribuidores)

1. **Fork y Clonar**

   ```bash
   git clone https://github.com/diandiancha/LittleAIBox.git
   cd LittleAIBox
   npm install
   npm run dev
   ```

2. **Hacer cambios** → Probar localmente (revisa el puerto mostrado en la terminal)

3. **Confirmar cambios** → `git commit -m "fix: corregir error tipográfico en i18n"`

4. **Hacer Push y Abrir un Pull Request**

5. 🎉 ¡Listo! Lo revisaré lo antes posible.

> 💡 *Si eres nuevo en GitHub, consulta [First Contributions](https://github.com/firstcontributions/first-contributions).*

---

## 🧭 Código de Conducta

Sé amable, inclusivo y constructivo.

Todos estamos aprendiendo — ayuda a otros a crecer contigo. ❤️

---

## 💡 Formas en que Puedes Contribuir

- 🐛 **Reportar Errores** — a través de [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- ✨ **Sugerir Características** — nuevas ideas o mejoras son bienvenidas
- 📝 **Mejorar Documentación** — corregir errores tipográficos, agregar ejemplos
- 🌍 **Traducir UI** — ayuda a hacer LittleAIBox accesible en todo el mundo
- 🔧 **Enviar Código** — corrección de errores, refactorizaciones, nuevas características
- 🏗️ **Ayudar a Refactorizar Código** — trabajar juntos para mejorar la estructura del código base

---

## 🧑‍💻 Configuración de Desarrollo

**Requisitos**
- Node.js **^20.19.0 || >=22.12.0**
- npm ≥ 9
- Git (última versión)
- VS Code (recomendado)

**Iniciar localmente**

```bash
npm install
npm run dev
```

**Construir para producción**

```bash
npm run build
```

**Pruebas móviles (opcional)**

```bash
npx cap add android
npx cap sync
npx cap open android
```

---

## 🧩 Estructura del Proyecto

```
LittleAIBox/
├── src/                    # Código fuente
│   ├── main.js            # Lógica principal de la aplicación
│   ├── api-config.js      # Configuración de API
│   ├── db.js              # Envoltorio de IndexedDB
│   ├── i18n.js            # Internacionalización
│   ├── mermaid-renderer.js # Renderizado de diagramas
│   ├── floating-timeline.js # Navegación de línea de tiempo flotante
│   ├── style.css          # Estilos globales
│   └── sw-custom.js       # Service Worker
├── public/                 # Recursos estáticos
│   ├── locales/           # Archivos de traducción (5 idiomas)
│   ├── libs/              # Bibliotecas de terceros
│   ├── images/            # Imágenes e iconos
│   └── manifest.webmanifest # Manifesto PWA
├── appshow/                # Capturas de pantalla por idioma
├── capacitor.config.json   # Configuración de aplicación móvil
├── vite.config.js          # Configuración de construcción
├── package.json            # Dependencias
└── index.html              # Punto de entrada HTML principal
```

---

## 🧾 Commit y Estilo de Código (Para Contribuidores Intermedios/Avanzados)

### 💬 Commits Convencionales

```
<type>(<scope>): <description>
```

**Tipos comunes**
- `feat` — nueva característica
- `fix` — corrección de error
- `docs` — documentación
- `style` — formato de código
- `refactor` — refactorización no rompiente
- `perf` — mejora de rendimiento
- `test` — cambios de prueba

**Ejemplos**

```bash
feat(i18n): agregar traducción al portugués
fix(file): manejar errores de análisis PDF
docs(readme): actualizar instrucciones de instalación
refactor(rag): optimizar algoritmo de fragmentación
```

### 🧱 Estándares de Código

- Usa características **ES6+**
- Prefiere `async/await`
- Usa `const` y `let` (evita `var`)
- Escribe comentarios claros con JSDoc cuando sea necesario
- Mantén las funciones cortas y enfocadas

### 📝 Ejemplo de Código

```javascript
// Bueno
async function handleFileUpload(file) {
  if (!file) return;
  
  const isValid = validateFile(file);
  if (!isValid) {
    showToast('Formato de archivo inválido');
    return;
  }
  
  try {
    const content = await parseFile(file);
    await processContent(content);
  } catch (error) {
    console.error('Error al procesar archivo:', error);
    showToast('Error al procesar archivo');
  }
}
```

---

## 🔄 Proceso de Pull Request

1. **Sincroniza tu fork**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

2. **Crear rama**
   ```bash
   git checkout -b feature/mi-característica
   ```

3. **Probar cambios** — en múltiples navegadores si es posible

4. **Hacer push y abrir PR**

Para cambios de streaming, compruebe el búfer de inicio/reanudación, el vaciado de la cola al llegar a EOF y el manejo existente de imágenes/citas. Indique por separado la verificación en navegadores y servicios reales.

Para cambios del DOM o del estado de fórmulas, compruebe en el navegador la reutilización de nodos, los cambios de estructura de Markdown y el desplazamiento horizontal de fórmulas.

**Plantilla de Pull Request**

```markdown
## Descripción
Lo que hace este cambio y por qué.

## Tipo
- [ ] Corrección de error
- [ ] Característica
- [ ] Documentación
- [ ] Traducción

## Pruebas
Cómo probar estos cambios:
1. Paso uno
2. Paso dos

## Lista de Verificación
- [ ] El código sigue la guía de estilo
- [ ] Probado y funcionando
- [ ] Sin nuevas advertencias
- [ ] Documentación actualizada
```

---

## 🐛 Reportar Errores

Antes de enviar:
1. Busca [Issues](https://github.com/diandiancha/LittleAIBox/issues) existentes
2. Revisa la consola del navegador para errores
3. Intenta reproducir en diferentes navegadores/dispositivos

**Plantilla de Informe de Error**

```markdown
**Describir el Error**
Una descripción clara de cuál es el error.

**Para Reproducir**
Pasos para reproducir:
1. Ir a '...'
2. Hacer clic en '....'
3. Ver error

**Comportamiento Esperado**
Lo que esperabas que sucediera.

**Entorno**
- OS: [ej. Windows 11]
- Navegador: [ej. Chrome 120]
- Dispositivo: [ej. Escritorio, Móvil]
- Versión: [ej. 2.3.1]
```

---

## 💡 Sugerir Características

Considera antes de sugerir:
- ¿Se alinea con la visión del proyecto (privacidad primero, procesamiento local)?
- ¿Es factible solo como cliente?
- ¿Beneficiaría a muchos usuarios?

**Plantilla de Solicitud de Característica**

```markdown
**Resumen de Característica**
Breve descripción de la característica propuesta.

**Declaración del Problema**
¿Qué problema resuelve esto? ¿Quién se beneficia?

**Solución Propuesta**
¿Cómo funcionaría esta característica?

**Alternativas Consideradas**
¿Qué otros enfoques consideraste?
```

---

## 🌐 Traducciones

Idiomas soportados:
- 🇨🇳 Chino Simplificado (zh-CN)
- 🇹🇼 Chino Tradicional (zh-TW)
- 🇬🇧 Inglés (en)
- 🇯🇵 Japonés (ja)
- 🇰🇷 Coreano (ko)
- 🇪🇸 Español (es)

**Agregar un nuevo idioma**

```bash
cp public/locales/en.json public/locales/TU_IDIOMA.json
```

Edita los valores, mantén las claves idénticas, luego agrega tu código de idioma en `src/i18n.js`:

```javascript
const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW', 'es', 'fr', 'TU_IDIOMA'];
```

Prueba: `npm run dev` → Cambia a tu idioma en Configuración → Verifica que todos los elementos de UI estén traducidos.

---

## 🆘 ¿Necesitas Ayuda?

- Lee [README](../README.md)
- Revisa [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- Pregunta en [Discussions](https://github.com/diandiancha/LittleAIBox/discussions)
- Abre un Issue con etiqueta `question`

Ten paciencia — soy estudiante con tiempo limitado. 🙏

---

## 🎓 Recursos de Aprendizaje

¿Nuevo en código abierto o desarrollo web?

**General**
- [GitHub Flow](https://guides.github.com/introduction/flow/)
- [Cómo Contribuir al Código Abierto](https://opensource.guide/how-to-contribute/)
- [First Contributions](https://github.com/firstcontributions/first-contributions)

**Tecnologías Utilizadas**
- [Vanilla JavaScript](https://developer.mozilla.org/es/docs/Web/JavaScript)
- [Vite](https://vitejs.dev/)
- [Capacitor](https://capacitorjs.com/docs)
- [IndexedDB](https://developer.mozilla.org/es/docs/Web/API/IndexedDB_API)
- [Service Workers](https://developer.mozilla.org/es/docs/Web/API/Service_Worker_API)

**Calidad de Código y Refactorización**
- [Refactoring.guru](https://refactoring.guru/) — aprender patrones de refactorización
- [Clean Code](https://github.com/ryanmcdermott/clean-code-javascript) — mejores prácticas de JavaScript
- [Patrón de Módulo](https://developer.mozilla.org/es/docs/Web/JavaScript/Guide/Modules) — guía de módulos ES

---

## 🙌 Reconocimiento

Todos los contribuidores se enumeran en la **página de Contribuidores** y se presentan en las **notas de lanzamiento**.

¡Gracias por hacer que LittleAIBox sea mejor! 🚀

---

**Recuerda**: Como desarrollador estudiante, realmente aprecio tus contribuciones y paciencia. ¡Construyamos algo increíble juntos! 💪

