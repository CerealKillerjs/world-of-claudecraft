# La Sima: diseño del mundo inspirado en un abismo vertical

Estado: propuesta. Escala 1:1 y ciudad de 3 km decididas; el resto en "Decisiones" al final.
Alcance: este documento define el mundo jugable, su escala y cómo encaja en el motor
de World of ClaudeCraft. No cambia código. Todos los nombres propios de este documento
son **nombres de trabajo** y pasan el control de originalidad antes de usarse en el juego.

## 1. Objetivo y límites de copyright

El objetivo es un juego lo más parecido posible en **escala, estructura y sensación** a
la obra que lo inspira (un abismo vertical por capas en el centro de una isla, una
ciudad de exploradores en su borde, y un castigo físico al subir), sin copiar su
**expresión protegida**.

Regla práctica que seguimos (no es asesoría legal; si el juego se publica con fines
comerciales conviene consultarlo con un abogado):

| Se puede tomar (ideas, hechos, estructura) | No se toma (expresión) |
|---|---|
| Un pozo vertical de unos 1 km de diámetro y más de 20 km de profundidad | Nombres de lugares, capas, ciudad, isla, organizaciones |
| Capas con biomas distintos que se vuelven más hostiles al bajar | Personajes, su aspecto, su historia y sus diálogos |
| Un castigo que se dispara al subir y que empeora con la profundidad | Los nombres y descripciones textuales de cada efecto |
| Una ciudad en el borde que vive de lo que se extrae del pozo | Diseños concretos de criaturas, reliquias y arquitectura |
| Rangos de explorador que limitan hasta dónde puede bajar cada uno | Los silbatos de colores como objeto de rango y sus nombres |
| Profundidades y proporciones numéricas (son datos, no texto) | Arte, música, logotipos, capturas, citas |

Además, el repo exige que todo nombre propio nuevo sea original
(`src/sim/content/CLAUDE.md`, "Naming originality", y `docs/design/naming-audit.md`).
Cada nombre de la sección 6 se verifica con búsquedas de frase exacta antes de entrar
al contenido.

## 2. Datos de la obra que usamos como referencia de escala

Fuente: wiki de fans de la obra (consultada el 2026-10-05). Son las cifras que el
mundo jugable replica; los nombres originales de las capas no se usan.

| Capa | Profundidad (m) | Profundidad (yd del motor) | Bioma de referencia (descripción propia) |
|---|---|---|---|
| 1 | 0 a 1.350 | 0 a 1.476 | Paredes con andamios, praderas colgantes, ruinas cercanas a la superficie |
| 2 | 1.350 a 2.600 | 1.476 a 2.843 | Bosque denso; al fondo, un bosque que crece cabeza abajo |
| 3 | 2.600 a 7.000 | 2.843 a 7.655 | Una sola pared vertical gigantesca con cuevas y nidos |
| 4 | 7.000 a 12.000 | 7.655 a 13.123 | Cuencos gigantes de agua sobre árboles colosales |
| 5 | 12.000 a 13.000 | 13.123 a 14.217 | Un mar interior; al fondo, una base de investigación |
| 6 | 13.000 a 15.500 | 14.217 a 16.951 | Ruinas de una ciudad antigua |
| 7 | 15.500 a 20.000+ | 16.951 a 21.872+ | Un remolino de fuego; profundidad final desconocida |

- Diámetro de la abertura: unos **1.000 m** (1.094 yd).
- Profundidad total conocida: **más de 20.000 m** (más de 21.872 yd).
- El castigo se dispara al **subir unos 10 m** (11 yd) dentro del pozo.
- La ciudad tiene cinco distritos (centro, norte, sur, este y oeste) alrededor del borde.
- El tamaño de la ciudad y de la isla **no está dado** en la fuente. Las cifras de la
  sección 4 son estimaciones nuestras a partir de cómo se ve en la obra.

## 3. Qué permite el motor hoy (medido en el código)

