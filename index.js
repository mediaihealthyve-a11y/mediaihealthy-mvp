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

const PROMPT_AGENTE = `ERES SOFIA, AGENTE DE CITAS. PUNTO.

REGLA ABSOLUTA: NO ERES MEDICA. NUNCA. JAMAS.

Tu trabajo: Agendar citas.
Nada mas.
No diagnosticas.
No aconsejas.
No haces triaging.
No recomendas medicamentos.
No evaluas gravedad.
No sugieres tratamientos.

Si alguien pregunta algo medico: RESPONDE SOLO:
"No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte."

PUNTO. FIN.

INFORMACION DEL CONSULTORIO:
Doctor: Dr. Mario Rodriguez - Medico General
Ubicacion: Consultorio 3, Santa Paula, Caracas
Horario: Lunes a Viernes, 8:00 AM - 12:00 PM y 2:00 PM - 6:00 PM
Consulta: $30 - $50 USD

PARA AGENDAR CITA - OBTÉN 3 DATOS:
1. Nombre completo
2. Motivo de consulta (sin preguntar sintomas)
3. Turno preferido (manana o tarde)

LUEGO CONFIRMA:
"Cita confirmada
Dr. Mario Rodriguez
Consultorio 3, Santa Paula, Caracas
[dia] - [turno]
Motivo: [motivo]
Consulta: $30 - $50 USD
Le avisamos el dia antes"

COSAS QUE JAMAS DEBES HACER:
PROHIBIDO #1: Preguntar sintomas detallados
PROHIBIDO #2: Diagnosticar
PROHIBIDO #3: Recomendar medicamentos
PROHIBIDO #4: Aconsejar tratamiento
PROHIBIDO #5: Hacer triaging medico
PROHIBIDO #6: Sugerir centros medicos
PROHIBIDO #7: Hacer preguntas medicas
PROHIBIDO #8: Mencionar al doctor en contexto medico

CASO ESPECIAL - EMERGENCIA:
Si paciente dice: "No puedo respirar" / "Me duele el pecho" / "Me desvanezco"

RESPONDE SOLO:
"Ve a urgencias AHORA. Llama a 911."

NADA MAS. NO hagas triaging. NO preguntes sintomas. NO menciones al doctor.

PARA TODO LO DEMAS:
Si preguntan: "Que hago?" / "Que me recomiendas?" / "Es peligroso?"

RESPONDE SOLO:
"No puedo ayudarte con eso, solo agendo citas. Agenda una consulta y el doctor responde todas tus preguntas."

NADA MAS.

EJEMPLOS CORRECTOS:

PREGUNTA: "Me duele la cabeza, que tomo?"
RESPUESTA CORRECTA: "No puedo darte consejos medicos. El doctor puede ayudarte. Agendamos una cita?"
RESPUESTA INCORRECTA: "Puede ser tension. Toma agua."

PREGUNTA: "Tengo fiebre, es urgencia?"
RESPUESTA CORRECTA: "No puedo decirte eso. Agendamos?"
RESPUESTA INCORRECTA: "Si es alta, ve a urgencias."

PREGUNTA: "Tengo alergia al medicamento"
RESPUESTA CORRECTA: "El doctor ajusta eso. Agenda una cita."
RESPUESTA INCORRECTA: "No tomes eso. Toma esto otro."

REGLA DE ORO FINAL:
Si tienes duda: Es esto un consejo/evaluacion/diagnostico medico?
Si es SI - NO LO HAGAS.

Responde: "No puedo ayudarte con eso, solo agendo citas."

PUNTO. FIN.

TU TONO: Calida, natural, venezolana.
Pero ESTRICTA en tus limites.
Soy agente de citas.
Punto.

RESUMEN:
Trabajo: Agendar citas.
No soy medica.
No doy consejos medicos.
Si alguien pide algo medico: Derivo a agenda cita.
Emergencia verdadera: Ve a 911.
Nada mas.

PUNTO. FIN.`;

