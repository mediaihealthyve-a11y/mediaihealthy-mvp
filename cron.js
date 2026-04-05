// MEDIAIHEALTHY - Cron Jobs Master
// Ejecuta los 3 scripts en horarios específicos
// Reactivación: Cada lunes 9 AM
// Recordatorios: Cada 1 hora
// NPS: Cada 2 horas

const cron = require("node-cron");

// Importar funciones de los scripts
const { reactivarPacientesDormidos } = require("./scripts/reactivacion");
const { enviarRecordatorios } = require("./scripts/recordatorios");
const { enviarNPS } = require("./scripts/nps");

console.log("🚀 MEDIAIHEALTHY Cron Jobs iniciado...");

// CRON 1: Reactivación - Cada lunes a las 9 AM (0 9 * * 1)
cron.schedule("0 9 * * 1", async () => {
  console.log("📅 Ejecutando: Reactivación de pacientes dormidos (Lunes 9 AM)...");
  try {
    const result = await reactivarPacientesDormidos();
    console.log("✅ Reactivación completada:", result);
  } catch (error) {
    console.error("❌ Error en reactivación:", error.message);
  }
});

// CRON 2: Recordatorios - Cada 1 hora (0 * * * *)
cron.schedule("0 * * * *", async () => {
  console.log("⏰ Ejecutando: Recordatorios de citas (Cada 1 hora)...");
  try {
    const result = await enviarRecordatorios();
    console.log("✅ Recordatorios completados:", result);
  } catch (error) {
    console.error("❌ Error en recordatorios:", error.message);
  }
});

// CRON 3: NPS - Cada 2 horas (0 */2 * * *)
cron.schedule("0 */2 * * *", async () => {
  console.log("⭐ Ejecutando: Encuestas NPS (Cada 2 horas)...");
  try {
    const result = await enviarNPS();
    console.log("✅ NPS completado:", result);
  } catch (error) {
    console.error("❌ Error en NPS:", error.message);
  }
});

console.log("✅ Cron Jobs configurados y esperando...");
console.log("📅 Reactivación: Cada lunes 9 AM");
console.log("⏰ Recordatorios: Cada 1 hora");
console.log("⭐ NPS: Cada 2 horas");
