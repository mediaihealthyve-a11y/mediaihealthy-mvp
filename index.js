/**
 * MEDIAIHEALTHY — Sofia WhatsApp Agent
 * Version: 7.0 — Google Calendar + Datos dinámicos del doctor
 * Stack: Node.js 18 / Render / Evolution API / Claude Haiku / Supabase / Apps Script
 *
 * FLUJO:
 *   1. Al arrancar → lee datos del doctor desde Supabase (horarios, precio, dirección)
 *   2. Mensaje entra por webhook de Evolution API
 *   3. Si contiene keyword DEMO → flujo de venta
 *   4. Si es pregunta médica → respuesta fija (Claude nunca la ve)
 *   5. Si es agendamiento → Claude Haiku responde con datos reales del doctor
 *   6. Si Claude confirma una cita → llama al Apps Script → Google Calendar
 *   7. Siempre retorna 200 a Evolution API (nunca 500)
 */

'use strict';

const express          = require('express');
const axios            = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ─── VARIABLES DE ENTORNO ────────────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const EVOLUTION_URL  = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY  = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INST = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY;
const MARIO_PHONE    = process.env.MARIO_PHONE || '584142660888';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── DATOS DEL DOCTOR (se cargan al arrancar) ────────────────────────────────
// Defaults usados si Supabase no tiene datos aún
let doctorData = {
  name:              'Dr. Rodríguez',
  specialty:         'Medicina General',
  address:           'Caracas, Venezuela',
  clinic_name:       'Consultorio',
  schedule_weekday:  'Lunes a Viernes 8:00 AM - 5:00 PM',
  schedule_saturday: 'No disponible',
  schedule_days:     'Lunes a Viernes',
  price:             '$40 USD',
  payment:           'Efectivo, Transferencia',
  phone_number:      '',
};

async function loadDoctorData() {
  try {
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.log('⚠️  Sin doctor en Supabase — usando defaults');
      return;
    }

    // Actualiza solo los campos que existen en la tabla
    doctorData.name              = data.name              || doctorData.name;
    doctorData.specialty         = data.specialty         || doctorData.specialty;
    doctorData.address           = data.address           || doctorData.address;
    doctorData.clinic_name       = data.clinic_name       || doctorData.clinic_name;
    doctorData.schedule_weekday  = data.schedule_weekday  || doctorData.schedule_weekday;
    doctorData.schedule_saturday = data.schedule_saturday || doctorData.schedule_saturday;
    doctorData.schedule_days     = data.schedule_days     || doctorData.schedule_days;
    doctorData.price             = data.price             || doctorData.price;
    doctorData.payment           = data.payment           || doctorData.payment;
    doctorData.phone_number      = data.phone_number      || doctorData.phone_number;

    console.log(`✅ Doctor cargado: ${doctorData.name} — ${doctorData.specialty}`);
  } catch (err) {
    console.error('❌ Error cargando doctor:', err.message);
  }
}

// ─── CLASIFICADOR MÉDICO ─────────────────────────────────────────────────────
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

const DEMO_KEYWORDS = ['demo', 'mediaihealthy', 'demo gratis', 'quiero ver'];

// Respuesta médica fija — siempre usa nombre real del doctor
const getMedicalReplyPatient = () =>
  `Entiendo tu consulta, pero Sofia solo puede ayudarte a agendar, confirmar ` +
  `o cancelar citas. 🗓️\n\n` +
  `Para orientación médica, el ${doctorData.name} te atenderá en tu cita. ` +
  `Si es una emergencia, por favor llama al *171* o ve a la emergencia más cercana. 🏥\n\n` +
  `¿Te ayudo a agendar una cita?`;

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

// Detecta si la respuesta de Claude contiene una cita confirmada
function citaConfirmada(reply) {
  if (!reply) return false;
  const r = reply.toLowerCase();
  return r.includes('cita confirmada') || r.includes('✅') && r.includes('cita');
}

