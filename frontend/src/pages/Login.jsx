import { useState, useRef, useEffect } from "react";

import { api } from "../api";

import { useAuth } from "../contexts/AuthContext";

import FirstLoginSetup from "./FirstLoginSetup";

import {
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

const STEP = { LOGIN: "LOGIN", OTP: "OTP" };

export default function Login() {
  const { login } = useAuth();

  const [step, setStep] = useState(STEP.LOGIN);

  const [setupData, setSetupData] = useState(null);

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [tempToken, setTempToken] = useState("");

  const [twoFactorMethod, setTwoFactorMethod] = useState("");

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef([]);

  const brandLogo = "/logo%20HotWhats.png";

  const tempTokenRef = useRef("");

  useEffect(() => {
    tempTokenRef.current = tempToken || "";
  }, [tempToken]);

  // Countdown para reenvio de OTP

  useEffect(() => {
    if (countdown <= 0) return;

    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);

    return () => clearTimeout(t);
  }, [countdown]);

  // Auto-focus no primeiro campo de OTP ao entrar no step

  useEffect(() => {
    if (step === STEP.OTP) {
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");

    setLoading(true);

    try {
      const res = await api.post("/auth/login", { email, password });

      // First-login setup flow

      if (res.data.requiresSetup) {
        setSetupData({ setupToken: res.data.setupToken, step: res.data.step });

        return;
      }

      const directToken = String(res.data.token || "").trim();

      if (directToken) {
        login(directToken, res.data.user);

        const role = String(res.data.user?.role || "").toLowerCase();

        setTempToken("");

        tempTokenRef.current = "";

        setStep(STEP.LOGIN);

        window.location.replace(role === "user" ? "/conta" : "/dashboard");

        return;
      }

      const nextTempToken = String(res.data.tempToken || "").trim();

      if (!nextTempToken) {
        setError("Sessao de verificacao ausente. Tente entrar novamente.");

        setTempToken("");

        tempTokenRef.current = "";

        setStep(STEP.LOGIN);

        return;
      }

      tempTokenRef.current = nextTempToken;

      setTempToken(nextTempToken);

      setTwoFactorMethod(res.data.twoFactorMethod);

      setStep(STEP.OTP);

      setCountdown(60);
    } catch (err) {
      setError(err.response?.data?.error || "Erro ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) {
      // Paste handling

      const digits = value.replace(/\D/g, "").slice(0, 6).split("");

      const newOtp = [...otp];

      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });

      setOtp(newOtp);

      otpRefs.current[Math.min(index + digits.length, 5)]?.focus();

      return;
    }

    if (!/^\d?$/.test(value)) return;

    const newOtp = [...otp];

    newOtp[index] = value;

    setOtp(newOtp);

    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();

    const code = otp.join("");

    if (code.length < 6) {
      setError("Digite o código completo de 6 dígitos.");
      return;
    }

    setError("");

    setLoading(true);

    try {
      const currentTempToken = String(
        tempTokenRef.current || tempToken || "",
      ).trim();

      if (!currentTempToken) {
        setError("Sessão de verificação perdida. Faça login novamente.");

        setTempToken("");

        setStep(STEP.LOGIN);

        return;
      }

      const res = await api.post("/auth/verify", {
        tempToken: currentTempToken,
        code,
      });

      login(res.data.token, res.data.user);

      const role = String(res.data.user?.role || "").toLowerCase();

      window.location.replace(role === "user" ? "/conta" : "/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Código inválido ou expirado.");

      setOtp(["", "", "", "", "", ""]);

      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;

    setError("");

    setLoading(true);

    try {
      const res = await api.post("/auth/login", { email, password });

      if (res.data?.token) {
        login(res.data.token, res.data.user);

        const role = String(res.data.user?.role || "").toLowerCase();

        setTempToken("");

        tempTokenRef.current = "";

        setStep(STEP.LOGIN);

        window.location.replace(role === "user" ? "/conta" : "/dashboard");

        return;
      }

      const nextTempToken = String(res.data.tempToken || "").trim();

      if (!nextTempToken) {
        setError("Sessao de verificacao ausente. Tente entrar novamente.");

        setTempToken("");

        tempTokenRef.current = "";

        setStep(STEP.LOGIN);

        return;
      }

      tempTokenRef.current = nextTempToken;

      setTempToken(nextTempToken);

      setOtp(["", "", "", "", "", ""]);

      setCountdown(60);
    } catch {
      setError("Erro ao reenviar. Volte e tente logar novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Se precisar de setup (primeiro login ou sem 2FA), mostra o fluxo guiado

  if (setupData) {
    return (
      <FirstLoginSetup
        setupToken={setupData.setupToken}
        startStep={setupData.step}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",

        background:
          "radial-gradient(ellipse at top left, rgba(93, 183, 44, 0.12) 0%, #09271b 50%, rgba(93, 183, 44, 0.06) 100%)",

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        padding: "20px",

        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Background grid effect */}

      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,

          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",

          backgroundSize: "50px 50px",

          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,

          width: "100%",
          maxWidth: "420px",
        }}
      >
        {/* Logo / Brand */}

        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",

              width: "64px",
              height: "64px",
              borderRadius: "18px",

              background: "#ffffff",

              boxShadow: "0 0 40px rgba(93, 183, 44, 0.18)",

              marginBottom: "20px",
            }}
          >
            <img src={brandLogo} alt="Menzzu" style={{ width: "38px", height: "38px", objectFit: "contain" }} />
          </div>

          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#ffffff",
              fontFamily: "'Outfit', sans-serif",
              marginBottom: "6px",
            }}
          >
            Menzzu
          </h1>

          <p style={{ color: "#d4d4d8", fontSize: "14px" }}>
            {step === STEP.LOGIN
              ? "Entre na sua conta para continuar"
              : "Verificação de segurança"}
          </p>
        </div>

        {/* Card */}

        <div
          style={{
            background: "rgba(18, 18, 20, 0.82)",

            backdropFilter: "blur(20px)",

            border: "1px solid rgba(255,255,255,0.06)",

            borderRadius: "24px",

            padding: "36px",

            boxShadow: "0 25px 50px rgba(0,0,0,0.46)",
          }}
        >
          {step === STEP.LOGIN ? (
            <form onSubmit={handleLogin}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                {/* Email ou usuario */}

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#d4d4d8",
                      marginBottom: "8px",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Email ou nome de usuario
                  </label>

                  <div style={{ position: "relative" }}>
                    <Mail
                      size={16}
                      color="#d4d4d8"
                      style={{
                        position: "absolute",
                        left: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />

                    <input
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="seu@email.com ou usuario"
                      autoComplete="username"
                      style={{
                        width: "100%",
                        padding: "13px 14px 13px 40px",

                        borderRadius: "12px",
                        fontSize: "14px",

                        background: "rgba(255,255,255,0.06)",

                        border: "1px solid rgba(255,255,255,0.12)",

                        color: "#ffffff",
                        outline: "none",

                        transition: "border-color 0.2s",
                      }}
                      onFocus={(e) => (e.target.style.borderColor = "#5db72c")}
                      onBlur={(e) =>
                        (e.target.style.borderColor = "rgba(255,255,255,0.12)")
                      }
                    />
                  </div>
                </div>

                {/* Password */}

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#d4d4d8",
                      marginBottom: "8px",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Senha
                  </label>

                  <div style={{ position: "relative" }}>
                    <Lock
                      size={16}
                      color="#d4d4d8"
                      style={{
                        position: "absolute",
                        left: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />

                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Digite sua senha"
                      autoComplete="current-password"
                      style={{
                        width: "100%",
                        padding: "13px 14px 13px 40px",

                        borderRadius: "12px",
                        fontSize: "14px",

                        background: "rgba(255,255,255,0.06)",

                        border: "1px solid rgba(255,255,255,0.12)",

                        color: "#ffffff",
                        outline: "none",

                        transition: "border-color 0.2s",
                      }}
                      onFocus={(e) => (e.target.style.borderColor = "#5db72c")}
                      onBlur={(e) =>
                        (e.target.style.borderColor = "rgba(255,255,255,0.12)")
                      }
                    />
                  </div>
                </div>

                {error && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "10px",

                      background: "rgba(239, 68, 68, 0.08)",

                      border: "1px solid rgba(239, 68, 68, 0.2)",

                      color: "#f87171",
                      fontSize: "13px",
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "14px",

                    borderRadius: "12px",
                    fontSize: "15px",
                    fontWeight: 700,

                    background:
                      "linear-gradient(135deg, #5db72c 0%, #3f8f19 100%)",

                    color: "#fff",
                    border: "none",
                    cursor: loading ? "not-allowed" : "pointer",

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",

              boxShadow: "0 4px 20px rgba(93,183,44,0.4)",

                    opacity: loading ? 0.7 : 1,

                    transition: "all 0.2s",
                  }}
                >
                  {loading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      Entrar <ArrowRight size={16} />
                    </>
                  )}
                </button>
                <a href="/forgot-password" style={{ display: "block", textAlign: "right", color: "#bbf7d0", fontSize: "13px", textDecoration: "none" }}>Esqueci minha senha</a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ textAlign: "center", marginBottom: "28px" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",

                    width: "52px",
                    height: "52px",
                    borderRadius: "14px",

                    background: "rgba(16, 185, 129, 0.1)",

                    border: "1px solid rgba(16, 185, 129, 0.2)",

                    marginBottom: "16px",
                  }}
                >
                  <ShieldCheck size={26} color="#10b981" />
                </div>

                <h3
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#ffffff",
                    marginBottom: "6px",
                    fontFamily: "'Outfit', sans-serif",
                  }}
                >
                  Verificação de Segurança
                </h3>

                <p
                  style={{
                    fontSize: "13px",
                    color: "#d4d4d8",
                    lineHeight: 1.6,
                  }}
                >
                  {twoFactorMethod === "totp"
                    ? "Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador."
                    : "Enviamos um código de verificação de 6 dígitos para o seu e-mail cadastrado."}
                </p>
              </div>

              {/* OTP boxes */}

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "center",
                  marginBottom: "24px",
                }}
              >
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => (otpRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    style={{
                      width: "48px",
                      height: "58px",

                      textAlign: "center",
                      fontSize: "22px",
                      fontWeight: 700,

                      borderRadius: "12px",

                      background: digit
                        ? "rgba(93, 183, 44, 0.1)"
                        : "rgba(255,255,255,0.04)",

                      border: `2px solid ${digit ? "#5db72c" : "rgba(255,255,255,0.12)"}`,

                      color: "#ffffff",
                      outline: "none",

                      transition: "all 0.2s",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "#5db72c")}
                    onBlur={(e) => {
                      if (!digit)
                        e.target.style.borderColor = "rgba(255,255,255,0.12)";
                    }}
                  />
                ))}
              </div>

              {error && (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "10px",
                    marginBottom: "16px",

                    background: "rgba(239, 68, 68, 0.08)",

                    border: "1px solid rgba(239, 68, 68, 0.2)",

                    color: "#f87171",
                    fontSize: "13px",
                    textAlign: "center",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.join("").length < 6}
                style={{
                  width: "100%",
                  padding: "14px",

                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: 700,

                  background:
                    "linear-gradient(135deg, #10b981 0%, #059669 100%)",

                  color: "#fff",
                  border: "none",

                  cursor:
                    loading || otp.join("").length < 6
                      ? "not-allowed"
                      : "pointer",

                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",

                  boxShadow: "0 4px 20px rgba(16,185,129,0.3)",

                  opacity: loading || otp.join("").length < 6 ? 0.6 : 1,

                  transition: "all 0.2s",

                  marginBottom: "16px",
                }}
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <ShieldCheck size={16} /> Verificar Código
                  </>
                )}
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setStep(STEP.LOGIN);
                    setError("");
                    setOtp(["", "", "", "", "", ""]);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#d4d4d8",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  ← Voltar
                </button>

                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0 || loading}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: countdown > 0 ? "not-allowed" : "pointer",

                    color: countdown > 0 ? "#3f3f46" : "#5db72c",

                    fontSize: "13px",
                    fontWeight: 600,

                    display: "flex",
                    alignItems: "center",
                    gap: "5px",

                    transition: "color 0.2s",
                  }}
                >
                  <RefreshCw size={13} />

                  {countdown > 0
                    ? `Reenviar em ${countdown}s`
                    : "Reenviar código"}
                </button>
              </div>
            </form>
          )}
        </div>

        <p
          style={{
            textAlign: "center",
            color: "#d4d4d8",
            fontSize: "12px",
            marginTop: "24px",
          }}
        >
          Cardápio digital com automação no WhatsApp
        </p>
      </div>
    </div>
  );
}
