require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxciR7PDhc_DENoigXZJLcUa3ldGvmYHaPIBh8yOg7-7Qe75cOQ-w10mgPeUT__Wy0c/exec';

// ============================================================
// CONFIGURACIÓN DEL DOCTOR (para modo agente médico)
// ============================================================
const DOCTOR = {
  nombre: 'Dr. Mario Rodriguez',
  especialidad: 'Médico General',
  consultorio: 'Consultorio 3, Santa Paula, Caracas',
  horario: {
    dias: 'Lunes a Viernes',
    manana: '8:00 AM - 12:00 PM',
    tarde: '2:00 PM - 6:00 PM'
  },
  consulta_precio: '$30 - $50 USD',
};

// ============================================================
// PROMPT MODO AGENTE MÉDICO (pacientes reales)
// ============================================================
const PROMPT_AGENTE = `Eres Sofía, la asistente de atención del ${DOCTOR.nombre}, ${DOCTOR.especialidad} en Caracas, Venezuela.

QUIÉN ERES:
Eres un agente de atención cálido, eficiente y natural. Hablas como habla la gente en Venezuela. Profesional pero humano. No suenas a bot ni a menú de opciones.

INFORMACIÓN DEL CONSULTORIO:
- Doctor: ${DOCTOR.nombre}
- Especialidad: ${DOCTOR.especialidad}
- Ubicación: ${DOCTOR.consultorio}
- Horario: ${DOCTOR.horario.dias}, de ${DOCTOR.horario.manana} y de ${DOCTOR.horario.tarde}
- Precio de consulta: ${DOCTOR.consulta_precio} USD (efectivo o transferencia)

CÓMO DEBES HABLAR:
- Escribe como mensaje de WhatsApp real, no como formulario
- Frases cortas y naturales. Sin listas numeradas en conversación normal
- Usa el nombre del paciente cuando lo sepas
- Máximo 1-2 emojis por mensaje
- NUNCA digas "¿En qué puedo ayudarte hoy?" ni des menús numerados
- Varía tus respuestas

FLUJO DE AGENDAMIENTO:
Cuando alguien quiere una cita, conversa naturalmente para obtener:
1. Nombre completo
2. Motivo de consulta — pregunta con empatía
3. Preferencia de turno (mañana o tarde)

Cuando tengas todo, confirma EXACTAMENTE así:
"✅ Cita confirmada
👨‍⚕️ ${DOCTOR.nombre}
📍 ${DOCTOR.consultorio}
📅 [día] - [turno]
💊 Motivo: [motivo]
💰 Consulta: ${DOCTOR.consulta_precio} USD
Le avisamos el día antes para recordarle 😊"

SITUACIONES ESPECIALES:
- Dolor en el pecho, falta de aire, desmayo → urgencias de inmediato
- Fiebre alta o dolor intenso → turno más próximo posible
- Preguntan si eres IA → responde con naturalidad que eres el agente de atención del consultorio
- NUNCA hagas diagnósticos médicos`;

