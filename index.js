/**
 * MEDIAIHEALTHY — Multi-Agent Backend
 * Version: 8.0 — Sofia (demo) + Dulce (Dra. Lama Saab)
 * Stack: Node.js / Render / Evolution API / Claude / Supabase / Apps Script
 */

'use strict';

const express          = require('express');
const axios            = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ─── VARIABLES DE ENTORNO ─────────────────────────────────────────────────────
const PORT            = process.env.PORT || 3000;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const EVOLUTION_URL   = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY   = process.env.EVOLUTION_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY;
const MARIO_PHONE     = process.env.MARIO_PHONE || '584142660888';
const APPS_SCRIPT_URL_SOFIA  = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_URL_DULCE  = process.env.APPS_SCRIPT_URL_DULCE;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CACHÉ DE DOCTORES ────────────────────────────────────────────────────────
const doctorCache = {};

async function loadDoctor(instanceName) {
  try {
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .eq('agent_name', instanceName === 'DULCE-LAMA' ? 'Dulce' : 'Sofia')
      .single();

    if (error || !data) {
      console.log(`⚠️  Doctor no encontrado para instancia: ${instanceName}`);
      return null;
    }

    doctorCache[instanceName] = data;
    console.log(`✅ Doctor cargado para ${instanceName}: ${data.name}`);
    return data;
  } catch (err) {
    console.error(`❌ Error cargando doctor ${instanceName}:`, err.message);
    return null;
  }
}

async function getDoctor(instanceName) {
  if (doctorCache[instanceName]) return doctorCache[instanceName];
  return await loadDoctor(instanceName);
}

// ─── DETECTAR INSTANCIA ───────────────────────────────────────────────────────
function getInstance(body) {
  return (
    body?.instance ||
    body?.data?.instance ||
    body?.instanceName ||
    'MEDIAIHEALTHY'
  );
}

function extractMessage(body) {
  return (
    body?.data?.message?.conversation ||
    body?.data?.message?.extendedTextMessage?.text ||
    ''
  ).trim();
}

function extractPhone(body) {
  const jid = body?.data?.key?.remoteJid || '';
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

function isFromMe(body) {
  return body?.data?.key?.fromMe === true;
}

// ─── CLASIFICADORES ───────────────────────────────────────────────────────────
const MEDICAL_KEYWORDS = [
  'dolor', 'me duele', 'duele', 'fiebre', 'temperatura',
  'síntoma', 'síntomas', 'sangr', 'vomit', 'mareo', 'náusea', 'nausea',
  'diagnóstic', 'tratamiento', 'medicament', 'medicina', 'pastilla',
  'dosis', 'qué tengo', 'que tengo', 'qué me pasa', 'que me pasa',
  'es grave', 'debería tomar', 'deberia tomar', 'me siento mal',
  'tengo tos', 'presión alta', 'presion alta', 'azúcar', 'azucar',
  'diabetes', 'infección', 'infeccion', 'alergi', 'receta',
  'quiste', 'mioma'
];

const DEMO_KEYWORDS = ['demo', 'mediaihealthy', 'demo gratis', 'quiero ver'];

function isMedical(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return MEDICAL_KEYWORDS.some(k => t.includes(k));
}

function isDemo(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  return DEMO_KEYWORDS.some(k => t.includes(k));
}

// ─── HORARIO ACTIVO DULCE ─────────────────────────────────────────────────────
function isDulceActive() {
  const now = new Date();
  const caracasTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const hour = caracasTime.getHours();
  // Activa: 3pm (15) → 7am (7) del día siguiente
  // Inactiva: 7am → 3pm
  return hour >= 15 || hour < 7;
}

// ─── RESPUESTAS FIJAS ─────────────────────────────────────────────────────────
const DULCE_MEDICAL_REPLY =
  `Dulce únicamente agenda citas. Para cualquier otro requerimiento, ` +
  `comunícate directamente con el consultorio en horario de ` +
  `7:00am a 3:00pm. ✨\n\n` +
  `¿Deseas agendar una cita?`;

const DULCE_FUERA_HORARIO =
  `Hola 👋 En este momento el consultorio está en horario de atención presencial ` +
  `(7:00am – 3:00pm).\n\n` +
  `Por favor comunícate directamente con el consultorio en ese horario. ` +
  `Dulce estará disponible nuevamente desde las *3:00pm* 🕒`;

const DULCE_ARCHIVO_REPLY =
  `Solo agendamos citas en nuestro horario de 3:00pm a 7:00am.\n\n` +
  `Para cualquier otro requerimiento contáctanos en horario ` +
  `de 7:00am a 3:00pm directamente en el consultorio ✨`;

// ─── CALENDARIO DE REFERENCIA ─────────────────────────────────────────────────
// Genera lista de los próximos N días con nombre de día correcto en español
// Usa fecha de Caracas explícita y mediodía UTC para evitar edge cases de TZ
function buildCalendarRef(days = 30) {
  const now = new Date();
  const caracasNow = now.toLocaleDateString('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const [y, m, d] = caracasNow.split('-').map(n => parseInt(n));

  const lines = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i, 12, 0, 0));
    const formatted = date.toLocaleDateString('es-VE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Caracas'
    });
    const dayOfWeek = date.toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'America/Caracas'
    });
    const isWeekend = dayOfWeek === 'Sat' || dayOfWeek === 'Sun';
    const tag = i === 0 ? ' (HOY)' : (isWeekend ? ' (NO ATIENDE)' : '');
    lines.push(`- ${formatted}${tag}`);
  }
  return lines.join('\n');
}