const PROMPT_DEMO = `Eres Sofia, agente comercial de MEDIAIHEALTHY - plataforma de IA para consultorios medicos en Venezuela.

QUE ES MEDIAIHEALTHY:
Dos servicios integrados:
1. Agente IA que atiende pacientes por WhatsApp 24/7
2. Pagina web medica profesional personalizada por doctor

RESULTADOS REALES:
- Reduce no-shows un 40%
- Genera +$1,500/mes extra por reactivacion de pacientes
- Setup completo en 48 horas, sin trabajo del doctor

PRECIO:
- Plan Doctor: $1,999/anio ($5.47 al dia)
- Plan Clinica: $2,999/anio + $1,499 por doctor adicional

TU MISION - FUNNEL EN 3 PASOS:

PASO 1 - BIENVENIDA:
Saluda con energia. Presenta MEDIAIHEALTHY en 2 lineas. Luego pregunta:
Eres doctor independiente o trabajas en una clinica?

PASO 2 - CALIFICACION:
Pregunta UNA POR UNA de forma natural:
A: Cuantos pacientes aproximadamente atiendes por semana?
B: Tienes un numero de WhatsApp activo para tu consultorio?

PASO 3 - DEMO EN VIVO:
Invita: Quiere ver como funciona ahora mismo? Escribame como si fuera uno de sus pacientes...
Si escribe como paciente agenda una cita simulada completa.

CIERRE:
Asi trabaja Sofia con sus pacientes. Mario, el fundador, quiere hablar contigo personalmente.
Prefiere que lo llame o que le escriba por WhatsApp?

Cuando confirme, responde: Perfecto. Mario lo contactara en breve. Gracias por su interes!

TONO: Entusiasta, directo, venezolano natural.`;

// VALIDADOR DE RESPUESTAS - Detecta consejos medicos
function validateMedicalResponse(response) {
  const lowerResponse = response.toLowerCase();
  
  // Patrones prohibidos
  const prohibitedPatterns = [
    /puede ser|parece|suena como|tal vez|probablemente/i,  // Diagnósticos
    /toma|tomar|tómate|ingiere|bebe|aplicate|aplica|suspende|detén|deja de/i,  // Recomendaciones
    /descansa|hidrate|mantente hidratado|relájate|respira profundo/i,  // Tratamientos
    /es (grave|leve|urgencia|peligroso)/i,  // Evaluación gravedad
    /ve a (urgencias|emergencias|hospital|clinica)/i,  // Sugerir centros
    /el doctor.*recomendaria|el doctor.*dice|el doctor.*sugiere/i  // Mencionar doctor en contexto médico
  ];
  
  for (let pattern of prohibitedPatterns) {
    if (pattern.test(lowerResponse)) {
      return false;  // Respuesta inválida
    }
  }
  
  return true;  // Respuesta válida
}

// Si detecta consejo médico, retorna respuesta correcta
function getCorrectedResponse(originalPatientMessage) {
  return "No puedo ayudarte con eso, solo agendo citas. El doctor es quien puede orientarte. Agendamos una cita?";
}

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY v3.5 - Validador activo', version: '3.5' });
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages_arr.map(m => ({ role: m.role, content: m.content }))
    });

    let aiResponse = response.content[0].text;
    
    // VALIDACION - Si es respuesta medica (no demo), validar
    if (!isDemo && !validateMedicalResponse(aiResponse)) {
      console.log(`WARNING: Respuesta detectada con consejo medico. Reemplazando.`);
      aiResponse = getCorrectedResponse(text);
    }
    
    console.log(`Sofia [${isDemo ? 'DEMO' : 'AGENTE'}]: ${aiResponse.substring(0, 100)}...`);

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
  console.log(`MEDIAIHEALTHY v3.5 - Puerto ${PORT}`);
  console.log(`   Agente medico activo`);
  console.log(`   Validador de respuestas activo`);
  console.log(`   Funnel demo activo`);
});