// ============================================================
// PROMPT MODO DEMO MEDIAIHEALTHY (doctores interesados)
// ============================================================
const PROMPT_DEMO = `Eres Sofía, agente comercial de MEDIAIHEALTHY — la plataforma de IA para consultorios médicos en Venezuela.

QUIÉN ERES:
Representas a MEDIAIHEALTHY. Eres directa, entusiasta y conoces el producto a la perfección. Tu objetivo es que el doctor entienda el valor, vea el sistema en acción y quiera contratar.

QUÉ ES MEDIAIHEALTHY:
Una plataforma que ofrece DOS servicios integrados:
1. Sofia — agente IA que atiende pacientes por WhatsApp 24/7
2. Página web médica profesional personalizada para el doctor

PRECIOS:
- Plan Doctores: $1,999 USD/año (solo $5.47 al día)
- Plan Clínicas: $2,999 USD/año (1er doctor) + $1,499 por doctor adicional

QUÉ INCLUYE CADA PLAN:
✓ Sofia atendiendo WhatsApp 24/7
✓ Página web médica personalizada con foto, especialidad, horarios
✓ Google Calendar sincronizado automáticamente
✓ Recordatorios 24h antes a pacientes (reduce no-shows −40%)
✓ Reactivación automática de pacientes inactivos (+$1,500/mes extra)
✓ Pre-screening de síntomas
✓ Dashboard semanal de ingresos por WhatsApp
✓ Encuestas NPS post-consulta
✓ Setup completo por nosotros en 48 horas
✓ Sin trabajo del doctor — solo da su información básica

FLUJO DE DEMO:
Cuando alguien activa el modo demo:

PASO 1 — Bienvenida y propuesta de valor (primer mensaje):
Saluda, presenta MEDIAIHEALTHY brevemente y menciona los DOS servicios. Pregunta si es doctor o trabaja en una clínica.

PASO 2 — Mostrar el sistema en vivo:
Invita al doctor a VIVIR la experiencia: "¿Quiere que le muestre cómo funciona Sofia ahora mismo? Escríbame como si fuera un paciente suyo queriendo agendar una cita."

PASO 3 — Simular agendamiento:
Si el doctor escribe como paciente, entra en modo agente médico y agenda una cita simulada con los datos del doctor interesado. Usa su especialidad si la conoces.

PASO 4 — Cerrar:
Después de la demo, pregunta qué le pareció y ofrece agendar una llamada o enviar más información. Menciona el precio y el ROI: "El sistema se paga solo en 2 semanas con la reducción de no-shows."

CONTACTO PARA CERRAR VENTA:
- Email: mediaihealthyve@gmail.com
- Mario Rodriguez (fundador): disponible para llamada

TONO:
Entusiasta pero profesional. Venezolano natural. Sin exagerar. Los números hablan solos — úsalos.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v3.0 — Modo dual activo', version: '3.0' });
});

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const body = req.body;
    if (body.event !== 'messages.upsert') return;
    if (!body.data?.message) return;

    const msgData = body.data;
    if (msgData.key?.fromMe) return;

    const sender = msgData.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const text = msgData.message?.conversation ||
                 msgData.message?.extendedTextMessage?.text;

    if (!sender || !text) return;
    if (sender.includes('@g.us')) return;

    const senderName = msgData.pushName || sender;
    console.log(`📩 [${senderName}] ${text}`);

    // Buscar o crear conversación
    let conversationId;
    let messages_arr = [];
    let isDemo = false;

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, messages, appointment_status')
      .eq('patient_phone', sender)
      .single();

    if (conv) {
      conversationId = conv.id;
      messages_arr = conv.messages || [];
      // Recordar si esta conversación es modo demo
      isDemo = conv.appointment_status === 'DEMO_MODE';
    } else {
      const { data: newConv, error } = await supabase
        .from('conversations')
        .insert({
          doctor_id: 1,
          patient_phone: sender,
          patient_name: senderName,
          messages: []
        })
        .select()
        .single();

      if (error) throw error;
      conversationId = newConv.id;
      console.log(`✨ Nuevo contacto: ${senderName}`);
    }

    // ── DETECCIÓN DE MODO DEMO ──
    // Si el mensaje contiene "DEMO" (mayúsculas o minúsculas) activa modo demo
    const textUpper = text.toUpperCase().trim();
    const activaDemo = textUpper.includes('DEMO') || 
                       textUpper.includes('MEDIAIHEALTHY') ||
                       textUpper.includes('QUIERO VER') ||
                       textUpper.includes('DEMO GRATIS');

    if (activaDemo && !isDemo) {
      isDemo = true;
      // Marcar conversación como demo
      await supabase
        .from('conversations')
        .update({ appointment_status: 'DEMO_MODE' })
        .eq('id', conversationId);
      console.log(`🎯 Modo DEMO activado para ${senderName}`);
    }

    // Limitar historial
    if (messages_arr.length > 14) {
      messages_arr = messages_arr.slice(-14);
    }

    messages_arr.push({ role: 'user', content: text });

    // Seleccionar prompt según modo
    const systemPrompt = isDemo ? PROMPT_DEMO : PROMPT_AGENTE;
    console.log(`🔄 Modo: ${isDemo ? 'DEMO MEDIAIHEALTHY' : 'AGENTE MÉDICO'}`);

    // Llamar a Claude
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
    });

    const aiResponse = response.content[0].text;
    console.log(`🤖 Sofia [${isDemo ? 'DEMO' : 'AGENTE'}]: ${aiResponse}`);

    messages_arr.push({ role: 'assistant', content: aiResponse });

    await supabase
      .from('conversations')
      .update({
        messages: messages_arr,
        last_message_at: new Date()
      })
      .eq('id', conversationId);

    // Si confirma cita REAL (solo en modo agente)
    if (!isDemo && aiResponse.includes('✅ Cita confirmada')) {
      const turno = text.toLowerCase().includes('tarde') ? 'tarde' : 'manana';
      const motivoMsg = messages_arr.find(m =>
        m.role === 'user' && m.content.length > 5 &&
        !m.content.toLowerCase().includes('hola') &&
        !m.content.toLowerCase().includes('cita')
      );
      const motivo = motivoMsg ? motivoMsg.content.substring(0, 100) : 'Consulta médica';

      await supabase
        .from('appointments')
        .insert({
          doctor_id: 1,
          patient_phone: sender,
          patient_name: senderName,
          status: 'confirmed',
          notes: `Agendado via WhatsApp. Motivo: ${motivo}`
        });

      try {
        await axios.post(APPS_SCRIPT_URL, {
          patientName: senderName,
          patientPhone: sender,
          motivo: motivo,
          turno: turno
        });
        console.log(`📅 Cita en Calendar para ${senderName}`);
      } catch (calErr) {
        console.error('⚠️ Error Calendar:', calErr.message);
      }
    }

    await sendMessage(sender, aiResponse);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
});

// ============================================================
// ENVIAR MENSAJE
// ============================================================
async function sendMessage(phoneNumber, messageText) {
  try {
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      { number: phoneNumber, text: messageText },
      { headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ Enviado a ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error enviando:', error.response?.data || error.message);
  }
}

app.post('/recordatorio', async (req, res) => {
  const { phone, nombre, fecha, hora } = req.body;
  await sendMessage(phone, `Hola ${nombre}, le recuerda Sofia del consultorio del ${DOCTOR.nombre} 😊\n\nSu cita es mañana ${fecha} a las ${hora} en ${DOCTOR.consultorio}.\n\nSi necesita cambiarla, me avisa. ¡Hasta mañana!`);
  res.json({ ok: true });
});

app.post('/reactivar', async (req, res) => {
  const { phone, nombre } = req.body;
  await sendMessage(phone, `Hola ${nombre}, ¿cómo está? 👋\n\nLe escribe Sofia del consultorio del ${DOCTOR.nombre}. Hace tiempo que no sabemos de usted.\n\nSi necesita consulta esta semana tenemos disponibilidad en la mañana y en la tarde. ¿Le interesa que le aparte un turno?`);
  res.json({ ok: true });
});

app.post('/nps', async (req, res) => {
  const { phone, nombre } = req.body;
  await sendMessage(phone, `Hola ${nombre} 😊\n\nEsperamos que se sienta bien después de su consulta con el ${DOCTOR.nombre}.\n\nDel 1 al 5, ¿cómo nos calificaría?\n\n1️⃣ Muy mala  2️⃣ Mala  3️⃣ Regular  4️⃣ Buena  5️⃣ Excelente\n\n¡Gracias por su confianza! 🙏`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 MEDIAIHEALTHY v3.0 — Modo dual activo — Puerto ${PORT}`);
  console.log(`   📱 Agente médico: responde como Sofia del consultorio`);
  console.log(`   🎯 Modo demo: se activa con mensaje "DEMO" o "MEDIAIHEALTHY"`);
});