// ─── SISTEMA CLAUDE — DULCE ───────────────────────────────────────────────────
function buildDulceSystem(doctor) {
  const calendario = buildCalendarRef(30);

  return `Eres Dulce, asistente de IA del consultorio de la ${doctor.name}.
Tu ÚNICA función es agendar citas médicas.

CALENDARIO DE REFERENCIA (próximos 30 días):
${calendario}

NUNCA inventes el nombre del día de la semana. Usa SOLO los nombres del calendario de referencia.
Cuando un paciente mencione una fecha, verifica en el calendario el día correcto.

DATOS DEL CONSULTORIO:
- Doctora: ${doctor.name} — ${doctor.specialty}
- Clínica: ${doctor.clinic_name}
- Dirección: ${doctor.address}
- Horario de atención: ${doctor.schedule_weekday}
- Sábados: ${doctor.schedule_saturday}
- Pago: ${doctor.payment}
- Idiomas: Español, Inglés, Árabe

TIPOS DE CONSULTA Y PRECIOS (informa SOLO si el paciente pregunta, SOLO en €):
- Ginecología: 150€ (incluye citología + eco transvaginal). Sin citología: 130€
- Fertilidad - Primera vez: 170€ (incluye citología + eco). Sin citología: 150€
- Fertilidad - Entrega resultados: 120€
- Fertilidad - Control: 120€ (ECO adicional 95€ si preguntan)
- Embarazo: 120€
- Embarazo Múltiple: 150€
- Citología sola: 20€ (solo si preguntan directamente)

CUPOS DIARIOS MÁXIMOS (gestión interna — NO mencionar al paciente):
- Fertilidad Primera vez: 1/día
- Fertilidad Entrega resultados: 1/día
- Fertilidad Control: 1/día
- Embarazo (incluye Múltiple): 4/día
- Ginecología: 3/día (puede absorber sobrantes)
- TOTAL: 10 pacientes/día
- Llegada máxima: 9:30am
- Sistema: orden de llegada (NO por hora)

FLUJO DE AGENDAMIENTO — OBLIGATORIO:
- Tu PRIMER mensaje SIEMPRE debe ser: "Hola 👋 Soy Dulce, asistente de la Dra. Lama Saab. Para agendar tu cita necesito: *nombre completo*, *tipo de consulta* (Ginecología, Fertilidad - Primera vez, Fertilidad - Control, Fertilidad - Entrega resultados, Embarazo) y *fecha deseada* (lunes a viernes). 😊"
- NUNCA abras con "¿Deseas agendar?" ni preguntas de sí/no
- Cuando tengas nombre + tipo + fecha exacta → confirma DIRECTAMENTE con el formato de confirmación
- NUNCA preguntes "¿Es correcto?" ni pidas validación previa antes de confirmar
- Si el paciente da los 3 datos en un solo mensaje → confirma en ese mismo reply

REGLAS DE AGENDAMIENTO:
- Pregunta siempre: nombre completo, tipo de consulta y fecha deseada
- NUNCA confirmar sin los tres datos: nombre + tipo + fecha específica (día exacto)
- Si el paciente da una fecha vaga ("después del 10", "la próxima semana", "pronto"), pregunta: "¿Qué día exacto te viene bien? Atendemos lunes a viernes."
- Si el paciente menciona sábado o domingo, responde: "Solo atendemos lunes a viernes. ¿Qué día te viene bien?"
- NO preguntes hora (es por orden de llegada, llegada máxima 9:30am)
- Confirma SOLO cuando tengas: nombre + tipo + fecha exacta (lunes a viernes)
- Si el cupo del día solicitado está lleno, ofrece el siguiente día hábil (lunes a viernes)

CUANDO CONFIRMES UNA CITA usa EXACTAMENTE este formato:
✅ Cita confirmada
👩‍⚕️ ${doctor.name}
🏥 ${doctor.clinic_name} · Piso 4 · Consultorio 4-5
📍 Valencia, Estado Carabobo
📅 [fecha]
⏰ Orden de llegada — llegada máxima 9:30am
💳 ${doctor.payment}

CANCELACIÓN DE CITAS:
- Cuando el paciente quiera cancelar, solicita los 4 datos en un solo mensaje:
  "Para cancelar tu cita necesito: nombre completo, fecha de la cita y número de teléfono con el que agendaste."
- NUNCA cancelar sin tener los 4 datos: nombre + apellido + fecha exacta + teléfono
- Si faltan datos, vuelve a pedirlos antes de proceder
- Cuando tengas los 4 datos, confirma con EXACTAMENTE este formato:
❌ Cita cancelada
👤 [nombre completo]
📅 [fecha]
📱 [teléfono]
Si necesitas reagendar, aquí estoy. 😊

LÍMITES ESTRICTOS DE CONVERSACIÓN:
- Si el mensaje NO es sobre agendar una cita, responde EXACTAMENTE esto y nada más:
  "Dulce únicamente agenda citas. Para cualquier otro requerimiento, comunícate directamente con el consultorio en horario de 7:00am a 3:00pm. ✨ ¿Deseas agendar una cita?"
- NUNCA des consejos, sugerencias, números de contacto, ni información que no sea de agendamiento
- NUNCA muestres empatía extendida ni continúes conversaciones fuera de agendamiento
- NUNCA respondas a mensajes de pagos, deudas, procedimientos, quejas ni reclamos
- Si el paciente insiste con temas fuera de agendamiento, repite el mismo mensaje fijo — sin variaciones
- Solo "Gracias", "Ok", "Perfecto" de cierre pueden recibir un emoji de despedida sin texto adicional


- NUNCA dar consejos médicos, diagnósticos ni tratamientos
- NUNCA mencionar precios en bolívares ni tasas de cambio
- NUNCA procesar voice notes, fotos, PDFs ni documentos
- NUNCA exceder los cupos diarios
- NUNCA responder preguntas médicas con información médica

Si preguntan algo médico responde EXACTAMENTE:
"Eso es algo que la ${doctor.name} te explicará en tu consulta. ¿Te ayudo a agendar una cita? 😊"

Tono: Cálido, profesional, eficiente. Como una recepcionista experta.
Respuestas: Máximo 4 oraciones. Directo al punto.
Idioma: Español venezolano natural.
Emojis: Usa con moderación 😊 ✅ 🗓️`;
}

