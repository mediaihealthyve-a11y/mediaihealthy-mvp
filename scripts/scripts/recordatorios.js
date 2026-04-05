// MEDIAIHEALTHY - Recordatorios de Citas
// Ejecutar: Cada 1 hora
// Función: Recordatorio 48h antes, confirmación 2h antes, lista de espera si no confirman

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

async function enviarRecordatorios() {
  try {
    console.log("⏰ Verificando citas próximas...");

    // LEER CITAS CONFIRMADAS
    const { data: citas, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("status", "confirmada");

    if (error) throw error;

    const ahora = new Date();

    // FILTRAR CITAS EN 48h Y 2h
    const citasEn48h = citas.filter((c) => {
      const fechaCita = new Date(`${c.appointment_date}T${c.appointment_time}`);
      const horasRestantes = (fechaCita - ahora) / (1000 * 60 * 60);
      return horasRestantes > 46 && horasRestantes <= 48;
    });

    const citasEn2h = citas.filter((c) => {
      const fechaCita = new Date(`${c.appointment_date}T${c.appointment_time}`);
      const horasRestantes = (fechaCita - ahora) / (1000 * 60 * 60);
      return horasRestantes > 1.5 && horasRestantes <= 2;
    });

    console.log(`📅 Recordatorios 48h: ${citasEn48h.length}`);
    console.log(`⏱️ Confirmaciones 2h: ${citasEn2h.length}`);

    // ENVIAR RECORDATORIO 48h
    for (const cita of citasEn48h) {
      const mensaje = `Recordatorio: Tu cita está confirmada para ${cita.appointment_date} a las ${cita.appointment_time}. ¿Alguna pregunta?`;
      await enviarWhatsApp(cita.patient_phone, mensaje);

      await supabase.from("events").insert({
        doctor_id: cita.doctor_id,
        event_type: "recordatorio_48h",
        data: { appointment_id: cita.id, sent_at: new Date() },
      });
    }

    // ENVIAR CONFIRMACIÓN 2h
    for (const cita of citasEn2h) {
      const mensaje = `¡Tu cita es en 2 horas! Responde SÍ para confirmar o NO si no puedes ir.`;
      await enviarWhatsApp(cita.patient_phone, mensaje);

      await supabase.from("events").insert({
        doctor_id: cita.doctor_id,
        event_type: "confirmacion_2h",
        data: { appointment_id: cita.id, sent_at: new Date() },
      });
    }

    // MARCAR CITAS SIN CONFIRMACIÓN COMO NO-SHOW
    const citasPasadas = citas.filter((c) => {
      const fechaCita = new Date(`${c.appointment_date}T${c.appointment_time}`);
      return fechaCita < ahora && !c.confirmada;
    });

    for (const cita of citasPasadas) {
      await supabase
        .from("appointments")
        .update({ status: "no-show", notes: "No confirmó 2h antes" })
        .eq("id", cita.id);

      await supabase.from("events").insert({
        doctor_id: cita.doctor_id,
        event_type: "no_show",
        data: { appointment_id: cita.id },
      });

      console.log(`❌ No-show registrado: ${cita.patient_name}`);
    }

    console.log(`✅ Recordatorios completados.`);
    return { success: true, recordatorios48h: citasEn48h.length, confirmaciones2h: citasEn2h.length };
  } catch (error) {
    console.error("❌ Error en recordatorios:", error.message);
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

    console.log(`✓ Recordatorio enviado a ${numeroPaciente}`);
  } catch (error) {
    console.error(`✗ Error enviando WhatsApp:`, error.message);
  }
}

enviarRecordatorios();
