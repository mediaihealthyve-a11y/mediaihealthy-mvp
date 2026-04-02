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

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'MEDIAIHEALTHY running' });
});

// Webhook: Meta verifica que es nuestro
app.get('/webhook', (req, res) => {
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Unauthorized');
  }
});

// Webhook: Meta envía mensajes
app.post('/webhook', async (req, res) => {
  const body = req.body;
  
  // Meta espera un 200 inmediato
  res.status(200).json({ received: true });
  
  try {
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages || [];
    const contacts = body.entry?.[0]?.changes?.[0]?.value?.contacts || [];
    
    for (const msg of messages) {
      // Solo mensajes de texto
      if (msg.type !== 'text') continue;
      
      const sender = msg.from;
      const text = msg.text.body;
      
      const contact = contacts.find(c => c.wa_id === sender);
      const senderName = contact?.profile?.name || sender;
      
      console.log(`Mensaje de ${senderName}: ${text}`);
      
      // Guardar en Supabase
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
        // Primera vez: crear conversación
        const { data: newConv, error } = await supabase
          .from('conversations')
          .insert({
            doctor_id: 1, // Por ahora hardcoded
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
Tu rol: agendas citas, responden preguntas sobre disponibilidad, y son profesionales.
Responde SIEMPRE en español, de forma breve (1-2 mensajes máximo).
NO prometas cosas que el doctor no puede hacer.
Nunca hagas diagnosis médica.`,
        messages: messages_arr.map(m => ({
          role: m.role,
          content: m.content
        }))
      });
      
      const aiResponse = response.content[0].text;
      
      console.log(`Respuesta: ${aiResponse}`);
      
      // Agregar respuesta a array
      messages_arr.push({ role: 'assistant', content: aiResponse });
      
      // Actualizar en Supabase
      await supabase
        .from('conversations')
        .update({ messages: messages_arr, last_message_at: new Date() })
        .eq('id', conversationId);
      
      // Enviar respuesta a Meta
      await sendMessage(sender, aiResponse);
      
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
});

// Función para enviar mensaje por WhatsApp
async function sendMessage(phoneNumber, messageText) {
  const url = `https://graph.instagram.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'text',
    text: { body: messageText }
  };
  
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Message sent:', response.data.message_id);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

app.listen(PORT, () => {
  console.log(`MEDIAIHEALTHY server running on port ${PORT}`);
});
