import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        acknowledgment: path.resolve(__dirname, 'acknowledgment.html'),
        verification: path.resolve(__dirname, 'verification.html'),
        portalSelect: path.resolve(__dirname, 'portal-select.html'),
        studentLogin: path.resolve(__dirname, 'student-login.html'),
        studentRegister: path.resolve(__dirname, 'student-register.html'),
        lecturerLogin: path.resolve(__dirname, 'lecturer-login.html'),
        lecturerRegister: path.resolve(__dirname, 'lecturer-register.html'),
        studentDashboard: path.resolve(__dirname, 'student-dashboard.html'),
        lecturerDashboard: path.resolve(__dirname, 'lecturer-dashboard.html'),
      },
    },
  },
});
