// MEDIAIHEALTHY - NPS + Google Reviews
// Ejecutar: Cada 2 horas
// Función: Encuesta NPS después de cita, invitar Google Review si 9-10

const { Anthropic } = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

// CREDENCIALES
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function enviarNPS() {
  try {
    console.log("⭐ Enviando encuestas NPS...");

    // LEER CITAS COMPLETADAS (status = "completada")
    const { data: citasCompletadas, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("status", "completada")
      .is("nps_sent", null);

    if (error) throw error;

    console.log(`📊 Citas completadas sin NPS: ${citasCompletadas.length}`);

    // ENVIAR NPS A CADA UNA
    for (const cita of citasCompletadas) {
      const mensaje = `¿Qué tal tu cita? Califica del 1 al 10 tu experiencia.`;
      await enviarWhatsApp(cita.patient_phone, mensaje);

      // Marcar que se envió NPS
      await supabase
        .from("appointments")
        .update({ nps_sent: true, nps_sent_at: new Date() })
        .eq("id", cita.id);

      console.log(`✓ NPS enviado a ${cita.patient_name}`);

      // Guardar evento
      await supabase.from("events").insert({
        doctor_id: cita.doctor_id,
        event_type: "nps_sent",
        data: { appointment_id: cita.id },
      });
    }

    console.log(`✅ NPS completado. ${citasCompletadas.length} encuestas enviadas.`);
    return { success: true, nps_enviados: citasCompletadas.length };
  } catch (error) {
    console.error("❌ Error en NPS:", error.message);
    return { success: false, error: error.message };
  }
}

async function procesarRespuestaNPS(numeroPaciente, respuesta) {
  try {
    console.log(`📥 Respuesta NPS recibida: ${respuesta}`);

    const puntuacion = parseInt(respuesta);

    if (puntuacion >= 9) {
      const enlaceGoogle = `https://search.google.com/local/reviews?placeid=GOOGLE_PLACE_ID`;
      const mensajeReview = `¡Qué bueno saber que te fue bien! Nos encantaría que dejaras tu opinión en Google. ${enlaceGoogle}`;
      await enviarWhatsApp(numeroPaciente, mensajeReview);

      console.log(`⭐ Invitación Google Review enviada a ${numeroPaciente}`);
    } else if (puntuacion <= 6) {
      const mensajeFeedback = `Sentimos que no fue la mejor experiencia. ¿Cómo podemos mejorar? Cuéntanos.`;
      await enviarWhatsApp(numeroPaciente, mensajeFeedback);

      console.log(`⚠️ Feedback solicitado a ${numeroPaciente}`);
    }

    return { success: true, puntuacion };
  } catch (error) {
    console.error("❌ Error procesando NPS:", error.message);
    return { success: false, error: error.message };
  }
}

async function enviarWhatsApp(numeroPaciente, mensaje) {
  try {
    await axios.post(
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

    console.log(`✓ Mensaje NPS enviado a ${numeroPaciente}`);
  } catch (error) {
    console.error(`✗ Error enviando WhatsApp:`, error.message);
  }
}

enviarNPS();

module.exports = { enviarNPS, procesarRespuestaNPS };
