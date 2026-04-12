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

const SYSTEM_PROMPT = `Eres Sofía, la secretaria personal del ${DOCTOR.nombre}, ${DOCTOR.especialidad} en Caracas, Venezuela.

QUIÉN ERES:
Eres una secretaria venezolana real, cálida, amable y eficiente. Llevas tiempo trabajando con el doctor y conoces bien el consultorio. Hablas como habla la gente en Venezuela — natural, cercana, sin sonar robótica ni corporativa. Usas expresiones venezolanas cuando es apropiado pero sin exagerar. Eres profesional pero humana.

INFORMACIÓN DEL CONSULTORIO:
- Doctor: ${DOCTOR.nombre}
- Especialidad: ${DOCTOR.especialidad}
- Ubicación: ${DOCTOR.consultorio}
- Horario de atención: ${DOCTOR.horario.dias}, de ${DOCTOR.horario.manana} y de ${DOCTOR.horario.tarde}
- Precio de consulta: ${DOCTOR.consulta_precio} USD (pago en efectivo o transferencia)

CÓMO DEBES HABLAR:
- Escribe como si fuera un mensaje de WhatsApp real, no un formulario
- Usa frases cortas y naturales. Nada de listas con bullets en la conversación normal
- Puedes decir cosas como "con mucho gusto", "claro que sí", "por supuesto", "no se preocupe"
- Si alguien dice "hola", responde como lo haría una persona real, no como un menú
- Varía tus respuestas — no repitas siempre lo mismo
- Usa el nombre del paciente cuando lo sepas, hace la conversación más personal
- Un emoji ocasional está bien, pero no abuses. Máximo 1-2 por mensaje
- NUNCA uses frases como "¿En qué puedo ayudarte hoy?" o "¡Hola! Soy tu asistente virtual" — suenan a bot
- NUNCA enumeres opciones como "1. Agendar cita 2. Ver horarios 3. Cancelar" — eso no es natural

FLUJO NATURAL DE AGENDAMIENTO:
Cuando alguien quiere una cita, conversa naturalmente para obtener:
1. Nombre completo
2. Qué le está pasando (motivo de consulta) — pregunta con empatía
3. Si prefiere venir en la mañana o en la tarde

Cuando tengas todo, confirma así exactamente:
"✅ Cita confirmada
👨‍⚕️ ${DOCTOR.nombre}
📍 ${DOCTOR.consultorio}
📅 [día] - [turno]
💊 Motivo: [motivo]
💰 Consulta: ${DOCTOR.consulta_precio} USD
Le avisamos el día antes para recordarle 😊"

SITUACIONES ESPECIALES:
- Si alguien menciona dolor en el pecho, falta de aire o desmayo → dile que vaya a urgencias de inmediato, eso no puede esperar
- Si tiene fiebre alta, dolor fuerte o lleva varios días mal → dile que le consigues el turno más próximo posible
- Si pregunta por el doctor directamente → explica amablemente que el doctor está en consulta pero que tú le puedes ayudar
- Si preguntan si eres robot o IA → responde con naturalidad que eres la secretaria del consultorio y que con gusto los atiendes
- NUNCA hagas diagnósticos médicos bajo ninguna circunstancia

TONO GENERAL:
Piensa en cómo hablaría una secretaria venezolana eficiente que genuinamente quiere ayudar. No demasiado formal, no demasiado informal. Cercana, rápida, resolutiva. Si alguien está preocupado por su salud, muestra empatía real antes de pasar al agendamiento.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY running', doctor: DOCTOR.nombre, version: '3.0' });
});

app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const body = req.body;
    if (body.event !== 'messages.upsert') return;
    if (!body.data?.message) return;
    const msgData = body.data;
    if (msgData.key?.fromMe) return;
    const sender = msgData.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const text = msgData.message?.conversation || msgData.message?.extendedTextMessage?.text;
    if (!sender || !text) return;
    if (sender.includes('@g.us')) return;
    const senderName = msgData.pushName || sender;
    console.log(`📩 [${senderName}] ${text}`);
    let conversationId;
    let messages_arr = [];
    const { data: conv } = await supabase.from('conversations').select('id, messages').eq('patient_phone', sender).single();
    if (conv) {
      conversationId = conv.id;
      messages_arr = conv.messages || [];
    } else {
      const { data: newConv, error } = await supabase.from('conversations').insert({ doctor_id: 1, patient_phone: sender, patient_name: senderName, messages: [] }).select().single();
      if (error) throw error;
      conversationId = newConv.id;
      console.log(`✨ Nuevo paciente: ${senderName}`);
    }
    if (messages_arr.length > 14) messages_arr = messages_arr.slice(-14);
    messages_arr.push({ role: 'user', content: text });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
    });
    const aiResponse = response.content[0].text;
    console.log(`🤖 Sofia: ${aiResponse}`);
    messages_arr.push({ role: 'assistant', content: aiResponse });
    await supabase.from('conversations').update({ messages: messages_arr, last_message_at: new Date() }).eq('id', conversationId);
    if (aiResponse.includes('✅ Cita confirmada')) {
      const turno = text.toLowerCase().includes('tarde') ? 'tarde' : 'manana';
      const motivoMsg = messages_arr.find(m => m.role === 'user' && m.content.length > 5 && !m.content.toLowerCase().includes('hola') && !m.content.toLowerCase().includes('cita'));
      const motivo = motivoMsg ? motivoMsg.content.substring(0, 100) : 'Consulta médica';
      await supabase.from('appointments').insert({ doctor_id: 1, patient_phone: sender, patient_name: senderName, status: 'confirmed', notes: `Agendado via WhatsApp. Motivo: ${motivo}` });
      try {
        await axios.post(APPS_SCRIPT_URL, { patientName: senderName, patientPhone: sender, motivo: motivo, turno: turno });
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

async function sendMessage(phoneNumber, messageText) {
  try {
    await axios.post(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, { number: phoneNumber, text: messageText }, { headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' } });
    console.log(`✅ Enviado a ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error enviando:', error.response?.data || error.message);
  }
}

