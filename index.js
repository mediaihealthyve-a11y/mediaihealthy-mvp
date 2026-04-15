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
  skip: (req) => {
    return req.path === '/webhook';
  }
});
app.use(limiter);

const client = new Anthropic();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const DOCTOR = {
  nombre: 'Dr. Mario Rodriguez',
  especialidad: 'Medico General',
  consultorio: 'Consultorio 3, Santa Paula, Caracas',
  horario: { dias: 'Lunes a Viernes', manana: '8:00 AM - 12:00 PM', tarde: '2:00 PM - 6:00 PM' },
  consulta_precio: '$30 - $50 USD',
};

const PROMPT_AGENTE = `ERES SOFIA, AGENTE DE CITAS. SOLO AGENDAS CITAS. NADA MAS.

NO ERES MEDICA. JAMAS DIAGNOSTICAS, ACONSEJAS O HACES TRIAGING.

Si alguien pregunta algo medico: RESPONDE SOLO:
"No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte."

INFORMACION:
Doctor: Dr. Mario Rodriguez - Medico General
Ubicacion: Consultorio 3, Santa Paula, Caracas
Horario: Lunes a Viernes, 8:00 AM - 12:00 PM y 2:00 PM - 6:00 PM
Consulta: $30 - $50 USD

PARA AGENDAR: Obtén nombre, motivo (sin preguntar sintomas), turno.

CONFIRMACION:
Cita confirmada
Dr. Mario Rodriguez
Consultorio 3, Santa Paula, Caracas
[dia] - [turno]
Motivo: [motivo]
Consulta: $30 - $50 USD
Le avisamos el dia antes

PROHIBIDO: Diagnosticar, recomendar medicamentos, aconsejar tratamiento, evaluar gravedad, sugerir centros medicos, preguntar sintomas, mencionar doctor en contexto medico.

EMERGENCIA (No puedo respirar / Me duele el pecho / Me desvanezco):
RESPONDE SOLO: Ve a urgencias AHORA. Llama a 911.

EJEMPLOS:
Pregunta: Me duele la cabeza, que tomo?
Respuesta CORRECTA: No puedo darte consejos medicos. El doctor puede ayudarte. Agendamos una cita?
Respuesta INCORRECTA: Puede ser tension. Toma agua.

Pregunta: Tengo alergia al medicamento
Respuesta CORRECTA: El doctor ajusta eso. Agenda una cita.
Respuesta INCORRECTA: No tomes eso. Toma esto otro.

REGLA DE ORO: Si la pregunta es sobre salud, sintomas, medicamentos o tratamiento - NUNCA ACONSEJES. SOLO AGENDA CITA.

Tu tono: Calida, natural, venezolana. Pero ESTRICTA con tus limites.`;