| Hecho | Dónde | Consecuencia |
|---|---|---|
| Unidad: yardas; correr = 7 yd/s | `src/sim/types.ts` `RUN_SPEED` | 1 m = 1,094 yd. Cruzar la abertura corriendo: unos 2,6 min |
| El mundo actual mide unos 1.080 x 2.600 yd | `src/sim/data.ts` `ZONES`, `WORLD_SIZE` | Solo la ciudad propuesta (3,3 km) ya es más grande que todo el mundo actual |
| El terreno es un campo de alturas: **una altura por (x, z)** | `src/sim/world.ts` `terrainHeight` | Se pueden hacer paredes muy empinadas, pero **no voladizos** (nada debajo de otra cosa) |
| Cuevas y voladizos existen solo como motor voxel sin conectar | `src/sim/voxel.ts` | El bosque invertido y las cuevas de la pared necesitan terminar esa migración (render, colisión y pathfinding) |
| Colisión y pathfinding son por columnas | `src/sim/colliders.ts`, `src/sim/pathfind.ts` | Igual que arriba |
| Niebla máxima a 850 yd | `src/render/zone_streaming.ts` `MAX_OUTDOOR_FOG_FAR` | Desde el borde no se ve el lado opuesto (1.094 yd); hace falta un "vista lejana" del pozo (ya existe `far_terrain_core.ts`) |
| El servidor solo envía lo que está a 90 yd | `src/sim/types.ts` `PLAYER_INTEREST_RADIUS` | Bien para un mundo grande; la carga escala con jugadores, no con el tamaño |
| Caída segura: 12 yd; trepar solo cornisas cortas | `src/sim/player_motion.ts`, `src/sim/climb.ts` | Bajar paredes reales necesita rutas (escaleras, andamios, sogas) o un modo de escalada nuevo |
| Existe un paquete de mundo intercambiable | `src/sim/data.ts` `setActiveWorldContent`, tipo `WorldContent` | Es la costura para cargar **otro mundo** sin tocar el actual. Hoy solo lo usa el editor; el servidor no |

Precisión numérica: posiciones en torno a 22.000 yd tienen un error de float32 de unos
2 mm, así que la profundidad real cabe en coordenadas sin problemas.

## 4. El mundo jugable propuesto

### 4.1 La isla y la ciudad (escala 1:1)

```
                N
        ._______________.
       /   distrito N    \
      /  .-------------.  \
 O   |  /   anillo del  \  |   E
     | |   borde (andamios,|
     | |  ( POZO 1.094 yd) |
     |  \   ascensores) /  |
      \  '-------------'  /
       \   distrito S    /----- puerto (costa sur)
        '---------------'
     distrito centro = anillo del borde
```

- **Pozo**: círculo de 547 yd de radio en el centro de la isla. 1:1 con la obra.
- **Anillo del borde** (distrito centro): de 547 a 750 yd del centro. Andamios, poleas,
  ascensores de carga, la sede del gremio de exploradores y el mercado de hallazgos.
- **Cuatro distritos** (N, S, E, O): de 750 a 1.640 yd del centro (ciudad de 3 km de
  diámetro, decidido el 2026-10-05; la obra no da la cifra). Barrios, escuela-orfanato de aprendices, talleres,
  puerto al sur.
- **Isla**: radio de unos 2.700 yd (estimación), con costa, campos y faro. Puerto
  conectado con las rutas de barco que el motor ya tiene (`transport_ship.ts`).
- Tiempos a 7 yd/s: rodear el borde, unos 8 min; del puerto al borde, unos 3 min.

El terreno de la ciudad es una función analítica nueva (terrazas en anillo que bajan
hacia el borde), no ruido: encaja con la regla de que el terreno es función pura de la
semilla y se puede probar con tests.

### 4.2 El pozo y las capas

El campo de alturas no puede tener una capa ancha **debajo** de la ciudad. Por eso:

- **Capa 1 (continua, 1:1)**: el pozo baja de verdad. Las paredes son una caída casi
  vertical en el campo de alturas, con caminos tallados en espiral, andamios (props con
  colisión) y ascensores. Fondo a -1.476 yd. Bajar por senderos con un 25 % de
  pendiente: unos 14 min.
- **Capas 2 a 7 (regiones apiladas)**: cada capa es una región propia en otra parte del
  plano (x, z), como ya hace el motor con mazmorras e instancias, con su suelo a la
  **profundidad real** en Y. El paso entre capas es una transición en el fondo de la
  capa anterior (un túnel o caída que conecta con el techo de la siguiente). El jugador
  ve el cielo como una abertura lejana arriba, cada vez más pequeña.
- La profundidad que el jugador ve (el "altímetro") y la que usa el castigo es la
  **profundidad real en metros** de la tabla de la sección 2.

