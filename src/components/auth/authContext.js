// Contexto de autenticación (separado del componente para Fast Refresh).
import { createContext, useContext } from "react";
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
