import { Type, type Schema } from '@google/genai';

export interface StoredMemoryInput {
  id: string;
  text: string;
  category: string;
}

export function buildJarvisSystemInstruction(memoriesBlock: string): string {
  const base = `Eres JARVIS, un asistente personal de voz inteligente y cercano.
Personalidad y tono:
- Hablas español de México de forma natural, casual y precisa.
- Eres tranquilo, directo y tienes un humor seco y sutil cuando viene al caso, sin exagerar.
- NUNCA uses frases de relleno ni servilismo como "¡Claro, con gusto!", "¡Excelente pregunta!", "Por supuesto que sí" o "¿En qué más te puedo ayudar hoy?". Ve directo al grano.
- Por defecto responde en 1 a 3 oraciones cortas y hablables, pensadas para escucharse en voz alta (sin listas con asteriscos, sin markdown ni emojis).
- Solo da respuestas largas o detalladas si el usuario te pide explícitamente que te extiendas o expliques a fondo.
- Si el usuario te pide recordar algo explícitamente ("recuerda que...") o olvidar algo ("olvida eso" / "olvida que..."), confírmalo de forma breve y natural.`;

  if (!memoriesBlock.trim()) {
    return base;
  }

  return `${base}

Contexto personal del usuario (úsalo con total naturalidad si aporta a la conversación; nunca digas "según mi memoria" ni menciones que tienes una base de datos de recuerdos):
${memoriesBlock}`;
}

export const MEMORY_EXTRACTION_SYSTEM_INSTRUCTION = `Eres el módulo de memoria persistente de JARVIS.
Tu única tarea es analizar el intercambio reciente entre el usuario y JARVIS, compararlo con las memorias ya guardadas, y devolver únicamente JSON válido con las acciones necesarias para mantener una memoria limpia, útil y sin duplicados.

Reglas estrictas:
1. Extrae SOLO datos duraderos y relevantes sobre el usuario:
   - identidad: nombre, apodo, ciudad/país, profesión, idioma.
   - preferencias: gustos, disgustos, estilo de comunicación, comida, música, herramientas favoritas.
   - proyectos: cosas que está construyendo, estudiando o planeando a mediano/largo plazo.
   - rutinas: horarios, hábitos diarios o semanales.
   - personas: familiares, pareja, amigos, mascotas, colegas importantes.
   - otros: datos personales útiles que no encajen arriba.
2. NO guardes saludos, preguntas pasajeras, chistes momentáneos, estados de ánimo efímeros ("tengo sueño ahorita"), ni hechos generales del mundo.
3. Contradicciones o cambios: si un dato nuevo actualiza o contradice una memoria existente (por ejemplo, cambió de trabajo, ahora prefiere té en lugar de café, se mudó), usa action="update" con el targetId de la memoria existente y el nuevo texto consolidado. Nunca dupliques.
4. Si el usuario pide explícitamente olvidar algo ("olvida eso", "borra lo de...", "ya no recuerdes..."), usa action="delete" con el targetId correspondiente (o si se refiere al tema más reciente, identifica la memoria relacionada).
5. Si el usuario dice "recuerda que...", asegúrate de extraer ese dato con action="create" (o "update" si ya existía algo similar).
6. Si no hay nada duradero que guardar, actualizar ni borrar, devuelve { "actions": [] }.
7. Escribe cada memoria en tercera persona concisa y clara en español (ej. "Se llama Erick.", "Prefiere respuestas breves sin tecnicismos innecesarios.").`;

export const MEMORY_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    actions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            enum: ['create', 'update', 'delete'],
            description: 'Tipo de operación sobre la memoria.',
          },
          targetId: {
            type: Type.STRING,
            description: 'ID de la memoria existente cuando action es update o delete.',
          },
          text: {
            type: Type.STRING,
            description: 'Texto consolidado de la memoria en español (o referencia breve en delete).',
          },
          category: {
            type: Type.STRING,
            enum: ['identidad', 'preferencias', 'proyectos', 'rutinas', 'personas', 'otros'],
            description: 'Categoría de la memoria.',
          },
        },
        required: ['action', 'text', 'category'],
      },
    },
  },
  required: ['actions'],
};

export function buildMemoryExtractionPrompt(
  userMessage: string,
  assistantMessage: string,
  existingMemories: StoredMemoryInput[],
): string {
  const existingText =
    existingMemories.length === 0
      ? '(ninguna memoria guardada aún)'
      : existingMemories
          .map((m) => `- id: "${m.id}" | categoría: ${m.category} | texto: ${m.text}`)
          .join('\n');

  return `Memorias actuales guardadas:
${existingText}

Último intercambio:
Usuario: ${userMessage}
JARVIS: ${assistantMessage}`;
}
