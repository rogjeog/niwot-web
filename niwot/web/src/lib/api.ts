import axios from "axios";

const fallback =
  typeof window !== "undefined"
    ? `${window.location.protocol}//api-game.${window.location.hostname}`
    : "https://api-game.niwot.btsinfo.nc";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE || fallback,
  withCredentials: true,
});

export default api;