const PROMPT_DEMO = `Eres Sofia, agente comercial de MEDIAIHEALTHY - plataforma de IA para consultorios medicos en Venezuela.

QUE ES MEDIAIHEALTHY:
Dos servicios:
1. Agente IA que atiende pacientes por WhatsApp 24/7
2. Pagina web medica profesional personalizada

RESULTADOS:
- Reduce no-shows un 40%
- Genera +$1,500/mes extra
- Setup completo en 48 horas

PRECIO:
- Plan Doctor: $1,999/anio
- Plan Clinica: $2,999/anio + $1,499 por doctor

FUNNEL EN 3 PASOS:
1. BIENVENIDA: Presenta MEDIAIHEALTHY. Pregunta: Eres doctor independiente o trabajas en clinica?
2. CALIFICACION: Cuantos pacientes atiendes/semana? Tienes WhatsApp para consultorio?
3. DEMO: Quiere ver como funciona? Escribame como paciente. Agenda cita simulada.

CIERRE: Asi trabaja Sofia. Mario quiere hablar contigo. Prefiere llamada o WhatsApp?
Si confirma: Perfecto. Mario lo contactara en breve. Gracias!

TONO: Entusiasta, directo, venezolano.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v4.0 - Haiku activo', version: '4.0', model: 'haiku' });
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
    const text = msgData.message?.conversation ||
                 msgData.message?.extendedTextMessage?.text;

    if (!sender || !text) return;
    if (sender.includes('@g.us')) return;

    const senderName = msgData.pushName || sender;
    console.log(`[${senderName}] ${text}`);

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
      console.log(`Nuevo contacto: ${senderName}`);
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
      console.log(`Modo DEMO activado para ${senderName}`);
    }

    if (messages_arr.length > 14) messages_arr = messages_arr.slice(-14);
    messages_arr.push({ role: 'user', content: text });

    const systemPrompt = isDemo ? PROMPT_DEMO : PROMPT_AGENTE;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
    });

    let aiResponse = response.content[0].text;
    console.log(`Sofia [${isDemo ? 'DEMO' : 'AGENTE'} - HAIKU]: ${aiResponse.substring(0, 100)}...`);

    if (isDemo && aiResponse.includes('[PROSPECTO_CALIFICADO]')) {
      aiResponse = aiResponse.replace('[PROSPECTO_CALIFICADO]', '').trim();
      const historial = messages_arr
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .slice(-6)
        .join('\n');

      console.log(`PROSPECTO CALIFICADO DETECTADO:`);
      console.log(`   Nombre: ${senderName}`);
      console.log(`   WhatsApp: +${sender}`);
      
      try {
        await supabase.from('appointments').insert({
          patient_phone: sender,
          patient_name: senderName,
          status: 'prospecto_calificado',
          notes: `Demo completada. Listo para contacto de Mario. WhatsApp: +${sender}`
        });
        console.log(`Prospecto guardado en Supabase`);
      } catch (e) {
        console.error(`Error guardando prospecto: ${e.message}`);
      }
    }

    messages_arr.push({ role: 'assistant', content: aiResponse });

    await supabase
      .from('conversations')
      .update({ messages: messages_arr, last_message_at: new Date() })
      .eq('id', conversationId);

    if (!isDemo && aiResponse.includes('Cita confirmada')) {
      const turno = text.toLowerCase().includes('tarde') ? 'tarde' : 'manana';
      const motivoMsg = messages_arr.find(m =>
        m.role === 'user' && m.content.length > 5 &&
        !m.content.toLowerCase().includes('hola') &&
        !m.content.toLowerCase().includes('cita')
      );
      const motivo = motivoMsg ? motivoMsg.content.substring(0, 100) : 'Consulta medica';

      await supabase.from('appointments').insert({
        patient_phone: sender,
        patient_name: senderName,
        status: 'confirmed',
        notes: `Agendado via WhatsApp. Motivo: ${motivo}`
      });

      try {
        await axios.post(APPS_SCRIPT_URL, { patientName: senderName, patientPhone: sender, motivo, turno });
        console.log(`Cita en Calendar para ${senderName}`);
      } catch (e) {
        console.error('Error Calendar:', e.message);
      }
    }

    await sendMessage(sender, aiResponse);

  } catch (error) {
    console.error('Error:', error.message);
  }
});

async function sendMessage(phoneNumber, messageText) {
  try {
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      { number: phoneNumber, text: messageText },
      { headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );
    console.log(`Enviado a ${phoneNumber}`);
  } catch (error) {
    console.error('Error enviando:', error.response?.data || error.message);
  }
}

app.post('/recordatorio', async (req, res) => {
  const { phone, nombre, fecha, hora } = req.body;
  await sendMessage(phone, `Hola ${nombre}, le recuerda Sofia del consultorio del ${DOCTOR.nombre}\n\nSu cita es manana ${fecha} a las ${hora} en ${DOCTOR.consultorio}.\n\nSi necesita cambiarla, me avisa. Hasta manana!`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`MEDIAIHEALTHY v4.0 - Puerto ${PORT}`);
  console.log(`   Modelo: Claude Haiku (más estricto)`);
  console.log(`   Agente medico activo`);
  console.log(`   Funnel demo activo`);
});