// ─── SISTEMA CLAUDE — SOFIA ───────────────────────────────────────────────────
function buildSofiaSystem() {
  const now = new Date();
  const options = {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Caracas'
  };
  const hoy = now.toLocaleDateString('es-VE', options);

  return `Eres Sofia, agente demo de MEDIAIHEALTHY.
Tu función es demostrar el sistema de agendamiento con IA para consultorios médicos.

FECHA ACTUAL (Venezuela): ${hoy}

MEDIAIHEALTHY es un SaaS que automatiza citas médicas vía WhatsApp con IA.
Precio: $699/mes por doctor. Incluye agente IA + página web médica.
Onboarding: 48 horas. El médico no configura nada.

Puedes demostrar:
- Agendamiento automático de citas
- Bloqueo de preguntas médicas (protección legal)
- Gestión de horarios y cupos

NUNCA dar consejos médicos bajo ninguna circunstancia.

Tono: Profesional, entusiasta, demostrativo.
Respuestas: Máximo 3 oraciones.`;
}

// ─── LLAMADA A CLAUDE ─────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage, history = []) {
  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     systemPrompt,
      messages:   messages,
    },
    {
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      timeout: 15000,
    }
  );

  return response.data?.content?.[0]?.text ||
    'Disculpa, tuve un problema. ¿Puedes repetir tu mensaje?';
}

