// ── LoginScreen.jsx ──────────────────────────────────────────────────────
// Login de la plataforma cuando se entra directo a /despachos/ sin sesión.
// Es el MISMO usuario de Supabase Auth que NexusKPI: al ingresar aquí, la
// sesión también queda activa en NexusKPI (y viceversa).
// ─────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { iniciarSesion } from "../../services/authService";

export default function LoginScreen({ onLogin, aviso }) {
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setEnviando(true); setError("");
    try {
      const session = await iniciarSesion(email, pass);
      onLogin(session);
    } catch (ex) {
      setError(ex.message);
      setPass("");
    } finally {
      setEnviando(false);
    }
  };

  const input = { width: "100%", height: 42, padding: "0 12px", fontSize: 14, border: "1px solid #D4E5DE", borderRadius: 9,
    outline: "none", boxSizing: "border-box", color: "#1a2e27", background: "#fff" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      background: "linear-gradient(160deg,#F2F8F5 0%,#F7F9F8 60%)", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <form onSubmit={entrar} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 18,
        border: "1px solid #E2EDE9", boxShadow: "0 20px 50px rgba(15,110,86,0.10)", padding: "30px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="2" rx="1" fill="white"/><rect x="2" y="8" width="14" height="2" rx="1" fill="white"/><rect x="2" y="13" width="9" height="2" rx="1" fill="white"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56" }}>Plataforma L&S</div>
            <div style={{ fontSize: 11, color: "#6B8F80" }}>Portal de Despachos · Inventario de Pasillos</div>
          </div>
        </div>
        {aviso && <div style={{ fontSize: 12, color: "#92600A", background: "#FFFBEB", border: "1px solid #F6D860", borderRadius: 9, padding: "8px 12px", marginBottom: 14 }}>{aviso}</div>}
        <label style={{ fontSize: 12, color: "#6B8F80", fontWeight: 500, display: "block", marginBottom: 5 }}>Correo electrónico</label>
        <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...input, marginBottom: 14 }} placeholder="usuario@empresa.com" />
        <label style={{ fontSize: 12, color: "#6B8F80", fontWeight: 500, display: "block", marginBottom: 5 }}>Contraseña</label>
        <input type="password" required autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} style={{ ...input, marginBottom: 18 }} placeholder="••••••••" />
        <button type="submit" disabled={enviando} style={{ width: "100%", height: 44, border: "none", borderRadius: 10, background: enviando ? "#6FA895" : "#0F6E56",
          color: "#fff", fontSize: 14, fontWeight: 700, cursor: enviando ? "default" : "pointer" }}>
          {enviando ? "Verificando…" : "Ingresar"}
        </button>
        {error && <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "#C0392B", background: "#FFF5F5", border: "1px solid #F5C6C0", borderRadius: 9, padding: "8px 12px" }}>{error}</div>}
        <div style={{ marginTop: 16, fontSize: 11, color: "#9CB8AE", textAlign: "center" }}>Un solo usuario para Despachos, Inventario y NexusKPI</div>
      </form>
    </div>
  );
}
