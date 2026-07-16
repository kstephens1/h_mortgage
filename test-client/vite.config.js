export default {
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/chat": "http://127.0.0.1:5174",
      "/health": "http://127.0.0.1:5174",
    },
  },
};
