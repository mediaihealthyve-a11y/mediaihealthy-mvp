require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar clientes
const client = new Anthropic();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Evolution API config
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL; // https://evolution-api-production-6aa1.up.railway.app
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY; // tu API key global
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'MEDIAIHEALTHY';

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY running con Evolution API' });
});

// Webhook: Evolution API envía mensajes aquí
app.post('/webhook', async (req, res) => {
  // Responder 200 inmediato siempre
  res.status(200).json({ received: true });

  try {
    const body = req.body;

    // Solo procesar mensajes entrantes de texto
    if (body.event !== 'messages.upsert') return;
    if (!body.data?.message) return;

    const msgData = body.data;

    // Ignorar mensajes propios (enviados por el bot)
    if (msgData.key?.fromMe) return;

    // Extraer número y texto
    const sender = msgData.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const text = msgData.message?.conversation || 
                 msgData.message?.extendedTextMessage?.text;

    if (!sender || !text) return;

    const senderName = msgData.pushName || sender;

    console.log(`📩 Mensaje de ${senderName} (${sender}): ${text}`);

    // Buscar o crear conversación en Supabase
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
    }

    // Agregar mensaje del usuario
    messages_arr.push({ role: 'user', content: text });

    // Llamar a Claude
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `Eres MEDIAIHEALTHY, un asistente de IA para consultorio médico en Venezuela.
Tu rol: agendar citas, responder preguntas sobre disponibilidad, ser profesional y amable.
Responde SIEMPRE en español, de forma breve y clara (máximo 2-3 oraciones).
NO hagas diagnósticos médicos.
NO prometas cosas que el doctor no puede hacer.`,
      messages: messages_arr.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const aiResponse = response.content[0].text;
    console.log(`🤖 Respuesta Claude: ${aiResponse}`);

    // Guardar respuesta en Supabase
    messages_arr.push({ role: 'assistant', content: aiResponse });

    await supabase
      .from('conversations')
      .update({ messages: messages_arr, last_message_at: new Date() })
      .eq('id', conversationId);

    // Enviar respuesta por Evolution API
    await sendMessage(sender, aiResponse);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
});

// Enviar mensaje via Evolution API
async function sendMessage(phoneNumber, messageText) {
  try {
    const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;

    const payload = {
      number: phoneNumber,
      text: messageText
    };

    const response = await axios.post(url, payload, {
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Mensaje enviado a ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 MEDIAIHEALTHY corriendo en puerto ${PORT}`);
});