// ─── ENVIAR WHATSAPP ──────────────────────────────────────────────────────────
async function sendWhatsApp(instance, phone, text) {
  const url = `${EVOLUTION_URL}/message/sendText/${instance}`;
  await axios.post(
    url,
    { number: phone, text },
    {
      headers: {
        'apikey': EVOLUTION_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000,
    }
  );
}

// ─── LOG CONVERSACIÓN ─────────────────────────────────────────────────────────
async function logConversation(phone, userMessage, reply, mode, instance) {
  try {
    await supabase.from('conversations').insert({
      phone,
      user_message: userMessage,
      sofia_reply:  reply,
      mode:         `${instance}:${mode}`,
      created_at:   new Date().toISOString(),
    });
  } catch (err) {
    console.error('Supabase log error:', err.message);
  }
}

// ─── NOTIFICAR MARIO ──────────────────────────────────────────────────────────
async function notifyMario(phone, message) {
  try {
    const text =
      `🚨 *Nuevo prospecto DEMO MEDIAIHEALTHY*\n\n` +
      `📱 Número: +${phone}\n` +
      `💬 Mensaje: "${message}"\n\n` +
      `Contactar para seguimiento de venta.`;
    await sendWhatsApp('MEDIAIHEALTHY', MARIO_PHONE, text);
  } catch (err) {
    console.error('Error notificando a Mario:', err.message);
  }
}

// ─── DETECTAR CITA CONFIRMADA ─────────────────────────────────────────────────
function citaConfirmada(reply) {
  if (!reply) return false;
  const r = reply.toLowerCase();
  return r.includes('cita confirmada') || (r.includes('✅') && r.includes('cita'));
}

// ─── EXTRAER NOMBRE DEL PACIENTE ──────────────────────────────────────────────
function extractNombre(history) {
  const EXCLUDE = new Set([
    'hola','buenas','buenos','buen','gracias','ok','okay',
    'si','sí','no','claro','perfecto','exacto','bien','genial',
    'listo','dale','saludos','bendecida','tarde','mañana','noche',
    'días','dias','entendido','acuerdo','excelente','correcto',
    'la','el','de','del','las','los','una','uno'
  ]);

  const MEDICAL = new Set([
    'ginecología','ginecologia','fertilidad','embarazo','control',
    'resultados','citología','citologia','primera','consulta','cita'
  ]);

  const userMessages = history.filter(h => h.role === 'user').map(h => h.content.trim());

  // 1. Patrón explícito: "soy X", "me llamo X", "mi nombre es X"
  for (const msg of userMessages) {
    const explicit = msg.match(
      /(?:soy|me llamo|mi nombre es|nombre es|llamo)\s+([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-Za-záéíóúÁÉÍÓÚ]+){0,2})/i
    );
    if (explicit) return explicit[1].trim();
  }

  // 2. Formato comma-separated: "Carlos Rodríguez, Ginecología, miércoles 7"
  //    Tomar el primer segmento si parece un nombre
  for (const msg of userMessages) {
    if (msg.includes(',')) {
      const firstSegment = msg.split(',')[0].trim();
      const words = firstSegment.split(/\s+/);
      if (words.length >= 1 && words.length <= 3) {
        const firstCap   = /^[A-ZÁÉÍÓÚ][a-záéíóú]+$/.test(words[0]);
        const allLetters = words.every(w => /^[A-Za-záéíóúÁÉÍÓÚ]+$/.test(w));
        const notMedical = !MEDICAL.has(firstSegment.toLowerCase());
        if (firstCap && allLetters && notMedical) return firstSegment;
      }
    }
  }

  // 3. Desde reply del asistente: "Mucho gusto, María" / "Perfecto, María"
  const assistantMessages = history.filter(h => h.role === 'assistant').map(h => h.content.trim());
  for (const msg of assistantMessages) {
    const fromAssistant = msg.match(
      /(?:mucho gusto|perfecto|excelente|claro|gracias)[,.]?\s*([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-Za-záéíóúÁÉÍÓÚ]+)?)[.!,\s😊]/i
    );
    if (fromAssistant) return fromAssistant[1].trim();
  }

  // 4. Bare name: primera palabra capitalizada, resto solo letras, sin términos excluidos
  for (const msg of [...userMessages].reverse()) {
    const words = msg.split(/\s+/);
    if (words.length < 1 || words.length > 3) continue;
    const firstCap    = /^[A-ZÁÉÍÓÚ][a-záéíóú]+$/.test(words[0]);
    const allLetters  = words.every(w => /^[A-Za-záéíóúÁÉÍÓÚ]+$/.test(w));
    const notExcluded = !EXCLUDE.has(words[0].toLowerCase());
    const notMedical  = !MEDICAL.has(msg.toLowerCase());
    if (firstCap && allLetters && notExcluded && notMedical) return msg;
  }

  return 'Paciente';
}

