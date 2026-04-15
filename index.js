require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Demasiadas solicitudes',
  skip: (req) => req.path === '/webhook'
});
app.use(limiter);

const client = new Anthropic();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const DOCTOR = {
  nombre: 'Dr. Mario Rodriguez',
  especialidad: 'Medico General',
  consultorio: 'Consultorio 3, Santa Paula, Caracas',
  horario: { dias: 'Lunes a Viernes', manana: '8:00 AM - 12:00 PM', tarde: '2:00 PM - 6:00 PM' },
  consulta_precio: '$30 - $50 USD'
};

// VALIDADOR SIMPLE Y SEGURO
function isMedicalQuestion(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  const keywords = ['duele', 'dolor', 'fiebre', 'sintoma', 'alergia', 'medicamento', 'que tomo', 'es peligroso', 'que hago', 'enfermedad', 'tratamiento', 'pastilla', 'inyeccion', 'infeccion'];
  
  for (let i = 0; i < keywords.length; i++) {
    if (lower.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  return false;
}

const PROMPT_AGENTE = `Eres Sofia, agente de citas del Dr. Mario Rodriguez.

Solo agendas citas. No das consejos medicos.

Si preguntan algo medico: "No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte."

Para agendar: nombre, motivo, turno.

Confirmacion:
Cita confirmada
Dr. Mario Rodriguez
Consultorio 3, Santa Paula, Caracas
[dia] - [turno]
Motivo: [motivo]
Consulta: $30 - $50 USD
Le avisamos el dia antes

Tu tono: Calida, natural, venezolana.`;

const PROMPT_DEMO = `Eres Sofia, agente de MEDIAIHEALTHY.

Funnel: 1) Presenta. 2) Califica. 3) Demo.

Tono: Entusiasta, directo.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v5.1 - Validador Activo', version: '5.1' });
});

app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const body = req.body;
    if (!body.event || body.event !== 'messages.upsert') return;
    if (!body.data || !body.data.message) return;

    const msgData = body.data;
    if (msgData.key && msgData.key.fromMe) return;

    const sender = msgData.key && msgData.key.remoteJid ? msgData.key.remoteJid.replace('@s.whatsapp.net', '') : null;
    if (!sender) return;

    const text = (msgData.message && msgData.message.conversation) || (msgData.message && msgData.message.extendedTextMessage && msgData.message.extendedTextMessage.text) || null;
    if (!text) return;

    if (sender.includes('@g.us')) return;

    const senderName = msgData.pushName || sender;
    console.log(`[${senderName}] ${text}`);

    let conversationId;
    let messages_arr = [];
    let isDemo = false;

    const { data: conv } = await supabase.from('conversations').select('id, messages, appointment_status').eq('patient_phone', sender).single().catch(() => ({ data: null }));

    if (conv) {
      conversationId = conv.id;
      messages_arr = conv.messages || [];
      isDemo = conv.appointment_status === 'DEMO_MODE';
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        doctor_id: 1,
        patient_phone: sender,
        patient_name: senderName,
        messages: []
      }).select().single().catch(() => ({ data: null }));

      if (!newConv) return;
      conversationId = newConv.id;
    }

    const textUpper = text.toUpperCase().trim();
    if ((textUpper.includes('DEMO') || textUpper.includes('MEDIAIHEALTHY') || textUpper.includes('QUIERO VER') || textUpper.includes('DEMO GRATIS')) && !isDemo) {
      isDemo = true;
      await supabase.from('conversations').update({ appointment_status: 'DEMO_MODE' }).eq('id', conversationId).catch(() => {});
    }

    let aiResponse = '';

    // VALIDACION MEDICA
    if (!isDemo && isMedicalQuestion(text)) {
      aiResponse = "No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte.";
      console.log(`VALIDADOR: Pregunta medica rechazada`);
    } else {
      // PASAR A CLAUDE
      messages_arr.push({ role: 'user', content: text });

      const systemPrompt = isDemo ? PROMPT_DEMO : PROMPT_AGENTE;

      const response = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 500,
        system: systemPrompt,
        messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
      });

      aiResponse = response.content && response.content[0] && response.content[0].text ? response.content[0].text : 'Error procesando mensaje';
      console.log(`Sofia [${isDemo ? 'DEMO' : 'AGENTE'}]: OK`);
    }

    // Guardar en Supabase
    messages_arr.push({ role: 'assistant', content: aiResponse });
    await supabase.from('conversations').update({ messages: messages_arr, last_message_at: new Date() }).eq('id', conversationId).catch(() => {});

    // Enviar por WhatsApp
    await axios.post(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, { number: sender, text: aiResponse }, {
      headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' }
    }).catch(e => console.error('Error WhatsApp:', e.message));

  } catch (error) {
    console.error('Error:', error.message);
  }
});

app.listen(PORT, () => {
  console.log(`MEDIAIHEALTHY v5.1 - Puerto ${PORT}`);
});