**Escala vertical: 1:1 en todas las capas (decidido el 2026-10-05).** No hay
compresión: la Y del motor es la profundidad real convertida a yardas, y el altímetro
y el castigo leen esa misma cifra. Consecuencias de diseño:

- Bajar 21.872 yd a pie con pendiente del 25 % son unas 3,5 horas de caminata pura.
  El viaje al fondo es una **expedición de varias sesiones**, no una ruta de un rato.
- Cada frontera de capa tiene un **campamento** (cementerio de resurrección, buzón,
  vendedor y punto de guardado), para que una sesión pueda terminar a medio descenso.
- La gran pared de la capa 3 mide 4.812 yd de alto a escala real: se baja por
  repisas, cuevas y sogas, y necesita el modo de escalada de la fase 6.
- **Se sube siempre a pie** (decidido el 2026-10-05), pagando el Peso. Subir es caro
  a propósito: el jugador tiene que medir cuánto baja según lo que arriesga perder si
  muere (sección 4.5), en vez de aventurarse sin pensar.
- Existe un **objeto raro de regreso** a la superficie como excepción. Cómo se obtiene
  queda para más adelante (decisión abierta 4).

### 4.3 El castigo al subir (nombre de trabajo: "el Peso")

Mecánica central. Comportamiento propuesto (las cifras de efectos son de diseño y se
calibran con las fórmulas clásicas del repo):

- Solo actúa **dentro del pozo** (por debajo del borde, Y < 0).
- El servidor guarda por jugador la **cota más baja** alcanzada desde la última vez que
  pagó el Peso. Si el jugador sube **11 yd** (10 m) por encima de esa cota, recibe el
  efecto de la capa más profunda en la que estuvo, y la cota se reinicia.
- Saltar (máximo 1,1 yd) nunca lo dispara. Ascensores y sogas sí, como en la obra.
- Efectos por capa, como auras del sim (deterministas, autoritativas en el servidor):

| Capa | Efecto en juego (propio) |
|---|---|
| 1 | Mareo: -regeneración breve |
| 2 | Náusea: velocidad reducida y lanzamientos interrumpibles |
| 3 | Visiones: el cliente del afectado ve ecos falsos de criaturas (solo visual), más lo anterior |
| 4 | Desgarro: daño periódico fuerte |
| 5 | Vacío: pierde el objetivo, el mapa y el sonido durante un tiempo |
| 6 | Transformación o muerte (con una tirada de `Rng`) |
| 7 | Muerte segura |

- Contramedidas de juego (ideas propias): subir muy despacio reduce la intensidad,
  consumibles de mitigación, y un rango alto que da resistencia parcial.
- Implementación: un módulo nuevo del sim detrás de `SimContext` (no dentro de
  `sim.ts`), con tests de determinismo, y la profundidad expuesta al HUD por `IWorld`.

### 4.4 Rangos de explorador

En lugar de silbatos de colores usamos **faroles de rango** (nombre de trabajo), con
nombres de materiales, que fijan la capa máxima permitida:

| Rango (trabajo) | Capa máxima | Equivalente en progresión |
|---|---|---|
| Pabilo (aprendiz) | 1 superior | Niveles 1 a 10 |
| Cobre | 1 | 10 a 20 |
| Ámbar | 2 | 20 a 30 |
| Plata | 3 | 30 a 40 |
| Obsidiana | 4 y 5 | 40 a 55 |
| Sin sello (leyendas) | sin límite | final del juego |

El límite se aplica como una puerta de misión (attunement) al pasar de capa, igual que
las mazmorras con requisitos.

### 4.5 Morir dentro del pozo

Intención (decidida el 2026-10-05): morir bajo el borde tiene que costar algo que el
jugador pueda perder de verdad, para que cada metro de bajada sea una apuesta.

Hoy el motor usa la muerte clásica sin pérdida de objetos: fantasma, carrera hasta el
cadáver o resurrección con penalización (`src/sim/spirit.ts`). Propuesta sobre esa base:

- Bajo el borde, lo que el jugador lleva en una **bolsa de expedición** (hallazgos y
  materiales recogidos en el pozo) se queda en el cadáver al morir.
- La carrera hasta el cadáver sale del último campamento por el que pasó. Llegar al
  cadáver recupera la bolsa; resucitar en el campamento sin ir a buscarla la pierde.