// Extrae el turno del mensaje del paciente (mañana o tarde)
function detectarTurno(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('tarde') || m.includes('3pm') || m.includes('3 pm')) return 'tarde';
  return 'manana'; // default mañana
}

// ─── GOOGLE CALENDAR VIA APPS SCRIPT ─────────────────────────────────────────

async function registrarEnCalendar(patientName, patientPhone, turno) {
  if (!APPS_SCRIPT_URL) {
    console.log('⚠️  APPS_SCRIPT_URL no configurada — skip Calendar');
    return null;
  }

  try {
    const payload = {
      patientName:  patientName  || 'Paciente',
      patientPhone: patientPhone || '',
      motivo:       'Consulta médica',
      turno:        turno || 'manana',
    };

    const response = await axios.post(APPS_SCRIPT_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000,
    });

    const result = response.data;
    if (result?.ok) {
      console.log(`📅 Cita en Calendar: ${result.cita?.fecha} ${result.cita?.hora}`);
      return result.cita;
    } else {
      console.error('❌ Apps Script error:', result?.error);
      return null;
    }
  } catch (err) {
    console.error('❌ Error llamando Apps Script:', err.message);
    return null;
  }
}

// ─── SUPABASE: GUARDAR CITA ──────────────────────────────────────────────────

async function guardarCita(phone, name, turno, citaCalendar) {
  try {
    await supabase.from('appointments').insert({
      patient_phone:    phone,
      patient_name:     name || 'Paciente',
      appointment_date: citaCalendar?.fecha
        ? new Date().toISOString() // Apps Script maneja la fecha real
        : new Date().toISOString(),
      status:           'confirmed',
      notes:            `Turno: ${turno} · ${citaCalendar?.fecha || ''} ${citaCalendar?.hora || ''}`,
      created_at:       new Date().toISOString(),
    });
    console.log(`✅ Cita guardada en Supabase para ${phone}`);
  } catch (err) {
    console.error('Supabase cita error:', err.message);
  }
}

// ─── ENVIAR MENSAJE WHATSAPP ─────────────────────────────────────────────────

async function sendWhatsApp(phone, text) {
  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INST}`;
  await axios.post(
    url,
    { number: phone, text },
    {
      headers: { 'apikey': EVOLUTION_KEY, 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );
}

// ─── LLAMADA A CLAUDE HAIKU ──────────────────────────────────────────────────

// El prompt se construye dinámicamente con los datos reales del doctor
function buildClaudeSystem() {
  return `Eres Sofia, asistente de WhatsApp del consultorio del ${doctorData.name}.
Tu ÚNICA función es gestionar citas médicas.

DATOS DEL CONSULTORIO:
- Doctor: ${doctorData.name} — ${doctorData.specialty}
- Dirección: ${doctorData.address}
- Consultorio: ${doctorData.clinic_name}
- Horario L-V: ${doctorData.schedule_weekday}
- Horario Sábado: ${doctorData.schedule_saturday}
- Días de atención: ${doctorData.schedule_days}
- Precio consulta: ${doctorData.price}
- Formas de pago: ${doctorData.payment}

PUEDES hacer:
- Agendar citas nuevas usando los horarios reales de arriba
- Confirmar citas existentes
- Cancelar o reprogramar citas
- Informar horarios y precio de consulta
- Recordar documentos o requisitos para la cita

CUANDO CONFIRMES UNA CITA incluye siempre:
✅ Cita confirmada
👨‍⚕️ ${doctorData.name}
📍 ${doctorData.address}
📅 [fecha y turno acordado]
💰 ${doctorData.price}

NO PUEDES hacer bajo NINGUNA circunstancia:
- Dar consejos médicos, de salud o de bienestar
- Interpretar síntomas o resultados médicos
- Recomendar medicamentos, dosis o tratamientos
- Hacer diagnósticos o evaluaciones de gravedad

Si el paciente pregunta algo médico, responde EXACTAMENTE:
"Eso es algo que el ${doctorData.name} te explicará en tu cita. ¿Te ayudo a agendar una? 😊"