// ─── EXTRAER TIPO DE CONSULTA ─────────────────────────────────────────────────
function extractTipo(text) {
  const t = text.toLowerCase();
  if (t.includes('fertilidad')) {
    if (t.includes('primera')) return 'Fertilidad - Primera vez';
    if (t.includes('entrega') || t.includes('resultado')) return 'Fertilidad - Entrega resultados';
    if (t.includes('control')) return 'Fertilidad - Control';
    return 'Fertilidad - Primera vez';
  }
  if (t.includes('embarazo')) {
    if (t.includes('múltiple') || t.includes('multiple')) return 'Embarazo Múltiple';
    return 'Embarazo';
  }
  if (t.includes('ginecolog')) return 'Ginecología';
  return 'Ginecología';
}

// ─── DETECTAR INTENCIÓN DE CANCELACIÓN ───────────────────────────────────────
function cancelacionDetectada(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  const keywords = [
    'cancelar', 'anular', 'cancela', 'cancelo', 'cancelar cita',
    'no puedo ir', 'no voy a poder', 'no asistiré', 'no voy a asistir',
    'quiero cancelar', 'necesito cancelar'
  ];
  return keywords.some(k => t.includes(k));
}

function cancelacionConfirmada(reply) {
  if (!reply) return false;
  return reply.includes('❌') && reply.toLowerCase().includes('cancelada');
}

