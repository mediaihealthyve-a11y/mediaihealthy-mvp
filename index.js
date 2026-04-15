/**
 * MEDIAIHEALTHY — Sofia WhatsApp Agent
 * Version: 6.0 — Clasificador Médico + Demo Mode
 * Stack: Node.js 18 / Render / Evolution API / Claude Haiku / Supabase
 *
 * FLUJO:
 *   1. Mensaje entra por webhook de Evolution API
 *   2. Si contiene keyword DEMO → flujo de venta (muestra el bloqueo como feature)
 *   3. Si es pregunta médica → respuesta fija (Claude nunca la ve)
 *   4. Si es agendamiento → Claude Haiku responde
 *   5. Siempre retorna 200 a Evolution API (nunca 500)
 */

'use strict';

const express    = require('express');
const axios      = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
app.use(express.json());

// ─── VARIABLES DE ENTORNO ────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3000;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
const EVOLUTION_URL    = process.env.EVOLUTION_API_URL;   // https://evolution-api-production-6aa1.up.railway.app
const EVOLUTION_KEY    = process.env.EVOLUTION_API_KEY;   // 63bb6e5e10152f3d7e1721799f916d1e57c86bb0a1b816eb8809d7771672c0cc
const EVOLUTION_INST   = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';
const SUPABASE_URL     = process.env.SUPABASE_URL;        // https://zihqojazdehslsngrssg.supabase.co
const SUPABASE_KEY     = process.env.SUPABASE_ANON_KEY;
const MARIO_PHONE      = process.env.MARIO_PHONE || '584142660888'; // número de ventas de Mario

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CLASIFICADOR MÉDICO ─────────────────────────────────────────────────────
// Palabras clave en español venezolano. Sin regex, solo .includes().
const MEDICAL_KEYWORDS = [
  'dolor', 'me duele', 'duele', 'fiebre', 'temperatura',
  'síntoma', 'síntomas', 'sangr', 'vomit', 'mareo', 'náusea', 'nausea',
  'diagnóstic', 'diagnóstico', 'tratamiento', 'medicament', 'medicina',
  'pastilla', 'pastillas', 'dosis', 'qué tengo', 'que tengo',
  'qué me pasa', 'que me pasa', 'es grave', 'debería tomar', 'deberia tomar',
  'me siento mal', 'tengo tos', 'presión alta', 'presion alta',
  'azúcar', 'azucar', 'diabetes', 'infección', 'infeccion', 'alergi',
  'receta', 'examen', 'análisis', 'analisis', 'resultado', 'me recomienda'
];

// Keywords que activan el modo DEMO (para prospectos/doctores evaluando el producto)
const DEMO_KEYWORDS = ['demo', 'mediaihealthy', 'demo gratis', 'quiero ver'];

// Respuesta médica fija — paciente real bloqueado
const MEDICAL_REPLY_PATIENT =
  'Entiendo tu consulta, pero Sofia solo puede ayudarte a agendar, confirmar ' +
  'o cancelar citas. 🗓️\n\n' +
  'Para orientación médica, el Dr. Mario Rodríguez te atenderá en tu cita. ' +
  'Si es una emergencia, por favor llama al *171* o ve a la emergencia más cercana. 🏥\n\n' +
  '¿Te ayudo a agendar una cita?';

// Respuesta médica en modo DEMO — muestra la feature al prospecto
const MEDICAL_REPLY_DEMO =
  '🔒 *Aquí verías el bloqueo médico de Sofia:*\n\n' +
  '_"Entiendo tu consulta, pero Sofia solo puede ayudarte a agendar citas. ' +
  'Para orientación médica, el doctor te atenderá en tu cita. ' +
  'Si es emergencia, llama al 171. ¿Agendamos una cita?"_\n\n' +
  'Esta barrera protege al médico de responsabilidad legal. ' +
  'Sofia *nunca* da consejos médicos, sin importar cómo le pregunte el paciente. ✅\n\n' +
  '¿Quieres ver cómo Sofia agenda una cita? Escribe: *agendar cita*';

// ─── FUNCIONES AUXILIARES ────────────────────────────────────────────────────

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

function extractMessage(body) {
  // Evolution API puede mandar el texto en dos lugares distintos
  return (
    body?.data?.message?.conversation ||
    body?.data?.message?.extendedTextMessage?.text ||
    ''
  ).trim();
}