- Como volver a subir también cuesta el Peso, recuperar el cadáver de una capa honda es
  en sí una expedición peligrosa.
- Al principio **solo se pierde la bolsa** (decidido el 2026-10-05). Perder además equipo,
  dinero o experiencia se reconsidera después de probarlo.

## 5. Qué se reutiliza del juego actual

| Sistema | Uso |
|---|---|
| Clases, combate, talentos, auras | Se mantienen; la ambientación de clases se renombra después |
| Misiones, NPC, gremios, mercado, correo | La ciudad es el gran hub; los gremios son "equipos de expedición" |
| Profesiones y recolección | Recolección de hallazgos en las capas; la tasación en el gremio |
| Mazmorras e instancias | Ruinas y nidos dentro de cada capa |
| Barcos y puertos | Llegada a la isla |
| Monturas | Solo en la isla y la ciudad; dentro del pozo, no (decisión abierta 2) |
| JcJ, arenas, carreras, planeador | Se apagan al principio o quedan como minijuegos de la ciudad |
| Las zonas actuales | No se cargan en este mundo: el paquete `WorldContent` nuevo las reemplaza |

## 6. Glosario de nombres de trabajo (pendientes de control de originalidad)

| Concepto | Nombre de trabajo (es) | Nombre de trabajo (en) |
|---|---|---|
| El pozo | La Sima | The Sounding |
| La ciudad | Cerco | Rimholt |
| La isla | Isla de Vaharra | Vaharra Isle |
| Los exploradores | Sondeadores | Sounders |
| El castigo | El Peso | The Toll |
| Objetos del pozo | Hallazgos | Finds |
| Rango | Farol | Lantern |

Ninguno se usa en contenido hasta pasar la verificación de la sección 1.

## 7. Fases de implementación

1. **Base del fork**: decidir si seguimos las releases de upstream; hacer que el
   servidor y el cliente arranquen con un `WorldContent` propio (hoy solo lo hace el
   editor), dejando el mundo actual intacto para poder seguir fusionando upstream.
2. **El Peso**: el módulo del sim con tests, probado en un terreno de pruebas con un
   pozo simple. Es independiente del arte.
3. **Terreno de isla, ciudad y capa 1**: función analítica, vista lejana del pozo,
   andamios y ascensores.
4. **Contenido de ciudad y capa 1**: NPC, misiones, criaturas propias, con todas las
   obligaciones de contenido del repo (Book of Deeds, wiki, i18n en inglés).
5. **Capa 2**: requiere conectar el motor voxel al render y a la colisión para el
   bosque invertido.
6. **Capa 3**: modo de movimiento de escalada para la gran pared.
7. **Capas 4 a 7**: contenido de final de juego.

## 8. Riesgos

- **Voladizos**: las capas 2 y 3 dependen de terminar la migración voxel, que hoy es
  solo motor. Es el trabajo de ingeniería más grande del plan.
- **Volumen de contenido**: el mundo propuesto es varias veces el actual; hay que
  llenarlo por fases para que no se sienta vacío.
- **Divergencia con upstream**: cuanto más se toque el núcleo, más difícil será traer
  las releases de levy-street. Mantener los cambios aditivos y detrás de costuras.
- **Copyright**: el riesgo crece cuanto más se copie el conjunto completo (nombres,
  efectos, criaturas). Las cifras y la estructura son lo que menos riesgo tiene.

## 9. Decisiones

Tomadas (2026-10-05):

- Escala vertical 1:1 en todas las capas, sin compresión.
- Ciudad de 3 km de diámetro alrededor de la abertura de 1 km.
- Se sube siempre a pie, pagando el Peso; existe un objeto raro de regreso como excepción.
- Morir dentro del pozo deja la bolsa de expedición en el cadáver; al principio no se
  pierde nada más (sección 4.5).

Abiertas:

1. Límites de capa: copiar exactamente las cifras de la sección 2 o redondearlas a
   cifras propias cercanas. Recomendada: copiarlas (son datos), con nombres propios.
2. Monturas dentro del pozo: no (recomendada) o solo en capa 1.
3. Idioma de los textos del juego: inglés en el catálogo (regla del repo) con español
   como primera traducción.
4. Cómo se obtiene el objeto raro de regreso (se define más adelante).