Tono: Cálido, eficiente, profesional.
Respuestas: Máximo 3 oraciones. Directo al punto.
Idioma: Español venezolano natural. Nunca uses "vosotros".
Emojis: Usa 🗓️ 😊 ✅ con moderación.`;
}

async function callClaude(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system:     buildClaudeSystem(),
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
      mode:         mode,
      created_at:   new Date().toISOString(),
    });
  } catch (err) {
    console.error('Supabase log error:', err.message);
  }
}

// ─── NOTIFICAR A MARIO ───────────────────────────────────────────────────────

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

// Memoria de conversación por teléfono (sesión en memoria, se limpia al reiniciar)
const sessionHistory = {};

app.post('/webhook', async (req, res) => {
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;

    if (isFromMe(body)) return;

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
      await notifyMario(phone, message);

      if (isMedical(message)) {
        reply = MEDICAL_REPLY_DEMO;
        mode  = 'demo_medical';
      } else {
        reply =
          `👋 Hola, soy *Sofia*, el agente IA de MEDIAIHEALTHY.\n\n` +
          `Estás viendo una demostración en vivo del sistema de agendamiento ` +
          `con IA para consultorios médicos. 🏥\n\n` +
          `Puedes probar:\n` +
          `• Escribe *agendar cita* para ver cómo agenda\n` +
          `• Escribe *me duele la cabeza* para ver la protección médico-legal\n` +
          `• Escribe *cancelar cita* para ver la gestión\n\n` +
          `¿Qué quieres explorar primero?`;
      }
    }

    // ── PASO 2: ¿Es pregunta médica? ────────────────────────────────────────
    else if (isMedical(message)) {
      reply = getMedicalReplyPatient();
      mode  = 'medical_blocked';
    }

    // ── PASO 3: Agendamiento → Claude ───────────────────────────────────────
    else {
      mode = 'patient';

      // Historial de conversación (últimos 6 mensajes)
      if (!sessionHistory[phone]) sessionHistory[phone] = [];
      const history = sessionHistory[phone];

      reply = await callClaude(message, history);

      // Actualizar historial
      history.push({ role: 'user',      content: message });
      history.push({ role: 'assistant', content: reply   });
      if (history.length > 12) history.splice(0, 2); // mantener últimos 6 pares

      // ── Si Claude confirmó una cita → Google Calendar ──────────────────
      if (citaConfirmada(reply)) {
        console.log('📅 Cita detectada — registrando en Calendar...');

        // Extraer nombre del historial (primer mensaje del paciente generalmente)
        const patientName = history
          .filter(h => h.role === 'user')
          .map(h => h.content)
          .join(' ')
          .match(/(?:soy|me llamo|nombre es)\s+([A-ZÁÉÍÓÚa-záéíóú]+\s+[A-ZÁÉÍÓÚa-záéíóú]+)/i)?.[1]
          || 'Paciente';

        const turno = detectarTurno(message);

        // Llamar al Apps Script en background (no bloquea la respuesta)
        registrarEnCalendar(patientName, phone, turno).then(citaCalendar => {
          if (citaCalendar) {
            guardarCita(phone, patientName, turno, citaCalendar);
          }
        }).catch(err => console.error('Calendar background error:', err.message));
      }
    }

    await sendWhatsApp(phone, reply);
    await logConversation(phone, message, reply, mode);

    console.log(`[${mode}] → "${reply.substring(0, 60)}..."`);

  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status:  'Sofia online ✅',
    version: '7.0',
    doctor:  doctorData.name,
    time:    new Date().toISOString(),
  });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`Sofia v7.0 running on port ${PORT}`);
  console.log(`Evolution instance: ${EVOLUTION_INST}`);
  console.log(`Supabase: ${SUPABASE_URL ? 'connected' : 'NOT SET'}`);
  console.log(`Claude API: ${ANTHROPIC_KEY ? 'connected' : 'NOT SET'}`);
  console.log(`Apps Script: ${APPS_SCRIPT_URL ? 'connected' : 'NOT SET'}`);

  // Cargar datos del doctor al arrancar
  await loadDoctorData();
});
