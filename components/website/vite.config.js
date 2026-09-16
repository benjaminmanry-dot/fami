const { defineConfig, loadEnv } = require('vite');
const { validateOwnerPublicConfig } = require('./scripts/owner-public-config');
const { resolve } = require('path');
const {
  OUTPUT_FILE,
  buildCampaignOfferSnapshot,
  serializeCampaignOfferSnapshot
} = require('./scripts/campaign-offers');

module.exports = defineConfig(({ mode }) => {
  validateOwnerPublicConfig(loadEnv(mode, __dirname, 'VITE_SUPABASE_'));
  return {
  server: { fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.owner-local/**', '**/.owner-private/**', '**/.owner-proof/**', '**/.git/**', '**/*.private.json', '**/*.private.sql', '**/*private-recovery*.json'] } },
  plugins: [{
    name: 'campaign-offer-snapshot',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: OUTPUT_FILE,
        source: serializeCampaignOfferSnapshot(buildCampaignOfferSnapshot(__dirname))
      });
    }
  }],
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        owner: resolve(__dirname, 'owner/index.html'),
        ownerPrivacy: resolve(__dirname, 'owner/privacy/index.html'),
        motionSpike: resolve(__dirname, 'motion-spike/index.html'),
        austin: resolve(__dirname, 'austin/index.html'),
        campaigns: resolve(__dirname, 'campaigns/index.html'),
        witchlight: resolve(__dirname, 'campaigns/witchlight/index.html'),
        thronesOfTheDjinniLords: resolve(__dirname, 'campaigns/thrones-of-the-djinni-lords/index.html'),
        sigil: resolve(__dirname, 'campaigns/sigil/index.html'),
        vecnaEveOfRuin: resolve(__dirname, 'campaigns/vecna-eve-of-ruin/index.html'),
        avylan: resolve(__dirname, 'campaigns/avylan/index.html'),
        waterdeepDragonheistDotmm: resolve(__dirname, 'campaigns/waterdeep-dragonheist-dotmm/index.html'),
        epicQuests: resolve(__dirname, 'campaigns/epic-quests/index.html'),
        start: resolve(__dirname, 'start/index.html'),
        thanks: resolve(__dirname, 'start/thanks/index.html'),
        faq: resolve(__dirname, 'faq/index.html'),
        attendancePolicy: resolve(__dirname, 'attendance-policy/index.html'),
        billingTerms: resolve(__dirname, 'billing/terms/index.html'),
        billingSetupComplete: resolve(__dirname, 'billing/setup-complete/index.html'),
        about: resolve(__dirname, 'about/index.html'),
        notFound: resolve(__dirname, '404.html')
      }
    }
  }
  };
});
