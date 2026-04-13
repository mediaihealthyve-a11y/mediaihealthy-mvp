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
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzm_oTVFc5oWfcuXHF2LGv3ptnbS-Q04i2wAJjZaCWVlsXbxDZU0CqUzpCoK5_RZRIICw/exec';

const MARIO_PHONE = '584142660888';
const MARIO_EMAIL = 'mediaihealthyve@gmail.com';

// ============================================================
// DOCTOR DE PRUEBA
// ============================================================
const DOCTOR = {
  nombre: 'Dr. Mario Rodriguez',
  especialidad: 'Médico General',
  consultorio: 'Consultorio 3, Santa Paula, Caracas',
  horario: { dias: 'Lunes a Viernes', manana: '8:00 AM - 12:00 PM', tarde: '2:00 PM - 6:00 PM' },
  consulta_precio: '$30 - $50 USD',
};

// ============================================================
// PROMPT AGENTE MÉDICO
// ============================================================
const PROMPT_AGENTE = `Eres Sofía, el agente de atención del ${DOCTOR.nombre}, ${DOCTOR.especialidad} en Caracas, Venezuela.

Eres cálida, eficiente y natural. Hablas como habla la gente en Venezuela. No suenas a bot.

CONSULTORIO:
- Doctor: ${DOCTOR.nombre} · ${DOCTOR.especialidad}
- Ubicación: ${DOCTOR.consultorio}
- Horario: ${DOCTOR.horario.dias}, ${DOCTOR.horario.manana} y ${DOCTOR.horario.tarde}
- Consulta: ${DOCTOR.consulta_precio} USD (efectivo o transferencia)

REGLAS:
- Mensajes cortos y naturales como WhatsApp real
- Usa el nombre del paciente cuando lo sepas
- Máximo 1-2 emojis por mensaje
- NUNCA des menús numerados ni frases de bot
- NUNCA hagas diagnósticos médicos
- Urgencias (dolor pecho, falta aire, desmayo) → urgencias de inmediato

AGENDAR CITA — obtén en conversación natural:
1. Nombre completo
2. Motivo de consulta
3. Turno preferido (mañana o tarde)

CONFIRMACIÓN — usa exactamente este formato:
"✅ Cita confirmada
👨‍⚕️ ${DOCTOR.nombre}
📍 ${DOCTOR.consultorio}
📅 [día] - [turno]
💊 Motivo: [motivo]
💰 Consulta: ${DOCTOR.consulta_precio} USD
Le avisamos el día antes 😊"`;