function extractTelefono(text) {
  const match = text.match(/📱\s*\+?(\d{10,13})/);
  return match ? match[1].replace(/\D/g, '') : null;
}

// ─── CANCELAR CITA EN APPS SCRIPT ────────────────────────────────────────────
async function cancelarCitaDulce(telefono, nombre, fecha) {
  const url = APPS_SCRIPT_URL_DULCE;
  if (!url) return;

  try {
    await axios.post(url, {
      secret:   'dulce-mediaihealthy-2026',
      action:   'cancelar',
      telefono: telefono,
      nombre:   nombre || '',
      fecha:    fecha  || '',
    }, { timeout: 12000 });
    console.log(`❌ Cita cancelada en Sheets: ${nombre} · ${fecha} · ${telefono}`);
  } catch (err) {
    console.error('Error cancelando en Apps Script:', err.message);
  }
}

// ─── EXTRAER FECHA DEL REPLY ──────────────────────────────────────────────────
function extractFecha(text) {
  const months = {
    'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,
    'julio':7,'agosto':8,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12
  };

  // Patrón: "12 de mayo de 2026" o "12 de mayo"
  const match = text.match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?/i
  );

  if (match) {
    const day   = parseInt(match[1]);
    const month = months[match[2].toLowerCase()];
    const year  = match[3] ? parseInt(match[3]) : new Date().getFullYear();
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return null;
}

// ─── VERIFICAR CUPOS EN APPS SCRIPT ──────────────────────────────────────────
async function checkCuposScript(fecha, tipo) {
  const url = APPS_SCRIPT_URL_DULCE;
  if (!url) return { disponible: true }; // fail-safe: no bloquear si no hay URL

  try {
    const response = await axios.post(url, {
      secret: 'dulce-mediaihealthy-2026',
      action: 'check_cupos',
      fecha:  fecha,
      tipo:   tipo,
    }, { timeout: 8000 });
    return response.data || { disponible: true };
  } catch (err) {
    console.error('Error check_cupos:', err.message);
    return { disponible: true }; // fail-safe: si falla, no bloquear al paciente
  }
}

// ─── SIGUIENTE DÍA HÁBIL ──────────────────────────────────────────────────────
function nextDiaHabil(fechaStr) {
  const parts = fechaStr.split('-');
  const date  = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));

  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6); // saltar domingo y sábado

  const iso     = date.toISOString().split('T')[0];
  const legible = new Date(iso + 'T12:00:00').toLocaleDateString('es-VE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Caracas'
  });

  return { iso, legible };
}

// ─── REGISTRAR CITA EN APPS SCRIPT ───────────────────────────────────────────
async function registrarCitaDulce(body, nombre, phone, tipo, fecha) {
  const url = APPS_SCRIPT_URL_DULCE;
  if (!url) return;

  try {
    await axios.post(url, {
      secret:    'dulce-mediaihealthy-2026',
      action:    'agendar',
      nombre:    nombre || 'Paciente',
      telefono:  phone,
      fecha:     fecha,
      tipo:      tipo || 'Ginecología',
    }, { timeout: 12000 });
    console.log(`📅 Cita registrada en Sheets: ${nombre} · ${tipo} · ${fecha}`);
  } catch (err) {
    console.error('Error Apps Script Dulce:', err.message);
  }
}

// ─── MEMORIA DE SESIÓN ────────────────────────────────────────────────────────
const sessionHistory = {};
const citasRegistradas = new Set(); // Bug 2 fix: evitar doble registro

// ─── DEDUPLICACIÓN DE MENSAJES ────────────────────────────────────────────────
const processedMessages = new Map(); // messageId → timestamp
const MSG_DEDUP_TTL = 10000; // 10 segundos

