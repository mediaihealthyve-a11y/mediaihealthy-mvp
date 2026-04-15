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

// VALIDADOR MEDICO - Detecta preguntas medicas
function isMedicalQuestion(text) {
  const medicalKeywords = [
    'duele', 'dolor', 'fiebre', 'sintoma', 'alergia', 'medicamento',
    'que tomo', 'que hago', 'es peligroso', 'es urgencia', 'es grave',
    'enfermedad', 'tratamiento', 'diagnostico', 'inyeccion', 'pastilla',
    'toma', 'tomar', 'ingiere', 'bebe', 'aplicate', 'suspende',
    'descansa', 'hidrate', 'relaja', 'respira profundo', 've a urgencias',
    've a emergencias', 'hospital', 'clinica de emergencia', 'puede ser',
    'parece', 'suena como', 'tal vez', 'probablemente', 'critica',
    'mortal', 'grave', 'leve', 'infeccion', 'virus', 'bacteria',
    'apendicitis', 'asma', 'diabetes', 'presion', 'colesterol'
  ];

  const lowerText = text.toLowerCase();
  return medicalKeywords.some(keyword => lowerText.includes(keyword));
}

// RESPUESTA AUTOMATICA PARA PREGUNTAS MEDICAS
function getMedicalRejection() {
  return "No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte. Agendamos una cita?";
}

const PROMPT_AGENTE = `ERES SOFIA, AGENTE DE CITAS. SOLO AGENDAS CITAS. NADA MAS.

TU UNICA FUNCION: Agendar citas medicas.

INFORMACION DEL CONSULTORIO:
Doctor: Dr. Mario Rodriguez - Medico General
Ubicacion: Consultorio 3, Santa Paula, Caracas
Horario: Lunes a Viernes, 8:00 AM - 12:00 PM y 2:00 PM - 6:00 PM
Precio consulta: $30 - $50 USD

PARA AGENDAR CITA - OBTÉN 3 DATOS EN CONVERSACIÓN NATURAL:
1. Nombre completo del paciente
2. Motivo de la consulta (sin preguntar sintomas detalles)
3. Turno preferido (manana o tarde)

CONFIRMACIÓN DE CITA - RESPONDE EXACTAMENTE ASI:
Cita confirmada
Dr. Mario Rodriguez
Consultorio 3, Santa Paula, Caracas
[dia] - [turno]
Motivo: [motivo]
Consulta: $30 - $50 USD
Le avisamos el dia antes

TU TONO: Calida, natural, venezolana. Amable pero profesional.

EJEMPLOS DE CONVERSACION:
Usuario: Quiero agendar cita
Respuesta: Perfecto! Te ayudo. Cual es tu nombre completo?

Usuario: Me duele la cabeza
Respuesta: Entiendo. Cual es tu nombre? Una vez que agende la cita, el doctor te evalua.

Usuario: Cuanto cuesta la consulta?
Respuesta: La consulta cuesta $30 - $50 USD. Agendamos una cita?

REGLA IMPORTANTE: Tu objetivo es agendar. Si no tienes los 3 datos, sigue pidiendo hasta tenerlos. Luego confirma y lista.`;

const PROMPT_DEMO = `Eres Sofia, agente comercial de MEDIAIHEALTHY.

Tu mision: Calificar prospectos (doctors) en 3 pasos.

PASO 1: Presentate y pregunta si es doctor independiente o clinica.
PASO 2: Pregunta cuantos pacientes atiende/semana y si tiene WhatsApp.
PASO 3: Invita a ver demo en vivo agendando una cita simulada.

Si termina bien: Dale WhatsApp de Mario para contacto.

Tono: Entusiasta, directo, venezolano.`;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v5.0 - Validador Medico Activo', version: '5.0' });
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

    // VALIDACION MEDICA - INTERCEPTAR ANTES DE CLAUDE
    let aiResponse;
    
    if (!isDemo && isMedicalQuestion(text)) {
      // Pregunta medica detectada - NO pasar a Claude
      aiResponse = getMedicalRejection();
      console.log(`WARNING: Pregunta medica detectada. Rechazada sin Claude.`);
    } else {
      // Pregunta segura - Pasar a Claude
      if (messages_arr.length > 14) messages_arr = messages_arr.slice(-14);
      messages_arr.push({ role: 'user', content: text });

      const systemPrompt = isDemo ? PROMPT_DEMO : PROMPT_AGENTE;

      const response = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 500,
        system: systemPrompt,
        messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
      });

      aiResponse = response.content[0].text;
      console.log(`Sofia [${isDemo ? 'DEMO' : 'AGENTE'}]: ${aiResponse.substring(0, 100)}...`);

      if (isDemo && aiResponse.includes('[PROSPECTO_CALIFICADO]')) {
        aiResponse = aiResponse.replace('[PROSPECTO_CALIFICADO]', '').trim();
        console.log(`PROSPECTO CALIFICADO DETECTADO: ${senderName}`);
        
        try {
          await supabase.from('appointments').insert({
            patient_phone: sender,
            patient_name: senderName,
            status: 'prospecto_calificado',
            notes: `Demo completada. WhatsApp: +${sender}`
          });
        } catch (e) {
          console.error(`Error guardando prospecto: ${e.message}`);
        }
      }
    }

    // Guardar respuesta
    if (!isMedicalQuestion(text) || isDemo) {
      messages_arr.push({ role: 'assistant', content: aiResponse });
      await supabase
        .from('conversations')
        .update({ messages: messages_arr, last_message_at: new Date() })
        .eq('id', conversationId);
    }

    // Agendar cita si esta confirmada
    if (!isDemo && aiResponse.includes('Cita confirmada')) {
      const turno = text.toLowerCase().includes('tarde') ? 'tarde' : 'manana';
      const motivo = text.substring(0, 100);

      await supabase.from('appointments').insert({
        patient_phone: sender,
        patient_name: senderName,
        status: 'confirmed',
        notes: `Agendado via WhatsApp`
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
  console.log(`MEDIAIHEALTHY v5.0 - Puerto ${PORT}`);
  console.log(`   Validador Medico activo`);
  console.log(`   Preguntas medicas rechazadas automaticamente`);
  console.log(`   Claude solo ve mensajes seguros`);
});