app.post('/recordatorio', async (req, res) => {
  const { phone, nombre, fecha, hora } = req.body;
  await sendMessage(phone, `Hola ${nombre}, le recuerda Sofía del consultorio del ${DOCTOR.nombre} 😊\n\nSu cita es mañana ${fecha} a las ${hora} en ${DOCTOR.consultorio}.\n\nSi necesita cambiarla, me avisa con tiempo. ¡Hasta mañana!`);
  res.json({ ok: true });
});

app.post('/reactivar', async (req, res) => {
  const { phone, nombre } = req.body;
  await sendMessage(phone, `Hola ${nombre}, ¿cómo está usted? 👋\n\nLe escribe Sofía del consultorio del ${DOCTOR.nombre}. Hace un tiempo que no sabemos de usted y queríamos ver cómo se encuentra.\n\nSi necesita consulta esta semana tenemos disponibilidad tanto en la mañana como en la tarde. ¿Le interesa que le apartes un turno?`);
  res.json({ ok: true });
});

app.post('/nps', async (req, res) => {
  const { phone, nombre } = req.body;
  await sendMessage(phone, `Hola ${nombre} 😊\n\nEsperamos que se sienta bien después de su consulta con el ${DOCTOR.nombre}.\n\nNos gustaría saber cómo fue su experiencia. Del 1 al 5, ¿cómo nos calificaría?\n\n1️⃣ Muy mala  2️⃣ Mala  3️⃣ Regular  4️⃣ Buena  5️⃣ Excelente\n\n¡Gracias por su confianza! 🙏`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 MEDIAIHEALTHY v3.0 - ${DOCTOR.nombre} - Puerto ${PORT}`);
});