function extractPhone(body) {
  // remoteJid viene como "584XXXXXXXXX@s.whatsapp.net"
  const jid = body?.data?.key?.remoteJid || '';
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

function isFromMe(body) {
  return body?.data?.key?.fromMe === true;
}

// ─── ENVIAR MENSAJE WHATSAPP ─────────────────────────────────────────────────

async function sendWhatsApp(phone, text) {
  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INST}`;
  await axios.post(
    url,
    {
      number: phone,
      text:   text,
    },
    {
      headers: {
        'apikey':       EVOLUTION_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );
}

// ─── LLAMADA A CLAUDE HAIKU ──────────────────────────────────────────────────

const CLAUDE_SYSTEM = `Eres Sofia, asistente de WhatsApp del consultorio del Dr. Mario Rodríguez.
Tu ÚNICA función es gestionar citas médicas.

PUEDES hacer:
- Agendar citas nuevas
- Confirmar citas existentes
- Cancelar o reprogramar citas
- Informar horarios disponibles del doctor
- Recordar documentos o requisitos para la cita

NO PUEDES hacer bajo NINGUNA circunstancia:
- Dar consejos médicos, de salud o de bienestar
- Interpretar síntomas o resultados médicos
- Recomendar medicamentos, dosis o tratamientos
- Hacer diagnósticos o evaluaciones de gravedad
- Opinar sobre si algo es urgente desde el punto de vista médico

Si por alguna razón el paciente pregunta algo médico, responde EXACTAMENTE:
"Eso es algo que el Dr. Rodríguez te explicará en tu cita. ¿Te ayudo a agendar una? 😊"

Tono: Cálido, eficiente, profesional.
Respuestas: Máximo 3 oraciones. Directo al punto.
Idioma: Español venezolano natural. Nunca uses "vosotros".
Emojis: Usa 🗓️ 😊 ✅ con moderación.`;

async function callClaude(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     CLAUDE_SYSTEM,
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

  return response.data?.content?.[0]?.text || 'Disculpa, tuve un problema. ¿Puedes repetir tu mensaje?';
}

// ─── SUPABASE: GUARDAR CONVERSACIÓN ─────────────────────────────────────────

async function logConversation(phone, userMessage, sofiaReply, mode) {
  try {
    await supabase.from('conversations').insert({
      phone:        phone,
      user_message: userMessage,
      sofia_reply:  sofiaReply,
      mode:         mode,           // 'patient' | 'demo' | 'medical_blocked' | 'demo_medical'
      created_at:   new Date().toISOString(),
    });
  } catch (err) {
    // Silencioso — un error de logging no debe cortar el flujo
    console.error('Supabase log error:', err.message);
  }
}

// ─── NOTIFICAR A MARIO (prospecto calificado) ────────────────────────────────

async function notifyMario(phone, message) {
  try {
    const text =
      `🚨 *Nuevo prospecto DEMO MEDIAIHEALTHY*\n\n` +
      `📱 Número: +${phone}\n` +
      `💬 Mensaje: "${message}"\n\n` +
      `Contactar para seguimiento de venta.`;
    await sendWhatsApp(MARIO_PHONE, text);
  } catch (err) {
    console.error('Error notificando a Mario:', err.message);
  }
}

// ─── WEBHOOK PRINCIPAL ───────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  // Siempre responde 200 primero — Evolution API no debe esperar
  // y no debe reintentar si tarda
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;

    // Ignorar mensajes enviados por Sofia misma
    if (isFromMe(body)) return;

    // Ignorar eventos que no son mensajes de texto
    const event = body?.event;
    if (event && event !== 'messages.upsert') return;

    const phone   = extractPhone(body);
    const message = extractMessage(body);

    if (!phone || !message) return;

    console.log(`[${new Date().toISOString()}] ${phone}: "${message}"`);

    let reply;
    let mode;

    // ── PASO 1: ¿Es modo DEMO? ──────────────────────────────────────────────
    if (isDemo(message)) {
      mode = 'demo';

      // Notificar a Mario de prospecto nuevo
      await notifyMario(phone, message);

      // Si el prospecto además pregunta algo médico, mostrar el bloqueo como feature
      if (isMedical(message)) {
        reply = MEDICAL_REPLY_DEMO;
        mode  = 'demo_medical';
      } else {
        // Funnel DEMO: presentación de Sofia
        reply =
          '👋 Hola, soy *Sofia*, el agente IA de MEDIAIHEALTHY.\n\n' +
          'Estás viendo una demostración en vivo del sistema de agendamiento ' +
          'con IA para consultorios médicos. 🏥\n\n' +
          'Puedes probar:\n' +
          '• Escribe *agendar cita* para ver cómo agenda\n' +
          '• Escribe *me duele la cabeza* para ver la protección médico-legal\n' +
          '• Escribe *cancelar cita* para ver la gestión\n\n' +
          '¿Qué quieres explorar primero?';
      }
    }

    // ── PASO 2: ¿Es pregunta médica? (paciente real) ────────────────────────
    else if (isMedical(message)) {
      reply = MEDICAL_REPLY_PATIENT;
      mode  = 'medical_blocked';
      // Claude NUNCA ve este mensaje
    }

    // ── PASO 3: Agendamiento normal → Claude ────────────────────────────────
    else {
      mode  = 'patient';
      reply = await callClaude(message);
    }

    // Enviar respuesta por WhatsApp
    await sendWhatsApp(phone, reply);

    // Guardar en Supabase (no bloquea si falla)
    await logConversation(phone, message, reply, mode);

    console.log(`[${mode}] → "${reply.substring(0, 60)}..."`);

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // No retornamos nada — ya enviamos el 200 al inicio
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status:  'Sofia online ✅',
    version: '6.0',
    time:    new Date().toISOString(),
  });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Sofia v6.0 running on port ${PORT}`);
  console.log(`Evolution instance: ${EVOLUTION_INST}`);
  console.log(`Supabase: ${SUPABASE_URL ? 'connected' : 'NOT SET'}`);
  console.log(`Claude API: ${ANTHROPIC_KEY ? 'connected' : 'NOT SET'}`);
});