function isDuplicate(messageId) {
  if (!messageId) return false;
  const now = Date.now();

  // Limpiar entradas viejas para no acumular memoria
  for (const [id, ts] of processedMessages.entries()) {
    if (now - ts > MSG_DEDUP_TTL) processedMessages.delete(id);
  }

  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

// ─── WEBHOOK PRINCIPAL ────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.status(200).json({ status: 'received' });

  try {
    const body     = req.body;
    if (isFromMe(body)) return;

    const event = body?.event;
    if (event && event !== 'messages.upsert') return;

    const instance = getInstance(body);
    const phone    = extractPhone(body);
    const message  = extractMessage(body);

    if (!phone || !message) return;

    // Deduplicación — ignorar si ya procesamos este mensaje
    const messageId = body?.data?.key?.id;
    if (isDuplicate(messageId)) {
      console.log(`[DEDUP] Ignorado duplicado: ${messageId}`);
      return;
    }

    console.log(`[${instance}] ${phone}: "${message}"`);

    // ── ENRUTADOR POR INSTANCIA ──────────────────────────────────────────────
    if (instance === 'DULCE-LAMA') {
      await handleDulce(phone, message, body);
    } else {
      await handleSofia(phone, message, body);
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── HANDLER DULCE ────────────────────────────────────────────────────────────
async function handleDulce(phone, message, body) {
  const instance = 'DULCE-LAMA';

  // Verificar horario activo
  if (!isDulceActive()) {
    await sendWhatsApp(instance, phone, DULCE_FUERA_HORARIO);
    await logConversation(phone, message, DULCE_FUERA_HORARIO, 'fuera_horario', instance);
    return;
  }

  // Detectar archivos/voice notes
  const hasMedia = body?.data?.message?.audioMessage ||
                   body?.data?.message?.imageMessage ||
                   body?.data?.message?.documentMessage ||
                   body?.data?.message?.videoMessage;

  if (hasMedia) {
    await sendWhatsApp(instance, phone, DULCE_ARCHIVO_REPLY);
    await logConversation(phone, message, DULCE_ARCHIVO_REPLY, 'media_blocked', instance);
    return;
  }

  // Bloqueo médico
  if (isMedical(message)) {
    await sendWhatsApp(instance, phone, DULCE_MEDICAL_REPLY);
    await logConversation(phone, message, DULCE_MEDICAL_REPLY, 'medical_blocked', instance);
    return;
  }

  // Cargar datos del doctor
  const doctor = await getDoctor(instance);
  if (!doctor) {
    await sendWhatsApp(instance, phone, 'Disculpa, estamos teniendo problemas técnicos. Intenta más tarde.');
    return;
  }

  // Historial de conversación
  const sessionKey = `${instance}:${phone}`;
  if (!sessionHistory[sessionKey]) sessionHistory[sessionKey] = [];
  const history = sessionHistory[sessionKey];

  // Llamar a Claude
  const reply = await callClaude(buildDulceSystem(doctor), message, history);

  // Actualizar historial
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: reply });
  if (history.length > 12) history.splice(0, 2);

  // Verificar cupos y registrar si Claude confirmó
  let replyFinal = reply;

  if (citaConfirmada(reply) && !citasRegistradas.has(sessionKey)) {
    const nombre = extractNombre(history);
    const tipo   = extractTipo(reply);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fallbackFecha = tomorrow.toISOString().split('T')[0];
    const fecha  = extractFecha(reply) || fallbackFecha;

    const cupo = await checkCuposScript(fecha, tipo);
    console.log(`🔍 check_cupos response: fecha=${fecha} tipo=${tipo} → ${JSON.stringify(cupo)}`);

    if (cupo.disponible) {
      // Cupo disponible → registrar y confirmar
      citasRegistradas.add(sessionKey);
      console.log(`📋 Registrando cita: ${nombre} · ${tipo} · ${fecha}`);
      registrarCitaDulce(body, nombre, phone, tipo, fecha).catch(console.error);
    } else {
      // Cupo lleno → override del reply, no registrar
      const siguiente = nextDiaHabil(fecha);
      replyFinal =
        `Lo siento, el cupo para *${tipo}* ese día ya está completo 😔\n\n` +
        `El próximo día disponible es *${siguiente.legible}*.\n\n` +
        `¿Te agendo para ese día?`;
      console.log(`⚠️ Cupo lleno: ${tipo} · ${fecha} — ofreciendo ${siguiente.iso}`);
    }
  }

  // Cancelación confirmada por Dulce
  if (cancelacionConfirmada(reply)) {
    const nombre   = extractNombre(history);
    const fecha    = extractFecha(reply);
    const telReply = extractTelefono(reply);
    const telefono = telReply || phone;
    if (fecha) {
      console.log(`🗑️  Cancelando cita: ${nombre} · ${fecha} · ${telefono}`);
      cancelarCitaDulce(telefono, nombre, fecha).catch(console.error);
    }
  }

  await sendWhatsApp(instance, phone, replyFinal);
  await logConversation(phone, message, replyFinal, 'patient', instance);
  console.log(`[DULCE] → "${replyFinal.substring(0, 60)}..."`);
}

// ─── HANDLER SOFIA ────────────────────────────────────────────────────────────
async function handleSofia(phone, message, body) {
  const instance = 'MEDIAIHEALTHY';
  let reply;
  let mode;

  if (isDemo(message)) {
    mode = 'demo';
    await notifyMario(phone, message);

    if (isMedical(message)) {
      reply = '🔒 *Bloqueo médico activo:*\n\n_"Eso es algo que el doctor te explicará en tu cita. ¿Agendamos? 😊"_\n\nEsta barrera protege al médico legalmente. ✅';
      mode  = 'demo_medical';
    } else {
      reply =
        `👋 Hola, soy *Sofia*, el agente IA de MEDIAIHEALTHY.\n\n` +
        `Estás viendo una demo en vivo del sistema de agendamiento con IA. 🏥\n\n` +
        `Prueba:\n` +
        `• *agendar cita* — ver cómo agenda\n` +
        `• *me duele la cabeza* — ver protección médico-legal\n` +
        `• *cancelar cita* — ver gestión\n\n` +
        `¿Qué quieres explorar?`;
    }
  } else if (isMedical(message)) {
    reply = '🔒 Sofia solo agenda citas. Para orientación médica, el doctor te atenderá en tu cita. ¿Agendamos? 😊';
    mode  = 'medical_blocked';
  } else {
    mode = 'patient';
    const sessionKey = `MEDIAIHEALTHY:${phone}`;
    if (!sessionHistory[sessionKey]) sessionHistory[sessionKey] = [];
    const history = sessionHistory[sessionKey];

    reply = await callClaude(buildSofiaSystem(), message, history);

    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 12) history.splice(0, 2);
  }

  await sendWhatsApp(instance, phone, reply);
  await logConversation(phone, message, reply, mode, instance);
  console.log(`[SOFIA] → "${reply.substring(0, 60)}..."`);
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    'MEDIAIHEALTHY Multi-Agent Online ✅',
    version:   '8.1',
    agents:    ['Sofia (MEDIAIHEALTHY)', 'Dulce (DULCE-LAMA)'],
    dulce_active: isDulceActive(),
    time:      new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`MEDIAIHEALTHY Multi-Agent v8.1 — port ${PORT}`);
  console.log(`Claude API: ${ANTHROPIC_KEY ? '✅' : '❌ NOT SET'}`);
  console.log(`Evolution:  ${EVOLUTION_URL ? '✅' : '❌ NOT SET'}`);
  console.log(`Supabase:   ${SUPABASE_URL  ? '✅' : '❌ NOT SET'}`);
  console.log(`Apps Script Dulce: ${APPS_SCRIPT_URL_DULCE ? '✅' : '❌ NOT SET'}`);

  // Precarga doctores
  await loadDoctor('DULCE-LAMA');
  await loadDoctor('MEDIAIHEALTHY');
});
