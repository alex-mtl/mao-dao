import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import i18n from 'laravel-react-i18n/vite';

export default defineConfig({
    // Only set when building for a path-prefixed deployment (e.g. /quiz);
    // local dev and the Docker stack leave this unset and keep the
    // laravel-vite-plugin default (assets served from domain root).
    base: process.env.VITE_ASSET_BASE_PATH || undefined,
    plugins: [
        laravel({
            input: 'resources/js/app.jsx',
            refresh: true,
        }),
        react(),
        i18n(),
    ],
});
