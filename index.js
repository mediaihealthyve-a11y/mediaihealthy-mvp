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

// ============================================================
// CONFIGURACIÓN DEL DOCTOR
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
  whatsapp_contacto: '+584126955592'
};

// ============================================================
// SYSTEM PROMPT DEL AGENTE SOFIA
// ============================================================
const SYSTEM_PROMPT = `Eres Sofia, la asistente virtual del ${DOCTOR.nombre}, ${DOCTOR.especialidad}.

INFORMACIÓN DEL CONSULTORIO:
- Doctor: ${DOCTOR.nombre}
- Especialidad: ${DOCTOR.especialidad}
- Ubicación: ${DOCTOR.consultorio}
- Horario: ${DOCTOR.horario.dias}, ${DOCTOR.horario.manana} y ${DOCTOR.horario.tarde}
- Precio de consulta: ${DOCTOR.consulta_precio} USD

TU ROL:
1. Agendar citas médicas con el doctor
2. Informar sobre horarios y disponibilidad
3. Confirmar, reprogramar o cancelar citas
4. Responder preguntas generales sobre el consultorio
5. Hacer pre-screening básico de síntomas para determinar urgencia

REGLAS IMPORTANTES:
- Responde SIEMPRE en español, de forma cálida y profesional
- Sé breve: máximo 3-4 líneas por mensaje
- NUNCA hagas diagnósticos médicos
- Si es una emergencia médica, indica que llame al 911 o vaya a urgencias inmediatamente
- Al agendar cita, solicita: nombre completo, síntoma principal y turno preferido

FLUJO DE AGENDAMIENTO:
1. Paciente solicita cita
2. Preguntas: nombre completo, motivo de consulta, preferencia de turno (mañana 8am-12pm o tarde 2pm-6pm)
3. Confirmas con el formato de confirmación
4. Informas que recibirá un recordatorio 24 horas antes

FORMATO DE CONFIRMACIÓN DE CITA (usa exactamente este formato):
"✅ Cita confirmada
👨‍⚕️ ${DOCTOR.nombre}
📍 ${DOCTOR.consultorio}
📅 [día acordado] - [turno: mañana o tarde]
💊 Motivo: [motivo del paciente]
💰 Consulta: ${DOCTOR.consulta_precio} USD
Le enviaremos un recordatorio mañana. ¡Hasta pronto! 😊"

PRE-SCREENING DE SÍNTOMAS:
- Si menciona dolor en el pecho, dificultad para respirar o pérdida de conciencia → urgencia alta, recomienda urgencias
- Si menciona fiebre alta, vómitos, dolor intenso → prioridad, busca turno lo antes posible
- Síntomas leves → agendamiento normal`;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'MEDIAIHEALTHY running',
    doctor: DOCTOR.nombre,
    version: '2.0'
  });
});

// ============================================================
// WEBHOOK - RECIBE MENSAJES DE EVOLUTION API
// ============================================================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const body = req.body;

    if (body.event !== 'messages.upsert') return;
    if (!body.data?.message) return;

    const msgData = body.data;

    // Ignorar mensajes propios
    if (msgData.key?.fromMe) return;

    // Extraer número y texto
    const sender = msgData.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const text = msgData.message?.conversation ||
                 msgData.message?.extendedTextMessage?.text;

    if (!sender || !text) return;

    // Ignorar grupos
    if (sender.includes('@g.us')) return;

    const senderName = msgData.pushName || sender;
    console.log(`📩 [${senderName}] ${text}`);

    // Buscar o crear conversación
    let conversationId;
    let messages_arr = [];

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, messages')
      .eq('patient_phone', sender)
      .single();

    if (conv) {
      conversationId = conv.id;
      messages_arr = conv.messages || [];
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
      console.log(`✨ Nuevo paciente: ${senderName}`);
    }

    // Mantener solo últimos 10 mensajes
    if (messages_arr.length > 10) {
      messages_arr = messages_arr.slice(-10);
    }

    messages_arr.push({ role: 'user', content: text });

    // Llamar a Claude
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: messages_arr.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const aiResponse = response.content[0].text;
    console.log(`🤖 Sofia: ${aiResponse}`);

    // Guardar conversación
    messages_arr.push({ role: 'assistant', content: aiResponse });

    await supabase
      .from('conversations')
      .update({
        messages: messages_arr,
        last_message_at: new Date()
      })
      .eq('id', conversationId);

    // Si se confirmó una cita, guardarla en appointments
    if (aiResponse.includes('✅ Cita confirmada')) {
      await supabase
        .from('appointments')
        .insert({
          doctor_id: 1,
          patient_phone: sender,
          patient_name: senderName,
          status: 'confirmed',
          notes: `Agendado via WhatsApp. Último mensaje: ${text}`
        });
      console.log(`📅 Cita agendada para ${senderName}`);
    }

    await sendMessage(sender, aiResponse);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
});

// ============================================================
// ENVIAR MENSAJE VIA EVOLUTION API
// ============================================================
async function sendMessage(phoneNumber, messageText) {
  try {
    const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;

    await axios.post(url, {
      number: phoneNumber,
      text: messageText
    }, {
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Enviado a ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error enviando:', error.response?.data || error.message);
  }
}

// ============================================================
// RECORDATORIO MANUAL (para usar desde cron o manualmente)
// ============================================================
app.post('/recordatorio', async (req, res) => {
  const { phone, nombre, fecha, hora } = req.body;

  const mensaje = `🔔 *Recordatorio de Cita*

Hola ${nombre}, le recuerda Sofia del consultorio del ${DOCTOR.nombre}.

📅 Su cita es mañana: ${fecha} a las ${hora}
📍 ${DOCTOR.consultorio}

Si necesita reprogramar, responda este mensaje. ¡Hasta mañana! 😊`;

  await sendMessage(phone, mensaje);
  res.json({ ok: true, mensaje: 'Recordatorio enviado' });
});

// ============================================================
// REACTIVACIÓN DE PACIENTE INACTIVO
// ============================================================
app.post('/reactivar', async (req, res) => {
  const { phone, nombre } = req.body;

  const mensaje = `Hola ${nombre} 👋

Le escribe Sofia, asistente del ${DOCTOR.nombre}. Hace tiempo que no nos visita y queríamos saber cómo está.

Si necesita una consulta, tenemos disponibilidad esta semana:
🕗 Mañana: ${DOCTOR.horario.manana}
🕑 Tarde: ${DOCTOR.horario.tarde}

¿Le gustaría agendar? 😊`;

  await sendMessage(phone, mensaje);
  res.json({ ok: true });
});

// ============================================================
// NPS POST-CONSULTA
// ============================================================
app.post('/nps', async (req, res) => {
  const { phone, nombre } = req.body;

  const mensaje = `Hola ${nombre} 😊

Esperamos que su consulta con el ${DOCTOR.nombre} haya sido de su agrado.

Del 1 al 5, ¿cómo calificaría la atención recibida?
1️⃣ Muy mala
2️⃣ Mala  
3️⃣ Regular
4️⃣ Buena
5️⃣ Excelente

Su opinión nos ayuda a mejorar. ¡Gracias! 🙏`;

  await sendMessage(phone, mensaje);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 MEDIAIHEALTHY v2.0 - ${DOCTOR.nombre} - Puerto ${PORT}`);
});
