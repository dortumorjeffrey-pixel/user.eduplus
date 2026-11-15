import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
          portalSelect: path.resolve(__dirname, 'portal-select.html'),
          studentLogin: path.resolve(__dirname, 'student-login.html'),
          studentRegister: path.resolve(__dirname, 'student-register.html'),
          lecturerLogin: path.resolve(__dirname, 'lecturer-login.html'),
          lecturerRegister: path.resolve(__dirname, 'lecturer-register.html'),
          resetPassword: path.resolve(__dirname, 'reset-password.html'),
          verification: path.resolve(__dirname, 'verification.html'),
          studentDashboard: path.resolve(__dirname, 'student-dashboard.html'),
          lecturerDashboard: path.resolve(__dirname, 'lecturer-dashboard.html')
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
