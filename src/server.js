import { createApp } from './app.js';
import { config } from './config/index.js';
import { startAttachmentCleanup, stopAttachmentCleanup } from './services/attachments.js';
import { getIndexMeta, loadIndex } from './services/handbookSearch.js';

const app = createApp();
let server = null;
let shuttingDown = false;

async function start() {
  try {
    const index = await loadIndex();
    const meta = await getIndexMeta();
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Handbook index loaded',
        document: meta.title,
        published: meta.published,
        chunks: index.chunks.length,
        sections: meta.sections,
        embedding: `${index.embedding.provider}/${index.embedding.model}`,
      })
    );
  } catch (error) {
    console.error(
      [
        'Could not load the handbook index.',
        '',
        `Reason: ${error.message}`,
        '',
        'Build the index first:',
        '  npm run index',
        '',
        'Make sure the handbook PDF is in the project folder, or set HANDBOOK_PATH in .env.',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  startAttachmentCleanup();

  server = app.listen(config.port, () => {
    const mode = config.features.demoMode
      ? 'LOCAL DEMO (no AI key configured; no AI requests will be made)'
      : `AI ENABLED (${config.ai.provider}, ${config.ai.model})`;
    console.log(
      [
        '',
        `${config.appName} v${config.appVersion}`,
        `  Local:  http://localhost:${config.port}`,
        `  Mode:   ${mode}`,
        `  Note:   Unofficial prototype. Not an STI service.`,
        '',
      ].join('\n')
    );
    if (config.ai.keyWasPlaceholder) {
      console.warn(
        'AI_API_KEY still contains a placeholder value, so demo mode is active. Replace it with a real key to enable AI answers.'
      );
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${config.port} is already in use. Stop the other process or set PORT to a different value in .env.`
      );
    } else {
      console.error('Server error:', error.message);
    }
    process.exitCode = 1;
    stopAttachmentCleanup();
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Shutting down...`);
  stopAttachmentCleanup();

  const finish = () => {
    process.exit(0);
  };

  if (!server) {
    finish();
    return;
  }

  const force = setTimeout(() => {
    console.error('Shutdown timed out after 10 seconds. Exiting.');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(() => {
    clearTimeout(force);
    finish();
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

start();
