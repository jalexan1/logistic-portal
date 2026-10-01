// ── utils/fechas.js ── Formato de fechas en hora Colombia ──────────────────
const TZ = "America/Bogota";

const partes = (d) => {
  const f = new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(d));
  const g = t => f.find(p => p.type === t)?.value || "";
  return { dd: g("day"), mm: g("month"), yyyy: g("year"), HH: g("hour").replace("24", "00"), MI: g("minute") };
};

export const fechaBogota     = (d) => { const p = partes(d); return `${p.dd}/${p.mm}/${p.yyyy}`; };
export const horaBogota      = (d) => { const p = partes(d); return `${p.HH}:${p.MI}`; };
export const fechaHoraBogota = (d) => `${fechaBogota(d)} ${horaBogota(d)}`;
export const isoFechaBogota  = (d) => { const p = partes(d); return `${p.yyyy}-${p.mm}-${p.dd}`; };
