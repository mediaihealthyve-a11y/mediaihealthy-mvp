// MEDIAIHEALTHY - Reactivación de Pacientes Dormidos
// Ejecutar: Cada lunes 9 AM
// Función: Buscar pacientes sin cita hace 90+ días, generar mensaje personalizado, enviar WhatsApp

const { Anthropic } = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

// CREDENCIALES (desde env vars)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Inicializar clientes
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function reactivarPacientesDormidos() {
  try {
    console.log("🔄 Iniciando reactivación de pacientes dormidos...");

    const { data: patients, error } = await supabase
      .from("conversations")
      .select("patient_phone, patient_name, last_message_at, doctor_id")
      .neq("last_message_at", null);

    if (error) throw error;

    // FILTRAR DORMIDOS (90+ días sin interacción)
    const hoy = new Date();
    const hace90Dias = new Date(hoy.getTime() - 90 * 24 * 60 * 60 * 1000);

    const dormidos = patients.filter((p) => {
      const lastDate = new Date(p.last_message_at);
      return lastDate < hace90Dias;
    });

    console.log(`📊 Pacientes dormidos encontrados: ${dormidos.length}`);

    // LIMITAR A 5 INTENTOS POR DÍA
    const aEnviar = dormidos.slice(0, 5);

    // PARA CADA PACIENTE: GENERAR MENSAJE + ENVIAR
    for (const patient of aEnviar) {
      const prompt = `Eres un asistente de WhatsApp para un consultorio médico en Venezuela.
      
Paciente: ${patient.patient_name}
Última interacción: hace más de 90 días

Genera un mensaje CORTO (máximo 2 líneas), amigable y personal que invite al paciente a agendar una cita.
NO incluyas saludo ni despedida. Solo el mensaje directo.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      });

      const mensajePersonalizado =
        message.content[0].type === "text" ? message.content[0].text : "";

      console.log(`📱 Enviando a ${patient.patient_name}...`);

      await enviarWhatsApp(patient.patient_phone, mensajePersonalizado);

      await supabase.from("events").insert({
        doctor_id: patient.doctor_id,
        event_type: "reactivation_sent",
        data: {
          patient_phone: patient.patient_phone,
          patient_name: patient.patient_name,
          message: mensajePersonalizado,
          sent_at: new Date(),
        },
      });

      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`✅ Reactivación completada. ${aEnviar.length} mensajes enviados.`);
    return { success: true, sent: aEnviar.length };
  } catch (error) {
    console.error("❌ Error en reactivación:", error.message);
    return { success: false, error: error.message };
  }
}

async function enviarWhatsApp(numeroPaciente, mensaje) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: numeroPaciente.replace(/\D/g, ""),
        type: "text",
        text: { body: mensaje },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✓ Mensaje enviado a ${numeroPaciente}`);
    return response.data;
  } catch (error) {
    console.error(`✗ Error enviando WhatsApp a ${numeroPaciente}:`, error.message);
    throw error;
  }
}

reactivarPacientesDormidos();
