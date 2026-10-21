const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 13) {
  console.error('Usa Node.js 24.13+ de la rama 24 LTS (ver .node-version; validado con 24.22.0).');
  process.exitCode = 1;
}
