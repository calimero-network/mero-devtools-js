// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Mero DevTools documentation — Astro Starlight with the shared Calimero theme
// (Zinc + #a5ff11 lime), ported from calimero-network/core.
export default defineConfig({
  site: 'https://calimero-network.github.io',
  // GitHub project Pages serve under /<repo>/. Change if a custom domain is used.
  base: '/mero-devtools-js',
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: 'Mero DevTools',
      description:
        'JavaScript/TypeScript developer tools for Calimero — a WASM-ABI v1 parser and TypeScript client generator (abi-codegen) plus the create-mero-app project scaffolder.',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        alt: 'Mero DevTools',
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/theme.css'],
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderRadius: '0.5rem',
          borderColor: 'var(--sl-color-gray-6)',
          codeBackground: 'var(--sl-color-gray-7)',
          codeFontFamily: 'var(--sl-font-mono)',
          frames: {
            editorTabBarBackground: 'var(--sl-color-gray-6)',
            terminalTitlebarBackground: 'var(--sl-color-gray-6)',
          },
        },
      },
      lastUpdated: true,
      editLink: {
        baseUrl:
          'https://github.com/calimero-network/mero-devtools-js/edit/main/docs/',
      },
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#09090b' } },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/calimero-network/mero-devtools-js',
        },
      ],
      // Explicit, grouped navigation: Understand → Reference.
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Understand',
          items: ['understand/overview', 'understand/architecture'],
        },
        {
          label: 'Reference',
          items: ['reference/cli', 'reference/api', 'reference/abi-format'],
        },
      ],
    }),
  ],
});