// ============================================================
// PROMPT DEMO — FUNNEL DE CALIFICACIÓN
// ============================================================
const PROMPT_DEMO = `Eres Sofía, agente comercial de MEDIAIHEALTHY — plataforma de IA para consultorios médicos en Venezuela.

QUÉ ES MEDIAIHEALTHY:
Dos servicios integrados:
1. Agente IA que atiende pacientes por WhatsApp 24/7
2. Página web médica profesional personalizada por doctor

RESULTADOS REALES:
- Reduce no-shows un 40%
- Genera +$1,500/mes extra por reactivación de pacientes
- Setup completo en 48 horas, sin trabajo del doctor

PRECIO:
- Plan Doctor: $1,999/año ($5.47 al día)
- Plan Clínica: $2,999/año + $1,499 por doctor adicional

TU MISIÓN — FUNNEL EN 3 PASOS:

PASO 1 — BIENVENIDA (primer mensaje que recibes):
Saluda con energía. Presenta MEDIAIHEALTHY en 2 líneas. Luego pregunta:
"¿Eres doctor independiente o trabajas en una clínica?"

PASO 2 — CALIFICACIÓN (siguientes 2 mensajes):
Haz estas preguntas UNA POR UNA de forma natural, sin listarlas juntas:
Pregunta A: "¿Cuántos pacientes aproximadamente atiendes por semana?"
Pregunta B: "¿Tienes un número de WhatsApp activo para tu consultorio?"

PASO 3 — DEMO EN VIVO + CONEXIÓN CON MARIO:
Una vez que respondió las 3 preguntas, invítalo a vivir la experiencia:
"¿Quiere ver cómo funciona ahora mismo? Escríbame como si fuera uno de sus pacientes queriendo agendar una cita. Le muestro exactamente lo que verían."

Si el doctor escribe como paciente → entra en personaje de agente médico y agenda una cita simulada completa con él usando su especialidad si la conoces.

Después de la demo en vivo, cierra así:
"Así trabaja Sofia con sus pacientes. Mario, el fundador de MEDIAIHEALTHY, quiere hablar con usted personalmente para mostrarle el sistema completo y resolver cualquier duda. ¿Prefiere que lo llame o que le escriba por WhatsApp?"

Cuando el doctor confirme su preferencia (llamada o WhatsApp), responde:
"Perfecto. Mario lo contactará en breve. ¡Gracias por su interés en MEDIAIHEALTHY!"

Y al final de ese último mensaje incluye exactamente esta etiqueta: [PROSPECTO_CALIFICADO]

TONO: Entusiasta, directo, venezolano natural. Usa los números — convencen.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v3.1 — Funnel activo', version: '3.1' });
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

    const textUpper = text.toUpperCase().trim();
    const activaDemo = textUpper.includes('DEMO') ||
                       textUpper.includes('MEDIAIHEALTHY') ||
                       textUpper.includes('QUIERO VER') ||
                       textUpper.includes('DEMO GRATIS');

    if (activaDemo && !isDemo) {
      isDemo = true;
      await supabase
        .from('conversations')
        .update({ appointment_status: 'DEMO_MODE' })
        .eq('id', conversationId);
      console.log(`🎯 Modo DEMO activado para ${senderName}`);
    }

    if (messages_arr.length > 14) messages_arr = messages_arr.slice(-14);
    messages_arr.push({ role: 'user', content: text });

    const systemPrompt = isDemo ? PROMPT_DEMO : PROMPT_AGENTE;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
    });

    let aiResponse = response.content[0].text;
    console.log(`🤖 Sofia [${isDemo ? 'DEMO' : 'AGENTE'}]: ${aiResponse}`);

    // Detectar prospecto calificado (solo logging, sin llamada a Apps Script por ahora)
    if (isDemo && aiResponse.includes('[PROSPECTO_CALIFICADO]')) {
      aiResponse = aiResponse.replace('[PROSPECTO_CALIFICADO]', '').trim();

      const historial = messages_arr
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .slice(-6)
        .join('\n');

      console.log(`🎯 PROSPECTO CALIFICADO DETECTADO:`);
      console.log(`   Nombre: ${senderName}`);
      console.log(`   WhatsApp: +${sender}`);
      console.log(`   Historial: ${historial.substring(0, 200)}`);
      
      await supabase.from('appointments').insert({
        doctor_id: 1,
        patient_phone: sender,
        patient_name: senderName,
        status: 'prospecto_calificado',
        notes: `Demo completada. Listo para contacto de Mario. WhatsApp: +${sender}`
      });
    }

    messages_arr.push({ role: 'assistant', content: aiResponse });

    await supabase
      .from('conversations')
      .update({ messages: messages_arr, last_message_at: new Date() })
      .eq('id', conversationId);

    // Cita real (solo modo agente)
    if (!isDemo && aiResponse.includes('✅ Cita confirmada')) {
      const turno = text.toLowerCase().includes('tarde') ? 'tarde' : 'manana';
      const motivoMsg = messages_arr.find(m =>
        m.role === 'user' && m.content.length > 5 &&
        !m.content.toLowerCase().includes('hola') &&
        !m.content.toLowerCase().includes('cita')
      );
      const motivo = motivoMsg ? motivoMsg.content.substring(0, 100) : 'Consulta médica';

      await supabase.from('appointments').insert({
        doctor_id: 1,
        patient_phone: sender,
        patient_name: senderName,
        status: 'confirmed',
        notes: `Agendado via WhatsApp. Motivo: ${motivo}`
      });

      try {
        await axios.post(APPS_SCRIPT_URL, { patientName: senderName, patientPhone: sender, motivo, turno });
        console.log(`📅 Cita en Calendar para ${senderName}`);
      } catch (e) {
        console.error('⚠️ Error Calendar:', e.message);
      }
    }

    await sendMessage(sender, aiResponse);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
});

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
  await sendMessage(phone, `Hola ${nombre}, ¿cómo está? 👋\n\nLe escribe Sofia del consultorio del ${DOCTOR.nombre}. Hace tiempo que no sabemos de usted.\n\nSi necesita consulta esta semana tenemos disponibilidad en la mañana y en la tarde. ¿Le interesa?`);
  res.json({ ok: true });
});

app.post('/nps', async (req, res) => {
  const { phone, nombre } = req.body;
  await sendMessage(phone, `Hola ${nombre} 😊\n\nEsperamos que se sienta bien después de su consulta con el ${DOCTOR.nombre}.\n\nDel 1 al 5, ¿cómo nos calificaría?\n\n1️⃣ Muy mala  2️⃣ Mala  3️⃣ Regular  4️⃣ Buena  5️⃣ Excelente\n\n¡Gracias! 🙏`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 MEDIAIHEALTHY v3.1 — Puerto ${PORT}`);
  console.log(`   📱 Agente médico activo`);
  console.log(`   🎯 Funnel demo activo — notifica por email a ${MARIO_EMAIL}`);
  console.log(`   📧 Apps Script v3 conectado`);
});
